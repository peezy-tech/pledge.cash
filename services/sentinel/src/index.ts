import { setTimeout as sleep } from "node:timers/promises";

import { createHarnessAdapter } from "./analysis/adapter";
import {
  createBetterAuthAdapter,
  createPledgeCashSiweVerifier,
  WALLET_LINK_SIWE_STATEMENT
} from "./api/better-auth";
import { createDrizzleBoardroomControlStore } from "./api/boardroom-control-store";
import { createApp } from "./api/server";
import { createDrizzleApiStore } from "./api/store";
import { createConfiguredBoardroomControlChainReader } from "./chain/boardroom-control";
import { runWatcherOnce, type WatcherActionEventHandler } from "./chain/watcher";
import { loadConfig, type Config, type SentinelChainConfig } from "./config";
import { createDbClient, type SentinelDbClient } from "./db/client";
import { startDispatcher, type DispatcherDb } from "./notify/dispatcher";
import { startFanoutSweeps, type FanoutDb } from "./notify/fanout";
import type { NotificationChannel } from "./notify/types";
import { createTelegramBot, type TelegramBotLike, type TelegramDb } from "./notify/channels/telegram";
import { createTwitterChannel } from "./notify/channels/twitter";
import { createActionPipeline } from "./pipeline";

export { loadConfig, sentinelEnvSchema } from "./config";
export type { Config, HarnessName, SentinelChainConfig, SentinelEnv } from "./config";
export type {
  ActionEvent,
  ActionPipelineEvent,
  ActionStatus,
  AnalysisResult,
  BoardroomRow,
  BoardroomStatus,
  ChannelRow,
  ChannelType,
  DecodeStatus,
  NotificationEvent,
  OutboxRow,
  ScheduledOperationRow,
  RenderedMessage,
  RiskAssessment,
  RiskFinding,
  Severity,
  StoredCall,
  UserRow
} from "./types";

type Logger = Pick<Console, "error" | "log" | "warn">;

type BunServer = {
  readonly hostname: string;
  readonly port: number;
  stop(force?: boolean): void;
};

declare const Bun: {
  serve(options: { fetch(request: Request): Response | Promise<Response>; port: number }): BunServer;
};

export type SentinelRuntime = {
  readonly db: SentinelDbClient;
  readonly port: number;
  stop(): Promise<void>;
};

export type StartSentinelOptions = {
  readonly config?: Config;
  readonly logger?: Logger;
  readonly signal?: AbortSignal;
};

type WatcherHandle = {
  readonly done: Promise<void>;
  stop(): void;
};

export async function startSentinel(options: StartSentinelOptions = {}): Promise<SentinelRuntime> {
  const logger = options.logger ?? console;
  const config = options.config ?? loadConfig();
  const dbClient = createDbClient(config);
  await dbClient.migrate();

  const adapter = createHarnessAdapter(config);
  const pipeline = createActionPipeline({
    ...(adapter === undefined ? {} : { adapter }),
    config,
    db: dbClient.db,
    logger
  });
  const watcherHandles = config.chains.map((chain) =>
    startWatcherLoop({
      chain,
      config,
      dbClient,
      handleActionEvent: pipeline.handle,
      logger,
      ...(options.signal === undefined ? {} : { signal: options.signal })
    })
  );
  const { bots, channels } = startNotificationChannels(config, dbClient, logger);
  const dispatcher =
    channels.length === 0
      ? undefined
      : startDispatcher({
          channels,
          db: dbClient.db as unknown as DispatcherDb,
          renderOptions: {
            explorerUrls: Object.fromEntries(
              config.chains.map((chain) => [chain.chainId, chain.explorerUrl])
            ),
            webOrigin: config.webOrigin
          }
        });
  const fanoutSweeps = startFanoutSweeps({
    db: dbClient.db as unknown as FanoutDb,
    logger,
    reminderHoursBeforeEta: config.reminderHoursBeforeEta,
    twitterEnabled: config.twitter.enabled
  });
  const app = createApp({
    auth: createBetterAuthAdapter(config, dbClient.db),
    boardroomControl: {
      chain: createConfiguredBoardroomControlChainReader(config),
      store: createDrizzleBoardroomControlStore(dbClient.db)
    },
    config,
    store: createDrizzleApiStore(dbClient.db),
    verifySiweSignature: createPledgeCashSiweVerifier(config, [WALLET_LINK_SIWE_STATEMENT])
  });
  const server = Bun.serve({ fetch: app.fetch, port: config.port });

  logger.log(`Sentinel listening on ${server.hostname}:${server.port}`);

  return {
    db: dbClient,
    port: server.port,
    async stop() {
      for (const watcher of watcherHandles) {
        watcher.stop();
      }
      await Promise.allSettled(watcherHandles.map((watcher) => watcher.done));
      dispatcher?.stop();
      fanoutSweeps.stop();
      for (const bot of bots) {
        bot.stop?.();
      }
      server.stop(true);
      await dbClient.close();
    }
  };
}

if (import.meta.main) {
  const runtime = await startSentinel();
  const shutdown = async () => {
    await runtime.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

function startWatcherLoop(input: {
  readonly chain: SentinelChainConfig;
  readonly config: Config;
  readonly dbClient: SentinelDbClient;
  readonly handleActionEvent: WatcherActionEventHandler;
  readonly logger: Logger;
  readonly signal?: AbortSignal;
}): WatcherHandle {
  const controller = new AbortController();
  const abort = () => controller.abort();
  input.signal?.addEventListener("abort", abort, { once: true });

  const done = superviseWatcher({
    ...input,
    signal: controller.signal
  }).finally(() => input.signal?.removeEventListener("abort", abort));

  return {
    done,
    stop() {
      controller.abort();
    }
  };
}

async function superviseWatcher(input: {
  readonly chain: SentinelChainConfig;
  readonly config: Config;
  readonly dbClient: SentinelDbClient;
  readonly handleActionEvent: WatcherActionEventHandler;
  readonly logger: Logger;
  readonly signal: AbortSignal;
}): Promise<void> {
  while (!input.signal.aborted) {
    try {
      await runWatcherOnce(input.chain.chainId, {
        chain: input.chain,
        config: input.config,
        db: input.dbClient.db,
        onActionEvent: input.handleActionEvent
      });
    } catch (error) {
      if (input.signal.aborted) {
        return;
      }
      input.logger.error(error);
    }

    try {
      await sleep(input.config.pollIntervalMs, undefined, { signal: input.signal });
    } catch (error) {
      if (input.signal.aborted) {
        return;
      }
      throw error;
    }
  }
}

function startNotificationChannels(
  config: Config,
  dbClient: SentinelDbClient,
  logger: Logger
): { readonly bots: TelegramBotLike[]; readonly channels: NotificationChannel[] } {
  const bots: TelegramBotLike[] = [];
  const channels: NotificationChannel[] = [];

  if (config.telegram.botToken !== undefined) {
    const telegram = createTelegramBot(config.telegram, dbClient.db as unknown as TelegramDb);
    bots.push(telegram.bot);
    channels.push(telegram.channel);
    void Promise.resolve(telegram.bot.start?.()).catch((error) => logger.error(error));
  } else {
    logger.warn("TELEGRAM_BOT_TOKEN is not set; Telegram bot and delivery channel are disabled.");
  }

  if (config.twitter.enabled) {
    channels.push(createTwitterChannel(config.twitter));
  }

  if (channels.length === 0) {
    logger.warn("No notification delivery channels are configured; outbox rows will remain pending.");
  }

  return { bots, channels };
}
