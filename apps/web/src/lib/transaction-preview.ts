import { encodeFunctionData, type Hex } from "viem";

type EncodableCallRequest = {
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

export function contractCallPreview(label: string, request: Record<string, unknown>): string {
  const target = stringField(request, "address") ?? "unknown";
  const functionName = stringField(request, "functionName") ?? "unknown";
  const value = bigintField(request, "value") ?? 0n;
  const data = encodedCallData(request);

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
