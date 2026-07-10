import {
  ammPoolAbi,
  boardroomAbi,
  boardroomFactoryAbi,
  erc20Abi,
  fixedPriceSaleAbi,
  isZeroAddress,
  migratingBondingCurveAbi,
  type Address,
  type PledgeCashDeployment,
  type PledgeCashReadClient,
} from "@pledge.cash/sdk";
import { getAbiItem, isAddress, type AbiEvent, type PublicClient } from "viem";
import { readBoardroomDistributionSnapshot, readBoardroomSnapshot } from "./boardroom-snapshot";
import { errorMessage } from "./forms";
import { formatNativeTokenAmount, formatTokenAmount } from "./token-amounts";
import type {
  BoardroomDistributionSnapshot,
  BoardroomGrantSnapshot,
  BoardroomLockedLiquiditySnapshot,
  BoardroomSnapshot,
} from "./types";

export type ProductBoardroomCatalogEntry = {
  address: Address;
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
  liquidity?: bigint | undefined;
  locker?: Address | undefined;
  name?: string | undefined;
  path?: string | undefined;
  pool?: Address | undefined;
  quoteToBoardroom?: bigint | undefined;
  quoteToLiquidity?: bigint | undefined;
  sellCount?: number | undefined;
  shareToken?: Address | undefined;
  shareTokenDecimals?: number | undefined;
  sharesToLiquidity?: bigint | undefined;
  soldShares?: bigint | undefined;
  status?: string | undefined;
  swapCount?: number | undefined;
  symbol?: string | undefined;
  treasuryCash?: bigint | undefined;
};

export type ProductBoardroomHistory = {
  amm?: ProductBoardroomAmmHistory | undefined;
  buyerCount?: number | undefined;
  cashRaised?: bigint | undefined;
  curve?: ProductBoardroomCurveHistory | undefined;
  distribution?: Address | undefined;
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
  buyerCount: number;
  buyCount: number;
  cashRaised: bigint;
  migration?: ProductBoardroomCurveMigrationHistory | undefined;
  quotePaid: bigint;
  quoteReturned: bigint;
  sellCount: number;
  soldShares: bigint;
};

export type ProductBoardroomCurveMigrationHistory = {
  liquidity: bigint;
  locker: Address;
  pool: Address;
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
  history?: ProductBoardroomHistory | undefined;
  histories?: ProductBoardroomHistory[] | undefined;
  nativeBalance: bigint;
  snapshot: BoardroomSnapshot;
  treasuryAssets: ProductTreasuryAsset[];
};

type ProductBoardroomClient = PledgeCashReadClient & Pick<PublicClient, "getBalance"> & Partial<Pick<PublicClient, "getBlockNumber" | "getCode" | "getLogs">>;
type ProductBoardroomEventLog = { args?: Record<string, unknown> };
type ProductBoardroomEventAbi = typeof ammPoolAbi | typeof boardroomAbi | typeof fixedPriceSaleAbi | typeof migratingBondingCurveAbi;
type ProductBoardroomEventName = "BoardroomDistributionRecorded" | "CurveBuy" | "CurveMigrated" | "CurveSell" | "FixedPricePurchase" | "Swap";

const CATALOG_READ_CONCURRENCY = 8;
const EVENT_LOG_CHUNK_SIZE = 100_000n;
const EVENT_LOG_CONCURRENCY = 4;
const MIN_EVENT_LOG_CHUNK_SIZE = 1_000n;
const FACTORY_PAGE_SIZE = 64;
const WAD = 1_000_000_000_000_000_000n;
const contractStartBlockCache = new WeakMap<object, Map<string, Promise<bigint>>>();
const eventLogCache = new WeakMap<object, Map<string, Promise<ProductBoardroomEventLog[]>>>();

export async function readProductBoardroomDashboard(
  client: ProductBoardroomClient,
  input: {
    address: Address;
    catalog?: ProductBoardroomCatalogEntry[] | undefined;
    deployment?: PledgeCashDeployment | undefined;
  },
): Promise<ProductBoardroomDashboardState> {
  const [currentSnapshot, nativeBalance] = await Promise.all([
    readBoardroomSnapshot(client, input.address),
    client.getBalance({ address: input.address }),
  ]);
  const snapshot = await hydrateHistoricalDistributions(client, currentSnapshot);
  const catalog = input.catalog ?? await readProductBoardroomCatalog(client, input.deployment);
  const activeCatalogEntry = catalog.find((entry) => sameAddress(entry.address, input.address));
  const [treasuryAssets, histories] = await Promise.all([
    readTreasuryAssets(client, snapshot, activeCatalogEntry),
    readProductBoardroomHistories(client, snapshot),
  ]);
  const history = selectPrimaryHistory(histories, activeCatalogEntry);

  return {
    address: input.address,
    catalog,
    histories,
    history,
    nativeBalance,
    snapshot,
    treasuryAssets,
  };
}

export async function readProductBoardroomCatalog(
  client: ProductBoardroomClient,
  deployment: PledgeCashDeployment | undefined,
): Promise<ProductBoardroomCatalogEntry[]> {
  if (!deployment?.boardroomFactory) return [];

  try {
    return await discoverProductBoardroomCatalog(client, deployment.boardroomFactory);
  } catch {
    return [];
  }
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

  return await Promise.all(
    Array.from(labels.entries()).map(async ([address, label]) => await readTreasuryAsset(client, snapshot.address, address, label)),
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

  for (const asset of snapshot.redeemableAssets) {
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

async function discoverProductBoardroomCatalog(
  client: ProductBoardroomClient,
  factory: Address,
): Promise<ProductBoardroomCatalogEntry[]> {
  const addresses = await readFactoryBoardrooms(client, factory);
  return await mapInBatches(
    uniqueAddresses(addresses),
    CATALOG_READ_CONCURRENCY,
    async (address) => await readProductBoardroomCatalogEntry(client, address),
  );
}

export async function readFactoryBoardrooms(client: ProductBoardroomClient, factory: Address): Promise<Address[]> {
  const rawCount = await client.readContract({
    address: factory,
    abi: boardroomFactoryAbi,
    functionName: "allBoardroomsLength",
  });
  const count = safeCount(rawCount, "Boardroom count");
  const addresses: Address[] = [];

  // Read newest projects first, one bounded page at a time. This avoids the old
  // silent 64-project truncation without fanning an unbounded RPC burst.
  for (let end = count; end > 0; end = Math.max(0, end - FACTORY_PAGE_SIZE)) {
    const start = Math.max(0, end - FACTORY_PAGE_SIZE);
    const indexes = Array.from({ length: end - start }, (_, offset) => end - offset - 1);
    addresses.push(...await Promise.all(indexes.map(async (index) =>
      (await client.readContract({
        address: factory,
        abi: boardroomFactoryAbi,
        functionName: "allBoardrooms",
        args: [BigInt(index)],
      })) as Address
    )));
  }

  return addresses;
}

async function readProductBoardroomCatalogEntry(
  client: ProductBoardroomClient,
  address: Address,
): Promise<ProductBoardroomCatalogEntry> {
  try {
    const snapshot = await hydrateHistoricalDistributions(client, await readBoardroomSnapshot(client, address));
    const distribution = findCatalogDistribution(snapshot.distributionSummaries);
    const distributionState = distribution ? deriveDistributionCatalogFields(distribution, snapshot.shareTokenMetadata?.decimals) : {};
    const locker = findCatalogLocker(snapshot, distributionState.pool);
    const pool = catalogPoolAddress(distributionState, locker);
    const histories = await readProductBoardroomHistories(client, snapshot);
    const history = selectPrimaryHistory(histories, {
      distribution: distribution?.address,
      pool,
    });
    const cashToken = distributionState.cashToken;
    const treasuryCash = await readCatalogTreasuryCash(client, address, cashToken);
    const shareName = await readOptionalTokenName(client, snapshot.shareToken);

    return {
      address,
      distributionAddresses: snapshot.distributionSummaries.map((entry) => entry.address),
      distributionCount: snapshot.distributionSummaries.length,
      name: shareName,
      shareToken: snapshot.shareToken,
      shareTokenDecimals: snapshot.shareTokenMetadata?.decimals,
      symbol: snapshot.shareTokenMetadata?.symbol,
      treasuryCash,
      ...distributionState,
      ...catalogHistoryFields(history),
      locker: catalogLockerAddress(history, distributionState, locker),
      pool: history?.pool ?? pool,
    };
  } catch (error) {
    return {
      address,
      error: errorMessage(error),
      status: "Read failed",
    };
  }
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

function catalogPoolAddress(
  distributionState: Partial<ProductBoardroomCatalogEntry>,
  locker: BoardroomLockedLiquiditySnapshot | undefined,
): Address | undefined {
  return distributionState.pool ?? locker?.state?.pool;
}

function catalogLockerAddress(
  history: ProductBoardroomHistory | undefined,
  distributionState: Partial<ProductBoardroomCatalogEntry>,
  locker: BoardroomLockedLiquiditySnapshot | undefined,
): Address | undefined {
  return history?.curve?.migration?.locker ?? distributionState.locker ?? locker?.address;
}

export async function readProductBoardroomHistory(
  client: ProductBoardroomClient,
  snapshot: BoardroomSnapshot,
  catalogEntry: ProductBoardroomCatalogEntry | undefined,
): Promise<ProductBoardroomHistory | undefined> {
  return selectPrimaryHistory(await readProductBoardroomHistories(client, snapshot), catalogEntry);
}

export async function readProductBoardroomHistories(
  client: ProductBoardroomClient,
  snapshot: BoardroomSnapshot,
): Promise<ProductBoardroomHistory[]> {
  const histories = await mapInBatches(
    snapshot.distributionSummaries,
    CATALOG_READ_CONCURRENCY,
    async (distribution): Promise<ProductBoardroomHistory | undefined> => {
      try {
        return await readDistributionHistory(client, distribution, undefined);
      } catch (error) {
        return {
          distribution: distribution.address,
          scanError: errorMessage(error),
        };
      }
    },
  );
  return histories.filter((history): history is ProductBoardroomHistory => history !== undefined);
}

async function hydrateHistoricalDistributions(
  client: ProductBoardroomClient,
  snapshot: BoardroomSnapshot,
): Promise<BoardroomSnapshot> {
  const logs = await readEventLogs(client, snapshot.address, boardroomAbi, "BoardroomDistributionRecorded");
  if (!logs) return snapshot;
  const recorded = uniqueAddresses(logs
    .map((log) => addressArg(log.args, "distribution"))
    .filter((address): address is Address => address !== undefined));
  const missing = recorded.filter((address) =>
    !snapshot.distributionSummaries.some((distribution) => sameAddress(distribution.address, address)));
  if (missing.length === 0) return snapshot;
  const historical = await mapInBatches(
    missing,
    CATALOG_READ_CONCURRENCY,
    async (distribution) => await readBoardroomDistributionSnapshot(client, distribution),
  );
  return {
    ...snapshot,
    distributionSummaries: [...snapshot.distributionSummaries, ...historical],
  };
}

function deriveDistributionCatalogFields(
  distribution: BoardroomDistributionSnapshot,
  shareTokenDecimals: number | undefined,
): Partial<ProductBoardroomCatalogEntry> {
  if (!distribution.state) {
    return {
      distribution: distribution.address,
      distributionKind: distribution.kind,
      path: distribution.kind === "unknown" ? "Distribution" : distribution.kind,
      status: distribution.error ? "Read failed" : "Unknown",
    };
  }

  if ("paymentToken" in distribution.state) {
    const state = distribution.state;
    const soldShares = state.saleSupply - state.remainingShares;
    return {
      cashRaised: fixedPriceSaleCashRaised(soldShares, state.price),
      cashToken: state.paymentToken,
      cashTokenDecimals: distribution.paymentTokenMetadata?.decimals,
      cashTokenSymbol: distribution.paymentTokenMetadata?.symbol,
      distribution: distribution.address,
      distributionKind: "fixed-price-sale",
      path: "Fixed price sale",
      soldShares,
      status: fixedPriceSaleStatusLabel(state.saleStatus),
    };
  }

  if ("airdropSupply" in distribution.state) {
    const state = distribution.state;
    return {
      distribution: distribution.address,
      distributionKind: "merkle-airdrop",
      path: "Merkle airdrop",
      soldShares: distributionCirculatingShares(distribution),
      status: merkleAirdropStatusLabel(state.airdropStatus),
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
  return {
    cashRaised: state.quoteReserve,
    cashToken: state.quoteToken,
    cashTokenDecimals: distribution.quoteTokenMetadata?.decimals,
    cashTokenSymbol: distribution.quoteTokenMetadata?.symbol,
    distribution: distribution.address,
    distributionKind: "migrating-bonding-curve",
    locker: nonZeroAddress(state.locker),
    path: migrated ? "Migrated curve + AMM" : "Bonding curve",
    pool: nonZeroAddress(state.pool),
    soldShares: state.soldShares,
    status: migratingCurveStatusLabel(state.curveStatus),
    shareTokenDecimals,
  };
}

async function readDistributionHistory(
  client: ProductBoardroomClient,
  distribution: BoardroomDistributionSnapshot,
  pool: Address | undefined,
): Promise<ProductBoardroomHistory | undefined> {
  if (!distribution.state) return undefined;

  if ("paymentToken" in distribution.state) {
    const fixedPriceSale = await readFixedPriceSaleHistory(client, distribution.address);
    if (!fixedPriceSale) return undefined;
    return {
      buyerCount: fixedPriceSale.buyerCount,
      cashRaised: fixedPriceSale.cashRaised,
      distribution: distribution.address,
      fixedPriceSale,
      soldShares: fixedPriceSale.soldShares,
    };
  }

  if ("airdropSupply" in distribution.state) {
    return {
      distribution: distribution.address,
      soldShares: distributionCirculatingShares(distribution),
    };
  }

  if (!("quoteToken" in distribution.state)) return undefined;

  const curve = await readCurveHistory(client, distribution.address);
  const historyPool = curve?.migration?.pool ?? pool ?? nonZeroAddress(distribution.state.pool);
  const amm = historyPool ? await readAmmHistory(client, historyPool) : undefined;
  if (!curve && !amm) return undefined;

  return {
    amm,
    buyerCount: curve?.buyerCount,
    cashRaised: curve?.cashRaised,
    curve,
    distribution: distribution.address,
    pool: historyPool,
    soldShares: curve?.soldShares,
  };
}

async function readFixedPriceSaleHistory(
  client: ProductBoardroomClient,
  sale: Address,
): Promise<ProductBoardroomFixedPriceSaleHistory | undefined> {
  const logs = await readEventLogs(client, sale, fixedPriceSaleAbi, "FixedPricePurchase");
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
): Promise<ProductBoardroomCurveHistory | undefined> {
  const [buyLogs, sellLogs, migrationLogs] = await Promise.all([
    readEventLogs(client, curve, migratingBondingCurveAbi, "CurveBuy"),
    readEventLogs(client, curve, migratingBondingCurveAbi, "CurveSell"),
    readEventLogs(client, curve, migratingBondingCurveAbi, "CurveMigrated"),
  ]);
  if (!buyLogs || !sellLogs || !migrationLogs) return undefined;

  const buyers = new Set<string>();
  let boughtShares = 0n;
  let soldBackShares = 0n;
  let quotePaid = 0n;
  let quoteReturned = 0n;

  for (const log of buyLogs) {
    const buyer = addressArg(log.args, "buyer");
    if (buyer) buyers.add(buyer.toLowerCase());
    boughtShares += bigintArg(log.args, "shares");
    quotePaid += bigintArg(log.args, "quotePaid");
  }
  for (const log of sellLogs) {
    soldBackShares += bigintArg(log.args, "shares");
    quoteReturned += bigintArg(log.args, "quoteReturned");
  }

  const migrationLog = migrationLogs[migrationLogs.length - 1];
  const migration = migrationLog
    ? curveMigrationHistory(migrationLog.args)
    : undefined;
  const soldShares = boughtShares > soldBackShares ? boughtShares - soldBackShares : 0n;
  const cashRaised = quotePaid > quoteReturned ? quotePaid - quoteReturned : 0n;

  return {
    buyerCount: buyers.size,
    buyCount: buyLogs.length,
    cashRaised,
    migration,
    quotePaid,
    quoteReturned,
    sellCount: sellLogs.length,
    soldShares,
  };
}

async function readAmmHistory(
  client: ProductBoardroomClient,
  pool: Address,
): Promise<ProductBoardroomAmmHistory | undefined> {
  const logs = await readEventLogs(client, pool, ammPoolAbi, "Swap");
  if (!logs) return undefined;

  const traders = new Set<string>();
  let amount0In = 0n;
  let amount0Out = 0n;
  let amount1In = 0n;
  let amount1Out = 0n;

  for (const log of logs) {
    const sender = addressArg(log.args, "sender");
    if (sender) traders.add(sender.toLowerCase());
    amount0In += bigintArg(log.args, "amount0In");
    amount0Out += bigintArg(log.args, "amount0Out");
    amount1In += bigintArg(log.args, "amount1In");
    amount1Out += bigintArg(log.args, "amount1Out");
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
): Promise<ProductBoardroomEventLog[] | undefined> {
  if (!client.getBlockNumber || !client.getLogs) return undefined;
  const toBlock = await client.getBlockNumber();
  const cacheKey = `${address.toLowerCase()}:${name}:${toBlock.toString()}`;
  let clientCache = eventLogCache.get(client);
  if (!clientCache) {
    clientCache = new Map();
    eventLogCache.set(client, clientCache);
  }
  const cached = clientCache.get(cacheKey);
  if (cached) return await cached;

  const request = readEventLogsInChunks(client, address, abi, name, toBlock);
  clientCache.set(cacheKey, request);
  try {
    return await request;
  } catch (error) {
    clientCache.delete(cacheKey);
    throw error;
  }
}

async function readEventLogsInChunks(
  client: ProductBoardroomClient,
  address: Address,
  abi: ProductBoardroomEventAbi,
  name: ProductBoardroomEventName,
  toBlock: bigint,
): Promise<ProductBoardroomEventLog[]> {
  if (!client.getLogs) return [];
  const fromBlock = await contractStartBlock(client, address, toBlock);
  if (fromBlock > toBlock) return [];
  const event = getAbiItem({ abi, name }) as AbiEvent;
  const logs: ProductBoardroomEventLog[] = [];
  let nextBlock = fromBlock;

  while (nextBlock <= toBlock) {
    const ranges = Array.from({ length: EVENT_LOG_CONCURRENCY }, (_, offset) => {
      const start = nextBlock + BigInt(offset) * EVENT_LOG_CHUNK_SIZE;
      const end = minBigInt(start + EVENT_LOG_CHUNK_SIZE - 1n, toBlock);
      return start <= toBlock ? { start, end } : undefined;
    }).filter((range): range is { start: bigint; end: bigint } => range !== undefined);
    const pages = await Promise.all(ranges.map(async ({ start, end }) =>
      await readLogRangeAdaptive(client, address, event, start, end)));
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
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ProductBoardroomEventLog[]> {
  if (!client.getLogs) return [];
  try {
    return await client.getLogs({ address, event, fromBlock, toBlock }) as ProductBoardroomEventLog[];
  } catch (error) {
    const size = toBlock - fromBlock + 1n;
    if (size <= MIN_EVENT_LOG_CHUNK_SIZE) throw error;
    const middle = fromBlock + (toBlock - fromBlock) / 2n;
    const [first, second] = await Promise.all([
      readLogRangeAdaptive(client, address, event, fromBlock, middle),
      readLogRangeAdaptive(client, address, event, middle + 1n, toBlock),
    ]);
    return [...first, ...second];
  }
}

async function contractStartBlock(
  client: ProductBoardroomClient,
  address: Address,
  toBlock: bigint,
): Promise<bigint> {
  if (!client.getCode) return 0n;
  let clientCache = contractStartBlockCache.get(client);
  if (!clientCache) {
    clientCache = new Map();
    contractStartBlockCache.set(client, clientCache);
  }
  const key = address.toLowerCase();
  const cached = clientCache.get(key);
  if (cached) return await cached;

  const request = findContractStartBlock(client, address, toBlock);
  clientCache.set(key, request);
  try {
    return await request;
  } catch {
    clientCache.delete(key);
    return 0n;
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
  const locker = addressArg(args, "locker");
  const pool = addressArg(args, "pool");
  if (!locker || !pool) return undefined;
  return {
    liquidity: bigintArg(args, "liquidity"),
    locker,
    pool,
    quoteToBoardroom: bigintArg(args, "quoteToBoardroom"),
    quoteToLiquidity: bigintArg(args, "quoteToLiquidity"),
    sharesToLiquidity: bigintArg(args, "sharesToLiquidity"),
  };
}

function catalogHistoryFields(history: ProductBoardroomHistory | undefined): Partial<ProductBoardroomCatalogEntry> {
  if (!history) return {};
  return {
    buyerCount: history.buyerCount,
    buyCount: history.curve?.buyCount,
    cashRaised: history.cashRaised,
    liquidity: history.curve?.migration?.liquidity,
    pool: history.pool,
    quoteToBoardroom: history.curve?.migration?.quoteToBoardroom,
    quoteToLiquidity: history.curve?.migration?.quoteToLiquidity,
    sellCount: history.curve?.sellCount,
    sharesToLiquidity: history.curve?.migration?.sharesToLiquidity,
    soldShares: history.soldShares,
    swapCount: history.amm?.swapCount,
  };
}

function findCatalogDistribution(
  distributions: readonly BoardroomDistributionSnapshot[],
): BoardroomDistributionSnapshot | undefined {
  return distributions.find(distributionIsActive)
    ?? distributions.find((distribution) => distribution.kind === "migrating-bonding-curve" && Boolean(nonZeroAddress(
      distribution.state && "quoteToken" in distribution.state ? distribution.state.pool : undefined,
    )))
    ?? distributions[0];
}

function distributionIsActive(distribution: BoardroomDistributionSnapshot): boolean {
  if (!distribution.state || distribution.state.closed) return false;
  if ("saleStatus" in distribution.state) return distribution.state.saleStatus === 0;
  if ("curveStatus" in distribution.state) return distribution.state.curveStatus === 0;
  if ("airdropStatus" in distribution.state) return distribution.state.airdropStatus === 0;
  return false;
}

function selectPrimaryHistory(
  histories: readonly ProductBoardroomHistory[],
  catalogEntry: Pick<ProductBoardroomCatalogEntry, "distribution" | "pool"> | undefined,
): ProductBoardroomHistory | undefined {
  if (catalogEntry?.distribution) {
    const exact = histories.find((history) => sameAddress(history.distribution, catalogEntry.distribution));
    if (exact) return {
      ...exact,
      pool: exact.pool ?? catalogEntry.pool,
    };
  }
  return histories.find((history) => history.pool || history.curve?.migration)
    ?? histories[0];
}

function findCatalogLocker(snapshot: BoardroomSnapshot, pool: Address | undefined) {
  if (pool) {
    const matching = snapshot.lockedLiquiditySummaries.find(
      (locker) => locker.state?.pool.toLowerCase() === pool.toLowerCase(),
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
  if ("paymentToken" in distribution.state) return distribution.state.saleSupply - distribution.state.remainingShares;
  if ("airdropSupply" in distribution.state) return distribution.state.claimedShares;
  if ("quoteToken" in distribution.state) return distribution.state.soldShares;
  return undefined;
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

async function readOptionalTokenName(client: PledgeCashReadClient, address: Address): Promise<string | undefined> {
  try {
    return await client.readContract({ address, abi: erc20Abi, functionName: "name" }) as string;
  } catch {
    return undefined;
  }
}

function safeCount(value: unknown, label: string): number {
  const parsed = bigintCount(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the browser's safe discovery range.`);
  }
  return Number(parsed);
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

function uniqueAddresses(addresses: Address[]): Address[] {
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
