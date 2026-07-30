import { keccak256, stringToHex, type Address, type Hex } from "viem";
import type { IntentExecutionRecord } from "x402-hl/intents/server";
import { z } from "zod";
import type { MarketplaceQuote, QuoteRepository } from "../domain";
import type { MarketplaceQuoteService } from "../quotes/service";
import {
  supportAddressSchema,
  supportAmountSchema,
  supportPlanDraftSchema,
  type SupportPlanDraft,
} from "./dto";
import {
  SUPPORT_CHAIN_ID,
  SupportError,
  type SupportAuthorityIdentity,
  type SupportAuthorityReader,
  type SupportChallenge,
  type SupportChallengeAction,
  type SupportInvoice,
  type SupportInvoiceView,
  type SupportPlan,
  type SupportRepository,
  type SupportSubscription,
  type SupportSubscriptionView,
} from "./domain";
import {
  RecurringSupportExecutionGuard,
  type RecurringSupportExecutionValidator,
} from "./execution";
import { monthlyPeriodAt } from "./schedule";

const CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const PLAN_LIST_LIMIT = 50;

const storedPlanPayloadSchema = supportPlanDraftSchema
  .extend({
    version: z.literal(2),
    planId: z.string().uuid(),
    asset: supportAddressSchema,
    facetSetHash: z.string().regex(/^0x[a-f0-9]{64}$/),
  })
  .strict();

const storedRetirementPayloadSchema = z
  .object({
    version: z.literal(2),
    action: z.literal("retire"),
    planId: z.string().uuid(),
    boardroom: supportAddressSchema,
    facetSetHash: z.string().regex(/^0x[a-f0-9]{64}$/),
    planFacetSetHash: z.string().regex(/^0x[a-f0-9]{64}$/),
  })
  .strict();

const storedSubscriptionPayloadSchema = z
  .object({
    version: z.literal(2),
    action: z.literal("subscribe"),
    subscriptionId: z.string().uuid(),
    planId: z.string().uuid(),
    boardroom: supportAddressSchema,
    facetSetHash: z.string().regex(/^0x[a-f0-9]{64}$/),
    payer: supportAddressSchema,
  })
  .strict();

const storedCancellationPayloadSchema = z
  .object({
    version: z.literal(2),
    action: z.literal("cancel"),
    subscriptionId: z.string().uuid(),
    planId: z.string().uuid(),
    boardroom: supportAddressSchema,
    facetSetHash: z.string().regex(/^0x[a-f0-9]{64}$/),
    payer: supportAddressSchema,
  })
  .strict();

export interface SupportOrderReader {
  getByQuoteId(quoteId: string): Promise<IntentExecutionRecord | undefined>;
}

export interface SupportPaymentAttemptReader {
  paymentAttempt(quoteId: string): Promise<
    | {
        status: "prepared" | "settled" | "failed";
      }
    | undefined
  >;
}

export class RecurringSupportService {
  private readonly executionGuard: RecurringSupportExecutionValidator;

  constructor(
    private readonly repository: SupportRepository,
    private readonly authority: SupportAuthorityReader,
    private readonly quotes: Pick<MarketplaceQuoteService, "create">,
    private readonly quoteRepository: QuoteRepository,
    private readonly orders: SupportOrderReader,
    private readonly paymentAttempts: SupportPaymentAttemptReader,
    private readonly config: {
      destinationUsdc: Address;
      publicOrigin: string;
    },
    private readonly clock: () => number = () => Date.now(),
    private readonly id: () => string = () => crypto.randomUUID(),
  ) {
    this.executionGuard = new RecurringSupportExecutionGuard(
      repository,
      authority,
      clock,
    );
  }

  async listPlans(
    boardroom: Address,
    payer?: Address,
  ): Promise<readonly SupportPlan[]> {
    return this.repository.listPlans(boardroom, PLAN_LIST_LIMIT, payer);
  }

  async issuePlanChallenge(
    draftInput: SupportPlanDraft,
  ): Promise<SupportChallenge> {
    const draft = supportPlanDraftSchema.parse(draftInput);
    const identity = await this.authority.resolve(draft.boardroom);
    const planId = this.id();
    const payload = {
      version: 2,
      planId,
      chainId: SUPPORT_CHAIN_ID,
      boardroom: draft.boardroom.toLowerCase(),
      asset: this.config.destinationUsdc.toLowerCase(),
      amount: draft.amount,
      cadence: "monthly",
      title: draft.title,
      description: draft.description,
      facetSetHash: identity.facetSetHash.toLowerCase(),
    } as const;
    return this.issueChallenge({
      action: "plan_create",
      actor: identity.signer ?? identity.authority,
      authority: identity,
      planId,
      payload,
    });
  }

  async createPlan(
    challengeId: string,
    signature: Hex,
  ): Promise<SupportPlan> {
    const challenge = await this.requireChallenge(
      challengeId,
      "plan_create",
    );
    const payload = storedPlanPayloadSchema.parse(challenge.payload);
    const expected = authorityFromChallenge(challenge);
    const verified = await this.authority.verifyAuthoritySignature({
      expected,
      message: challenge.message,
      signature,
    });
    const createdAt = new Date(this.clock());
    const plan: SupportPlan = {
      id: payload.planId,
      chainId: SUPPORT_CHAIN_ID,
      boardroom: payload.boardroom,
      asset: payload.asset,
      amount: payload.amount,
      cadence: "monthly",
      title: payload.title,
      description: payload.description,
      termsHash: challenge.payloadHash,
      status: "active",
      authority: verified.authority,
      authorityMode: verified.mode,
      controllerGeneration: verified.controllerGeneration,
      configurationEpoch: verified.configurationEpoch,
      facetSetHash: verified.facetSetHash,
      verifiedBlock: verified.blockNumber,
      verifiedBlockHash: verified.blockHash,
      createdAt,
    };
    return this.repository.createPlanFromChallenge({
      challenge,
      plan,
      signatureHash: keccak256(signature),
    });
  }

  async issueRetirementChallenge(planId: string): Promise<SupportChallenge> {
    const plan = await this.requireActivePlan(planId);
    const identity = await this.authority.resolve(plan.boardroom);
    return this.issueChallenge({
      action: "plan_retire",
      actor: identity.signer ?? identity.authority,
      authority: identity,
      planId,
      payload: {
        version: 2,
        action: "retire",
        planId,
        boardroom: plan.boardroom.toLowerCase(),
        facetSetHash: identity.facetSetHash.toLowerCase(),
        planFacetSetHash: plan.facetSetHash.toLowerCase(),
      },
    });
  }

  async retirePlan(
    challengeId: string,
    signature: Hex,
    expectedPlanId?: string,
  ): Promise<SupportPlan> {
    const challenge = await this.requireChallenge(
      challengeId,
      "plan_retire",
    );
    const payload = storedRetirementPayloadSchema.parse(challenge.payload);
    if (expectedPlanId !== undefined && payload.planId !== expectedPlanId) {
      throw new SupportError(
        "The retirement challenge belongs to a different support plan.",
        "support_challenge_invalid",
        409,
      );
    }
    const plan = await this.requireActivePlan(payload.planId);
    assertRetirementPlanMatchesChallenge(plan, challenge, payload);
    const verified = await this.authority.verifyAuthoritySignature({
      expected: authorityFromChallenge(challenge),
      message: challenge.message,
      signature,
    });
    return this.repository.retirePlanFromChallenge({
      challenge,
      retiredAt: new Date(this.clock()),
      signatureHash: keccak256(signature),
      verified,
    });
  }

  async issueSubscriptionChallenge(
    planId: string,
    payer: Address,
  ): Promise<SupportChallenge> {
    const plan = await this.requireActivePlan(planId);
    const identity = await this.requireCurrentPlanAuthority(plan);
    const subscriptionId = this.id();
    return this.issueChallenge({
      action: "subscription_create",
      actor: payer,
      authority: identity,
      planId,
      payload: {
        version: 2,
        action: "subscribe",
        subscriptionId,
        planId,
        boardroom: plan.boardroom.toLowerCase(),
        facetSetHash: plan.facetSetHash.toLowerCase(),
        payer: payer.toLowerCase(),
      },
    });
  }

  async createSubscription(
    challengeId: string,
    signature: Hex,
  ): Promise<SupportSubscriptionView> {
    const challenge = await this.requireChallenge(
      challengeId,
      "subscription_create",
    );
    const payload = storedSubscriptionPayloadSchema.parse(challenge.payload);
    const plan = await this.requireActivePlan(payload.planId);
    assertPlanMatchesChallenge(plan, challenge);
    await this.requireCurrentPlanAuthority(plan);
    const verified = await this.authority.verifyAddressSignature({
      address: payload.payer,
      message: challenge.message,
      signature,
    });
    const createdAt = new Date(this.clock());
    const subscription: SupportSubscription = {
      id: payload.subscriptionId,
      planId: plan.id,
      payer: payload.payer,
      status: "active",
      startedAt: createdAt,
      createdAt,
    };
    const invoice = createInvoice({
      id: this.id(),
      now: createdAt,
      plan,
      subscription,
    });
    const stored = await this.repository.createSubscriptionFromChallenge({
      challenge,
      invoice,
      signatureHash: keccak256(signature),
      subscription,
      verifiedBlock: verified.blockNumber,
      verifiedBlockHash: verified.blockHash,
    });
    return {
      plan,
      subscription: stored,
      invoice: await this.invoiceView(invoice),
    };
  }

  async getSubscription(id: string): Promise<SupportSubscriptionView> {
    const subscription = await this.repository.getSubscription(id);
    if (!subscription) {
      throw new SupportError(
        "Support subscription was not found.",
        "support_subscription_not_found",
        404,
      );
    }
    const plan = await this.requirePlan(subscription.planId);
    let invoice = await this.repository.getBlockingSubscriptionInvoice(
      subscription.id,
    );
    if (
      !invoice
      && subscription.status === "active"
      && plan.status === "active"
    ) {
      try {
        await this.requireCurrentPlanAuthority(plan);
        const candidate = createInvoice({
          id: this.id(),
          now: new Date(this.clock()),
          plan,
          subscription,
        });
        invoice = await this.repository.getOrCreateInvoice(candidate);
      } catch (error) {
        if (!invoiceMaterializationIsPaused(error)) throw error;
        invoice = await this.repository.getLatestInvoice(subscription.id);
      }
    } else if (!invoice) {
      invoice = await this.repository.getLatestInvoice(subscription.id);
    }
    return {
      plan,
      subscription,
      ...(invoice ? { invoice: await this.invoiceView(invoice) } : {}),
    };
  }

  async issueCancellationChallenge(
    subscriptionId: string,
  ): Promise<SupportChallenge> {
    const subscription = await this.requireActiveSubscription(subscriptionId);
    const plan = await this.requirePlan(subscription.planId);
    return this.issueChallenge({
      action: "subscription_cancel",
      actor: subscription.payer,
      authority: authorityFromPlan(plan),
      planId: plan.id,
      payload: {
        version: 2,
        action: "cancel",
        subscriptionId: subscription.id,
        planId: plan.id,
        boardroom: plan.boardroom.toLowerCase(),
        facetSetHash: plan.facetSetHash.toLowerCase(),
        payer: subscription.payer.toLowerCase(),
      },
    });
  }

  async cancelSubscription(
    challengeId: string,
    signature: Hex,
    expectedSubscriptionId?: string,
  ): Promise<SupportSubscriptionView> {
    const challenge = await this.requireChallenge(
      challengeId,
      "subscription_cancel",
    );
    const payload = storedCancellationPayloadSchema.parse(challenge.payload);
    if (
      expectedSubscriptionId !== undefined
      && payload.subscriptionId !== expectedSubscriptionId
    ) {
      throw new SupportError(
        "The cancellation challenge belongs to a different support subscription.",
        "support_challenge_invalid",
        409,
      );
    }
    const subscription = await this.requireActiveSubscription(
      payload.subscriptionId,
    );
    if (
      subscription.planId !== payload.planId
      || subscription.payer.toLowerCase() !== payload.payer.toLowerCase()
    ) {
      throw new SupportError(
        "The cancellation challenge no longer matches this subscription.",
        "support_challenge_invalid",
        409,
      );
    }
    const plan = await this.requirePlan(subscription.planId);
    assertPlanMatchesChallenge(plan, challenge);
    const verified = await this.authority.verifyAddressSignature({
      address: subscription.payer,
      message: challenge.message,
      signature,
    });
    const stored = await this.repository.cancelSubscriptionFromChallenge({
      cancelledAt: new Date(this.clock()),
      challenge,
      signatureHash: keccak256(signature),
      verifiedBlock: verified.blockNumber,
      verifiedBlockHash: verified.blockHash,
    });
    const latest = await this.repository.getLatestInvoice(stored.id);
    return {
      plan,
      subscription: stored,
      ...(latest ? { invoice: await this.invoiceView(latest) } : {}),
    };
  }

  async createInvoiceQuote(invoiceId: string): Promise<MarketplaceQuote> {
    return this.repository.withInvoiceLock(invoiceId, async () => {
      const invoice = await this.repository.getInvoice(invoiceId);
      if (!invoice) {
        throw new SupportError(
          "Support invoice was not found.",
          "support_invoice_not_found",
          404,
        );
      }
      const [subscription, plan] = await Promise.all([
        this.requireActiveSubscription(invoice.subscriptionId),
        this.requireActivePlan(invoice.planId),
      ]);
      if (
        subscription.planId !== plan.id
        || invoice.subscriptionId !== subscription.id
        || invoice.payer.toLowerCase() !== subscription.payer.toLowerCase()
        || invoice.boardroom.toLowerCase() !== plan.boardroom.toLowerCase()
        || invoice.asset.toLowerCase() !== plan.asset.toLowerCase()
        || invoice.amount !== plan.amount
        || invoice.status !== "open"
      ) {
        throw new SupportError(
          "The support invoice no longer matches its immutable plan and subscription.",
          "support_invoice_invalid",
          409,
        );
      }
      const currentPeriod = monthlyPeriodAt(
        subscription.startedAt,
        new Date(this.clock()),
      );
      if (
        invoice.periodIndex !== currentPeriod.index
        || invoice.periodStart.getTime() !== currentPeriod.start.getTime()
        || invoice.periodEnd.getTime() !== currentPeriod.end.getTime()
      ) {
        throw new SupportError(
          "This support invoice belongs to an earlier schedule period and is no longer payable.",
          "support_invoice_not_current",
          409,
        );
      }
      await this.requireCurrentPlanAuthority(plan);
      if (
        await this.repository.hasBlockingPayerBoardroomPayment(
          plan.boardroom,
          subscription.payer,
          invoice.id,
        )
      ) {
        throw new SupportError(
          "An earlier support payment from this wallet to the project is still unresolved. Follow that order before paying again.",
          "support_payer_payment_locked",
          409,
        );
      }

      const analysis = await this.analyzeInvoice(invoice);
      if (analysis.publicStatus === "paid") {
        throw new SupportError(
          "This support invoice has already been paid.",
          "support_invoice_paid",
          409,
        );
      }
      if (
        analysis.publicStatus === "payment_pending"
        || analysis.publicStatus === "manual_intervention"
      ) {
        throw new SupportError(
          "This support invoice already has a payment in progress. Follow the existing order instead of paying again.",
          "support_invoice_payment_locked",
          409,
        );
      }
      if (analysis.reusableQuote) return analysis.reusableQuote;

      const quote = await this.quotes.create({
        kind: "recurring_support",
        invoiceId: invoice.id,
        chainId: SUPPORT_CHAIN_ID,
        boardroom: invoice.boardroom,
        payer: invoice.payer,
        recipient: invoice.payer,
        refundAddress: invoice.payer,
        maxSlippageBps: 0,
        amount: invoice.amount,
        expectedFacetSetHash: plan.facetSetHash,
      });
      try {
        await this.repository.linkInvoiceQuote({
          invoiceId: invoice.id,
          quoteId: quote.id,
          createdAt: new Date(this.clock()),
        });
      } catch (error) {
        try {
          const [current, links, binding] = await Promise.all([
            this.repository.getInvoice(invoice.id),
            this.repository.listInvoiceQuotes(invoice.id),
            this.quoteRepository.getPaymentBinding(quote.id),
          ]);
          if (
            current?.status === "open"
            && current.activeQuoteId === quote.id
            && links.some(link => link.quoteId === quote.id)
          ) {
            return quote;
          }
          if (!binding) {
            await this.quoteRepository.releaseQuotedReservations(quote.id);
          }
        } catch {
          // A failed reconciliation is ambiguous. Preserve the reservation so
          // expiry or recovery can resolve it without risking oversubscription.
        }
        throw error;
      }
      return quote;
    });
  }

  async assertQuotePayable(quote: MarketplaceQuote): Promise<void> {
    await this.executionGuard.assertPayable(quote);
  }

  private async issueChallenge(input: {
    action: SupportChallengeAction;
    actor: Address;
    authority: SupportAuthorityIdentity;
    planId: string;
    payload: Record<string, string | number>;
  }): Promise<SupportChallenge> {
    const createdAt = new Date(this.clock());
    const expiresAt = new Date(createdAt.getTime() + CHALLENGE_TTL_MS);
    const id = this.id();
    const payloadHash = hashPayload(input.payload);
    const actor = input.actor.toLowerCase() as Address;
    const boardroom = input.authority.boardroom.toLowerCase() as Address;
    const challenge: SupportChallenge = {
      id,
      action: input.action,
      actor,
      ...(input.action === "plan_create" || input.action === "plan_retire"
        ? {
            authority: input.authority.authority,
            authorityMode: input.authority.mode,
          }
        : {}),
      boardroom,
      chainId: SUPPORT_CHAIN_ID,
      configurationEpoch: input.authority.configurationEpoch,
      controllerGeneration: input.authority.controllerGeneration,
      facetSetHash: input.authority.facetSetHash,
      planId: input.planId,
      payload: input.payload,
      payloadHash,
      message: buildSupportChallengeMessage({
        action: input.action,
        actor,
        boardroom,
        chainId: SUPPORT_CHAIN_ID,
        challengeId: id,
        expiresAt,
        facetSetHash: input.authority.facetSetHash,
        origin: this.config.publicOrigin,
        payloadHash,
        planId: input.planId,
      }),
      issuedBlock: input.authority.blockNumber,
      issuedBlockHash: input.authority.blockHash,
      expiresAt,
      createdAt,
    };
    await this.repository.createChallenge(challenge);
    return challenge;
  }

  private async requireChallenge(
    id: string,
    action: SupportChallengeAction,
  ): Promise<SupportChallenge> {
    const challenge = await this.repository.getChallenge(id);
    if (!challenge || challenge.action !== action) {
      throw new SupportError(
        "Recurring-support challenge was not found.",
        "support_challenge_not_found",
        404,
      );
    }
    const now = this.clock();
    if (challenge.consumedAt) {
      throw new SupportError(
        "The recurring-support challenge has already been used.",
        "support_challenge_consumed",
        409,
      );
    }
    if (challenge.expiresAt.getTime() <= now) {
      throw new SupportError(
        "The recurring-support challenge has expired.",
        "support_challenge_expired",
        410,
      );
    }
    if (
      hashPayload(challenge.payload).toLowerCase()
        !== challenge.payloadHash.toLowerCase()
      || typeof challenge.payload.facetSetHash !== "string"
      || challenge.payload.facetSetHash.toLowerCase()
        !== challenge.facetSetHash.toLowerCase()
      || buildSupportChallengeMessage({
        action: challenge.action,
        actor: challenge.actor,
        boardroom: challenge.boardroom,
        chainId: challenge.chainId,
        challengeId: challenge.id,
        expiresAt: challenge.expiresAt,
        facetSetHash: challenge.facetSetHash,
        origin: this.config.publicOrigin,
        payloadHash: challenge.payloadHash,
        planId: challenge.planId,
      }) !== challenge.message
    ) {
      throw new SupportError(
        "Stored recurring-support challenge integrity check failed.",
        "support_challenge_invalid",
        503,
      );
    }
    return challenge;
  }

  private async requirePlan(id: string): Promise<SupportPlan> {
    const plan = await this.repository.getPlan(id);
    if (!plan) {
      throw new SupportError(
        "Support plan was not found.",
        "support_plan_not_found",
        404,
      );
    }
    return plan;
  }

  private async requireActivePlan(id: string): Promise<SupportPlan> {
    const plan = await this.requirePlan(id);
    if (plan.status !== "active") {
      throw new SupportError(
        "Support plan is retired.",
        "support_plan_not_active",
        409,
      );
    }
    return plan;
  }

  private async requireActiveSubscription(
    id: string,
  ): Promise<SupportSubscription> {
    const subscription = await this.repository.getSubscription(id);
    if (!subscription) {
      throw new SupportError(
        "Support subscription was not found.",
        "support_subscription_not_found",
        404,
      );
    }
    if (subscription.status !== "active") {
      throw new SupportError(
        "Support subscription is cancelled.",
        "support_subscription_not_active",
        409,
      );
    }
    return subscription;
  }

  private async requireCurrentPlanAuthority(
    plan: SupportPlan,
  ): Promise<SupportAuthorityIdentity> {
    const expected = authorityFromPlan(plan);
    const current = await this.authority.resolve(plan.boardroom);
    if (
      current.authority.toLowerCase() !== expected.authority.toLowerCase()
      || current.mode !== expected.mode
      || current.controllerGeneration !== expected.controllerGeneration
      || current.configurationEpoch !== expected.configurationEpoch
      || current.facetSetHash.toLowerCase()
        !== expected.facetSetHash.toLowerCase()
    ) {
      throw new SupportError(
        "The Boardroom authority changed after this support plan was published.",
        "support_authority_stale",
        409,
      );
    }
    return current;
  }

  private async invoiceView(
    invoice: SupportInvoice,
  ): Promise<SupportInvoiceView> {
    const analysis = await this.analyzeInvoice(invoice);
    const publicStatus =
      analysis.publicStatus === "open" && invoice.status === "cancelled"
        ? "cancelled"
        : analysis.publicStatus;
    return {
      ...invoice,
      publicStatus,
      ...(analysis.latestQuoteId
        ? { latestQuoteId: analysis.latestQuoteId }
        : {}),
      ...(analysis.lastAttemptStatus
        ? { lastAttemptStatus: analysis.lastAttemptStatus }
        : {}),
    };
  }

  private async analyzeInvoice(invoice: SupportInvoice): Promise<{
    publicStatus:
      | "open"
      | "payment_pending"
      | "paid"
      | "manual_intervention";
    latestQuoteId?: string;
    lastAttemptStatus?: "refunded" | "payment_failed";
    reusableQuote?: MarketplaceQuote;
  }> {
    const links = await this.repository.listInvoiceQuotes(invoice.id);
    if (
      (invoice.activeQuoteId === undefined && links.length > 0)
      || (
        invoice.activeQuoteId !== undefined
        && !links.some(link => link.quoteId === invoice.activeQuoteId)
      )
    ) {
      return {
        publicStatus: "manual_intervention",
        ...(invoice.activeQuoteId
          ? { latestQuoteId: invoice.activeQuoteId }
          : {}),
      };
    }
    const orderedLinks = invoice.activeQuoteId === undefined
      ? links
      : [
          ...links.filter(link => link.quoteId === invoice.activeQuoteId),
          ...links.filter(link => link.quoteId !== invoice.activeQuoteId),
        ];
    let latestQuoteId: string | undefined = invoice.activeQuoteId;
    let lastAttemptStatus: "refunded" | "payment_failed" | undefined;
    let reusableQuote: MarketplaceQuote | undefined;
    for (const link of orderedLinks) {
      latestQuoteId ??= link.quoteId;
      const quote = await this.quoteRepository.get(link.quoteId);
      if (!quote || quote.supportInvoiceId !== invoice.id) {
        return {
          publicStatus: "manual_intervention",
          latestQuoteId: link.quoteId,
        };
      }
      const order = await this.orders.getByQuoteId(quote.id);
      if (order?.status === "executed") {
        return { publicStatus: "paid", latestQuoteId: quote.id };
      }
      if (order?.status === "manual_intervention") {
        return {
          publicStatus: "manual_intervention",
          latestQuoteId: quote.id,
        };
      }
      if (order && order.status !== "refunded") {
        return {
          publicStatus: "payment_pending",
          latestQuoteId: quote.id,
        };
      }
      if (order?.status === "refunded") {
        lastAttemptStatus ??= "refunded";
        continue;
      }

      const attempt = await this.paymentAttempts.paymentAttempt(quote.id);
      if (attempt?.status === "prepared" || attempt?.status === "settled") {
        return {
          publicStatus: "payment_pending",
          latestQuoteId: quote.id,
        };
      }
      if (attempt?.status === "failed") {
        lastAttemptStatus ??= "payment_failed";
        continue;
      }
      const binding = await this.quoteRepository.getPaymentBinding(quote.id);
      if (binding) {
        return {
          publicStatus: "payment_pending",
          latestQuoteId: quote.id,
        };
      }
      if (quote.expiresAt.getTime() > this.clock()) {
        if (quote.id !== invoice.activeQuoteId) {
          return {
            publicStatus: "manual_intervention",
            latestQuoteId: invoice.activeQuoteId ?? link.quoteId,
          };
        }
        reusableQuote = quote;
      } else {
        await this.quoteRepository.releaseQuotedReservations(quote.id);
        lastAttemptStatus ??= "payment_failed";
      }
    }
    return {
      publicStatus: "open",
      ...(latestQuoteId ? { latestQuoteId } : {}),
      ...(lastAttemptStatus ? { lastAttemptStatus } : {}),
      ...(reusableQuote ? { reusableQuote } : {}),
    };
  }
}

export function buildSupportChallengeMessage(input: {
  action: SupportChallengeAction;
  actor: Address;
  boardroom: Address;
  chainId: typeof SUPPORT_CHAIN_ID;
  challengeId: string;
  expiresAt: Date;
  facetSetHash: Hex;
  origin: string;
  payloadHash: Hex;
  planId: string;
}): string {
  const action = actionLabel(input.action);
  const scope = input.action === "subscription_create"
    ? "This records a monthly schedule. It cannot move funds or approve future payments."
    : input.action === "subscription_cancel"
      ? "This stops future unpaid invoices. It cannot reverse a settled payment."
      : input.action === "plan_create"
        ? "This publishes immutable support terms for this Boardroom."
        : "This retires the plan and stops new invoices.";
  return [
    "pledge.cash recurring support",
    "",
    `Action: ${action}`,
    `Actor: ${input.actor}`,
    `Chain ID: ${input.chainId}`,
    `Boardroom: ${input.boardroom}`,
    `Facet set hash: ${input.facetSetHash}`,
    `Plan ID: ${input.planId}`,
    `Payload hash: ${input.payloadHash}`,
    `Challenge ID: ${input.challengeId}`,
    `Origin: ${input.origin}`,
    `Expires at: ${input.expiresAt.toISOString()}`,
    "",
    scope,
    "Every contribution still requires a separate x402 payment signature.",
  ].join("\n");
}

function createInvoice(input: {
  id: string;
  now: Date;
  plan: SupportPlan;
  subscription: SupportSubscription;
}): SupportInvoice {
  const period = monthlyPeriodAt(input.subscription.startedAt, input.now);
  return {
    id: input.id,
    subscriptionId: input.subscription.id,
    planId: input.plan.id,
    periodIndex: period.index,
    periodStart: period.start,
    periodEnd: period.end,
    dueAt: period.start,
    payer: input.subscription.payer,
    boardroom: input.plan.boardroom,
    asset: input.plan.asset,
    amount: input.plan.amount,
    status: "open",
    createdAt: input.now,
  };
}

function invoiceMaterializationIsPaused(error: unknown): boolean {
  return error instanceof SupportError
    && (
      error.code === "boardroom_not_active"
      || error.code === "support_asset_not_registered"
      || error.code === "support_authority_stale"
      || error.code === "boardroom_migration_required"
    );
}

function authorityFromChallenge(
  challenge: SupportChallenge,
): SupportAuthorityIdentity {
  if (!challenge.authorityMode || !challenge.authority) {
    throw new SupportError(
      "The project-authority challenge is malformed.",
      "support_challenge_invalid",
      503,
    );
  }
  return {
    authority: challenge.authority,
    blockHash: challenge.issuedBlockHash,
    blockNumber: challenge.issuedBlock,
    boardroom: challenge.boardroom,
    chainId: SUPPORT_CHAIN_ID,
    configurationEpoch: challenge.configurationEpoch,
    controllerGeneration: challenge.controllerGeneration,
    facetSetHash: challenge.facetSetHash,
    mode: challenge.authorityMode,
  };
}

function authorityFromPlan(plan: SupportPlan): SupportAuthorityIdentity {
  return {
    authority: plan.authority,
    blockHash: plan.verifiedBlockHash,
    blockNumber: plan.verifiedBlock,
    boardroom: plan.boardroom,
    chainId: SUPPORT_CHAIN_ID,
    configurationEpoch: plan.configurationEpoch,
    controllerGeneration: plan.controllerGeneration,
    facetSetHash: plan.facetSetHash,
    mode: plan.authorityMode,
  };
}

function assertPlanMatchesChallenge(
  plan: SupportPlan,
  challenge: SupportChallenge,
): void {
  if (
    plan.id !== challenge.planId
    || plan.boardroom.toLowerCase() !== challenge.boardroom.toLowerCase()
    || plan.facetSetHash.toLowerCase() !== challenge.facetSetHash.toLowerCase()
  ) {
    throw new SupportError(
      "The recurring-support challenge no longer matches this plan.",
      "support_challenge_invalid",
      409,
    );
  }
}

function assertRetirementPlanMatchesChallenge(
  plan: SupportPlan,
  challenge: SupportChallenge,
  payload: z.infer<typeof storedRetirementPayloadSchema>,
): void {
  if (
    plan.id !== challenge.planId
    || plan.id !== payload.planId
    || plan.boardroom.toLowerCase() !== challenge.boardroom.toLowerCase()
    || plan.boardroom.toLowerCase() !== payload.boardroom.toLowerCase()
    || plan.facetSetHash.toLowerCase()
      !== payload.planFacetSetHash.toLowerCase()
  ) {
    throw new SupportError(
      "The recurring-support challenge no longer matches this plan.",
      "support_challenge_invalid",
      409,
    );
  }
}

function hashPayload(value: unknown): Hex {
  return keccak256(stringToHex(JSON.stringify(canonicalJson(value))));
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)]),
  );
}

function actionLabel(action: SupportChallengeAction): string {
  if (action === "plan_create") return "Publish support plan";
  if (action === "plan_retire") return "Retire support plan";
  if (action === "subscription_create") return "Create support subscription";
  return "Cancel support subscription";
}

export const supportServiceSchemas = {
  storedCancellationPayloadSchema,
  storedPlanPayloadSchema,
  storedRetirementPayloadSchema,
  storedSubscriptionPayloadSchema,
  supportAmountSchema,
};
