import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Artifact = {
  abi?: unknown;
};

type DeploymentFieldKind = "address" | "bigint" | "boolean" | "number" | "string";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const outFile = join(repoRoot, "packages/sdk/src/generated.ts");

const contracts = [
  ["AmmFactory", "packages/contracts/out/AmmFactory.sol/AmmFactory.json", "ammFactoryAbi"],
  ["AmmPool", "packages/contracts/out/AmmPool.sol/AmmPool.json", "ammPoolAbi"],
  ["AmmRouter", "packages/contracts/out/AmmRouter.sol/AmmRouter.json", "ammRouterAbi"],
  ["AssetPolicy", "packages/contracts/out/AssetPolicy.sol/AssetPolicy.json", "assetPolicyAbi"],
  ["Boardroom", "packages/contracts/out/Boardroom.sol/Boardroom.json", "boardroomAbi"],
  [
    "BoardroomController",
    "packages/contracts/out/BoardroomController.sol/BoardroomController.json",
    "boardroomControllerAbi",
  ],
  [
    "BoardroomControllerFactory",
    "packages/contracts/out/BoardroomControllerFactory.sol/BoardroomControllerFactory.json",
    "boardroomControllerFactoryAbi",
  ],
  ["BoardroomFactory", "packages/contracts/out/BoardroomFactory.sol/BoardroomFactory.json", "boardroomFactoryAbi"],
  [
    "BoardroomGovernanceLogic",
    "packages/contracts/out/BoardroomGovernanceLogic.sol/BoardroomGovernanceLogic.json",
    "boardroomGovernanceLogicAbi",
  ],
  ["BoardroomMarketLogic", "packages/contracts/out/BoardroomMarketLogic.sol/BoardroomMarketLogic.json", "boardroomMarketLogicAbi"],
  [
    "BoardroomPolicyRegistry",
    "packages/contracts/out/BoardroomPolicyRegistry.sol/BoardroomPolicyRegistry.json",
    "boardroomPolicyRegistryAbi",
  ],
  ["BoardroomToken", "packages/contracts/out/BoardroomToken.sol/BoardroomToken.json", "boardroomTokenAbi"],
  ["BoardroomRewards", "packages/contracts/out/BoardroomRewards.sol/BoardroomRewards.json", "boardroomRewardsAbi"],
  [
    "BoardroomRewardsFactory",
    "packages/contracts/out/BoardroomRewardsFactory.sol/BoardroomRewardsFactory.json",
    "boardroomRewardsFactoryAbi",
  ],
  [
    "BoardroomRewardsFactoryVNext",
    "packages/contracts/out/BoardroomRewardsFactoryVNext.sol/BoardroomRewardsFactoryVNext.json",
    "boardroomRewardsFactoryVNextAbi",
  ],
  ["BondMarket", "packages/contracts/out/BondMarket.sol/BondMarket.json", "bondMarketAbi"],
  ["BondMarketFactory", "packages/contracts/out/BondMarketFactory.sol/BondMarketFactory.json", "bondMarketFactoryAbi"],
  [
    "BondMarketFactoryVNext",
    "packages/contracts/out/BondMarketFactoryVNext.sol/BondMarketFactoryVNext.json",
    "bondMarketFactoryVNextAbi",
  ],
  [
    "BoardroomRedemptionPayout",
    "packages/contracts/out/BoardroomRedemptionPayout.sol/BoardroomRedemptionPayout.json",
    "boardroomRedemptionPayoutAbi",
  ],
  ["DistributionFactory", "packages/contracts/out/DistributionFactory.sol/DistributionFactory.json", "distributionFactoryAbi"],
  [
    "DistributionFactoryVNext",
    "packages/contracts/out/DistributionFactoryVNext.sol/DistributionFactoryVNext.json",
    "distributionFactoryVNextAbi",
  ],
  ["DutchAuctionSale", "packages/contracts/out/DutchAuctionSale.sol/DutchAuctionSale.json", "dutchAuctionSaleAbi"],
  ["ERC20", "packages/contracts/out/ERC20.sol/ERC20.json", "erc20Abi"],
  ["FixedPriceSale", "packages/contracts/out/FixedPriceSale.sol/FixedPriceSale.json", "fixedPriceSaleAbi"],
  ["IBoardroomCallPolicy", "packages/contracts/out/IBoardroomCallPolicy.sol/IBoardroomCallPolicy.json", "boardroomCallPolicyAbi"],
  [
    "IBoardroomPolicyRegistry",
    "packages/contracts/out/IBoardroomPolicyRegistry.sol/IBoardroomPolicyRegistry.json",
    "boardroomPolicyRegistryInterfaceAbi",
  ],
  ["LockedLiquidity", "packages/contracts/out/LockedLiquidity.sol/LockedLiquidity.json", "lockedLiquidityAbi"],
  [
    "LockedLiquidityFactory",
    "packages/contracts/out/LockedLiquidityFactory.sol/LockedLiquidityFactory.json",
    "lockedLiquidityFactoryAbi",
  ],
  [
    "LockedLiquidityFactoryVNext",
    "packages/contracts/out/LockedLiquidityFactoryVNext.sol/LockedLiquidityFactoryVNext.json",
    "lockedLiquidityFactoryVNextAbi",
  ],
  [
    "MigratingBondingCurve",
    "packages/contracts/out/MigratingBondingCurve.sol/MigratingBondingCurve.json",
    "migratingBondingCurveAbi",
  ],
  [
    "MigratingBondingCurveVNext",
    "packages/contracts/out/MigratingBondingCurveVNext.sol/MigratingBondingCurveVNext.json",
    "migratingBondingCurveVNextAbi",
  ],
  ["MerkleAirdrop", "packages/contracts/out/MerkleAirdrop.sol/MerkleAirdrop.json", "merkleAirdropAbi"],
  [
    "MerkleAirdropVNext",
    "packages/contracts/out/MerkleAirdropVNext.sol/MerkleAirdropVNext.json",
    "merkleAirdropVNextAbi",
  ],
  ["PoolFees", "packages/contracts/out/PoolFees.sol/PoolFees.json", "poolFeesAbi"],
  ["ProtocolFeeRouter", "packages/contracts/out/ProtocolFeeRouter.sol/ProtocolFeeRouter.json", "protocolFeeRouterAbi"],
  ["TokenGrant", "packages/contracts/out/TokenGrant.sol/TokenGrant.json", "tokenGrantAbi"],
  ["TokenGrantFactory", "packages/contracts/out/TokenGrantFactory.sol/TokenGrantFactory.json", "tokenGrantFactoryAbi"],
  [
    "TokenGrantFactoryVNext",
    "packages/contracts/out/TokenGrantFactoryVNext.sol/TokenGrantFactoryVNext.json",
    "tokenGrantFactoryVNextAbi",
  ],
  [
    "BoardroomDiamond",
    "packages/contracts/out/BoardroomDiamond.sol/IBoardroomDiamond.json",
    "boardroomDiamondAbi",
  ],
  [
    "BoardroomKernel",
    "packages/contracts/out/BoardroomKernel.sol/BoardroomKernel.json",
    "boardroomKernelAbi",
  ],
  [
    "BoardroomReleaseBMigrationFacet",
    "packages/contracts/out/BoardroomReleaseBMigrationFacet.sol/BoardroomReleaseBMigrationFacet.json",
    "boardroomReleaseBMigrationFacetAbi",
  ],
  [
    "BoardroomVNextController",
    "packages/contracts/out/BoardroomVNextController.sol/BoardroomVNextController.json",
    "boardroomVNextControllerAbi",
  ],
  [
    "BoardroomVNextControllerFactory",
    "packages/contracts/out/BoardroomVNextControllerFactory.sol/BoardroomVNextControllerFactory.json",
    "boardroomVNextControllerFactoryAbi",
  ],
  [
    "BoardroomVNextFactory",
    "packages/contracts/out/BoardroomVNextFactory.sol/BoardroomVNextFactory.json",
    "boardroomVNextFactoryAbi",
  ],
  [
    "ProtocolFacetRegistry",
    "packages/contracts/out/ProtocolFacetRegistry.sol/ProtocolFacetRegistry.json",
    "protocolFacetRegistryAbi",
  ],
] as const;

const deploymentFields = [
  ["chainId", "number"],
  ["status", "string"],
  ["reason", "string"],
  ["sourceCommit", "string"],
  ["deterministicDeployment", "boolean"],
  ["deterministicDeploymentVersion", "string"],
  ["deterministicReleaseCodeHash", "string"],
  ["deterministicDeployer", "address"],
  ["deterministicDeployerOwner", "address"],
  ["create2Factory", "address"],
  ["boardroomStatus", "string"],
  ["boardroomReason", "string"],
  ["boardroomFactory", "address"],
  ["boardroomControllerFactory", "address"],
  ["boardroomControllerLogic", "address"],
  ["boardroomGovernanceLogic", "address"],
  ["boardroomMarketLogic", "address"],
  ["boardroomRedemptionPayout", "address"],
  ["boardroomLogic", "address"],
  ["protocolFacetRegistry", "address"],
  ["boardroomKernel", "address"],
  ["boardroomVNextFactory", "address"],
  ["boardroomVNextControllerFactory", "address"],
  ["boardroomVNextControllerLogic", "address"],
  ["boardroomVNextLegacyLogic", "address"],
  ["boardroomVNextGovernanceLogic", "address"],
  ["boardroomVNextMarketLogic", "address"],
  ["boardroomVNextRedemptionPayout", "address"],
  ["boardroomAuthorityFacet", "address"],
  ["boardroomExecutionFacet", "address"],
  ["boardroomMarketFacet", "address"],
  ["boardroomRedemptionFacet", "address"],
  ["boardroomViewFacet", "address"],
  ["boardroomReleaseBMigrationFacet", "address"],
  ["boardroomViewFacetV2", "address"],
  ["boardroomVNextActiveFacetSetHash", "string"],
  ["boardroomVNextActiveRelease", "bigint"],
  ["boardroomVNextRequiredStorageVersion", "bigint"],
  ["boardroomVNextRequiredStorageLayoutHash", "string"],
  ["boardroomPolicyRegistry", "address"],
  ["assetPolicy", "address"],
  ["protocolFeeRouter", "address"],
  ["distributionFactory", "address"],
  ["fixedPriceSaleLogic", "address"],
  ["dutchAuctionLogic", "address"],
  ["migratingBondingCurveLogic", "address"],
  ["merkleAirdropLogic", "address"],
  ["boardroomRewardsFactory", "address"],
  ["boardroomRewardsLogic", "address"],
  ["bondMarketFactory", "address"],
  ["bondMarketLogic", "address"],
  ["ammFactory", "address"],
  ["ammPoolImplementation", "address"],
  ["ammProtocolFeeRecipient", "address"],
  ["ammRouter", "address"],
  ["lockedLiquidityFactory", "address"],
  ["lockedLiquidityLogic", "address"],
  ["tokenGrantFactory", "address"],
  ["tokenGrantLogic", "address"],
  ["wrappedNative", "address"],
  ["deployer", "address"],
  ["factoryOwner", "address"],
  ["policyRegistryOwner", "address"],
  ["assetPolicyOwner", "address"],
  ["protocolGovernance", "address"],
  ["protocolTreasury", "address"],
  ["protocolFeeRouterOwner", "address"],
  ["protocolFeeRouterRecipient", "address"],
  ["tokenGrantFeeRecipient", "address"],
  ["ammFactoryOwner", "address"],
  ["ammFeeManager", "address"],
  ["ammLiquidityRouter", "address"],
  ["ammReservationManager", "address"],
  ["assetPolicyAllowed", "boolean"],
  ["distributionPolicyAllowed", "boolean"],
  ["distributionModulePolicy", "boolean"],
  ["boardroomRewardsPolicyAllowed", "boolean"],
  ["boardroomRewardsModulePolicy", "boolean"],
  ["bondMarketPolicyAllowed", "boolean"],
  ["bondMarketModulePolicy", "boolean"],
  ["lockedLiquidityPolicyAllowed", "boolean"],
  ["lockedLiquidityModulePolicy", "boolean"],
  ["tokenGrantPolicyAllowed", "boolean"],
  ["tokenGrantModulePolicy", "boolean"],
  ["assetWrappedNativeAllowed", "boolean"],
  ["assetTokenGrantSpenderAllowed", "boolean"],
  ["assetDistributionSpenderAllowed", "boolean"],
  ["assetBoardroomRewardsSpenderAllowed", "boolean"],
  ["assetBondMarketSpenderAllowed", "boolean"],
  ["assetLockedLiquiditySpenderAllowed", "boolean"],
  ["creationFee", "bigint"],
  ["deploymentBlock", "bigint"],
  ["deploymentTimestamp", "bigint"],
  ["deterministicDeployerCodeHash", "string"],
  ["boardroomPolicyRegistryCodeHash", "string"],
  ["assetPolicyCodeHash", "string"],
  ["protocolFeeRouterCodeHash", "string"],
  ["boardroomFactoryCodeHash", "string"],
  ["boardroomControllerFactoryCodeHash", "string"],
  ["boardroomControllerCodeHash", "string"],
  ["boardroomGovernanceLogicCodeHash", "string"],
  ["boardroomMarketLogicCodeHash", "string"],
  ["boardroomRedemptionPayoutCodeHash", "string"],
  ["boardroomLogicCodeHash", "string"],
  ["protocolFacetRegistryCodeHash", "string"],
  ["boardroomKernelCodeHash", "string"],
  ["boardroomVNextFactoryCodeHash", "string"],
  ["boardroomVNextControllerFactoryCodeHash", "string"],
  ["boardroomVNextControllerCodeHash", "string"],
  ["boardroomVNextLegacyLogicCodeHash", "string"],
  ["boardroomVNextGovernanceLogicCodeHash", "string"],
  ["boardroomVNextMarketLogicCodeHash", "string"],
  ["boardroomVNextRedemptionPayoutCodeHash", "string"],
  ["boardroomAuthorityFacetCodeHash", "string"],
  ["boardroomExecutionFacetCodeHash", "string"],
  ["boardroomMarketFacetCodeHash", "string"],
  ["boardroomRedemptionFacetCodeHash", "string"],
  ["boardroomViewFacetCodeHash", "string"],
  ["boardroomReleaseBMigrationFacetCodeHash", "string"],
  ["boardroomViewFacetV2CodeHash", "string"],
  ["tokenGrantFactoryCodeHash", "string"],
  ["tokenGrantLogicCodeHash", "string"],
  ["ammFactoryCodeHash", "string"],
  ["ammPoolImplementationCodeHash", "string"],
  ["ammRouterCodeHash", "string"],
  ["lockedLiquidityFactoryCodeHash", "string"],
  ["lockedLiquidityLogicCodeHash", "string"],
  ["distributionFactoryCodeHash", "string"],
  ["fixedPriceSaleLogicCodeHash", "string"],
  ["dutchAuctionLogicCodeHash", "string"],
  ["migratingBondingCurveLogicCodeHash", "string"],
  ["merkleAirdropLogicCodeHash", "string"],
  ["boardroomRewardsFactoryCodeHash", "string"],
  ["boardroomRewardsLogicCodeHash", "string"],
  ["bondMarketFactoryCodeHash", "string"],
  ["bondMarketLogicCodeHash", "string"],
  ["wrappedNativeCodeHash", "string"],
] as const satisfies readonly (readonly [string, DeploymentFieldKind])[];

const requiredTokenGrantDeploymentFields = [
  "boardroomFactory",
  "tokenGrantFactory",
  "tokenGrantLogic",
  "factoryOwner",
  "tokenGrantFeeRecipient",
  "protocolFeeRouter",
  "protocolFeeRouterRecipient",
  "protocolGovernance",
  "protocolTreasury",
  "creationFee",
  "deploymentTimestamp",
] as const;

const requiredBoardroomDeploymentFields = [
  "boardroomFactory",
  "boardroomControllerFactory",
  "boardroomControllerLogic",
  "boardroomGovernanceLogic",
  "boardroomMarketLogic",
  "boardroomRedemptionPayout",
  "boardroomLogic",
  "boardroomPolicyRegistry",
  "assetPolicy",
  "distributionFactory",
  "boardroomRewardsFactory",
  "lockedLiquidityFactory",
  "policyRegistryOwner",
  "assetPolicyOwner",
  "protocolFeeRouterOwner",
  "ammFactoryOwner",
  "ammFeeManager",
  "ammLiquidityRouter",
  "ammReservationManager",
  "ammProtocolFeeRecipient",
  "assetPolicyAllowed",
  "tokenGrantPolicyAllowed",
  "tokenGrantModulePolicy",
  "distributionPolicyAllowed",
  "distributionModulePolicy",
  "boardroomRewardsPolicyAllowed",
  "boardroomRewardsModulePolicy",
  "lockedLiquidityPolicyAllowed",
  "lockedLiquidityModulePolicy",
  "assetWrappedNativeAllowed",
  "assetTokenGrantSpenderAllowed",
  "assetDistributionSpenderAllowed",
  "assetBoardroomRewardsSpenderAllowed",
  "assetLockedLiquiditySpenderAllowed",
] as const;

const boardroomDeploymentFields = new Set<string>(requiredBoardroomDeploymentFields);

const requiredV4DeploymentFields = [
  "deterministicReleaseCodeHash",
  "deterministicDeployerCodeHash",
  "boardroomPolicyRegistryCodeHash",
  "assetPolicyCodeHash",
  "protocolFeeRouterCodeHash",
  "boardroomFactoryCodeHash",
  "boardroomGovernanceLogicCodeHash",
  "boardroomRedemptionPayoutCodeHash",
  "boardroomLogicCodeHash",
  "tokenGrantFactoryCodeHash",
  "ammFactoryCodeHash",
  "ammRouterCodeHash",
  "lockedLiquidityFactoryCodeHash",
  "distributionFactoryCodeHash",
  "boardroomRewardsFactoryCodeHash",
  "wrappedNativeCodeHash",
  "protocolGovernance",
  "protocolTreasury",
  "protocolFeeRouter",
  "protocolFeeRouterOwner",
  "protocolFeeRouterRecipient",
  "tokenGrantFeeRecipient",
  "ammFactoryOwner",
  "ammFeeManager",
  "ammLiquidityRouter",
  "ammReservationManager",
  "ammProtocolFeeRecipient",
  "boardroomGovernanceLogic",
  "boardroomRedemptionPayout",
  "boardroomLogic",
] as const;

const requiredV5DeploymentFields = [
  ...requiredV4DeploymentFields,
  "sourceCommit",
  "deploymentBlock",
  "tokenGrantLogicCodeHash",
  "ammPoolImplementation",
  "ammPoolImplementationCodeHash",
  "lockedLiquidityLogic",
  "lockedLiquidityLogicCodeHash",
  "fixedPriceSaleLogic",
  "fixedPriceSaleLogicCodeHash",
  "dutchAuctionLogic",
  "dutchAuctionLogicCodeHash",
  "migratingBondingCurveLogic",
  "migratingBondingCurveLogicCodeHash",
  "merkleAirdropLogic",
  "merkleAirdropLogicCodeHash",
  "boardroomRewardsLogic",
  "boardroomRewardsLogicCodeHash",
  "boardroomControllerFactory",
  "boardroomControllerLogic",
  "boardroomMarketLogic",
  "boardroomControllerFactoryCodeHash",
  "boardroomControllerCodeHash",
  "boardroomMarketLogicCodeHash",
] as const;

function literal(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function deploymentFieldType(kind: DeploymentFieldKind): string {
  if (kind === "address") return "Address";
  if (kind === "bigint") return "bigint";
  if (kind === "boolean") return "boolean";
  if (kind === "number") return "number";
  return "string";
}

function propertyToken(raw: string, key: string): string | undefined {
  const match = raw.match(new RegExp(`"${key}"\\s*:\\s*("([^"\\\\]|\\\\.)*"|true|false|null|-?\\d+)`));
  return match?.[1];
}

function bigintLiteral(raw: string, key: string): string | undefined {
  const token = propertyToken(raw, key);
  if (!token || token === "null") return undefined;
  if (token.startsWith('"')) return `${JSON.parse(token)}n`;
  return `${token}n`;
}

function numberLiteral(raw: string, key: string): string | undefined {
  const token = propertyToken(raw, key);
  if (!token || token === "null") return undefined;
  if (token.startsWith('"')) return String(Number(JSON.parse(token)));
  return token;
}

function isIgnoredDeploymentFile(file: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--quiet", "--", join("packages/contracts/deployments", file)], {
    cwd: repoRoot,
  });
  return result.status === 0;
}

function serializeDeployment(raw: string): string | undefined {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const chainId = numberLiteral(raw, "chainId");
  if (!chainId) return undefined;

  if (parsed.deterministicDeploymentVersion === "pledge.cash.deterministic.v4" && parsed.status !== "pending") {
    const missingV4Fields = requiredV4DeploymentFields.filter((field) => propertyToken(raw, field) === undefined);
    if (missingV4Fields.length > 0) {
      throw new Error(`Deployment ${chainId} is deterministic v4 but is missing attestations (${missingV4Fields.join(", ")}).`);
    }
  }

  if (parsed.deterministicDeploymentVersion === "pledge.cash.deterministic.v5" && parsed.status !== "pending") {
    const missingV5Fields = requiredV5DeploymentFields.filter((field) => propertyToken(raw, field) === undefined);
    if (missingV5Fields.length > 0) {
      throw new Error(`Deployment ${chainId} is deterministic v5 but is missing attestations (${missingV5Fields.join(", ")}).`);
    }
  }

  const missingTokenGrantFields = requiredTokenGrantDeploymentFields.filter(
    (field) => propertyToken(raw, field) === undefined,
  );
  const hasTokenGrantFactory = propertyToken(raw, "tokenGrantFactory") !== undefined;

  if (missingTokenGrantFields.length > 0 && hasTokenGrantFactory) {
    throw new Error(
      `Deployment ${chainId} has tokenGrantFactory but is missing current fields (${missingTokenGrantFields.join(
        ", ",
      )}).`,
    );
  }

  if (missingTokenGrantFields.length > 0 && !hasTokenGrantFactory) {
    const status = typeof parsed.status === "string" ? parsed.status : "pending";
    const reason =
      typeof parsed.reason === "string"
        ? parsed.reason
        : `Deployment artifact is missing current fields: ${missingTokenGrantFields.join(", ")}`;
    return `${chainId}: {\n    chainId: ${chainId},\n    status: ${literal(status)},\n    reason: ${literal(reason)}\n  }`;
  }

  const missingBoardroomFields = requiredBoardroomDeploymentFields.filter(
    (field) => propertyToken(raw, field) === undefined,
  );
  const hasBoardroomField = requiredBoardroomDeploymentFields.some((field) => propertyToken(raw, field) !== undefined);
  const boardroomStatus = typeof parsed.boardroomStatus === "string" ? parsed.boardroomStatus : undefined;
  const shouldEmitBoardroom = boardroomStatus !== "pending" && missingBoardroomFields.length === 0;
  const shouldEmitBoardroomPending = !shouldEmitBoardroom && (boardroomStatus === "pending" || hasBoardroomField);

  const lines = [`chainId: ${chainId}`];
  if (shouldEmitBoardroomPending) {
    const boardroomReason =
      typeof parsed.boardroomReason === "string"
        ? parsed.boardroomReason
        : `Boardroom artifact is missing current fields: ${missingBoardroomFields.join(", ")}`;
    lines.push(`boardroomStatus: ${literal("pending")}`);
    lines.push(`boardroomReason: ${literal(boardroomReason)}`);
  }

  for (const [field, kind] of deploymentFields) {
    if (field === "chainId") continue;
    if (field === "boardroomStatus" || field === "boardroomReason") continue;
    if (boardroomDeploymentFields.has(field) && !shouldEmitBoardroom) continue;
    if (propertyToken(raw, field) === undefined) continue;

    if (kind === "address") {
      lines.push(`${field}: ${literal(parsed[field])} as Address`);
      continue;
    }
    if (kind === "bigint") {
      const value = bigintLiteral(raw, field);
      if (value) lines.push(`${field}: ${value}`);
      continue;
    }
    if (kind === "number") {
      const value = numberLiteral(raw, field);
      if (value) lines.push(`${field}: ${value}`);
      continue;
    }

    lines.push(`${field}: ${literal(parsed[field])}`);
  }

  return `${chainId}: {\n    ${lines.join(",\n    ")}\n  }`;
}

async function readAbi(path: string): Promise<unknown[]> {
  const artifact = JSON.parse(await readFile(join(repoRoot, path), "utf8")) as Artifact;
  if (!Array.isArray(artifact.abi)) {
    throw new Error(`Missing ABI in ${path}`);
  }
  return artifact.abi;
}

async function deploymentEntries(): Promise<string[]> {
  const deploymentDir = join(repoRoot, "packages/contracts/deployments");
  const files = await readdir(deploymentDir).catch(() => []);
  const entries: string[] = [];

  for (const file of files.sort()) {
    if (!/^\d+\.json$/.test(file)) continue;
    if (isIgnoredDeploymentFile(file)) continue;
    const raw = await readFile(join(deploymentDir, file), "utf8");
    const entry = serializeDeployment(raw);
    if (entry) entries.push(entry);
  }

  return entries;
}

const abiExports: string[] = [];
const abiMapEntries: string[] = [];

for (const [contractName, artifactPath, exportName] of contracts) {
  const abi = await readAbi(artifactPath);
  abiExports.push(`export const ${exportName} = ${literal(abi)} as const;`);
  abiMapEntries.push(`${contractName}: ${exportName}`);
}

const deployments = await deploymentEntries();
const deploymentTypeFields = deploymentFields
  .map(([field, kind]) => `  ${field}${field === "chainId" ? "" : "?"}: ${deploymentFieldType(kind)};`)
  .join("\n");

const source = `// This file is generated by packages/sdk/scripts/generate.ts.
// Do not edit it by hand.

import type { Address } from "viem";

export type PledgeCashDeployment = {
${deploymentTypeFields}
};

${abiExports.join("\n\n")}

export const pledgeCashAbis = {
  ${abiMapEntries.join(",\n  ")}
} as const;

export const pledgeCashDeployments = {
  ${deployments.join(",\n  ")}
} as const satisfies Record<number, PledgeCashDeployment>;
`;

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, source);
