import { describe, expect, test } from "bun:test";
import type { Address, PledgeCashDeployment, PledgeCashReadClient } from "@pledge.cash/sdk";
import {
  buildAddLiquidityTransaction,
  buildRemoveLiquidityTransaction,
  buildSwapTransaction,
  assertFutureSwapDeadline,
  readAmmPosition,
  readLiquidityQuote,
  readRemoveLiquidityQuote,
  readSwapQuote,
  readSwapTokenList,
} from "../src/lib/swap";

const factory = "0x1000000000000000000000000000000000000000" as Address;
const pool = "0x2000000000000000000000000000000000000000" as Address;
const usdc = "0x3000000000000000000000000000000000000000" as Address;
const share = "0x4000000000000000000000000000000000000000" as Address;
const whype = "0x5000000000000000000000000000000000000000" as Address;
const account = "0x6000000000000000000000000000000000000000" as Address;
const router = "0x7000000000000000000000000000000000000000" as Address;
const nativePool = "0x8000000000000000000000000000000000000000" as Address;
const deployment: PledgeCashDeployment = { chainId: 31337, ammFactory: factory, ammRouter: router, wrappedNative: whype };

describe("swap token discovery", () => {
  test("lists AMM pool tokens plus deployment wrapped native", async () => {
    const state = await readSwapTokenList(
      fakeReadClient(),
      deployment,
      account,
      { wrappedNativeLabel: "WHYPE" },
    );

    expect(state.error).toBeUndefined();
    expect(state.pools).toHaveLength(1);
    expect(state.tokens.map((token) => token.address).sort()).toEqual([share, usdc, whype].sort());

    const cash = state.tokens.find((token) => token.address === usdc);
    expect(cash?.label).toBeUndefined();
    expect(cash?.sources).toEqual(["pool"]);
    expect(cash?.pairAddresses).toEqual([share]);
    expect(cash?.balance).toBe(1_000_000n);

    const wrappedNative = state.tokens.find((token) => token.address === whype);
    expect(wrappedNative?.label).toBe("WHYPE");
    expect(wrappedNative?.sources).toEqual(["deployment"]);
    expect(wrappedNative?.pools).toHaveLength(0);
  });

  test("uses the active-chain wrapped native label", async () => {
    const state = await readSwapTokenList(
      fakeReadClient(),
      deployment,
      account,
      { wrappedNativeLabel: "WMON" },
    );

    const wrappedNative = state.tokens.find((token) => token.address === whype);
    expect(wrappedNative?.label).toBe("WMON");
    expect(wrappedNative?.sources).toEqual(["deployment"]);
  });

  test("keeps the newest canonical pool when the factory has more than 500 pools", async () => {
    const requestedIndices: bigint[] = [];
    const newestPool = indexedPoolAddress(500n);
    const client = {
      async readContract(rawRequest: unknown): Promise<unknown> {
        const request = rawRequest as { address: Address; functionName: string; args?: readonly unknown[] };
        if (request.address === factory && request.functionName === "allPoolsLength") return 501n;
        if (request.address === factory && request.functionName === "allPools") {
          const index = request.args?.[0] as bigint;
          requestedIndices.push(index);
          return indexedPoolAddress(index);
        }
        if (request.functionName === "token0") return usdc;
        if (request.functionName === "token1") return share;
        if (request.functionName === "getReserves") return [1_000_000n, 2_000_000_000_000_000_000n, 0] as const;
        if (request.functionName === "symbol") return request.address === usdc ? "USDC" : request.address === share ? "PLDG" : "WHYPE";
        if (request.functionName === "decimals") return request.address === usdc ? 6 : 18;
        throw new Error(`Unexpected read ${request.functionName} on ${request.address}`);
      },
    } as PledgeCashReadClient;

    const state = await readSwapTokenList(client, deployment);

    expect(requestedIndices).toHaveLength(500);
    expect(requestedIndices[0]).toBe(1n);
    expect(requestedIndices.at(-1)).toBe(500n);
    expect(requestedIndices).not.toContain(0n);
    expect(state.pools).toHaveLength(500);
    expect(state.pools.some((candidate) => candidate.address === newestPool)).toBe(true);
    expect(state.error).toBe("Showing the newest 500 pools. Enter a token address to work with an older pool.");
  });

  test("unions an older exact project pool beyond the global discovery window", async () => {
    const oldestPool = indexedPoolAddress(0n);
    const client = {
      async readContract(rawRequest: unknown): Promise<unknown> {
        const request = rawRequest as { address: Address; functionName: string; args?: readonly unknown[] };
        if (request.address === factory && request.functionName === "allPoolsLength") return 501n;
        if (request.address === factory && request.functionName === "allPools") return indexedPoolAddress(request.args?.[0] as bigint);
        if (request.functionName === "token0") return usdc;
        if (request.functionName === "token1") return share;
        if (request.functionName === "getReserves") return [1_000_000n, 2_000_000_000_000_000_000n, 0] as const;
        if (request.functionName === "symbol") return request.address === usdc ? "USDC" : "PLDG";
        if (request.functionName === "decimals") return request.address === usdc ? 6 : 18;
        throw new Error(`Unexpected read ${request.functionName} on ${request.address}`);
      },
    } as PledgeCashReadClient;

    const state = await readSwapTokenList(client, deployment, undefined, { pinnedPools: [oldestPool] });

    expect(state.pools).toHaveLength(501);
    expect(state.pools.some((candidate) => candidate.address === oldestPool)).toBe(true);
    expect(state.tokens.find((token) => token.address === share)?.pools).toContain(oldestPool);
  });

  test("bounds pool address and summary discovery concurrency", async () => {
    let activeAddressReads = 0;
    let activeSummaryReads = 0;
    let maxAddressReads = 0;
    let maxSummaryReads = 0;
    const client = {
      async readContract(rawRequest: unknown): Promise<unknown> {
        const request = rawRequest as { address: Address; functionName: string; args?: readonly unknown[] };
        if (request.address === factory && request.functionName === "allPoolsLength") return 40n;
        if (request.address === factory && request.functionName === "allPools") {
          activeAddressReads += 1;
          maxAddressReads = Math.max(maxAddressReads, activeAddressReads);
          await new Promise((resolve) => setTimeout(resolve, 0));
          activeAddressReads -= 1;
          return indexedPoolAddress(request.args?.[0] as bigint);
        }
        if (["token0", "token1", "getReserves"].includes(request.functionName)) {
          activeSummaryReads += 1;
          maxSummaryReads = Math.max(maxSummaryReads, activeSummaryReads);
          await new Promise((resolve) => setTimeout(resolve, 0));
          activeSummaryReads -= 1;
          if (request.functionName === "token0") return usdc;
          if (request.functionName === "token1") return share;
          return [1_000_000n, 2_000_000_000_000_000_000n, 0] as const;
        }
        if (request.functionName === "symbol") return request.address === usdc ? "USDC" : "PLDG";
        if (request.functionName === "decimals") return request.address === usdc ? 6 : 18;
        throw new Error(`Unexpected read ${request.functionName} on ${request.address}`);
      },
    } as PledgeCashReadClient;

    await readSwapTokenList(client, deployment);

    expect(maxAddressReads).toBeLessThanOrEqual(8);
    expect(maxSummaryReads).toBeLessThanOrEqual(24);
  });
});

describe("AMM liquidity helpers", () => {
  test("fails closed before building a transaction with an expired deadline", () => {
    expect(() => assertFutureSwapDeadline("1000", 1000)).toThrow("transaction window expired");
    expect(() => assertFutureSwapDeadline("1001", 1000)).not.toThrow();
  });

  test("builds native swap router calls when wrapped native is selected", async () => {
    const nativeInputQuote = await readSwapQuote(fakeReadClient(), deployment, {
      tokenIn: whype,
      tokenOut: share,
      amountIn: "1",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: true,
    }, account);

    expect(nativeInputQuote.error).toBeUndefined();
    expect(nativeInputQuote.amountOut).toBe(2_000_000_000_000_000_000n);
    const nativeInputTransaction = buildSwapTransaction({
      deployment,
      form: { tokenIn: whype, tokenOut: share, amountIn: "1", slippageBps: "50", recipient: "", deadline: "1700000000", useNative: true },
      quote: nativeInputQuote,
      account,
    });

    expect(nativeInputTransaction.functionName).toBe("swapExactNativeForTokens");
    expect(nativeInputTransaction.value).toBe(1_000_000_000_000_000_000n);
    expect(nativeInputTransaction.args[0]).toBe(1_990_000_000_000_000_000n);
    expect(nativeInputTransaction.args[1]).toEqual([whype, share]);
    expect(nativeInputTransaction.args[2]).toBe(account);

    const nativeOutputQuote = await readSwapQuote(fakeReadClient(), deployment, {
      tokenIn: share,
      tokenOut: whype,
      amountIn: "2",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: true,
    }, account);

    expect(nativeOutputQuote.error).toBeUndefined();
    expect(nativeOutputQuote.amountOut).toBe(1_000_000_000_000_000_000n);
    const nativeOutputTransaction = buildSwapTransaction({
      deployment,
      form: { tokenIn: share, tokenOut: whype, amountIn: "2", slippageBps: "50", recipient: "", deadline: "1700000000", useNative: true },
      quote: nativeOutputQuote,
      account,
    });

    expect(nativeOutputTransaction.functionName).toBe("swapExactTokensForNative");
    expect(nativeOutputTransaction.args[0]).toBe(2_000_000_000_000_000_000n);
    expect(nativeOutputTransaction.args[1]).toBe(995_000_000_000_000_000n);
    expect(nativeOutputTransaction.args[2]).toEqual([share, whype]);
    expect(nativeOutputTransaction.args[3]).toBe(account);
  });

  test("rejects swap quotes that round down to zero output", async () => {
    const quote = await readSwapQuote(fakeReadClient(), deployment, {
      tokenIn: share,
      tokenOut: whype,
      amountIn: "0.000000000000000001",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: true,
    }, account);

    expect(quote.amountIn).toBe(1n);
    expect(quote.amountOut).toBe(0n);
    expect(quote.error).toBe("Swap output would be zero.");
  });

  test("quotes balanced add liquidity amounts and builds add transaction", async () => {
    const quote = await readLiquidityQuote(fakeReadClient(), deployment, {
      tokenA: usdc,
      tokenB: share,
      amountA: "1",
      amountB: "3",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: false,
    }, account);

    expect(quote.error).toBeUndefined();
    expect(quote.amountA).toBe(1_000_000n);
    expect(quote.amountB).toBe(2_000_000_000_000_000_000n);
    expect(quote.amountBMin).toBe(1_990_000_000_000_000_000n);
    expect(quote.liquidityOut).toBe(100_000_000_000_000_000_000n);

    const transaction = buildAddLiquidityTransaction({
      deployment,
      form: { tokenA: usdc, tokenB: share, amountA: "1", amountB: "3", slippageBps: "50", recipient: "", deadline: "1700000000", useNative: false },
      quote,
      account,
    });

    expect(transaction.functionName).toBe("addLiquidity");
    expect(transaction.args[0]).toBe(usdc);
    expect(transaction.args[3]).toBe(2_000_000_000_000_000_000n);
    expect(transaction.args[6]).toBe(account);
  });

  test("reads LP position fee claims and builds remove transaction", async () => {
    const position = await readAmmPosition(fakeReadClient(), deployment, usdc, share, account);
    expect(position?.error).toBeUndefined();
    expect(position?.lpBalance).toBe(10_000_000_000_000_000_000n);
    expect(position?.poolShareBps).toBe(1_000n);
    expect(position?.claimableA).toBe(10_000_000_000_000_001_000n);
    expect(position?.claimableB).toBe(20_000_000_000_000_002_000n);

    const quote = await readRemoveLiquidityQuote(fakeReadClient(), deployment, {
      tokenA: usdc,
      tokenB: share,
      amountA: "1",
      amountB: "1",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: false,
    }, {
      liquidity: "5",
      slippageBps: "100",
      recipient: "",
      deadline: "1700000100",
      useNative: false,
    }, account);

    expect(quote.error).toBeUndefined();
    expect(quote.amountA).toBe(50_000n);
    expect(quote.amountB).toBe(100_000_000_000_000_000n);
    expect(quote.amountAMin).toBe(49_500n);

    const transaction = buildRemoveLiquidityTransaction({
      deployment,
      form: { liquidity: "5", slippageBps: "100", recipient: "", deadline: "1700000100", useNative: false },
      quote,
      account,
    });

    expect(transaction.functionName).toBe("removeLiquidity");
    expect(transaction.args[2]).toBe(5_000_000_000_000_000_000n);
    expect(transaction.args[6]).toBe(1_700_000_100n);
  });

  test("rejects dust LP removal quotes that round down to zero token output", async () => {
    const quote = await readRemoveLiquidityQuote(fakeReadClient(), deployment, {
      tokenA: usdc,
      tokenB: share,
      amountA: "1",
      amountB: "1",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: false,
    }, {
      liquidity: "0.000000000000000001",
      slippageBps: "100",
      recipient: "",
      deadline: "1700000100",
      useNative: false,
    }, account);

    expect(quote.liquidity).toBe(1n);
    expect(quote.amountA).toBe(0n);
    expect(quote.amountB).toBe(0n);
    expect(quote.error).toBe("LP amount is too small for this pool.");
  });

  test("rejects invalid slippage before executable quotes are produced", async () => {
    const swapQuote = await readSwapQuote(fakeReadClient(), deployment, {
      tokenIn: share,
      tokenOut: whype,
      amountIn: "2",
      slippageBps: "abc",
      recipient: "",
      deadline: "1700000000",
      useNative: true,
    }, account);

    expect(swapQuote.amountOut).toBeUndefined();
    expect(swapQuote.error).toBe("Slippage must be whole basis points.");

    const addQuote = await readLiquidityQuote(fakeReadClient(), deployment, {
      tokenA: usdc,
      tokenB: share,
      amountA: "1",
      amountB: "3",
      slippageBps: "10000",
      recipient: "",
      deadline: "1700000000",
      useNative: false,
    }, account);

    expect(addQuote.liquidityOut).toBeUndefined();
    expect(addQuote.error).toBe("Slippage must be between 0 and 9999 bps.");

    const removeQuote = await readRemoveLiquidityQuote(fakeReadClient(), deployment, {
      tokenA: usdc,
      tokenB: share,
      amountA: "1",
      amountB: "1",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: false,
    }, {
      liquidity: "5",
      slippageBps: "0.5",
      recipient: "",
      deadline: "1700000100",
      useNative: false,
    }, account);

    expect(removeQuote.amountA).toBeUndefined();
    expect(removeQuote.error).toBe("Slippage must be whole basis points.");
  });

  test("builds native add and remove liquidity router calls when wrapped native is selected", async () => {
    const addQuote = await readLiquidityQuote(fakeReadClient(), deployment, {
      tokenA: whype,
      tokenB: share,
      amountA: "1",
      amountB: "3",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: true,
    }, account);

    expect(addQuote.error).toBeUndefined();
    const addTransaction = buildAddLiquidityTransaction({
      deployment,
      form: { tokenA: whype, tokenB: share, amountA: "1", amountB: "3", slippageBps: "50", recipient: "", deadline: "1700000000", useNative: true },
      quote: addQuote,
      account,
    });

    expect(addTransaction.functionName).toBe("addLiquidityNative");
    expect(addTransaction.value).toBe(1_000_000_000_000_000_000n);
    expect(addTransaction.args[0]).toBe(share);
    expect(addTransaction.args[1]).toBe(2_000_000_000_000_000_000n);
    expect(addTransaction.args[3]).toBe(995_000_000_000_000_000n);

    const removeQuote = await readRemoveLiquidityQuote(fakeReadClient(), deployment, {
      tokenA: whype,
      tokenB: share,
      amountA: "1",
      amountB: "1",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: true,
    }, {
      liquidity: "5",
      slippageBps: "100",
      recipient: "",
      deadline: "1700000100",
      useNative: true,
    }, account);

    expect(removeQuote.error).toBeUndefined();
    const removeTransaction = buildRemoveLiquidityTransaction({
      deployment,
      form: { liquidity: "5", slippageBps: "100", recipient: "", deadline: "1700000100", useNative: true },
      quote: removeQuote,
      account,
    });

    expect(removeTransaction.functionName).toBe("removeLiquidityNative");
    expect(removeTransaction.args[0]).toBe(share);
    expect(removeTransaction.args[2]).toBe(990_000_000_000_000_000n);
    expect(removeTransaction.args[3]).toBe(495_000_000_000_000_000n);
  });
});

function fakeReadClient(): PledgeCashReadClient {
  const symbols = new Map<Address, string>([
    [usdc, "USDC"],
    [share, "PLDG"],
    [whype, "WHYPE"],
    [pool, "PAMM-LP"],
    [nativePool, "PAMM-LP"],
  ]);

  return {
    async readContract(rawRequest: unknown): Promise<unknown> {
      const request = rawRequest as { address: Address; functionName: string; args?: readonly unknown[] };
      if (request.address === factory && request.functionName === "allPoolsLength") return 1n;
      if (request.address === factory && request.functionName === "allPools" && request.args?.[0] === 0n) return pool;
      if (request.address === factory && request.functionName === "getPool") return pairPool(request.args);
      if (request.address === factory && request.functionName === "predictPoolAddress") return pairPool(request.args);
      if (request.address === factory && request.functionName === "SWAP_FEE_BPS") return 30n;
      if (request.address === factory && request.functionName === "FEE_DENOMINATOR") return 10_000n;
      if (request.address === factory && request.functionName === "PROTOCOL_FEE_SHARE_BPS") return 500n;
      if (request.address === router && request.functionName === "getAmountsOut") return amountsOut(request.args);
      if (request.address === pool && request.functionName === "token0") return usdc;
      if (request.address === pool && request.functionName === "token1") return share;
      if (request.address === pool && request.functionName === "getReserves") return [1_000_000n, 2_000_000_000_000_000_000n, 0] as const;
      if (request.address === pool && request.functionName === "totalSupply") return 100_000_000_000_000_000_000n;
      if (request.address === pool && request.functionName === "claimable0") return 1_000n;
      if (request.address === pool && request.functionName === "claimable1") return 2_000n;
      if (request.address === pool && request.functionName === "index0") return 2_000_000_000_000_000_000n;
      if (request.address === pool && request.functionName === "index1") return 3_000_000_000_000_000_000n;
      if (request.address === pool && request.functionName === "supplyIndex0") return 1_000_000_000_000_000_000n;
      if (request.address === pool && request.functionName === "supplyIndex1") return 1_000_000_000_000_000_000n;
      if (request.address === nativePool && request.functionName === "token0") return whype;
      if (request.address === nativePool && request.functionName === "token1") return share;
      if (request.address === nativePool && request.functionName === "getReserves") return [10_000_000_000_000_000_000n, 20_000_000_000_000_000_000n, 0] as const;
      if (request.address === nativePool && request.functionName === "totalSupply") return 100_000_000_000_000_000_000n;
      if (request.address === nativePool && request.functionName === "claimable0") return 0n;
      if (request.address === nativePool && request.functionName === "claimable1") return 0n;
      if (request.address === nativePool && request.functionName === "index0") return 1_000_000_000_000_000_000n;
      if (request.address === nativePool && request.functionName === "index1") return 1_000_000_000_000_000_000n;
      if (request.address === nativePool && request.functionName === "supplyIndex0") return 1_000_000_000_000_000_000n;
      if (request.address === nativePool && request.functionName === "supplyIndex1") return 1_000_000_000_000_000_000n;
      if (request.functionName === "symbol") return symbols.get(request.address) ?? "TKN";
      if (request.functionName === "decimals") return request.address === usdc ? 6 : 18;
      if (request.functionName === "balanceOf") {
        if (request.address === pool || request.address === nativePool) return 10_000_000_000_000_000_000n;
        return request.address === usdc ? 1_000_000n : 0n;
      }
      if (request.functionName === "allowance") return 0n;
      throw new Error(`Unexpected read ${request.functionName} on ${request.address}`);
    },
  } as PledgeCashReadClient;
}

function amountsOut(args: readonly unknown[] | undefined): readonly bigint[] {
  const [amountIn, path] = args as [bigint, readonly Address[]] | [];
  if (!amountIn || !path) throw new Error("Missing getAmountsOut args");
  if (path[0] === whype && path[1] === share) return [amountIn, amountIn * 2n] as const;
  if (path[0] === share && path[1] === whype) return [amountIn, amountIn / 2n] as const;
  return [amountIn, amountIn] as const;
}

function pairPool(args: readonly unknown[] | undefined): Address {
  const [tokenA, tokenB] = args ?? [];
  if ((tokenA === whype && tokenB === share) || (tokenA === share && tokenB === whype)) return nativePool;
  return pool;
}

function indexedPoolAddress(index: bigint): Address {
  return `0x${(index + 1_000n).toString(16).padStart(40, "0")}` as Address;
}
