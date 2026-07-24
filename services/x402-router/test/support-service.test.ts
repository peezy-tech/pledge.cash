import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "viem";
import type {
  MarketplaceQuote,
  QuotePaymentBinding,
  QuoteRepository,
} from "../src/domain";
import type {
  SupportAuthorityIdentity,
  SupportChallenge,
  SupportInvoice,
  SupportInvoiceQuote,
  SupportPlan,
  SupportRepository,
  SupportSubscription,
} from "../src/support/domain";
import { SupportError } from "../src/support/domain";
import { RecurringSupportService } from "../src/support/service";

const boardroom =
  "0x1000000000000000000000000000000000000000" as Address;
const authorityAddress =
  "0x2000000000000000000000000000000000000000" as Address;
const payer =
  "0x3000000000000000000000000000000000000000" as Address;
const usdc =
  "0x4000000000000000000000000000000000000000" as Address;
const blockHash = `0x${"11".repeat(32)}` as Hex;
const signature = "0x1234" as Hex;

function identity(
  overrides: Partial<SupportAuthorityIdentity> = {},
): SupportAuthorityIdentity {
  return {
    authority: authorityAddress,
    blockHash,
    blockNumber: 100n,
    boardroom,
    chainId: 998,
    configurationEpoch: 1n,
    controllerGeneration: 1n,
    mode: "launched_controller",
    signer: payer,
    ...overrides,
  };
}

function fixture() {
  const support = new MemorySupportRepository();
  const quotes = new Map<string, MarketplaceQuote>();
  const bindings = new Map<string, QuotePaymentBinding>();
  const quoteRepository: QuoteRepository = {
    async createReserved(input) {
      quotes.set(input.quote.id, input.quote);
      return input.quote;
    },
    async get(id) {
      return quotes.get(id);
    },
    async bindPaymentPayload(input) {
      const binding = { ...input, boundAt: new Date() };
      bindings.set(input.quoteId, binding);
      return binding;
    },
    async getPaymentBinding(id) {
      return bindings.get(id);
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
  let currentIdentity = identity();
  let authorityError: unknown;
  const authority = {
    async resolve() {
      if (authorityError) throw authorityError;
      return currentIdentity;
    },
    async assertCurrent(expected: SupportAuthorityIdentity) {
      if (
        expected.authority.toLowerCase()
          !== currentIdentity.authority.toLowerCase()
        || expected.configurationEpoch !== currentIdentity.configurationEpoch
      ) {
        throw new Error("stale authority");
      }
    },
    async verifyAuthoritySignature() {
      return currentIdentity;
    },
    async verifyAddressSignature() {
      return {
        blockHash: currentIdentity.blockHash,
        blockNumber: currentIdentity.blockNumber,
      };
    },
  };
  let now = Date.parse("2026-01-31T15:45:00.000Z");
  let nextId = 0;
  let quoteCalls = 0;
  const quoteService = {
    async create(request: {
      amount: string;
      boardroom: Address;
      invoiceId: string;
      kind: "recurring_support";
      payer: Address;
    }) {
      quoteCalls += 1;
      const quote = recurringQuote({
        id: `quote-${quoteCalls}`,
        invoiceId: request.invoiceId,
        amount: request.amount,
        payer: request.payer,
      });
      quotes.set(quote.id, quote);
      return quote;
    },
  };
  const service = new RecurringSupportService(
    support,
    authority,
    quoteService as never,
    quoteRepository,
    { async getByQuoteId() { return undefined; } },
    { async paymentAttempt() { return undefined; } },
    {
      destinationUsdc: usdc,
      publicOrigin: "https://router.example",
    },
    () => now,
    () =>
      `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
  );
  return {
    bindings,
    service,
    setIdentity(value: SupportAuthorityIdentity) {
      currentIdentity = value;
    },
    setAuthorityError(value: unknown) {
      authorityError = value;
    },
    setNow(value: string) {
      now = Date.parse(value);
    },
    support,
    quoteCalls: () => quoteCalls,
  };
}

describe("RecurringSupportService", () => {
  test("publishes immutable terms and records a non-spending monthly schedule", async () => {
    const state = fixture();
    const challenge = await state.service.issuePlanChallenge({
      amount: "10000000",
      boardroom,
      cadence: "monthly",
      chainId: 998,
      description: "Keep the project operating.",
      title: "Core support",
    });
    expect(challenge.message).toContain(
      "Every contribution still requires a separate x402 payment signature.",
    );
    const plan = await state.service.createPlan(challenge.id, signature);
    expect(plan).toMatchObject({
      amount: "10000000",
      asset: usdc,
      boardroom,
      status: "active",
      termsHash: challenge.payloadHash,
    });

    const subscribe = await state.service.issueSubscriptionChallenge(
      plan.id,
      payer,
    );
    expect(subscribe.message).toContain(
      "It cannot move funds or approve future payments.",
    );
    expect(subscribe.message).toContain("Chain ID: 998");
    const view = await state.service.createSubscription(
      subscribe.id,
      signature,
    );
    expect(view.subscription).toMatchObject({
      payer,
      status: "active",
    });
    expect(view.invoice).toMatchObject({
      amount: "10000000",
      boardroom,
      periodIndex: 0,
      publicStatus: "open",
    });
    expect(view.invoice?.periodEnd.toISOString()).toBe(
      "2026-02-28T15:45:00.000Z",
    );
  });

  test("creates one exact x402 quote per live attempt and locks a bound payment", async () => {
    const state = fixture();
    const planChallenge = await state.service.issuePlanChallenge({
      amount: "10000000",
      boardroom,
      cadence: "monthly",
      chainId: 998,
      description: "Keep the project operating.",
      title: "Core support",
    });
    const plan = await state.service.createPlan(planChallenge.id, signature);
    const subscribe = await state.service.issueSubscriptionChallenge(
      plan.id,
      payer,
    );
    const view = await state.service.createSubscription(
      subscribe.id,
      signature,
    );
    const invoice = view.invoice;
    if (!invoice) throw new Error("expected invoice");

    state.support.failNextLinkAfterCommit();
    const first = await state.service.createInvoiceQuote(invoice.id);
    const same = await state.service.createInvoiceQuote(invoice.id);
    expect(same.id).toBe(first.id);
    expect(state.quoteCalls()).toBe(1);
    expect(first).toMatchObject({
      kind: "recurring_support",
      supportInvoiceId: invoice.id,
      boardroom,
      payer,
    });
    await expect(state.service.assertQuotePayable(first)).resolves.toBeUndefined();
    await expect(state.service.assertQuotePayable({
      ...first,
      execution: {
        ...first.execution,
        recipient: boardroom,
      },
    })).rejects.toMatchObject({
      code: "support_quote_not_payable",
      status: 409,
    });

    state.bindings.set(first.id, {
      attemptId: `0x${"22".repeat(32)}`,
      boundAt: new Date(),
      paymentPayloadHash: `0x${"33".repeat(32)}`,
      paymentRequirementsHash: `0x${"44".repeat(32)}`,
      quoteId: first.id,
    });
    await expect(
      state.service.createInvoiceQuote(invoice.id),
    ).rejects.toMatchObject({
      code: "support_invoice_payment_locked",
      status: 409,
    });
    expect(state.quoteCalls()).toBe(1);

    const cancellation = await state.service.issueCancellationChallenge(
      view.subscription.id,
    );
    await state.service.cancelSubscription(cancellation.id, signature);
    await expect(
      state.service.assertQuotePayable(first),
    ).rejects.toMatchObject({
      code: "support_quote_not_payable",
      status: 409,
    });
  });

  test("materializes only the current missed period and rejects historical payment", async () => {
    const state = fixture();
    const planChallenge = await state.service.issuePlanChallenge({
      amount: "10000000",
      boardroom,
      cadence: "monthly",
      chainId: 998,
      description: "Keep the project operating.",
      title: "Core support",
    });
    const plan = await state.service.createPlan(planChallenge.id, signature);
    const subscribe = await state.service.issueSubscriptionChallenge(
      plan.id,
      payer,
    );
    const initial = await state.service.createSubscription(
      subscribe.id,
      signature,
    );
    if (!initial.invoice) throw new Error("expected initial invoice");
    const initialQuote = await state.service.createInvoiceQuote(
      initial.invoice.id,
    );

    state.setNow("2026-04-30T16:00:00.000Z");
    const current = await state.service.getSubscription(
      initial.subscription.id,
    );
    expect(current.invoice).toMatchObject({ periodIndex: 3 });
    expect(state.support.invoiceCount()).toBe(2);
    await expect(
      state.service.createInvoiceQuote(initial.invoice.id),
    ).rejects.toMatchObject({
      code: "support_invoice_not_current",
      status: 409,
    });
    await expect(
      state.service.assertQuotePayable(initialQuote),
    ).rejects.toMatchObject({
      code: "support_quote_not_payable",
      status: 409,
    });

    state.setNow("2026-05-31T16:00:00.000Z");
    state.setAuthorityError(new SupportError(
      "Recurring support is available only while the Boardroom is Active.",
      "boardroom_not_active",
      409,
    ));
    const paused = await state.service.getSubscription(initial.subscription.id);
    expect(paused.invoice).toMatchObject({ periodIndex: 3 });
    expect(state.support.invoiceCount()).toBe(2);

    state.setAuthorityError(undefined);
    state.setIdentity(identity({ configurationEpoch: 2n }));
    const stale = await state.service.getSubscription(initial.subscription.id);
    expect(stale.invoice).toMatchObject({ periodIndex: 3 });

    const cancellation = await state.service.issueCancellationChallenge(
      initial.subscription.id,
    );
    const cancelled = await state.service.cancelSubscription(
      cancellation.id,
      signature,
    );
    expect(cancelled.subscription.status).toBe("cancelled");
  });
});

class MemorySupportRepository implements SupportRepository {
  private readonly challenges = new Map<string, SupportChallenge>();
  private readonly plans = new Map<string, SupportPlan>();
  private readonly subscriptions = new Map<string, SupportSubscription>();
  private readonly invoices = new Map<string, SupportInvoice>();
  private readonly links: SupportInvoiceQuote[] = [];
  private failLinkAfterCommit = false;

  invoiceCount(): number {
    return this.invoices.size;
  }

  failNextLinkAfterCommit(): void {
    this.failLinkAfterCommit = true;
  }

  async createChallenge(challenge: SupportChallenge): Promise<void> {
    this.challenges.set(challenge.id, challenge);
  }

  async getChallenge(id: string): Promise<SupportChallenge | undefined> {
    return this.challenges.get(id);
  }

  async createPlanFromChallenge(input: {
    challenge: SupportChallenge;
    plan: SupportPlan;
  }): Promise<SupportPlan> {
    this.consume(input.challenge);
    this.plans.set(input.plan.id, input.plan);
    return input.plan;
  }

  async retirePlanFromChallenge(input: {
    challenge: SupportChallenge;
    retiredAt: Date;
  }): Promise<SupportPlan> {
    this.consume(input.challenge);
    const plan = this.plans.get(input.challenge.planId);
    if (!plan) throw new Error("missing plan");
    const retired = {
      ...plan,
      status: "retired" as const,
      retiredAt: input.retiredAt,
    };
    this.plans.set(plan.id, retired);
    return retired;
  }

  async createSubscriptionFromChallenge(input: {
    challenge: SupportChallenge;
    invoice: SupportInvoice;
    subscription: SupportSubscription;
  }): Promise<SupportSubscription> {
    this.consume(input.challenge);
    this.subscriptions.set(input.subscription.id, input.subscription);
    this.invoices.set(input.invoice.id, input.invoice);
    return input.subscription;
  }

  async cancelSubscriptionFromChallenge(input: {
    cancelledAt: Date;
    challenge: SupportChallenge;
  }): Promise<SupportSubscription> {
    this.consume(input.challenge);
    const id = input.challenge.payload.subscriptionId;
    if (typeof id !== "string") throw new Error("missing subscription");
    const subscription = this.subscriptions.get(id);
    if (!subscription) throw new Error("missing subscription");
    const cancelled = {
      ...subscription,
      status: "cancelled" as const,
      cancelledAt: input.cancelledAt,
    };
    this.subscriptions.set(id, cancelled);
    return cancelled;
  }

  async listPlans(
    requestedBoardroom: Address,
  ): Promise<readonly SupportPlan[]> {
    return [...this.plans.values()].filter(
      plan =>
        plan.boardroom.toLowerCase() === requestedBoardroom.toLowerCase(),
    );
  }

  async getPlan(id: string): Promise<SupportPlan | undefined> {
    return this.plans.get(id);
  }

  async getSubscription(id: string): Promise<SupportSubscription | undefined> {
    return this.subscriptions.get(id);
  }

  async getInvoice(id: string): Promise<SupportInvoice | undefined> {
    return this.invoices.get(id);
  }

  async getLatestInvoice(
    subscriptionId: string,
  ): Promise<SupportInvoice | undefined> {
    return [...this.invoices.values()]
      .filter(invoice => invoice.subscriptionId === subscriptionId)
      .sort((left, right) => right.periodIndex - left.periodIndex)[0];
  }

  async getOrCreateInvoice(
    invoice: SupportInvoice,
  ): Promise<SupportInvoice> {
    const existing = [...this.invoices.values()].find(
      candidate =>
        candidate.subscriptionId === invoice.subscriptionId
        && candidate.periodIndex === invoice.periodIndex,
    );
    if (existing) return existing;
    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  async listInvoiceQuotes(
    invoiceId: string,
  ): Promise<readonly SupportInvoiceQuote[]> {
    return this.links
      .filter(link => link.invoiceId === invoiceId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async linkInvoiceQuote(link: SupportInvoiceQuote): Promise<void> {
    this.links.push(link);
    const invoice = this.invoices.get(link.invoiceId);
    if (!invoice) throw new Error("missing invoice");
    this.invoices.set(invoice.id, {
      ...invoice,
      activeQuoteId: link.quoteId,
    });
    if (this.failLinkAfterCommit) {
      this.failLinkAfterCommit = false;
      throw new Error("link commit response was lost");
    }
  }

  async hasBlockingPayerBoardroomPayment(): Promise<boolean> {
    return false;
  }

  async withInvoiceLock<T>(
    _invoiceId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    return action();
  }

  private consume(challenge: SupportChallenge): void {
    this.challenges.set(challenge.id, {
      ...challenge,
      consumedAt: new Date(),
    });
  }
}

function recurringQuote(input: {
  id: string;
  invoiceId: string;
  amount: string;
  payer: Address;
}): MarketplaceQuote {
  return {
    id: input.id,
    paymentId: `payment-${input.id}`,
    kind: "recurring_support",
    lifecycle: "quoted",
    payer: input.payer,
    recipient: input.payer,
    refundAddress: input.payer,
    boardroom,
    canonicalTarget: boardroom,
    supportInvoiceId: input.invoiceId,
    sourcePayment: {
      network: "hyperliquid:testnet",
      asset: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
      symbol: "USDC",
      decimals: 8,
      amount: "1000000000",
      principal: "1000000000",
      serviceFee: "0",
      payTo: authorityAddress,
    },
    execution: {
      chainId: 998,
      target: boardroom,
      callData: "0xeeeb934f",
      callDataHash: `0x${"55".repeat(32)}`,
      selector: "0xeeeb934f",
      value: "0",
      recipient: input.payer,
      inputToken: usdc,
      inputAmount: input.amount,
      outputToken: usdc,
      expectedOutput: input.amount,
      minimumOutput: input.amount,
      deadline: Math.floor(Date.now() / 1_000) + 60,
    },
    maxGasCost: "1",
    maxSlippageBps: 0,
    intentQuote: {} as never,
    paymentRequirements: {} as never,
    paymentRequired: {} as never,
    intentTemplateHash: `0x${"66".repeat(32)}`,
    inventoryReservations: [],
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  };
}
