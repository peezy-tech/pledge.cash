import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequired,
  SettleResponse,
} from "@x402/core/types";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { IntentExecutionRecord } from "x402-hl/intents/server";
import { ZodError } from "zod";
import {
  QuoteRequestError,
  createQuoteRequestSchema,
  sanitizeOrder,
  toQuoteDto,
} from "./dto";
import type {
  MarketplaceQuote,
  PublicOrder,
  QuoteRepository,
} from "../domain";
import type { MarketplaceQuoteService } from "../quotes/service";
import {
  supportChallengeCompletionSchema,
  supportChallengeDto,
  supportInvoiceIdParamsSchema,
  supportPlanDraftSchema,
  supportPlanDto,
  supportPlanIdParamsSchema,
  supportPlansQuerySchema,
  supportSubscriptionChallengeSchema,
  supportSubscriptionDto,
  supportSubscriptionIdParamsSchema,
} from "../support/dto";
import { SupportError } from "../support/domain";
import type { RecurringSupportService } from "../support/service";
import { X402PaymentError } from "../x402/server";

const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

export type ReadinessCheck = {
  ready: boolean;
  acceptingQuotes: boolean;
  checks: Record<
    string,
    {
      ok: boolean;
      message?: string;
    }
  >;
};

export interface PaymentSaga {
  fundedSettlementEnabled: boolean;
  minimumSafeVersion: string;
  installedVersion: string;
  paymentRequired(quote: MarketplaceQuote): PaymentRequired;
  paymentAttempt(quoteId: string): Promise<
    | {
        status: "prepared" | "settled" | "failed";
        settlement?: SettleResponse;
      }
    | undefined
  >;
  settleAndExecute(input: {
    quote: MarketplaceQuote;
    paymentPayload: PaymentPayload;
  }): Promise<{
    settlement: SettleResponse & { success: true };
    execution: IntentExecutionRecord;
  }>;
}

export interface OrderReader {
  getByQuoteId(quoteId: string): Promise<IntentExecutionRecord | undefined>;
}

export type RouterApiDependencies = {
  webOrigin: string;
  quotes: Pick<MarketplaceQuoteService, "create">;
  quoteRepository: QuoteRepository;
  payments: PaymentSaga;
  orders: OrderReader;
  support?: Pick<
    RecurringSupportService,
    | "listPlans"
    | "issuePlanChallenge"
    | "createPlan"
    | "issueRetirementChallenge"
    | "retirePlan"
    | "issueSubscriptionChallenge"
    | "createSubscription"
    | "getSubscription"
    | "issueCancellationChallenge"
    | "cancelSubscription"
    | "createInvoiceQuote"
    | "assertQuotePayable"
  >;
  readiness(): Promise<ReadinessCheck>;
};

export function createRouterApi(deps: RouterApiDependencies): Hono {
  const app = new Hono();

  app.use(
    "/v1/*",
    cors({
      origin: deps.webOrigin,
      allowHeaders: ["Content-Type", PAYMENT_SIGNATURE_HEADER],
      exposeHeaders: [
        "Date",
        PAYMENT_REQUIRED_HEADER,
        PAYMENT_RESPONSE_HEADER,
      ],
      allowMethods: ["GET", "POST", "OPTIONS"],
      maxAge: 600,
    }),
  );
  app.use("/v1/*", async (c, next) => {
    await next();
    c.header("Date", new Date().toUTCString());
  });
  app.use(
    "/v1/quotes",
    bodyLimit({
      maxSize: 16 * 1024,
      onError: c =>
        c.json(
          { error: { code: "request_too_large", message: "Request is too large." } },
          413,
        ),
    }),
  );
  app.use(
    "/v1/support/*",
    bodyLimit({
      maxSize: 16 * 1024,
      onError: c =>
        c.json(
          { error: { code: "request_too_large", message: "Request is too large." } },
          413,
        ),
    }),
  );

  app.get("/health/live", c =>
    c.json({ status: "live", service: "pledge-x402-router" }),
  );

  app.get("/health/ready", async c => {
    const readiness = await safeReadiness(deps);
    return c.json(readiness, readiness.ready ? 200 : 503);
  });

  app.get("/v1/status", async c => {
    const readiness = await safeReadiness(deps);
    return c.json({
      version: "v1",
      sourceNetwork: "hyperliquid:testnet",
      destinationNetwork: "eip155:998",
      paymentAsset: "USDC",
      supportedActions: [
        "amm_swap",
        "fixed_price_sale",
        ...(deps.support ? ["recurring_support"] : []),
      ],
      acceptingQuotes: readiness.acceptingQuotes,
      x402Runtime: {
        installedVersion: deps.payments.installedVersion,
        minimumSafeVersion: deps.payments.minimumSafeVersion,
        fundedSettlementEnabled: deps.payments.fundedSettlementEnabled,
      },
    });
  });

  app.post("/v1/quotes", async c => {
    const readiness = await safeReadiness(deps);
    if (!readiness.acceptingQuotes) {
      return c.json(
        {
          error: {
            code: "router_not_ready",
            message: "The Hyperliquid payment rail is not accepting quotes.",
          },
          checks: readiness.checks,
        },
        503,
      );
    }

    const request = createQuoteRequestSchema.parse(await c.req.json());
    const quote = await deps.quotes.create(request);
    return c.json(toQuoteDto(quote), 201);
  });

  app.get("/v1/support/plans", async c => {
    const support = requireSupport(deps);
    const query = supportPlansQuerySchema.parse({
      boardroom: c.req.query("boardroom"),
    });
    const plans = await support.listPlans(query.boardroom);
    return c.json({ plans: plans.map(supportPlanDto) });
  });

  app.post("/v1/support/plans/challenges", async c => {
    const support = requireSupport(deps);
    const request = supportPlanDraftSchema.parse(await c.req.json());
    const challenge = await support.issuePlanChallenge(request);
    return c.json(supportChallengeDto(challenge), 201);
  });

  app.post("/v1/support/plans", async c => {
    const support = requireSupport(deps);
    const request = supportChallengeCompletionSchema.parse(await c.req.json());
    const plan = await support.createPlan(
      request.challengeId,
      request.signature as `0x${string}`,
    );
    return c.json({ plan: supportPlanDto(plan) }, 201);
  });

  app.post("/v1/support/plans/:id/retirement-challenges", async c => {
    const support = requireSupport(deps);
    const { id } = supportPlanIdParamsSchema.parse(c.req.param());
    const challenge = await support.issueRetirementChallenge(id);
    return c.json(supportChallengeDto(challenge), 201);
  });

  app.post("/v1/support/plans/:id/retire", async c => {
    const support = requireSupport(deps);
    const { id } = supportPlanIdParamsSchema.parse(c.req.param());
    const request = supportChallengeCompletionSchema.parse(await c.req.json());
    const plan = await support.retirePlan(
      request.challengeId,
      request.signature as `0x${string}`,
      id,
    );
    return c.json({ plan: supportPlanDto(plan) });
  });

  app.post("/v1/support/subscriptions/challenges", async c => {
    const support = requireSupport(deps);
    const request = supportSubscriptionChallengeSchema.parse(
      await c.req.json(),
    );
    const challenge = await support.issueSubscriptionChallenge(
      request.planId,
      request.payer,
    );
    return c.json(supportChallengeDto(challenge), 201);
  });

  app.post("/v1/support/subscriptions", async c => {
    const support = requireSupport(deps);
    const request = supportChallengeCompletionSchema.parse(await c.req.json());
    const subscription = await support.createSubscription(
      request.challengeId,
      request.signature as `0x${string}`,
    );
    return c.json(supportSubscriptionDto(subscription), 201);
  });

  app.get("/v1/support/subscriptions/:id", async c => {
    const support = requireSupport(deps);
    const { id } = supportSubscriptionIdParamsSchema.parse(c.req.param());
    const subscription = await support.getSubscription(id);
    return c.json(supportSubscriptionDto(subscription));
  });

  app.post(
    "/v1/support/subscriptions/:id/cancellation-challenges",
    async c => {
      const support = requireSupport(deps);
      const { id } = supportSubscriptionIdParamsSchema.parse(c.req.param());
      const challenge = await support.issueCancellationChallenge(id);
      return c.json(supportChallengeDto(challenge), 201);
    },
  );

  app.post("/v1/support/subscriptions/:id/cancel", async c => {
    const support = requireSupport(deps);
    const { id } = supportSubscriptionIdParamsSchema.parse(c.req.param());
    const request = supportChallengeCompletionSchema.parse(await c.req.json());
    const subscription = await support.cancelSubscription(
      request.challengeId,
      request.signature as `0x${string}`,
      id,
    );
    return c.json(supportSubscriptionDto(subscription));
  });

  app.post("/v1/support/invoices/:id/quotes", async c => {
    const support = requireSupport(deps);
    const readiness = await safeReadiness(deps);
    if (!readiness.acceptingQuotes) {
      return c.json(
        {
          error: {
            code: "router_not_ready",
            message: "The Hyperliquid payment rail is not accepting quotes.",
          },
          checks: readiness.checks,
        },
        503,
      );
    }
    const { id } = supportInvoiceIdParamsSchema.parse(c.req.param());
    const quote = await support.createInvoiceQuote(id);
    return c.json(toQuoteDto(quote), 201);
  });

  app.post("/v1/quotes/:id/execute", async c => {
    const quote = await deps.quoteRepository.get(c.req.param("id"));
    if (!quote) {
      return c.json(
        { error: { code: "quote_not_found", message: "Quote was not found." } },
        404,
      );
    }
    const paymentSignature = c.req.header(PAYMENT_SIGNATURE_HEADER);
    const paymentBinding = await deps.quoteRepository.getPaymentBinding(
      quote.id,
    );
    if (quote.kind === "recurring_support" && !paymentBinding) {
      await requireSupport(deps).assertQuotePayable(quote);
    }
    if (!paymentSignature) {
      if (paymentBinding) {
        return c.json(
          {
            error: {
              code: "payment_already_submitted",
              message:
                "This quote already has a payment attempt. Follow its order status instead of paying again.",
            },
            orderId: quote.id,
            quoteId: quote.id,
          },
          409,
        );
      }
      if (quote.expiresAt.getTime() <= Date.now()) {
        await deps.quoteRepository.releaseQuotedReservations(quote.id);
        return c.json(
          { error: { code: "quote_expired", message: "Quote has expired." } },
          410,
        );
      }
      const readiness = await safeReadiness(deps);
      if (!readiness.acceptingQuotes) {
        return c.json(
          {
            error: {
              code: "router_not_ready",
              message:
                "The router is not issuing payment requirements while its destination or refund rail is unavailable.",
            },
            orderId: quote.id,
            quoteId: quote.id,
            checks: readiness.checks,
          },
          503,
        );
      }
      const paymentRequired = deps.payments.paymentRequired(quote);
      c.header(PAYMENT_REQUIRED_HEADER, encodePaymentRequiredHeader(paymentRequired));
      return c.json(paymentRequired, 402);
    }
    if (!deps.payments.fundedSettlementEnabled) {
      return c.json(
        {
          error: {
            code: "unsafe_x402_runtime",
            message: "Funded settlement is disabled until the hardened x402 runtime is installed.",
          },
        },
        503,
      );
    }

    let paymentPayload: PaymentPayload;
    try {
      paymentPayload = decodePaymentSignatureHeader(paymentSignature);
    } catch {
      return c.json(
        {
          error: {
            code: "invalid_payment_signature",
            message: "The PAYMENT-SIGNATURE header is malformed.",
          },
        },
        400,
      );
    }
    if (!paymentBinding) {
      const readiness = await safeReadiness(deps);
      if (!readiness.acceptingQuotes) {
        return c.json(
          {
            error: {
              code: "router_not_ready",
              message:
                "The router cannot accept a new payment while its destination or refund rail is not ready.",
              phase: "pre_settlement",
              paymentMoved: false,
              retryPayment: true,
            },
            orderId: quote.id,
            quoteId: quote.id,
            checks: readiness.checks,
          },
          503,
        );
      }
    }

    let result;
    try {
      result = await deps.payments.settleAndExecute({
        quote,
        paymentPayload,
      });
    } catch (error) {
      if (!(error instanceof X402PaymentError)) throw error;

      if (error.settlement) {
        c.header(
          PAYMENT_RESPONSE_HEADER,
          encodePaymentResponseHeader(error.settlement),
        );
      }

      if (error.paymentMoved !== false || error.phase === "post_settlement") {
        const attempt = await safePaymentAttempt(deps, quote.id);
        const order = attempt
          ? toPaymentRecoveryOrder(quote, attempt)
          : toUncertainRecoveryOrder(quote, error);
        return c.json(
          {
            ...order,
            recovery: {
              code: error.code,
              phase: error.phase,
              paymentMoved: error.paymentMoved,
              retryPayment: false,
            },
          },
          202,
        );
      }

      const body = {
        error: {
          code: error.code,
          message: publicPaymentErrorMessage(error),
          phase: error.phase,
          paymentMoved: false as const,
          retryPayment: error.code === "settlement_journal_failed",
        },
        orderId: quote.id,
        quoteId: quote.id,
      };
      if (error.code === "settlement_failed") {
        return c.json(body, 402);
      }
      if (error.code === "settlement_journal_failed") {
        c.header("Retry-After", "1");
        return c.json(body, 503);
      }
      return c.json(body, 400);
    }
    c.header(PAYMENT_RESPONSE_HEADER, encodePaymentResponseHeader(result.settlement));
    return c.json(
      toPublicOrder(quote, result.execution),
      isTerminal(result.execution.status) ? 200 : 202,
    );
  });

  app.get("/v1/orders/:id", async c => {
    const quote = await deps.quoteRepository.get(c.req.param("id"));
    if (!quote) {
      return c.json(
        { error: { code: "order_not_found", message: "Order was not found." } },
        404,
      );
    }
    const record = await deps.orders.getByQuoteId(quote.id);
    const paymentAttempt = record
      ? undefined
      : await deps.payments.paymentAttempt(quote.id);
    const paymentBinding =
      !record && !paymentAttempt
        ? await deps.quoteRepository.getPaymentBinding(quote.id)
        : undefined;
    if (
      !record
      && !paymentAttempt
      && quote.expiresAt.getTime() <= Date.now()
      && !paymentBinding
    ) {
      await deps.quoteRepository.releaseQuotedReservations(quote.id);
      return c.json(toExpiredUnsubmittedOrder(quote));
    }
    return c.json(
      record
        ? toPublicOrder(quote, record)
        : paymentAttempt
          ? toPaymentRecoveryOrder(quote, paymentAttempt)
          : paymentBinding
            ? toBoundRecoveryOrder(quote)
            : toQuotedOrder(quote),
    );
  });

  app.notFound(c =>
    c.json(
      { error: { code: "not_found", message: "Route was not found." } },
      404,
    ),
  );

  app.onError((error, c) => {
    if (error instanceof SupportError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status as 400,
      );
    }
    if (error instanceof QuoteRequestError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status as 400,
      );
    }
    if (error instanceof SyntaxError) {
      return c.json(
        { error: { code: "invalid_json", message: "Request body is not valid JSON." } },
        400,
      );
    }
    if (error instanceof ZodError) {
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: "Request fields do not match the quote API.",
          },
        },
        400,
      );
    }
    console.error("x402_router_request_failed", {
      method: c.req.method,
      path: c.req.path,
      error: error instanceof Error ? error.name : "unknown",
    });
    return c.json(
      {
        error: {
          code: "internal_error",
          message: "The router could not complete this request.",
        },
      },
      500,
    );
  });

  return app;
}

function requireSupport(
  deps: RouterApiDependencies,
): NonNullable<RouterApiDependencies["support"]> {
  if (!deps.support) {
    throw new SupportError(
      "Recurring support is unavailable until the canonical deployment is ready.",
      "support_unavailable",
      503,
    );
  }
  return deps.support;
}

async function safePaymentAttempt(
  deps: RouterApiDependencies,
  quoteId: string,
): ReturnType<PaymentSaga["paymentAttempt"]> {
  try {
    return await deps.payments.paymentAttempt(quoteId);
  } catch {
    return undefined;
  }
}

function toUncertainRecoveryOrder(
  quote: MarketplaceQuote,
  error: X402PaymentError,
): PublicOrder {
  const paymentTransaction =
    error.settlement?.success && error.settlement.transaction
      ? error.settlement.transaction
      : undefined;
  return sanitizeOrder({
    orderId: quote.id,
    quoteId: quote.id,
    kind: quote.kind,
    status: "recovery_pending",
    payer: quote.payer,
    recipient: quote.recipient,
    refundAddress: quote.refundAddress,
    sourcePayment: quote.sourcePayment,
    execution: publicExecution(quote),
    expiresAt: quote.expiresAt.toISOString(),
    ...(paymentTransaction ? { paymentTransaction } : {}),
    message:
      "Payment state is being reconciled. Do not submit another payment; follow this order for execution or refund.",
  });
}

function publicPaymentErrorMessage(error: X402PaymentError): string {
  switch (error.code) {
    case "invalid_payment_payload":
      return "The signed payment does not match this quote.";
    case "intent_preflight_failed":
      return "The signed execution intent failed validation.";
    case "facilitator_verification_failed":
      return "The Hyperliquid payment could not be verified.";
    case "settlement_failed":
      return "Hyperliquid payment settlement failed. Request a fresh quote before paying again.";
    case "settlement_journal_failed":
      return "The payment attempt could not be safely recorded and was not submitted.";
    case "settlement_uncertain":
    case "settlement_binding_mismatch":
    case "execution_registration_failed":
    case "execution_record_mismatch":
      return "Payment recovery is required. Do not submit another payment.";
  }
}

function toPaymentRecoveryOrder(
  quote: MarketplaceQuote,
  attempt: {
    status: "prepared" | "settled" | "failed";
    settlement?: SettleResponse;
  },
): PublicOrder {
  const settled = attempt.status === "settled" && attempt.settlement?.success;
  return sanitizeOrder({
    orderId: quote.id,
    quoteId: quote.id,
    kind: quote.kind,
    status:
      attempt.status === "settled"
        ? "paid"
        : attempt.status === "failed"
          ? "payment_failed"
          : "recovery_pending",
    payer: quote.payer,
    recipient: quote.recipient,
    refundAddress: quote.refundAddress,
    sourcePayment: quote.sourcePayment,
    execution: publicExecution(quote),
    expiresAt: quote.expiresAt.toISOString(),
    ...(settled && attempt.settlement?.transaction
      ? { paymentTransaction: attempt.settlement.transaction }
      : {}),
    message:
      attempt.status === "settled"
        ? "Payment settled and durable execution recovery is pending."
        : attempt.status === "prepared"
          ? "Payment settlement recovery is pending. Do not submit another payment."
          : "This payment attempt failed definitively. Request a new quote before retrying.",
  });
}

async function safeReadiness(
  deps: RouterApiDependencies,
): Promise<ReadinessCheck> {
  try {
    const result = await deps.readiness();
    const releaseSafe = deps.payments.fundedSettlementEnabled;
    return {
      ready: result.ready && releaseSafe,
      acceptingQuotes: result.acceptingQuotes && releaseSafe,
      checks: {
        ...result.checks,
        x402Runtime: releaseSafe
          ? { ok: true }
          : {
              ok: false,
              message: `Installed x402-hl@${deps.payments.installedVersion}; funded settlement requires >=${deps.payments.minimumSafeVersion}.`,
            },
      },
    };
  } catch {
    return {
      ready: false,
      acceptingQuotes: false,
      checks: {
        readiness: { ok: false, message: "Readiness checks failed." },
      },
    };
  }
}

function toQuotedOrder(quote: MarketplaceQuote): PublicOrder {
  return sanitizeOrder({
    orderId: quote.id,
    quoteId: quote.id,
    kind: quote.kind,
    status: "quoted",
    payer: quote.payer,
    recipient: quote.recipient,
    refundAddress: quote.refundAddress,
    sourcePayment: quote.sourcePayment,
    execution: publicExecution(quote),
    expiresAt: quote.expiresAt.toISOString(),
  });
}

function toExpiredUnsubmittedOrder(quote: MarketplaceQuote): PublicOrder {
  return sanitizeOrder({
    ...toQuotedOrder(quote),
    status: "payment_failed",
    message:
      "The quote expired before the router received a payment. Request a fresh quote before paying.",
  });
}

function toBoundRecoveryOrder(quote: MarketplaceQuote): PublicOrder {
  return sanitizeOrder({
    ...toQuotedOrder(quote),
    status: "recovery_pending",
    message:
      "A payment payload is durably bound to this quote and is being reconciled. Do not submit another payment.",
  });
}

function toPublicOrder(
  quote: MarketplaceQuote,
  record: IntentExecutionRecord,
): PublicOrder {
  return sanitizeOrder({
    orderId: quote.id,
    quoteId: quote.id,
    kind: quote.kind,
    status: mapStatus(record.status),
    payer: quote.payer,
    recipient: quote.recipient,
    refundAddress: quote.refundAddress,
    sourcePayment: quote.sourcePayment,
    execution: publicExecution(quote),
    expiresAt: quote.expiresAt.toISOString(),
    paymentTransaction: record.paymentTransaction,
    ...(record.executionTransaction
      ? { executionTransaction: record.executionTransaction }
      : {}),
    ...(record.refundTransaction
      ? { refundTransaction: record.refundTransaction }
      : {}),
    ...(record.failure?.message ? { message: record.failure.message } : {}),
  });
}

function publicExecution(quote: MarketplaceQuote) {
  const { callData: _callData, ...execution } = quote.execution;
  return execution;
}

function mapStatus(status: IntentExecutionRecord["status"]): PublicOrder["status"] {
  switch (status) {
    case "paid":
      return "paid";
    case "execution_claimed":
    case "execution_submitted":
      return "executing";
    case "executed":
      return "executed";
    case "execution_failed":
    case "refund_pending":
    case "refund_claimed":
    case "refund_submitted":
    case "refund_failed":
      return "refund_pending";
    case "refunded":
      return "refunded";
    case "manual_intervention":
      return "manual_intervention";
  }
}

function isTerminal(status: IntentExecutionRecord["status"]): boolean {
  return (
    status === "executed" ||
    status === "refunded" ||
    status === "manual_intervention"
  );
}
