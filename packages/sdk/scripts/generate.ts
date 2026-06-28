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
  ["Boardroom", "packages/contracts/out/Boardroom.sol/Boardroom.json", "boardroomAbi"],
  ["BoardroomFactory", "packages/contracts/out/BoardroomFactory.sol/BoardroomFactory.json", "boardroomFactoryAbi"],
  [
    "BoardroomPolicyRegistry",
    "packages/contracts/out/BoardroomPolicyRegistry.sol/BoardroomPolicyRegistry.json",
    "boardroomPolicyRegistryAbi",
  ],
  ["BoardroomToken", "packages/contracts/out/BoardroomToken.sol/BoardroomToken.json", "boardroomTokenAbi"],
  ["ERC20", "packages/contracts/out/ERC20.sol/ERC20.json", "erc20Abi"],
  ["IBoardroomCallPolicy", "packages/contracts/out/IBoardroomCallPolicy.sol/IBoardroomCallPolicy.json", "boardroomCallPolicyAbi"],
  [
    "IBoardroomPolicyRegistry",
    "packages/contracts/out/IBoardroomPolicyRegistry.sol/IBoardroomPolicyRegistry.json",
    "boardroomPolicyRegistryInterfaceAbi",
  ],
  ["TokenGrant", "packages/contracts/out/TokenGrant.sol/TokenGrant.json", "tokenGrantAbi"],
  ["TokenGrantFactory", "packages/contracts/out/TokenGrantFactory.sol/TokenGrantFactory.json", "tokenGrantFactoryAbi"],
] as const;

const deploymentFields = [
  ["chainId", "number"],
  ["status", "string"],
  ["reason", "string"],
  ["boardroomStatus", "string"],
  ["boardroomReason", "string"],
  ["boardroomFactory", "address"],
  ["boardroomPolicyRegistry", "address"],
  ["tokenGrantFactory", "address"],
  ["tokenGrantLogic", "address"],
  ["deployer", "address"],
  ["factoryOwner", "address"],
  ["policyRegistryOwner", "address"],
  ["tokenGrantPolicyAllowed", "boolean"],
  ["creationFee", "bigint"],
  ["deploymentTimestamp", "bigint"],
] as const satisfies readonly (readonly [string, DeploymentFieldKind])[];

const requiredCurrentDeploymentFields = [
  "boardroomFactory",
  "boardroomPolicyRegistry",
  "tokenGrantFactory",
  "tokenGrantLogic",
  "policyRegistryOwner",
  "tokenGrantPolicyAllowed",
  "factoryOwner",
  "creationFee",
  "deploymentTimestamp",
] as const;

function literal(value: unknown): string {
  return JSON.stringify(value, null, 2);
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

function serializeDeployment(raw: string): string | undefined {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const chainId = numberLiteral(raw, "chainId");
  if (!chainId) return undefined;

  const missingFields = requiredCurrentDeploymentFields.filter((field) => propertyToken(raw, field) === undefined);
  const hasTokenGrantFactory = propertyToken(raw, "tokenGrantFactory") !== undefined;

  if (missingFields.length > 0 && hasTokenGrantFactory) {
    throw new Error(
      `Deployment ${chainId} has tokenGrantFactory but is missing current fields (${missingFields.join(
        ", ",
      )}); model missing subsystems separately.`,
    );
  }

  if (missingFields.length > 0 && !hasTokenGrantFactory) {
    const status = typeof parsed.status === "string" ? parsed.status : "pending";
    const reason =
      typeof parsed.reason === "string"
        ? parsed.reason
        : `Deployment artifact is missing current fields: ${missingFields.join(", ")}`;
    return `${chainId}: {\n    chainId: ${chainId},\n    status: ${literal(status)},\n    reason: ${literal(reason)}\n  }`;
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

async function deploymentEntries(): Promise<string[]> {
  const deploymentDir = join(repoRoot, "packages/contracts/deployments");
  const files = await readdir(deploymentDir).catch(() => []);
  const entries: string[] = [];

  for (const file of files.sort()) {
    if (!file.endsWith(".json")) continue;
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

const source = `// This file is generated by packages/sdk/scripts/generate.ts.
// Do not edit it by hand.

import type { Address } from "viem";

export type PledgeCashDeployment = {
  chainId: number;
  status?: string;
  reason?: string;
  boardroomStatus?: string;
  boardroomReason?: string;
  boardroomFactory?: Address;
  boardroomPolicyRegistry?: Address;
  tokenGrantFactory?: Address;
  tokenGrantLogic?: Address;
  deployer?: Address;
  factoryOwner?: Address;
  policyRegistryOwner?: Address;
  tokenGrantPolicyAllowed?: boolean;
  creationFee?: bigint;
  deploymentTimestamp?: bigint;
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
