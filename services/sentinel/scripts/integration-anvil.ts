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
  boardroomControllerAbi,
  boardroomControllerFactoryAbi,
  boardroomRewardsAbi,
  erc20Abi,
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

import { createBetterAuthAdapter } from "../src/api/better-auth";
import { createDrizzleBoardroomControlStore } from "../src/api/boardroom-control-store";
import { createApp } from "../src/api/server";
import { createDrizzleApiStore } from "../src/api/store";
import { createBoardroomControlChainReader } from "../src/chain/boardroom-control";
import { runWatcherOnce } from "../src/chain/watcher";
import { loadConfig } from "../src/config";
import { createDbClient, type SentinelDbClient } from "../src/db/client";
import {
  analyses,
  channels,
  notifications,
  policyAdminEvents,
  scheduledOperations,
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
const controllerDelay = 86_400n;
const governanceGracePeriod = 7n * 86_400n;
const defaultPort = Number.parseInt(process.env.SENTINEL_ANVIL_PORT ?? "8547", 10);
const rpcUrl = process.env.SENTINEL_ANVIL_RPC_URL ?? `http://127.0.0.1:${defaultPort}`;
const deployerKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const boardroomOwnerKey = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" as Hex;
const holderKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;
const contractorKey = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as Hex;
const create2Factory = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as const;

type SeedArtifact = {
  readonly boardroom: Address;
  readonly boardroomOwner: Address;
  readonly boardroomRewards: Address;
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
  assertAddress(seed.boardroomRewards, "seed.boardroomRewards");
  assertAddress(seed.boardroomShareToken, "seed.boardroomShareToken");
  assertAddress(seed.cashToken, "seed.cashToken");

  tempDb = await createTempDatabase();
  const sentinelPort = await getAvailablePort();
  const config = loadConfig({
    BETTER_AUTH_SECRET: "sentinel-integration-auth-secret-0000000000000000",
    BETTER_AUTH_URL: `http://127.0.0.1:${sentinelPort.toString()}`,
    DATABASE_URL: tempDb.databaseUrl,
    SENTINEL_CHAIN_IDS: String(chainId),
    SENTINEL_HARNESS: "none",
    SENTINEL_MAX_BLOCK_RANGE: "1000",
    SENTINEL_PORT: String(sentinelPort),
    SENTINEL_RPC_URL_31337: rpcUrl,
    SENTINEL_WEB_ORIGIN: "https://example.invalid",
    SENTINEL_TWITTER_ENABLED: "0"
  });
  dbClient = createDbClient(config);
  await dbClient.migrate();

  const subscriberUserId = await linkShareholder(dbClient, seed.holder.toLowerCase() as Address);
  const controller = await launchBoardroom(seed);
  await mineFinalizedProofBlocks();
  const controlClaim = await requireBoardroomControlProof(
    config,
    dbClient,
    deployment,
    subscriberUserId,
    seed.boardroom
  );

  const pipeline = createActionPipeline({ config, db: dbClient.db });
  const boardroomEpoch = await publicClient.readContract({
    address: seed.boardroom,
    abi: boardroomAbi,
    functionName: "governanceEpoch"
  });
  const configurationEpoch = await publicClient.readContract({
    address: controller,
    abi: boardroomControllerAbi,
    functionName: "configurationEpoch"
  });
  const updateConfigurationData = encodeFunctionData({
    abi: boardroomControllerAbi,
    functionName: "updateConfiguration",
    args: [contractor.address, controllerDelay, governanceGracePeriod]
  });
  const updateConfigurationSalt = salt("sentinel-controller-configuration");
  const updateConfigurationOperationId = await publicClient.readContract({
    address: controller,
    abi: boardroomControllerAbi,
    functionName: "hashControllerOperation",
    args: [
      updateConfigurationData,
      updateConfigurationSalt,
      boardroomEpoch,
      configurationEpoch,
      owner.address
    ]
  });

  await submit(ownerClient.writeContract({
    address: controller,
    abi: boardroomControllerAbi,
    functionName: "scheduleControllerOperation",
    args: [updateConfigurationData, updateConfigurationSalt, boardroomEpoch, configurationEpoch]
  }), "schedule controller configuration operation");
  await runWatcherOnce(chainId, {
    config,
    deployment,
    onActionEvent: pipeline.handle,
    db: dbClient.db
  });

  const configurationOperation = await requireOperation(
    dbClient,
    updateConfigurationOperationId,
    "scheduled"
  );
  await requireRisk(dbClient, configurationOperation.id, "high");
  await requireAnalysis(dbClient, configurationOperation.id, "template");
  await requireNotification(dbClient, configurationOperation.id, "scheduled");
  await requirePublicFeed(config, dbClient, configurationOperation.id);

  await submit(holderClient.writeContract({
    address: seed.boardroom,
    abi: boardroomAbi,
    functionName: "veto",
    args: [updateConfigurationOperationId]
  }), "veto controller configuration operation");
  await runWatcherOnce(chainId, {
    config,
    deployment,
    onActionEvent: pipeline.handle,
    db: dbClient.db
  });
  await requireOperation(dbClient, updateConfigurationOperationId, "cancelled");
  await requireNotification(dbClient, configurationOperation.id, "cancelled");
  await requireNotificationDeliveryFeed(
    config,
    dbClient,
    subscriberUserId,
    configurationOperation.id,
    ["scheduled", "cancelled"]
  );

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
  const approveOperationId = await publicClient.readContract({
    address: controller,
    abi: boardroomControllerAbi,
    functionName: "hashBoardroomOperation",
    args: [[approveCall], approveSalt, boardroomEpoch, configurationEpoch, owner.address]
  });
  await submit(deployerClient.writeContract({
    address: deployment.assetPolicy as Address,
    abi: assetPolicyAbi,
    functionName: "setApprovalSpenderAllowed",
    args: [approveSpender, true]
  }), "pre-authorize approve spender");
  await runWatcherOnce(chainId, {
    config,
    deployment,
    onActionEvent: pipeline.handle,
    db: dbClient.db
  });
  await submit(ownerClient.writeContract({
    address: controller,
    abi: boardroomControllerAbi,
    functionName: "scheduleBoardroomOperation",
    args: [[approveCall], approveSalt, boardroomEpoch, configurationEpoch]
  }), "schedule approve operation");
  await runWatcherOnce(chainId, {
    config,
    deployment,
    onActionEvent: pipeline.handle,
    db: dbClient.db
  });
  const approveAction = await requireOperation(dbClient, approveOperationId, "scheduled");
  await requireRisk(dbClient, approveAction.id, "high");

  await submit(deployerClient.writeContract({
    address: deployment.assetPolicy as Address,
    abi: assetPolicyAbi,
    functionName: "setApprovalSpenderAllowed",
    args: [approveSpender, false]
  }), "disable approve spender");
  await submit(deployerClient.writeContract({
    address: deployment.assetPolicy as Address,
    abi: assetPolicyAbi,
    functionName: "setApprovalSpenderAllowed",
    args: [approveSpender, true]
  }), "re-enable approve spender");
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
        cancelledOperation: configurationOperation.id,
        chainId,
        controlClaim,
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
    "--slow",
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

async function linkShareholder(dbClient_: SentinelDbClient, holderAddress: Address): Promise<string> {
  const [user] = await dbClient_.db
    .insert(users)
    .values({
      email: "sentinel-holder@example.invalid",
      emailVerified: false,
      name: "sentinel-integration-holder"
    })
    .returning();
  if (user === undefined) {
    throw new Error("Failed to create integration user");
  }

  await dbClient_.db.insert(wallets).values({
    address: holderAddress,
    chainId,
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
  return user.id;
}

async function requireBoardroomControlProof(
  config: ReturnType<typeof loadConfig>,
  dbClient_: SentinelDbClient,
  deployment: PledgeCashDeployment,
  userId: string,
  boardroom: Address
): Promise<string> {
  const app = createApp({
    auth: {
      socialProviders: [],
      async getSession() {
        return { user: { id: userId } };
      },
      async handler() {
        return new Response(null, { status: 404 });
      }
    },
    boardroomControl: {
      chain: createBoardroomControlChainReader({
        chains: config.chains,
        getDeployment: (requestedChainId) => requestedChainId === chainId ? deployment : undefined
      }),
      store: createDrizzleBoardroomControlStore(dbClient_.db)
    },
    config,
    generateNonce: () => "sentinellivecontrolnonce00000001",
    store: createDrizzleApiStore(dbClient_.db)
  });
  const headers = { "content-type": "application/json" };
  const challengeResponse = await app.request("/boardroom-control/challenges", {
    body: JSON.stringify({
      boardroom,
      chainId,
      destination: { id: userId, type: "user" },
      scope: "governance:write"
    }),
    headers,
    method: "POST"
  });
  if (challengeResponse.status !== 200) {
    throw new Error(
      `POST /boardroom-control/challenges returned ${challengeResponse.status}: ${await challengeResponse.text()}`
    );
  }
  const challenge = (await challengeResponse.json()) as {
    readonly message: string;
    readonly nonce: string;
  };
  const signature = await owner.signMessage({ message: challenge.message });
  const claimRequest = {
    body: JSON.stringify({ nonce: challenge.nonce, signature }),
    headers,
    method: "POST" as const
  };
  const claimResponse = await app.request("/boardroom-control/claims", claimRequest);
  if (claimResponse.status !== 200) {
    throw new Error(`POST /boardroom-control/claims returned ${claimResponse.status}: ${await claimResponse.text()}`);
  }
  const claimBody = (await claimResponse.json()) as {
    readonly claim?: {
      readonly id?: string;
      readonly identity?: { readonly boardroom?: Address };
      readonly scope?: string;
    };
  };
  if (
    claimBody.claim?.id === undefined ||
    claimBody.claim.identity?.boardroom?.toLowerCase() !== boardroom.toLowerCase() ||
    claimBody.claim.scope !== "governance:write"
  ) {
    throw new Error(`Boardroom-control claim response was malformed: ${JSON.stringify(claimBody)}`);
  }

  const replayResponse = await app.request("/boardroom-control/claims", claimRequest);
  if (replayResponse.status !== 409) {
    throw new Error(`Boardroom-control nonce replay returned ${replayResponse.status}`);
  }
  return claimBody.claim.id;
}

async function mineFinalizedProofBlocks(): Promise<void> {
  await runCommand("advance local finalized block", "cast", [
    "rpc",
    "anvil_mine",
    "0x40",
    "--rpc-url",
    rpcUrl
  ], { cwd: contractsDir });
}

async function launchBoardroom(seed: SeedArtifact): Promise<Address> {
  const launched = await publicClient.readContract({
    address: seed.boardroom,
    abi: boardroomAbi,
    functionName: "launched"
  });

  const activeStake = await publicClient.readContract({
    address: seed.boardroomRewards,
    abi: boardroomRewardsAbi,
    functionName: "activeStakeOf",
    args: [seed.holder]
  });
  if (activeStake === 0n) {
    let shareBalance = await publicClient.readContract({
      address: seed.boardroomShareToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [seed.holder]
    });
    if (shareBalance === 0n) {
      if (launched) throw new Error("Launched integration Boardroom has no protection-staker shares");
      await submit(ownerClient.writeContract({
        address: seed.boardroom,
        abi: boardroomAbi,
        functionName: "mint",
        args: [seed.holder, 100n * 10n ** 18n]
      }), "mint protection-staker shares");
      shareBalance = 100n * 10n ** 18n;
    }
    await submit(holderClient.writeContract({
      address: seed.boardroomRewards,
      abi: boardroomRewardsAbi,
      functionName: "stake",
      args: [shareBalance]
    }), "activate protection-staker stake");
  }

  if (!launched) {
    const controllerFactory = await publicClient.readContract({
      address: seed.boardroom,
      abi: boardroomAbi,
      functionName: "controllerFactory"
    });
    const predictedController = await publicClient.readContract({
      address: controllerFactory,
      abi: boardroomControllerFactoryAbi,
      functionName: "predictControllerAddress",
      args: [seed.boardroom, 1n]
    });
    const expectedRewardPool = await publicClient.readContract({
      address: seed.boardroom,
      abi: boardroomAbi,
      functionName: "rewardPool"
    });
    const expectedRedemptionExcessRecipient = await publicClient.readContract({
      address: seed.boardroom,
      abi: boardroomAbi,
      functionName: "redemptionExcessRecipient"
    });
    await submit(ownerClient.writeContract({
      address: seed.boardroom,
      abi: boardroomAbi,
      functionName: "launch",
      args: [{
        proposer: owner.address,
        predictedController,
        protectionStaker: seed.holder,
        expectedRewardPool,
        expectedRedemptionExcessRecipient,
        controllerDelay: controllerDelay,
        windDownDelay: controllerDelay,
        gracePeriod: governanceGracePeriod,
        generation: 1n
      }]
    }), "launch Boardroom with generation-1 controller");
  }

  return publicClient.readContract({
    address: seed.boardroom,
    abi: boardroomAbi,
    functionName: "controller"
  });
}

async function requireOperation(
  dbClient_: SentinelDbClient,
  operationId: Hex,
  status: "scheduled" | "cancelled" | "executed"
) {
  const [row] = await dbClient_.db
    .select()
    .from(scheduledOperations)
    .where(
      and(
        eq(scheduledOperations.chainId, chainId),
        eq(scheduledOperations.operationId, operationId.toLowerCase())
      )
    )
    .limit(1);
  if (row === undefined) {
    throw new Error(`Missing scheduled operation row for ${operationId}`);
  }
  assertEqual(row.status, status, `scheduled operation ${operationId} status`);
  assertEqual(row.decodeStatus, "decoded", `scheduled operation ${operationId} decode status`);
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
  event: "scheduled" | "cancelled" | "executed" | "policy-admin"
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

async function requireNotificationDeliveryFeed(
  config: ReturnType<typeof loadConfig>,
  dbClient_: SentinelDbClient,
  userId: string,
  actionId: string,
  events: readonly string[]
): Promise<void> {
  const app = createApp({
    auth: {
      socialProviders: [],
      async getSession() {
        return { user: { id: userId } };
      },
      async handler() {
        return new Response(null, { status: 404 });
      }
    },
    config,
    store: createDrizzleApiStore(dbClient_.db)
  });
  const observed: Array<{
    readonly action?: { readonly id?: string };
    readonly event?: string;
  }> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ limit: "10" });
    if (cursor !== null) query.set("cursor", cursor);
    const response = await app.request(`/notifications?${query.toString()}`);
    if (response.status !== 200) {
      throw new Error(`GET /notifications returned ${response.status}`);
    }

    const body = (await response.json()) as {
      readonly items?: readonly {
        readonly action?: { readonly id?: string };
        readonly event?: string;
      }[];
      readonly page?: { readonly nextCursor?: string | null };
    };
    if (JSON.stringify(body).includes("lastError")) {
      throw new Error("GET /notifications exposed raw delivery errors");
    }
    observed.push(...(body.items ?? []));
    cursor = body.page?.nextCursor ?? null;
    if (cursor === null) break;
  }

  const actionEvents = new Set(
    observed
      .filter((item) => item.action?.id === actionId)
      .map((item) => item.event)
  );
  for (const event of events) {
    if (!actionEvents.has(event)) {
      throw new Error(
        `GET /notifications did not include ${event} for ${actionId}; observed ${JSON.stringify(observed)}`
      );
    }
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
    auth: createBetterAuthAdapter(config, dbClient_.db),
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
