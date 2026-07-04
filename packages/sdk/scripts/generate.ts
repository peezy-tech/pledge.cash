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
  ["BoardroomFactory", "packages/contracts/out/BoardroomFactory.sol/BoardroomFactory.json", "boardroomFactoryAbi"],
  [
    "BoardroomPolicyRegistry",
    "packages/contracts/out/BoardroomPolicyRegistry.sol/BoardroomPolicyRegistry.json",
    "boardroomPolicyRegistryAbi",
  ],
  ["BoardroomToken", "packages/contracts/out/BoardroomToken.sol/BoardroomToken.json", "boardroomTokenAbi"],
  ["DistributionFactory", "packages/contracts/out/DistributionFactory.sol/DistributionFactory.json", "distributionFactoryAbi"],
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
  ["PoolFees", "packages/contracts/out/PoolFees.sol/PoolFees.json", "poolFeesAbi"],
  ["ProtocolPolicy", "packages/contracts/out/ProtocolPolicy.sol/ProtocolPolicy.json", "protocolPolicyAbi"],
  ["TokenGrant", "packages/contracts/out/TokenGrant.sol/TokenGrant.json", "tokenGrantAbi"],
  ["TokenGrantFactory", "packages/contracts/out/TokenGrantFactory.sol/TokenGrantFactory.json", "tokenGrantFactoryAbi"],
] as const;

const deploymentFields = [
  ["chainId", "number"],
  ["status", "string"],
  ["reason", "string"],
  ["deterministicDeployment", "boolean"],
  ["deterministicDeploymentVersion", "string"],
  ["deterministicDeployer", "address"],
  ["create2Factory", "address"],
  ["boardroomStatus", "string"],
  ["boardroomReason", "string"],
  ["boardroomFactory", "address"],
  ["boardroomPolicyRegistry", "address"],
  ["protocolPolicy", "address"],
  ["assetPolicy", "address"],
  ["distributionFactory", "address"],
  ["ammFactory", "address"],
  ["ammProtocolFeeRecipient", "address"],
  ["ammRouter", "address"],
  ["lockedLiquidityFactory", "address"],
  ["tokenGrantFactory", "address"],
  ["tokenGrantLogic", "address"],
  ["wrappedNative", "address"],
  ["deployer", "address"],
  ["factoryOwner", "address"],
  ["policyRegistryOwner", "address"],
  ["protocolPolicyOwner", "address"],
  ["assetPolicyOwner", "address"],
  ["protocolPolicyAllowed", "boolean"],
  ["assetPolicyAllowed", "boolean"],
  ["distributionPolicyAllowed", "boolean"],
  ["lockedLiquidityPolicyAllowed", "boolean"],
  ["tokenGrantPolicyAllowed", "boolean"],
  ["protocolTokenGrantFactoryAllowed", "boolean"],
  ["protocolTokenGrantFactoryValueAllowed", "boolean"],
  ["protocolDistributionFactoryAllowed", "boolean"],
  ["protocolLockedLiquidityFactoryAllowed", "boolean"],
  ["protocolAmmFactoryAllowed", "boolean"],
  ["protocolAmmRouterAllowed", "boolean"],
  ["assetWrappedNativeAllowed", "boolean"],
  ["assetTokenGrantSpenderAllowed", "boolean"],
  ["assetDistributionSpenderAllowed", "boolean"],
  ["assetLockedLiquiditySpenderAllowed", "boolean"],
  ["creationFee", "bigint"],
  ["deploymentTimestamp", "bigint"],
] as const satisfies readonly (readonly [string, DeploymentFieldKind])[];

const requiredTokenGrantDeploymentFields = [
  "tokenGrantFactory",
  "tokenGrantLogic",
  "factoryOwner",
  "creationFee",
  "deploymentTimestamp",
] as const;

const requiredBoardroomDeploymentFields = [
  "boardroomFactory",
  "boardroomPolicyRegistry",
  "protocolPolicy",
  "assetPolicy",
  "distributionFactory",
  "policyRegistryOwner",
  "protocolPolicyOwner",
  "assetPolicyOwner",
  "protocolPolicyAllowed",
  "assetPolicyAllowed",
  "tokenGrantPolicyAllowed",
  "distributionPolicyAllowed",
  "protocolTokenGrantFactoryAllowed",
  "protocolTokenGrantFactoryValueAllowed",
  "protocolDistributionFactoryAllowed",
  "assetWrappedNativeAllowed",
  "assetTokenGrantSpenderAllowed",
  "assetDistributionSpenderAllowed",
] as const;

const boardroomDeploymentFields = new Set<string>(requiredBoardroomDeploymentFields);

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
