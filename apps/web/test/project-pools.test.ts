import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import {
  assertProjectPoolAllowed,
  participationPoolAddress,
  projectPoolAddresses,
  scopeSwapTokenList,
} from "../src/lib/project-pools";
import type { ProductBoardroomDashboardState } from "../src/lib/product-boardroom";
import type { SwapTokenListState } from "../src/lib/swap";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const poolA = "0x2000000000000000000000000000000000000000" as Address;
const poolB = "0x3000000000000000000000000000000000000000" as Address;
const foreignPool = "0x4000000000000000000000000000000000000000" as Address;
const tokenA = "0x5000000000000000000000000000000000000000" as Address;
const tokenB = "0x6000000000000000000000000000000000000000" as Address;
const foreignToken = "0x7000000000000000000000000000000000000000" as Address;

describe("project AMM scope", () => {
  const dashboard = {
    address: boardroom,
    catalog: [{ address: boardroom, pool: poolB }],
    histories: [{ pool: poolB }, { pool: poolA }],
    history: { pool: "0x0000000000000000000000000000000000000000" },
    snapshot: { lockedLiquiditySummaries: [{ state: { pool: poolA } }] },
  } as unknown as ProductBoardroomDashboardState;

  test("derives a deterministic unique set and resolves address-scoped AMM routes", () => {
    const pools = projectPoolAddresses(dashboard);

    expect(pools).toEqual([poolA, poolB]);
    expect(participationPoolAddress(`amm:${poolB.toLowerCase()}` as const, pools)).toBe(poolB);
    expect(participationPoolAddress(`amm:${foreignPool.toLowerCase()}` as const, pools)).toBeUndefined();
  });

  test("removes foreign pools and rejects stale or non-project write quotes", () => {
    const tokenList = {
      loaded: true,
      pools: [
        { address: poolA, token0: tokenA, token1: tokenB, reserve0: 1n, reserve1: 1n },
        { address: foreignPool, token0: tokenA, token1: foreignToken, reserve0: 1n, reserve1: 1n },
      ],
      tokens: [
        { address: tokenA, pools: [poolA, foreignPool], pairAddresses: [tokenB, foreignToken], sources: ["pool"] },
        { address: tokenB, pools: [poolA], pairAddresses: [tokenA], sources: ["pool"] },
        { address: foreignToken, pools: [foreignPool], pairAddresses: [tokenA], sources: ["pool"] },
      ],
    } as SwapTokenListState;

    const scoped = scopeSwapTokenList(tokenList, [poolA]);
    expect(scoped.pools.map((pool) => pool.address)).toEqual([poolA]);
    expect(scoped.tokens.map((token) => token.address)).toEqual([tokenA, tokenB]);
    expect(scoped.tokens[0]?.pools).toEqual([poolA]);
    expect(() => assertProjectPoolAllowed({ address: foreignPool, exists: true }, [poolA], "Quote")).toThrow("not scoped");
    expect(() => assertProjectPoolAllowed({ address: poolA, exists: false }, [poolA], "Quote")).toThrow("existing");
    expect(() => assertProjectPoolAllowed({ address: poolA, exists: true }, [poolA], "Quote")).not.toThrow();
  });
});
