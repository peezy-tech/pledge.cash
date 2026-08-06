import { describe, expect, test } from "bun:test";

import { loadConfig } from "../src/config";

const baseEnv = {
  BETTER_AUTH_SECRET: "sentinel-test-secret-at-least-32-characters",
  BETTER_AUTH_URL: "https://api.pledge.cash",
  DATABASE_URL: "postgres://sentinel:sentinel@127.0.0.1:5432/sentinel",
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
        secret: baseEnv.BETTER_AUTH_SECRET,
        socialProviders: {}
      },
      databaseUrl: baseEnv.DATABASE_URL,
      port: 8787,
      trustedProxyIps: ["127.0.0.1", "::1"],
      webOrigin: "http://localhost:5173"
    });
  });

  test("loads complete optional social provider credentials", () => {
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

    expect(config.auth.socialProviders).toEqual({
      discord: { clientId: "discord-client", clientSecret: "discord-secret" },
      github: { clientId: "github-client", clientSecret: "github-secret" },
      telegram: { clientId: "telegram-client", clientSecret: "telegram-secret" },
      twitter: { clientId: "twitter-client", clientSecret: "twitter-secret" }
    });
  });

  test("requires each social provider client id and secret as a pair", () => {
    for (const provider of [
      { GITHUB_CLIENT_ID: "github-client" },
      { APPLE_CLIENT_ID: "apple-client" },
      { DISCORD_CLIENT_SECRET: "discord-secret" },
      { TELEGRAM_OAUTH_CLIENT_ID: "telegram-client" },
      { TWITTER_CLIENT_SECRET: "twitter-secret" }
    ]) {
      expect(() => loadConfig({ ...baseEnv, ...provider })).toThrow(
        /_CLIENT_ID and .*_CLIENT_SECRET must be configured together/
      );
    }
  });

  test("loads shared Identity only when all confidential values are present", () => {
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
    ).toThrow("SENTINEL_TRUSTED_PROXY_IPS must identify the HTTPS edge in shared Identity mode");
    expect(() =>
      loadConfig({ ...baseEnv, SENTINEL_TRUSTED_PROXY_IPS: "127.0.0.1,proxy" })
    ).toThrow("Invalid IP address in SENTINEL_TRUSTED_PROXY_IPS: proxy");
  });

  test("requires secure bare origins", () => {
    const identity = {
      PEEZY_IDENTITY_APP_CLIENT_SECRET: "app-secret-at-least-32-characters",
      PEEZY_IDENTITY_CLIENT_ID: "pledge-cash",
      PEEZY_IDENTITY_OIDC_CLIENT_SECRET: "oidc-secret-at-least-32-characters"
    };
    expect(() =>
      loadConfig({ ...baseEnv, ...identity, PEEZY_IDENTITY_URL: "https://identity.peezy.tech/oauth" })
    ).toThrow("PEEZY_IDENTITY_URL must be an origin");
    expect(() =>
      loadConfig({ ...baseEnv, ...identity, PEEZY_IDENTITY_URL: "http://identity.peezy.tech" })
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
