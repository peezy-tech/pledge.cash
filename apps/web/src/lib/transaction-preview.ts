import { encodeFunctionData, type Address, type Hex } from "viem";

type EncodableCallRequest = {
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

export type ContractCallReview = {
  data: Hex | "unavailable";
  functionName: string;
  label: string;
  parameters: { name: string; type: string; value: string }[];
  risk: "routine" | "important" | "irreversible";
  target: Address | "unknown";
  value: bigint;
};

export function contractCallReview(label: string, request: Record<string, unknown>): ContractCallReview {
  const functionName = stringField(request, "functionName") ?? "unknown";
  return {
    data: encodedCallData(request),
    functionName,
    label,
    parameters: callParameters(request, functionName),
    risk: transactionRisk(functionName),
    target: (stringField(request, "address") as Address | undefined) ?? "unknown",
    value: bigintField(request, "value") ?? 0n,
  };
}

function callParameters(
  request: Record<string, unknown>,
  functionName: string,
): { name: string; type: string; value: string }[] {
  const abi = Array.isArray(request.abi) ? request.abi : [];
  const item = abi.find((candidate): candidate is { inputs?: unknown[]; name: string; type: string } => {
    if (!candidate || typeof candidate !== "object") return false;
    const record = candidate as Record<string, unknown>;
    return record.type === "function" && record.name === functionName;
  });
  const inputs = Array.isArray(item?.inputs) ? item.inputs : [];
  const args = Array.isArray(request.args) ? request.args : [];

  return inputs.map((input, index) => {
    const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
    return {
      name: typeof record.name === "string" && record.name ? record.name : `Argument ${index + 1}`,
      type: typeof record.type === "string" ? record.type : "unknown",
      value: formatParameterValue(args[index]),
    };
  });
}

function formatParameterValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const preview = value.slice(0, 3).map((item) => shortenParameterValue(formatParameterValue(item))).join(", ");
    return value.length > 3 ? `${preview}, … (${value.length.toString()} items)` : `[${preview}]`;
  }
  if (value === null || value === undefined) return "Not supplied";
  try {
    return JSON.stringify(value, (_, nested) => typeof nested === "bigint" ? nested.toString() : nested);
  } catch {
    return String(value);
  }
}

function shortenParameterValue(value: string): string {
  return value.length > 48 ? `${value.slice(0, 45)}…` : value;
}

function transactionRisk(functionName: string): ContractCallReview["risk"] {
  if (["launch", "startWindDown", "openRedemptions", "burnTreasuryShares"].includes(functionName)) {
    return "irreversible";
  }
  if (["approve", "setApprovalForAll", "execute", "executeBatch", "queueAction", "queueBatch", "redeem"].includes(functionName)) {
    return "important";
  }
  return "routine";
}

export function contractCallPreview(label: string, request: Record<string, unknown>): string {
  const { data, functionName, target, value } = contractCallReview(label, request);

  return `${label} call target=${target} function=${functionName} value=${value.toString()} data=${data}`;
}

function encodedCallData(request: Record<string, unknown>): Hex | "unavailable" {
  const call = encodableCallRequest(request);
  if (!call) return "unavailable";

  try {
    const encode = encodeFunctionData as unknown as (parameters: EncodableCallRequest) => Hex;
    return encode(call);
  } catch {
    return "unavailable";
  }
}

function encodableCallRequest(request: Record<string, unknown>): EncodableCallRequest | undefined {
  if (!request.abi || typeof request.functionName !== "string") return undefined;
  return {
    abi: request.abi as readonly unknown[],
    functionName: request.functionName,
    args: Array.isArray(request.args) ? request.args : [],
  };
}

function stringField(request: Record<string, unknown>, key: string): string | undefined {
  const value = request[key];
  return typeof value === "string" ? value : undefined;
}

function bigintField(request: Record<string, unknown>, key: string): bigint | undefined {
  const value = request[key];
  return typeof value === "bigint" ? value : undefined;
}
