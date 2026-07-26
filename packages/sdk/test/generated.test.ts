import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  ammFactoryAbi,
  ammPoolAbi,
  ammRouterAbi,
  boardroomAbi,
  boardroomControllerAbi,
  boardroomControllerFactoryAbi,
  boardroomGovernanceLogicAbi,
  boardroomMarketLogicAbi,
  boardroomRedemptionPayoutAbi,
  boardroomRewardsAbi,
  boardroomRewardsFactoryAbi,
  boardroomTokenAbi,
  distributionFactoryAbi,
  dutchAuctionSaleAbi,
  fixedPriceSaleAbi,
  lockedLiquidityAbi,
  lockedLiquidityFactoryAbi,
  merkleAirdropAbi,
  migratingBondingCurveAbi,
  pledgeCashAbis,
  pledgeCashDeployments,
  poolFeesAbi,
  tokenGrantAbi,
  tokenGrantFactoryAbi,
} from "../src";

describe("generated SDK exports", () => {
  test("includes core contract ABIs", () => {
    expect(pledgeCashAbis.TokenGrantFactory).toBe(tokenGrantFactoryAbi);
    expect(pledgeCashAbis.DistributionFactory).toBe(distributionFactoryAbi);
    expect(pledgeCashAbis.AmmFactory).toBe(ammFactoryAbi);
    expect(pledgeCashAbis.AmmPool).toBe(ammPoolAbi);
    expect(pledgeCashAbis.AmmRouter).toBe(ammRouterAbi);
    expect(pledgeCashAbis.BoardroomGovernanceLogic).toBe(boardroomGovernanceLogicAbi);
    expect(pledgeCashAbis.BoardroomController).toBe(boardroomControllerAbi);
    expect(pledgeCashAbis.BoardroomControllerFactory).toBe(boardroomControllerFactoryAbi);
    expect(pledgeCashAbis.BoardroomMarketLogic).toBe(boardroomMarketLogicAbi);
    expect(pledgeCashAbis.BoardroomRedemptionPayout).toBe(boardroomRedemptionPayoutAbi);
    expect(pledgeCashAbis.BoardroomRewards).toBe(boardroomRewardsAbi);
    expect(pledgeCashAbis.BoardroomRewardsFactory).toBe(boardroomRewardsFactoryAbi);
    expect(pledgeCashAbis.FixedPriceSale).toBe(fixedPriceSaleAbi);
    expect(pledgeCashAbis.DutchAuctionSale).toBe(dutchAuctionSaleAbi);
    expect(pledgeCashAbis.LockedLiquidity).toBe(lockedLiquidityAbi);
    expect(pledgeCashAbis.LockedLiquidityFactory).toBe(lockedLiquidityFactoryAbi);
    expect(pledgeCashAbis.MerkleAirdrop).toBe(merkleAirdropAbi);
    expect(pledgeCashAbis.MigratingBondingCurve).toBe(migratingBondingCurveAbi);
    expect(pledgeCashAbis.PoolFees).toBe(poolFeesAbi);
    expect(tokenGrantFactoryAbi.some((item) => item.type === "function" && item.name === "createGrant")).toBe(true);
    expect(tokenGrantFactoryAbi.some((item) => item.type === "function" && item.name === "predictGrantAddress")).toBe(true);
    expect(distributionFactoryAbi.some((item) => item.type === "function" && item.name === "createFixedPriceSale")).toBe(true);
    expect(distributionFactoryAbi.some((item) => item.type === "function" && item.name === "createDutchAuction")).toBe(true);
    expect(distributionFactoryAbi.some((item) => item.type === "function" && item.name === "createMigratingBondingCurve")).toBe(true);
    expect(distributionFactoryAbi.some((item) => item.type === "function" && item.name === "createMerkleAirdrop")).toBe(true);
    expect(fixedPriceSaleAbi.some((item) => item.type === "function" && item.name === "buy")).toBe(true);
    expect(dutchAuctionSaleAbi.some((item) => item.type === "function" && item.name === "finalize")).toBe(true);
    expect(merkleAirdropAbi.some((item) => item.type === "function" && item.name === "claimGrant")).toBe(true);
    expect(migratingBondingCurveAbi.some((item) => item.type === "function" && item.name === "migrate")).toBe(true);
    expect(ammRouterAbi.some((item) => item.type === "function" && item.name === "swapExactTokensForTokens")).toBe(true);
    expect(lockedLiquidityFactoryAbi.some((item) => item.type === "function" && item.name === "createLockedLiquidity")).toBe(true);
  });

  test("includes governance and participation functions consumed by helpers", () => {
    expect(functionNames(boardroomAbi)).toEqual(expect.arrayContaining([
      "assetSnapshotProgress",
      "beginSnapshot",
      "executeGovernance",
      "governanceEpoch",
      "launch",
      "openRedemptions",
      "replaceController",
      "snapshotAssets",
      "veto",
    ]));
    expect(functionNames(boardroomControllerAbi)).toEqual(expect.arrayContaining([
      "executeBoardroomOperation",
      "executeControllerOperation",
      "hashBoardroomOperation",
      "isValidSignature",
      "scheduleBoardroomOperation",
      "scheduleControllerOperation",
      "updateConfiguration",
    ]));
    expect(functionNames(boardroomTokenAbi)).toEqual(expect.arrayContaining([
      "getPastBalance",
      "getPastGovernanceEligibleSupply",
      "governanceEligibleSupply",
      "isEncumberedAccount",
    ]));
    expect(functionNames(boardroomRewardsAbi)).toEqual(expect.arrayContaining([
      "claim",
      "completeUnstake",
      "earned",
      "requestUnstake",
      "stake",
    ]));
    expect(functionNames(boardroomRewardsFactoryAbi)).toEqual(expect.arrayContaining(["createRewards", "fundReward"]));
    expect(functionNames(tokenGrantAbi)).toEqual(expect.arrayContaining([
      "getSettlementCost",
      "getSettleableAmount",
      "isQuarantined",
      "transferable",
    ]));
    expect(functionNames(fixedPriceSaleAbi)).toEqual(expect.arrayContaining(["getPaymentAmount", "purchasedBy"]));
    expect(functionNames(dutchAuctionSaleAbi)).toEqual(expect.arrayContaining(["currentPrice", "getPaymentAmount", "purchasedBy", "settlementPrice"]));
    expect(functionNames(migratingBondingCurveAbi)).toEqual(expect.arrayContaining([
      "getBuyQuote",
      "getSellQuote",
      "graduationLatched",
      "outstandingCurveShareLiability",
      "sellableShares",
    ]));
    expect(functionNames(merkleAirdropAbi)).toEqual(expect.arrayContaining(["claimedShares", "isClaimed"]));
  });

  test("includes checked-in deployment metadata", () => {
    expect(pledgeCashDeployments[998]?.chainId).toBe(998);
    expect(pledgeCashDeployments[998]?.status).toBeUndefined();
    expect(pledgeCashDeployments[998]?.sourceCommit).toBe(
      "87f51633f437a0164d7a2a2503a3660b01a6450a",
    );
    expect(pledgeCashDeployments[998]?.deploymentBlock).toBe(59_850_507n);
    expect(pledgeCashDeployments[998]?.deterministicDeploymentVersion).toBe(
      "pledge.cash.deterministic.v5",
    );
    expect(pledgeCashDeployments[998]?.tokenGrantFactory).toBe(
      "0xC6abe7071Bbf81fA2372Fc01503761E146685343",
    );
    expect(pledgeCashDeployments[998]?.boardroomFactory).toBe(
      "0xd0b2aE6603d7Ae140cd0Cb4Eb4451923C28cAaef",
    );
    expect(pledgeCashDeployments[998]?.distributionFactory).toBe(
      "0xc15a24eE0e281Ca68F29869816E48B57760DDB2F",
    );
    expect(pledgeCashDeployments[10143]?.chainId).toBe(10143);
    expect(pledgeCashDeployments[10143]?.status).toBe("pending");
    expect(pledgeCashDeployments[10143]?.tokenGrantFactory).toBeUndefined();
    expect(pledgeCashDeployments[10143]?.boardroomFactory).toBeUndefined();
  });

  test("marks generated source as generated", async () => {
    const source = await readFile(new URL("../src/generated.ts", import.meta.url), "utf8");
    expect(source).toContain("This file is generated by packages/sdk/scripts/generate.ts.");
  });
});

function functionNames(abi: readonly { type: string; name?: string }[]): string[] {
  return abi.flatMap((item) => item.type === "function" && item.name ? [item.name] : []);
}
