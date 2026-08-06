import { randomBytes } from "node:crypto";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { verifyMessage, type Address, type Hex } from "viem";

import { createAuthRoutes, jsonError, type ApiEnv, type SentinelApiDeps } from "./auth";
import { HealthResponseSchema } from "./dto";
import { createWalletRoutes } from "./routes/wallets";

function randomSiweNonce(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function withDefaults(deps: SentinelApiDeps): SentinelApiDeps {
  return {
    ...deps,
    generateNonce: deps.generateNonce ?? (() => randomSiweNonce(16)),
    verifySiweSignature:
      deps.verifySiweSignature ??
      (({ address, message, signature }) =>
        verifyMessage({
          address: address as Address,
          message,
          signature: signature as Hex
        }))
  };
}

export function createApp(inputDeps: SentinelApiDeps): Hono<ApiEnv> {
  const deps = withDefaults(inputDeps);
  const app = new Hono<ApiEnv>();

  app.use(
    "*",
    cors({
      credentials: true,
      origin: deps.config.webOrigin
    })
  );

  app.get("/health", async (c) => {
    await deps.store.ping();
    const response = HealthResponseSchema.parse({ database: "ok", ok: true });
    return c.json(response);
  });

  app.route("/auth", createAuthRoutes(deps));
  app.on(["GET", "POST"], "/auth/legacy/siwe/*", (c) =>
    jsonError(c, 404, "Not found")
  );
  app.on(["GET", "POST"], "/auth/*", (c) =>
    deps.auth.handler(c.req.raw, {
      ...(c.env?.clientIp === undefined ? {} : { clientIp: c.env.clientIp })
    })
  );
  app.route("/wallets", createWalletRoutes(deps));

  app.notFound((c) => jsonError(c, 404, "Not found"));
  app.onError((error, c) => {
    console.error(error);
    return jsonError(c, 500, "Internal server error");
  });

  return app;
}

export type { ApiConfig, AuthAdapter, SentinelApiDeps, SentinelApiStore } from "./auth";
