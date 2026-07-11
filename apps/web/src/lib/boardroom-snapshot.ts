import {
  ammPoolAbi,
  boardroomAbi,
  erc20Abi,
  type Address,
  type LockedLiquidityState,
  readBoardroomState,
  readFixedPriceSaleState,
  readGrantState,
  readLockedLiquidityState,
  readMerkleAirdropState,
  readMigratingBondingCurveState,
  type PledgeCashReadClient,
} from "@pledge.cash/sdk";
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
  client: PledgeCashReadClient,
  address: Address,
): Promise<BoardroomCatalogSnapshot> {
  const [shareToken, rawDistributionCount, rawLockedLiquidityCount] = await Promise.all([
    client.readContract({ address, abi: boardroomAbi, functionName: "shareToken" }) as Promise<Address>,
    client.readContract({ address, abi: boardroomAbi, functionName: "issuedDistributionCount" }),
    client.readContract({ address, abi: boardroomAbi, functionName: "lockedLiquidityCount" }),
  ]);
  const distributionCount = safeChildCount(rawDistributionCount, "Issued distribution count");
  const lockedLiquidityCount = safeChildCount(rawLockedLiquidityCount, "Locked liquidity count");
  const [distributionAddresses, lockedLiquidityAddresses, metadataByAddress] = await Promise.all([
    readNewestChildAddresses(client, address, "issuedDistributionAt", distributionCount),
    readNewestChildAddresses(client, address, "lockedLiquidityAt", lockedLiquidityCount),
    readTokenMetadataMap(client, [shareToken]),
  ]);
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

export async function readBoardroomSnapshot(client: PledgeCashReadClient, address: Address): Promise<BoardroomSnapshot> {
  const state = await readBoardroomState(client, address);
  const grantAddresses = newestAddresses(state.issuedGrants, PRODUCT_DETAIL_CHILD_READ_LIMIT);
  const distributionAddresses = newestAddresses(state.issuedDistributions, PRODUCT_DETAIL_CHILD_READ_LIMIT);
  const lockedLiquidityAddresses = newestAddresses(state.lockedLiquidityPositions, PRODUCT_DETAIL_CHILD_READ_LIMIT);
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
    ...childSummaryWarnings(state, grantSummaries.length, distributionSummaries.length, lockedLiquiditySummaries.length),
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
  state: Pick<BoardroomSnapshot, "issuedGrants" | "issuedDistributions" | "lockedLiquidityPositions" | "redeemableAssets">,
  grantCount: number,
  distributionCount: number,
  lockerCount: number,
): Pick<BoardroomSnapshot, "summaryWarnings"> {
  const warnings = [
    childSummaryWarning("grants", state.issuedGrants.length, grantCount),
    childSummaryWarning("distributions", state.issuedDistributions.length, distributionCount),
    childSummaryWarning("locked-liquidity positions", state.lockedLiquidityPositions.length, lockerCount),
    childSummaryWarning("redeemable assets", state.redeemableAssets.length, Math.min(state.redeemableAssets.length, PRODUCT_DETAIL_CHILD_READ_LIMIT)),
  ].filter((warning): warning is string => warning !== undefined);
  return warnings.length > 0 ? { summaryWarnings: warnings } : {};
}

function childSummaryWarning(label: string, total: number, shown: number): string | undefined {
  if (total <= shown) return undefined;
  return `Showing the newest ${shown.toString()} of ${total.toString()} ${label}; older records are omitted from this browser view.`;
}

function newestAddresses(addresses: readonly Address[], limit: number): Address[] {
  return addresses.length <= limit ? [...addresses] : addresses.slice(addresses.length - limit);
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
    return await readCurveDistributionSummary(client, distribution, fixedPriceError);
  }
}

async function readCurveDistributionSummary(
  client: PledgeCashReadClient,
  distribution: Address,
  fixedPriceError: unknown,
): Promise<BoardroomDistributionSnapshot> {
  try {
    return {
      address: distribution,
      kind: "migrating-bonding-curve",
      state: await readMigratingBondingCurveState(client, distribution),
    };
  } catch (curveError) {
    return await readMerkleAirdropDistributionSummary(client, distribution, fixedPriceError, curveError);
  }
}

async function readMerkleAirdropDistributionSummary(
  client: PledgeCashReadClient,
  distribution: Address,
  fixedPriceError: unknown,
  curveError: unknown,
): Promise<BoardroomDistributionSnapshot> {
  try {
    return {
      address: distribution,
      kind: "merkle-airdrop",
      state: await readMerkleAirdropState(client, distribution),
    };
  } catch (airdropError) {
    return {
      address: distribution,
      kind: "unknown",
      error: `${errorMessage(fixedPriceError)}; ${errorMessage(curveError)}; ${errorMessage(airdropError)}`,
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

async function readNewestChildAddresses(
  client: PledgeCashReadClient,
  boardroom: Address,
  functionName: "issuedDistributionAt" | "lockedLiquidityAt",
  count: number,
): Promise<Address[]> {
  const readCount = Math.min(count, PRODUCT_CATALOG_CHILD_READ_LIMIT);
  const indexes = Array.from({ length: readCount }, (_, offset) => count - offset - 1);
  return await mapInBatches(
    indexes,
    PRODUCT_CATALOG_CHILD_READ_CONCURRENCY,
    async (index) => await client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName,
      args: [BigInt(index)],
    }) as Address,
  );
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
