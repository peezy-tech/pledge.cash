import { describe, expect, test } from "bun:test";

import { loadConfig } from "../src/config";

const baseEnv = {
  BETTER_AUTH_SECRET: "sentinel-test-secret-at-least-32-characters",
  BETTER_AUTH_URL: "https://api.pledge.cash",
  DATABASE_URL: "postgres://sentinel:sentinel@127.0.0.1:5432/sentinel",
  PEEZY_IDENTITY_APP_CLIENT_SECRET: "app-secret-at-least-32-characters",
  PEEZY_IDENTITY_CLIENT_ID: "pledge-cash",
  PEEZY_IDENTITY_OIDC_CLIENT_SECRET: "oidc-secret-at-least-32-characters",
  PEEZY_IDENTITY_URL: "https://identity.peezy.tech",
  SENTINEL_TRUSTED_PROXY_IPS: "127.0.0.1,::1",
  SENTINEL_WEB_ORIGIN: "http://localhost:5173"
};

describe("identity service config", () => {
  test("loads only the identity runtime boundary", () => {
    const config = loadConfig({
      ...baseEnv,
      SENTINEL_CHAIN_IDS: "31337",
      SENTINEL_HARNESS: "codex",
      TELEGRAM_BOT_TOKEN: "obsolete"
    });

    expect(config).toEqual({
      auth: {
        baseUrl: "https://api.pledge.cash",
        identity: {
          appClientSecret: baseEnv.PEEZY_IDENTITY_APP_CLIENT_SECRET,
          baseUrl: baseEnv.PEEZY_IDENTITY_URL,
          clientId: baseEnv.PEEZY_IDENTITY_CLIENT_ID,
          oidcClientSecret: baseEnv.PEEZY_IDENTITY_OIDC_CLIENT_SECRET
        },
        secret: baseEnv.BETTER_AUTH_SECRET
      },
      databaseUrl: baseEnv.DATABASE_URL,
      port: 8787,
      trustedProxyIps: ["127.0.0.1", "::1"],
      webOrigin: "http://localhost:5173"
    });
  });

  test("requires every shared Identity setting", () => {
    for (const omitted of [
      "PEEZY_IDENTITY_URL",
      "PEEZY_IDENTITY_CLIENT_ID",
      "PEEZY_IDENTITY_APP_CLIENT_SECRET",
      "PEEZY_IDENTITY_OIDC_CLIENT_SECRET"
    ] as const) {
      const incomplete: Record<string, string | undefined> = { ...baseEnv };
      delete incomplete[omitted];
      expect(() => loadConfig(incomplete)).toThrow();
    }
  });

  test("requires an explicit trusted HTTPS edge for shared Identity client limits", () => {
    const { SENTINEL_TRUSTED_PROXY_IPS: _, ...withoutTrustedProxy } = baseEnv;
    expect(() =>
      loadConfig({
        ...withoutTrustedProxy,
        PEEZY_IDENTITY_APP_CLIENT_SECRET: baseEnv.PEEZY_IDENTITY_APP_CLIENT_SECRET,
        PEEZY_IDENTITY_CLIENT_ID: baseEnv.PEEZY_IDENTITY_CLIENT_ID,
        PEEZY_IDENTITY_OIDC_CLIENT_SECRET: baseEnv.PEEZY_IDENTITY_OIDC_CLIENT_SECRET,
        PEEZY_IDENTITY_URL: baseEnv.PEEZY_IDENTITY_URL
      })
    ).toThrow("SENTINEL_TRUSTED_PROXY_IPS must identify the HTTPS edge in shared Identity mode");
    expect(() =>
      loadConfig({ ...baseEnv, SENTINEL_TRUSTED_PROXY_IPS: "127.0.0.1,proxy" })
    ).toThrow("Invalid IP address in SENTINEL_TRUSTED_PROXY_IPS: proxy");
  });

  test("requires secure bare origins", () => {
    expect(() =>
      loadConfig({ ...baseEnv, PEEZY_IDENTITY_URL: "https://identity.peezy.tech/oauth" })
    ).toThrow("PEEZY_IDENTITY_URL must be an origin");
    expect(() =>
      loadConfig({ ...baseEnv, PEEZY_IDENTITY_URL: "http://identity.peezy.tech" })
    ).toThrow("PEEZY_IDENTITY_URL must use HTTPS outside loopback development");
    expect(() => loadConfig({ ...baseEnv, BETTER_AUTH_URL: "https://api.pledge.cash/auth" })).toThrow(
      "BETTER_AUTH_URL must be an origin"
    );
    expect(() => loadConfig({ ...baseEnv, SENTINEL_WEB_ORIGIN: "https://pledge.cash/account" })).toThrow(
      "SENTINEL_WEB_ORIGIN must be an origin"
    );
  });

  test("requires distinct strong Identity secrets and a valid client id", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        PEEZY_IDENTITY_APP_CLIENT_SECRET: "shared-secret-at-least-32-characters",
        PEEZY_IDENTITY_CLIENT_ID: "pledge:cash",
        PEEZY_IDENTITY_OIDC_CLIENT_SECRET: "shared-secret-at-least-32-characters",
        PEEZY_IDENTITY_URL: "https://identity.peezy.tech"
      })
    ).toThrow();
  });
});
