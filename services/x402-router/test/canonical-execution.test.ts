import { describe, expect, test } from "bun:test";
import {
  ammRouterAbi,
  boardroomAbi,
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
  kind: "amm_swap" | "fixed_price_sale" | "recurring_support";
  target: typeof ammRouter | typeof sale | typeof boardroom;
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
    ...(input.kind === "recurring_support"
      ? { supportInvoiceId: "00000000-0000-4000-8000-000000000001" }
      : {}),
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
      outputToken: input.kind === "recurring_support" ? usdc : shares,
      expectedOutput: input.outputAmount,
      minimumOutput: input.outputAmount,
      deadline: Math.floor(Date.now() / 1_000) + 60,
    },
    maxGasCost: "1000000000000000",
    maxSlippageBps: input.kind === "recurring_support" ? 0 : 50,
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

function recurringSupportQuote(): MarketplaceQuote {
  const deadline = Math.floor(Date.now() / 1_000) + 60;
  const callData = encodeFunctionData({
    abi: boardroomAbi,
    functionName: "contributeTreasuryAsset",
    args: [usdc, 1_000_000n, BigInt(deadline)],
  });
  const quote = baseQuote({
    kind: "recurring_support",
    target: boardroom,
    callData,
    inputAmount: "1000000",
    outputAmount: "1000000",
  });
  return {
    ...quote,
    execution: {
      ...quote.execution,
      deadline,
    },
  };
}

function reader(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    liquidityRouter: ammRouter,
    isPool: true,
    isBoardroom: true,
    getPool: pool,
    shareToken: shares,
    status: 0,
    isRedeemableAsset: true,
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
    balanceOf: 2_000_000n,
    allowance: 2_000_000n,
    blockTimestamp: 1_800_000_000n,
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
    async getBlock(input: { blockTag: string }) {
      expect(input).toEqual({ blockTag: "latest" });
      return { timestamp: values.blockTimestamp };
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

  test("uses the latest HyperEVM block time to revalidate the fixed-sale window", async () => {
    const futureWindow = {
      startTime: 4_000_000_000n,
      endTime: 5_000_000_000n,
    };

    await expect(
      reader({
        ...futureWindow,
        blockTimestamp: 4_500_000_000n,
      }).assertCanonicalExecution(fixedPriceQuote()),
    ).resolves.toBeUndefined();
    await expect(
      reader({
        ...futureWindow,
        blockTimestamp: 5_000_000_001n,
      }).assertCanonicalExecution(fixedPriceQuote()),
    ).rejects.toMatchObject({
      code: "fixed_price_configuration_mismatch",
    });
  });

  test("accepts only an Active canonical Boardroom with registered USDC", async () => {
    await expect(
      reader().assertCanonicalExecution(recurringSupportQuote()),
    ).resolves.toBeUndefined();
    await expect(
      reader({ isRedeemableAsset: false }).assertCanonicalExecution(
        recurringSupportQuote(),
      ),
    ).rejects.toMatchObject({ code: "support_route_unavailable" });
  });
});

describe("canonical recurring-support quoting", () => {
  test("builds one deadline-bound Boardroom contribution with caller allowance", async () => {
    const result = await reader().quote({
      kind: "recurring_support",
      chainId: 998,
      boardroom,
      payer,
      recipient: payer,
      refundAddress: payer,
      maxSlippageBps: 0,
      invoiceId: "00000000-0000-4000-8000-000000000001",
      amount: "1000000",
    }, 1_800_000_060);

    expect(result).toMatchObject({
      canonicalTarget: boardroom,
      destinationPrincipal: 1_000_000n,
      availableInventory: 2_000_000n,
      allowance: 2_000_000n,
      spender: boardroom,
    });
    expect(
      encodeFunctionData({
        abi: boardroomAbi,
        functionName: "contributeTreasuryAsset",
        args: [usdc, 1_000_000n, 1_800_000_060n],
      }),
    ).toBe(result.execution.callData);
  });
});

describe("canonical fixed-price quoting", () => {
  test("uses the latest HyperEVM block time to check the sale window", async () => {
    const request = {
      kind: "fixed_price_sale" as const,
      chainId: 998 as const,
      boardroom,
      payer,
      recipient: payer,
      refundAddress: payer,
      maxSlippageBps: 50,
      sale,
      shareAmount: "100",
    };
    const futureWindow = {
      startTime: 4_000_000_000n,
      endTime: 5_000_000_000n,
    };

    await expect(
      reader({
        ...futureWindow,
        blockTimestamp: 4_500_000_000n,
      }).quote(request, 4_500_000_060),
    ).resolves.toMatchObject({
      canonicalTarget: sale,
      destinationPrincipal: 1_000_000n,
    });
    await expect(
      reader({
        ...futureWindow,
        blockTimestamp: 5_000_000_001n,
      }).quote(request, 5_000_000_061),
    ).rejects.toMatchObject({
      code: "sale_not_open",
    });
  });
});
