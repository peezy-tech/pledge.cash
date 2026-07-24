import type { IntentSimulationResult } from "x402-hl/intents/server";

const DECIMAL_INTEGER = /^(0|[1-9][0-9]*)$/;
const GAS_PADDING_NUMERATOR = 120n;
const GAS_PADDING_DENOMINATOR = 100n;

export type Eip1559TransactionEnvelope = {
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  gasCost: bigint;
};

export function buildEip1559TransactionEnvelope(input: {
  estimatedGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}): Eip1559TransactionEnvelope {
  if (input.estimatedGas <= 0n) {
    throw new Error("Estimated gas must be positive.");
  }
  if (input.maxFeePerGas <= 0n) {
    throw new Error("Maximum fee per gas must be positive.");
  }
  if (
    input.maxPriorityFeePerGas < 0n ||
    input.maxPriorityFeePerGas > input.maxFeePerGas
  ) {
    throw new Error("Priority fee per gas is outside the EIP-1559 fee bound.");
  }
  const gas =
    (input.estimatedGas * GAS_PADDING_NUMERATOR +
      GAS_PADDING_DENOMINATOR -
      1n) /
    GAS_PADDING_DENOMINATOR;
  return {
    gas,
    maxFeePerGas: input.maxFeePerGas,
    maxPriorityFeePerGas: input.maxPriorityFeePerGas,
    gasCost: gas * input.maxFeePerGas,
  };
}

export function simulationMetadata(
  envelope: Eip1559TransactionEnvelope,
): Record<string, string> {
  return {
    transactionType: "eip1559",
    gas: envelope.gas.toString(),
    maxFeePerGas: envelope.maxFeePerGas.toString(),
    maxPriorityFeePerGas: envelope.maxPriorityFeePerGas.toString(),
  };
}

export function readSimulationTransactionEnvelope(
  simulation: Extract<IntentSimulationResult, { success: true }>,
): Eip1559TransactionEnvelope {
  const metadata = simulation.metadata;
  if (
    metadata?.transactionType !== "eip1559" ||
    typeof metadata.gas !== "string" ||
    typeof metadata.maxFeePerGas !== "string" ||
    typeof metadata.maxPriorityFeePerGas !== "string"
  ) {
    throw new Error("Simulation is missing the exact EIP-1559 transaction tuple.");
  }
  const gas = parseDecimal(metadata.gas, "gas");
  const maxFeePerGas = parseDecimal(metadata.maxFeePerGas, "maxFeePerGas");
  const maxPriorityFeePerGas = parseDecimal(
    metadata.maxPriorityFeePerGas,
    "maxPriorityFeePerGas",
  );
  const gasCost = parseDecimal(simulation.gasCost, "gasCost");
  if (gas <= 0n || maxFeePerGas <= 0n || maxPriorityFeePerGas > maxFeePerGas) {
    throw new Error("Simulation returned an invalid EIP-1559 transaction tuple.");
  }
  if (gasCost !== gas * maxFeePerGas) {
    throw new Error("Simulation gas cost does not bind its EIP-1559 tuple.");
  }
  return {
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasCost,
  };
}

function parseDecimal(value: string, label: string): bigint {
  if (!DECIMAL_INTEGER.test(value)) {
    throw new Error(`Simulation ${label} must be a canonical decimal integer.`);
  }
  return BigInt(value);
}
