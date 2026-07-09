import { describe, expect, test } from "bun:test";

import { loadConfig } from "../src/config";

const baseEnv = {
  DATABASE_URL: "postgres://sentinel:sentinel@127.0.0.1:5432/sentinel",
  SENTINEL_CHAIN_IDS: "31337",
  SENTINEL_RPC_URL_31337: "http://127.0.0.1:8545",
  SENTINEL_WEB_ORIGIN: "http://localhost:5173"
};

describe("Sentinel config", () => {
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
