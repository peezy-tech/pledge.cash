import { encodeFunctionData, type Hex } from "viem";

export function contractCallPreview(label: string, request: Record<string, unknown>): string {
  const target = typeof request.address === "string" ? request.address : "unknown";
  const functionName = typeof request.functionName === "string" ? request.functionName : "unknown";
  const value = typeof request.value === "bigint" ? request.value : 0n;
  const data = encodedCallData(request);

  return `${label} call target=${target} function=${functionName} value=${value.toString()} data=${data}`;
}

function encodedCallData(request: Record<string, unknown>): Hex | "unavailable" {
  if (!request.abi || typeof request.functionName !== "string") return "unavailable";

  try {
    const encode = encodeFunctionData as unknown as (parameters: {
      abi: readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
    }) => Hex;
    return encode({
      abi: request.abi as readonly unknown[],
      functionName: request.functionName,
      args: Array.isArray(request.args) ? request.args : [],
    });
  } catch {
    return "unavailable";
  }
}
