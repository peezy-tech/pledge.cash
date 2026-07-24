import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "viem";
import {
  createRecurringSupportInvoiceQuote,
  loadRecurringSupportSubscriptionId,
  publishRecurringSupportPlan,
  recurringSupportExpectations,
  recurringSupportQuoteRequest,
  saveRecurringSupportSubscription,
  type RecurringSupportSubscriptionView,
} from "../src/lib/recurring-support";
import type {
  HyperliquidMarketplaceQuote,
  RecurringSupportQuoteRequest,
  X402RouterConfig,
} from "../src/lib/x402-router";

const boardroom =
  "0x1000000000000000000000000000000000000000" as Address;
const payer =
  "0x2000000000000000000000000000000000000000" as Address;
const usdc =
  "0x3000000000000000000000000000000000000000" as Address;
const gateway =
  "0x4000000000000000000000000000000000000000" as Address;
const payTo =
  "0x5000000000000000000000000000000000000000" as Address;
const planId = "00000000-0000-4000-8000-000000000001";
const subscriptionId = "00000000-0000-4000-8000-000000000002";
const invoiceId = "00000000-0000-4000-8000-000000000003";
const deadline = 4_102_444_800;

const config: X402RouterConfig = {
  application: "api.pledge.cash/x402-router/v1/execute",
  baseUrl: "https://router.example",
  gateway,
  hyperevmUsdc: usdc,
};

function view(): RecurringSupportSubscriptionView {
  return {
    plan: {
      id: planId,
      chainId: 998,
      boardroom,
      asset: usdc,
      amount: "10000000",
      cadence: "monthly",
      title: "Core support",
      description: "Keep the project operating.",
      termsHash: `0x${"11".repeat(32)}` as Hex,
      status: "active",
      authority: boardroom,
      authorityMode: "launched_controller",
      createdAt: "2026-01-31T15:45:00.000Z",
    },
    subscription: {
      id: subscriptionId,
      planId,
      payer,
      status: "active",
      startedAt: "2026-01-31T15:45:00.000Z",
      createdAt: "2026-01-31T15:45:00.000Z",
    },
    invoice: {
      id: invoiceId,
      subscriptionId,
      planId,
      periodIndex: 0,
      periodStart: "2026-01-31T15:45:00.000Z",
      periodEnd: "2026-02-28T15:45:00.000Z",
      dueAt: "2026-01-31T15:45:00.000Z",
      payer,
      boardroom,
      asset: usdc,
      amount: "10000000",
      status: "open",
    },
  };
}

function request(): RecurringSupportQuoteRequest {
  const value = recurringSupportQuoteRequest(view());
  if (!value) throw new Error("expected quote request");
  return value;
}

function quote(
  overrides: Partial<HyperliquidMarketplaceQuote> = {},
): HyperliquidMarketplaceQuote {
  return {
    execution: {
      callDataHash: `0x${"22".repeat(32)}`,
      chainId: 998,
      deadline,
      expectedOutput: "10000000",
      inputAmount: "10000000",
      inputToken: usdc,
      minimumOutput: "10000000",
      outputToken: usdc,
      recipient: payer,
      selector: "0xa9059cbb",
      target: usdc,
    },
    expiresAt: new Date(deadline * 1_000).toISOString(),
    kind: "recurring_support",
    orderId: "quote-recurring-123456",
    payer,
    payment: {
      amount: "1000000000",
      asset: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
      decimals: 8,
      network: "hyperliquid:testnet",
      payTo,
      principal: "1000000000",
      serviceFee: "0",
      symbol: "USDC",
    },
    paymentId: "payment-recurring-123456",
    quoteId: "quote-recurring-123456",
    recipient: payer,
    refundAddress: payer,
    supportInvoiceId: invoiceId,
    ...overrides,
  };
}

describe("recurring support browser boundary", () => {
  test("derives an exact no-slippage invoice request", () => {
    expect(request()).toEqual({
      amount: "10000000",
      boardroom,
      chainId: 998,
      invoiceId,
      kind: "recurring_support",
      maxSlippageBps: 0,
      payer,
      recipient: payer,
      refundAddress: payer,
    });
    expect(recurringSupportExpectations(view())).toEqual({
      inputToken: usdc,
      outputToken: usdc,
      target: usdc,
    });
  });

  test("accepts a quote only when it preserves the invoice identity and amount", async () => {
    const fetch = async () =>
      new Response(JSON.stringify(quote()), {
        headers: { "content-type": "application/json" },
        status: 201,
      });
    await expect(
      createRecurringSupportInvoiceQuote(
        { config, walletClient: () => { throw new Error("unused"); } },
        request(),
        recurringSupportExpectations(view())!,
        { fetch: fetch as typeof globalThis.fetch },
      ),
    ).resolves.toMatchObject({
      kind: "recurring_support",
      supportInvoiceId: invoiceId,
    });

    const changed = async () =>
      new Response(JSON.stringify(quote({
        supportInvoiceId: "00000000-0000-4000-8000-000000000099",
      })), {
        headers: { "content-type": "application/json" },
        status: 201,
      });
    await expect(
      createRecurringSupportInvoiceQuote(
        { config, walletClient: () => { throw new Error("unused"); } },
        request(),
        recurringSupportExpectations(view())!,
        { fetch: changed as typeof globalThis.fetch },
      ),
    ).rejects.toThrow("changed the support invoice");
  });

  test("stores only the opaque subscription identity locally", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    };
    saveRecurringSupportSubscription(storage, config, view());
    expect(
      loadRecurringSupportSubscriptionId(
        storage,
        config,
        boardroom,
        payer,
        planId,
      ),
    ).toBe(subscriptionId);
    expect([...values.values()][0]).toBe(
      JSON.stringify({ id: subscriptionId, version: 1 }),
    );
  });

  test("rejects a changed support challenge before asking the wallet to sign", async () => {
    let signatures = 0;
    const fetch = async () =>
      new Response(JSON.stringify({
        action: "subscription_create",
        actor: payer,
        boardroom,
        chainId: 998,
        challengeId: "00000000-0000-4000-8000-000000000010",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        message: "changed action",
        payload: {},
        payloadHash: `0x${"00".repeat(32)}`,
        planId: "00000000-0000-4000-8000-000000000011",
      }), {
        headers: { "content-type": "application/json" },
        status: 201,
      });
    await expect(publishRecurringSupportPlan(
      {
        config,
        walletClient: () => ({
          account: { address: payer },
          async signMessage() {
            signatures += 1;
            return `0x${"11".repeat(65)}`;
          },
        } as never),
      },
      {
        amount: "10000000",
        boardroom,
        cadence: "monthly",
        chainId: 998,
        description: "Keep the project operating.",
        title: "Core support",
      },
      { fetch: fetch as typeof globalThis.fetch },
    )).rejects.toThrow("changed the requested support action");
    expect(signatures).toBe(0);
  });
});
