import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadNetworkManifest } from "../../contracts/script/network-profiles";

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
  ["BoardroomToken", "packages/contracts/out/BoardroomToken.sol/BoardroomToken.json", "boardroomTokenAbi"],
  ["ERC20", "packages/contracts/out/ERC20.sol/ERC20.json", "erc20Abi"],
  ["LiquidityLocker", "packages/contracts/out/LiquidityLocker.sol/LiquidityLocker.json", "liquidityLockerAbi"],
  ["LiquidityLockerFactory", "packages/contracts/out/LiquidityLockerFactory.sol/LiquidityLockerFactory.json", "liquidityLockerFactoryAbi"],
  ["PositionManager", "packages/contracts/out/IPositionManager.sol/IPositionManager.json", "positionManagerAbi"],
  ["ProtocolFeeRouter", "packages/contracts/out/ProtocolFeeRouter.sol/ProtocolFeeRouter.json", "protocolFeeRouterAbi"],
  ["PledgeCashDeterministicDeployer", "packages/contracts/out/PledgeCashDeterministicDeployer.sol/PledgeCashDeterministicDeployer.json", "pledgeCashDeterministicDeployerAbi"],
  ["TokenGrant", "packages/contracts/out/TokenGrant.sol/TokenGrant.json", "tokenGrantAbi"],
  ["TokenGrantFactory", "packages/contracts/out/TokenGrantFactory.sol/TokenGrantFactory.json", "tokenGrantFactoryAbi"],
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
  ["boardroomImplementation", "address"],
  ["manifestHash", "string"],
  ["boardroomArchitectureCodeHash", "string"],
  ["moduleArchitectureCodeHash", "string"],
  ["protocolFeeRouter", "address"],
  ["uniswapV4PoolManager", "address"],
  ["uniswapUniversalRouter", "address"],
  ["uniswapV4Quoter", "address"],
  ["uniswapV4StateView", "address"],
  ["uniswapV4PositionManager", "address"],
  ["permit2", "address"],
  ["liquidityLockerFactory", "address"],
  ["tokenGrantFactory", "address"],
  ["tokenGrantLogic", "address"],
  ["wrappedNative", "address"],
  ["deployer", "address"],
  ["tokenGrantFactoryOwner", "address"],
  ["protocolTreasury", "address"],
  ["protocolFeeRouterOwner", "address"],
  ["protocolFeeRouterRecipient", "address"],
  ["tokenGrantFeeRecipient", "address"],
  ["creationFee", "bigint"],
  ["deploymentBlock", "bigint"],
  ["deploymentTimestamp", "bigint"],
  ["deterministicDeployerCodeHash", "string"],
  ["protocolFeeRouterCodeHash", "string"],
  ["boardroomFactoryCodeHash", "string"],
  ["boardroomImplementationCodeHash", "string"],
  ["tokenGrantFactoryCodeHash", "string"],
  ["tokenGrantLogicCodeHash", "string"],
  ["liquidityLockerFactoryCodeHash", "string"],
  ["liquidityLockerCodeHash", "string"],
  ["uniswapV4PoolManagerCodeHash", "string"],
  ["uniswapUniversalRouterCodeHash", "string"],
  ["uniswapV4QuoterCodeHash", "string"],
  ["uniswapV4StateViewCodeHash", "string"],
  ["uniswapV4PositionManagerCodeHash", "string"],
  ["permit2CodeHash", "string"],
  ["wrappedNativeCodeHash", "string"],
] as const satisfies readonly (readonly [string, DeploymentFieldKind])[];

const optionalCanonicalDeploymentFields = new Set<string>([
  "status",
  "reason",
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
const networkManifest = await loadNetworkManifest();
const deploymentTypeFields = deploymentFields
  .map(([field, kind]) => `  ${field}${field === "chainId" ? "" : "?"}: ${deploymentFieldType(kind)};`)
  .join("\n");

const source = `// This file is generated by packages/sdk/scripts/generate.ts.
// Do not edit it by hand.

import type { Address } from "viem";

export type PledgeCashDeployment = {
${deploymentTypeFields}
};

export type PledgeCashNetworkEnvironment = "testnet" | "mainnet";

export type PledgeCashNetworkProfile = {
  readonly chainId: number;
  readonly key: string;
  readonly name: string;
  readonly environment: PledgeCashNetworkEnvironment;
  readonly deploymentPhase: "testnet-candidate" | "mainnet-planned";
  readonly rpcEnv: string;
  readonly defaultRpcUrl: string;
  readonly explorer: {
    readonly name: string;
    readonly url: string;
  };
  readonly nativeCurrency: {
    readonly name: string;
    readonly symbol: string;
    readonly decimals: number;
  };
  readonly confirmations: number;
  readonly observedAt: {
    readonly blockNumber: number;
    readonly checkedAt: string;
  };
  readonly create2Factory: {
    readonly address: Address;
    readonly codeHash: \`0x\${string}\`;
  };
  readonly wrappedNative: {
    readonly symbol: string;
    readonly address: Address;
    readonly codeHash: \`0x\${string}\`;
  };
  readonly uniswap: {
    readonly routerEncoding: "universal-router-2.0-v4-exact-input-single";
    readonly poolManager: { readonly address: Address; readonly codeHash: \`0x\${string}\` };
    readonly universalRouter: { readonly address: Address; readonly codeHash: \`0x\${string}\` };
    readonly quoter: { readonly address: Address; readonly codeHash: \`0x\${string}\` };
    readonly stateView: { readonly address: Address; readonly codeHash: \`0x\${string}\` };
    readonly positionManager: { readonly address: Address; readonly codeHash: \`0x\${string}\` };
    readonly permit2: { readonly address: Address; readonly codeHash: \`0x\${string}\` };
  };
};

export const pledgeCashNetworkSupportPolicy = ${literal(networkManifest.supportPolicy)} as const;

export const pledgeCashNetworkSources = ${literal(networkManifest.sources)} as const;

export const pledgeCashNetworkProfiles = ${literal(networkManifest.profiles)} as const satisfies readonly PledgeCashNetworkProfile[];

export type PledgeCashPublicChainId = typeof pledgeCashNetworkProfiles[number]["chainId"];
export type PledgeCashNetworkKey = typeof pledgeCashNetworkProfiles[number]["key"];

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
