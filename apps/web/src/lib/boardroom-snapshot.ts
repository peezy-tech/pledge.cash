import {
  ammPoolAbi,
  bondMarketFactoryAbi,
  boardroomAbi,
  distributionFactoryAbi,
  erc20Abi,
  isZeroAddress,
  lockedLiquidityFactoryAbi,
  queryGrantsIssuedByAddress,
  type Address,
  type LockedLiquidityState,
  type PledgeCashDeployment,
  type PledgeCashLogClient,
  readBoardroomState,
  readBondMarketState,
  readDutchAuctionState,
  readFixedPriceSaleState,
  readGrantState,
  readLockedLiquidityState,
  readMerkleAirdropState,
  readMigratingBondingCurveState,
  type PledgeCashReadClient,
} from "@pledge.cash/sdk";
import type { PublicClient } from "viem";
import { errorMessage } from "./forms";
import { readTokenMetadataMap, tokenMetadataFor, type TokenMetadata } from "./token-amounts";
import type { BoardroomDistributionSnapshot, BoardroomGrantSnapshot, BoardroomLockedLiquiditySnapshot, BoardroomSnapshot } from "./types";

const FEE_INDEX_SCALE = 1_000_000_000_000_000_000n;
export const PRODUCT_CATALOG_CHILD_READ_LIMIT = 12;
const PRODUCT_CATALOG_CHILD_READ_CONCURRENCY = 4;
export const PRODUCT_DETAIL_CHILD_READ_LIMIT = 64;
const PRODUCT_DETAIL_CHILD_READ_CONCURRENCY = 4;

export type BoardroomCatalogSnapshot = {
  address: Address;
  distributionCount: number;
  distributionSummaries: BoardroomDistributionSnapshot[];
  lockedLiquidityCount: number;
  lockedLiquiditySummaries: BoardroomLockedLiquiditySnapshot[];
  shareToken: Address;
  shareTokenMetadata?: TokenMetadata | undefined;
};

/** Reads only the newest bounded set of child contracts needed for an Explore row. */
export async function readBoardroomCatalogSnapshot(
  client: BoardroomSnapshotClient,
  address: Address,
  deployment?: PledgeCashDeployment,
): Promise<BoardroomCatalogSnapshot> {
  const shareToken = await client.readContract({
    address,
    abi: boardroomAbi,
    functionName: "shareToken",
  }) as Address;
  const [{ addresses: distributionAddresses, total: distributionCount }, lockedLiquidityAddresses, metadataByAddress] =
    await Promise.all([
      readCanonicalDistributionAddresses(client, address, deployment, PRODUCT_CATALOG_CHILD_READ_LIMIT),
      readCanonicalLiquidityAddresses(client, address, undefined, deployment),
      readTokenMetadataMap(client, [shareToken]),
    ]);
  const lockedLiquidityCount = lockedLiquidityAddresses.length;
  const [distributionSummaries, lockedLiquiditySummaries] = await Promise.all([
    mapInBatches(
      distributionAddresses,
      PRODUCT_CATALOG_CHILD_READ_CONCURRENCY,
      async (distribution) => await readBoardroomDistributionSnapshot(client, distribution),
    ),
    mapInBatches(
      lockedLiquidityAddresses,
      PRODUCT_CATALOG_CHILD_READ_CONCURRENCY,
      async (locker) => await readBoardroomLockedLiquiditySnapshot(client, locker),
    ),
  ]);

  return {
    address,
    distributionCount,
    distributionSummaries,
    lockedLiquidityCount,
    lockedLiquiditySummaries,
    shareToken,
    shareTokenMetadata: tokenMetadataFor(metadataByAddress, shareToken),
  };
}

type BoardroomSnapshotClient =
  & PledgeCashReadClient
  & Pick<PublicClient, "getBlockNumber">
  & Partial<Pick<PublicClient, "getCode" | "getLogs">>;

export async function readBoardroomSnapshot(
  client: BoardroomSnapshotClient,
  address: Address,
  deployment?: PledgeCashDeployment,
): Promise<BoardroomSnapshot> {
  const state = await readBoardroomState(client, address);
  const [grantDiscovery, distributionDiscovery, lockedLiquidityAddresses, redeemableAssets] = await Promise.all([
    readCanonicalGrantAddresses(client, address, deployment),
    readCanonicalDistributionAddresses(client, address, deployment, PRODUCT_DETAIL_CHILD_READ_LIMIT),
    readCanonicalLiquidityAddresses(client, address, state.liquidityLocker, deployment),
    readNewestRedeemableAssets(client, address, state.redeemableAssetCount, PRODUCT_DETAIL_CHILD_READ_LIMIT),
  ]);
  const grantAddresses = grantDiscovery.addresses;
  const distributionAddresses = distributionDiscovery.addresses;
  const [grantSummaries, distributionSummaries, lockedLiquiditySummaries] = await Promise.all([
    mapInBatches(grantAddresses, PRODUCT_DETAIL_CHILD_READ_CONCURRENCY, async (grant) => await readGrantSummary(client, grant)),
    mapInBatches(
      distributionAddresses,
      PRODUCT_DETAIL_CHILD_READ_CONCURRENCY,
      async (distribution) => await readDistributionSummary(client, distribution),
    ),
    mapInBatches(
      lockedLiquidityAddresses,
      PRODUCT_DETAIL_CHILD_READ_CONCURRENCY,
      async (locker) => await readLockedLiquiditySummary(client, locker),
    ),
  ]);
  const metadataByAddress = await readTokenMetadataMap(client, [
    state.shareToken,
    ...grantSummaries.flatMap(grantTokenAddresses),
    ...distributionSummaries.flatMap((distribution) => distributionTokenAddresses(distribution)),
    ...lockedLiquiditySummaries.flatMap(lockedLiquidityTokenAddresses),
  ]);

  return {
    ...state,
    issuedGrants: grantAddresses,
    issuedDistributions: distributionAddresses,
    lockedLiquidityPositions: lockedLiquidityAddresses,
    redeemableAssets,
    ...(grantDiscovery.total === undefined ? {} : { grantRecordCount: grantDiscovery.total }),
    distributionRecordCount: distributionDiscovery.total,
    lockedLiquidityRecordCount: lockedLiquidityAddresses.length,
    ...childSummaryWarnings(
      state,
      grantDiscovery.total,
      grantSummaries.length,
      distributionDiscovery.total,
      distributionSummaries.length,
      lockedLiquidityAddresses.length,
      lockedLiquiditySummaries.length,
      redeemableAssets.length,
    ),
    shareTokenMetadata: tokenMetadataFor(metadataByAddress, state.shareToken),
    grantSummaries: grantSummaries.map((grant) => ({
      ...grant,
      tokenMetadata: tokenMetadataFor(metadataByAddress, grant.state?.token),
      paymentTokenMetadata: tokenMetadataFor(metadataByAddress, grant.state?.paymentToken),
    })),
    distributionSummaries: distributionSummaries.map((distribution) => ({
      ...distribution,
      shareTokenMetadata: tokenMetadataFor(metadataByAddress, distribution.state?.shareToken),
      paymentTokenMetadata: tokenMetadataFor(
        metadataByAddress,
        distribution.state && "paymentToken" in distribution.state ? distribution.state.paymentToken : undefined,
      ),
      quoteTokenMetadata: tokenMetadataFor(
        metadataByAddress,
        distribution.state && "quoteToken" in distribution.state ? distribution.state.quoteToken : undefined,
      ),
    })),
    lockedLiquiditySummaries: lockedLiquiditySummaries.map((locker) => ({
      ...locker,
      tokenAMetadata: tokenMetadataFor(metadataByAddress, locker.state?.tokenA),
      tokenBMetadata: tokenMetadataFor(metadataByAddress, locker.state?.tokenB),
      liquidityMetadata: tokenMetadataFor(metadataByAddress, locker.state?.pool),
    })),
  };
}

function childSummaryWarnings(
  state: Pick<BoardroomSnapshot, "activeGrantCount" | "redeemableAssetCount">,
  grantRecordCount: number | undefined,
  shownGrantCount: number,
  distributionRecordCount: number,
  shownDistributionCount: number,
  lockedLiquidityRecordCount: number,
  shownLockerCount: number,
  shownRedeemableAssetCount: number,
): Pick<BoardroomSnapshot, "summaryWarnings"> {
  const activeGrantCount = safeChildCount(state.activeGrantCount, "Active grant count");
  const redeemableAssetCount = safeChildCount(state.redeemableAssetCount, "Redeemable asset count");
  const warnings = [
    grantRecordCount === undefined
      ? "Grant provenance is unavailable in this client; canonical active-grant counts still gate lifecycle transitions."
      : childSummaryWarning("grant records", Math.max(grantRecordCount, activeGrantCount), shownGrantCount),
    childSummaryWarning("distribution records", distributionRecordCount, shownDistributionCount),
    childSummaryWarning("locked-liquidity positions", lockedLiquidityRecordCount, shownLockerCount),
    childSummaryWarning("redeemable assets", redeemableAssetCount, shownRedeemableAssetCount),
  ].filter((warning): warning is string => warning !== undefined);
  return warnings.length > 0 ? { summaryWarnings: warnings } : {};
}

function childSummaryWarning(label: string, total: number, shown: number): string | undefined {
  if (total <= shown) return undefined;
  return `Showing the newest ${shown.toString()} of ${total.toString()} ${label}; older records are omitted from this browser view.`;
}

export async function readBoardroomDistributionSnapshot(
  client: PledgeCashReadClient,
  distribution: Address,
): Promise<BoardroomDistributionSnapshot> {
  const summary = await readDistributionSummary(client, distribution);
  const metadataByAddress = await readTokenMetadataMap(client, distributionTokenAddresses(summary));

  return {
    ...summary,
    shareTokenMetadata: tokenMetadataFor(metadataByAddress, summary.state?.shareToken),
    paymentTokenMetadata: tokenMetadataFor(
      metadataByAddress,
      summary.state && "paymentToken" in summary.state ? summary.state.paymentToken : undefined,
    ),
    quoteTokenMetadata: tokenMetadataFor(
      metadataByAddress,
      summary.state && "quoteToken" in summary.state ? summary.state.quoteToken : undefined,
    ),
  };
}

export async function readBoardroomLockedLiquiditySnapshot(
  client: PledgeCashReadClient,
  locker: Address,
): Promise<BoardroomLockedLiquiditySnapshot> {
  const summary = await readLockedLiquiditySummary(client, locker);
  const metadataByAddress = await readTokenMetadataMap(client, lockedLiquidityTokenAddresses(summary));

  return {
    ...summary,
    tokenAMetadata: tokenMetadataFor(metadataByAddress, summary.state?.tokenA),
    tokenBMetadata: tokenMetadataFor(metadataByAddress, summary.state?.tokenB),
    liquidityMetadata: tokenMetadataFor(metadataByAddress, summary.state?.pool),
  };
}

async function readGrantSummary(client: PledgeCashReadClient, grant: Address): Promise<BoardroomGrantSnapshot> {
  try {
    return { address: grant, state: await readGrantState(client, grant) };
  } catch (error) {
    return { address: grant, error: errorMessage(error) };
  }
}

async function readDistributionSummary(
  client: PledgeCashReadClient,
  distribution: Address,
): Promise<BoardroomDistributionSnapshot> {
  try {
    return {
      address: distribution,
      kind: "fixed-price-sale",
      state: await readFixedPriceSaleState(client, distribution),
    };
  } catch (fixedPriceError) {
    return await readDutchAuctionDistributionSummary(client, distribution, fixedPriceError);
  }
}

async function readDutchAuctionDistributionSummary(
  client: PledgeCashReadClient,
  distribution: Address,
  fixedPriceError: unknown,
): Promise<BoardroomDistributionSnapshot> {
  try {
    return {
      address: distribution,
      kind: "dutch-auction",
      state: await readDutchAuctionState(client, distribution),
    };
  } catch (dutchAuctionError) {
    return await readCurveDistributionSummary(client, distribution, fixedPriceError, dutchAuctionError);
  }
}

async function readCurveDistributionSummary(
  client: PledgeCashReadClient,
  distribution: Address,
  fixedPriceError: unknown,
  dutchAuctionError: unknown,
): Promise<BoardroomDistributionSnapshot> {
  try {
    return {
      address: distribution,
      kind: "migrating-bonding-curve",
      state: await readMigratingBondingCurveState(client, distribution),
    };
  } catch (curveError) {
    return await readMerkleAirdropDistributionSummary(client, distribution, fixedPriceError, dutchAuctionError, curveError);
  }
}

async function readMerkleAirdropDistributionSummary(
  client: PledgeCashReadClient,
  distribution: Address,
  fixedPriceError: unknown,
  dutchAuctionError: unknown,
  curveError: unknown,
): Promise<BoardroomDistributionSnapshot> {
  try {
    return {
      address: distribution,
      kind: "merkle-airdrop",
      state: await readMerkleAirdropState(client, distribution),
    };
  } catch (airdropError) {
    return await readBondMarketDistributionSummary(
      client, distribution, fixedPriceError, dutchAuctionError, curveError, airdropError,
    );
  }
}

async function readBondMarketDistributionSummary(
  client: PledgeCashReadClient,
  distribution: Address,
  fixedPriceError: unknown,
  dutchAuctionError: unknown,
  curveError: unknown,
  airdropError: unknown,
): Promise<BoardroomDistributionSnapshot> {
  try {
    return {
      address: distribution,
      kind: "bond-market",
      state: await readBondMarketState(client, distribution),
    };
  } catch (bondError) {
    return {
      address: distribution,
      kind: "unknown",
      error: `${errorMessage(fixedPriceError)}; ${errorMessage(dutchAuctionError)}; ${errorMessage(curveError)}; ${errorMessage(airdropError)}; ${errorMessage(bondError)}`,
    };
  }
}

async function readLockedLiquiditySummary(
  client: PledgeCashReadClient,
  locker: Address,
): Promise<BoardroomLockedLiquiditySnapshot> {
  try {
    const state = await readLockedLiquidityState(client, locker);
    return { address: locker, state, ...(await readLockedLiquidityClaimable(client, state, locker)) };
  } catch (error) {
    return { address: locker, error: errorMessage(error) };
  }
}

async function readLockedLiquidityClaimable(
  client: PledgeCashReadClient,
  state: LockedLiquidityState,
  locker: Address,
): Promise<Pick<BoardroomLockedLiquiditySnapshot, "claimableA" | "claimableB">> {
  if (!state.pool) return {};

  const [token0, balance, stored0, stored1, index0, index1, supplyIndex0, supplyIndex1] = await Promise.all([
    client.readContract({ address: state.pool, abi: ammPoolAbi, functionName: "token0" }) as Promise<Address>,
    client.readContract({ address: state.pool, abi: erc20Abi, functionName: "balanceOf", args: [locker] }) as Promise<bigint>,
    client.readContract({ address: state.pool, abi: ammPoolAbi, functionName: "claimable0", args: [locker] }) as Promise<bigint>,
    client.readContract({ address: state.pool, abi: ammPoolAbi, functionName: "claimable1", args: [locker] }) as Promise<bigint>,
    client.readContract({ address: state.pool, abi: ammPoolAbi, functionName: "index0" }) as Promise<bigint>,
    client.readContract({ address: state.pool, abi: ammPoolAbi, functionName: "index1" }) as Promise<bigint>,
    client.readContract({ address: state.pool, abi: ammPoolAbi, functionName: "supplyIndex0", args: [locker] }) as Promise<bigint>,
    client.readContract({ address: state.pool, abi: ammPoolAbi, functionName: "supplyIndex1", args: [locker] }) as Promise<bigint>,
  ]);
  const claimable0 = stored0 + pendingFee(balance, index0, supplyIndex0);
  const claimable1 = stored1 + pendingFee(balance, index1, supplyIndex1);
  return sameAddress(token0, state.tokenA)
    ? { claimableA: claimable0, claimableB: claimable1 }
    : { claimableA: claimable1, claimableB: claimable0 };
}

function pendingFee(balance: bigint, index: bigint, supplyIndex: bigint): bigint {
  return index > supplyIndex ? (balance * (index - supplyIndex)) / FEE_INDEX_SCALE : 0n;
}

async function readCanonicalGrantAddresses(
  client: BoardroomSnapshotClient,
  boardroom: Address,
  deployment: PledgeCashDeployment | undefined,
): Promise<{ addresses: Address[]; total?: number | undefined }> {
  if (!deployment?.tokenGrantFactory || typeof client.getLogs !== "function") return { addresses: [] };

  try {
    const grants = await queryGrantsIssuedByAddress(client as PledgeCashLogClient, {
      factory: deployment.tokenGrantFactory,
      fromBlock: 0n,
      chunkSize: 100_000n,
      issuer: boardroom,
      includeClosed: true,
    });
    const addresses = uniqueAddresses(grants.map((grant) => grant.grantAddress));
    return {
      addresses: addresses.slice(0, PRODUCT_DETAIL_CHILD_READ_LIMIT),
      total: addresses.length,
    };
  } catch {
    return { addresses: [] };
  }
}

async function readCanonicalDistributionAddresses(
  client: PledgeCashReadClient,
  boardroom: Address,
  deployment: PledgeCashDeployment | undefined,
  limit: number,
): Promise<{ addresses: Address[]; total: number }> {
  const [distributions, bondMarkets] = await Promise.all([
    readNewestFactoryAddresses(
      client,
      deployment?.distributionFactory,
      distributionFactoryAbi,
      "distributionCountForBoardroom",
      "distributionPageForBoardroom",
      boardroom,
      limit,
    ),
    readNewestFactoryAddresses(
      client,
      deployment?.bondMarketFactory,
      bondMarketFactoryAbi,
      "bondMarketCountForBoardroom",
      "bondMarketPageForBoardroom",
      boardroom,
      limit,
    ),
  ]);
  const addresses = uniqueAddresses([...distributions.addresses, ...bondMarkets.addresses]);
  return {
    addresses: addresses.slice(Math.max(0, addresses.length - limit)),
    total: distributions.total + bondMarkets.total,
  };
}

async function readNewestFactoryAddresses(
  client: PledgeCashReadClient,
  factory: Address | undefined,
  abi: typeof distributionFactoryAbi | typeof bondMarketFactoryAbi,
  countFunction: "distributionCountForBoardroom" | "bondMarketCountForBoardroom",
  pageFunction: "distributionPageForBoardroom" | "bondMarketPageForBoardroom",
  boardroom: Address,
  limit: number,
): Promise<{ addresses: Address[]; total: number }> {
  if (!factory) return { addresses: [], total: 0 };
  const rawCount = await client.readContract({
    address: factory,
    abi,
    functionName: countFunction as never,
    args: [boardroom],
  });
  const total = safeChildCount(rawCount, "Factory child count");
  if (total === 0) return { addresses: [], total };
  const size = Math.min(total, limit, 100);
  const cursor = total - size;
  const [addresses] = await client.readContract({
    address: factory,
    abi,
    functionName: pageFunction as never,
    args: [boardroom, BigInt(cursor), BigInt(size)],
  }) as unknown as readonly [Address[], bigint];
  return { addresses, total };
}

async function readCanonicalLiquidityAddresses(
  client: PledgeCashReadClient,
  boardroom: Address,
  stateLocker: Address | undefined,
  deployment: PledgeCashDeployment | undefined,
): Promise<Address[]> {
  if (!deployment?.lockedLiquidityFactory) return isZeroAddress(stateLocker) ? [] : [stateLocker!];
  const [factoryLocker] = await client.readContract({
    address: deployment.lockedLiquidityFactory,
    abi: lockedLiquidityFactoryAbi,
    functionName: "positionOfBoardroom",
    args: [boardroom],
  }) as unknown as readonly [Address, Address, Address, number];
  if (isZeroAddress(factoryLocker)) return stateLocker && !isZeroAddress(stateLocker) ? [stateLocker] : [];
  if (stateLocker && !isZeroAddress(stateLocker) && !sameAddress(factoryLocker, stateLocker)) {
    throw new Error("Boardroom and liquidity factory disagree on the canonical locker.");
  }
  return [factoryLocker];
}

async function readNewestRedeemableAssets(
  client: PledgeCashReadClient,
  boardroom: Address,
  rawCount: bigint,
  limit: number,
): Promise<Address[]> {
  const total = safeChildCount(rawCount, "Redeemable asset count");
  if (total === 0) return [];
  let cursor = Math.max(0, total - limit);
  const output: Address[] = [];
  while (cursor < total && output.length < limit) {
    const size = Math.min(32, total - cursor, limit - output.length);
    const [page, nextCursor] = await client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "redeemableAssetPage",
      args: [BigInt(cursor), BigInt(size)],
    }) as unknown as readonly [Address[], bigint];
    output.push(...page);
    const next = safeChildCount(nextCursor, "Redeemable asset cursor");
    if (next <= cursor) throw new Error("Redeemable-asset pagination did not advance.");
    cursor = next;
  }
  return uniqueAddresses(output);
}

function safeChildCount(value: unknown, label: string): number {
  if (typeof value !== "bigint" && typeof value !== "number") throw new Error(`${label} is invalid.`);
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} exceeds the browser's safe discovery range.`);
  }
  const parsed = typeof value === "number" ? BigInt(value) : value;
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the browser's safe discovery range.`);
  }
  return Number(parsed);
}

async function mapInBatches<Input, Output>(
  values: readonly Input[],
  batchSize: number,
  mapper: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const output: Output[] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    output.push(...await Promise.all(values.slice(index, index + batchSize).map(mapper)));
  }
  return output;
}

function grantTokenAddresses(grant: BoardroomGrantSnapshot): (Address | undefined)[] {
  return [grant.state?.token, grant.state?.paymentToken];
}

function distributionTokenAddresses(distribution: BoardroomDistributionSnapshot): (Address | undefined)[] {
  if (!distribution.state) return [];
  if ("paymentToken" in distribution.state) return [distribution.state.shareToken, distribution.state.paymentToken];
  if ("quoteToken" in distribution.state) return [distribution.state.shareToken, distribution.state.quoteToken];
  if ("tokenGrantFactory" in distribution.state) return [distribution.state.shareToken];
  return [];
}

function lockedLiquidityTokenAddresses(locker: BoardroomLockedLiquiditySnapshot): (Address | undefined)[] {
  return [locker.state?.tokenA, locker.state?.tokenB, locker.state?.pool];
}

function sameAddress(first: Address, second: Address): boolean {
  return first.toLowerCase() === second.toLowerCase();
}

function uniqueAddresses(addresses: readonly Address[]): Address[] {
  const seen = new Set<string>();
  return addresses.filter((address) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
