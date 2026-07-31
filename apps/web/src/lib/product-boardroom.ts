import {
  boardroomAbi,
  boardroomFactoryAbi,
  dutchAuctionSaleAbi,
  erc20Abi,
  fixedPriceSaleAbi,
  isZeroAddress,
  migratingBondingCurveAbi,
  readProtocolLiquidityVaultState,
  readUniswapV4PoolState,
  type Address,
  type PledgeCashDeployment,
  type PledgeCashReadClient,
} from "@pledge.cash/sdk";
import { getAbiItem, isAddress, parseAbi, type AbiEvent, type Hex, type PublicClient } from "viem";
import {
  PRODUCT_DETAIL_CHILD_READ_LIMIT,
  readBoardroomCatalogSnapshot,
  readBoardroomSnapshot,
  type BoardroomCatalogSnapshot,
} from "./boardroom-snapshot";
import { errorMessage } from "./forms";
import { currentUnixTimestamp, deriveExecutableDistributionRoute } from "./market-data";
import { formatNativeTokenAmount, formatTokenAmount } from "./token-amounts";
import type {
  BoardroomDistributionSnapshot,
  BoardroomGrantSnapshot,
  BoardroomLockedLiquiditySnapshot,
  BoardroomSnapshot,
} from "./types";

export type ProductBoardroomCatalogEntry = {
  address: Address;
  boardroomStatus?: number | undefined;
  buyerCount?: number | undefined;
  buyCount?: number | undefined;
  cashRaised?: bigint | undefined;
  cashToken?: Address | undefined;
  cashTokenDecimals?: number | undefined;
  cashTokenSymbol?: string | undefined;
  distribution?: Address | undefined;
  distributionAddresses?: Address[] | undefined;
  distributionCount?: number | undefined;
  distributionKind?: string | undefined;
  error?: string | undefined;
  historyError?: string | undefined;
  liquidity?: bigint | undefined;
  locker?: Address | undefined;
  name?: string | undefined;
  path?: string | undefined;
  pool?: Address | undefined;
  poolError?: string | undefined;
  poolReserve0?: bigint | undefined;
  poolReserve1?: bigint | undefined;
  poolLiquidity?: bigint | undefined;
  poolPositionLiquidity?: bigint | undefined;
  poolSqrtPriceX96?: bigint | undefined;
  poolTickLower?: number | undefined;
  poolTickUpper?: number | undefined;
  poolToken0?: Address | undefined;
  poolToken1?: Address | undefined;
  quoteToBoardroom?: bigint | undefined;
  quoteToLiquidity?: bigint | undefined;
  routeBuyInventory?: bigint | undefined;
  routeClaimInventory?: bigint | undefined;
  routeClosed?: boolean | undefined;
  routeEndTime?: bigint | undefined;
  routeGraduationLatched?: boolean | undefined;
  routeQuoteReserve?: bigint | undefined;
  routeSellInventory?: bigint | undefined;
  routeStartTime?: bigint | undefined;
  routeStatus?: number | undefined;
  sellCount?: number | undefined;
  shareToken?: Address | undefined;
  shareTokenDecimals?: number | undefined;
  shareTokenTotalSupply?: bigint | undefined;
  shareTokenTreasuryBalance?: bigint | undefined;
  sharesToLiquidity?: bigint | undefined;
  soldShares?: bigint | undefined;
  status?: string | undefined;
  swapCount?: number | undefined;
  symbol?: string | undefined;
  treasuryCash?: bigint | undefined;
};

export type ProductBoardroomCatalogPageInput = {
  /** Exclusive factory index to continue reading toward older Boardrooms. */
  cursor?: number | undefined;
  /** Requested page size. Values above the runtime maximum are capped. */
  limit?: number | undefined;
  /** Factory count captured by the first page. Keeps later cursors on the same append-only snapshot. */
  snapshotCount?: number | undefined;
  /** Cancels historical enrichment without cancelling the exact current-state read. */
  signal?: AbortSignal | undefined;
  /** Aggregate historical enrichment deadline for this catalog page. */
  timeoutMs?: number | undefined;
};

export type ProductBoardroomCatalogPage = {
  entries: ProductBoardroomCatalogEntry[];
  nextCursor?: number | undefined;
  snapshotCount: number;
  totalCount: number;
};

export type ProductBoardroomFactoryPage = {
  addresses: Address[];
  nextCursor?: number | undefined;
  snapshotCount: number;
  totalCount: number;
};

export type ProductBoardroomHistory = {
  amm?: ProductBoardroomAmmHistory | undefined;
  buyerCount?: number | undefined;
  cashRaised?: bigint | undefined;
  completeness?: "complete" | "partial" | "state-derived" | undefined;
  curve?: ProductBoardroomCurveHistory | undefined;
  distribution?: Address | undefined;
  dutchAuction?: ProductBoardroomFixedPriceSaleHistory | undefined;
  fixedPriceSale?: ProductBoardroomFixedPriceSaleHistory | undefined;
  pool?: Address | undefined;
  scanError?: string | undefined;
  soldShares?: bigint | undefined;
};

export type ProductBoardroomFixedPriceSaleHistory = {
  buyerCount: number;
  cashRaised: bigint;
  purchaseCount: number;
  soldShares: bigint;
};

export type ProductBoardroomCurveHistory = {
  buyerCount?: number | undefined;
  buyCount?: number | undefined;
  cashRaised?: bigint | undefined;
  migration?: ProductBoardroomCurveMigrationHistory | undefined;
  quotePaid?: bigint | undefined;
  quoteReturned?: bigint | undefined;
  sellCount?: number | undefined;
  soldShares?: bigint | undefined;
};

export type ProductBoardroomCurveMigrationHistory = {
  liquidity: bigint;
  locker: Address;
  pool: Address;
  poolId: Hex;
  quoteToBoardroom: bigint;
  quoteToLiquidity: bigint;
  sharesToLiquidity: bigint;
};

export type ProductBoardroomAmmHistory = {
  amount0In: bigint;
  amount0Out: bigint;
  amount1In: bigint;
  amount1Out: bigint;
  swapCount: number;
  traderCount: number;
};

export type ProductTreasuryAsset = {
  address: Address;
  label: string;
  balance?: bigint;
  decimals?: number;
  symbol?: string;
  totalSupply?: bigint;
  error?: string;
};

export type ProductBoardroomDashboardState = {
  address: Address;
  catalog: ProductBoardroomCatalogEntry[];
  currentStateCoverage?: ProductBoardroomCurrentStateCoverage | undefined;
  history?: ProductBoardroomHistory | undefined;
  historyErrors?: string[] | undefined;
  histories?: ProductBoardroomHistory[] | undefined;
  nativeBalance: bigint;
  snapshot: BoardroomSnapshot;
  treasuryAssets: ProductTreasuryAsset[];
};

export type ProductBoardroomChildCoverage = {
  complete: boolean;
  shown: number;
  total: number;
};

export type ProductBoardroomCurrentStateCoverage = {
  distributions: ProductBoardroomChildCoverage;
  grants: ProductBoardroomChildCoverage;
  lockedLiquidity: ProductBoardroomChildCoverage;
  redeemableAssets: ProductBoardroomChildCoverage;
};

export type ProductBoardroomHistoryReadOptions = {
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
};

type ProductBoardroomClient =
  & PledgeCashReadClient
  & Pick<PublicClient, "getBalance" | "getBlockNumber">
  & Partial<Pick<PublicClient, "getBlock" | "getCode" | "getLogs">>;
type ProductBoardroomEventLog = {
  args?: Record<string, unknown>;
  blockNumber?: bigint | null | undefined;
};
const uniswapV4PoolManagerEventAbi = parseAbi([
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
]);

type ProductBoardroomEventAbi = typeof uniswapV4PoolManagerEventAbi | typeof boardroomAbi | typeof dutchAuctionSaleAbi | typeof fixedPriceSaleAbi | typeof migratingBondingCurveAbi;
type ProductBoardroomEventName = "CurveBuy" | "CurveMigrated" | "CurveSell" | "DutchAuctionPurchase" | "FixedPricePurchase" | "Swap";

type HistoricalDistributionHydration = {
  error?: string | undefined;
  snapshot: BoardroomSnapshot;
};

type EventLogCacheEntry = {
  checkpointHash?: Hex | undefined;
  logs: ProductBoardroomEventLog[];
  pending?: Promise<void> | undefined;
  pendingContext?: EventScanContext | undefined;
  toBlock?: bigint | undefined;
};

type ContractStartBlockCacheEntry =
  | { state: "pending"; request: Promise<bigint> }
  | { state: "resolved"; value: bigint };

type EventLogRequestBudget = {
  logsUsed: number;
  requestsUsed: number;
};

type EventScanContext = {
  budget: EventLogRequestBudget;
  deadlineAt?: number | undefined;
  failure?: Error | undefined;
  signal?: AbortSignal | undefined;
  terminationListeners: Set<() => void>;
  timeoutMs: number;
};

type CurveHistoryReadResult = {
  errors: string[];
  history?: ProductBoardroomCurveHistory | undefined;
};

type CatalogPoolRead =
  | {
      error?: string | undefined;
      liquidity?: bigint | undefined;
      poolId: Hex;
      positionLiquidity: bigint;
      sqrtPriceX96?: bigint | undefined;
      tickLower: number;
      tickUpper: number;
      token0: Address;
      token1: Address;
    }
  | { error: string };

const CATALOG_READ_CONCURRENCY = 8;
const DEFAULT_CATALOG_PAGE_SIZE = 4;
const MAX_CATALOG_PAGE_SIZE = 16;
const EVENT_LOG_CHUNK_SIZE = 100_000n;
const EVENT_LOG_CONCURRENCY = 2;
const EVENT_LOG_REORG_OVERLAP = 12n;
const EVENT_SCAN_TIMEOUT_MS = 8_000;
const MAX_CONTRACT_START_BLOCK_CACHE_ENTRIES = 128;
const MAX_EVENT_LOG_CACHE_ENTRIES = 64;
const MAX_EVENT_LOGS_PER_SCAN = 5_000;
const MAX_EVENT_LOG_REQUESTS_PER_SCAN = 512;
const MAX_EVENT_LOG_REORG_RETRIES = 1;
const MIN_EVENT_LOG_CHUNK_SIZE = 1n;
const WAD = 1_000_000_000_000_000_000n;
const contractStartBlockCache = new WeakMap<object, Map<string, ContractStartBlockCacheEntry>>();
const eventLogCache = new WeakMap<object, Map<string, EventLogCacheEntry>>();
const eventLogRangeLimitCache = new WeakMap<object, bigint>();

export async function readProductBoardroomDashboard(
  client: ProductBoardroomClient,
  input: {
    address: Address;
    catalog?: ProductBoardroomCatalogEntry[] | undefined;
    deployment?: PledgeCashDeployment | undefined;
  } & ProductBoardroomHistoryReadOptions,
): Promise<ProductBoardroomDashboardState> {
  const [currentSnapshot, nativeBalance] = await Promise.all([
    readBoardroomSnapshot(client, input.address, input.deployment),
    client.getBalance({ address: input.address }),
  ]);
  const eventScan = createEventScanContext(input);
  const hydration = await hydrateHistoricalDistributions(client, currentSnapshot, eventScan);
  const snapshot = hydration.snapshot;
  const inputCatalog = input.catalog ?? [];
  const activeCatalogEntry = inputCatalog.find((entry) => sameAddress(entry.address, input.address));
  // Exact routes must derive live identity from the exact Boardroom snapshot.
  // A cached directory row may describe a distribution that has since closed.
  const catalogIdentity = catalogEntryFromSnapshot(snapshot);
  const [treasuryAssets, histories, shareName] = await Promise.all([
    readTreasuryAssets(client, snapshot, catalogIdentity),
    readProductBoardroomHistoriesWithContext(client, snapshot, eventScan),
    activeCatalogEntry?.name ? Promise.resolve(activeCatalogEntry.name) : readOptionalTokenName(client, snapshot.shareToken),
  ]);
  const history = selectPrimaryHistory(histories, catalogIdentity);
  const currentPool = await readCatalogPool(client, input.deployment, catalogIdentity.pool ?? history?.pool);
  const historyErrors = uniqueMessages([
    hydration.error,
    ...(snapshot.summaryWarnings ?? []),
    ...histories.map((entry) => entry.scanError),
  ]);
  const catalogTreasuryCash = catalogIdentity.cashToken
    ? treasuryAssets.find((asset) => sameAddress(asset.address, catalogIdentity.cashToken))?.balance
    : undefined;
  const shareTokenAsset = treasuryAssets.find((asset) => sameAddress(asset.address, snapshot.shareToken));
  const freshCatalogEntry = catalogEntryFromSnapshot(snapshot, {
    currentPool,
    history,
    historyError: historyErrors.length > 0 ? historyErrors.join(" ") : undefined,
    name: shareName,
    shareTokenTotalSupply: shareTokenAsset?.totalSupply,
    shareTokenTreasuryBalance: shareTokenAsset?.balance,
    treasuryCash: catalogTreasuryCash,
  });
  const catalog = activeCatalogEntry
    ? inputCatalog.map((entry) => sameAddress(entry.address, input.address) ? freshCatalogEntry : entry)
    : [...inputCatalog, freshCatalogEntry];

  return {
    address: input.address,
    catalog,
    currentStateCoverage: currentStateCoverage(snapshot),
    ...(historyErrors.length > 0 ? { historyErrors } : {}),
    histories,
    history,
    nativeBalance,
    snapshot,
    treasuryAssets,
  };
}

export async function readProductBoardroomCatalogPage(
  client: ProductBoardroomClient,
  deployment: PledgeCashDeployment | undefined,
  input: ProductBoardroomCatalogPageInput = {},
): Promise<ProductBoardroomCatalogPage> {
  if (!deployment?.boardroomFactory) return { entries: [], snapshotCount: 0, totalCount: 0 };
  return await discoverProductBoardroomCatalogPage(
    client,
    { ...deployment, boardroomFactory: deployment.boardroomFactory },
    input,
  );
}

export function resolveProductBoardroomAddress(catalog: ProductBoardroomCatalogEntry[] = []): Address | undefined {
  const configured = import.meta.env.VITE_PLEDGE_CASH_PRODUCT_BOARDROOM_ADDRESS;
  if (typeof configured === "string" && isAddress(configured)) return configured;
  return catalog[0]?.address;
}

export function formatTokenBalance(asset: ProductTreasuryAsset): string {
  return formatTokenAmount(asset.balance, asset);
}

export function formatNativeBalance(balance: bigint): string {
  return formatNativeTokenAmount(balance);
}

async function readTreasuryAssets(
  client: PledgeCashReadClient,
  snapshot: BoardroomSnapshot,
  catalogEntry: ProductBoardroomCatalogEntry | undefined,
): Promise<ProductTreasuryAsset[]> {
  const labels = treasuryAssetLabels(snapshot, catalogEntry);

  return await mapInBatches(
    Array.from(labels.entries()),
    CATALOG_READ_CONCURRENCY,
    async ([address, label]) => await readTreasuryAsset(client, snapshot.address, address, label),
  );
}

function treasuryAssetLabels(
  snapshot: BoardroomSnapshot,
  catalogEntry: ProductBoardroomCatalogEntry | undefined,
): Map<Address, string> {
  const labels = new Map<Address, string>();

  addAsset(labels, snapshot.shareToken, "Treasury shares");
  addAsset(labels, snapshot.wrappedNative, "Wrapped native");
  addAsset(labels, catalogEntry?.cashToken, "Cash / quote");

  for (const distribution of snapshot.distributionSummaries) {
    addAsset(labels, distributionPaymentToken(distribution), "Cash / quote");
  }

  for (const asset of snapshot.redeemableAssets.slice(-PRODUCT_DETAIL_CHILD_READ_LIMIT)) {
    addAsset(labels, asset, "Redeemable asset");
  }

  for (const grant of snapshot.grantSummaries) {
    addGrantAssets(labels, grant, snapshot.shareToken);
  }

  return labels;
}

async function readTreasuryAsset(
  client: PledgeCashReadClient,
  holder: Address,
  address: Address,
  label: string,
): Promise<ProductTreasuryAsset> {
  try {
    const [balance, symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [holder] }),
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address, abi: erc20Abi, functionName: "totalSupply" }),
    ]);

    return {
      address,
      label,
      balance: balance as bigint,
      decimals: Number(decimals),
      symbol: symbol as string,
      totalSupply: totalSupply as bigint,
    };
  } catch (error) {
    return { address, label, error: errorMessage(error) };
  }
}

function addAsset(labels: Map<Address, string>, address: Address | undefined, label: string): void {
  if (!address || isZeroAddress(address)) return;
  const existing = Array.from(labels.keys()).find((key) => key.toLowerCase() === address.toLowerCase());
  if (existing) {
    if (labels.get(existing) === "Grant token" && label !== "Grant token") labels.set(existing, label);
    return;
  }
  labels.set(address, label);
}

function addGrantAssets(labels: Map<Address, string>, grant: BoardroomGrantSnapshot, shareToken: Address): void {
  if (!grant.state) return;
  const tokenLabel = sameAddress(grant.state.token, shareToken) ? "Treasury shares" : "Grant token";
  addAsset(labels, grant.state.token, tokenLabel);
  if (!isZeroAddress(grant.state.paymentToken)) {
    addAsset(labels, grant.state.paymentToken, "Revenue token");
  }
}

async function discoverProductBoardroomCatalogPage(
  client: ProductBoardroomClient,
  deployment: PledgeCashDeployment & { boardroomFactory: Address },
  input: ProductBoardroomCatalogPageInput,
): Promise<ProductBoardroomCatalogPage> {
  const factoryPage = await readFactoryBoardroomPage(client, deployment.boardroomFactory, input);
  const eventScan = createEventScanContext(input);
  const entries = await mapInBatches(
    uniqueAddresses(factoryPage.addresses),
    CATALOG_READ_CONCURRENCY,
    async (address) => await readProductBoardroomCatalogEntryWithContext(client, address, eventScan, deployment),
  );
  return {
    entries,
    ...(factoryPage.nextCursor === undefined ? {} : { nextCursor: factoryPage.nextCursor }),
    snapshotCount: factoryPage.snapshotCount,
    totalCount: factoryPage.totalCount,
  };
}

export async function readFactoryBoardroomPage(
  client: ProductBoardroomClient,
  factory: Address,
  input: ProductBoardroomCatalogPageInput = {},
): Promise<ProductBoardroomFactoryPage> {
  const rawCount = await client.readContract({
    address: factory,
    abi: boardroomFactoryAbi,
    functionName: "allBoardroomsLength",
  });
  const currentCount = safeCount(rawCount, "Boardroom count");
  const count = input.snapshotCount === undefined
    ? currentCount
    : Math.min(currentCount, safeSnapshotCount(input.snapshotCount));
  const limit = catalogPageLimit(input.limit);
  const end = catalogPageCursor(input.cursor, count);
  const start = Math.max(0, end - limit);
  const indexes = Array.from({ length: end - start }, (_, offset) => end - offset - 1);
  const addresses = await mapInBatches(indexes, CATALOG_READ_CONCURRENCY, async (index) =>
    (await client.readContract({
      address: factory,
      abi: boardroomFactoryAbi,
      functionName: "allBoardrooms",
      args: [BigInt(index)],
    })) as Address
  );

  return {
    addresses,
    ...(start > 0 ? { nextCursor: start } : {}),
    snapshotCount: count,
    totalCount: count,
  };
}

export async function readProductBoardroomCatalogEntry(
  client: ProductBoardroomClient,
  address: Address,
  options: ProductBoardroomHistoryReadOptions = {},
  deployment?: PledgeCashDeployment,
): Promise<ProductBoardroomCatalogEntry> {
  return await readProductBoardroomCatalogEntryWithContext(client, address, createEventScanContext(options), deployment);
}

async function readProductBoardroomCatalogEntryWithContext(
  client: ProductBoardroomClient,
  address: Address,
  eventScan: EventScanContext,
  deployment?: PledgeCashDeployment,
): Promise<ProductBoardroomCatalogEntry> {
  try {
    const currentSnapshot = await readBoardroomCatalogSnapshot(client, address, deployment);
    const [hydration, boardroomStatus] = await Promise.all([
      hydrateCatalogHistoricalDistributions(client, currentSnapshot, eventScan),
      readCatalogBoardroomStatus(client, address),
    ]);
    const snapshot = hydration.snapshot;
    const distribution = findCatalogDistribution(snapshot.distributionSummaries, boardroomStatus);
    const distributionState = distribution
      ? deriveDistributionCatalogFields(distribution, snapshot.shareTokenMetadata?.decimals, boardroomStatus)
      : {};
    const locker = findCatalogLocker(snapshot, distributionState.pool);
    const pool = catalogPoolAddress(distributionState, locker);
    let history: ProductBoardroomHistory | undefined;
    if (distribution) {
      try {
        history = await readDistributionHistory(client, distribution, pool, eventScan);
      } catch (error) {
        eventScan.signal?.throwIfAborted();
        history = stateDerivedPartialHistory(distribution, errorMessage(error));
      }
    }
    const cashToken = distributionState.cashToken;
    const [treasuryCash, shareName, shareTokenTotalSupply, shareTokenTreasuryBalance, currentPool] = await Promise.all([
      readCatalogTreasuryCash(client, address, cashToken),
      readOptionalTokenName(client, snapshot.shareToken),
      readOptionalTokenTotalSupply(client, snapshot.shareToken),
      readOptionalTokenBalance(client, snapshot.shareToken, address),
      readCatalogPool(client, deployment, pool ?? history?.pool),
    ]);
    const historyErrors = uniqueMessages([hydration.error, history?.scanError]);

    return {
      address,
      boardroomStatus,
      distributionAddresses: snapshot.distributionSummaries.map((entry) => entry.address),
      distributionCount: snapshot.distributionCount,
      name: shareName,
      shareToken: snapshot.shareToken,
      shareTokenDecimals: snapshot.shareTokenMetadata?.decimals,
      shareTokenTotalSupply,
      shareTokenTreasuryBalance,
      symbol: snapshot.shareTokenMetadata?.symbol,
      treasuryCash,
      ...distributionState,
      ...catalogHistoryFields(history),
      ...catalogPoolFields(currentPool),
      ...(historyErrors.length > 0 ? { historyError: historyErrors.join(" ") } : {}),
      locker: catalogLockerAddress(history, distributionState, locker),
      pool: pool ?? history?.pool,
    };
  } catch (error) {
    eventScan.signal?.throwIfAborted();
    return {
      address,
      error: errorMessage(error),
      status: "Read failed",
    };
  }
}

function catalogEntryFromSnapshot(
  snapshot: Pick<BoardroomSnapshot, "address" | "distributionSummaries" | "lockedLiquiditySummaries" | "shareToken" | "shareTokenMetadata" | "status">,
  additions: {
    currentPool?: CatalogPoolRead | undefined;
    history?: ProductBoardroomHistory | undefined;
    historyError?: string | undefined;
    name?: string | undefined;
    shareTokenTotalSupply?: bigint | undefined;
    shareTokenTreasuryBalance?: bigint | undefined;
    treasuryCash?: bigint | undefined;
  } = {},
): ProductBoardroomCatalogEntry {
  const distribution = findCatalogDistribution(snapshot.distributionSummaries, snapshot.status);
  const distributionState = distribution
    ? deriveDistributionCatalogFields(distribution, snapshot.shareTokenMetadata?.decimals, snapshot.status)
    : {};
  const locker = findCatalogLocker(snapshot, distributionState.pool);
  const pool = catalogPoolAddress(distributionState, locker);
  return {
    address: snapshot.address,
    boardroomStatus: snapshot.status,
    distributionAddresses: snapshot.distributionSummaries.map((entry) => entry.address),
    distributionCount: snapshot.distributionSummaries.length,
    name: additions.name,
    shareToken: snapshot.shareToken,
    shareTokenDecimals: snapshot.shareTokenMetadata?.decimals,
    shareTokenTotalSupply: additions.shareTokenTotalSupply,
    shareTokenTreasuryBalance: additions.shareTokenTreasuryBalance,
    symbol: snapshot.shareTokenMetadata?.symbol,
    treasuryCash: additions.treasuryCash,
    ...distributionState,
    ...catalogHistoryFields(additions.history),
    ...catalogPoolFields(additions.currentPool),
    ...(additions.historyError ? { historyError: additions.historyError } : {}),
    locker: catalogLockerAddress(additions.history, distributionState, locker),
    pool: pool ?? additions.history?.pool,
  };
}

async function readCatalogBoardroomStatus(
  client: PledgeCashReadClient,
  boardroom: Address,
): Promise<number> {
  return Number(await client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "status" }));
}

async function readCatalogTreasuryCash(
  client: ProductBoardroomClient,
  boardroom: Address,
  cashToken: Address | undefined,
): Promise<bigint | undefined> {
  if (!cashToken) return undefined;
  return await client.readContract({
    address: cashToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [boardroom],
  }) as bigint;
}

async function readCatalogPool(
  client: ProductBoardroomClient,
  deployment: PledgeCashDeployment | undefined,
  pool: Address | undefined,
): Promise<CatalogPoolRead | undefined> {
  if (!pool || isZeroAddress(pool)) return undefined;
  try {
    const vault = await readProtocolLiquidityVaultState(client, pool);
    if (!deployment?.uniswapV4StateView) {
      return {
        error: "Uniswap v4 StateView is not configured for current price and active-liquidity reads.",
        poolId: vault.poolId,
        positionLiquidity: vault.positionLiquidity,
        tickLower: vault.tickLower,
        tickUpper: vault.tickUpper,
        token0: vault.currency0,
        token1: vault.currency1,
      };
    }
    const state = await readUniswapV4PoolState(client, {
      stateView: deployment.uniswapV4StateView,
      poolId: vault.poolId,
    });
    return {
      liquidity: state.liquidity,
      poolId: vault.poolId,
      positionLiquidity: vault.positionLiquidity,
      sqrtPriceX96: state.sqrtPriceX96,
      tickLower: vault.tickLower,
      tickUpper: vault.tickUpper,
      token0: vault.currency0,
      token1: vault.currency1,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

async function readOptionalTokenTotalSupply(
  client: PledgeCashReadClient,
  token: Address,
): Promise<bigint | undefined> {
  try {
    return await client.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }) as bigint;
  } catch {
    return undefined;
  }
}

async function readOptionalTokenBalance(
  client: PledgeCashReadClient,
  token: Address,
  account: Address,
): Promise<bigint | undefined> {
  try {
    return await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] }) as bigint;
  } catch {
    return undefined;
  }
}

function catalogPoolFields(pool: CatalogPoolRead | undefined): Partial<ProductBoardroomCatalogEntry> {
  if (!pool) return {};
  if (!("token0" in pool)) return { poolError: pool.error };
  return {
    liquidity: pool.positionLiquidity,
    poolError: pool.error,
    poolLiquidity: pool.liquidity,
    poolPositionLiquidity: pool.positionLiquidity,
    poolSqrtPriceX96: pool.sqrtPriceX96,
    poolTickLower: pool.tickLower,
    poolTickUpper: pool.tickUpper,
    poolToken0: pool.token0,
    poolToken1: pool.token1,
  };
}

function catalogPoolAddress(
  distributionState: Partial<ProductBoardroomCatalogEntry>,
  locker: BoardroomLockedLiquiditySnapshot | undefined,
): Address | undefined {
  return distributionState.pool ?? locker?.address;
}

function catalogLockerAddress(
  history: ProductBoardroomHistory | undefined,
  distributionState: Partial<ProductBoardroomCatalogEntry>,
  locker: BoardroomLockedLiquiditySnapshot | undefined,
): Address | undefined {
  return distributionState.locker ?? locker?.address ?? history?.curve?.migration?.locker;
}

function stateDerivedPartialHistory(
  distribution: BoardroomDistributionSnapshot,
  scanError: string,
): ProductBoardroomHistory {
  const base: ProductBoardroomHistory = {
    completeness: "partial",
    distribution: distribution.address,
    scanError,
  };
  if (!distribution.state) return base;
  if (distribution.kind === "dutch-auction" && "totalPayment" in distribution.state) {
    return {
      ...base,
      cashRaised: distribution.state.totalPayment,
      soldShares: distribution.state.soldShares,
    };
  }
  if ("price" in distribution.state) {
    if (
      typeof distribution.state.saleSupply !== "bigint"
      || typeof distribution.state.remainingShares !== "bigint"
      || typeof distribution.state.price !== "bigint"
    ) {
      return base;
    }
    const soldShares = distribution.state.saleSupply - distribution.state.remainingShares;
    return {
      ...base,
      cashRaised: fixedPriceSaleCashRaised(soldShares, distribution.state.price),
      soldShares,
    };
  }
  const soldShares = distributionCirculatingShares(distribution);
  return soldShares === undefined ? base : { ...base, soldShares };
}

function currentStateCoverage(snapshot: BoardroomSnapshot): ProductBoardroomCurrentStateCoverage {
  const activeGrantCount = safeCount(snapshot.activeGrantCount, "Active grant count");
  const redeemableAssetCount = safeCount(snapshot.redeemableAssetCount, "Redeemable asset count");
  return {
    distributions: countCoverage(
      snapshot.distributionRecordCount,
      snapshot.distributionSummaries.filter((distribution) => Boolean(distribution.state) && !distribution.error).length,
    ),
    grants: countCoverage(
      Math.max(snapshot.grantRecordCount ?? activeGrantCount, activeGrantCount),
      snapshot.grantSummaries.filter((grant) => Boolean(grant.state) && !grant.error).length,
    ),
    lockedLiquidity: countCoverage(
      snapshot.lockedLiquidityRecordCount,
      snapshot.lockedLiquiditySummaries.filter((locker) => Boolean(locker.state) && !locker.error).length,
    ),
    redeemableAssets: countCoverage(redeemableAssetCount, snapshot.redeemableAssets.length),
  };
}

function countCoverage(total: number, shown: number): ProductBoardroomChildCoverage {
  const boundedShown = Math.min(total, shown);
  return { complete: boundedShown === total, shown: boundedShown, total };
}

export async function readProductBoardroomHistory(
  client: ProductBoardroomClient,
  snapshot: BoardroomSnapshot,
  catalogEntry: ProductBoardroomCatalogEntry | undefined,
  options: ProductBoardroomHistoryReadOptions = {},
): Promise<ProductBoardroomHistory | undefined> {
  return selectPrimaryHistory(await readProductBoardroomHistories(client, snapshot, options), catalogEntry);
}

export async function readProductBoardroomHistories(
  client: ProductBoardroomClient,
  snapshot: BoardroomSnapshot,
  options: ProductBoardroomHistoryReadOptions = {},
): Promise<ProductBoardroomHistory[]> {
  return await readProductBoardroomHistoriesWithContext(client, snapshot, createEventScanContext(options));
}

async function readProductBoardroomHistoriesWithContext(
  client: ProductBoardroomClient,
  snapshot: BoardroomSnapshot,
  eventScan: EventScanContext,
): Promise<ProductBoardroomHistory[]> {
  const histories = await mapInBatches(
    snapshot.distributionSummaries,
    CATALOG_READ_CONCURRENCY,
    async (distribution): Promise<ProductBoardroomHistory | undefined> => {
      try {
        return await readDistributionHistory(client, distribution, undefined, eventScan);
      } catch (error) {
        eventScan.signal?.throwIfAborted();
        return stateDerivedPartialHistory(distribution, errorMessage(error));
      }
    },
  );
  return histories.filter((history): history is ProductBoardroomHistory => history !== undefined);
}

async function hydrateHistoricalDistributions(
  _client: ProductBoardroomClient,
  snapshot: BoardroomSnapshot,
  eventScan: EventScanContext,
): Promise<HistoricalDistributionHydration> {
  eventScan.signal?.throwIfAborted();
  return { snapshot };
}

async function hydrateCatalogHistoricalDistributions(
  _client: ProductBoardroomClient,
  snapshot: BoardroomCatalogSnapshot,
  eventScan: EventScanContext,
): Promise<{ error?: string | undefined; snapshot: BoardroomCatalogSnapshot }> {
  eventScan.signal?.throwIfAborted();
  const omitted = Math.max(0, snapshot.distributionCount - snapshot.distributionSummaries.length);
  return {
    ...(omitted > 0
      ? { error: `Showing the newest ${snapshot.distributionSummaries.length.toString()} of ${snapshot.distributionCount.toString()} canonical factory distribution records; ${omitted.toString()} older records are omitted from this Explore summary.` }
      : {}),
    snapshot,
  };
}

function deriveDistributionCatalogFields(
  distribution: BoardroomDistributionSnapshot,
  shareTokenDecimals: number | undefined,
  boardroomStatus: number,
  now = currentUnixTimestamp(),
): Partial<ProductBoardroomCatalogEntry> {
  if (!distribution.state) {
    return {
      distribution: distribution.address,
      distributionKind: distribution.kind,
      path: distribution.kind === "unknown" ? "Distribution" : distribution.kind,
      status: distribution.error ? "Read failed" : "Unknown",
    };
  }

  if (distribution.kind === "dutch-auction" && "totalPayment" in distribution.state) {
    const state = distribution.state;
    const route = deriveExecutableDistributionRoute({
      boardroomStatus,
      closed: state.closed,
      endTime: state.endTime,
      kind: "dutch-auction",
      now,
      remainingShares: state.remainingShares,
      routeStatus: state.saleStatus,
      startTime: state.startTime,
    });
    return {
      cashRaised: state.totalPayment,
      cashToken: state.paymentToken,
      cashTokenDecimals: distribution.paymentTokenMetadata?.decimals,
      cashTokenSymbol: distribution.paymentTokenMetadata?.symbol,
      distribution: distribution.address,
      distributionKind: "dutch-auction",
      path: "Dutch auction",
      routeBuyInventory: state.remainingShares,
      routeClosed: state.closed,
      routeEndTime: state.endTime,
      routeStartTime: state.startTime,
      routeStatus: state.saleStatus,
      soldShares: state.soldShares,
      status: catalogRouteStatusLabel(route, fixedPriceSaleStatusLabel(state.saleStatus).replace("sale", "auction")),
    };
  }

  if ("price" in distribution.state) {
    const state = distribution.state;
    const soldShares = state.saleSupply - state.remainingShares;
    const route = deriveExecutableDistributionRoute({
      boardroomStatus,
      closed: state.closed,
      endTime: state.endTime,
      kind: "fixed-price-sale",
      now,
      remainingShares: state.remainingShares,
      routeStatus: state.saleStatus,
      startTime: state.startTime,
    });
    return {
      cashRaised: fixedPriceSaleCashRaised(soldShares, state.price),
      cashToken: state.paymentToken,
      cashTokenDecimals: distribution.paymentTokenMetadata?.decimals,
      cashTokenSymbol: distribution.paymentTokenMetadata?.symbol,
      distribution: distribution.address,
      distributionKind: "fixed-price-sale",
      path: "Fixed price sale",
      routeBuyInventory: state.remainingShares,
      routeClosed: state.closed,
      routeEndTime: state.endTime,
      routeStartTime: state.startTime,
      routeStatus: state.saleStatus,
      soldShares,
      status: catalogRouteStatusLabel(route, fixedPriceSaleStatusLabel(state.saleStatus)),
    };
  }

  if ("airdropSupply" in distribution.state) {
    const state = distribution.state;
    const route = deriveExecutableDistributionRoute({
      boardroomStatus,
      closed: state.closed,
      endTime: state.endTime,
      kind: "merkle-airdrop",
      now,
      remainingShares: state.remainingShares,
      routeStatus: state.airdropStatus,
      startTime: state.startTime,
    });
    return {
      distribution: distribution.address,
      distributionKind: "merkle-airdrop",
      path: "Merkle airdrop",
      routeClaimInventory: state.remainingShares,
      routeClosed: state.closed,
      routeEndTime: state.endTime,
      routeStartTime: state.startTime,
      routeStatus: state.airdropStatus,
      soldShares: distributionCirculatingShares(distribution),
      status: catalogRouteStatusLabel(route, merkleAirdropStatusLabel(state.airdropStatus)),
      shareTokenDecimals,
    };
  }

  if ("live" in distribution.state) {
    const state = distribution.state;
    return {
      cashRaised: state.purchased,
      cashToken: state.quoteToken,
      cashTokenDecimals: distribution.quoteTokenMetadata?.decimals,
      cashTokenSymbol: distribution.quoteTokenMetadata?.symbol,
      distribution: distribution.address,
      distributionKind: "bond-market",
      path: state.kind === 1 ? "Liquidity bond" : "Reserve bond",
      soldShares: state.sold,
      status: bondMarketStatusLabel(state),
      shareTokenDecimals,
    };
  }

  if (!("quoteToken" in distribution.state)) {
    return {
      distribution: distribution.address,
      distributionKind: distribution.kind,
      path: "Distribution",
      status: "Unknown",
    };
  }

  const state = distribution.state;
  const migrated = state.curveStatus === 1;
  const route = deriveExecutableDistributionRoute({
    boardroomStatus,
    closed: state.closed,
    endTime: state.endTime,
    graduationLatched: state.graduationLatched,
    kind: "migrating-bonding-curve",
    now,
    quoteReserve: state.quoteReserve,
    remainingSaleShares: state.remainingSaleShares,
    routeStatus: state.curveStatus,
    soldShares: state.soldShares,
    startTime: state.startTime,
  });
  return {
    cashRaised: state.quoteReserve,
    cashToken: state.quoteToken,
    cashTokenDecimals: distribution.quoteTokenMetadata?.decimals,
    cashTokenSymbol: distribution.quoteTokenMetadata?.symbol,
    distribution: distribution.address,
    distributionKind: "migrating-bonding-curve",
    locker: nonZeroAddress(state.liquidityVault),
    path: migrated ? "Migrated curve + Uniswap v4" : "Bonding curve",
    pool: nonZeroAddress(state.liquidityVault),
    routeBuyInventory: state.remainingSaleShares,
    routeClosed: state.closed,
    routeEndTime: state.endTime,
    routeGraduationLatched: state.graduationLatched,
    routeQuoteReserve: state.quoteReserve,
    routeSellInventory: state.soldShares,
    routeStartTime: state.startTime,
    routeStatus: state.curveStatus,
    soldShares: state.soldShares,
    status: catalogRouteStatusLabel(route, migratingCurveStatusLabel(state.curveStatus)),
    shareTokenDecimals,
  };
}

async function readDistributionHistory(
  client: ProductBoardroomClient,
  distribution: BoardroomDistributionSnapshot,
  pool: Address | undefined,
  eventScan: EventScanContext,
): Promise<ProductBoardroomHistory | undefined> {
  if (!distribution.state) return undefined;

  if (distribution.kind === "dutch-auction" && "paymentToken" in distribution.state) {
    const dutchAuction = await readDutchAuctionHistory(client, distribution.address, eventScan);
    if (!dutchAuction) return undefined;
    return {
      buyerCount: dutchAuction.buyerCount,
      cashRaised: dutchAuction.cashRaised,
      completeness: "complete",
      distribution: distribution.address,
      dutchAuction,
      soldShares: dutchAuction.soldShares,
    };
  }

  if ("paymentToken" in distribution.state) {
    const fixedPriceSale = await readFixedPriceSaleHistory(client, distribution.address, eventScan);
    if (!fixedPriceSale) return undefined;
    return {
      buyerCount: fixedPriceSale.buyerCount,
      cashRaised: fixedPriceSale.cashRaised,
      completeness: "complete",
      distribution: distribution.address,
      fixedPriceSale,
      soldShares: fixedPriceSale.soldShares,
    };
  }

  if ("airdropSupply" in distribution.state) {
    return {
      completeness: "state-derived",
      distribution: distribution.address,
      soldShares: distributionCirculatingShares(distribution),
    };
  }


  if ("currentPrice" in distribution.state) {
    return {
      cashRaised: distribution.state.purchased,
      completeness: "state-derived",
      distribution: distribution.address,
      soldShares: distribution.state.sold,
    };
  }

  if (!("quoteToken" in distribution.state)) return undefined;

  const curveResult = await readCurveHistory(client, distribution.address, eventScan);
  const curve = curveResult.history;
  const currentPool = nonZeroAddress(distribution.state.liquidityVault) ?? pool;
  const migrationPool = curve?.migration?.pool;
  const historyPool = currentPool ?? migrationPool;
  const errors = uniqueMessages([
    ...curveResult.errors,
    currentPool && migrationPool && !sameAddress(currentPool, migrationPool)
      ? poolHistoryMismatchMessage(distribution.address, currentPool, migrationPool)
      : undefined,
  ]);
  let amm: ProductBoardroomAmmHistory | undefined;
  if (historyPool) {
    try {
      amm = await readAmmHistory(client, historyPool, eventScan);
    } catch (error) {
      eventScan.signal?.throwIfAborted();
      errors.push(`AMM Swap history failed: ${errorMessage(error)}`);
    }
  }
  if (!curve && !amm && errors.length === 0) return undefined;

  return {
    amm,
    buyerCount: curve?.buyerCount,
    cashRaised: curve?.cashRaised,
    completeness: errors.length > 0 ? "partial" : "complete",
    curve,
    distribution: distribution.address,
    pool: historyPool,
    ...(errors.length > 0 ? { scanError: uniqueMessages(errors).join("; ") } : {}),
    soldShares: curve?.soldShares ?? distribution.state.soldShares,
  };
}

async function readFixedPriceSaleHistory(
  client: ProductBoardroomClient,
  sale: Address,
  eventScan: EventScanContext,
): Promise<ProductBoardroomFixedPriceSaleHistory | undefined> {
  const logs = await readEventLogs(client, sale, fixedPriceSaleAbi, "FixedPricePurchase", eventScan);
  if (!logs) return undefined;

  const buyers = new Set<string>();
  let soldShares = 0n;
  let cashRaised = 0n;

  for (const log of logs) {
    const buyer = addressArg(log.args, "buyer");
    if (buyer) buyers.add(buyer.toLowerCase());
    soldShares += bigintArg(log.args, "shares");
    cashRaised += bigintArg(log.args, "payment");
  }

  return {
    buyerCount: buyers.size,
    cashRaised,
    purchaseCount: logs.length,
    soldShares,
  };
}

async function readDutchAuctionHistory(
  client: ProductBoardroomClient,
  auction: Address,
  eventScan: EventScanContext,
): Promise<ProductBoardroomFixedPriceSaleHistory | undefined> {
  const logs = await readEventLogs(client, auction, dutchAuctionSaleAbi, "DutchAuctionPurchase", eventScan);
  if (!logs) return undefined;

  const buyers = new Set<string>();
  let soldShares = 0n;
  let cashRaised = 0n;

  for (const log of logs) {
    const buyer = addressArg(log.args, "buyer");
    if (buyer) buyers.add(buyer.toLowerCase());
    soldShares += bigintArg(log.args, "shares");
    cashRaised += bigintArg(log.args, "payment");
  }

  return {
    buyerCount: buyers.size,
    cashRaised,
    purchaseCount: logs.length,
    soldShares,
  };
}

async function readCurveHistory(
  client: ProductBoardroomClient,
  curve: Address,
  eventScan: EventScanContext,
): Promise<CurveHistoryReadResult> {
  const [buyResult, sellResult, migrationResult] = await Promise.allSettled([
    readEventLogs(client, curve, migratingBondingCurveAbi, "CurveBuy", eventScan),
    readEventLogs(client, curve, migratingBondingCurveAbi, "CurveSell", eventScan),
    readEventLogs(client, curve, migratingBondingCurveAbi, "CurveMigrated", eventScan),
  ]);
  const errors = uniqueMessages([
    buyResult.status === "rejected" ? `CurveBuy history failed: ${errorMessage(buyResult.reason)}` : undefined,
    sellResult.status === "rejected" ? `CurveSell history failed: ${errorMessage(sellResult.reason)}` : undefined,
    migrationResult.status === "rejected" ? `CurveMigrated history failed: ${errorMessage(migrationResult.reason)}` : undefined,
  ]);
  eventScan.signal?.throwIfAborted();
  const buyLogs = buyResult.status === "fulfilled" ? buyResult.value : undefined;
  const sellLogs = sellResult.status === "fulfilled" ? sellResult.value : undefined;
  const migrationLogs = migrationResult.status === "fulfilled" ? migrationResult.value : undefined;
  if (!buyLogs && !sellLogs && !migrationLogs) return { errors };

  const buyers = new Set<string>();
  let boughtShares = 0n;
  let soldBackShares = 0n;
  let quotePaid = 0n;
  let quoteReturned = 0n;

  if (buyLogs) {
    for (const log of buyLogs) {
      const buyer = addressArg(log.args, "buyer");
      if (buyer) buyers.add(buyer.toLowerCase());
      boughtShares += bigintArg(log.args, "shares");
      quotePaid += bigintArg(log.args, "quotePaid");
    }
  }
  if (sellLogs) {
    for (const log of sellLogs) {
      soldBackShares += bigintArg(log.args, "shares");
      quoteReturned += bigintArg(log.args, "quoteReturned");
    }
  }

  const migrationLog = migrationLogs?.[migrationLogs.length - 1];
  const migration = migrationLog
    ? curveMigrationHistory(migrationLog.args)
    : undefined;
  const completeTradingHistory = buyLogs !== undefined && sellLogs !== undefined;

  return {
    errors,
    history: {
      ...(buyLogs ? { buyerCount: buyers.size, buyCount: buyLogs.length, quotePaid } : {}),
      ...(completeTradingHistory ? {
        cashRaised: quotePaid > quoteReturned ? quotePaid - quoteReturned : 0n,
        soldShares: boughtShares > soldBackShares ? boughtShares - soldBackShares : 0n,
      } : {}),
      ...(migration ? { migration } : {}),
      ...(sellLogs ? { quoteReturned, sellCount: sellLogs.length } : {}),
    },
  };
}

async function readAmmHistory(
  client: ProductBoardroomClient,
  pool: Address,
  eventScan: EventScanContext,
): Promise<ProductBoardroomAmmHistory | undefined> {
  const vault = await readProtocolLiquidityVaultState(client, pool);
  const logs = await readEventLogs(
    client,
    vault.poolManager,
    uniswapV4PoolManagerEventAbi,
    "Swap",
    eventScan,
    { id: vault.poolId },
  );
  if (!logs) return undefined;

  const traders = new Set<string>();
  let amount0In = 0n;
  let amount0Out = 0n;
  let amount1In = 0n;
  let amount1Out = 0n;

  for (const log of logs) {
    const sender = addressArg(log.args, "sender");
    if (sender) traders.add(sender.toLowerCase());
    const amount0 = bigintArg(log.args, "amount0");
    const amount1 = bigintArg(log.args, "amount1");
    if (amount0 > 0n) amount0In += amount0;
    else amount0Out += -amount0;
    if (amount1 > 0n) amount1In += amount1;
    else amount1Out += -amount1;
  }

  return {
    amount0In,
    amount0Out,
    amount1In,
    amount1Out,
    swapCount: logs.length,
    traderCount: traders.size,
  };
}

async function readEventLogs(
  client: ProductBoardroomClient,
  address: Address,
  abi: ProductBoardroomEventAbi,
  name: ProductBoardroomEventName,
  eventScan: EventScanContext,
  args?: Record<string, unknown>,
): Promise<ProductBoardroomEventLog[] | undefined> {
  assertEventScanActive(eventScan);
  if (!client.getBlockNumber || !client.getLogs) {
    throw new Error(`Historical ${name} activity is unavailable because this RPC cannot scan event logs.`);
  }
  const toBlock = await waitForEventScanOperation(client.getBlockNumber(), eventScan, `${name} head block`);
  const cacheKey = `${address.toLowerCase()}:${name}:${eventArgsCacheKey(args)}`;
  const clientCache = eventLogClientCache(client);
  let cacheEntry = clientCache.get(cacheKey);
  if (!cacheEntry) {
    cacheEntry = { logs: [] };
    insertEventLogCacheEntry(clientCache, cacheKey, cacheEntry);
  } else {
    touchEventLogCacheEntry(clientCache, cacheKey, cacheEntry);
  }

  while (cacheEntry.pending) {
    const pending = cacheEntry.pending;
    const pendingContext = cacheEntry.pendingContext;
    try {
      await waitForEventScanOperation(pending, eventScan, `${name} cached scan`);
      break;
    } catch (error) {
      assertEventScanActive(eventScan);
      if (!pendingContext || !eventScanOwnsFailure(pendingContext, error)) throw error;

      const current = clientCache.get(cacheKey);
      if (current && current !== cacheEntry) {
        cacheEntry = current;
        touchEventLogCacheEntry(clientCache, cacheKey, cacheEntry);
        continue;
      }

      if (current === cacheEntry) clientCache.delete(cacheKey);
      cacheEntry = {
        ...(cacheEntry.checkpointHash === undefined ? {} : { checkpointHash: cacheEntry.checkpointHash }),
        logs: [...cacheEntry.logs],
        ...(cacheEntry.toBlock === undefined ? {} : { toBlock: cacheEntry.toBlock }),
      };
      insertEventLogCacheEntry(clientCache, cacheKey, cacheEntry);
    }
  }
  const checkpointChanged = cacheEntry.toBlock !== undefined && toBlock >= cacheEntry.toBlock
    ? await eventLogCheckpointChanged(client, cacheEntry, eventScan)
    : false;
  const sameHeadWithoutCheckpoint = cacheEntry.toBlock === toBlock
    && (!client.getBlock || cacheEntry.checkpointHash === undefined);
  if ((cacheEntry.toBlock !== undefined && toBlock < cacheEntry.toBlock) || checkpointChanged || sameHeadWithoutCheckpoint) {
    cacheEntry.logs = [];
    cacheEntry.toBlock = undefined;
    cacheEntry.checkpointHash = undefined;
    contractStartBlockCache.get(client)?.delete(address.toLowerCase());
  } else if (cacheEntry.toBlock === toBlock) {
    const logs = logsThroughBlock(cacheEntry.logs, toBlock);
    reserveEventLogResults(eventScan, name, logs.length);
    return logs;
  }

  const entry = cacheEntry;
  const request = updateEventLogCacheEntry(client, address, abi, name, toBlock, entry, eventScan, args);
  entry.pending = request;
  entry.pendingContext = eventScan;
  try {
    await waitForEventScanOperation(request, eventScan, `${name} event scan`);
    return logsThroughBlock(entry.logs, toBlock);
  } catch (error) {
    if (entry.toBlock === undefined && clientCache.get(cacheKey) === entry) clientCache.delete(cacheKey);
    throw error;
  } finally {
    if (entry.pending === request) {
      entry.pending = undefined;
      entry.pendingContext = undefined;
    }
  }
}

function eventArgsCacheKey(args: Record<string, unknown> | undefined): string {
  if (!args) return "all";
  return Object.entries(args)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value).toLowerCase()}`)
    .join("&");
}

function eventScanOwnsFailure(eventScan: EventScanContext, error: unknown): boolean {
  return eventScan.failure === error
    || Boolean(eventScan.signal?.aborted && eventScan.signal.reason === error);
}

async function updateEventLogCacheEntry(
  client: ProductBoardroomClient,
  address: Address,
  abi: ProductBoardroomEventAbi,
  name: ProductBoardroomEventName,
  toBlock: bigint,
  entry: EventLogCacheEntry,
  eventScan: EventScanContext,
  args?: Record<string, unknown>,
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_EVENT_LOG_REORG_RETRIES; attempt += 1) {
    assertEventScanActive(eventScan);
    const checkpointBefore = await eventLogBlockHash(client, toBlock, eventScan);
    const contractBlock = await contractStartBlock(client, address, toBlock, eventScan);
    const fromBlock = entry.toBlock === undefined
      ? contractBlock
      : maxBigInt(contractBlock, saturatingSubBigInt(entry.toBlock, EVENT_LOG_REORG_OVERLAP - 1n));
    const retained = entry.toBlock === undefined || fromBlock > toBlock
      ? []
      : entry.logs.filter((log) => typeof log.blockNumber === "bigint" && log.blockNumber < fromBlock);
    reserveEventLogResults(eventScan, name, retained.length);
    const scanned = fromBlock > toBlock
      ? []
      : await readEventLogsInChunks(client, address, abi, name, fromBlock, toBlock, eventScan, args);
    const checkpointAfter = await eventLogBlockHash(client, toBlock, eventScan);

    if (checkpointBefore !== checkpointAfter) {
      resetEventLogCacheEntry(client, address, entry);
      if (attempt < MAX_EVENT_LOG_REORG_RETRIES) continue;
      throw new Error(`Historical ${name} scan could not stabilize because the chain checkpoint changed during the scan.`);
    }

    entry.logs = [...retained, ...scanned];
    entry.toBlock = toBlock;
    entry.checkpointHash = checkpointAfter ?? checkpointBefore;
    return;
  }
}

function resetEventLogCacheEntry(
  client: ProductBoardroomClient,
  address: Address,
  entry: EventLogCacheEntry,
): void {
  entry.logs = [];
  entry.toBlock = undefined;
  entry.checkpointHash = undefined;
  contractStartBlockCache.get(client)?.delete(address.toLowerCase());
}

async function eventLogCheckpointChanged(
  client: ProductBoardroomClient,
  entry: EventLogCacheEntry,
  eventScan: EventScanContext,
): Promise<boolean> {
  if (entry.toBlock === undefined || entry.checkpointHash === undefined) return false;
  const canonicalHash = await eventLogBlockHash(client, entry.toBlock, eventScan);
  return canonicalHash !== undefined && canonicalHash !== entry.checkpointHash;
}

async function eventLogBlockHash(
  client: ProductBoardroomClient,
  blockNumber: bigint,
  eventScan: EventScanContext,
): Promise<Hex | undefined> {
  if (!client.getBlock) return undefined;
  const block = await waitForEventScanOperation(
    client.getBlock({ blockNumber }),
    eventScan,
    "event checkpoint",
  );
  return block.hash ?? undefined;
}

async function readEventLogsInChunks(
  client: ProductBoardroomClient,
  address: Address,
  abi: ProductBoardroomEventAbi,
  name: ProductBoardroomEventName,
  fromBlock: bigint,
  toBlock: bigint,
  eventScan: EventScanContext,
  args?: Record<string, unknown>,
): Promise<ProductBoardroomEventLog[]> {
  if (!client.getLogs || fromBlock > toBlock) return [];
  const event = getAbiItem({ abi, name }) as AbiEvent;
  const logs: ProductBoardroomEventLog[] = [];
  let nextBlock = fromBlock;

  while (nextBlock <= toBlock) {
    assertEventScanActive(eventScan);
    const rangeLimit = eventLogRangeLimitCache.get(client) ?? EVENT_LOG_CHUNK_SIZE;
    const chunkSize = minBigInt(EVENT_LOG_CHUNK_SIZE, rangeLimit);
    const ranges = Array.from({ length: EVENT_LOG_CONCURRENCY }, (_, offset) => {
      const start = nextBlock + BigInt(offset) * chunkSize;
      const end = minBigInt(start + chunkSize - 1n, toBlock);
      return start <= toBlock ? { start, end } : undefined;
    }).filter((range): range is { start: bigint; end: bigint } => range !== undefined);
    const pages = await Promise.all(ranges.map(async ({ start, end }) =>
      await readLogRangeAdaptive(client, address, event, name, start, end, eventScan, args)));
    for (const page of pages) logs.push(...page);
    const last = ranges.at(-1);
    if (!last) break;
    nextBlock = last.end + 1n;
  }

  return logs;
}

async function readLogRangeAdaptive(
  client: ProductBoardroomClient,
  address: Address,
  event: AbiEvent,
  name: ProductBoardroomEventName,
  fromBlock: bigint,
  toBlock: bigint,
  eventScan: EventScanContext,
  args?: Record<string, unknown>,
): Promise<ProductBoardroomEventLog[]> {
  if (!client.getLogs) return [];
  assertEventScanActive(eventScan);
  reserveEventLogRequest(eventScan, name);
  try {
    const logs = await waitForEventScanOperation(
      client.getLogs({ address, event, args, fromBlock, toBlock } as never) as Promise<ProductBoardroomEventLog[]>,
      eventScan,
      `${name} log range`,
    );
    reserveEventLogResults(eventScan, name, logs.length);
    return logs;
  } catch (error) {
    assertEventScanActive(eventScan);
    const size = toBlock - fromBlock + 1n;
    if (!isLogRangeLimitError(error) || size <= MIN_EVENT_LOG_CHUNK_SIZE) throw error;
    const advertisedLimit = advertisedLogRangeLimit(error, size);
    if (advertisedLimit !== undefined) {
      cacheEventLogRangeLimit(client, advertisedLimit);
      return await readLogRangeAtKnownLimit(
        client,
        address,
        event,
        name,
        fromBlock,
        toBlock,
        advertisedLimit,
        eventScan,
        args,
      );
    }
    const middle = fromBlock + (toBlock - fromBlock) / 2n;
    const first = await readLogRangeAdaptive(client, address, event, name, fromBlock, middle, eventScan, args);
    const second = await readLogRangeAdaptive(client, address, event, name, middle + 1n, toBlock, eventScan, args);
    return [...first, ...second];
  }
}

async function contractStartBlock(
  client: ProductBoardroomClient,
  address: Address,
  toBlock: bigint,
  eventScan: EventScanContext,
): Promise<bigint> {
  if (!client.getCode) return 0n;
  let clientCache = contractStartBlockCache.get(client);
  if (!clientCache) {
    clientCache = new Map();
    contractStartBlockCache.set(client, clientCache);
  }
  const key = address.toLowerCase();
  const cached = clientCache.get(key);
  if (cached) {
    clientCache.delete(key);
    clientCache.set(key, cached);
    if (cached.state === "resolved") return cached.value;
    return await waitForContractStartBlock(cached, clientCache, key, eventScan);
  }

  const request = findContractStartBlock(client, address, toBlock);
  const entry: ContractStartBlockCacheEntry = { state: "pending", request };
  while (clientCache.size >= MAX_CONTRACT_START_BLOCK_CACHE_ENTRIES) {
    const oldest = clientCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    clientCache.delete(oldest);
  }
  clientCache.set(key, entry);
  void request.then(
    (value) => {
      if (clientCache.get(key) !== entry) return;
      clientCache.delete(key);
      clientCache.set(key, { state: "resolved", value });
    },
    () => {
      if (clientCache.get(key) === entry) clientCache.delete(key);
    },
  );
  return await waitForContractStartBlock(entry, clientCache, key, eventScan);
}

async function waitForContractStartBlock(
  entry: Extract<ContractStartBlockCacheEntry, { state: "pending" }>,
  clientCache: Map<string, ContractStartBlockCacheEntry>,
  key: string,
  eventScan: EventScanContext,
): Promise<bigint> {
  const evictPendingLookup = (): void => {
    if (clientCache.get(key) === entry) clientCache.delete(key);
  };
  eventScan.terminationListeners.add(evictPendingLookup);
  try {
    return await waitForEventScanOperation(entry.request, eventScan, "contract start block");
  } catch (error) {
    // Removing the shared entry does not cancel its promise, so callers that
    // already hold it may still finish. A later caller can retry immediately.
    evictPendingLookup();
    if (eventScanOwnsFailure(eventScan, error)) throw error;
    // Pruned RPCs may reject historical eth_getCode. Fall back for this scan,
    // but do not make a transient provider failure permanent for this client.
    return 0n;
  } finally {
    eventScan.terminationListeners.delete(evictPendingLookup);
  }
}

async function findContractStartBlock(
  client: ProductBoardroomClient,
  address: Address,
  toBlock: bigint,
): Promise<bigint> {
  if (!client.getCode) return 0n;
  const latestCode = await client.getCode({ address, blockNumber: toBlock });
  if (!latestCode || latestCode === "0x") return 0n;
  let low = 0n;
  let high = toBlock;
  while (low < high) {
    const middle = (low + high) / 2n;
    const code = await client.getCode({ address, blockNumber: middle });
    if (code && code !== "0x") high = middle;
    else low = middle + 1n;
  }
  return low;
}

function curveMigrationHistory(args: Record<string, unknown> | undefined): ProductBoardroomCurveMigrationHistory | undefined {
  const vault = addressArg(args, "vault");
  const poolId = hexArg(args, "poolId");
  if (!vault || !poolId) return undefined;
  return {
    liquidity: bigintArg(args, "liquidity"),
    locker: vault,
    pool: vault,
    poolId,
    quoteToBoardroom: bigintArg(args, "quoteToBoardroom"),
    quoteToLiquidity: bigintArg(args, "quoteToLiquidity"),
    sharesToLiquidity: bigintArg(args, "sharesToLiquidity"),
  };
}

function catalogHistoryFields(history: ProductBoardroomHistory | undefined): Partial<ProductBoardroomCatalogEntry> {
  if (!history) return {};
  const fields: Partial<ProductBoardroomCatalogEntry> = {};
  if (history.buyerCount !== undefined) fields.buyerCount = history.buyerCount;
  if (history.curve?.buyCount !== undefined) fields.buyCount = history.curve.buyCount;
  if (history.cashRaised !== undefined) fields.cashRaised = history.cashRaised;
  if (history.curve?.migration?.liquidity !== undefined) fields.liquidity = history.curve.migration.liquidity;
  if (history.pool !== undefined) fields.pool = history.pool;
  if (history.curve?.migration?.quoteToBoardroom !== undefined) fields.quoteToBoardroom = history.curve.migration.quoteToBoardroom;
  if (history.curve?.migration?.quoteToLiquidity !== undefined) fields.quoteToLiquidity = history.curve.migration.quoteToLiquidity;
  if (history.curve?.sellCount !== undefined) fields.sellCount = history.curve.sellCount;
  if (history.curve?.migration?.sharesToLiquidity !== undefined) fields.sharesToLiquidity = history.curve.migration.sharesToLiquidity;
  if (history.soldShares !== undefined) fields.soldShares = history.soldShares;
  if (history.amm?.swapCount !== undefined) fields.swapCount = history.amm.swapCount;
  return fields;
}

function findCatalogDistribution(
  distributions: readonly BoardroomDistributionSnapshot[],
  boardroomStatus: number,
  now = currentUnixTimestamp(),
): BoardroomDistributionSnapshot | undefined {
  return distributions.find((distribution) => distributionIsExecutable(distribution, boardroomStatus, now))
    ?? distributions.find((distribution) => distribution.kind === "migrating-bonding-curve" && Boolean(nonZeroAddress(
      distribution.state && "liquidityVault" in distribution.state ? distribution.state.liquidityVault : undefined,
    )))
    ?? distributions.find((distribution) => distributionHasActiveEnum(distribution))
    ?? distributions[0];
}

function distributionIsExecutable(
  distribution: BoardroomDistributionSnapshot,
  boardroomStatus: number,
  now: bigint,
): boolean {
  const input = executableRouteInput(distribution, boardroomStatus, now);
  return input ? deriveExecutableDistributionRoute(input).liveness.status === "live" : false;
}

function distributionHasActiveEnum(distribution: BoardroomDistributionSnapshot): boolean {
  if (!distribution.state || distribution.state.closed) return false;
  if ("saleStatus" in distribution.state) return distribution.state.saleStatus === 0;
  if ("curveStatus" in distribution.state) return distribution.state.curveStatus === 0;
  if ("airdropStatus" in distribution.state) return distribution.state.airdropStatus === 0;
  if ("currentPrice" in distribution.state) return distribution.state.live && distribution.state.capacity > 0n;
  return false;
}

function executableRouteInput(
  distribution: BoardroomDistributionSnapshot,
  boardroomStatus: number,
  now: bigint,
) {
  if (!distribution.state) return undefined;
  const state = distribution.state;
  if (distribution.kind === "bond-market") return undefined;
  if ("paymentToken" in state) {
    return {
      boardroomStatus,
      closed: state.closed,
      endTime: state.endTime,
      kind: distribution.kind === "dutch-auction" ? "dutch-auction" as const : "fixed-price-sale" as const,
      now,
      remainingShares: state.remainingShares,
      routeStatus: state.saleStatus,
      startTime: state.startTime,
    };
  }
  if ("curveStatus" in state) {
    return {
      boardroomStatus,
      closed: state.closed,
      endTime: state.endTime,
      graduationLatched: state.graduationLatched,
      kind: "migrating-bonding-curve" as const,
      now,
      quoteReserve: state.quoteReserve,
      remainingSaleShares: state.remainingSaleShares,
      routeStatus: state.curveStatus,
      soldShares: state.soldShares,
      startTime: state.startTime,
    };
  }
  if (!("airdropStatus" in state)) return undefined;
  return {
    boardroomStatus,
    closed: state.closed,
    endTime: state.endTime,
    kind: "merkle-airdrop" as const,
    now,
    remainingShares: state.remainingShares,
    routeStatus: state.airdropStatus,
    startTime: state.startTime,
  };
}

function selectPrimaryHistory(
  histories: readonly ProductBoardroomHistory[],
  catalogEntry: Pick<ProductBoardroomCatalogEntry, "distribution" | "pool"> | undefined,
): ProductBoardroomHistory | undefined {
  if (catalogEntry?.distribution) {
    const exact = histories.find((history) => sameAddress(history.distribution, catalogEntry.distribution));
    if (exact) return {
      ...exact,
      pool: catalogEntry.pool ?? exact.pool,
    };
  }
  return histories.find((history) => history.pool || history.curve?.migration)
    ?? histories[0];
}

function findCatalogLocker(
  snapshot: Pick<BoardroomSnapshot, "lockedLiquiditySummaries">,
  pool: Address | undefined,
) {
  if (pool) {
    const matching = snapshot.lockedLiquiditySummaries.find(
      (locker) => locker.address.toLowerCase() === pool.toLowerCase(),
    );
    if (matching) return matching;
  }
  return snapshot.lockedLiquiditySummaries[0];
}

function fixedPriceSaleCashRaised(soldShares: bigint, price: bigint): bigint {
  return (soldShares * price + WAD - 1n) / WAD;
}

export function distributionCirculatingShares(
  distribution: BoardroomDistributionSnapshot,
): bigint | undefined {
  if (!distribution.state) return undefined;
  if ("startPrice" in distribution.state) return distribution.state.soldShares;
  if ("paymentToken" in distribution.state) return distribution.state.saleSupply - distribution.state.remainingShares;
  if ("airdropSupply" in distribution.state) return distribution.state.claimedShares;
  if ("currentPrice" in distribution.state) return distribution.state.sold;
  if ("quoteToken" in distribution.state) return distribution.state.soldShares;
  return undefined;
}

function catalogRouteStatusLabel(
  route: ReturnType<typeof deriveExecutableDistributionRoute>,
  contractStatus: string,
): string {
  if (route.mode === "sell-only") return "Sell-only curve";
  if (route.liveness.status === "live") return contractStatus;
  if (route.phase === "future") return "Scheduled";
  if (route.phase === "expired") return "Window ended";
  if (route.liveness.status === "deployment-pending") return "Migration pending";
  if (route.phase === "blocked") {
    const reason = "reason" in route.liveness ? route.liveness.reason : "";
    if (reason.includes("parent Boardroom")) return "Boardroom inactive";
    if (!route.buy.available && route.buy.reason.includes("No project-token inventory")) return "Sold out";
    if (!route.claim.available && route.claim.reason.includes("fully claimed")) return "Fully claimed";
    return "Unavailable";
  }
  return contractStatus;
}

function fixedPriceSaleStatusLabel(status: number): string {
  switch (status) {
    case 0:
      return "Active sale";
    case 1:
      return "Closed sale";
    case 2:
      return "Cancelled sale";
    default:
      return "Unknown sale";
  }
}

function migratingCurveStatusLabel(status: number): string {
  switch (status) {
    case 0:
      return "Open curve";
    case 1:
      return "Live AMM";
    case 2:
      return "Cancelled curve";
    default:
      return "Unknown curve";
  }
}

function merkleAirdropStatusLabel(status: number): string {
  switch (status) {
    case 0:
      return "Open airdrop";
    case 1:
      return "Closed airdrop";
    case 2:
      return "Cancelled airdrop";
    default:
      return "Unknown airdrop";
  }
}

function bondMarketStatusLabel(state: { closed: boolean; live: boolean; status: number }): string {
  if (state.closed) return "Settled bond market";
  if (state.live) return "Open bond market";
  if (state.status === 0) return "Scheduled or concluded bond market";
  return "Bond claims pending";
}

async function readOptionalTokenName(client: PledgeCashReadClient, address: Address): Promise<string | undefined> {
  try {
    return await client.readContract({ address, abi: erc20Abi, functionName: "name" }) as string;
  } catch {
    return undefined;
  }
}

function catalogPageLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_CATALOG_PAGE_SIZE;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Catalog page size must be a positive safe integer.");
  return Math.min(value, MAX_CATALOG_PAGE_SIZE);
}

function catalogPageCursor(value: number | undefined, count: number): number {
  if (value === undefined) return count;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Catalog cursor must be a non-negative safe integer.");
  return Math.min(value, count);
}

function safeCount(value: unknown, label: string): number {
  const parsed = bigintCount(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the browser's safe discovery range.`);
  }
  return Number(parsed);
}

function safeSnapshotCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Catalog snapshot count must be a non-negative safe integer.");
  }
  return value;
}

function eventLogClientCache(client: ProductBoardroomClient): Map<string, EventLogCacheEntry> {
  let clientCache = eventLogCache.get(client);
  if (!clientCache) {
    clientCache = new Map();
    eventLogCache.set(client, clientCache);
  }
  return clientCache;
}

function insertEventLogCacheEntry(
  clientCache: Map<string, EventLogCacheEntry>,
  key: string,
  entry: EventLogCacheEntry,
): void {
  while (clientCache.size >= MAX_EVENT_LOG_CACHE_ENTRIES) {
    const oldest = clientCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    clientCache.delete(oldest);
  }
  clientCache.set(key, entry);
}

function touchEventLogCacheEntry(
  clientCache: Map<string, EventLogCacheEntry>,
  key: string,
  entry: EventLogCacheEntry,
): void {
  clientCache.delete(key);
  clientCache.set(key, entry);
}

function logsThroughBlock(logs: readonly ProductBoardroomEventLog[], toBlock: bigint): ProductBoardroomEventLog[] {
  return logs.filter((log) => typeof log.blockNumber !== "bigint" || log.blockNumber <= toBlock);
}

function createEventScanContext(options: ProductBoardroomHistoryReadOptions): EventScanContext {
  const requestedTimeout = options.timeoutMs ?? EVENT_SCAN_TIMEOUT_MS;
  if (!Number.isSafeInteger(requestedTimeout) || requestedTimeout <= 0) {
    throw new Error("Historical event timeout must be a positive safe integer.");
  }
  const timeoutMs = Math.min(requestedTimeout, 60_000);
  return {
    budget: { logsUsed: 0, requestsUsed: 0 },
    ...(options.signal ? { signal: options.signal } : {}),
    terminationListeners: new Set(),
    timeoutMs,
  };
}

function assertEventScanActive(eventScan: EventScanContext): void {
  if (eventScan.signal?.aborted) {
    notifyEventScanTermination(eventScan);
    eventScan.signal.throwIfAborted();
  }
  if (eventScan.failure) {
    notifyEventScanTermination(eventScan);
    throw eventScan.failure;
  }
  eventScan.deadlineAt ??= Date.now() + eventScan.timeoutMs;
  if (Date.now() < eventScan.deadlineAt) return;
  const error = new Error(`Historical event scan exceeded its ${eventScan.timeoutMs.toLocaleString()}ms deadline.`);
  throw recordEventScanFailure(eventScan, error);
}

async function waitForEventScanOperation<T>(
  operation: Promise<T>,
  eventScan: EventScanContext,
  label: string,
): Promise<T> {
  assertEventScanActive(eventScan);
  const remainingMs = Math.max(1, (eventScan.deadlineAt ?? Date.now()) - Date.now());
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      eventScan.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => {
      notifyEventScanTermination(eventScan);
      finish(() => reject(
        eventScan.signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"),
      ));
    };
    const timeout = setTimeout(() => {
      const error = recordEventScanFailure(
        eventScan,
        new Error(`Historical ${label} exceeded the event scan deadline.`),
      );
      finish(() => reject(error));
    }, remainingMs);
    eventScan.signal?.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function recordEventScanFailure(eventScan: EventScanContext, error: Error): Error {
  eventScan.failure ??= error;
  notifyEventScanTermination(eventScan);
  return eventScan.failure;
}

function notifyEventScanTermination(eventScan: EventScanContext): void {
  for (const listener of [...eventScan.terminationListeners]) listener();
}

function reserveEventLogRequest(eventScan: EventScanContext, name: ProductBoardroomEventName): void {
  assertEventScanActive(eventScan);
  if (eventScan.budget.requestsUsed >= MAX_EVENT_LOG_REQUESTS_PER_SCAN) {
    const error = new Error(
      `Historical ${name} activity exceeded the aggregate ${MAX_EVENT_LOG_REQUESTS_PER_SCAN.toString()}-request safety bound.`,
    );
    throw recordEventScanFailure(eventScan, error);
  }
  eventScan.budget.requestsUsed += 1;
}

function reserveEventLogResults(
  eventScan: EventScanContext,
  name: ProductBoardroomEventName,
  count: number,
): void {
  assertEventScanActive(eventScan);
  if (count > MAX_EVENT_LOGS_PER_SCAN - eventScan.budget.logsUsed) {
    const error = new Error(
      `Historical ${name} activity exceeds the aggregate ${MAX_EVENT_LOGS_PER_SCAN.toLocaleString()}-event safety bound.`,
    );
    throw recordEventScanFailure(eventScan, error);
  }
  eventScan.budget.logsUsed += count;
}

async function readLogRangeAtKnownLimit(
  client: ProductBoardroomClient,
  address: Address,
  event: AbiEvent,
  name: ProductBoardroomEventName,
  fromBlock: bigint,
  toBlock: bigint,
  limit: bigint,
  eventScan: EventScanContext,
  args?: Record<string, unknown>,
): Promise<ProductBoardroomEventLog[]> {
  const logs: ProductBoardroomEventLog[] = [];
  let nextBlock = fromBlock;
  while (nextBlock <= toBlock) {
    assertEventScanActive(eventScan);
    const ranges = Array.from({ length: EVENT_LOG_CONCURRENCY }, (_, offset) => {
      const start = nextBlock + BigInt(offset) * limit;
      const end = minBigInt(start + limit - 1n, toBlock);
      return start <= toBlock ? { start, end } : undefined;
    }).filter((range): range is { start: bigint; end: bigint } => range !== undefined);
    const pages = await Promise.all(ranges.map(async ({ start, end }) =>
      await readLogRangeAdaptive(client, address, event, name, start, end, eventScan, args)));
    for (const page of pages) logs.push(...page);
    const last = ranges.at(-1);
    if (!last) break;
    nextBlock = last.end + 1n;
  }
  return logs;
}

function advertisedLogRangeLimit(error: unknown, attemptedSize: bigint): bigint | undefined {
  const values = [...logErrorText(error).toLowerCase().matchAll(/\b(\d[\d,_]*)\s*(?:blocks?|range)\b/g)]
    .map((match) => BigInt((match[1] ?? "").replace(/[,_]/g, "")))
    .filter((value) => value > 0n && value < attemptedSize);
  if (values.length === 0) return undefined;
  return values.reduce((smallest, value) => minBigInt(smallest, value));
}

function cacheEventLogRangeLimit(client: ProductBoardroomClient, limit: bigint): void {
  const current = eventLogRangeLimitCache.get(client);
  if (current === undefined || limit < current) eventLogRangeLimitCache.set(client, limit);
}

function isLogRangeLimitError(error: unknown): boolean {
  const message = logErrorText(error).toLowerCase();
  if (/(?:rate[ -]?limit|too many requests|\b429\b|quota|throttl)/.test(message)) return false;
  return [
    /(?:exceed|maximum|max|limit|limited)[^.\n]*block range/,
    /block range[^.\n]*(?:exceed|maximum|max|limit|too (?:large|wide))/,
    /range[^.\n]*(?:too (?:large|wide)|exceed|limit)/,
    /query returned more than/,
    /too many (?:logs|results)/,
    /response size[^.\n]*(?:exceed|limit|too large)/,
    /please (?:reduce|limit)[^.\n]*(?:block|range)/,
    /eth_getlogs[^.\n]*(?:exceed|limit|too (?:large|wide))/,
  ].some((pattern) => pattern.test(message));
}

function logErrorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current === "string") {
      parts.push(current);
      break;
    }
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
      continue;
    }
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      for (const field of ["shortMessage", "details", "message"] as const) {
        if (typeof record[field] === "string") parts.push(record[field]);
      }
      current = record.cause;
      continue;
    }
    parts.push(String(current));
    break;
  }
  return parts.join(" ");
}

function uniqueMessages(messages: readonly (string | undefined)[]): string[] {
  return Array.from(new Set(messages.filter((message): message is string => Boolean(message))));
}

function poolHistoryMismatchMessage(
  distribution: Address,
  currentPool: Address,
  historicalPool: Address,
): string {
  return `Current curve state for ${distribution} names vault ${currentPool}, but migration history names ${historicalPool}. Current vault identity takes precedence; historical Uniswap v4 coverage is unknown.`;
}

async function mapInBatches<T, U>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];
  for (let start = 0; start < values.length; start += concurrency) {
    const batch = values.slice(start, start + concurrency);
    results.push(...await Promise.all(batch.map(async (value, offset) => await mapper(value, start + offset))));
  }
  return results;
}

function minBigInt(first: bigint, second: bigint): bigint {
  return first < second ? first : second;
}

function maxBigInt(first: bigint, second: bigint): bigint {
  return first > second ? first : second;
}

function saturatingSubBigInt(value: bigint, decrement: bigint): bigint {
  return value > decrement ? value - decrement : 0n;
}

function uniqueAddresses(addresses: readonly Address[]): Address[] {
  const seen = new Set<string>();
  const unique: Address[] = [];
  for (const address of addresses) {
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(address);
  }
  return unique;
}

function distributionPaymentToken(distribution: BoardroomDistributionSnapshot): Address | undefined {
  if (!distribution.state) return undefined;
  if ("paymentToken" in distribution.state) return distribution.state.paymentToken;
  if ("quoteToken" in distribution.state) return distribution.state.quoteToken;
  return undefined;
}

function addressArg(args: Record<string, unknown> | undefined, name: string): Address | undefined {
  const value = args?.[name];
  return typeof value === "string" && isAddress(value) ? value : undefined;
}

function bigintArg(args: Record<string, unknown> | undefined, name: string): bigint {
  const value = args?.[name];
  return typeof value === "bigint" ? value : 0n;
}

function hexArg(args: Record<string, unknown> | undefined, name: string): Hex | undefined {
  const value = args?.[name];
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) ? value as Hex : undefined;
}

function sameAddress(first: Address | undefined, second: Address | undefined): boolean {
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase());
}

function nonZeroAddress(address: Address | undefined): Address | undefined {
  return address && !isZeroAddress(address) ? address : undefined;
}

function bigintCount(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  return 0n;
}
