import { describe, expect, test } from "bun:test";
import {
  ammRouterAbi,
  fixedPriceSaleAbi,
} from "@pledge.cash/sdk";
import { encodeFunctionData, keccak256 } from "viem";
import type { MarketplaceQuote } from "../src/domain";
import {
  CanonicalMarketplaceReader,
  CanonicalRouteError,
} from "../src/quotes/canonical";

const ammFactory = "0x0000000000000000000000000000000000000011" as const;
const ammRouter = "0x0000000000000000000000000000000000000012" as const;
const distributionFactory = "0x0000000000000000000000000000000000000013" as const;
const boardroomFactory = "0x0000000000000000000000000000000000000016" as const;
const usdc = "0x0000000000000000000000000000000000000014" as const;
const executor = "0x0000000000000000000000000000000000000015" as const;
const boardroom = "0x0000000000000000000000000000000000000021" as const;
const shares = "0x0000000000000000000000000000000000000022" as const;
const pool = "0x0000000000000000000000000000000000000023" as const;
const sale = "0x0000000000000000000000000000000000000024" as const;
const payer = "0x0000000000000000000000000000000000000031" as const;

function baseQuote(input: {
  kind: "amm_swap" | "fixed_price_sale";
  target: typeof ammRouter | typeof sale;
  callData: `0x${string}`;
  inputAmount: string;
  outputAmount: string;
}): MarketplaceQuote {
  return {
    id: "quote-live",
    paymentId: "payment-live",
    kind: input.kind,
    lifecycle: "paid",
    payer,
    recipient: payer,
    refundAddress: payer,
    boardroom,
    canonicalTarget: input.target,
    ...(input.kind === "amm_swap" ? { canonicalPool: pool } : {}),
    sourcePayment: {
      network: "hyperliquid:testnet",
      asset: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
      symbol: "USDC",
      decimals: 8,
      amount: "100000000",
      principal: "100000000",
      serviceFee: "0",
      payTo: payer,
    },
    execution: {
      chainId: 998,
      target: input.target,
      callData: input.callData,
      callDataHash: keccak256(input.callData),
      selector: input.callData.slice(0, 10) as `0x${string}`,
      value: "0",
      recipient: payer,
      inputToken: usdc,
      inputAmount: input.inputAmount,
      outputToken: shares,
      expectedOutput: input.outputAmount,
      minimumOutput: input.outputAmount,
      deadline: Math.floor(Date.now() / 1_000) + 60,
    },
    maxGasCost: "1000000000000000",
    maxSlippageBps: 50,
    intentQuote: {} as never,
    paymentRequirements: {} as never,
    paymentRequired: {} as never,
    intentTemplateHash: `0x${"11".repeat(32)}`,
    inventoryReservations: [],
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  };
}

function ammQuote(): MarketplaceQuote {
  const callData = encodeFunctionData({
    abi: ammRouterAbi,
    functionName: "swapExactTokensForTokens",
    args: [1_000_000n, 100n, [usdc, shares], payer, BigInt(Math.floor(Date.now() / 1_000) + 60)],
  });
  return baseQuote({
    kind: "amm_swap",
    target: ammRouter,
    callData,
    inputAmount: "1000000",
    outputAmount: "100",
  });
}

function fixedPriceQuote(): MarketplaceQuote {
  const callData = encodeFunctionData({
    abi: fixedPriceSaleAbi,
    functionName: "buy",
    args: [100n, payer, 1_000_000n, BigInt(Math.floor(Date.now() / 1_000) + 60)],
  });
  return baseQuote({
    kind: "fixed_price_sale",
    target: sale,
    callData,
    inputAmount: "1000000",
    outputAmount: "100",
  });
}

function reader(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    liquidityRouter: ammRouter,
    isPool: true,
    isBoardroom: true,
    getPool: pool,
    shareToken: shares,
    status: 0,
    isDistribution: true,
    distributionKind: 0,
    distributionBoardroom: boardroom,
    factory: distributionFactory,
    boardroom,
    paymentToken: usdc,
    maxPerBuyer: 0n,
    remainingShares: 1_000n,
    saleStatus: 0,
    startTime: 0n,
    endTime: 0n,
    getPaymentAmount: 1_000_000n,
    ...overrides,
  };
  const client = {
    async getChainId() {
      return 998;
    },
    async getCode() {
      return "0x01";
    },
    async readContract(input: { functionName: string }) {
      return values[input.functionName];
    },
  };
  return new CanonicalMarketplaceReader(client as never, {
    chainId: 998,
    ammFactory,
    ammRouter,
    distributionFactory,
    boardroomFactory,
    destinationUsdc: usdc,
    executor,
  });
}

describe("live canonical execution validation", () => {
  test("accepts the unchanged canonical AMM and rejects a deregistered pool", async () => {
    await expect(reader().assertCanonicalExecution(ammQuote())).resolves.toBeUndefined();
    await expect(
      reader({ isPool: false }).assertCanonicalExecution(ammQuote()),
    ).rejects.toBeInstanceOf(CanonicalRouteError);
  });

  test("accepts the unchanged fixed sale and rejects a changed factory mapping", async () => {
    await expect(
      reader().assertCanonicalExecution(fixedPriceQuote()),
    ).resolves.toBeUndefined();
    await expect(
      reader({
        distributionBoardroom:
          "0x00000000000000000000000000000000000000ff",
      }).assertCanonicalExecution(fixedPriceQuote()),
    ).rejects.toBeInstanceOf(CanonicalRouteError);
  });
});
