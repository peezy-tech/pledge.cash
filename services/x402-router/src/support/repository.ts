import type { Sql, TransactionSql } from "postgres";
import type { Address, Hex } from "viem";
import type { JsonRecord } from "../db/schema";
import {
  SupportError,
  type SupportChallenge,
  type SupportInvoice,
  type SupportInvoiceQuote,
  type SupportPlan,
  type SupportRepository,
  type SupportSubscription,
} from "./domain";
import {
  supportInvoiceLockKey,
  supportPayerBoardroomPaymentLockKey,
} from "./lock";

type ChallengeRow = {
  id: string;
  action: SupportChallenge["action"];
  actor: string;
  boardroom: string;
  chain_id: number;
  authority_mode: SupportChallenge["authorityMode"] | null;
  authority: string | null;
  controller_generation: string;
  configuration_epoch: string;
  plan_id: string;
  payload: JsonRecord;
  payload_hash: string;
  message: string;
  issued_block: string;
  issued_block_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
};

type PlanRow = {
  id: string;
  chain_id: number;
  boardroom: string;
  asset: string;
  amount: string;
  cadence: string;
  title: string;
  description: string;
  terms_hash: string;
  status: SupportPlan["status"];
  authority_mode: SupportPlan["authorityMode"];
  authority: string;
  controller_generation: string;
  configuration_epoch: string;
  verified_block: string;
  verified_block_hash: string;
  created_at: Date;
  retired_at: Date | null;
};

type SubscriptionRow = {
  id: string;
  plan_id: string;
  payer: string;
  status: SupportSubscription["status"];
  started_at: Date;
  created_at: Date;
  cancelled_at: Date | null;
};

type InvoiceRow = {
  id: string;
  subscription_id: string;
  plan_id: string;
  active_quote_id: string | null;
  period_index: number;
  period_start: Date;
  period_end: Date;
  due_at: Date;
  payer: string;
  boardroom: string;
  asset: string;
  amount: string;
  status: SupportInvoice["status"];
  created_at: Date;
  cancelled_at: Date | null;
};

type InvoiceQuoteRow = {
  invoice_id: string;
  quote_id: string;
  created_at: Date;
};

export class PostgresSupportRepository implements SupportRepository {
  constructor(
    private readonly sql: Sql,
    private readonly coordinationSql: Sql = sql,
  ) {}

  async createChallenge(challenge: SupportChallenge): Promise<void> {
    await this.sql`
      insert into x402_router_support_challenges (
        id,
        action,
        actor,
        boardroom,
        chain_id,
        authority_mode,
        authority,
        controller_generation,
        configuration_epoch,
        plan_id,
        payload,
        payload_hash,
        message,
        issued_block,
        issued_block_hash,
        expires_at,
        created_at
      ) values (
        ${challenge.id},
        ${challenge.action},
        ${lower(challenge.actor)},
        ${lower(challenge.boardroom)},
        ${challenge.chainId},
        ${challenge.authorityMode ?? null},
        ${challenge.authority ? lower(challenge.authority) : null},
        ${challenge.controllerGeneration.toString()},
        ${challenge.configurationEpoch.toString()},
        ${challenge.planId},
        ${this.sql.json(challenge.payload)},
        ${lower(challenge.payloadHash)},
        ${challenge.message},
        ${challenge.issuedBlock.toString()},
        ${lower(challenge.issuedBlockHash)},
        ${challenge.expiresAt.toISOString()},
        ${challenge.createdAt.toISOString()}
      )
    `;
  }

  async pruneExpiredChallenges(input: {
    before: Date;
    limit: number;
  }): Promise<number> {
    if (Number.isNaN(input.before.getTime())) {
      throw new Error("Support challenge prune cutoff must be a valid date.");
    }
    if (
      !Number.isSafeInteger(input.limit)
      || input.limit <= 0
      || input.limit > 1_000
    ) {
      throw new Error(
        "Support challenge prune limit must be between 1 and 1000.",
      );
    }
    const rows = await this.sql<Array<{ id: string }>>`
      with expired as (
        select id
        from x402_router_support_challenges
        where consumed_at is null
          and expires_at <= ${input.before.toISOString()}
        order by expires_at asc, id asc
        limit ${input.limit}
        for update skip locked
      )
      delete from x402_router_support_challenges challenge
      using expired
      where challenge.id = expired.id
      returning challenge.id
    `;
    return rows.length;
  }

  async getChallenge(id: string): Promise<SupportChallenge | undefined> {
    const rows = await this.sql<ChallengeRow[]>`
      select
        id,
        action,
        actor,
        boardroom,
        chain_id,
        authority_mode,
        authority,
        controller_generation::text,
        configuration_epoch::text,
        plan_id,
        payload,
        payload_hash,
        message,
        issued_block::text,
        issued_block_hash,
        expires_at,
        consumed_at,
        created_at
      from x402_router_support_challenges
      where id = ${id}
      limit 1
    `;
    return rows[0] ? challengeFromRow(rows[0]) : undefined;
  }

  async createPlanFromChallenge(input: {
    challenge: SupportChallenge;
    plan: SupportPlan;
    signatureHash: Hex;
  }): Promise<SupportPlan> {
    return this.sql.begin(async transaction => {
      await claimChallenge(transaction, {
        challenge: input.challenge,
        consumedAt: input.plan.createdAt,
        signatureHash: input.signatureHash,
        verifiedBlock: input.plan.verifiedBlock,
        verifiedBlockHash: input.plan.verifiedBlockHash,
      });
      const rows = await transaction<PlanRow[]>`
        insert into x402_router_support_plans (
          id,
          chain_id,
          boardroom,
          asset,
          amount,
          cadence,
          title,
          description,
          terms_hash,
          status,
          authority_mode,
          authority,
          controller_generation,
          configuration_epoch,
          verified_block,
          verified_block_hash,
          created_at
        ) values (
          ${input.plan.id},
          ${input.plan.chainId},
          ${lower(input.plan.boardroom)},
          ${lower(input.plan.asset)},
          ${input.plan.amount},
          ${input.plan.cadence},
          ${input.plan.title},
          ${input.plan.description},
          ${lower(input.plan.termsHash)},
          'active',
          ${input.plan.authorityMode},
          ${lower(input.plan.authority)},
          ${input.plan.controllerGeneration.toString()},
          ${input.plan.configurationEpoch.toString()},
          ${input.plan.verifiedBlock.toString()},
          ${lower(input.plan.verifiedBlockHash)},
          ${input.plan.createdAt.toISOString()}
        )
        returning
          id,
          chain_id,
          boardroom,
          asset,
          amount::text,
          cadence,
          title,
          description,
          terms_hash,
          status,
          authority_mode,
          authority,
          controller_generation::text,
          configuration_epoch::text,
          verified_block::text,
          verified_block_hash,
          created_at,
          retired_at
      `;
      const row = rows[0];
      if (!row) throw new Error("Support plan insert returned no row");
      return planFromRow(row);
    });
  }

  async retirePlanFromChallenge(input: {
    challenge: SupportChallenge;
    retiredAt: Date;
    signatureHash: Hex;
    verified: {
      blockNumber: bigint;
      blockHash: Hex;
    };
  }): Promise<SupportPlan> {
    return this.sql.begin(async transaction => {
      await claimChallenge(transaction, {
        challenge: input.challenge,
        consumedAt: input.retiredAt,
        signatureHash: input.signatureHash,
        verifiedBlock: input.verified.blockNumber,
        verifiedBlockHash: input.verified.blockHash,
      });
      const rows = await transaction<PlanRow[]>`
        update x402_router_support_plans
        set status = 'retired',
            retired_at = ${input.retiredAt.toISOString()}
        where id = ${input.challenge.planId}
          and status = 'active'
        returning
          id,
          chain_id,
          boardroom,
          asset,
          amount::text,
          cadence,
          title,
          description,
          terms_hash,
          status,
          authority_mode,
          authority,
          controller_generation::text,
          configuration_epoch::text,
          verified_block::text,
          verified_block_hash,
          created_at,
          retired_at
      `;
      const row = rows[0];
      if (!row) {
        throw new SupportError(
          "The support plan is already retired.",
          "support_plan_not_active",
          409,
        );
      }
      await transaction`
        update x402_router_support_invoices invoice
        set status = 'cancelled',
            cancelled_at = ${input.retiredAt.toISOString()}
        where invoice.plan_id = ${input.challenge.planId}
          and invoice.status = 'open'
      `;
      return planFromRow(row);
    });
  }

  async createSubscriptionFromChallenge(input: {
    challenge: SupportChallenge;
    invoice: SupportInvoice;
    signatureHash: Hex;
    subscription: SupportSubscription;
    verifiedBlock: bigint;
    verifiedBlockHash: Hex;
  }): Promise<SupportSubscription> {
    return this.sql.begin(async transaction => {
      await claimChallenge(transaction, {
        challenge: input.challenge,
        consumedAt: input.subscription.createdAt,
        signatureHash: input.signatureHash,
        verifiedBlock: input.verifiedBlock,
        verifiedBlockHash: input.verifiedBlockHash,
      });
      await transaction`
        select pg_advisory_xact_lock(
          hashtextextended(
            ${supportPayerBoardroomPaymentLockKey(
              input.invoice.boardroom,
              input.subscription.payer,
            )},
            0
          )
        )
      `;
      const plans = await transaction<
        Array<{
          boardroom: string;
          status: SupportPlan["status"];
        }>
      >`
        select boardroom, status
        from x402_router_support_plans
        where id = ${input.subscription.planId}
        limit 1
        for update
      `;
      if (
        plans[0]?.status !== "active"
        || plans[0].boardroom !== lower(input.invoice.boardroom)
      ) {
        throw new SupportError(
          "Support plan is no longer active.",
          "support_plan_not_active",
          409,
        );
      }
      if (
        await hasBlockingPayerBoardroomPayment(transaction, {
          boardroom: input.invoice.boardroom,
          exceptInvoiceId: input.invoice.id,
          payer: input.subscription.payer,
        })
      ) {
        throw new SupportError(
          "An earlier support payment for this project is still unresolved. Recover that order before starting another schedule.",
          "support_payer_payment_locked",
          409,
        );
      }
      const rows = await transaction<SubscriptionRow[]>`
        insert into x402_router_support_subscriptions (
          id,
          plan_id,
          payer,
          status,
          started_at,
          created_at
        ) values (
          ${input.subscription.id},
          ${input.subscription.planId},
          ${lower(input.subscription.payer)},
          'active',
          ${input.subscription.startedAt.toISOString()},
          ${input.subscription.createdAt.toISOString()}
        )
        on conflict (plan_id, payer) where status = 'active' do nothing
        returning
          id,
          plan_id,
          payer,
          status,
          started_at,
          created_at,
          cancelled_at
      `;
      const row = rows[0];
      if (!row) {
        throw new SupportError(
          "This wallet already has an active subscription to the support plan.",
          "support_subscription_exists",
          409,
        );
      }
      await insertInvoice(transaction, input.invoice);
      return subscriptionFromRow(row);
    });
  }

  async cancelSubscriptionFromChallenge(input: {
    cancelledAt: Date;
    challenge: SupportChallenge;
    signatureHash: Hex;
    verifiedBlock: bigint;
    verifiedBlockHash: Hex;
  }): Promise<SupportSubscription> {
    return this.sql.begin(async transaction => {
      await claimChallenge(transaction, {
        challenge: input.challenge,
        consumedAt: input.cancelledAt,
        signatureHash: input.signatureHash,
        verifiedBlock: input.verifiedBlock,
        verifiedBlockHash: input.verifiedBlockHash,
      });
      const subscriptionId = stringField(
        input.challenge.payload,
        "subscriptionId",
      );
      const rows = await transaction<SubscriptionRow[]>`
        update x402_router_support_subscriptions
        set status = 'cancelled',
            cancelled_at = ${input.cancelledAt.toISOString()}
        where id = ${subscriptionId}
          and status = 'active'
        returning
          id,
          plan_id,
          payer,
          status,
          started_at,
          created_at,
          cancelled_at
      `;
      const row = rows[0];
      if (!row) {
        throw new SupportError(
          "The support subscription is already cancelled.",
          "support_subscription_not_active",
          409,
        );
      }
      await transaction`
        update x402_router_support_invoices
        set status = 'cancelled',
            cancelled_at = ${input.cancelledAt.toISOString()}
        where subscription_id = ${subscriptionId}
          and status = 'open'
      `;
      return subscriptionFromRow(row);
    });
  }

  async listPlans(
    boardroom: Address,
    limit: number,
    payer?: Address,
  ): Promise<readonly SupportPlan[]> {
    const rows = await this.sql<PlanRow[]>`
      select
        id,
        chain_id,
        boardroom,
        asset,
        amount::text,
        cadence,
        title,
        description,
        terms_hash,
        status,
        authority_mode,
        authority,
        controller_generation::text,
        configuration_epoch::text,
        verified_block::text,
        verified_block_hash,
        created_at,
        retired_at
      from x402_router_support_plans
      where chain_id = 998
        and boardroom = ${lower(boardroom)}
      order by (status = 'active') desc, created_at desc, id desc
      limit ${limit}
    `;
    if (!payer) return rows.map(planFromRow);

    const subscribedRows = await this.sql<PlanRow[]>`
      select
        plan.id,
        plan.chain_id,
        plan.boardroom,
        plan.asset,
        plan.amount::text,
        plan.cadence,
        plan.title,
        plan.description,
        plan.terms_hash,
        plan.status,
        plan.authority_mode,
        plan.authority,
        plan.controller_generation::text,
        plan.configuration_epoch::text,
        plan.verified_block::text,
        plan.verified_block_hash,
        plan.created_at,
        plan.retired_at
      from x402_router_support_plans plan
      where plan.chain_id = 998
        and plan.boardroom = ${lower(boardroom)}
        and exists (
          select 1
          from x402_router_support_subscriptions subscription
          where subscription.plan_id = plan.id
            and subscription.payer = ${lower(payer)}
            and subscription.status = 'active'
        )
      order by (plan.status = 'active') desc, plan.created_at desc, plan.id desc
      limit ${limit}
    `;
    const subscribedIds = new Set(subscribedRows.map(row => row.id));
    return [
      ...subscribedRows.map(planFromRow),
      ...rows
        .filter(row => !subscribedIds.has(row.id))
        .map(planFromRow),
    ].slice(0, limit);
  }

  async getPlan(id: string): Promise<SupportPlan | undefined> {
    const rows = await this.sql<PlanRow[]>`
      select
        id,
        chain_id,
        boardroom,
        asset,
        amount::text,
        cadence,
        title,
        description,
        terms_hash,
        status,
        authority_mode,
        authority,
        controller_generation::text,
        configuration_epoch::text,
        verified_block::text,
        verified_block_hash,
        created_at,
        retired_at
      from x402_router_support_plans
      where id = ${id}
      limit 1
    `;
    return rows[0] ? planFromRow(rows[0]) : undefined;
  }

  async getSubscription(
    id: string,
  ): Promise<SupportSubscription | undefined> {
    const rows = await this.sql<SubscriptionRow[]>`
      select
        id,
        plan_id,
        payer,
        status,
        started_at,
        created_at,
        cancelled_at
      from x402_router_support_subscriptions
      where id = ${id}
      limit 1
    `;
    return rows[0] ? subscriptionFromRow(rows[0]) : undefined;
  }

  async getInvoice(id: string): Promise<SupportInvoice | undefined> {
    const rows = await this.sql<InvoiceRow[]>`
      select
        id,
        subscription_id,
        plan_id,
        active_quote_id,
        period_index,
        period_start,
        period_end,
        due_at,
        payer,
        boardroom,
        asset,
        amount::text,
        status,
        created_at,
        cancelled_at
      from x402_router_support_invoices
      where id = ${id}
      limit 1
    `;
    return rows[0] ? invoiceFromRow(rows[0]) : undefined;
  }

  async getLatestInvoice(
    subscriptionId: string,
  ): Promise<SupportInvoice | undefined> {
    const rows = await this.sql<InvoiceRow[]>`
      select
        id,
        subscription_id,
        plan_id,
        active_quote_id,
        period_index,
        period_start,
        period_end,
        due_at,
        payer,
        boardroom,
        asset,
        amount::text,
        status,
        created_at,
        cancelled_at
      from x402_router_support_invoices
      where subscription_id = ${subscriptionId}
      order by period_index desc
      limit 1
    `;
    return rows[0] ? invoiceFromRow(rows[0]) : undefined;
  }

  async getBlockingSubscriptionInvoice(
    subscriptionId: string,
  ): Promise<SupportInvoice | undefined> {
    const rows = await this.sql<InvoiceRow[]>`
      select
        invoice.id,
        invoice.subscription_id,
        invoice.plan_id,
        invoice.active_quote_id,
        invoice.period_index,
        invoice.period_start,
        invoice.period_end,
        invoice.due_at,
        invoice.payer,
        invoice.boardroom,
        invoice.asset,
        invoice.amount::text,
        invoice.status,
        invoice.created_at,
        invoice.cancelled_at
      from x402_router_support_invoices invoice
      where invoice.subscription_id = ${subscriptionId}
        and exists (
          select 1
          from x402_router_support_invoice_quotes link
          join x402_router_quote_payment_bindings binding
            on binding.quote_id = link.quote_id
          left join x402_router_intent_payments intent
            on intent.quote_id = link.quote_id
            and intent.primary_payment
          left join x402_router_adapter_operations settlement
            on settlement.kind = 'payment_settlement'
            and settlement.idempotency_key = binding.attempt_id
          where link.invoice_id = invoice.id
            and not (
              coalesce(intent.status in ('executed', 'refunded'), false)
              or (
                intent.quote_id is null
                and coalesce(settlement.status = 'confirmed_failure', false)
              )
            )
        )
      order by invoice.period_index asc, invoice.created_at asc, invoice.id asc
      limit 1
    `;
    return rows[0] ? invoiceFromRow(rows[0]) : undefined;
  }

  async getOrCreateInvoice(invoice: SupportInvoice): Promise<SupportInvoice> {
    return this.sql.begin(async transaction => {
      await transaction`
        select pg_advisory_xact_lock(
          hashtextextended(${invoice.subscriptionId}, 0)
        )
      `;
      const subscriptions = await transaction<
        Array<{
          plan_id: string;
          plan_status: SupportPlan["status"];
          subscription_status: SupportSubscription["status"];
        }>
      >`
        select
          subscription.plan_id,
          subscription.status as subscription_status,
          plan.status as plan_status
        from x402_router_support_subscriptions subscription
        join x402_router_support_plans plan on plan.id = subscription.plan_id
        where subscription.id = ${invoice.subscriptionId}
        limit 1
        for update of subscription, plan
      `;
      const state = subscriptions[0];
      if (
        !state
        || state.plan_id !== invoice.planId
        || state.subscription_status !== "active"
        || state.plan_status !== "active"
      ) {
        throw new SupportError(
          "The support schedule is no longer active.",
          "support_subscription_not_active",
          409,
        );
      }
      const existing = await transaction<InvoiceRow[]>`
        select
          id,
          subscription_id,
          plan_id,
          active_quote_id,
          period_index,
          period_start,
          period_end,
          due_at,
          payer,
          boardroom,
          asset,
          amount::text,
          status,
          created_at,
          cancelled_at
        from x402_router_support_invoices
        where subscription_id = ${invoice.subscriptionId}
          and period_index = ${invoice.periodIndex}
        limit 1
      `;
      if (existing[0]) return invoiceFromRow(existing[0]);
      const inserted = await insertInvoice(transaction, invoice);
      return invoiceFromRow(inserted);
    });
  }

  async listInvoiceQuotes(
    invoiceId: string,
  ): Promise<readonly SupportInvoiceQuote[]> {
    const rows = await this.sql<InvoiceQuoteRow[]>`
      select invoice_id, quote_id, created_at
      from x402_router_support_invoice_quotes
      where invoice_id = ${invoiceId}
      order by created_at desc, quote_id desc
      limit 50
    `;
    return rows.map(invoiceQuoteFromRow);
  }

  async hasBlockingPayerBoardroomPayment(
    boardroom: Address,
    payer: Address,
    exceptInvoiceId: string,
  ): Promise<boolean> {
    return hasBlockingPayerBoardroomPayment(this.sql, {
      boardroom,
      exceptInvoiceId,
      payer,
    });
  }

  async linkInvoiceQuote(link: SupportInvoiceQuote): Promise<void> {
    await this.sql.begin(async transaction => {
      const invoices = await transaction<
        Array<{ id: string; status: SupportInvoice["status"] }>
      >`
        select id, status
        from x402_router_support_invoices
        where id = ${link.invoiceId}
        limit 1
        for update
      `;
      const invoice = invoices[0];
      if (!invoice) {
        throw new SupportError(
          "Support invoice was not found.",
          "support_invoice_not_found",
          404,
        );
      }
      if (invoice.status !== "open") {
        throw new SupportError(
          "The support invoice is no longer open.",
          "support_invoice_not_open",
          409,
        );
      }
      await transaction`
        insert into x402_router_support_invoice_quotes (
          invoice_id,
          quote_id,
          created_at
        ) values (
          ${link.invoiceId},
          ${link.quoteId},
          ${link.createdAt.toISOString()}
        )
      `;
      const updated = await transaction<Array<{ id: string }>>`
        update x402_router_support_invoices
        set active_quote_id = ${link.quoteId}
        where id = ${link.invoiceId}
          and status = 'open'
        returning id
      `;
      if (!updated[0]) {
        throw new SupportError(
          "The support invoice changed while its quote was created.",
          "support_invoice_conflict",
          409,
        );
      }
    });
  }

  async withInvoiceLock<T>(
    invoiceId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    return this.coordinationSql.begin(async transaction => {
      await transaction`
        select pg_advisory_xact_lock(
          hashtextextended(${supportInvoiceLockKey(invoiceId)}, 0)
        )
      `;
      return action();
    }) as Promise<T>;
  }
}

async function hasBlockingPayerBoardroomPayment(
  database: Sql | TransactionSql,
  input: {
    boardroom: Address;
    exceptInvoiceId: string;
    payer: Address;
  },
): Promise<boolean> {
  const rows = await database<Array<{ blocked: boolean }>>`
    select exists (
      select 1
      from x402_router_support_invoices invoice
      join x402_router_support_invoice_quotes link
        on link.invoice_id = invoice.id
      join x402_router_quote_payment_bindings binding
        on binding.quote_id = link.quote_id
      left join x402_router_intent_payments intent
        on intent.quote_id = link.quote_id
        and intent.primary_payment
      left join x402_router_adapter_operations settlement
        on settlement.kind = 'payment_settlement'
        and settlement.idempotency_key = binding.attempt_id
      where invoice.boardroom = ${lower(input.boardroom)}
        and invoice.payer = ${lower(input.payer)}
        and invoice.id <> ${input.exceptInvoiceId}
        and not (
          coalesce(intent.status in ('executed', 'refunded'), false)
          or (
            intent.quote_id is null
            and coalesce(settlement.status = 'confirmed_failure', false)
          )
        )
    ) as blocked
  `;
  return rows[0]?.blocked ?? true;
}

async function claimChallenge(
  transaction: TransactionSql,
  input: {
    challenge: SupportChallenge;
    consumedAt: Date;
    signatureHash: Hex;
    verifiedBlock: bigint;
    verifiedBlockHash: Hex;
  },
): Promise<void> {
  await transaction`
    select pg_advisory_xact_lock(
      hashtextextended(${JSON.stringify(["support-challenge", input.challenge.id])}, 0)
    )
  `;
  const rows = await transaction<ChallengeRow[]>`
    select
      id,
      action,
      actor,
      boardroom,
      chain_id,
      authority_mode,
      authority,
      controller_generation::text,
      configuration_epoch::text,
      plan_id,
      payload,
      payload_hash,
      message,
      issued_block::text,
      issued_block_hash,
      expires_at,
      consumed_at,
      created_at
    from x402_router_support_challenges
    where id = ${input.challenge.id}
    limit 1
    for update
  `;
  const row = rows[0];
  if (!row || !sameChallenge(challengeFromRow(row), input.challenge)) {
    throw new SupportError(
      "The recurring-support challenge is missing or inconsistent.",
      "support_challenge_invalid",
      409,
    );
  }
  if (row.consumed_at) {
    throw new SupportError(
      "The recurring-support challenge has already been used.",
      "support_challenge_consumed",
      409,
    );
  }
  if (row.expires_at.getTime() <= input.consumedAt.getTime()) {
    throw new SupportError(
      "The recurring-support challenge has expired.",
      "support_challenge_expired",
      410,
    );
  }
  const updated = await transaction<Array<{ id: string }>>`
    update x402_router_support_challenges
    set consumed_at = ${input.consumedAt.toISOString()},
        signature_hash = ${lower(input.signatureHash)},
        verified_block = ${input.verifiedBlock.toString()},
        verified_block_hash = ${lower(input.verifiedBlockHash)}
    where id = ${input.challenge.id}
      and consumed_at is null
      and expires_at > ${input.consumedAt.toISOString()}
    returning id
  `;
  if (!updated[0]) {
    throw new SupportError(
      "The recurring-support challenge could not be consumed.",
      "support_challenge_conflict",
      409,
    );
  }
}

async function insertInvoice(
  transaction: TransactionSql,
  invoice: SupportInvoice,
): Promise<InvoiceRow> {
  const rows = await transaction<InvoiceRow[]>`
    insert into x402_router_support_invoices (
      id,
      subscription_id,
      plan_id,
      period_index,
      period_start,
      period_end,
      due_at,
      payer,
      boardroom,
      asset,
      amount,
      status,
      created_at
    ) values (
      ${invoice.id},
      ${invoice.subscriptionId},
      ${invoice.planId},
      ${invoice.periodIndex},
      ${invoice.periodStart.toISOString()},
      ${invoice.periodEnd.toISOString()},
      ${invoice.dueAt.toISOString()},
      ${lower(invoice.payer)},
      ${lower(invoice.boardroom)},
      ${lower(invoice.asset)},
      ${invoice.amount},
      ${invoice.status},
      ${invoice.createdAt.toISOString()}
    )
    returning
      id,
      subscription_id,
      plan_id,
      active_quote_id,
      period_index,
      period_start,
      period_end,
      due_at,
      payer,
      boardroom,
      asset,
      amount::text,
      status,
      created_at,
      cancelled_at
  `;
  const row = rows[0];
  if (!row) throw new Error("Support invoice insert returned no row");
  return row;
}

function challengeFromRow(row: ChallengeRow): SupportChallenge {
  return {
    id: row.id,
    action: row.action,
    actor: row.actor as Address,
    ...(row.authority_mode ? { authorityMode: row.authority_mode } : {}),
    ...(row.authority ? { authority: row.authority as Address } : {}),
    boardroom: row.boardroom as Address,
    chainId: 998,
    configurationEpoch: BigInt(row.configuration_epoch),
    controllerGeneration: BigInt(row.controller_generation),
    planId: row.plan_id,
    payload: row.payload,
    payloadHash: row.payload_hash as Hex,
    message: row.message,
    issuedBlock: BigInt(row.issued_block),
    issuedBlockHash: row.issued_block_hash as Hex,
    expiresAt: row.expires_at,
    ...(row.consumed_at ? { consumedAt: row.consumed_at } : {}),
    createdAt: row.created_at,
  };
}

function planFromRow(row: PlanRow): SupportPlan {
  return {
    id: row.id,
    chainId: 998,
    boardroom: row.boardroom as Address,
    asset: row.asset as Address,
    amount: row.amount,
    cadence: "monthly",
    title: row.title,
    description: row.description,
    termsHash: row.terms_hash as Hex,
    status: row.status,
    authority: row.authority as Address,
    authorityMode: row.authority_mode,
    controllerGeneration: BigInt(row.controller_generation),
    configurationEpoch: BigInt(row.configuration_epoch),
    verifiedBlock: BigInt(row.verified_block),
    verifiedBlockHash: row.verified_block_hash as Hex,
    createdAt: row.created_at,
    ...(row.retired_at ? { retiredAt: row.retired_at } : {}),
  };
}

function subscriptionFromRow(row: SubscriptionRow): SupportSubscription {
  return {
    id: row.id,
    planId: row.plan_id,
    payer: row.payer as Address,
    status: row.status,
    startedAt: row.started_at,
    createdAt: row.created_at,
    ...(row.cancelled_at ? { cancelledAt: row.cancelled_at } : {}),
  };
}

function invoiceFromRow(row: InvoiceRow): SupportInvoice {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    planId: row.plan_id,
    ...(row.active_quote_id ? { activeQuoteId: row.active_quote_id } : {}),
    periodIndex: row.period_index,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    dueAt: row.due_at,
    payer: row.payer as Address,
    boardroom: row.boardroom as Address,
    asset: row.asset as Address,
    amount: row.amount,
    status: row.status,
    createdAt: row.created_at,
    ...(row.cancelled_at ? { cancelledAt: row.cancelled_at } : {}),
  };
}

function invoiceQuoteFromRow(row: InvoiceQuoteRow): SupportInvoiceQuote {
  return {
    invoiceId: row.invoice_id,
    quoteId: row.quote_id,
    createdAt: row.created_at,
  };
}

function sameChallenge(
  left: SupportChallenge,
  right: SupportChallenge,
): boolean {
  return (
    left.id === right.id
    && left.action === right.action
    && lower(left.actor) === lower(right.actor)
    && lower(left.boardroom) === lower(right.boardroom)
    && left.chainId === right.chainId
    && left.authorityMode === right.authorityMode
    && (
      left.authority === undefined
        ? right.authority === undefined
        : right.authority !== undefined
          && lower(left.authority) === lower(right.authority)
    )
    && left.controllerGeneration === right.controllerGeneration
    && left.configurationEpoch === right.configurationEpoch
    && left.planId === right.planId
    && lower(left.payloadHash) === lower(right.payloadHash)
    && left.message === right.message
    && left.issuedBlock === right.issuedBlock
    && lower(left.issuedBlockHash) === lower(right.issuedBlockHash)
    && left.expiresAt.getTime() === right.expiresAt.getTime()
  );
}

function stringField(value: JsonRecord, name: string): string {
  const field = value[name];
  if (typeof field !== "string") {
    throw new SupportError(
      "Stored recurring-support challenge payload is malformed.",
      "support_challenge_invalid",
      503,
    );
  }
  return field;
}

function lower(value: string): string {
  return value.toLowerCase();
}
