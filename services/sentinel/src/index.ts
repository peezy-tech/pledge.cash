import {
  createBetterAuthAdapter,
  createPledgeCashSiweVerifier,
  WALLET_LINK_SIWE_STATEMENT,
} from "./api/better-auth";
import { createDrizzleBoardroomControlStore } from "./api/boardroom-control-store";
import { createApp } from "./api/server";
import { createPeezyIdentityAuthAdapter, discardOAuthTokensForSharedIdentity } from "./api/peezy-identity";
import { createDrizzleApiStore } from "./api/store";
import { createConfiguredBoardroomControlChainReader } from "./chain/boardroom-control";
import { resolveClientIp } from "./client-ip";
import { loadConfig, type Config } from "./config";
import { createDbClient, type SentinelDbClient } from "./db/client";

export { loadConfig, sentinelEnvSchema } from "./config";
export type { Config, SentinelEnv } from "./config";

type Logger = Pick<Console, "log">;

type BunServer = {
  readonly hostname: string;
  readonly port: number;
  requestIP(request: Request): { readonly address: string } | null;
  stop(force?: boolean): void;
};

declare const Bun: {
  serve(options: {
    fetch(request: Request, server: BunServer): Response | Promise<Response>;
    port: number;
  }): BunServer;
};

export type SentinelRuntime = {
  readonly db: SentinelDbClient;
  readonly port: number;
  stop(): Promise<void>;
};

export type StartSentinelOptions = {
  readonly config?: Config;
  readonly logger?: Logger;
};

export async function startSentinel(options: StartSentinelOptions = {}): Promise<SentinelRuntime> {
  const logger = options.logger ?? console;
  const config = options.config ?? loadConfig();
  const dbClient = createDbClient(config);
  await dbClient.migrate();
  if (config.auth.identity !== undefined) {
    await discardOAuthTokensForSharedIdentity(dbClient.db);
  }
  const auth = config.auth.identity === undefined
    ? createBetterAuthAdapter(config, dbClient.db)
    : createPeezyIdentityAuthAdapter(config, dbClient.db);
  const app = createApp({
    auth,
    boardroomControl: {
      chain: createConfiguredBoardroomControlChainReader(config),
      store: createDrizzleBoardroomControlStore(dbClient.db),
    },
    config,
    store: createDrizzleApiStore(dbClient.db),
    verifySiweSignature: createPledgeCashSiweVerifier(config, [WALLET_LINK_SIWE_STATEMENT]),
  });
  const server = Bun.serve({
    fetch(request, bunServer) {
      const peer = bunServer.requestIP(request);
      return app.fetch(request, peer === null ? {} : {
        clientIp: resolveClientIp(request.headers, peer.address, config.trustedProxyIps),
      });
    },
    port: config.port,
  });

  logger.log(`Sentinel identity service listening on ${server.hostname}:${server.port}`);
  return {
    db: dbClient,
    port: server.port,
    async stop() {
      server.stop(true);
      await dbClient.close();
    },
  };
}

if (import.meta.main) {
  const runtime = await startSentinel();
  const shutdown = async (): Promise<void> => {
    await runtime.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
