import {
  ammPoolAbi,
  boardroomFactoryAbi,
  erc20Abi,
  fixedPriceSaleAbi,
  isZeroAddress,
  migratingBondingCurveAbi,
  type Address,
  type PledgeCashDeployment,
  type PledgeCashReadClient,
} from "@pledge.cash/sdk";
import { getAbiItem, isAddress, type PublicClient } from "viem";
import { readBoardroomSnapshot } from "./boardroom-snapshot";
import { errorMessage } from "./forms";
import { formatNativeTokenAmount, formatTokenAmount } from "./token-amounts";
import type { BoardroomDistributionSnapshot, BoardroomSnapshot } from "./types";

export type ProductBoardroomCatalogEntry = {
  address: Address;
  buyerCount?: number | undefined;
  buyCount?: number | undefined;
  cashRaised?: bigint | undefined;
  cashToken?: Address | undefined;
  cashTokenDecimals?: number | undefined;
  cashTokenSymbol?: string | undefined;
  distribution?: Address | undefined;
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
  nativeBalance: bigint;
  snapshot: BoardroomSnapshot;
  treasuryAssets: ProductTreasuryAsset[];
};

type ProductBoardroomClient = PledgeCashReadClient & Pick<PublicClient, "getBalance"> & Partial<Pick<PublicClient, "getBlockNumber" | "getLogs">>;
const MAX_DISCOVERED_BOARDROOMS = 64;
const WAD = 1_000_000_000_000_000_000n;

export async function readProductBoardroomDashboard(
  client: ProductBoardroomClient,
  input: {
    address: Address;
    catalog?: ProductBoardroomCatalogEntry[] | undefined;
    deployment?: PledgeCashDeployment | undefined;
  },
): Promise<ProductBoardroomDashboardState> {
  const [snapshot, nativeBalance] = await Promise.all([
    readBoardroomSnapshot(client, input.address),
    client.getBalance({ address: input.address }),
  ]);
  const catalog = input.catalog ?? await readProductBoardroomCatalog(client, input.deployment);
  const activeCatalogEntry = catalog.find((entry) => sameAddress(entry.address, input.address));
  const [treasuryAssets, history] = await Promise.all([
    readTreasuryAssets(client, snapshot, activeCatalogEntry),
    readProductBoardroomHistory(client, snapshot, activeCatalogEntry),
  ]);

  return {
    address: input.address,
    catalog,
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
    if (grant.state) {
      addAsset(labels, grant.state.token, grant.state.token.toLowerCase() === snapshot.shareToken.toLowerCase() ? "Treasury shares" : "Grant token");
      if (!isZeroAddress(grant.state.paymentToken)) {
        addAsset(labels, grant.state.paymentToken, "Revenue token");
      }
    }
  }

  return await Promise.all(
    Array.from(labels.entries()).map(async ([address, label]) => await readTreasuryAsset(client, snapshot.address, address, label)),
  );
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

async function discoverProductBoardroomCatalog(
  client: ProductBoardroomClient,
  factory: Address,
): Promise<ProductBoardroomCatalogEntry[]> {
  const rawCount = await client.readContract({
    address: factory,
    abi: boardroomFactoryAbi,
    functionName: "allBoardroomsLength",
  });
  const count = boundedCount(rawCount);
  const addresses = await Promise.all(
    Array.from({ length: count }, async (_, index) =>
      (await client.readContract({
        address: factory,
        abi: boardroomFactoryAbi,
        functionName: "allBoardrooms",
        args: [BigInt(index)],
      })) as Address
    ),
  );

  return await Promise.all(
    uniqueAddresses(addresses).map(async (address) => await readProductBoardroomCatalogEntry(client, address)),
  );
}

async function readProductBoardroomCatalogEntry(
  client: ProductBoardroomClient,
  address: Address,
): Promise<ProductBoardroomCatalogEntry> {
  try {
    const snapshot = await readBoardroomSnapshot(client, address);
    const distribution = snapshot.distributionSummaries[0];
    const distributionState = distribution ? deriveDistributionCatalogFields(distribution, snapshot.shareTokenMetadata?.decimals) : {};
    const locker = findCatalogLocker(snapshot, distributionState.pool);
    const pool = distributionState.pool ?? locker?.state?.pool;
    const history = distribution ? await readDistributionHistory(client, distribution, pool) : undefined;
    const cashToken = distributionState.cashToken;
    const treasuryCash = cashToken
      ? ((await client.readContract({
          address: cashToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        })) as bigint)
      : undefined;
    const shareName = await readOptionalTokenName(client, snapshot.shareToken);

    return {
      address,
      name: shareName,
      shareToken: snapshot.shareToken,
      shareTokenDecimals: snapshot.shareTokenMetadata?.decimals,
      symbol: snapshot.shareTokenMetadata?.symbol,
      treasuryCash,
      ...distributionState,
      ...catalogHistoryFields(history),
      locker: history?.curve?.migration?.locker ?? distributionState.locker ?? locker?.address,
      pool: history?.pool ?? distributionState.pool ?? locker?.state?.pool,
    };
  } catch (error) {
    return {
      address,
      error: errorMessage(error),
      status: "Read failed",
    };
  }
}

export async function readProductBoardroomHistory(
  client: ProductBoardroomClient,
  snapshot: BoardroomSnapshot,
  catalogEntry: ProductBoardroomCatalogEntry | undefined,
): Promise<ProductBoardroomHistory | undefined> {
  const distribution = findHistoryDistribution(snapshot, catalogEntry?.distribution);
  if (!distribution) return undefined;

  try {
    const history = await readDistributionHistory(client, distribution, catalogEntry?.pool);
    if (!history) return undefined;
    return {
      ...history,
      pool: history.pool ?? catalogEntry?.pool,
    };
  } catch (error) {
    return {
      distribution: distribution.address,
      pool: catalogEntry?.pool,
      scanError: errorMessage(error),
    };
  }
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

  if ("remainingShares" in distribution.state) {
    const soldShares = distribution.state.saleSupply - distribution.state.remainingShares;
    return {
      cashRaised: fixedPriceSaleCashRaised(soldShares, distribution.state.price),
      cashToken: distribution.state.paymentToken,
      cashTokenDecimals: distribution.paymentTokenMetadata?.decimals,
      cashTokenSymbol: distribution.paymentTokenMetadata?.symbol,
      distribution: distribution.address,
      distributionKind: "fixed-price-sale",
      path: "Fixed price sale",
      soldShares,
      status: fixedPriceSaleStatusLabel(distribution.state.saleStatus),
    };
  }

  const migrated = distribution.state.curveStatus === 1;
  return {
    cashRaised: distribution.state.quoteReserve,
    cashToken: distribution.state.quoteToken,
    cashTokenDecimals: distribution.quoteTokenMetadata?.decimals,
    cashTokenSymbol: distribution.quoteTokenMetadata?.symbol,
    distribution: distribution.address,
    distributionKind: "migrating-bonding-curve",
    locker: nonZeroAddress(distribution.state.locker),
    path: migrated ? "Migrated curve + AMM" : "Bonding curve",
    pool: nonZeroAddress(distribution.state.pool),
    soldShares: distribution.state.soldShares,
    status: migratingCurveStatusLabel(distribution.state.curveStatus),
    shareTokenDecimals,
  };
}

async function readDistributionHistory(
  client: ProductBoardroomClient,
  distribution: BoardroomDistributionSnapshot,
  pool: Address | undefined,
): Promise<ProductBoardroomHistory | undefined> {
  if (!distribution.state) return undefined;

  if ("remainingShares" in distribution.state) {
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
  abi: typeof ammPoolAbi | typeof fixedPriceSaleAbi | typeof migratingBondingCurveAbi,
  name: "CurveBuy" | "CurveMigrated" | "CurveSell" | "FixedPricePurchase" | "Swap",
): Promise<{ args?: Record<string, unknown> }[] | undefined> {
  if (!client.getBlockNumber || !client.getLogs) return undefined;
  const toBlock = await client.getBlockNumber();
  const event = getAbiItem({ abi, name });
  const logs = await client.getLogs({ address, event, fromBlock: 0n, toBlock });
  return logs as { args?: Record<string, unknown> }[];
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

function findHistoryDistribution(
  snapshot: BoardroomSnapshot,
  distributionAddress: Address | undefined,
): BoardroomDistributionSnapshot | undefined {
  if (distributionAddress) {
    const selected = snapshot.distributionSummaries.find((distribution) => sameAddress(distribution.address, distributionAddress));
    if (selected) return selected;
  }
  return snapshot.distributionSummaries.find((distribution) => distribution.kind === "migrating-bonding-curve") ?? snapshot.distributionSummaries[0];
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

function fixedPriceSaleStatusLabel(status: number): string {
  if (status === 0) return "Active sale";
  if (status === 1) return "Closed sale";
  if (status === 2) return "Cancelled sale";
  return "Unknown sale";
}

function migratingCurveStatusLabel(status: number): string {
  if (status === 0) return "Open curve";
  if (status === 1) return "Live AMM";
  if (status === 2) return "Cancelled curve";
  return "Unknown curve";
}

async function readOptionalTokenName(client: PledgeCashReadClient, address: Address): Promise<string | undefined> {
  try {
    return await client.readContract({ address, abi: erc20Abi, functionName: "name" }) as string;
  } catch {
    return undefined;
  }
}

function boundedCount(value: unknown): number {
  const parsed = typeof value === "bigint" ? value : typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : 0n;
  return Number(parsed > BigInt(MAX_DISCOVERED_BOARDROOMS) ? BigInt(MAX_DISCOVERED_BOARDROOMS) : parsed);
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
