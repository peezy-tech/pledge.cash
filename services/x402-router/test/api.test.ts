import { describe, expect, test } from "bun:test";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import type { PaymentPayload, SettleResponse } from "@x402/core/types";
import {
  createRouterApi,
  type RouterApiDependencies,
} from "../src/api/server";
import type { MarketplaceQuote, QuoteRepository } from "../src/domain";
import { X402PaymentError } from "../src/x402/server";

const payer = "0x00000000000000000000000000000000000000A1" as const;

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
    canonicalTarget: payer,
    sourcePayment: {
      network: "hyperliquid:testnet",
      asset: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
      symbol: "USDC",
      decimals: 8,
      amount: "100000000",
      principal: "99500000",
      serviceFee: "500000",
      payTo: payer,
    },
    execution: {
      chainId: 998,
      target: payer,
      callData: "0x12345678",
      callDataHash: `0x${"11".repeat(32)}`,
      selector: "0x12345678",
      value: "0",
      recipient: payer,
      inputToken: payer,
      inputAmount: "995000",
      outputToken: "0x00000000000000000000000000000000000000B1",
      expectedOutput: "100",
      minimumOutput: "99",
      deadline: Math.floor(Date.now() / 1_000) + 60,
    },
    maxGasCost: "1",
    maxSlippageBps: 50,
    intentQuote: {} as never,
    paymentRequirements: {
      scheme: "exact",
      network: "hyperliquid:testnet",
      amount: "100000000",
      asset: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
      payTo: payer,
      maxTimeoutSeconds: 60,
      extra: {},
    },
    paymentRequired: {
      x402Version: 2,
      resource: {
        url: "https://router.example/v1/quotes/quote-1/execute",
        description: "Execute",
        mimeType: "application/json",
      },
      accepts: [],
    },
    intentTemplateHash: `0x${"22".repeat(32)}`,
    inventoryReservations: [],
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  };
}

function app(options: {
  acceptingPayments?: boolean;
  boundPayment?: boolean;
  funded?: boolean;
  paymentAttempt?: {
    status: "prepared" | "settled" | "failed";
    settlement?: SettleResponse;
  };
  paymentError?: Error;
  onReleaseQuotedReservations?: () => void;
  storedQuote?: MarketplaceQuote;
  support?: RouterApiDependencies["support"];
} = {}) {
  const stored = options.storedQuote ?? quote();
  const repository: QuoteRepository = {
    async createReserved(input) {
      return input.quote;
    },
    async get(id) {
      return id === stored.id ? stored : undefined;
    },
    async bindPaymentPayload(input) {
      return { ...input, boundAt: new Date() };
    },
    async getPaymentBinding(id) {
      return options.boundPayment && id === stored.id
        ? {
            quoteId: stored.id,
            attemptId: `0x${"33".repeat(32)}`,
            paymentPayloadHash: `0x${"33".repeat(32)}`,
            paymentRequirementsHash: `0x${"44".repeat(32)}`,
            boundAt: stored.createdAt,
          }
        : undefined;
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
    async releaseQuotedReservations() {
      options.onReleaseQuotedReservations?.();
    },
    async reservedInventory() {
      return 0n;
    },
  };
  return createRouterApi({
    webOrigin: "https://app.example",
    quotes: { create: async () => stored } as never,
    quoteRepository: repository,
    payments: {
      fundedSettlementEnabled: options.funded ?? true,
      installedVersion: options.funded === false ? "0.2.1" : "0.2.2",
      minimumSafeVersion: "0.2.2",
      paymentRequired: value => value.paymentRequired,
      async paymentAttempt() {
        return options.paymentAttempt;
      },
      async settleAndExecute() {
        throw options.paymentError ?? new Error("not used");
      },
    },
    orders: {
      async getByQuoteId() {
        return undefined;
      },
    },
    ...(options.support ? { support: options.support } : {}),
    async readiness() {
      const accepting = options.acceptingPayments ?? true;
      return {
        ready: accepting,
        acceptingQuotes: accepting,
        checks: { db: { ok: accepting } },
      };
    },
  });
}

function paidRequest(error: X402PaymentError) {
  const stored = quote();
  const paymentPayload: PaymentPayload = {
    x402Version: 2,
    accepted: stored.paymentRequirements,
    payload: {},
  };
  return app({ paymentError: error, storedQuote: stored }).request(
    "/v1/quotes/quote-1/execute",
    {
      method: "POST",
      headers: {
        "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(paymentPayload),
      },
    },
  );
}

describe("router API", () => {
  test("advertises and serves recurring support only when the service is wired", async () => {
    const unavailable = await app().request(
      `/v1/support/plans?boardroom=${payer}`,
    );
    expect(unavailable.status).toBe(503);

    const enabled = app({
      support: {
        async listPlans() {
          return [];
        },
      } as never,
    });
    const status = await enabled.request("/v1/status");
    await expect(status.json()).resolves.toMatchObject({
      supportedActions: [
        "amm_swap",
        "fixed_price_sale",
        "recurring_support",
      ],
    });
    const plans = await enabled.request(
      `/v1/support/plans?boardroom=${payer}`,
    );
    expect(plans.status).toBe(200);
    await expect(plans.json()).resolves.toEqual({ plans: [] });
  });

  test("returns the exact stored 402 requirement and CORS exposure", async () => {
    const response = await app().request("/v1/quotes/quote-1/execute", {
      method: "POST",
      headers: { Origin: "https://app.example" },
    });
    expect(response.status).toBe(402);
    expect(response.headers.get("access-control-expose-headers")).toContain(
      "PAYMENT-REQUIRED",
    );
    const encoded = response.headers.get("PAYMENT-REQUIRED");
    expect(encoded).toBeTruthy();
    expect(decodePaymentRequiredHeader(encoded!)).toEqual(quote().paymentRequired);
  });

  test("fails readiness closed on the unsafe package release", async () => {
    const response = await app({ funded: false }).request("/health/ready");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      acceptingQuotes: false,
      checks: { x402Runtime: { ok: false } },
    });
  });

  test("does not expose signatures or call data in an order", async () => {
    const response = await app().request("/v1/orders/quote-1");
    expect(response.status).toBe(200);
    const body = await response.json() as {
      execution: Record<string, unknown>;
      signature?: unknown;
    };
    expect(body.execution.callData).toBeUndefined();
    expect(body.signature).toBeUndefined();
  });

  test("releases and resolves an expired quote that never reached the router", async () => {
    const stored = {
      ...quote(),
      expiresAt: new Date(Date.now() - 1_000),
    };
    let releases = 0;
    const response = await app({
      storedQuote: stored,
      onReleaseQuotedReservations() {
        releases += 1;
      },
    }).request("/v1/orders/quote-1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      orderId: stored.id,
      status: "payment_failed",
    });
    expect(releases).toBe(1);
  });

  test("keeps an expired bound quote locked for payment recovery", async () => {
    const stored = {
      ...quote(),
      expiresAt: new Date(Date.now() - 1_000),
    };
    let releases = 0;
    const response = await app({
      boundPayment: true,
      storedQuote: stored,
      onReleaseQuotedReservations() {
        releases += 1;
      },
    }).request("/v1/orders/quote-1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      orderId: stored.id,
      status: "recovery_pending",
    });
    expect(releases).toBe(0);
  });

  test("returns a structured 400 for invalid quote fields", async () => {
    const response = await app().request("/v1/quotes", {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "Request fields do not match the quote API.",
      },
    });
  });

  test("returns a safe structured pre-settlement payment error", async () => {
    const response = await paidRequest(new X402PaymentError({
      code: "invalid_payment_payload",
      phase: "pre_settlement",
      message: "sensitive internal detail",
      paymentMoved: false,
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "invalid_payment_payload",
        message: "The signed payment does not match this quote.",
        paymentMoved: false,
        phase: "pre_settlement",
        retryPayment: false,
      },
      orderId: "quote-1",
    });
  });

  test("rejects a new signed payment while unready before settlement", async () => {
    const stored = quote();
    const paymentPayload: PaymentPayload = {
      x402Version: 2,
      accepted: stored.paymentRequirements,
      payload: {},
    };
    const response = await app({
      acceptingPayments: false,
      storedQuote: stored,
    }).request("/v1/quotes/quote-1/execute", {
      method: "POST",
      headers: {
        "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(paymentPayload),
      },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "router_not_ready",
        phase: "pre_settlement",
        paymentMoved: false,
      },
      quoteId: "quote-1",
    });
  });

  test("does not issue unsigned payment requirements while unready", async () => {
    const response = await app({
      acceptingPayments: false,
    }).request("/v1/quotes/quote-1/execute", { method: "POST" });
    expect(response.status).toBe(503);
    expect(response.headers.get("PAYMENT-REQUIRED")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "router_not_ready" },
      quoteId: "quote-1",
    });
  });

  test("does not issue another payment requirement for a bound quote", async () => {
    const response = await app({
      boundPayment: true,
    }).request("/v1/quotes/quote-1/execute", { method: "POST" });
    expect(response.status).toBe(409);
    expect(response.headers.get("PAYMENT-REQUIRED")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "payment_already_submitted" },
      orderId: "quote-1",
    });
  });

  test("allows a bound journal replay through the readiness gate", async () => {
    const stored = quote();
    const paymentPayload: PaymentPayload = {
      x402Version: 2,
      accepted: stored.paymentRequirements,
      payload: {},
    };
    const response = await app({
      acceptingPayments: false,
      boundPayment: true,
      paymentError: new X402PaymentError({
        code: "invalid_payment_payload",
        phase: "pre_settlement",
        message: "test",
        paymentMoved: false,
      }),
      storedQuote: stored,
    }).request("/v1/quotes/quote-1/execute", {
      method: "POST",
      headers: {
        "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(paymentPayload),
      },
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_payment_payload" },
    });
  });

  test("reports prepared and failed journal states without calling them settled", async () => {
    const prepared = await app({
      paymentAttempt: { status: "prepared" },
    }).request("/v1/orders/quote-1");
    expect(prepared.status).toBe(200);
    await expect(prepared.json()).resolves.toMatchObject({
      status: "recovery_pending",
    });

    const failed = await app({
      paymentAttempt: {
        status: "failed",
        settlement: {
          success: false,
          transaction: "",
          network: "hyperliquid:testnet",
        },
      },
    }).request("/v1/orders/quote-1");
    expect(failed.status).toBe(200);
    await expect(failed.json()).resolves.toMatchObject({
      status: "payment_failed",
    });
  });

  test("preserves a definite failed settlement in PAYMENT-RESPONSE", async () => {
    const settlement: SettleResponse = {
      success: false,
      errorReason: "rejected",
      transaction: "",
      network: "hyperliquid:testnet",
    };
    const response = await paidRequest(new X402PaymentError({
      code: "settlement_failed",
      phase: "settlement",
      message: "facilitator detail",
      paymentMoved: false,
      settlement,
    }));
    expect(response.status).toBe(402);
    expect(
      decodePaymentResponseHeader(response.headers.get("PAYMENT-RESPONSE")!),
    ).toEqual(settlement);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "settlement_failed",
        paymentMoved: false,
        retryPayment: false,
      },
    });
  });

  test("forbids a replacement payment while the same journal claim is in flight", async () => {
    const response = await paidRequest(new X402PaymentError({
      code: "settlement_uncertain",
      phase: "settlement",
      message: "another request is preparing this exact payment",
      paymentMoved: "unknown",
    }));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "recovery_pending",
      recovery: {
        code: "settlement_uncertain",
        paymentMoved: "unknown",
        retryPayment: false,
      },
    });
  });

  test("returns 202 and forbids a replacement payment for an ambiguous HyperCore result", async () => {
    const settlement: SettleResponse = {
      success: false,
      errorReason: "hl_transfer_not_confirmed",
      transaction: "",
      network: "hyperliquid:testnet",
      payer,
    };
    const response = await paidRequest(new X402PaymentError({
      code: "settlement_uncertain",
      phase: "settlement",
      message: "confirmation timed out",
      paymentMoved: "unknown",
      settlement,
    }));
    expect(response.status).toBe(202);
    expect(
      decodePaymentResponseHeader(response.headers.get("PAYMENT-RESPONSE")!),
    ).toEqual(settlement);
    await expect(response.json()).resolves.toMatchObject({
      status: "recovery_pending",
      recovery: {
        code: "settlement_uncertain",
        paymentMoved: "unknown",
        retryPayment: false,
      },
    });
  });

  test("returns a recoverable order after payment may have moved", async () => {
    const settlement: SettleResponse = {
      success: true,
      payer,
      transaction: `0x${"44".repeat(32)}`,
      network: "hyperliquid:testnet",
      amount: "100000000",
    };
    const response = await paidRequest(new X402PaymentError({
      code: "execution_registration_failed",
      phase: "post_settlement",
      message: "database unavailable",
      paymentMoved: true,
      settlement,
    }));
    expect(response.status).toBe(202);
    expect(
      decodePaymentResponseHeader(response.headers.get("PAYMENT-RESPONSE")!),
    ).toEqual(settlement);
    const body = await response.json() as {
      execution: Record<string, unknown>;
      message: string;
      recovery: Record<string, unknown>;
      status: string;
    };
    expect(body.status).toBe("recovery_pending");
    expect(body.execution.callData).toBeUndefined();
    expect(body.message).toContain("Do not submit another payment");
    expect(body.recovery).toEqual({
      code: "execution_registration_failed",
      phase: "post_settlement",
      paymentMoved: true,
      retryPayment: false,
    });
  });
});
