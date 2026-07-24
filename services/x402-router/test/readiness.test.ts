import { describe, expect, test } from "bun:test";
import { readRouterReadiness } from "../src/readiness";

describe("router readiness", () => {
  test("does not expose canonical RPC errors", async () => {
    const secret = "https://rpc.example/v1/private-api-key";
    const readiness = await readRouterReadiness({
      deployment: {
        ready: true,
        deployment: {} as never,
        release: {} as never,
      },
      publicClient: {
        async getBalance() {
          return 10n;
        },
      } as never,
      executor: "0x0000000000000000000000000000000000000001",
      minimumGasBalance: 1n,
      minimumRefundReserve: 1n,
      refundInventory: {
        async availableAtomicUsdc() {
          return 10n;
        },
      },
      async databasePing() {},
      async canonicalReady() {
        throw new Error(secret);
      },
      async hasManualIntervention() {
        return false;
      },
    });

    expect(readiness.acceptingQuotes).toBe(false);
    expect(readiness.checks.deployment).toEqual({
      ok: false,
      message: "Canonical deployment validation failed.",
    });
    expect(JSON.stringify(readiness)).not.toContain(secret);
  });
});
