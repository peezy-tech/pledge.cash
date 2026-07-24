import { describe, expect, test } from "bun:test";
import {
  HyperCoreRefundInventory,
  parseDecimalAtomic,
} from "../src/execution/hypercore-inventory";

const account = "0x00000000000000000000000000000000000000A1";

describe("HyperCore refund inventory", () => {
  test("subtracts held USDC and preserves eight atomic decimals", async () => {
    const inventory = new HyperCoreRefundInventory(account, {
      async spotClearinghouseState() {
        return {
          balances: [
            { coin: "USDC", total: "12.34567890", hold: "2.00000001" },
          ],
        };
      },
    });
    await expect(inventory.availableAtomicUsdc()).resolves.toBe(1_034_567_889n);
  });

  test("parses decimal values without floating point", () => {
    expect(parseDecimalAtomic("1", 8)).toBe(100_000_000n);
    expect(parseDecimalAtomic("0.00000001", 8)).toBe(1n);
    expect(() => parseDecimalAtomic("0.000000001", 8)).toThrow("precision");
  });
});
