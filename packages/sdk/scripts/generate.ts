import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Artifact = {
  abi?: unknown;
};

type AbiParameter = {
  type?: unknown;
  components?: unknown;
};

type AbiItem = {
  type?: unknown;
  name?: unknown;
  inputs?: unknown;
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
  [
    "Boardroom",
    "packages/contracts/out/IBoardroom.sol/IBoardroom.json",
    "boardroomAbi",
  ],
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
  [
    "BoardroomFactory",
    "packages/contracts/out/BoardroomFactory.sol/BoardroomFactory.json",
    "boardroomFactoryAbi",
  ],
  [
    "BoardroomPolicyRegistry",
    "packages/contracts/out/BoardroomPolicyRegistry.sol/BoardroomPolicyRegistry.json",
    "boardroomPolicyRegistryAbi",
  ],
  [
    "BoardroomToken",
    "packages/contracts/out/BoardroomToken.sol/BoardroomToken.json",
    "boardroomTokenAbi",
  ],
  ["BoardroomRewards", "packages/contracts/out/BoardroomRewards.sol/BoardroomRewards.json", "boardroomRewardsAbi"],
  [
    "BoardroomRewardsFactory",
    "packages/contracts/out/BoardroomRewardsFactory.sol/BoardroomRewardsFactory.json",
    "boardroomRewardsFactoryAbi",
  ],
  ["BondMarket", "packages/contracts/out/BondMarket.sol/BondMarket.json", "bondMarketAbi"],
  [
    "BondMarketFactory",
    "packages/contracts/out/BondMarketFactory.sol/BondMarketFactory.json",
    "bondMarketFactoryAbi",
  ],
  [
    "DistributionFactory",
    "packages/contracts/out/DistributionFactory.sol/DistributionFactory.json",
    "distributionFactoryAbi",
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
    "MigratingBondingCurve",
    "packages/contracts/out/MigratingBondingCurve.sol/MigratingBondingCurve.json",
    "migratingBondingCurveAbi",
  ],
  [
    "MerkleAirdrop",
    "packages/contracts/out/MerkleAirdrop.sol/MerkleAirdrop.json",
    "merkleAirdropAbi",
  ],
  ["PoolFees", "packages/contracts/out/PoolFees.sol/PoolFees.json", "poolFeesAbi"],
  ["ProtocolFeeRouter", "packages/contracts/out/ProtocolFeeRouter.sol/ProtocolFeeRouter.json", "protocolFeeRouterAbi"],
  ["TokenGrant", "packages/contracts/out/TokenGrant.sol/TokenGrant.json", "tokenGrantAbi"],
  [
    "TokenGrantFactory",
    "packages/contracts/out/TokenGrantFactory.sol/TokenGrantFactory.json",
    "tokenGrantFactoryAbi",
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
    "ProtocolFacetRegistry",
    "packages/contracts/out/ProtocolFacetRegistry.sol/ProtocolFacetRegistry.json",
    "protocolFacetRegistryAbi",
  ],
] as const;

const boardroomDiamondSupplementArtifacts = [
  "packages/contracts/out/BoardroomKernel.sol/BoardroomKernel.json",
  "packages/contracts/out/BoardroomAuthorityFacet.sol/BoardroomAuthorityFacet.json",
  "packages/contracts/out/BoardroomExecutionFacet.sol/BoardroomExecutionFacet.json",
  "packages/contracts/out/BoardroomMarketFacet.sol/BoardroomMarketFacet.json",
  "packages/contracts/out/BoardroomRedemptionFacet.sol/BoardroomRedemptionFacet.json",
  "packages/contracts/out/BoardroomReleaseBMigrationFacet.sol/BoardroomReleaseBMigrationFacet.json",
  "packages/contracts/out/BoardroomViewFacet.sol/BoardroomViewFacet.json",
  "packages/contracts/out/BoardroomViewFacetV2.sol/BoardroomViewFacetV2.json",
] as const;

const deploymentFields = [
  ["chainId", "number"],
  ["status", "string"],
  ["reason", "string"],
  ["protocolVersion", "string"],
  ["protocolReleaseCodeHash", "string"],
  ["sourceCommit", "string"],
  ["deterministicDeployment", "boolean"],
  ["deterministicDeploymentVersion", "string"],
  ["deterministicReleaseCodeHash", "string"],
  ["deterministicDeployer", "address"],
  ["deterministicDeployerOwner", "address"],
  ["create2Factory", "address"],
  ["boardroomFactory", "address"],
  ["boardroomControllerFactory", "address"],
  ["boardroomControllerLogic", "address"],
  ["boardroomGovernanceLogic", "address"],
  ["boardroomMarketLogic", "address"],
  ["boardroomRedemptionPayout", "address"],
  ["protocolFacetRegistry", "address"],
  ["boardroomKernel", "address"],
  ["authorityFacet", "address"],
  ["executionFacet", "address"],
  ["marketFacet", "address"],
  ["redemptionFacet", "address"],
  ["viewFacet", "address"],
  ["boardroomReleaseBMigrationFacet", "address"],
  ["boardroomViewFacetV2", "address"],
  ["activeFacetSetHash", "string"],
  ["activeRelease", "bigint"],
  ["requiredStorageVersion", "bigint"],
  ["requiredStorageLayoutHash", "string"],
  ["manifestHash", "string"],
  ["kernelSelectorSetHash", "string"],
  ["selectorCount", "bigint"],
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
  ["protocolFacetRegistryOwner", "address"],
  ["boardroomPolicyRegistryOwner", "address"],
  ["tokenGrantFactoryOwner", "address"],
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
  ["boardroomControllerLogicCodeHash", "string"],
  ["boardroomGovernanceLogicCodeHash", "string"],
  ["boardroomMarketLogicCodeHash", "string"],
  ["boardroomRedemptionPayoutCodeHash", "string"],
  ["protocolFacetRegistryCodeHash", "string"],
  ["boardroomKernelCodeHash", "string"],
  ["authorityFacetCodeHash", "string"],
  ["executionFacetCodeHash", "string"],
  ["marketFacetCodeHash", "string"],
  ["redemptionFacetCodeHash", "string"],
  ["viewFacetCodeHash", "string"],
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

const optionalCanonicalDeploymentFields = new Set<string>([
  "status",
  "reason",
  "boardroomReleaseBMigrationFacet",
  "boardroomViewFacetV2",
  "boardroomReleaseBMigrationFacetCodeHash",
  "boardroomViewFacetV2CodeHash",
]);
const requiredCanonicalDeploymentFields = deploymentFields
  .map(([field]) => field)
  .filter((field) => field !== "chainId" && !optionalCanonicalDeploymentFields.has(field));

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

  if (parsed.status === "pending") {
    const reason =
      typeof parsed.reason === "string"
        ? parsed.reason
        : "Canonical protocol deployment is pending.";
    const lines = [
      `chainId: ${chainId}`,
      `status: ${literal("pending")}`,
      `reason: ${literal(reason)}`,
    ];
    if (typeof parsed.protocolVersion === "string") {
      lines.push(`protocolVersion: ${literal(parsed.protocolVersion)}`);
    }
    return `${chainId}: {\n    ${lines.join(",\n    ")}\n  }`;
  }

  const missingCanonicalFields = requiredCanonicalDeploymentFields.filter(
    (field) => propertyToken(raw, field) === undefined,
  );
  if (missingCanonicalFields.length > 0) {
    throw new Error(
      `Deployment ${chainId} is not explicitly pending and is missing canonical protocol fields (${missingCanonicalFields.join(
        ", ",
      )}).`,
    );
  }

  const lines = [`chainId: ${chainId}`];
  for (const [field, kind] of deploymentFields) {
    if (field === "chainId") continue;
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

function canonicalAbiParameterType(parameter: unknown): string {
  if (typeof parameter !== "object" || parameter === null) return "";
  const typed = parameter as AbiParameter;
  if (typeof typed.type !== "string") return "";
  if (!typed.type.startsWith("tuple")) return typed.type;
  const suffix = typed.type.slice("tuple".length);
  const components = Array.isArray(typed.components)
    ? typed.components.map(canonicalAbiParameterType).join(",")
    : "";
  return `(${components})${suffix}`;
}

function abiItemKey(item: unknown): string {
  if (typeof item !== "object" || item === null) return JSON.stringify(item);
  const typed = item as AbiItem;
  const inputs = Array.isArray(typed.inputs) ? typed.inputs.map(canonicalAbiParameterType).join(",") : "";
  return `${String(typed.type)}:${String(typed.name)}(${inputs})`;
}

async function readBoardroomDiamondAbi(path: string): Promise<unknown[]> {
  const aggregate = await readAbi(path);
  const result = [...aggregate];
  const seen = new Set(result.map(abiItemKey));

  for (const supplementPath of boardroomDiamondSupplementArtifacts) {
    const supplement = await readAbi(supplementPath);
    for (const item of supplement) {
      if (typeof item !== "object" || item === null) continue;
      const type = (item as AbiItem).type;
      if (type !== "event" && type !== "error") continue;
      const key = abiItemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
  }

  return result;
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
  const abi = exportName === "boardroomAbi"
    ? await readBoardroomDiamondAbi(artifactPath)
    : await readAbi(artifactPath);
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
