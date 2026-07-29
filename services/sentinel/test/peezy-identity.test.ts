import { expect, test } from "bun:test";

import { createPeezyIdentityAuthAdapter } from "../src/api/peezy-identity";
import type { Config } from "../src/config";
import type { SentinelDb } from "../src/db/client";

const config = {
  auth: {
    baseUrl: "http://localhost:8787",
    identity: {
      appClientSecret: "app-secret-at-least-32-characters",
      baseUrl: "https://identity.peezy.tech",
      clientId: "pledge-cash",
      oidcClientSecret: "oidc-secret-at-least-32-characters"
    },
    secret: "sentinel-secret-at-least-32-characters",
    socialProviders: {}
  },
  webOrigin: "http://localhost:5173"
} satisfies Pick<Config, "auth" | "webOrigin">;

test("aborts stalled Identity provider metadata requests at the application deadline", async () => {
  const signals: AbortSignal[] = [];
  const stalledFetcher = (
    _input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    if (init?.signal !== null && init?.signal !== undefined) {
      signals.push(init.signal);
    }
    return new Promise(() => {});
  };
  const adapter = createPeezyIdentityAuthAdapter(
    config,
    {} as SentinelDb,
    stalledFetcher,
    { metadataTimeoutMs: 10 }
  );

  const results = await Promise.allSettled([
    adapter.getProviders?.("00000000-0000-4000-8000-000000000001"),
    adapter.getSocialProviders?.()
  ]);

  expect(results).toHaveLength(2);
  for (const result of results) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toBeInstanceOf(Error);
      expect((result.reason as Error).message).toBe(
        "Identity metadata request timed out after 10ms"
      );
    }
  }
  expect(signals).toHaveLength(2);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});
