import type { Address, PledgeCashDeployment } from "@pledge.cash/sdk";

const STRING_DEPLOYMENT_FIELDS = [
  "status",
  "reason",
  "protocolVersion",
  "releaseCodeHash",
  "sourceCommit",
  "manifestHash",
  "boardroomArchitectureCodeHash",
  "moduleArchitectureCodeHash",
  "deterministicDeployerCodeHash",
  "protocolFeeRouterCodeHash",
  "boardroomFactoryCodeHash",
  "boardroomImplementationCodeHash",
  "tokenGrantFactoryCodeHash",
  "tokenGrantLogicCodeHash",
  "liquidityLockerFactoryCodeHash",
  "uniswapV4PoolManagerCodeHash",
  "uniswapUniversalRouterCodeHash",
  "uniswapV4QuoterCodeHash",
  "uniswapV4StateViewCodeHash",
  "uniswapV4PositionManagerCodeHash",
  "permit2CodeHash",
  "wrappedNativeCodeHash",
] as const;

const ADDRESS_DEPLOYMENT_FIELDS = [
  "deterministicDeployer",
  "deterministicDeployerOwner",
  "create2Factory",
  "boardroomFactory",
  "boardroomImplementation",
  "protocolFeeRouter",
  "uniswapV4PoolManager",
  "uniswapUniversalRouter",
  "uniswapV4Quoter",
  "uniswapV4StateView",
  "uniswapV4PositionManager",
  "permit2",
  "liquidityLockerFactory",
  "tokenGrantFactory",
  "tokenGrantLogic",
  "wrappedNative",
  "protocolOwner",
  "protocolTreasury",
] as const;

const BIGINT_DEPLOYMENT_FIELDS = ["creationFee", "deploymentBlock"] as const;
const JSON_PRIMITIVE_TOKEN_PATTERN = '"([^"\\\\]|\\\\.)*"|-?\\d+|true|false|null';

export function deploymentText(deployment: PledgeCashDeployment | undefined): string {
  if (!deployment) return "{}";
  return JSON.stringify(deployment, (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2);
}

export function parseDeployment(raw: string): PledgeCashDeployment {
  const json = JSON.parse(raw) as Record<string, unknown>;
  const deployment: PledgeCashDeployment = { chainId: Number(json.chainId) };
  applyStringFields(deployment, json);
  applyAddressFields(deployment, json);
  applyBigintFields(deployment, raw);
  return deployment;
}

function applyStringFields(deployment: PledgeCashDeployment, json: Record<string, unknown>): void {
  for (const field of STRING_DEPLOYMENT_FIELDS) {
    if (typeof json[field] === "string") deployment[field] = json[field];
  }
}

function applyAddressFields(deployment: PledgeCashDeployment, json: Record<string, unknown>): void {
  for (const field of ADDRESS_DEPLOYMENT_FIELDS) {
    if (typeof json[field] === "string") deployment[field] = json[field] as Address;
  }
}

function applyBigintFields(deployment: PledgeCashDeployment, raw: string): void {
  for (const field of BIGINT_DEPLOYMENT_FIELDS) {
    const value = bigintField(raw, field);
    if (value !== undefined) deployment[field] = value;
  }
}

function bigintField(raw: string, key: string): bigint | undefined {
  const token = propertyToken(raw, key);
  if (!token || token === "null") return undefined;
  return token.startsWith('"') ? BigInt(JSON.parse(token) as string) : BigInt(token);
}

function propertyToken(raw: string, key: string): string | undefined {
  return raw.match(new RegExp(`"${key}"\\s*:\\s*(${JSON_PRIMITIVE_TOKEN_PATTERN})`))?.[1];
}
