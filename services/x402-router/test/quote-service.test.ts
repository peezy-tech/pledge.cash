import { describe, expect, test } from "bun:test";
import type { MarketplaceQuote, QuoteRepository } from "../src/domain";
import { MarketplaceQuoteService } from "../src/quotes/service";

const payer = "0x00000000000000000000000000000000000000A1" as const;
const usdc = "0x00000000000000000000000000000000000000C1" as const;

function fixture(overrides: {
  allowance?: bigint;
  availableInventory?: bigint;
  refundInventory?: bigint;
  serviceFeeBps?: number;
  maxSourcePayment?: bigint;
} = {}) {
  let stored: MarketplaceQuote | undefined;
  const repository: QuoteRepository = {
    async createReserved(input) {
      stored = input.quote;
      for (const item of input.availability) {
        if (BigInt(item.reservation.amount) > item.maximumAvailableInventory) {
          throw new Error("oversubscribed");
        }
      }
      return input.quote;
    },
    async get() {
      return stored;
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
  const chain = {
    async quote(_request: unknown, deadline: number) {
      return {
        boardroom: payer,
        canonicalTarget: "0x00000000000000000000000000000000000000B1",
        destinationPrincipal: 1_000_000n,
        availableInventory: overrides.availableInventory ?? 2_000_000n,
        allowance: overrides.allowance ?? 2_000_000n,
        spender: "0x00000000000000000000000000000000000000B1",
        execution: {
          chainId: 998 as const,
          target: "0x00000000000000000000000000000000000000B1",
          callData: "0x12345678" as const,
          callDataHash: `0x${"11".repeat(32)}` as const,
          selector: "0x12345678" as const,
          value: "0" as const,
          recipient: payer,
          inputToken: usdc,
          inputAmount: "1000000",
          outputToken: "0x00000000000000000000000000000000000000D1",
          expectedOutput: "100",
          minimumOutput: "99",
          deadline,
        },
      };
    },
  };
  const paymentQuotes = {
    async build(input: { quoteId: string }) {
      return {
        intentQuote: { id: input.quoteId } as never,
        paymentRequirements: {
          scheme: "exact",
          network: "hyperliquid:testnet" as const,
          amount: "100500000",
          asset: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
          payTo: payer,
          maxTimeoutSeconds: 60,
          extra: {},
        },
        paymentRequired: {
          x402Version: 2,
          resource: {
            url: "https://router.example/v1/quotes/id/execute",
            description: "test",
            mimeType: "application/json",
          },
          accepts: [],
        },
        intentTemplateHash: `0x${"22".repeat(32)}` as const,
      };
    },
  };
  const service = new MarketplaceQuoteService(
    chain as never,
    repository,
    paymentQuotes,
    {
      async availableAtomicUsdc() {
        return overrides.refundInventory ?? 200_000_000n;
      },
    },
    {
      payTo: payer,
      serviceFeeBps: overrides.serviceFeeBps ?? 50,
      maxSourcePayment: overrides.maxSourcePayment ?? 500_000_000n,
      maxSlippageBps: 100,
      maxGasCost: 1_000_000_000_000_000n,
      quoteTtlSeconds: 60,
    },
    () => 1_700_000_000_000,
    (() => {
      let next = 0;
      return () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
    })(),
  );
  return { service, getStored: () => stored };
}

const request = {
  kind: "amm_swap" as const,
  chainId: 998 as const,
  boardroom: payer,
  payer,
  recipient: payer,
  refundAddress: payer,
  maxSlippageBps: 50,
  pool: "0x00000000000000000000000000000000000000E1" as const,
  tokenIn: usdc,
  tokenOut: "0x00000000000000000000000000000000000000D1" as const,
  amountIn: "1000000",
};

describe("MarketplaceQuoteService", () => {
  test("prices six-decimal destination USDC into eight-decimal payment plus explicit fee", async () => {
    const { service } = fixture();
    const quote = await service.create(request);
    expect(quote.sourcePayment).toMatchObject({
      principal: "100000000",
      serviceFee: "500000",
      amount: "100500000",
    });
    expect(quote.inventoryReservations.map(item => item.scope)).toEqual([
      "destination_execution",
      "source_refund",
    ]);
  });

  test("fails before payment when either inventory or allowance is insufficient", async () => {
    await expect(fixture({ allowance: 999_999n }).service.create(request))
      .rejects.toThrow("allowance");
    await expect(fixture({ availableInventory: 999_999n }).service.create(request))
      .rejects.toThrow("inventory");
    await expect(fixture({ refundInventory: 100_499_999n }).service.create(request))
      .rejects.toThrow("refund inventory");
  });

  test("enforces the configured maximum order", async () => {
    await expect(fixture({ maxSourcePayment: 100_499_999n }).service.create(request))
      .rejects.toThrow("maximum payment");
  });
});
