import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { formatTokenAmount, parseTokenAmountInput, readTokenMetadataMap } from "../src/lib/token-amounts";

const token = {
  address: "0x1000000000000000000000000000000000000000" as Address,
  decimals: 18,
  symbol: "PLDG",
};

describe("token amount presentation", () => {
  test("formats ERC20 base units with token decimals and compact suffixes", () => {
    expect(formatTokenAmount(9_000_000_000_000_000_000_000n, token)).toBe("9k PLDG");
    expect(formatTokenAmount(1_500_000_000_000_000_000n, token)).toBe("1.5 PLDG");
  });

  test("parses human decimal inputs into ERC20 base units", () => {
    expect(parseTokenAmountInput("9,000.5", token, "Amount")).toBe(9_000_500_000_000_000_000_000n);
  });

  test("bounds token metadata RPC concurrency for large project snapshots", async () => {
    const addresses = Array.from({ length: 25 }, (_, index) =>
      `0x${(index + 1).toString(16).padStart(40, "0")}` as Address);
    let activeReads = 0;
    let maxActiveReads = 0;
    const client = {
      async readContract(parameters: { functionName: string }) {
        activeReads += 1;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeReads -= 1;
        return parameters.functionName === "symbol" ? "TOK" : 18;
      },
    };

    const metadata = await readTokenMetadataMap(client as never, addresses);

    expect(Object.keys(metadata)).toHaveLength(addresses.length);
    expect(maxActiveReads).toBeLessThanOrEqual(8);
  });
});
