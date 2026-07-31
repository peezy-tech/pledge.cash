import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  ammFactoryAbi,
  ammPoolAbi,
  ammRouterAbi,
  boardroomAbi,
  boardroomControllerAbi,
  boardroomControllerFactoryAbi,
  boardroomFactoryAbi,
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
  protocolFacetRegistryAbi,
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
    expect(pledgeCashAbis.Boardroom).toBe(boardroomAbi);
    expect(pledgeCashAbis.BoardroomController).toBe(boardroomControllerAbi);
    expect(pledgeCashAbis.BoardroomControllerFactory).toBe(boardroomControllerFactoryAbi);
    expect(pledgeCashAbis.BoardroomFactory).toBe(boardroomFactoryAbi);
    expect(pledgeCashAbis.BoardroomRewards).toBe(boardroomRewardsAbi);
    expect(pledgeCashAbis.BoardroomRewardsFactory).toBe(boardroomRewardsFactoryAbi);
    expect(pledgeCashAbis.FixedPriceSale).toBe(fixedPriceSaleAbi);
    expect(pledgeCashAbis.DutchAuctionSale).toBe(dutchAuctionSaleAbi);
    expect(pledgeCashAbis.LockedLiquidity).toBe(lockedLiquidityAbi);
    expect(pledgeCashAbis.LockedLiquidityFactory).toBe(lockedLiquidityFactoryAbi);
    expect(pledgeCashAbis.MerkleAirdrop).toBe(merkleAirdropAbi);
    expect(pledgeCashAbis.MigratingBondingCurve).toBe(migratingBondingCurveAbi);
    expect(pledgeCashAbis.PoolFees).toBe(poolFeesAbi);
    expect(pledgeCashAbis.ProtocolFacetRegistry).toBe(protocolFacetRegistryAbi);
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
      "appliedStorageVersion",
      "claimRedemptionAsset",
      "execute",
      "facetRegistry",
      "facetSetHash",
      "kernelSelectorSetHash",
      "migrateBoardroom",
      "migrationRequired",
      "redeem",
      "startWindDown",
    ]));
    expect(functionNames(protocolFacetRegistryAbi)).toEqual(expect.arrayContaining([
      "activeFacetSetHash",
      "activeRelease",
      "activeStorageVersion",
      "facetSetMetadata",
      "facetSetRoute",
      "facetSetSelectors",
      "facets",
      "kernelSelectorSetHash",
    ]));
    expect(functionNames(boardroomFactoryAbi)).toEqual(expect.arrayContaining([
      "createBoardroom",
      "predictBoardroomAddress",
    ]));
    expect(functionNames(boardroomControllerAbi)).toEqual(expect.arrayContaining([
      "ERC1271_ENVELOPE_SCHEME",
      "executeBoardroomOperation",
      "hashBoardroomOperation",
      "hashERC1271Digest",
      "isValidSignature",
      "scheduleBoardroomOperation",
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

  test("includes Boardroom lifecycle events and routed errors", () => {
    expect(itemNames(boardroomAbi, "event")).toEqual(expect.arrayContaining([
      "BoardroomInitialized",
      "BoardroomLaunched",
      "BoardroomWindDownStarted",
      "RedeemableAssetRegistered",
    ]));
    expect(itemNames(boardroomAbi, "error")).toEqual(expect.arrayContaining([
      "FacetCodeHashMismatch",
      "FacetSetHashMismatch",
      "StorageMigrationRequired",
      "Unauthorized",
    ]));
  });

  test("includes checked-in deployment metadata", () => {
    expect(pledgeCashDeployments[10143]?.chainId).toBe(10143);
    expect(pledgeCashDeployments[10143]?.status).toBe("pending");
    expect(pledgeCashDeployments[10143]?.protocolVersion).toBe("pledge.cash.protocol.v1");
    expect(pledgeCashDeployments[10143]?.tokenGrantFactory).toBeUndefined();
    expect(pledgeCashDeployments[10143]?.boardroomFactory).toBeUndefined();
  });

  test("marks generated source as generated", async () => {
    const source = await readFile(new URL("../src/generated.ts", import.meta.url), "utf8");
    expect(source).toContain("This file is generated by packages/sdk/scripts/generate.ts.");
    expect(source).toContain("protocolVersion?: string;");
    expect(source).toContain("protocolReleaseCodeHash?: string;");
    expect(source).toContain("protocolFacetRegistryOwner?: Address;");
    expect(source).toContain("boardroomPolicyRegistryOwner?: Address;");
    expect(source).toContain("tokenGrantFactoryOwner?: Address;");
    expect(source).toContain("kernelSelectorSetHash?: string;");
    expect(source).toContain("selectorCount?: bigint;");
    expect(source).not.toContain("  boardroomStatus?: string;");
    expect(source).not.toContain("  boardroomReason?: string;");
    expect(source).not.toContain("  factoryOwner?: Address;");
    expect(source).not.toContain("  policyRegistryOwner?: Address;");
  });
});

function functionNames(abi: readonly { type: string; name?: string }[]): string[] {
  return abi.flatMap((item) => item.type === "function" && item.name ? [item.name] : []);
}

function itemNames(abi: readonly { type: string; name?: string }[], type: string): string[] {
  return abi.flatMap((item) => item.type === type && item.name ? [item.name] : []);
}
