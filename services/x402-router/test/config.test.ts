import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";

import { loadConfig } from "../src/config";

const executorKey = `0x${"11".repeat(32)}` as const;
const refundKey = `0x${"22".repeat(32)}` as const;

function validEnv(): Record<string, string> {
  return {
    DATABASE_URL: "postgres://router:router@localhost:5432/router",
    X402_ROUTER_PUBLIC_ORIGIN: "https://router.example",
    X402_ROUTER_WEB_ORIGIN: "https://market.example",
    X402_ROUTER_APPLICATION: "router.example/v1/execute",
    X402_ROUTER_GATEWAY_ADDRESS: privateKeyToAccount(executorKey).address,
    X402_ROUTER_JOURNAL_ENCRYPTION_KEY: "33".repeat(32),
    HYPERLIQUID_PAY_TO_ADDRESS: privateKeyToAccount(refundKey).address,
    HYPERLIQUID_REFUND_PRIVATE_KEY: refundKey,
    X402_ROUTER_HYPEREVM_USDC_ADDRESS:
      "0x00000000000000000000000000000000000000a1",
    HYPEREVM_EXECUTOR_PRIVATE_KEY: executorKey,
    X402_ROUTER_MAX_ORDER_ATOMIC: "250000000",
    X402_ROUTER_SERVICE_FEE_BPS: "0",
    X402_ROUTER_MIN_REFUND_RESERVE_ATOMIC: "100000000"
  };
}

describe("x402 router configuration", () => {
  test("loads explicit deployment and economics policy", () => {
    const config = loadConfig(validEnv());

    expect(config.hyperevm.destinationUsdc).toBe(
      "0x00000000000000000000000000000000000000A1"
    );
    expect(config.quotes.maximumOrderAtomic).toBe(250000000n);
    expect(config.quotes.serviceFeeBps).toBe(0);
    expect(config.hyperliquid.minimumRefundReserveAtomic).toBe(100000000n);
    expect(config.journalEncryptionKey).toBe(`0x${"33".repeat(32)}`);
  });

  test("does not silently choose economic policy", () => {
    for (const key of [
      "X402_ROUTER_MAX_ORDER_ATOMIC",
      "X402_ROUTER_SERVICE_FEE_BPS",
      "X402_ROUTER_MIN_REFUND_RESERVE_ATOMIC"
    ] as const) {
      const env: Record<string, string | undefined> = validEnv();
      delete env[key];
      expect(() => loadConfig(env)).toThrow();
    }
  });

  test("rejects signing-authority drift and invalid journal keys", () => {
    expect(() =>
      loadConfig({
        ...validEnv(),
        X402_ROUTER_GATEWAY_ADDRESS:
          "0x0000000000000000000000000000000000000001"
      })
    ).toThrow("must match the account derived");

    expect(() =>
      loadConfig({
        ...validEnv(),
        X402_ROUTER_JOURNAL_ENCRYPTION_KEY: "11"
      })
    ).toThrow();
  });

  test("requires HTTPS except for loopback development origins", () => {
    expect(() =>
      loadConfig({
        ...validEnv(),
        X402_ROUTER_PUBLIC_ORIGIN: "http://router.example"
      })
    ).toThrow("must use HTTPS");

    expect(
      loadConfig({
        ...validEnv(),
        X402_ROUTER_PUBLIC_ORIGIN: "http://127.0.0.1:8788",
        X402_ROUTER_WEB_ORIGIN: "http://localhost:5173",
        HYPEREVM_RPC_URL: "http://127.0.0.1:8545",
      }).publicOrigin
    ).toBe("http://127.0.0.1:8788");

    expect(() =>
      loadConfig({
        ...validEnv(),
        HYPEREVM_RPC_URL: "http://rpc.example",
      })
    ).toThrow("must use HTTPS");
    expect(() =>
      loadConfig({
        ...validEnv(),
        X402_ROUTER_WEB_ORIGIN: "https://secret@market.example",
      })
    ).toThrow("must be an origin");
  });

  test("accepts only Postgres and quote TTLs long enough to sign safely", () => {
    expect(() =>
      loadConfig({
        ...validEnv(),
        DATABASE_URL: "https://database.example/router",
      })
    ).toThrow("postgres");
    expect(() =>
      loadConfig({
        ...validEnv(),
        X402_ROUTER_QUOTE_TTL_SECONDS: "29",
      })
    ).toThrow();
    expect(
      loadConfig({
        ...validEnv(),
        X402_ROUTER_QUOTE_TTL_SECONDS: "30",
      }).quotes.ttlSeconds,
    ).toBe(30);
  });
});
