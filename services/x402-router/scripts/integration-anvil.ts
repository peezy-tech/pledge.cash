import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import {
  PAYMENT_IDENTIFIER,
  appendPaymentIdentifierToExtensions,
} from "@x402/extensions/payment-identifier";
import { erc20Abi } from "@pledge.cash/sdk";
import postgres from "postgres";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ExactHyperliquidScheme as ExactHyperliquidClient } from "x402-hl/exact/client";
import {
  hashPaymentRequirements,
  signExecutionIntent,
  X402_HL_INTENTS_EXTENSION,
  type ExecutionIntentDomain,
} from "x402-hl/intents";
import { createIntentExecutor } from "x402-hl/intents/server";

import {
  createDbClient,
  PostgresAdapterOperationStore,
  PostgresIntentExecutionStore,
  PostgresQuoteRepository,
  type X402RouterDbClient,
} from "../src/db";
import { DurableHyperCoreRefundAdapter } from "../src/execution/hypercore-refund";
import { DurableHyperEvmExecutor } from "../src/execution/hyperevm";
import {
  createMarketplaceExecutionPolicy,
  createMarketplaceSimulation,
} from "../src/execution/policy";
import { DurableX402SettlementJournal } from "../src/execution/settlement-journal";
import { CanonicalMarketplaceReader } from "../src/quotes/canonical";
import { MarketplaceQuoteService } from "../src/quotes/service";
import {
  createX402ServerLayer,
  X402PaymentQuoteBuilder,
  type X402Facilitator,
} from "../src/x402";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "../../..");
const contractsDir = join(repoRoot, "packages/contracts");
const artifactPath = join(
  contractsDir,
  "out/X402RouterIntegrationHarness.sol/X402RouterIntegrationHarness.json",
);
const chainId = 998;
const executorKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const payerKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const refundKey =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;
const journalKey = `0x${"93".repeat(32)}` as Hex;
const leaseMs = 30_000;

type TempDatabase = {
  adminSql: postgres.Sql;
  databaseUrl: string;
  name: string;
};

type HarnessArtifact = {
  abi: Abi;
  bytecode: { object: Hex };
};

const fixtureAbi = parseAbi([
  "function paymentToken() view returns (address)",
  "function shareToken() view returns (address)",
  "function boardroom() view returns (address)",
  "function boardroomFactory() view returns (address)",
  "function pool() view returns (address)",
  "function ammRouter() view returns (address)",
  "function ammFactory() view returns (address)",
  "function distributionFactory() view returns (address)",
  "function fixedPriceSale() view returns (address)",
  "function setSwapsEnabled(bool enabled)",
]);
const ammHarnessAbi = parseAbi(["function swapCount() view returns (uint256)"]);
const saleHarnessAbi = parseAbi(["function purchaseCount() view returns (uint256)"]);

const executor = privateKeyToAccount(executorKey);
const payer = privateKeyToAccount(payerKey);
const refundSigner = privateKeyToAccount(refundKey);
const domain = {
  application: "integration.pledge.cash/x402-router/v1",
  gateway: executor.address,
} satisfies ExecutionIntentDomain;

let anvil: ChildProcessWithoutNullStreams | undefined;
let database: X402RouterDbClient | undefined;
let tempDatabase: TempDatabase | undefined;

try {
  const port = await getAvailablePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const chain = defineChain({
    id: chainId,
    name: "x402 router integration",
    nativeCurrency: { decimals: 18, name: "Test Ether", symbol: "ETH" },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const executorClient = createWalletClient({
    account: executor,
    chain,
    transport: http(rpcUrl),
  });

  anvil = spawn(
    "anvil",
    ["--host", "127.0.0.1", "--port", String(port), "--chain-id", String(chainId), "--silent"],
    { cwd: repoRoot, env: process.env },
  );
  await waitForRpc(anvil, publicClient);
  await runCommand(
    "build x402 integration contracts",
    "forge",
    ["build", "test/integration/X402RouterIntegrationHarness.sol"],
    contractsDir,
  );

  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as HarnessArtifact;
  const deploymentHash = await executorClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
  });
  const deploymentReceipt = await publicClient.waitForTransactionReceipt({
    hash: deploymentHash,
  });
  const fixture = deploymentReceipt.contractAddress;
  if (!fixture) throw new Error("integration fixture deployment did not return an address");

  const readFixtureAddress = async (
    functionName:
      | "paymentToken"
      | "shareToken"
      | "boardroom"
      | "boardroomFactory"
      | "pool"
      | "ammRouter"
      | "ammFactory"
      | "distributionFactory"
      | "fixedPriceSale",
  ): Promise<Address> =>
    getAddress(
      await publicClient.readContract({
        address: fixture,
        abi: fixtureAbi,
        functionName,
      }),
    );
  const [
    paymentToken,
    shareToken,
    boardroom,
    boardroomFactory,
    pool,
    ammRouter,
    ammFactory,
    distributionFactory,
    fixedPriceSale,
  ] = await Promise.all([
    readFixtureAddress("paymentToken"),
    readFixtureAddress("shareToken"),
    readFixtureAddress("boardroom"),
    readFixtureAddress("boardroomFactory"),
    readFixtureAddress("pool"),
    readFixtureAddress("ammRouter"),
    readFixtureAddress("ammFactory"),
    readFixtureAddress("distributionFactory"),
    readFixtureAddress("fixedPriceSale"),
  ]);

  await submit(
    publicClient,
    executorClient.writeContract({
      address: paymentToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [ammRouter, 10_000_000n * 10n ** 6n],
    }),
    "approve AMM inventory",
  );
  await submit(
    publicClient,
    executorClient.writeContract({
      address: paymentToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [fixedPriceSale, 10_000_000n * 10n ** 6n],
    }),
    "approve fixed-price inventory",
  );

  tempDatabase = await createTempDatabase();
  database = createDbClient(tempDatabase.databaseUrl);
  await database.migrate();

  const quoteRepository = new PostgresQuoteRepository(
    database.sql,
    database.coordinationSql,
  );
  const operationStore = new PostgresAdapterOperationStore(database.sql, journalKey);
  const intentStore = new PostgresIntentExecutionStore(database.sql);
  const canonical = new CanonicalMarketplaceReader(publicClient as PublicClient, {
    chainId,
    ammFactory: getAddress(ammFactory),
    ammRouter: getAddress(ammRouter),
    distributionFactory: getAddress(distributionFactory),
    boardroomFactory: getAddress(boardroomFactory),
    destinationUsdc: getAddress(paymentToken),
    executor: executor.address,
  });
  await canonical.assertReady();

  let nextId = 0;
  const quoteService = new MarketplaceQuoteService(
    canonical,
    quoteRepository,
    new X402PaymentQuoteBuilder({
      domain,
      paymentPayTo: refundSigner.address,
      executeResourceUrl: id => `https://router.example.invalid/v1/quotes/${id}/execute`,
    }),
    { async availableAtomicUsdc() { return 1_000_000_000_000_000n; } },
    {
      payTo: refundSigner.address,
      serviceFeeBps: 25,
      maxSourcePayment: 10_000_000_000n,
      maxSlippageBps: 100,
      maxGasCost: 10_000_000_000_000_000n,
      quoteTtlSeconds: 300,
    },
    () => Date.now(),
    () => `integration-${String(++nextId).padStart(24, "0")}`,
  );

  const facilitator = createMockFacilitator();
  const createRuntime = () => {
    const destinationExecutor = new DurableHyperEvmExecutor(
      publicClient as PublicClient,
      executor,
      operationStore,
      quoteRepository,
      10_000_000_000_000_000n,
      1,
      15_000,
      leaseMs,
    );
    const refundAdapter = new DurableHyperCoreRefundAdapter(
      refundSigner,
      refundSigner.address,
      facilitator,
      operationStore,
      quoteRepository,
      leaseMs,
    );
    const intentExecutor = createIntentExecutor({
      store: intentStore,
      domain,
      policy: createMarketplaceExecutionPolicy(quoteRepository, canonical),
      simulate: createMarketplaceSimulation(
        publicClient as PublicClient,
        executor.address,
        quoteRepository,
      ),
      execute: destinationExecutor.execute,
      refund: refundAdapter.refund,
    });
    return createX402ServerLayer({
      domain,
      paymentPayTo: refundSigner.address,
      installedX402HlVersion: "0.2.2",
      facilitator,
      executor: intentExecutor,
      settlementJournal: new DurableX402SettlementJournal(
        operationStore,
        quoteRepository,
        leaseMs,
      ),
    });
  };

  const ammQuote = await quoteService.create({
    kind: "amm_swap",
    chainId,
    boardroom: getAddress(boardroom),
    pool: getAddress(pool),
    tokenIn: getAddress(paymentToken),
    tokenOut: getAddress(shareToken),
    amountIn: "1000000",
    maxSlippageBps: 50,
    payer: payer.address,
    recipient: payer.address,
    refundAddress: payer.address,
  });
  const ammPayload = await signPayment(ammQuote);
  const layerBeforeRestart = createRuntime();
  const ammResult = await layerBeforeRestart.settleAndExecute({
    quote: marketplaceQuoteForLayer(ammQuote),
    paymentPayload: ammPayload,
  });
  assertEqual(ammResult.execution.status, "executed", "AMM execution status");
  assertEqual(
    await publicClient.readContract({
      address: ammRouter,
      abi: ammHarnessAbi,
      functionName: "swapCount",
    }),
    1n,
    "AMM execution count",
  );

  const layerAfterRestart = createRuntime();
  const replay = await layerAfterRestart.settleAndExecute({
    quote: marketplaceQuoteForLayer(ammQuote),
    paymentPayload: ammPayload,
  });
  assertEqual(replay.execution.status, "executed", "restart replay status");
  assertEqual(
    await publicClient.readContract({
      address: ammRouter,
      abi: ammHarnessAbi,
      functionName: "swapCount",
    }),
    1n,
    "restart replay must not execute twice",
  );

  const saleQuote = await quoteService.create({
    kind: "fixed_price_sale",
    chainId,
    boardroom: getAddress(boardroom),
    sale: getAddress(fixedPriceSale),
    shareAmount: "1000000000000000000",
    maxSlippageBps: 25,
    payer: payer.address,
    recipient: payer.address,
    refundAddress: payer.address,
  });
  const saleResult = await layerAfterRestart.settleAndExecute({
    quote: marketplaceQuoteForLayer(saleQuote),
    paymentPayload: await signPayment(saleQuote),
  });
  assertEqual(saleResult.execution.status, "executed", "fixed-price execution status");
  assertEqual(
    await publicClient.readContract({
      address: fixedPriceSale,
      abi: saleHarnessAbi,
      functionName: "purchaseCount",
    }),
    1n,
    "fixed-price execution count",
  );

  const refundQuote = await quoteService.create({
    kind: "amm_swap",
    chainId,
    boardroom: getAddress(boardroom),
    pool: getAddress(pool),
    tokenIn: getAddress(paymentToken),
    tokenOut: getAddress(shareToken),
    amountIn: "2000000",
    maxSlippageBps: 50,
    payer: payer.address,
    recipient: payer.address,
    refundAddress: payer.address,
  });
  await submit(
    publicClient,
    executorClient.writeContract({
      address: fixture,
      abi: fixtureAbi,
      functionName: "setSwapsEnabled",
      args: [false],
    }),
    "disable AMM after quote",
  );
  const refundResult = await layerAfterRestart.settleAndExecute({
    quote: marketplaceQuoteForLayer(refundQuote),
    paymentPayload: await signPayment(refundQuote),
  });
  assertEqual(refundResult.execution.status, "refunded", "failed execution refund status");
  assertEqual(
    refundResult.execution.paymentAmount,
    refundQuote.sourcePayment.amount,
    "full source payment refund",
  );
  assertEqual(facilitator.refundSettlements, 1, "refund settlement count");
  assertEqual(
    await publicClient.readContract({
      address: ammRouter,
      abi: ammHarnessAbi,
      functionName: "swapCount",
    }),
    1n,
    "failed simulation must not submit a destination transaction",
  );

  console.info(
    JSON.stringify(
      {
        ok: true,
        chainId,
        fixture,
        database: tempDatabase.name,
        proofs: {
          ammExecution: ammResult.execution.executionTransaction,
          duplicateReplay: replay.execution.executionTransaction,
          fixedPriceExecution: saleResult.execution.executionTransaction,
          fullRefund: refundResult.execution.refundTransaction,
        },
        sourceSettlements: facilitator.sourceSettlements,
        refundSettlements: facilitator.refundSettlements,
      },
      null,
      2,
    ),
  );
} finally {
  await database?.close();
  if (tempDatabase) await dropTempDatabase(tempDatabase);
  if (anvil) await stopChild(anvil);
}

function createMockFacilitator(): X402Facilitator & {
  sourceSettlements: number;
  refundSettlements: number;
} {
  let sourceSettlements = 0;
  let refundSettlements = 0;
  return {
    get sourceSettlements() { return sourceSettlements; },
    get refundSettlements() { return refundSettlements; },
    async verify(_payload: PaymentPayload, requirements: PaymentRequirements) {
      return {
        isValid: true,
        payer:
          getAddress(requirements.payTo) === payer.address
            ? refundSigner.address
            : payer.address,
      };
    },
    async settle(_payload: PaymentPayload, requirements: PaymentRequirements) {
      const isRefund = getAddress(requirements.payTo) === payer.address;
      if (isRefund) refundSettlements += 1;
      else sourceSettlements += 1;
      return {
        success: true,
        transaction: keccak256(
          stringToHex(
            `${isRefund ? "refund" : "source"}:${isRefund ? refundSettlements : sourceSettlements}`,
          ),
        ),
        network: requirements.network,
        payer: isRefund ? refundSigner.address : payer.address,
        amount: requirements.amount,
      } satisfies SettleResponse;
    },
  };
}

async function signPayment(quote: Awaited<ReturnType<MarketplaceQuoteService["create"]>>) {
  const base = await new ExactHyperliquidClient(payer).createPaymentPayload(
    2,
    quote.paymentRequirements,
  );
  const signedIntent = await signExecutionIntent(quote.intentQuote.intent, payer, {
    paymentRequirements: quote.paymentRequirements,
  });
  const paymentIdentifierDeclaration =
    quote.paymentRequired.extensions?.[PAYMENT_IDENTIFIER];
  if (!paymentIdentifierDeclaration) {
    throw new Error("quote did not declare the required payment identifier");
  }
  const extensions = {
    [PAYMENT_IDENTIFIER]: structuredClone(paymentIdentifierDeclaration),
    [X402_HL_INTENTS_EXTENSION]: signedIntent,
  };
  appendPaymentIdentifierToExtensions(extensions, quote.paymentId);
  return {
    ...base,
    accepted: structuredClone(quote.paymentRequirements),
    extensions,
  } satisfies PaymentPayload;
}

function marketplaceQuoteForLayer(
  quote: Awaited<ReturnType<MarketplaceQuoteService["create"]>>,
) {
  return {
    schemaVersion: 1 as const,
    id: quote.id,
    paymentId: quote.paymentId,
    domain,
    intentQuote: quote.intentQuote,
    intent: quote.intentQuote.intent,
    intentTemplateHash: quote.intentTemplateHash,
    paymentRequirements: quote.paymentRequirements,
    paymentRequirementsHash: hashPaymentRequirements(quote.paymentRequirements),
    paymentRequired: quote.paymentRequired,
    createdAt: quote.createdAt.toISOString(),
    expiresAt: quote.expiresAt.toISOString(),
  };
}

async function createTempDatabase(): Promise<TempDatabase> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the x402 router Anvil integration");
  }
  const name = `x402_router_${randomBytes(5).toString("hex")}`;
  const adminUrl = new URL(databaseUrl);
  const tempUrl = new URL(databaseUrl);
  tempUrl.pathname = `/${name}`;
  const adminSql = postgres(adminUrl.toString(), { max: 1 });
  await adminSql.unsafe(`CREATE DATABASE ${name}`);
  return { adminSql, databaseUrl: tempUrl.toString(), name };
}

async function dropTempDatabase(temp: TempDatabase): Promise<void> {
  try {
    await temp.adminSql.unsafe(`DROP DATABASE IF EXISTS ${temp.name} WITH (FORCE)`);
  } finally {
    await temp.adminSql.end({ timeout: 5 });
  }
}

async function submit(
  publicClient: ReturnType<typeof createPublicClient>,
  pending: Promise<Hex>,
  label: string,
): Promise<void> {
  const hash = await pending;
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
}

async function runCommand(
  label: string,
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<void> {
  const child = spawn(command, [...args], { cwd, env: process.env });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) {
    throw new Error(`${label} failed:\n${output.split("\n").slice(-20).join("\n")}`);
  }
}

async function waitForRpc(
  child: ChildProcessWithoutNullStreams,
  publicClient: ReturnType<typeof createPublicClient>,
): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Anvil exited before becoming ready");
    try {
      if ((await publicClient.getChainId()) === chainId) return;
    } catch {
      // Retry until the bounded startup deadline.
    }
    await sleep(250);
  }
  throw new Error("Anvil did not become ready within 20 seconds");
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>(resolve => child.once("close", () => resolve())),
    sleep(5_000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(error => {
        if (error) return reject(error);
        if (typeof address === "object" && address) return resolve(address.port);
        reject(new Error("Unable to reserve an Anvil port"));
      });
    });
  });
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}
