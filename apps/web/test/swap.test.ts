import { describe, expect, test } from "bun:test";
import type { Address, PledgeCashDeployment } from "@pledge.cash/sdk";
import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem";
import {
  deadlineIsFuture,
  remainingDeadlineMinutes,
  swapActionState,
} from "../src/features/swap/swap-panel";
import {
  assertFutureSwapDeadline,
  buildSwapTransaction,
  defaultSwapForm,
  pairHasWrappedNative,
  poolIdForKey,
  readSwapQuote,
  swapPairLabel,
  swapQuoteExecutionMetrics,
  swapQuoteReady,
  swapQuoteRequestIdentity,
  withSwapTokenListDefaults,
  type SwapQuoteState,
} from "../src/lib/swap";

const token0 = "0x1000000000000000000000000000000000000000" as Address;
const token1 = "0x2000000000000000000000000000000000000000" as Address;
const locker = "0x3000000000000000000000000000000000000000" as Address;
const account = "0x4000000000000000000000000000000000000000" as Address;
const router = "0x5000000000000000000000000000000000000000" as Address;
const deployment: PledgeCashDeployment = { chainId: 31337, uniswapUniversalRouter: router, wrappedNative: token0 };

function executableQuote(): SwapQuoteState {
  return {
    requestIdentity: "quote",
    tokenIn: { address: token0, decimals: 18, symbol: "TK0", allowance: 10n },
    tokenOut: { address: token1, decimals: 6, symbol: "TK1" },
    pool: {
      address: locker,
      token0,
      token1,
      poolId: `0x${"11".repeat(32)}`,
      fee: 3000,
      tickSpacing: 60,
      hooks: "0x0000000000000000000000000000000000000000",
      liquidity: 100n,
      sqrtPriceX96: 1n << 96n,
    },
    amountIn: 10n,
    amountOut: 9n,
    amountOutMin: 8n,
    slippageBps: 50,
  };
}

describe("lean Uniswap v4 swap surface", () => {
  test("defaults to a discovered locker pool pair with wrapped native first", () => {
    const form = withSwapTokenListDefaults(defaultSwapForm(), {
      loaded: true,
      tokens: [],
      pools: [{
        address: locker,
        token0: token1,
        token1: token0,
        poolId: `0x${"11".repeat(32)}`,
        fee: 3000,
        tickSpacing: 60,
        hooks: "0x0000000000000000000000000000000000000000",
        liquidity: 1n,
        sqrtPriceX96: 1n << 96n,
      }],
    }, deployment);
    expect(form.tokenIn).toBe(token0);
    expect(form.tokenOut).toBe(token1);
    expect("useNative" in form).toBe(false);
  });

  test("computes the canonical PoolKey identifier", () => {
    const key = { currency0: token0, currency1: token1, fee: 3000, tickSpacing: 60, hooks: "0x0000000000000000000000000000000000000000" as Address };
    const expected = keccak256(encodeAbiParameters(
      parseAbiParameters("address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks"),
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ));
    expect(poolIdForKey(key)).toBe(expected);
  });

  test("builds an actual Universal Router v4 swap transaction", () => {
    const quote = executableQuote();
    const form = { ...defaultSwapForm(), tokenIn: token0, tokenOut: token1, amountIn: "10", deadline: "2000000000" };
    const transaction = buildSwapTransaction({ deployment, form, quote, account });

    expect(transaction.address).toBe(router);
    expect(transaction.functionName).toBe("execute");
    expect(transaction.args[0]).toBe("0x10");
    expect(transaction.args[2]).toBe(2_000_000_000n);
  });

  test("recognizes wrapped-native pairs without adding a second transaction mode", () => {
    const form = { ...defaultSwapForm(), tokenIn: token0, tokenOut: token1, amountIn: "10", deadline: "2000000000" };
    expect(pairHasWrappedNative(deployment, token0, token1)).toBe(true);
    expect("useNative" in form).toBe(false);
    expect(buildSwapTransaction({ deployment, form, quote: executableQuote(), account }).address).toBe(router);
  });

  test("fails quotes clearly when locker discovery roots are absent", async () => {
    const form = { ...defaultSwapForm(), tokenIn: token0, tokenOut: token1 };
    const quote = await readSwapQuote({ readContract: async () => 0n } as never, undefined, form, account);
    expect(quote.error).toContain("Uniswap Universal Router");
    expect(swapQuoteReady(quote)).toBe(false);
  });

  test("keeps quote identity, pair labels, and metrics deterministic", () => {
    const form = { ...defaultSwapForm(), tokenIn: token0, tokenOut: token1, amountIn: "2" };
    expect(swapQuoteRequestIdentity(form)).toBe(swapQuoteRequestIdentity({ ...form }));
    expect(swapPairLabel(executableQuote(), form)).toBe("TK0 / TK1");
    const metrics = swapQuoteExecutionMetrics({
      tokenIn: { address: token0, decimals: 18 },
      tokenOut: { address: token1, decimals: 18 },
      pool: executableQuote().pool!,
      amountIn: 10n,
      amountOut: 10n,
    });
    expect(metrics.effectiveExecutionPrice?.status).toBe("known");
    expect(metrics.feeInclusivePriceImpact?.status).toBe("known");
  });

  test("bounds deadlines and surfaces stale or missing approvals", () => {
    expect(deadlineIsFuture("1060", 1000)).toBe(true);
    expect(remainingDeadlineMinutes("1061", 1000)).toBe(2);
    expect(() => assertFutureSwapDeadline("1000", 1000)).toThrow("expired");
    const quote = executableQuote();
    quote.tokenIn = { ...quote.tokenIn!, allowance: 0n };
    const actions = swapActionState({ status: "enabled" }, quote, true, "current");
    expect(actions.approve.enabled).toBe(true);
    expect(actions.swap.enabled).toBe(false);
  });
});
