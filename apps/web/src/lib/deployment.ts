import {
  boardroomReleaseSupport,
  type Address,
  type BoardroomReleaseSupport,
  type PledgeCashDeployment,
} from "@pledge.cash/sdk";

export const boardroomControlReleaseSupport = boardroomReleaseSupport;
export type BoardroomControlReleaseSupport = BoardroomReleaseSupport;

const STRING_DEPLOYMENT_FIELDS = [
  "status",
  "reason",
  "protocolVersion",
  "protocolReleaseCodeHash",
  "sourceCommit",
  "deterministicDeploymentVersion",
  "deterministicReleaseCodeHash",
  "deterministicDeployerCodeHash",
  "boardroomPolicyRegistryCodeHash",
  "assetPolicyCodeHash",
  "protocolFeeRouterCodeHash",
  "boardroomFactoryCodeHash",
  "boardroomControllerFactoryCodeHash",
  "boardroomControllerLogicCodeHash",
  "boardroomGovernanceLogicCodeHash",
  "boardroomMarketLogicCodeHash",
  "boardroomRedemptionPayoutCodeHash",
  "protocolFacetRegistryCodeHash",
  "boardroomKernelCodeHash",
  "authorityFacetCodeHash",
  "executionFacetCodeHash",
  "marketFacetCodeHash",
  "redemptionFacetCodeHash",
  "viewFacetCodeHash",
  "boardroomReleaseBMigrationFacetCodeHash",
  "boardroomViewFacetV2CodeHash",
  "activeFacetSetHash",
  "requiredStorageLayoutHash",
  "manifestHash",
  "kernelSelectorSetHash",
  "tokenGrantFactoryCodeHash",
  "tokenGrantLogicCodeHash",
  "ammFactoryCodeHash",
  "ammPoolImplementationCodeHash",
  "ammRouterCodeHash",
  "lockedLiquidityFactoryCodeHash",
  "lockedLiquidityLogicCodeHash",
  "distributionFactoryCodeHash",
  "fixedPriceSaleLogicCodeHash",
  "dutchAuctionLogicCodeHash",
  "migratingBondingCurveLogicCodeHash",
  "merkleAirdropLogicCodeHash",
  "boardroomRewardsFactoryCodeHash",
  "boardroomRewardsLogicCodeHash",
  "bondMarketFactoryCodeHash",
  "bondMarketLogicCodeHash",
  "wrappedNativeCodeHash",
] as const;
const ADDRESS_DEPLOYMENT_FIELDS = [
  "deterministicDeployer",
  "deterministicDeployerOwner",
  "create2Factory",
  "boardroomFactory",
  "boardroomControllerFactory",
  "boardroomControllerLogic",
  "boardroomGovernanceLogic",
  "boardroomMarketLogic",
  "boardroomRedemptionPayout",
  "protocolFacetRegistry",
  "boardroomKernel",
  "authorityFacet",
  "executionFacet",
  "marketFacet",
  "redemptionFacet",
  "viewFacet",
  "boardroomReleaseBMigrationFacet",
  "boardroomViewFacetV2",
  "boardroomPolicyRegistry",
  "assetPolicy",
  "protocolFeeRouter",
  "distributionFactory",
  "fixedPriceSaleLogic",
  "dutchAuctionLogic",
  "migratingBondingCurveLogic",
  "merkleAirdropLogic",
  "boardroomRewardsFactory",
  "boardroomRewardsLogic",
  "bondMarketFactory",
  "bondMarketLogic",
  "ammFactory",
  "ammPoolImplementation",
  "ammProtocolFeeRecipient",
  "ammRouter",
  "lockedLiquidityFactory",
  "lockedLiquidityLogic",
  "tokenGrantFactory",
  "tokenGrantLogic",
  "wrappedNative",
  "deployer",
  "protocolFacetRegistryOwner",
  "boardroomPolicyRegistryOwner",
  "tokenGrantFactoryOwner",
  "assetPolicyOwner",
  "protocolGovernance",
  "protocolTreasury",
  "protocolFeeRouterOwner",
  "protocolFeeRouterRecipient",
  "tokenGrantFeeRecipient",
  "ammFactoryOwner",
  "ammFeeManager",
  "ammLiquidityRouter",
  "ammReservationManager",
] as const;
const BOOLEAN_DEPLOYMENT_FIELDS = [
  "deterministicDeployment",
  "tokenGrantPolicyAllowed",
  "tokenGrantModulePolicy",
  "distributionPolicyAllowed",
  "distributionModulePolicy",
  "boardroomRewardsPolicyAllowed",
  "boardroomRewardsModulePolicy",
  "bondMarketPolicyAllowed",
  "bondMarketModulePolicy",
  "lockedLiquidityPolicyAllowed",
  "lockedLiquidityModulePolicy",
  "assetPolicyAllowed",
  "assetWrappedNativeAllowed",
  "assetTokenGrantSpenderAllowed",
  "assetDistributionSpenderAllowed",
  "assetBoardroomRewardsSpenderAllowed",
  "assetBondMarketSpenderAllowed",
  "assetLockedLiquiditySpenderAllowed",
] as const;
const BIGINT_DEPLOYMENT_FIELDS = [
  "activeRelease",
  "requiredStorageVersion",
  "selectorCount",
  "creationFee",
  "deploymentBlock",
  "deploymentTimestamp",
] as const;
const JSON_PRIMITIVE_TOKEN_PATTERN = '"([^"\\\\]|\\\\.)*"|-?\\d+|true|false|null';
export function deploymentText(deployment: PledgeCashDeployment | undefined): string {
  if (!deployment) return "{}";
  return JSON.stringify(deployment, (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2);
}

/**
 * Stable identity for every value in the active deployment artifact.
 *
 * Discovery deliberately uses a smaller factory identity so a cache can survive
 * irrelevant artifact metadata changes. Runtime reads and writes must instead
 * invalidate whenever any artifact value changes: transaction targets, spenders,
 * fees, policy flags, and implementation/code provenance all live here.
 */
export function deploymentRuntimeIdentity(deployment: PledgeCashDeployment | undefined): string | undefined {
  if (!deployment) return undefined;
  return JSON.stringify(
    Object.entries(deployment)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]),
  );
}

export function parseDeployment(raw: string): PledgeCashDeployment {
  const json = JSON.parse(raw) as Record<string, unknown>;
  const deployment: PledgeCashDeployment = {
    chainId: Number(json.chainId),
  };

  applyStringFields(deployment, json);
  applyAddressFields(deployment, json);
  applyBooleanFields(deployment, json);
  applyBigintFields(deployment, raw);

  return deployment;
}

function applyStringFields(deployment: PledgeCashDeployment, json: Record<string, unknown>): void {
  for (const field of STRING_DEPLOYMENT_FIELDS) {
    if (typeof json[field] === "string") {
      deployment[field] = json[field];
    }
  }
}

function applyAddressFields(deployment: PledgeCashDeployment, json: Record<string, unknown>): void {
  for (const field of ADDRESS_DEPLOYMENT_FIELDS) {
    if (typeof json[field] === "string") {
      deployment[field] = json[field] as Address;
    }
  }
}

function applyBooleanFields(deployment: PledgeCashDeployment, json: Record<string, unknown>): void {
  for (const field of BOOLEAN_DEPLOYMENT_FIELDS) {
    if (typeof json[field] === "boolean") {
      deployment[field] = json[field];
    }
  }
}

function applyBigintFields(deployment: PledgeCashDeployment, raw: string): void {
  for (const field of BIGINT_DEPLOYMENT_FIELDS) {
    const value = bigintField(raw, field);
    if (value !== undefined) {
      deployment[field] = value;
    }
  }
}

function bigintField(raw: string, key: string): bigint | undefined {
  const token = propertyToken(raw, key);
  if (!token || token === "null") return undefined;
  return parseBigintToken(token);
}

function propertyToken(raw: string, key: string): string | undefined {
  const match = raw.match(new RegExp(`"${key}"\\s*:\\s*(${JSON_PRIMITIVE_TOKEN_PATTERN})`));
  return match?.[1];
}

function parseBigintToken(token: string): bigint {
  if (token.startsWith('"')) return BigInt(JSON.parse(token) as string);
  return BigInt(token);
}
