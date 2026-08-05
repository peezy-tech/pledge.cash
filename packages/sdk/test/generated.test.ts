import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  boardroomAbi,
  boardroomControllerAbi,
  boardroomControllerFactoryAbi,
  boardroomFactoryAbi,
  boardroomTokenAbi,
  pledgeCashAbis,
  pledgeCashDeployments,
  pledgeCashNetworkProfiles,
  pledgeCashNetworkSupportPolicy,
  pledgeV4HookAbi,
  pledgeV4LiquidityFactoryAbi,
  pledgeV4LiquidityVaultAbi,
  protocolFacetRegistryAbi,
  tokenGrantAbi,
  tokenGrantFactoryAbi,
} from "../src";

describe("generated SDK exports", () => {
  test("includes core contract ABIs", () => {
    expect(pledgeCashAbis.TokenGrantFactory).toBe(tokenGrantFactoryAbi);
    expect(pledgeCashAbis.Boardroom).toBe(boardroomAbi);
    expect(pledgeCashAbis.BoardroomController).toBe(boardroomControllerAbi);
    expect(pledgeCashAbis.BoardroomControllerFactory).toBe(boardroomControllerFactoryAbi);
    expect(pledgeCashAbis.BoardroomFactory).toBe(boardroomFactoryAbi);
    expect(pledgeCashAbis.PledgeV4LiquidityFactory).toBe(pledgeV4LiquidityFactoryAbi);
    expect(pledgeCashAbis.PledgeV4LiquidityVault).toBe(pledgeV4LiquidityVaultAbi);
    expect(pledgeCashAbis.PledgeV4Hook).toBe(pledgeV4HookAbi);
    expect(pledgeCashAbis.ProtocolFacetRegistry).toBe(protocolFacetRegistryAbi);
    expect(tokenGrantFactoryAbi.some((item) => item.type === "function" && item.name === "createGrant")).toBe(true);
    expect(tokenGrantFactoryAbi.some((item) => item.type === "function" && item.name === "predictGrantAddress")).toBe(true);
    expect(pledgeV4LiquidityFactoryAbi.some((item) => item.type === "function" && item.name === "createProtocolLiquidity")).toBe(true);
    expect(pledgeV4LiquidityVaultAbi.some((item) => item.type === "function" && item.name === "depositLiquidityForClaims")).toBe(true);
    expect(pledgeV4HookAbi.some((item) => item.type === "function" && item.name === "beforeInitialize")).toBe(true);
    expect("DistributionFactory" in pledgeCashAbis).toBe(false);
    expect("BoardroomRewards" in pledgeCashAbis).toBe(false);
    expect("BondMarket" in pledgeCashAbis).toBe(false);
  });

  test("includes governance functions consumed by helpers", () => {
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
    expect(functionNames(tokenGrantAbi)).toEqual(expect.arrayContaining([
      "getSettlementCost",
      "getSettleableAmount",
      "isQuarantined",
      "transferable",
    ]));
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
    const supportedChainIds = [11155111, 84532, 1, 8453, 42161, 4663];
    expect(Object.keys(pledgeCashDeployments).map(Number)).toEqual(expect.arrayContaining(supportedChainIds));
    for (const chainId of supportedChainIds) {
      const deployment = pledgeCashDeployments[chainId as keyof typeof pledgeCashDeployments];
      expect(deployment?.chainId).toBe(chainId);
      expect(deployment?.status).toBe("pending");
      expect(deployment?.protocolVersion).toBe("pledge.cash.protocol.v1");
      expect(deployment?.tokenGrantFactory).toBeUndefined();
      expect(deployment?.boardroomFactory).toBeUndefined();
    }
  });

  test("generates the approved network profiles from the canonical manifest", () => {
    expect(pledgeCashNetworkSupportPolicy).toEqual({
      defaultChainId: 11155111,
      testnetChainIds: [11155111, 84532],
      mainnetChainIds: [1, 8453, 42161, 4663],
    });
    expect(pledgeCashNetworkProfiles.map((profile) => profile.key)).toEqual([
      "ethereum-sepolia",
      "base-sepolia",
      "ethereum",
      "base",
      "arbitrum",
      "robinhood-chain",
    ]);
    expect(pledgeCashNetworkProfiles.every((profile) => profile.uniswap.routerEncoding === "universal-router-2.0-v4-exact-input-single")).toBe(true);
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
