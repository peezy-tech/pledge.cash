import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import {
  assetPolicyAbi,
  boardroomAbi,
  erc20Abi,
  hashAction,
  type BoardroomCall,
  type PledgeCashDeployment
} from "@pledge.cash/sdk";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  toHex,
  type Address,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { createApp } from "../src/api/server";
import { createDrizzleApiStore } from "../src/api/store";
import { createWorkOsAuthAdapter } from "../src/api/workos";
import { runWatcherOnce } from "../src/chain/watcher";
import { loadConfig } from "../src/config";
import { createDbClient, type SentinelDbClient } from "../src/db/client";
import {
  analyses,
  channels,
  notifications,
  policyAdminEvents,
  queuedActions,
  riskAssessments,
  subscriptions,
  users,
  wallets
} from "../src/db/schema";
import { createActionPipeline } from "../src/pipeline";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "../../..");
const contractsDir = join(repoRoot, "packages/contracts");
const deploymentPath = join(contractsDir, "deployments/31337.json");
const seedPath = join(contractsDir, "deployments/31337.seed.json");

const chainId = 31337;
const defaultPort = Number.parseInt(process.env.SENTINEL_ANVIL_PORT ?? "8547", 10);
const rpcUrl = process.env.SENTINEL_ANVIL_RPC_URL ?? `http://127.0.0.1:${defaultPort}`;
const deployerKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const boardroomOwnerKey = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" as Hex;
const holderKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;
const contractorKey = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as Hex;
const create2Factory = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as const;
const zeroAddress = "0x0000000000000000000000000000000000000000" as const;

type SeedArtifact = {
  readonly boardroom: Address;
  readonly boardroomOwner: Address;
  readonly boardroomShareToken: Address;
  readonly cashToken: Address;
  readonly holder: Address;
};

type TempDatabase = {
  readonly adminSql: postgres.Sql;
  readonly databaseUrl: string;
  readonly name: string;
};

type AnvilHandle = {
  readonly started: boolean;
  stop(): Promise<void>;
};

const chain = defineChain({
  id: chainId,
  name: "Sentinel local Anvil",
  nativeCurrency: { decimals: 18, name: "Local Ether", symbol: "ETH" },
  rpcUrls: { default: { http: [rpcUrl] } }
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const deployer = privateKeyToAccount(deployerKey);
const owner = privateKeyToAccount(boardroomOwnerKey);
const holder = privateKeyToAccount(holderKey);
const contractor = privateKeyToAccount(contractorKey);
const ownerClient = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
const holderClient = createWalletClient({ account: holder, chain, transport: http(rpcUrl) });
const deployerClient = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });

let dbClient: SentinelDbClient | undefined;
let tempDb: TempDatabase | undefined;
let anvil: AnvilHandle | undefined;

try {
  anvil = await ensureAnvil();
  const wrappedNative = process.env.WRAPPED_NATIVE_ADDRESS ?? (await deployWrappedNative());
  await deployContracts(wrappedNative as Address);
  await seedLocal();

  const deployment = await readJson<PledgeCashDeployment>(deploymentPath);
  const seed = await readJson<SeedArtifact>(seedPath);
  assertAddress(deployment.boardroomFactory, "deployment.boardroomFactory");
  assertAddress(deployment.assetPolicy, "deployment.assetPolicy");
  assertAddress(seed.boardroom, "seed.boardroom");
  assertAddress(seed.boardroomShareToken, "seed.boardroomShareToken");
  assertAddress(seed.cashToken, "seed.cashToken");

  tempDb = await createTempDatabase();
  const sentinelPort = await getAvailablePort();
  const config = loadConfig({
    DATABASE_URL: tempDb.databaseUrl,
    SENTINEL_CHAIN_IDS: String(chainId),
    SENTINEL_HARNESS: "none",
    SENTINEL_MAX_BLOCK_RANGE: "100000",
    SENTINEL_PORT: String(sentinelPort),
    SENTINEL_RPC_URL_31337: rpcUrl,
    SENTINEL_WEB_ORIGIN: "https://example.invalid",
    SENTINEL_TWITTER_ENABLED: "0"
  });
  dbClient = createDbClient(config);
  await dbClient.migrate();

  await linkShareholder(dbClient, seed.holder.toLowerCase() as Address);
  await launchBoardroom(seed);

  const pipeline = createActionPipeline({ config, db: dbClient.db });
  const setExecutorCall: BoardroomCall = {
    data: encodeFunctionData({
      abi: boardroomAbi,
      functionName: "setExecutor",
      args: [contractor.address]
    }),
    policy: zeroAddress,
    target: seed.boardroom,
    value: 0n
  };
  const setExecutorSalt = salt("sentinel-set-executor");
  const setExecutorHash = hashAction(setExecutorCall, setExecutorSalt);
  const onChainHash = await publicClient.readContract({
    address: seed.boardroom,
    abi: boardroomAbi,
    functionName: "hashAction",
    args: [setExecutorCall, setExecutorSalt]
  });
  assertEqual(onChainHash.toLowerCase(), setExecutorHash.toLowerCase(), "hash parity for setExecutor");

  await submit(ownerClient.writeContract({
    address: seed.boardroom,
    abi: boardroomAbi,
    functionName: "queueAction",
    args: [setExecutorCall, setExecutorSalt]
  }), "queue setExecutor action");
  await runWatcherOnce(chainId, {
    config,
    deployment,
    onActionEvent: pipeline.handle,
    db: dbClient.db
  });

  const setExecutorAction = await requireAction(dbClient, setExecutorHash, "queued");
  await requireRisk(dbClient, setExecutorAction.id, "high");
  await requireAnalysis(dbClient, setExecutorAction.id, "template");
  await requireNotification(dbClient, setExecutorAction.id, "queued");
  await requirePublicFeed(config, dbClient, setExecutorAction.id);

  await submit(holderClient.writeContract({
    address: seed.boardroom,
    abi: boardroomAbi,
    functionName: "cancelAction",
    args: [setExecutorHash]
  }), "cancel setExecutor action");
  await runWatcherOnce(chainId, {
    config,
    deployment,
    onActionEvent: pipeline.handle,
    db: dbClient.db
  });
  await requireAction(dbClient, setExecutorHash, "cancelled");
  await requireNotification(dbClient, setExecutorAction.id, "cancelled");

  const approveSpender = "0x000000000000000000000000000000000000dEaD" as Address;
  const approveCall: BoardroomCall = {
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [approveSpender, 1n]
    }),
    policy: deployment.assetPolicy as Address,
    target: seed.cashToken,
    value: 0n
  };
  const approveSalt = salt("sentinel-policy-admin-approve");
  const approveHash = hashAction(approveCall, approveSalt);
  await submit(ownerClient.writeContract({
    address: seed.boardroom,
    abi: boardroomAbi,
    functionName: "queueAction",
    args: [approveCall, approveSalt]
  }), "queue approve action");
  await runWatcherOnce(chainId, {
    config,
    deployment,
    onActionEvent: pipeline.handle,
    db: dbClient.db
  });
  const approveAction = await requireAction(dbClient, approveHash, "queued");
  await requireRisk(dbClient, approveAction.id, "high");

  await submit(deployerClient.writeContract({
    address: deployment.assetPolicy as Address,
    abi: assetPolicyAbi,
    functionName: "setApprovalSpenderAllowed",
    args: [approveSpender, true]
  }), "enable approve spender");
  await runWatcherOnce(chainId, {
    config,
    deployment,
    onActionEvent: pipeline.handle,
    db: dbClient.db
  });
  await requirePolicyAdminEvent(dbClient, approveSpender);
  await requireNotification(dbClient, approveAction.id, "policy-admin");

  console.log(
    JSON.stringify(
      {
        ok: true,
        approveAction: approveAction.id,
        boardroom: seed.boardroom,
        cancelledAction: setExecutorAction.id,
        chainId,
        rpcUrl
      },
      null,
      2
    )
  );
} finally {
  await dbClient?.close();
  if (tempDb !== undefined) {
    await dropTempDatabase(tempDb);
  }
  await anvil?.stop();
}

async function ensureAnvil(): Promise<AnvilHandle> {
  if (await rpcReady()) {
    return { started: false, stop: async () => undefined };
  }

  const child = spawn("anvil", ["--host", "127.0.0.1", "--port", String(defaultPort), "--chain-id", String(chainId)], {
    cwd: repoRoot,
    env: process.env
  });
  if (process.env.SENTINEL_ANVIL_LOGS === "1") {
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.stdout.on("data", (chunk) => process.stderr.write(chunk));
  }

  const started = await waitForRpc(child);
  if (!started) {
    child.kill("SIGTERM");
    throw new Error(`Anvil did not become ready at ${rpcUrl}`);
  }

  return {
    started: true,
    async stop() {
      await stopChild(child);
    }
  };
}

async function deployWrappedNative(): Promise<string> {
  const output = await runCommand("deploy WETH", "forge", [
    "create",
    "lib/solady/src/tokens/WETH.sol:WETH",
    "--rpc-url",
    rpcUrl,
    "--private-key",
    deployerKey,
    "--broadcast"
  ], { cwd: contractsDir });
  const match = /Deployed to:\s*(0x[a-fA-F0-9]{40})/.exec(output);
  if (!match) {
    throw new Error("forge create WETH did not print a deployed address");
  }
  return match[1]!;
}

async function deployContracts(wrappedNative: Address): Promise<void> {
  await runCommand("deploy contracts", "forge", [
    "script",
    "script/Deploy.s.sol:Deploy",
    "--rpc-url",
    rpcUrl,
    "--chain",
    String(chainId),
    "--always-use-create-2-factory",
    "--create2-deployer",
    create2Factory,
    "--broadcast",
    "-vvv"
  ], {
    cwd: contractsDir,
    env: {
      PRIVATE_KEY: deployerKey,
      PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER: deployer.address,
      PLEDGE_CASH_PROTOCOL_GOVERNANCE: deployer.address,
      PLEDGE_CASH_PROTOCOL_TREASURY: deployer.address,
      PLEDGE_CASH_AMM_FEE_MANAGER: deployer.address,
      WRAPPED_NATIVE_ADDRESS: wrappedNative,
      WRITE_DEPLOYMENT_STATE: "true"
    }
  });
}

async function seedLocal(): Promise<void> {
  await runCommand("seed local", "forge", [
    "script",
    "script/SeedLocal.s.sol:SeedLocal",
    "--rpc-url",
    rpcUrl,
    "--broadcast",
    "--slow",
    "-vvv"
  ], {
    cwd: contractsDir,
    env: {
      LOCAL_SEED_NONCE: process.env.LOCAL_SEED_NONCE ?? "2",
      PRIVATE_KEY: deployerKey
    }
  });
}

async function createTempDatabase(): Promise<TempDatabase> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL is required for Sentinel Anvil integration");
  }

  const dbName = `sentinel_wp8_${randomBytes(5).toString("hex")}`;
  const adminUrl = new URL(databaseUrl);
  const tempUrl = new URL(databaseUrl);
  tempUrl.pathname = `/${dbName}`;
  const adminSql = postgres(adminUrl.toString(), { max: 1 });

  try {
    await adminSql.unsafe(`CREATE DATABASE ${dbName}`);
  } catch (error) {
    await adminSql.end({ timeout: 5 });
    throw error;
  }

  return { adminSql, databaseUrl: tempUrl.toString(), name: dbName };
}

async function dropTempDatabase(temp: TempDatabase): Promise<void> {
  try {
    await temp.adminSql.unsafe(`DROP DATABASE IF EXISTS ${temp.name} WITH (FORCE)`);
  } finally {
    await temp.adminSql.end({ timeout: 5 });
  }
}

async function linkShareholder(dbClient_: SentinelDbClient, holderAddress: Address): Promise<void> {
  const [user] = await dbClient_.db
    .insert(users)
    .values({
      email: "sentinel-holder@example.invalid",
      workosUserId: "sentinel-integration-holder"
    })
    .returning();
  if (user === undefined) {
    throw new Error("Failed to create integration user");
  }

  await dbClient_.db.insert(wallets).values({
    address: holderAddress,
    siweMessage: "integration test wallet link",
    userId: user.id
  });
  await dbClient_.db.insert(subscriptions).values({
    minSeverity: "low",
    mode: "holdings",
    userId: user.id
  });
  await dbClient_.db.insert(channels).values({
    telegramChatId: "sentinel-integration-chat",
    type: "telegram",
    userId: user.id
  });
}

async function launchBoardroom(seed: SeedArtifact): Promise<void> {
  const launched = await publicClient.readContract({
    address: seed.boardroom,
    abi: boardroomAbi,
    functionName: "launched"
  });

  if (launched) {
    return;
  }

  await submit(ownerClient.writeContract({
    address: seed.boardroom,
    abi: boardroomAbi,
    functionName: "mint",
    args: [seed.holder, 1n]
  }), "mint shareholder share");
  await submit(ownerClient.writeContract({
    address: seed.boardroom,
    abi: boardroomAbi,
    functionName: "launch",
    args: [60n]
  }), "launch boardroom");
}

async function requireAction(
  dbClient_: SentinelDbClient,
  actionHash: Hex,
  status: "queued" | "cancelled" | "executed"
) {
  const [row] = await dbClient_.db
    .select()
    .from(queuedActions)
    .where(and(eq(queuedActions.chainId, chainId), eq(queuedActions.actionHash, actionHash.toLowerCase())))
    .limit(1);
  if (row === undefined) {
    throw new Error(`Missing queued_actions row for ${actionHash}`);
  }
  assertEqual(row.status, status, `queued action ${actionHash} status`);
  assertEqual(row.decodeStatus, "decoded", `queued action ${actionHash} decode status`);
  return row;
}

async function requireRisk(
  dbClient_: SentinelDbClient,
  actionId: string,
  severity: "low" | "medium" | "high"
): Promise<void> {
  const [row] = await dbClient_.db
    .select()
    .from(riskAssessments)
    .where(eq(riskAssessments.actionId, actionId))
    .limit(1);
  if (row === undefined) {
    throw new Error(`Missing risk_assessments row for ${actionId}`);
  }
  assertEqual(row.severity, severity, `risk severity for ${actionId}`);
}

async function requireAnalysis(
  dbClient_: SentinelDbClient,
  actionId: string,
  source: "harness" | "template"
): Promise<void> {
  const [row] = await dbClient_.db.select().from(analyses).where(eq(analyses.actionId, actionId)).limit(1);
  if (row === undefined) {
    throw new Error(`Missing analyses row for ${actionId}`);
  }
  assertEqual(row.source, source, `analysis source for ${actionId}`);
}

async function requireNotification(
  dbClient_: SentinelDbClient,
  actionId: string,
  event: "queued" | "cancelled" | "executed" | "policy-admin"
): Promise<void> {
  const [row] = await dbClient_.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.actionId, actionId), eq(notifications.event, event)))
    .limit(1);
  if (row === undefined) {
    throw new Error(`Missing ${event} notification for ${actionId}`);
  }
}

async function requirePolicyAdminEvent(dbClient_: SentinelDbClient, subject: Address): Promise<void> {
  const [row] = await dbClient_.db
    .select()
    .from(policyAdminEvents)
    .where(eq(policyAdminEvents.subject, subject.toLowerCase()))
    .limit(1);
  if (row === undefined) {
    throw new Error(`Missing policy_admin_events row for ${subject}`);
  }
}

async function requirePublicFeed(config: ReturnType<typeof loadConfig>, dbClient_: SentinelDbClient, actionId: string): Promise<void> {
  const app = createApp({
    auth: createWorkOsAuthAdapter(config),
    config,
    store: createDrizzleApiStore(dbClient_.db)
  });
  const response = await app.request(`/public/actions?chainId=${chainId}&minSeverity=high&limit=5`);
  if (response.status !== 200) {
    throw new Error(`GET /public/actions returned ${response.status}`);
  }

  const body = (await response.json()) as { readonly items?: readonly { readonly id?: string }[] };
  if (!body.items?.some((item) => item.id === actionId)) {
    throw new Error(`GET /public/actions did not include ${actionId}`);
  }
}

async function submit(hashPromise: Promise<Hex>, label: string): Promise<Hex> {
  const hash = await hashPromise;
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`${label} reverted: ${hash}`);
  }
  return hash;
}

async function rpcReady(): Promise<boolean> {
  try {
    return (await publicClient.getChainId()) === chainId;
  } catch {
    return false;
  }
}

async function waitForRpc(child: ChildProcessWithoutNullStreams): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    if (child.exitCode !== null) {
      return false;
    }
    if (await rpcReady()) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

async function runCommand(
  label: string,
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env?: Record<string, string | undefined> }
): Promise<string> {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const output = `${stdout}${stderr}`;
  if (code !== 0) {
    const outputLines = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const tail = outputLines.slice(-20).join("\n");
    throw new Error(`${label} failed with exit code ${String(code)}:\n${tail || "no output"}`);
  }
  return output;
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("close", () => resolve())),
    sleep(5_000).then(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    })
  ]);
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        if (typeof address === "object" && address !== null) {
          resolve(address.port);
          return;
        }
        reject(new Error("Unable to reserve a Sentinel integration port"));
      });
    });
  });
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function salt(label: string): Hex {
  return keccak256(toHex(label));
}

function assertAddress(value: unknown, label: string): asserts value is Address {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${label} is missing or not an address`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
