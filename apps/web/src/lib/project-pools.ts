import { isZeroAddress, type Address } from "@pledge.cash/sdk";
import type { ParticipationContentKey } from "../features/participation/types";
import type { ProductBoardroomDashboardState } from "./product-boardroom";
import type { SwapTokenListState } from "./swap";

type PoolIdentity = {
  address: Address;
  exists?: boolean | undefined;
};

export function projectPoolAddresses(dashboard: ProductBoardroomDashboardState | undefined): Address[] {
  if (!dashboard) return [];
  const candidates = [
    ...(dashboard.histories ?? []).map((history) => history.pool),
    ...dashboard.snapshot.lockedLiquiditySummaries.map((locker) => locker.state?.pool),
    dashboard.history?.pool,
    dashboard.catalog.find((entry) => sameAddress(entry.address, dashboard.address))?.pool,
  ];
  const byAddress = new Map<string, Address>();
  for (const address of candidates) {
    if (address && !isZeroAddress(address)) byAddress.set(address.toLowerCase(), address);
  }
  return [...byAddress.values()].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
}

export function participationPoolAddress(
  route: ParticipationContentKey | undefined,
  allowedPools: readonly Address[],
): Address | undefined {
  if (!route?.startsWith("amm:")) return undefined;
  const requested = route.slice(4);
  return allowedPools.find((pool) => pool.toLowerCase() === requested.toLowerCase());
}

export function scopeSwapTokenList(
  tokenList: SwapTokenListState,
  allowedPools: readonly Address[],
): SwapTokenListState {
  const allowed = new Set(allowedPools.map((address) => address.toLowerCase()));
  const pools = tokenList.pools.filter((pool) => allowed.has(pool.address.toLowerCase()));
  const tokenAddresses = new Set(pools.flatMap((pool) => [pool.token0.toLowerCase(), pool.token1.toLowerCase()]));
  const pairAddresses = new Set(pools.flatMap((pool) => [pool.token0.toLowerCase(), pool.token1.toLowerCase()]));

  return {
    ...tokenList,
    pools,
    tokens: tokenList.tokens
      .filter((token) => tokenAddresses.has(token.address.toLowerCase()))
      .map((token) => ({
        ...token,
        pools: token.pools.filter((pool) => allowed.has(pool.toLowerCase())),
        pairAddresses: token.pairAddresses.filter((pair) => pairAddresses.has(pair.toLowerCase())),
      })),
  };
}

export function assertProjectPoolAllowed(
  pool: PoolIdentity | undefined,
  allowedPools: readonly Address[],
  label: string,
): asserts pool is PoolIdentity {
  if (!pool || pool.exists === false) {
    throw new Error(`${label} requires an existing project AMM pool.`);
  }
  if (!allowedPools.some((allowed) => sameAddress(allowed, pool.address))) {
    throw new Error(`${label} is not scoped to an AMM pool owned by this project.`);
  }
}

function sameAddress(first: Address, second: Address): boolean {
  return first.toLowerCase() === second.toLowerCase();
}
