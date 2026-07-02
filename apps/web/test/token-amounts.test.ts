import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { formatTokenAmount, parseTokenAmountInput } from "../src/lib/token-amounts";

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
});
