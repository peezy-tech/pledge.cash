import type { Address, PledgeCashDeployment } from "@pledge.cash/sdk";

export function deploymentText(deployment: PledgeCashDeployment | undefined): string {
  if (!deployment) return "{}";
  return JSON.stringify(deployment, (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2);
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
  for (const field of ["status", "reason", "boardroomStatus", "boardroomReason"] as const) {
    if (typeof json[field] === "string") {
      deployment[field] = json[field];
    }
  }
}

function applyAddressFields(deployment: PledgeCashDeployment, json: Record<string, unknown>): void {
  for (const field of [
    "boardroomFactory",
    "boardroomPolicyRegistry",
    "assetPolicy",
    "distributionFactory",
    "ammFactory",
    "ammProtocolFeeRecipient",
    "ammRouter",
    "lockedLiquidityFactory",
    "tokenGrantFactory",
    "tokenGrantLogic",
    "wrappedNative",
    "deployer",
    "factoryOwner",
    "policyRegistryOwner",
    "assetPolicyOwner",
  ] as const) {
    if (typeof json[field] === "string") {
      deployment[field] = json[field] as Address;
    }
  }
}

function applyBooleanFields(deployment: PledgeCashDeployment, json: Record<string, unknown>): void {
  for (const field of [
    "tokenGrantPolicyAllowed",
    "distributionPolicyAllowed",
    "lockedLiquidityPolicyAllowed",
    "assetPolicyAllowed",
    "assetWrappedNativeAllowed",
    "assetTokenGrantSpenderAllowed",
    "assetDistributionSpenderAllowed",
    "assetLockedLiquiditySpenderAllowed",
  ] as const) {
    if (typeof json[field] === "boolean") {
      deployment[field] = json[field];
    }
  }
}

function applyBigintFields(deployment: PledgeCashDeployment, raw: string): void {
  const creationFee = bigintField(raw, "creationFee");
  if (creationFee !== undefined) {
    deployment.creationFee = creationFee;
  }

  const deploymentTimestamp = bigintField(raw, "deploymentTimestamp");
  if (deploymentTimestamp !== undefined) {
    deployment.deploymentTimestamp = deploymentTimestamp;
  }
}

function bigintField(raw: string, key: string): bigint | undefined {
  const token = propertyToken(raw, key);
  if (!token || token === "null") return undefined;
  if (token.startsWith('"')) return BigInt(JSON.parse(token) as string);
  return BigInt(token);
}

function propertyToken(raw: string, key: string): string | undefined {
  const match = raw.match(new RegExp(`"${key}"\\s*:\\s*("([^"\\\\]|\\\\.)*"|-?\\d+|true|false|null)`));
  return match?.[1];
}
