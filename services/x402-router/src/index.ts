import {
  hyperEvmTestnet,
} from "@pledge.cash/sdk";
import {
  createPublicClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createIntentExecutor } from "x402-hl/intents/server";
import { createRouterApi } from "./api/server";
import { loadConfig, type X402RouterConfig } from "./config";
import {
  createDbClient,
  PostgresAdapterOperationStore,
  PostgresIntentExecutionStore,
  PostgresQuoteRepository,
  PostgresSupportRepository,
} from "./db";
import { resolveRouterDeployment } from "./deployment";
import { DurableHyperCoreRefundAdapter } from "./execution/hypercore-refund";
import { HyperCoreRefundInventory } from "./execution/hypercore-inventory";
import { DurableHyperEvmExecutor } from "./execution/hyperevm";
import {
  RouterRecoveryWorker,
  safeRecoveryStaleAfterMs,
  startRouterRecoveryLoop,
} from "./execution/recovery";
import {
  createMarketplaceExecutionPolicy,
  createMarketplaceSimulation,
} from "./execution/policy";
import { DurableX402SettlementJournal } from "./execution/settlement-journal";
import { MarketplaceQuoteService } from "./quotes/service";
import { CanonicalMarketplaceReader } from "./quotes/canonical";
import { readRouterReadiness } from "./readiness";
import { CanonicalSupportAuthorityReader } from "./support/authority";
import { RecurringSupportExecutionGuard } from "./support/execution";
import { RecurringSupportService } from "./support/service";
import {
  createLocalHyperliquidTestnetFacilitator,
  createX402ServerLayer,
  X402MarketplacePaymentSaga,
  X402PaymentQuoteBuilder,
} from "./x402";

const SUPPORT_CHALLENGE_PRUNE_BATCH_SIZE = 100;

export async function startX402Router(
  config: X402RouterConfig = loadConfig(),
) {
  const database = createDbClient(config);
  await database.migrate();

  const publicClient = createPublicClient({
    chain: hyperEvmTestnet,
    transport: http(config.hyperevm.rpcUrl, {
      timeout: 15_000,
      retryCount: 2,
    }),
  });
  const executorAccount = privateKeyToAccount(
    config.hyperevm.executorPrivateKey,
  );
  const refundAccount = privateKeyToAccount(
    config.hyperliquid.refundPrivateKey,
  );
  const quoteRepository = new PostgresQuoteRepository(
    database.sql,
    database.coordinationSql,
  );
  const supportRepository = new PostgresSupportRepository(
    database.sql,
    database.coordinationSql,
  );
  await supportRepository.pruneExpiredChallenges({
    before: new Date(),
    limit: SUPPORT_CHALLENGE_PRUNE_BATCH_SIZE,
  });
  const intentStore = new PostgresIntentExecutionStore(database.sql);
  const operationStore = new PostgresAdapterOperationStore(
    database.sql,
    config.journalEncryptionKey,
  );
  const refundInventory = new HyperCoreRefundInventory(
    config.hyperliquid.refundAccount,
  );
  const deployment = resolveRouterDeployment({
    destinationUsdc: config.hyperevm.destinationUsdc,
    executor: config.hyperevm.executor,
  });
  const canonical = deployment.ready
    ? new CanonicalMarketplaceReader(publicClient, deployment.deployment)
    : undefined;
  const paymentQuoteBuilder = new X402PaymentQuoteBuilder({
    domain: config.intentDomain,
    paymentPayTo: config.hyperliquid.payTo,
    executeResourceUrl: quoteId =>
      `${config.publicOrigin}/v1/quotes/${encodeURIComponent(quoteId)}/execute`,
    serviceName: "pledge.cash marketplace router",
  });
  const liveQuoteService = canonical
    ? new MarketplaceQuoteService(
        canonical,
        quoteRepository,
        paymentQuoteBuilder,
        refundInventory,
        {
          payTo: config.hyperliquid.payTo,
          serviceFeeBps: config.quotes.serviceFeeBps,
          maxSourcePayment: config.quotes.maximumOrderAtomic,
          maxSlippageBps: config.quotes.maximumSlippageBps,
          maxGasCost: config.quotes.maximumGasCostWei,
          quoteTtlSeconds: config.quotes.ttlSeconds,
        },
      )
    : undefined;
  const supportAuthority = deployment.ready
    ? new CanonicalSupportAuthorityReader(publicClient, {
        boardroomFactory: deployment.deployment.boardroomFactory,
        destinationUsdc: deployment.deployment.destinationUsdc,
      })
    : undefined;
  const supportExecution =
    supportAuthority
      ? new RecurringSupportExecutionGuard(
          supportRepository,
          supportAuthority,
        )
      : undefined;

  const facilitator = createLocalHyperliquidTestnetFacilitator();
  const destinationExecutor = new DurableHyperEvmExecutor(
    publicClient,
    executorAccount,
    operationStore,
    quoteRepository,
    config.quotes.maximumGasCostWei,
    config.hyperevm.confirmations,
    config.hyperevm.receiptTimeoutMs,
    config.operationLeaseMs,
  );
  const refundAdapter = new DurableHyperCoreRefundAdapter(
    refundAccount,
    config.hyperliquid.refundAccount,
    facilitator,
    operationStore,
    quoteRepository,
    config.operationLeaseMs,
  );
  const intentExecutor = createIntentExecutor({
    store: intentStore,
    domain: config.intentDomain,
    policy: createMarketplaceExecutionPolicy(
      quoteRepository,
      canonical,
      supportExecution,
    ),
    simulate: createMarketplaceSimulation(
      publicClient,
      config.hyperevm.executor,
      quoteRepository,
    ),
    execute: destinationExecutor.execute,
    refund: refundAdapter.refund,
  });
  const settlementJournal = new DurableX402SettlementJournal(
    operationStore,
    quoteRepository,
    config.operationLeaseMs,
  );
  const paymentLayer = createX402ServerLayer({
    domain: config.intentDomain,
    paymentPayTo: config.hyperliquid.payTo,
    facilitator,
    executor: intentExecutor,
    settlementJournal,
  });
  const payments = new X402MarketplacePaymentSaga(paymentLayer);
  const support =
    liveQuoteService && supportAuthority
      ? new RecurringSupportService(
          supportRepository,
          supportAuthority,
          liveQuoteService,
          quoteRepository,
          intentStore,
          payments,
          {
            destinationUsdc: config.hyperevm.destinationUsdc,
            publicOrigin: config.publicOrigin,
          },
        )
      : undefined;
  const recoveryStaleAfterMs = safeRecoveryStaleAfterMs({
    operationLeaseMs: config.operationLeaseMs,
    receiptTimeoutMs: config.hyperevm.receiptTimeoutMs,
  });
  const recoveryWorker = new RouterRecoveryWorker({
    quotes: quoteRepository,
    intents: intentStore,
    support: supportRepository,
    journal: settlementJournal,
    payments,
    executor: intentExecutor,
    execution: destinationExecutor,
    refund: refundAdapter,
    staleAfterMs: recoveryStaleAfterMs,
    onError({ phase, id, error }) {
      console.error("x402_router_recovery_failed", {
        phase,
        id,
        error: error instanceof Error ? error.name : "unknown",
      });
    },
  });
  const recoveryLoop = startRouterRecoveryLoop({
    worker: recoveryWorker,
    intervalMs: Math.max(5_000, config.operationLeaseMs),
    onResult(result) {
      if (
        result.prunedChallenges > 0
        || result.recovered > 0
        || result.failed > 0
      ) {
        console.info("x402_router_recovery_pass", result);
      }
    },
  });

  const app = createRouterApi({
    webOrigin: config.webOrigin,
    identity: {
      application: config.intentDomain.application,
      gateway: config.intentDomain.gateway,
      destinationUsdc: config.hyperevm.destinationUsdc,
    },
    quotes: {
      async create(request) {
        if (!liveQuoteService) {
          throw new Error(
            deployment.ready
              ? "Marketplace quote service is unavailable."
              : deployment.reason,
          );
        }
        return liveQuoteService.create(request);
      },
    },
    quoteRepository,
    payments,
    orders: intentStore,
    ...(support ? { support } : {}),
    readiness: () =>
      readRouterReadiness({
        deployment,
        publicClient,
        executor: config.hyperevm.executor,
        minimumGasBalance: config.hyperevm.minimumGasBalanceWei,
        minimumRefundReserve:
          config.hyperliquid.minimumRefundReserveAtomic,
        refundInventory,
        databasePing: async () => {
          await database.sql`select 1`;
        },
        canonicalReady: async () => {
          if (!canonical) {
            throw new Error(
              deployment.ready
                ? "Canonical deployment is unavailable."
                : deployment.reason,
            );
          }
          await canonical.assertReady();
        },
        hasManualIntervention: () => operationStore.hasManualIntervention(),
      }),
  });

  const server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
  });
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    recoveryLoop.stop();
    server.stop(true);
    await database.close();
  };
  const shutdown = (): void => {
    void close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.info("x402_router_started", {
    port: server.port,
    sourceNetwork: "hyperliquid:testnet",
    destinationNetwork: "eip155:998",
    fundedSettlementEnabled: payments.fundedSettlementEnabled,
    deploymentReady: deployment.ready,
  });

  return {
    app,
    close,
    config,
    deployment,
    intentExecutor,
    operationStore,
    paymentLayer,
    quoteRepository,
    recoveryWorker,
    server,
  };
}

if (import.meta.main) {
  await startX402Router();
}

export * from "./api/dto";
export * from "./api/server";
export {
  loadConfig,
  x402RouterEnvSchema,
  type X402RouterConfig,
  type X402RouterEnv,
} from "./config";
export * from "./deployment";
export * from "./domain";
export * from "./support/domain";
export * from "./support/dto";
export * from "./support/execution";
export * from "./support/schedule";
export * from "./support/service";
export * from "./x402";
