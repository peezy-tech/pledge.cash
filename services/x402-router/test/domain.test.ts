import { describe, expect, test } from "bun:test";
import {
  createQuoteRequestSchema,
  requireSameParty,
} from "../src/api/dto";
import {
  ceilBps,
  convertAtomicDecimals,
  maximumWithSlippage,
  minimumWithSlippage,
} from "../src/quotes/math";

const payer = "0x00000000000000000000000000000000000000A1";

describe("marketplace-router request boundary", () => {
  test("accepts only the two v1 actions and rejects unknown fields", () => {
    expect(createQuoteRequestSchema.parse({
      kind: "amm_swap",
      chainId: 998,
      boardroom: payer,
      payer,
      recipient: payer,
      refundAddress: payer,
      maxSlippageBps: 50,
      pool: "0x00000000000000000000000000000000000000B1",
      tokenIn: "0x00000000000000000000000000000000000000C1",
      tokenOut: "0x00000000000000000000000000000000000000D1",
      amountIn: "1000000",
    }).kind).toBe("amm_swap");

    expect(() => createQuoteRequestSchema.parse({
      kind: "bonding_curve",
      chainId: 998,
    })).toThrow();
    expect(() => createQuoteRequestSchema.parse({
      kind: "fixed_price_sale",
      chainId: 998,
      boardroom: payer,
      payer,
      recipient: payer,
      refundAddress: payer,
      maxSlippageBps: 0,
      sale: "0x00000000000000000000000000000000000000E1",
      shareAmount: "1",
      callData: "0xdeadbeef",
    })).toThrow();
  });

  test("pins payer, recipient, and refund address", () => {
    expect(() => requireSameParty({
      payer,
      recipient: payer,
      refundAddress: payer,
    })).not.toThrow();
    expect(() => requireSameParty({
      payer,
      recipient: "0x00000000000000000000000000000000000000F1",
      refundAddress: payer,
    })).toThrow("must be the same address");
  });

  test("rejects quote amounts outside the uint256 range", () => {
    const request = {
      kind: "amm_swap" as const,
      chainId: 998 as const,
      boardroom: payer,
      payer,
      recipient: payer,
      refundAddress: payer,
      maxSlippageBps: 50,
      pool: "0x00000000000000000000000000000000000000B1",
      tokenIn: "0x00000000000000000000000000000000000000C1",
      tokenOut: "0x00000000000000000000000000000000000000D1",
      amountIn: ((1n << 256n) - 1n).toString(),
    };
    const parsed = createQuoteRequestSchema.parse(request);
    expect(parsed.kind).toBe("amm_swap");
    if (parsed.kind !== "amm_swap") throw new Error("expected AMM quote");
    expect(parsed.amountIn).toBe(request.amountIn);
    expect(() =>
      createQuoteRequestSchema.parse({
        ...request,
        amountIn: (1n << 256n).toString(),
      }),
    ).toThrow("uint256");
  });
});

describe("marketplace-router payment math", () => {
  test("rounds fees and bounds in the conservative direction", () => {
    expect(ceilBps(101n, 50)).toBe(1n);
    expect(maximumWithSlippage(10_000n, 50)).toBe(10_050n);
    expect(minimumWithSlippage(10_000n, 50)).toBe(9_950n);
  });

  test("converts HyperEVM six-decimal USDC to HyperCore eight-decimal USDC", () => {
    expect(convertAtomicDecimals(1_000_000n, 6, 8)).toBe(100_000_000n);
    expect(convertAtomicDecimals(100_000_000n, 8, 6)).toBe(1_000_000n);
    expect(() => convertAtomicDecimals(1n, 8, 6)).toThrow("cannot be represented");
  });
});
