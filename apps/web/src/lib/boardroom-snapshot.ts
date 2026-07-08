import {
  ammPoolAbi,
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
import { readTokenMetadataMap, tokenMetadataFor } from "./token-amounts";
import type { BoardroomDistributionSnapshot, BoardroomGrantSnapshot, BoardroomLockedLiquiditySnapshot, BoardroomSnapshot } from "./types";

const FEE_INDEX_SCALE = 1_000_000_000_000_000_000n;

export async function readBoardroomSnapshot(client: PledgeCashReadClient, address: Address): Promise<BoardroomSnapshot> {
  const state = await readBoardroomState(client, address);
  const [grantSummaries, distributionSummaries, lockedLiquiditySummaries] = await Promise.all([
    Promise.all(state.issuedGrants.map((grant) => readGrantSummary(client, grant))),
    Promise.all(state.issuedDistributions.map((distribution) => readDistributionSummary(client, distribution))),
    Promise.all(state.lockedLiquidityPositions.map((locker) => readLockedLiquiditySummary(client, locker))),
  ]);
  const metadataByAddress = await readTokenMetadataMap(client, [
    state.shareToken,
    ...grantSummaries.flatMap((grant) => [grant.state?.token, grant.state?.paymentToken]),
    ...distributionSummaries.flatMap((distribution) => distributionTokenAddresses(distribution)),
    ...lockedLiquiditySummaries.flatMap((locker) => [locker.state?.tokenA, locker.state?.tokenB, locker.state?.pool]),
  ]);

  return {
    ...state,
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
  return token0.toLowerCase() === state.tokenA.toLowerCase()
    ? { claimableA: claimable0, claimableB: claimable1 }
    : { claimableA: claimable1, claimableB: claimable0 };
}

function pendingFee(balance: bigint, index: bigint, supplyIndex: bigint): bigint {
  return index > supplyIndex ? (balance * (index - supplyIndex)) / FEE_INDEX_SCALE : 0n;
}

function distributionTokenAddresses(distribution: BoardroomDistributionSnapshot): (Address | undefined)[] {
  if (!distribution.state) return [];
  if ("paymentToken" in distribution.state) return [distribution.state.shareToken, distribution.state.paymentToken];
  if ("quoteToken" in distribution.state) return [distribution.state.shareToken, distribution.state.quoteToken];
  if ("tokenGrantFactory" in distribution.state) return [distribution.state.shareToken];
  return [];
}
