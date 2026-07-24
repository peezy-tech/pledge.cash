import { describe, expect, test } from "bun:test";
import { encodeFunctionData, keccak256 } from "viem";
import {
  ammRouterAbi,
} from "@pledge.cash/sdk";
import {
  createMarketplaceExecutionPolicy,
  createMarketplaceSimulation,
} from "../src/execution/policy";
import type { MarketplaceQuote, QuoteRepository } from "../src/domain";

const payer = "0x00000000000000000000000000000000000000A1" as const;
const router = "0x00000000000000000000000000000000000000B1" as const;
const usdc = "0x00000000000000000000000000000000000000C1" as const;
const shares = "0x00000000000000000000000000000000000000D1" as const;
const callData = encodeFunctionData({
  abi: ammRouterAbi,
  functionName: "swapExactTokensForTokens",
  args: [1_000_000n, 99n, [usdc, shares], payer, 1_700_000_060n],
});

function quote(): MarketplaceQuote {
  return {
    id: "quote-1",
    paymentId: "payment-00000001",
    kind: "amm_swap",
    lifecycle: "quoted",
    payer,
    recipient: payer,
    refundAddress: payer,
    boardroom: payer,
    canonicalTarget: router,
    canonicalPool: "0x00000000000000000000000000000000000000E1",
    sourcePayment: {
      network: "hyperliquid:testnet",
      asset: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
      symbol: "USDC",
      decimals: 8,
      amount: "100500000",
      principal: "100000000",
      serviceFee: "500000",
      payTo: payer,
    },
    execution: {
      chainId: 998,
      target: router,
      callData,
      callDataHash: keccak256(callData),
      selector: callData.slice(0, 10) as `0x${string}`,
      value: "0",
      recipient: payer,
      inputToken: usdc,
      inputAmount: "1000000",
      outputToken: shares,
      expectedOutput: "100",
      minimumOutput: "99",
      deadline: 1_700_000_060,
    },
    maxGasCost: "1000000000000000",
    maxSlippageBps: 50,
    intentQuote: {} as never,
    paymentRequirements: {} as never,
    paymentRequired: {} as never,
    intentTemplateHash: `0x${"11".repeat(32)}`,
    inventoryReservations: [],
    expiresAt: new Date(1_700_000_060_000),
    createdAt: new Date(1_700_000_000_000),
  };
}

const repository: QuoteRepository = {
  async createReserved(input) {
    return input.quote;
  },
  async get(id) {
    return id === "quote-1" ? quote() : undefined;
  },
  async bindPaymentPayload(input) {
    return { ...input, boundAt: new Date() };
  },
  async getPaymentBinding() {
    return undefined;
  },
  async listPaymentBindingsWithoutOrder() {
    return [];
  },
  async releaseExpired() {
    return 0;
  },
  async commitReservations() {},
  async finalizeExecution() {},
  async finalizeRefund() {},
  async finalizeSettlementFailure() {},
  async releaseQuotedReservations() {},
  async reservedInventory() {
    return 0n;
  },
};

const canonical = {
  async assertCanonicalExecution() {},
};

function context(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: "intent",
    record: { quoteId: "quote-1" },
    intent: {
      quoteId: "quote-1",
      user: payer,
      recipient: payer,
      refundAddress: payer,
      chainId: 998,
      target: router,
      callData,
      value: "0",
      maxGasCost: "1000000000000000",
      maxSlippageBps: 50,
      deadline: 1_700_000_060,
      ...overrides,
    },
  } as never;
}

describe("canonical execution policy", () => {
  test("binds the exact stored canonical call", async () => {
    const policy = await createMarketplaceExecutionPolicy(
      repository,
      canonical,
    )(context());
    expect(policy).toMatchObject({
      allowed: true,
      chainId: 998,
      target: router,
      recipient: payer,
      callDataHash: keccak256(callData),
    });
  });

  test("rejects target, calldata, and party substitutions", async () => {
    const policy = createMarketplaceExecutionPolicy(repository, canonical);
    await expect(policy(context({ target: shares }))).resolves.toEqual({ allowed: false });
    await expect(policy(context({ callData: "0x12345678" }))).resolves.toEqual({ allowed: false });
    await expect(policy(context({ refundAddress: shares }))).resolves.toEqual({ allowed: false });
  });

  test("fails closed when live canonical relationships cannot be revalidated", async () => {
    const unavailable = createMarketplaceExecutionPolicy(repository, undefined);
    await expect(unavailable(context())).resolves.toEqual({ allowed: false });

    const changed = createMarketplaceExecutionPolicy(repository, {
      async assertCanonicalExecution() {
        throw new Error("pool registration changed");
      },
    });
    await expect(changed(context())).resolves.toEqual({ allowed: false });
  });

  test("binds the padded gas and exact EIP-1559 fee tuple into simulation", async () => {
    let simulatedTransaction: Record<string, unknown> | undefined;
    const client = {
      async call(input: Record<string, unknown>) {
        simulatedTransaction = input;
        return { data: "0x" };
      },
      async estimateGas() {
        return 21_001n;
      },
      async estimateFeesPerGas() {
        return {
          maxFeePerGas: 100n,
          maxPriorityFeePerGas: 7n,
        };
      },
      async readContract() {
        return [1_000_000n, 100n];
      },
    };
    const policy = await createMarketplaceExecutionPolicy(
      repository,
      canonical,
    )(context());
    if (!policy.allowed) throw new Error("expected policy to allow fixture");
    const simulation = await createMarketplaceSimulation(
      client as never,
      payer,
      repository,
    )(context(), policy);
    expect(simulation).toEqual({
      success: true,
      chainId: 998,
      target: router,
      callDataHash: keccak256(callData),
      value: "0",
      recipient: payer,
      gasCost: "2520200",
      slippageBps: 0,
      metadata: {
        transactionType: "eip1559",
        gas: "25202",
        maxFeePerGas: "100",
        maxPriorityFeePerGas: "7",
      },
    });
    expect(simulatedTransaction).toMatchObject({
      gas: 25_202n,
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 7n,
    });
  });
});
