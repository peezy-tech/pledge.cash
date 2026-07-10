import { describe, expect, test } from "bun:test";

import { loadConfig } from "../src/config";

const baseEnv = {
  BETTER_AUTH_SECRET: "sentinel-test-secret-at-least-32-characters",
  BETTER_AUTH_URL: "https://api.pledge.cash",
  DATABASE_URL: "postgres://sentinel:sentinel@127.0.0.1:5432/sentinel",
  SENTINEL_CHAIN_IDS: "31337",
  SENTINEL_RPC_URL_31337: "http://127.0.0.1:8545",
  SENTINEL_WEB_ORIGIN: "http://localhost:5173"
};

describe("Sentinel config", () => {
  test("loads Better Auth and complete optional social provider credentials", () => {
    const config = loadConfig({
      ...baseEnv,
      GITHUB_CLIENT_ID: "github-client",
      GITHUB_CLIENT_SECRET: "github-secret",
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret"
    });

    expect(config.auth).toEqual({
      baseUrl: "https://api.pledge.cash",
      secret: baseEnv.BETTER_AUTH_SECRET,
      socialProviders: {
        github: { clientId: "github-client", clientSecret: "github-secret" },
        google: { clientId: "google-client", clientSecret: "google-secret" }
      }
    });
  });

  test("requires each social provider client id and secret as a pair", () => {
    const incompleteProviders = [
      { GITHUB_CLIENT_ID: "github-client" },
      { GOOGLE_CLIENT_SECRET: "google-secret" },
      { APPLE_CLIENT_ID: "apple-client" }
    ];

    for (const provider of incompleteProviders) {
      expect(() => loadConfig({ ...baseEnv, ...provider })).toThrow(
        /_CLIENT_ID and .*_CLIENT_SECRET must be configured together/
      );
    }
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
