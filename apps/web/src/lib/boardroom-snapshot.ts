import {
  readBoardroomState,
  readFixedPriceSaleState,
  readGrantState,
  readLockedLiquidityState,
  readMigratingBondingCurveState,
  type Address,
  type PledgeCashReadClient,
} from "@pledge.cash/sdk";
import { errorMessage } from "./forms";
import type { BoardroomDistributionSnapshot, BoardroomGrantSnapshot, BoardroomLockedLiquiditySnapshot, BoardroomSnapshot } from "./types";

export async function readBoardroomSnapshot(client: PledgeCashReadClient, address: Address): Promise<BoardroomSnapshot> {
  const state = await readBoardroomState(client, address);
  const [grantSummaries, distributionSummaries, lockedLiquiditySummaries] = await Promise.all([
    Promise.all(state.issuedGrants.map((grant) => readGrantSummary(client, grant))),
    Promise.all(state.issuedDistributions.map((distribution) => readDistributionSummary(client, distribution))),
    Promise.all(state.lockedLiquidityPositions.map((locker) => readLockedLiquiditySummary(client, locker))),
  ]);

  return {
    ...state,
    grantSummaries,
    distributionSummaries,
    lockedLiquiditySummaries,
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
    return {
      address: distribution,
      kind: "unknown",
      error: `${errorMessage(fixedPriceError)}; ${errorMessage(curveError)}`,
    };
  }
}

async function readLockedLiquiditySummary(
  client: PledgeCashReadClient,
  locker: Address,
): Promise<BoardroomLockedLiquiditySnapshot> {
  try {
    return { address: locker, state: await readLockedLiquidityState(client, locker) };
  } catch (error) {
    return { address: locker, error: errorMessage(error) };
  }
}
