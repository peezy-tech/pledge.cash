import { describe, expect, test } from "bun:test";

import { loadConfig } from "../src/config";

const baseEnv = {
  BETTER_AUTH_SECRET: "sentinel-test-secret-at-least-32-characters",
  BETTER_AUTH_URL: "https://api.pledge.cash",
  DATABASE_URL: "postgres://sentinel:sentinel@127.0.0.1:5432/sentinel",
  SENTINEL_CHAIN_IDS: "31337",
  SENTINEL_RPC_URL_31337: "http://127.0.0.1:8545",
  SENTINEL_TRUSTED_PROXY_IPS: "127.0.0.1,::1",
  SENTINEL_WEB_ORIGIN: "http://localhost:5173"
};

describe("Sentinel config", () => {
  test("uses an RPC-safe watcher range and rejects wider windows", () => {
    expect(loadConfig(baseEnv).maxBlockRange).toBe(1_000);
    expect(() => loadConfig({ ...baseEnv, SENTINEL_MAX_BLOCK_RANGE: "1001" })).toThrow();
  });

  test("loads Better Auth and complete optional social provider credentials", () => {
    const config = loadConfig({
      ...baseEnv,
      DISCORD_CLIENT_ID: "discord-client",
      DISCORD_CLIENT_SECRET: "discord-secret",
      GITHUB_CLIENT_ID: "github-client",
      GITHUB_CLIENT_SECRET: "github-secret",
      TELEGRAM_OAUTH_CLIENT_ID: "telegram-client",
      TELEGRAM_OAUTH_CLIENT_SECRET: "telegram-secret",
      TWITTER_CLIENT_ID: "twitter-client",
      TWITTER_CLIENT_SECRET: "twitter-secret"
    });

    expect(config.auth).toEqual({
      baseUrl: "https://api.pledge.cash",
      secret: baseEnv.BETTER_AUTH_SECRET,
      socialProviders: {
        discord: { clientId: "discord-client", clientSecret: "discord-secret" },
        github: { clientId: "github-client", clientSecret: "github-secret" },
        telegram: { clientId: "telegram-client", clientSecret: "telegram-secret" },
        twitter: { clientId: "twitter-client", clientSecret: "twitter-secret" }
      }
    });
  });

  test("requires each social provider client id and secret as a pair", () => {
    const incompleteProviders = [
      { GITHUB_CLIENT_ID: "github-client" },
      { APPLE_CLIENT_ID: "apple-client" },
      { DISCORD_CLIENT_SECRET: "discord-secret" },
      { TELEGRAM_OAUTH_CLIENT_ID: "telegram-client" },
      { TWITTER_CLIENT_SECRET: "twitter-secret" }
    ];

    for (const provider of incompleteProviders) {
      expect(() => loadConfig({ ...baseEnv, ...provider })).toThrow(
        /_CLIENT_ID and .*_CLIENT_SECRET must be configured together/
      );
    }
  });

  test("does not configure Google from stale environment variables", () => {
    const config = loadConfig({
      ...baseEnv,
      GOOGLE_CLIENT_ID: "stale-google-client",
      GOOGLE_CLIENT_SECRET: "stale-google-secret"
    });

    expect(config.auth.socialProviders).toEqual({});
  });

  test("loads the shared identity provider only when all confidential values are present", () => {
    const identity = {
      PEEZY_IDENTITY_APP_CLIENT_SECRET: "app-secret-at-least-32-characters",
      PEEZY_IDENTITY_CLIENT_ID: "pledge-cash",
      PEEZY_IDENTITY_OIDC_CLIENT_SECRET: "oidc-secret-at-least-32-characters",
      PEEZY_IDENTITY_URL: "https://identity.peezy.tech"
    };
    expect(loadConfig({ ...baseEnv, ...identity }).auth.identity).toEqual({
      appClientSecret: identity.PEEZY_IDENTITY_APP_CLIENT_SECRET,
      baseUrl: identity.PEEZY_IDENTITY_URL,
      clientId: identity.PEEZY_IDENTITY_CLIENT_ID,
      oidcClientSecret: identity.PEEZY_IDENTITY_OIDC_CLIENT_SECRET
    });

    for (const omitted of Object.keys(identity)) {
      const incomplete = { ...identity };
      delete incomplete[omitted as keyof typeof incomplete];
      expect(() => loadConfig({ ...baseEnv, ...incomplete })).toThrow(
        "PEEZY_IDENTITY_URL, PEEZY_IDENTITY_CLIENT_ID, PEEZY_IDENTITY_APP_CLIENT_SECRET, and PEEZY_IDENTITY_OIDC_CLIENT_SECRET must be configured together"
      );
    }
  });

  test("requires an explicit trusted HTTPS edge for shared Identity client limits", () => {
    const { SENTINEL_TRUSTED_PROXY_IPS: _, ...withoutTrustedProxy } = baseEnv;
    expect(() =>
      loadConfig({
        ...withoutTrustedProxy,
        PEEZY_IDENTITY_APP_CLIENT_SECRET: "app-secret-at-least-32-characters",
        PEEZY_IDENTITY_CLIENT_ID: "pledge-cash",
        PEEZY_IDENTITY_OIDC_CLIENT_SECRET: "oidc-secret-at-least-32-characters",
        PEEZY_IDENTITY_URL: "https://identity.peezy.tech"
      })
    ).toThrow(
      "SENTINEL_TRUSTED_PROXY_IPS must identify the HTTPS edge in shared Identity mode"
    );
    expect(loadConfig(baseEnv).trustedProxyIps).toEqual(["127.0.0.1", "::1"]);
    expect(() =>
      loadConfig({ ...baseEnv, SENTINEL_TRUSTED_PROXY_IPS: "127.0.0.1,proxy" })
    ).toThrow("Invalid IP address in SENTINEL_TRUSTED_PROXY_IPS: proxy");
  });

  test("requires the shared identity URL to be a bare origin", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        PEEZY_IDENTITY_APP_CLIENT_SECRET: "app-secret-at-least-32-characters",
        PEEZY_IDENTITY_CLIENT_ID: "pledge-cash",
        PEEZY_IDENTITY_OIDC_CLIENT_SECRET: "oidc-secret-at-least-32-characters",
        PEEZY_IDENTITY_URL: "https://identity.peezy.tech/oauth"
      })
    ).toThrow("PEEZY_IDENTITY_URL must be an origin");
  });

  test("requires HTTPS for a non-loopback shared identity provider", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        PEEZY_IDENTITY_APP_CLIENT_SECRET: "app-secret-at-least-32-characters",
        PEEZY_IDENTITY_CLIENT_ID: "pledge-cash",
        PEEZY_IDENTITY_OIDC_CLIENT_SECRET: "oidc-secret-at-least-32-characters",
        PEEZY_IDENTITY_URL: "http://identity.peezy.tech"
      })
    ).toThrow("PEEZY_IDENTITY_URL must use HTTPS outside loopback development");

    expect(
      loadConfig({
        ...baseEnv,
        PEEZY_IDENTITY_APP_CLIENT_SECRET: "app-secret-at-least-32-characters",
        PEEZY_IDENTITY_CLIENT_ID: "pledge-cash",
        PEEZY_IDENTITY_OIDC_CLIENT_SECRET: "oidc-secret-at-least-32-characters",
        PEEZY_IDENTITY_URL: "http://localhost:8790"
      }).auth.identity?.baseUrl
    ).toBe("http://localhost:8790");
  });

  test("validates shared identity client identifiers and secret strength", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        PEEZY_IDENTITY_APP_CLIENT_SECRET: "short",
        PEEZY_IDENTITY_CLIENT_ID: "pledge:cash",
        PEEZY_IDENTITY_OIDC_CLIENT_SECRET: "also-short",
        PEEZY_IDENTITY_URL: "https://identity.peezy.tech"
      })
    ).toThrow();
  });

  test("rejects reuse of one secret across the app API and OIDC boundaries", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        PEEZY_IDENTITY_APP_CLIENT_SECRET: "shared-secret-at-least-32-characters",
        PEEZY_IDENTITY_CLIENT_ID: "pledge-cash",
        PEEZY_IDENTITY_OIDC_CLIENT_SECRET: "shared-secret-at-least-32-characters",
        PEEZY_IDENTITY_URL: "https://identity.peezy.tech"
      })
    ).toThrow(
      "PEEZY_IDENTITY_APP_CLIENT_SECRET and PEEZY_IDENTITY_OIDC_CLIENT_SECRET must be distinct"
    );
  });

  test("requires auth and web URLs to be bare origins", () => {
    expect(() => loadConfig({ ...baseEnv, BETTER_AUTH_URL: "https://api.pledge.cash/auth" })).toThrow(
      "BETTER_AUTH_URL must be an origin"
    );
    expect(() => loadConfig({ ...baseEnv, SENTINEL_WEB_ORIGIN: "https://pledge.cash/notifications" })).toThrow(
      "SENTINEL_WEB_ORIGIN must be an origin"
    );
  });

  test("normalizes and deduplicates the harness boardroom allowlist", () => {
    const config = loadConfig({
      ...baseEnv,
      SENTINEL_HARNESS_BOARDROOM_ALLOWLIST:
        "0x1111111111111111111111111111111111111111,0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA,0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });

    expect(config.harness.boardroomAllowlist).toEqual([
      "0x1111111111111111111111111111111111111111",
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    ]);
    expect(config.harness.dailyLimit).toBe(50);
  });

  test("rejects malformed harness allowlist addresses", () => {
    expect(() =>
      loadConfig({ ...baseEnv, SENTINEL_HARNESS_BOARDROOM_ALLOWLIST: "0xnot-an-address" })
    ).toThrow("Invalid boardroom address");
  });
});
