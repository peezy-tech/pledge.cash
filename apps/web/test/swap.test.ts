import { describe, expect, test } from "bun:test";
import type { Address, PledgeCashReadClient } from "@pledge.cash/sdk";
import type { Hex } from "viem";
import {
  assertFutureSwapDeadline,
  buildAddLiquidityTransaction,
  buildRemoveLiquidityTransaction,
  buildSwapTransaction,
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
const quoter = "0x7100000000000000000000000000000000000000" as Address;
const stateView = "0x7200000000000000000000000000000000000000" as Address;
const permit2 = "0x7300000000000000000000000000000000000000" as Address;
const poolManager = "0x7400000000000000000000000000000000000000" as Address;
const hook = "0x7500000000000000000000000000000000000000" as Address;
const protocolFeeRecipient = "0x7600000000000000000000000000000000000000" as Address;
const poolId = `0x${"11".repeat(32)}` as Hex;
const positionSalt = `0x${"22".repeat(32)}` as Hex;
const zeroAddress = "0x0000000000000000000000000000000000000000" as Address;
const q96 = 1n << 96n;
const deployment = {
  chainId: 31337,
  deploymentBlock: 0n,
  permit2,
  pledgeV4LiquidityFactory: factory,
  uniswapUniversalRouter: router,
  uniswapV4PoolManager: poolManager,
  uniswapV4Quoter: quoter,
  uniswapV4StateView: stateView,
  wrappedNative: whype,
};

describe("Uniswap v4 token discovery", () => {
  test("lists canonical vault currencies plus deployment wrapped native", async () => {
    const state = await readSwapTokenList(fakeReadClient(), deployment, account, {
      wrappedNativeLabel: "WHYPE",
    });

    expect(state.error).toBeUndefined();
    expect(state.pools).toHaveLength(1);
    expect(state.pools[0]).toMatchObject({ address: pool, poolId, token0: usdc, token1: share });
    expect(state.tokens.map((token) => token.address).sort()).toEqual([share, usdc, whype].sort());

    const cash = state.tokens.find((token) => token.address === usdc);
    expect(cash?.sources).toEqual(["pool"]);
    expect(cash?.pairAddresses).toEqual([share]);
    expect(cash?.balance).toBe(10_000_000n);

    const wrappedNative = state.tokens.find((token) => token.address === whype);
    expect(wrappedNative?.label).toBe("WHYPE");
    expect(wrappedNative?.sources).toEqual(["deployment"]);
    expect(wrappedNative?.pools).toHaveLength(0);
  });

  test("uses the active-chain wrapped native label", async () => {
    const state = await readSwapTokenList(fakeReadClient(), deployment, account, {
      wrappedNativeLabel: "WMON",
    });

    expect(state.tokens.find((token) => token.address === whype)?.label).toBe("WMON");
  });

  test("keeps the newest 500 canonical v4 pools from event discovery", async () => {
    const logs = Array.from({ length: 501 }, (_, index) => liquidityCreatedLog(BigInt(index)));
    const state = await readSwapTokenList(fakeReadClient({ logs }), deployment);

    expect(state.pools).toHaveLength(500);
    expect(state.pools[0]?.address).toBe(indexedVaultAddress(500n));
    expect(state.pools.at(-1)?.address).toBe(indexedVaultAddress(1n));
    expect(state.pools.some((candidate) => candidate.address === indexedVaultAddress(0n))).toBe(false);
    expect(state.error).toBe("Only the newest 500 canonical v4 pools are shown.");
  });

  test("unions an exact pinned vault beyond the global discovery window", async () => {
    const logs = Array.from({ length: 501 }, (_, index) => liquidityCreatedLog(BigInt(index)));
    const oldestVault = indexedVaultAddress(0n);
    const state = await readSwapTokenList(fakeReadClient({ logs }), deployment, undefined, {
      pinnedPools: [oldestVault],
    });

    expect(state.pools).toHaveLength(501);
    expect(state.pools.some((candidate) => candidate.address === oldestVault)).toBe(true);
    expect(state.tokens.find((token) => token.address === share)?.pools).toContain(oldestVault);
  });

  test("reads only exact pinned vaults without scanning global events", async () => {
    const pinnedVault = indexedVaultAddress(501n);
    let logReads = 0;
    let vaultHydrations = 0;
    const base = fakeReadClient();
    const client = {
      ...base,
      async getLogs() {
        logReads += 1;
        return [];
      },
      async readContract(request: unknown) {
        const parsed = request as { address: Address; functionName: string };
        if (parsed.address === pinnedVault && parsed.functionName === "factory") vaultHydrations += 1;
        return await base.readContract(request as never);
      },
    } as FakeClient;

    const state = await readSwapTokenList(client, deployment, undefined, {
      discoveryMode: "pinned-only",
      pinnedPools: [pinnedVault],
    });

    expect(logReads).toBe(0);
    expect(vaultHydrations).toBe(1);
    expect(state.pools.map((candidate) => candidate.address)).toEqual([pinnedVault]);
  });

  test("retains the newest 64 pinned vaults in deterministic input order", async () => {
    const discoveryOrder = Array.from({ length: 66 }, (_, index) =>
      indexedVaultAddress(BigInt((index * 17) % 66)));
    const firstVault = discoveryOrder[0]!;
    const requested = [...discoveryOrder, `0x${firstVault.slice(2).toUpperCase()}` as Address];
    const state = await readSwapTokenList(fakeReadClient(), deployment, undefined, {
      discoveryMode: "pinned-only",
      pinnedPools: requested,
    });

    expect(state.pools.map((candidate) => candidate.address)).toEqual(discoveryOrder.slice(-64));
    expect(state.error).toBe("Only the newest 64 project pools can be pinned at once.");
  });

  test("preserves the caller abort reason before issuing reads", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Project changed.", "AbortError"));
    let reads = 0;
    const base = fakeReadClient();
    const client = {
      ...base,
      async readContract(request: unknown) {
        reads += 1;
        return await base.readContract(request as never);
      },
    } as FakeClient;

    await expect(readSwapTokenList(client, deployment, account, {
      discoveryMode: "pinned-only",
      pinnedPools: [pool],
      signal: controller.signal,
    })).rejects.toThrow("Project changed");
    expect(reads).toBe(0);
  });

  test("bounds concurrent vault and StateView hydration", async () => {
    const logs = Array.from({ length: 40 }, (_, index) => liquidityCreatedLog(BigInt(index)));
    const base = fakeReadClient({ logs });
    let activeVaultReads = 0;
    let activeStateReads = 0;
    let maxVaultReads = 0;
    let maxStateReads = 0;
    const client = {
      ...base,
      async readContract(request: unknown) {
        const parsed = request as { address: Address; functionName: string };
        if (parsed.functionName === "factory" && parsed.address !== factory) {
          activeVaultReads += 1;
          maxVaultReads = Math.max(maxVaultReads, activeVaultReads);
          await new Promise((resolve) => setTimeout(resolve, 0));
          activeVaultReads -= 1;
        }
        if (parsed.address === stateView && parsed.functionName === "getSlot0") {
          activeStateReads += 1;
          maxStateReads = Math.max(maxStateReads, activeStateReads);
          await new Promise((resolve) => setTimeout(resolve, 0));
          activeStateReads -= 1;
        }
        return await base.readContract(request as never);
      },
    } as FakeClient;

    await readSwapTokenList(client, deployment);

    expect(maxVaultReads).toBeLessThanOrEqual(8);
    expect(maxStateReads).toBeLessThanOrEqual(8);
  });
});

describe("Uniswap v4 swap and P4LP helpers", () => {
  test("fails closed before building a transaction with an expired deadline", () => {
    expect(() => assertFutureSwapDeadline("1000", 1000)).toThrow("transaction window expired");
    expect(() => assertFutureSwapDeadline("1001", 1000)).not.toThrow();
  });

  test("quotes through the v4 Quoter and builds a Universal Router command", async () => {
    const form = {
      tokenIn: share,
      tokenOut: usdc,
      amountIn: "1",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: false,
    };
    const quote = await readSwapQuote(fakeReadClient(), deployment, form, account);

    expect(quote.error).toBeUndefined();
    expect(quote.amountIn).toBe(1_000_000_000_000_000_000n);
    expect(quote.amountOut).toBe(2_000_000n);
    expect(quote.amountOutMin).toBe(1_990_000n);
    expect(quote.feeBps).toBe(3_000n);
    expect(quote.feeDenominator).toBe(1_000_000n);
    expect(quote.gasEstimate).toBe(123_456n);
    expect(quote.effectiveExecutionPrice?.status).toBe("known");

    const transaction = buildSwapTransaction({ deployment, form, quote, account });
    expect(transaction.address).toBe(router);
    expect(transaction.functionName).toBe("execute");
    expect(transaction.args[0]).toBe("0x10");
    expect(transaction.args[1]).toHaveLength(1);
    expect(transaction.args[2]).toBe(1_700_000_000n);
  });

  test("rejects native routing until explicit Universal Router wrap actions exist", async () => {
    const form = {
      tokenIn: whype,
      tokenOut: share,
      amountIn: "1",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: true,
    };
    const quote = await readSwapQuote(fakeReadClient(), deployment, form, account);

    expect(quote.error).toContain("wrap native currency first");
    expect(() => buildSwapTransaction({ deployment, form, quote, account })).toThrow("Wrap native currency");
  });

  test("rejects zero-output quotes and does not call the Quoter for zero-liquidity pools", async () => {
    const form = {
      tokenIn: share,
      tokenOut: usdc,
      amountIn: "0.000000000000000001",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: false,
    };
    const zeroOutput = await readSwapQuote(fakeReadClient({ quoteOut: 0n }), deployment, form, account);
    expect(zeroOutput.amountIn).toBe(1n);
    expect(zeroOutput.amountOut).toBe(0n);
    expect(zeroOutput.error).toBe("Swap output would be zero.");

    let quoterReads = 0;
    const base = fakeReadClient({ poolLiquidity: 0n });
    const client = {
      ...base,
      async readContract(request: unknown) {
        const parsed = request as { address: Address };
        if (parsed.address === quoter) quoterReads += 1;
        return await base.readContract(request as never);
      },
    } as FakeClient;
    const zeroLiquidity = await readSwapQuote(client, deployment, { ...form, amountIn: "1" }, account);
    expect(zeroLiquidity.error).toContain("no active liquidity");
    expect(zeroLiquidity.effectiveExecutionPrice?.status).toBe("unavailable");
    expect(quoterReads).toBe(0);
  });

  test("fails closed when factory and vault disagree on the token pair", async () => {
    const base = fakeReadClient();
    const client = {
      ...base,
      async readContract(request: unknown) {
        const parsed = request as { address: Address; functionName: string };
        if (parsed.address === pool && parsed.functionName === "currency1") return whype;
        return await base.readContract(request as never);
      },
    } as FakeClient;
    const quote = await readSwapQuote(client, deployment, {
      tokenIn: share,
      tokenOut: usdc,
      amountIn: "1",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: false,
    }, account);

    expect(quote.error).toContain("does not match the requested token pair");
    expect(quote.amountOut).toBeUndefined();
  });

  test("quotes an active P4LP deposit and builds the vault transaction", async () => {
    const form = {
      tokenA: usdc,
      tokenB: share,
      amountA: "1",
      amountB: "3",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: false,
    };
    const quote = await readLiquidityQuote(fakeReadClient(), deployment, form, account);

    expect(quote.error).toBeUndefined();
    expect(quote.pool).toMatchObject({ address: pool, poolId, liquidityState: 1 });
    expect(quote.amountA).toBeGreaterThan(0n);
    expect(quote.amountA).toBeLessThanOrEqual(1_000_000n);
    expect(quote.amountB).toBeGreaterThan(0n);
    expect(quote.amountB).toBeLessThanOrEqual(3_000_000_000_000_000_000n);
    expect(quote.liquidityOut).toBeGreaterThan(0n);

    const transaction = buildAddLiquidityTransaction({ deployment, form, quote, account });
    expect(transaction.address).toBe(pool);
    expect(transaction.functionName).toBe("depositLiquidityForClaims");
    expect(transaction.args[0]).toBe(1_000_000n);
    expect(transaction.args[1]).toBe(3_000_000_000_000_000_000n);
    expect(transaction.args[4]).toBe(account);
    expect(transaction.args[5]).toBe(1_700_000_000n);
  });

  test("reads P4LP ownership and redeems claims only during wind-down claims mode", async () => {
    const activePosition = await readAmmPosition(fakeReadClient(), deployment, usdc, share, account);
    expect(activePosition?.error).toBeUndefined();
    expect(activePosition?.lpToken?.symbol).toBe("P4LP");
    expect(activePosition?.lpBalance).toBe(10_000_000_000_000_000_000n);
    expect(activePosition?.poolShareBps).toBe(1_000n);
    expect(activePosition?.claimableA).toBeUndefined();
    expect(activePosition?.claimableB).toBeUndefined();

    const pairForm = {
      tokenA: usdc,
      tokenB: share,
      amountA: "1",
      amountB: "1",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: false,
    };
    const removeForm = {
      liquidity: "5",
      slippageBps: "100",
      recipient: "",
      deadline: "1700000100",
      useNative: false,
    };
    const activeQuote = await readRemoveLiquidityQuote(fakeReadClient(), deployment, pairForm, removeForm, account);
    expect(activeQuote.error).toContain("wind-down claims mode");

    const quote = await readRemoveLiquidityQuote(
      fakeReadClient({ liquidityState: 2 }),
      deployment,
      pairForm,
      removeForm,
      account,
    );
    expect(quote.error).toBeUndefined();
    expect(quote.liquidity).toBe(5_000_000_000_000_000_000n);
    expect(quote.amountA).toBeGreaterThan(0n);
    expect(quote.amountB).toBeGreaterThan(0n);

    const transaction = buildRemoveLiquidityTransaction({ deployment, form: removeForm, quote, account });
    expect(transaction.address).toBe(pool);
    expect(transaction.functionName).toBe("redeemClaims");
    expect(transaction.args[0]).toBe(5_000_000_000_000_000_000n);
    expect(transaction.args[3]).toBe(account);
    expect(transaction.args[4]).toBe(1_700_000_100n);
  });

  test("includes the claim's pro-rata idle vault backing in redemption output", async () => {
    const pairForm = {
      tokenA: usdc,
      tokenB: share,
      amountA: "1",
      amountB: "1",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: false,
    };
    const removeForm = {
      liquidity: "5",
      slippageBps: "100",
      recipient: "",
      deadline: "1700000100",
      useNative: false,
    };
    const withoutBacking = await readRemoveLiquidityQuote(
      fakeReadClient({ liquidityState: 2 }), deployment, pairForm, removeForm, account,
    );
    const withBacking = await readRemoveLiquidityQuote(
      fakeReadClient({ liquidityState: 2, vaultBalanceA: 10_000_000n, vaultBalanceB: 10_000_000_000_000_000_000n }),
      deployment,
      pairForm,
      removeForm,
      account,
    );

    expect(withBacking.amountA! - withoutBacking.amountA!).toBe(500_000n);
    expect(withBacking.amountB! - withoutBacking.amountB!).toBe(500_000_000_000_000_000n);
  });

  test("rejects dust P4LP claims that round down to zero position liquidity", async () => {
    const quote = await readRemoveLiquidityQuote(fakeReadClient({ liquidityState: 2, positionLiquidity: 1n }), deployment, {
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
    expect(quote.error).toBe("P4LP amount is too small for this position.");
  });

  test("rejects native P4LP deposit and redemption paths", async () => {
    const pairForm = {
      tokenA: whype,
      tokenB: share,
      amountA: "1",
      amountB: "3",
      slippageBps: "50",
      recipient: "",
      deadline: "1700000000",
      useNative: true,
    };
    const addQuote = await readLiquidityQuote(fakeReadClient(), deployment, pairForm, account);
    expect(addQuote.error).toContain("wrap native currency first");
    expect(() => buildAddLiquidityTransaction({ deployment, form: pairForm, quote: addQuote, account }))
      .toThrow("Wrap native currency");

    const removeForm = {
      liquidity: "5",
      slippageBps: "100",
      recipient: "",
      deadline: "1700000100",
      useNative: true,
    };
    const removeQuote = await readRemoveLiquidityQuote(fakeReadClient({ liquidityState: 2 }), deployment, pairForm, removeForm, account);
    expect(removeQuote.error).toContain("unwrap wrapped native separately");
    expect(() => buildRemoveLiquidityTransaction({ deployment, form: removeForm, quote: removeQuote, account }))
      .toThrow("wrapped ERC20 tokens");
  });

  test("rejects invalid slippage before executable quotes are produced", async () => {
    const swapQuote = await readSwapQuote(fakeReadClient(), deployment, {
      tokenIn: share,
      tokenOut: usdc,
      amountIn: "1",
      slippageBps: "abc",
      recipient: "",
      deadline: "1700000000",
      useNative: false,
    }, account);
    expect(swapQuote.amountOut).toBeUndefined();
    expect(swapQuote.error).toBe("Slippage must be a whole number of basis points.");

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
    expect(addQuote.error).toBe("Slippage must be between 0 and 9,999 basis points.");
  });
});

type FakeClient = PledgeCashReadClient & {
  getBlockNumber: () => Promise<bigint>;
  getLogs: (request: unknown) => Promise<unknown[]>;
};

function fakeReadClient(options: {
  liquidityState?: number;
  logs?: unknown[];
  poolLiquidity?: bigint;
  positionLiquidity?: bigint;
  quoteOut?: bigint;
  vaultBalanceA?: bigint;
  vaultBalanceB?: bigint;
} = {}): FakeClient {
  const symbols = new Map<Address, string>([
    [usdc, "USDC"],
    [share, "PLDG"],
    [whype, "WHYPE"],
  ]);

  return {
    async getBlockNumber() {
      return 1_000n;
    },
    async getLogs() {
      return options.logs ?? [liquidityCreatedLog(-1n)];
    },
    async readContract(rawRequest: unknown): Promise<unknown> {
      const request = rawRequest as { address: Address; functionName: string; args?: readonly unknown[] };
      if (request.address === factory && request.functionName === "poolIdFor") return poolId;
      if (request.address === factory && request.functionName === "vaultForPoolId") return pool;
      if (request.address === stateView && request.functionName === "getSlot0") {
        return [q96, 0, 0, 3_000] as const;
      }
      if (request.address === stateView && request.functionName === "getLiquidity") {
        return options.poolLiquidity ?? 100_000_000_000_000_000_000n;
      }
      if (request.address === quoter && request.functionName === "quoteExactInputSingle") {
        return [options.quoteOut ?? 2_000_000n, 123_456n] as const;
      }
      if (request.address === permit2 && request.functionName === "allowance") {
        return [(1n << 159n), Math.floor(Date.now() / 1000) + 3_600, 0] as const;
      }

      if (isVaultAddress(request.address)) {
        const vaultPoolId = poolIdForVault(request.address);
        if (request.functionName === "factory") return factory;
        if (request.functionName === "boardroom") return account;
        if (request.functionName === "poolManager") return poolManager;
        if (request.functionName === "protocolFeeRecipient") return protocolFeeRecipient;
        if (request.functionName === "tokenA" || request.functionName === "currency0") return usdc;
        if (request.functionName === "tokenB" || request.functionName === "currency1") return share;
        if (request.functionName === "hook") return hook;
        if (request.functionName === "poolId") return vaultPoolId;
        if (request.functionName === "positionSalt") return positionSalt;
        if (request.functionName === "tickLower") return -887_220;
        if (request.functionName === "tickUpper") return 887_220;
        if (request.functionName === "poolFee") return 3_000;
        if (request.functionName === "tickSpacing") return 60;
        if (request.functionName === "liquidityState") return options.liquidityState ?? 1;
        if (request.functionName === "positionLiquidity") {
          return options.positionLiquidity ?? 100_000_000_000_000_000_000n;
        }
        if (request.functionName === "totalSupply") return 100_000_000_000_000_000_000n;
        if (request.functionName === "symbol") return "P4LP";
        if (request.functionName === "decimals") return 18;
        if (request.functionName === "balanceOf") return 10_000_000_000_000_000_000n;
      }

      if (request.functionName === "symbol") return symbols.get(request.address) ?? "TKN";
      if (request.functionName === "decimals") return request.address === usdc ? 6 : 18;
      if (request.functionName === "balanceOf") {
        const holder = request.args?.[0];
        if (request.address === usdc) {
          return holder === pool ? (options.vaultBalanceA ?? 0n) : 10_000_000n;
        }
        if (request.address === share) {
          return holder === pool ? (options.vaultBalanceB ?? 0n) : 10_000_000_000_000_000_000n;
        }
        if (request.address === whype) return 10_000_000_000_000_000_000n;
        return 0n;
      }
      if (request.functionName === "allowance") return 1n << 159n;
      throw new Error(`Unexpected read ${request.functionName} on ${request.address}`);
    },
  } as FakeClient;
}

function liquidityCreatedLog(index: bigint) {
  const indexed = index >= 0n;
  const vault = indexed ? indexedVaultAddress(index) : pool;
  const id = indexed ? indexedPoolId(index) : poolId;
  const blockNumber = indexed ? index + 1n : 1n;
  return {
    args: {
      amountA: 1n,
      amountB: 1n,
      boardroom: account,
      curve: zeroAddress,
      liquidity: 1n,
      poolId: id,
      quoteAsset: usdc,
      salt: positionSalt,
      sqrtPriceX96: q96,
      vault,
    },
    blockNumber,
    logIndex: 0,
    transactionHash: `0x${blockNumber.toString(16).padStart(64, "0")}` as Hex,
  };
}

function isVaultAddress(address: Address): boolean {
  if (address.toLowerCase() === pool.toLowerCase()) return true;
  const value = BigInt(address);
  return value >= 1_000n && value < 10_000n;
}

function poolIdForVault(vault: Address): Hex {
  if (vault.toLowerCase() === pool.toLowerCase()) return poolId;
  return indexedPoolId(BigInt(vault) - 1_000n);
}

function indexedVaultAddress(index: bigint): Address {
  return `0x${(index + 1_000n).toString(16).padStart(40, "0")}` as Address;
}

function indexedPoolId(index: bigint): Hex {
  return `0x${(index + 1n).toString(16).padStart(64, "0")}` as Hex;
}
