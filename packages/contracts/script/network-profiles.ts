import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const NETWORK_MANIFEST_SCHEMA_VERSION = 1;
export const PLEDGE_CASH_PROTOCOL_VERSION = "pledge.cash.protocol.v1";
export const SUPPORTED_PUBLIC_CHAIN_IDS = [11155111, 84532, 1, 8453, 42161, 4663] as const;
export const SUPPORTED_TESTNET_CHAIN_IDS = [11155111, 84532] as const;
export const SUPPORTED_MAINNET_CHAIN_IDS = [1, 8453, 42161, 4663] as const;
export const UNIVERSAL_ROUTER_ENCODING = "universal-router-2.0-v4-exact-input-single";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const contractsRoot = resolve(scriptDir, "..");
export const repoRoot = resolve(contractsRoot, "../..");
export const networkManifestPath = join(contractsRoot, "config/networks.json");
export const deploymentsRoot = join(contractsRoot, "deployments");

export type NetworkEnvironment = "testnet" | "mainnet";
export type DeploymentPhase = "testnet-candidate" | "mainnet-planned";
export type EvmAddress = `0x${string}`;
export type Bytes32 = `0x${string}`;

export type ContractReference = {
  address: EvmAddress;
  codeHash: Bytes32;
};

export type PledgeCashNetworkProfile = {
  chainId: number;
  key: string;
  name: string;
  environment: NetworkEnvironment;
  deploymentPhase: DeploymentPhase;
  rpcEnv: string;
  defaultRpcUrl: string;
  explorer: {
    name: string;
    url: string;
  };
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  confirmations: number;
  observedAt: {
    blockNumber: number;
    checkedAt: string;
  };
  create2Factory: ContractReference;
  wrappedNative: ContractReference & {
    symbol: string;
  };
  uniswap: {
    routerEncoding: typeof UNIVERSAL_ROUTER_ENCODING;
    poolManager: ContractReference;
    universalRouter: ContractReference;
    quoter: ContractReference;
    stateView: ContractReference;
    positionManager: ContractReference;
    permit2: ContractReference;
  };
};

export type PledgeCashNetworkManifest = {
  schemaVersion: typeof NETWORK_MANIFEST_SCHEMA_VERSION;
  protocolVersion: typeof PLEDGE_CASH_PROTOCOL_VERSION;
  supportPolicy: {
    defaultChainId: number;
    testnetChainIds: number[];
    mainnetChainIds: number[];
  };
  sources: {
    uniswapDeployments: {
      url: string;
      dataUrl: string;
      repository: string;
      commit: string;
      generatedAt: string;
    };
    robinhoodChain: {
      networkUrl: string;
      contractsUrl: string;
    };
  };
  profiles: PledgeCashNetworkProfile[];
};

const expectedProfiles = new Map<number, {
  key: string;
  name: string;
  environment: NetworkEnvironment;
  deploymentPhase: DeploymentPhase;
}>([
  [11155111, { key: "ethereum-sepolia", name: "Ethereum Sepolia", environment: "testnet", deploymentPhase: "testnet-candidate" }],
  [84532, { key: "base-sepolia", name: "Base Sepolia", environment: "testnet", deploymentPhase: "testnet-candidate" }],
  [1, { key: "ethereum", name: "Ethereum", environment: "mainnet", deploymentPhase: "mainnet-planned" }],
  [8453, { key: "base", name: "Base", environment: "mainnet", deploymentPhase: "mainnet-planned" }],
  [42161, { key: "arbitrum", name: "Arbitrum", environment: "mainnet", deploymentPhase: "mainnet-planned" }],
  [4663, { key: "robinhood-chain", name: "Robinhood Chain", environment: "mainnet", deploymentPhase: "mainnet-planned" }],
]);

function fail(message: string): never {
  throw new Error(`Invalid pledge.cash network manifest: ${message}`);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    fail(`${label} keys must be exactly: ${canonical.join(", ")}`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    fail(`${label} must be a nonempty trimmed string`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    fail(`${label} must be a positive JSON safe integer`);
  }
  return value;
}

function requireHttpsUrl(value: unknown, label: string): string {
  const parsed = new URL(requireString(value, label));
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    fail(`${label} must be an HTTPS URL without credentials or a fragment`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function requireAddress(value: unknown, label: string): EvmAddress {
  const address = requireString(value, label);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || BigInt(address) === 0n) {
    fail(`${label} must be a nonzero 20-byte EVM address`);
  }
  return address as EvmAddress;
}

function requireBytes32(value: unknown, label: string): Bytes32 {
  const hash = requireString(value, label);
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash) || BigInt(hash) === 0n) {
    fail(`${label} must be a nonzero bytes32 value`);
  }
  return hash.toLowerCase() as Bytes32;
}

function requireIntegerArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value.map((entry, index) => requirePositiveInteger(entry, `${label}[${index.toString()}]`));
}

function requireExactArray(actual: readonly number[], expected: readonly number[], label: string): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail(`${label} must equal [${expected.join(", ")}]`);
  }
}

function parseContractReference(value: unknown, label: string): ContractReference {
  const input = requireRecord(value, label);
  requireExactKeys(input, ["address", "codeHash"], label);
  return {
    address: requireAddress(input.address, `${label}.address`),
    codeHash: requireBytes32(input.codeHash, `${label}.codeHash`),
  };
}

function parseProfile(value: unknown, index: number): PledgeCashNetworkProfile {
  const label = `profiles[${index.toString()}]`;
  const input = requireRecord(value, label);
  requireExactKeys(input, [
    "chainId",
    "key",
    "name",
    "environment",
    "deploymentPhase",
    "rpcEnv",
    "defaultRpcUrl",
    "explorer",
    "nativeCurrency",
    "confirmations",
    "observedAt",
    "create2Factory",
    "wrappedNative",
    "uniswap",
  ], label);

  const chainId = requirePositiveInteger(input.chainId, `${label}.chainId`);
  const expected = expectedProfiles.get(chainId);
  if (!expected) fail(`${label}.chainId ${chainId.toString()} is outside the approved support policy`);

  const key = requireString(input.key, `${label}.key`);
  const name = requireString(input.name, `${label}.name`);
  const environment = requireString(input.environment, `${label}.environment`);
  const deploymentPhase = requireString(input.deploymentPhase, `${label}.deploymentPhase`);
  if (
    key !== expected.key
    || name !== expected.name
    || environment !== expected.environment
    || deploymentPhase !== expected.deploymentPhase
  ) {
    fail(`${label} identity does not match the approved profile for chain ${chainId.toString()}`);
  }

  const rpcEnv = requireString(input.rpcEnv, `${label}.rpcEnv`);
  if (!/^[A-Z][A-Z0-9_]*_RPC_URL$/.test(rpcEnv)) {
    fail(`${label}.rpcEnv must be an uppercase *_RPC_URL variable name`);
  }

  const explorerInput = requireRecord(input.explorer, `${label}.explorer`);
  requireExactKeys(explorerInput, ["name", "url"], `${label}.explorer`);
  const nativeInput = requireRecord(input.nativeCurrency, `${label}.nativeCurrency`);
  requireExactKeys(nativeInput, ["name", "symbol", "decimals"], `${label}.nativeCurrency`);
  const decimals = requirePositiveInteger(nativeInput.decimals, `${label}.nativeCurrency.decimals`);
  if (decimals !== 18) fail(`${label}.nativeCurrency.decimals must equal 18`);

  const observedInput = requireRecord(input.observedAt, `${label}.observedAt`);
  requireExactKeys(observedInput, ["blockNumber", "checkedAt"], `${label}.observedAt`);
  const checkedAt = requireString(observedInput.checkedAt, `${label}.observedAt.checkedAt`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt) || Number.isNaN(Date.parse(`${checkedAt}T00:00:00Z`))) {
    fail(`${label}.observedAt.checkedAt must be an ISO calendar date`);
  }

  const wrappedInput = requireRecord(input.wrappedNative, `${label}.wrappedNative`);
  requireExactKeys(wrappedInput, ["symbol", "address", "codeHash"], `${label}.wrappedNative`);
  const uniswapInput = requireRecord(input.uniswap, `${label}.uniswap`);
  requireExactKeys(uniswapInput, [
    "routerEncoding",
    "poolManager",
    "universalRouter",
    "quoter",
    "stateView",
    "positionManager",
    "permit2",
  ], `${label}.uniswap`);
  if (uniswapInput.routerEncoding !== UNIVERSAL_ROUTER_ENCODING) {
    fail(`${label}.uniswap.routerEncoding must equal ${UNIVERSAL_ROUTER_ENCODING}`);
  }

  const profile: PledgeCashNetworkProfile = {
    chainId,
    key,
    name,
    environment: environment as NetworkEnvironment,
    deploymentPhase: deploymentPhase as DeploymentPhase,
    rpcEnv,
    defaultRpcUrl: requireHttpsUrl(input.defaultRpcUrl, `${label}.defaultRpcUrl`),
    explorer: {
      name: requireString(explorerInput.name, `${label}.explorer.name`),
      url: requireHttpsUrl(explorerInput.url, `${label}.explorer.url`),
    },
    nativeCurrency: {
      name: requireString(nativeInput.name, `${label}.nativeCurrency.name`),
      symbol: requireString(nativeInput.symbol, `${label}.nativeCurrency.symbol`),
      decimals,
    },
    confirmations: requirePositiveInteger(input.confirmations, `${label}.confirmations`),
    observedAt: {
      blockNumber: requirePositiveInteger(observedInput.blockNumber, `${label}.observedAt.blockNumber`),
      checkedAt,
    },
    create2Factory: parseContractReference(input.create2Factory, `${label}.create2Factory`),
    wrappedNative: {
      symbol: requireString(wrappedInput.symbol, `${label}.wrappedNative.symbol`),
      address: requireAddress(wrappedInput.address, `${label}.wrappedNative.address`),
      codeHash: requireBytes32(wrappedInput.codeHash, `${label}.wrappedNative.codeHash`),
    },
    uniswap: {
      routerEncoding: UNIVERSAL_ROUTER_ENCODING,
      poolManager: parseContractReference(uniswapInput.poolManager, `${label}.uniswap.poolManager`),
      universalRouter: parseContractReference(uniswapInput.universalRouter, `${label}.uniswap.universalRouter`),
      quoter: parseContractReference(uniswapInput.quoter, `${label}.uniswap.quoter`),
      stateView: parseContractReference(uniswapInput.stateView, `${label}.uniswap.stateView`),
      positionManager: parseContractReference(uniswapInput.positionManager, `${label}.uniswap.positionManager`),
      permit2: parseContractReference(uniswapInput.permit2, `${label}.uniswap.permit2`),
    },
  };

  const addresses = [
    profile.create2Factory.address,
    profile.wrappedNative.address,
    profile.uniswap.poolManager.address,
    profile.uniswap.universalRouter.address,
    profile.uniswap.quoter.address,
    profile.uniswap.stateView.address,
    profile.uniswap.positionManager.address,
    profile.uniswap.permit2.address,
  ].map((address) => address.toLowerCase());
  if (new Set(addresses).size !== addresses.length) {
    fail(`${label} contract addresses must be distinct`);
  }

  return profile;
}

export function parseNetworkManifest(value: unknown): PledgeCashNetworkManifest {
  const input = requireRecord(value, "root");
  requireExactKeys(input, ["schemaVersion", "protocolVersion", "supportPolicy", "sources", "profiles"], "root");
  if (input.schemaVersion !== NETWORK_MANIFEST_SCHEMA_VERSION) {
    fail(`schemaVersion must equal ${NETWORK_MANIFEST_SCHEMA_VERSION.toString()}`);
  }
  if (input.protocolVersion !== PLEDGE_CASH_PROTOCOL_VERSION) {
    fail(`protocolVersion must equal ${PLEDGE_CASH_PROTOCOL_VERSION}`);
  }

  const supportInput = requireRecord(input.supportPolicy, "supportPolicy");
  requireExactKeys(supportInput, ["defaultChainId", "testnetChainIds", "mainnetChainIds"], "supportPolicy");
  const defaultChainId = requirePositiveInteger(supportInput.defaultChainId, "supportPolicy.defaultChainId");
  const testnetChainIds = requireIntegerArray(supportInput.testnetChainIds, "supportPolicy.testnetChainIds");
  const mainnetChainIds = requireIntegerArray(supportInput.mainnetChainIds, "supportPolicy.mainnetChainIds");
  requireExactArray(testnetChainIds, SUPPORTED_TESTNET_CHAIN_IDS, "supportPolicy.testnetChainIds");
  requireExactArray(mainnetChainIds, SUPPORTED_MAINNET_CHAIN_IDS, "supportPolicy.mainnetChainIds");
  if (defaultChainId !== SUPPORTED_TESTNET_CHAIN_IDS[0]) {
    fail(`supportPolicy.defaultChainId must equal ${SUPPORTED_TESTNET_CHAIN_IDS[0].toString()}`);
  }

  const sourcesInput = requireRecord(input.sources, "sources");
  requireExactKeys(sourcesInput, ["uniswapDeployments", "robinhoodChain"], "sources");
  const uniswapSource = requireRecord(sourcesInput.uniswapDeployments, "sources.uniswapDeployments");
  requireExactKeys(uniswapSource, ["url", "dataUrl", "repository", "commit", "generatedAt"], "sources.uniswapDeployments");
  const sourceCommit = requireString(uniswapSource.commit, "sources.uniswapDeployments.commit");
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    fail("sources.uniswapDeployments.commit must be an exact lowercase Git commit");
  }
  const generatedAt = requireString(uniswapSource.generatedAt, "sources.uniswapDeployments.generatedAt");
  if (Number.isNaN(Date.parse(generatedAt))) fail("sources.uniswapDeployments.generatedAt must be an ISO timestamp");
  const robinhoodSource = requireRecord(sourcesInput.robinhoodChain, "sources.robinhoodChain");
  requireExactKeys(robinhoodSource, ["networkUrl", "contractsUrl"], "sources.robinhoodChain");

  if (!Array.isArray(input.profiles)) fail("profiles must be an array");
  const profiles = input.profiles.map(parseProfile);
  requireExactArray(profiles.map((profile) => profile.chainId), SUPPORTED_PUBLIC_CHAIN_IDS, "profile chain order");
  if (new Set(profiles.map((profile) => profile.key)).size !== profiles.length) fail("profile keys must be unique");
  if (new Set(profiles.map((profile) => profile.rpcEnv)).size !== profiles.length) fail("profile RPC env names must be unique");

  const canonicalCreate2Address = profiles[0]?.create2Factory.address.toLowerCase();
  const canonicalCreate2Hash = profiles[0]?.create2Factory.codeHash.toLowerCase();
  if (profiles.some((profile) =>
    profile.create2Factory.address.toLowerCase() !== canonicalCreate2Address
    || profile.create2Factory.codeHash.toLowerCase() !== canonicalCreate2Hash
  )) {
    fail("every supported chain must pin the same deterministic CREATE2 factory identity");
  }

  return {
    schemaVersion: NETWORK_MANIFEST_SCHEMA_VERSION,
    protocolVersion: PLEDGE_CASH_PROTOCOL_VERSION,
    supportPolicy: { defaultChainId, testnetChainIds, mainnetChainIds },
    sources: {
      uniswapDeployments: {
        url: requireHttpsUrl(uniswapSource.url, "sources.uniswapDeployments.url"),
        dataUrl: requireHttpsUrl(uniswapSource.dataUrl, "sources.uniswapDeployments.dataUrl"),
        repository: requireHttpsUrl(uniswapSource.repository, "sources.uniswapDeployments.repository"),
        commit: sourceCommit,
        generatedAt,
      },
      robinhoodChain: {
        networkUrl: requireHttpsUrl(robinhoodSource.networkUrl, "sources.robinhoodChain.networkUrl"),
        contractsUrl: requireHttpsUrl(robinhoodSource.contractsUrl, "sources.robinhoodChain.contractsUrl"),
      },
    },
    profiles,
  };
}

export async function loadNetworkManifest(path = networkManifestPath): Promise<PledgeCashNetworkManifest> {
  return parseNetworkManifest(JSON.parse(await readFile(path, "utf8")) as unknown);
}

function isIgnoredDeploymentFile(file: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--quiet", "--", join("packages/contracts/deployments", file)], {
    cwd: repoRoot,
  });
  return result.status === 0;
}

export async function validateDeploymentCoverage(manifest: PledgeCashNetworkManifest): Promise<void> {
  const supported = new Set(manifest.profiles.map((profile) => profile.chainId));
  const files = (await readdir(deploymentsRoot)).filter((file) => /^\d+\.json$/.test(file));
  for (const file of files) {
    if (isIgnoredDeploymentFile(file)) continue;
    const chainId = Number(file.slice(0, -5));
    if (!supported.has(chainId)) {
      fail(`checked-in public deployment ${file} is outside the approved support policy`);
    }
  }

  for (const profile of manifest.profiles) {
    const file = `${profile.chainId.toString()}.json`;
    if (!files.includes(file) || isIgnoredDeploymentFile(file)) {
      fail(`supported profile ${profile.name} is missing checked-in deployment status ${file}`);
    }
    const deployment = JSON.parse(await readFile(join(deploymentsRoot, file), "utf8")) as Record<string, unknown>;
    if (deployment.chainId !== profile.chainId) fail(`${file} chainId does not match its filename`);
    if (deployment.protocolVersion !== PLEDGE_CASH_PROTOCOL_VERSION) {
      fail(`${file} protocolVersion must equal ${PLEDGE_CASH_PROTOCOL_VERSION}`);
    }
    if (deployment.status === "pending") {
      const reason = requireString(deployment.reason, `${file}.reason`).toLowerCase();
      const expectedPhrase = profile.environment === "testnet" ? "not been broadcast" : "not authorized";
      if (!reason.includes(expectedPhrase)) {
        fail(`${file} pending reason must state that the ${profile.environment} deployment is ${expectedPhrase}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const manifest = await loadNetworkManifest();
  await validateDeploymentCoverage(manifest);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({
      ok: true,
      defaultChainId: manifest.supportPolicy.defaultChainId,
      testnets: manifest.supportPolicy.testnetChainIds,
      mainnets: manifest.supportPolicy.mainnetChainIds,
      profiles: manifest.profiles.map(({ chainId, key, environment, deploymentPhase }) => ({ chainId, key, environment, deploymentPhase })),
    }, null, 2));
  } else {
    console.log(`Validated ${manifest.profiles.length.toString()} canonical public network profiles.`);
  }
}

if (import.meta.main) {
  await main();
}
