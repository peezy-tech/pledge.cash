import type { Sql, TransactionSql } from "postgres";
import { hashIntentText, hashPaymentRequirements } from "x402-hl/intents";

import type {
  InventoryReservation,
  MarketplaceQuote,
  QuotePaymentBinding,
  QuotePaymentBindingInput,
  QuoteRepository
} from "../domain";
import {
  supportInvoiceLockKey,
  supportPayerBoardroomPaymentLockKey
} from "../support/lock";
import type { JsonRecord } from "./schema";

type QuoteRow = {
  readonly quote: unknown;
};

type ReservationStateRow = {
  readonly scope: InventoryReservation["scope"];
  readonly network: string;
  readonly asset: string;
  readonly status: "active" | "committed" | "consumed" | "released";
  readonly revision: number;
};

type ReservationIdentityRow = {
  readonly network: string;
  readonly asset: string;
};

type SumRow = {
  readonly amount: string;
};

type WallClockRow = {
  readonly wall_clock: Date;
};

type PaymentBindingRow = {
  readonly quote_id: string;
  readonly attempt_id: string;
  readonly payment_payload_hash: string;
  readonly payment_requirements_hash: string;
  readonly bound_at: Date;
};

type QuoteExpiryRow = QuoteRow & {
  readonly expires_at: Date;
};

type SupportInvoiceBindingRow = {
  readonly active_quote_id: string | null;
  readonly invoice_status: "open" | "cancelled";
  readonly linked: boolean;
  readonly plan_status: "active" | "retired";
  readonly subscription_id: string;
  readonly subscription_status: "active" | "cancelled";
};

type SupportInvoiceIdentityRow = {
  readonly boardroom: string;
  readonly payer: string;
  readonly subscription_id: string;
};

const UINT256_MAX = (1n << 256n) - 1n;

export class QuoteConflictError extends Error {
  constructor(readonly quoteId: string) {
    super(`A different immutable quote already uses id ${quoteId}`);
    this.name = "QuoteConflictError";
  }
}

export class InventoryReservationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "availability_mismatch"
      | "insufficient_inventory"
      | "invalid_reservation"
      | "reservation_state"
  ) {
    super(message);
    this.name = "InventoryReservationError";
  }
}

export class QuotePaymentBindingError extends Error {
  constructor(
    message: string,
    readonly code: "binding_conflict" | "quote_expired" | "quote_not_found"
  ) {
    super(message);
    this.name = "QuotePaymentBindingError";
  }
}

type NormalizedReservation = {
  readonly scope: InventoryReservation["scope"];
  readonly network: string;
  readonly asset: string;
  readonly amount: bigint;
};

type InventoryAvailability = {
  readonly reservation: InventoryReservation;
  readonly maximumAvailableInventory: bigint;
};

function canonicalText(value: string): string {
  return value.trim().toLowerCase();
}

function canonicalHash(value: string, label: string): `0x${string}` {
  const canonical = value.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(canonical)) {
    throw new Error(`${label} must be a canonical bytes32 value`);
  }
  return canonical as `0x${string}`;
}

function paymentBindingFromRow(row: PaymentBindingRow): QuotePaymentBinding {
  return {
    quoteId: row.quote_id,
    attemptId: canonicalHash(row.attempt_id, "Payment attempt id"),
    paymentPayloadHash: canonicalHash(
      row.payment_payload_hash,
      "Payment payload hash"
    ),
    paymentRequirementsHash: canonicalHash(
      row.payment_requirements_hash,
      "Payment requirements hash"
    ),
    boundAt: row.bound_at
  };
}

function reservationIdentity(
  reservation: Pick<NormalizedReservation, "scope" | "network" | "asset">
): string {
  return [reservation.scope, reservation.network, reservation.asset].join("\u0000");
}

function inventoryIdentity(
  reservation: Pick<NormalizedReservation, "network" | "asset">
): string {
  return [reservation.network, reservation.asset].join("\u0000");
}

function quoteLockKey(quoteId: string): string {
  return JSON.stringify(["quote", quoteId]);
}

function inventoryLockKey(
  reservation: Pick<NormalizedReservation, "network" | "asset">
): string {
  return JSON.stringify(["inventory", inventoryIdentity(reservation)]);
}

function normalizeReservation(reservation: InventoryReservation): NormalizedReservation {
  if (!/^[1-9][0-9]*$/.test(reservation.amount)) {
    throw new InventoryReservationError(
      "Inventory reservation amount must be a positive decimal integer",
      "invalid_reservation"
    );
  }
  const amount = BigInt(reservation.amount);
  if (amount > UINT256_MAX) {
    throw new InventoryReservationError(
      "Inventory reservation exceeds uint256",
      "invalid_reservation"
    );
  }
  const network = canonicalText(reservation.network);
  const asset = canonicalText(reservation.asset);
  if (network === "" || asset === "") {
    throw new InventoryReservationError(
      "Inventory reservation network and asset are required",
      "invalid_reservation"
    );
  }
  return {
    scope: reservation.scope,
    network,
    asset,
    amount
  };
}

function jsonRecord(value: unknown): JsonRecord {
  const encoded = JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Date) return item.toISOString();
    if (typeof item === "bigint") return item.toString();
    return item;
  });
  const parsed = JSON.parse(encoded) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed as JsonRecord;
}

function serializedQuote(quote: MarketplaceQuote): JsonRecord {
  return jsonRecord(quote);
}

function deserializeQuote(value: unknown): MarketplaceQuote {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Stored marketplace quote is malformed");
  }
  const stored = value as Omit<MarketplaceQuote, "createdAt" | "expiresAt"> & {
    readonly createdAt: string;
    readonly expiresAt: string;
  };
  const createdAt = new Date(stored.createdAt);
  const expiresAt = new Date(stored.expiresAt);
  if (!Number.isFinite(createdAt.getTime()) || !Number.isFinite(expiresAt.getTime())) {
    throw new Error("Stored marketplace quote timestamps are malformed");
  }
  return { ...stored, createdAt, expiresAt };
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)])
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

async function advisoryLocks(
  transaction: TransactionSql,
  keys: readonly string[]
): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await transaction`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

async function databaseWallClock(
  transaction: TransactionSql
): Promise<Date> {
  const rows = await transaction<WallClockRow[]>`
    select clock_timestamp() as wall_clock
  `;
  const wallClock = rows[0]?.wall_clock;
  if (wallClock === undefined || !Number.isFinite(wallClock.getTime())) {
    throw new Error("Postgres returned an invalid wall-clock timestamp");
  }
  return wallClock;
}

function normalizedAvailability(
  quote: MarketplaceQuote,
  availability: readonly InventoryAvailability[]
): {
  readonly reservations: readonly NormalizedReservation[];
  readonly maximumByInventory: ReadonlyMap<string, bigint>;
} {
  const reservations = quote.inventoryReservations.map(normalizeReservation);
  const reservationByIdentity = new Map<string, NormalizedReservation>();
  for (const reservation of reservations) {
    const identity = reservationIdentity(reservation);
    if (reservationByIdentity.has(identity)) {
      throw new InventoryReservationError(
        "Quote contains a duplicate inventory reservation",
        "invalid_reservation"
      );
    }
    reservationByIdentity.set(identity, reservation);
  }

  const availableReservationIds = new Set<string>();
  const maximumByInventory = new Map<string, bigint>();
  for (const entry of availability) {
    const normalized = normalizeReservation(entry.reservation);
    const reservationId = reservationIdentity(normalized);
    const expected = reservationByIdentity.get(reservationId);
    if (expected === undefined || expected.amount !== normalized.amount) {
      throw new InventoryReservationError(
        "Availability does not match the quote inventory reservations",
        "availability_mismatch"
      );
    }
    if (availableReservationIds.has(reservationId)) {
      throw new InventoryReservationError(
        "Availability contains a duplicate inventory reservation",
        "availability_mismatch"
      );
    }
    if (
      entry.maximumAvailableInventory < 0n ||
      entry.maximumAvailableInventory > UINT256_MAX
    ) {
      throw new InventoryReservationError(
        "Maximum available inventory is outside the uint256 range",
        "availability_mismatch"
      );
    }
    availableReservationIds.add(reservationId);
    const inventoryId = inventoryIdentity(normalized);
    const previous = maximumByInventory.get(inventoryId);
    if (previous !== undefined && previous !== entry.maximumAvailableInventory) {
      throw new InventoryReservationError(
        "Availability for one network and asset must use one consistent maximum",
        "availability_mismatch"
      );
    }
    maximumByInventory.set(inventoryId, entry.maximumAvailableInventory);
  }

  if (availableReservationIds.size !== reservationByIdentity.size) {
    throw new InventoryReservationError(
      "Every quote inventory reservation requires an availability bound",
      "availability_mismatch"
    );
  }
  return { reservations, maximumByInventory };
}

export class PostgresQuoteRepository implements QuoteRepository {
  constructor(private readonly sql: Sql) {}

  async createReserved(input: {
    quote: MarketplaceQuote;
    availability: readonly InventoryAvailability[];
  }): Promise<MarketplaceQuote> {
    const { quote } = input;
    if (
      quote.payer.toLowerCase() !== quote.recipient.toLowerCase() ||
      quote.payer.toLowerCase() !== quote.refundAddress.toLowerCase()
    ) {
      throw new InventoryReservationError(
        "V1 quotes require payer, recipient, and refund address to match",
        "invalid_reservation"
      );
    }
    if (quote.expiresAt.getTime() <= quote.createdAt.getTime()) {
      throw new InventoryReservationError(
        "Quote expiry must be after quote creation",
        "invalid_reservation"
      );
    }

    const persistedQuote = serializedQuote(quote);
    const { reservations, maximumByInventory } = normalizedAvailability(
      quote,
      input.availability
    );
    const requiredByInventory = new Map<string, bigint>();
    for (const reservation of reservations) {
      const key = inventoryIdentity(reservation);
      requiredByInventory.set(key, (requiredByInventory.get(key) ?? 0n) + reservation.amount);
    }

    return this.sql.begin(async (transaction) => {
      await advisoryLocks(transaction, [
        quoteLockKey(quote.id),
        ...reservations.map(inventoryLockKey)
      ]);
      const inventoryAt = await databaseWallClock(transaction);

      const existingRows = await transaction<QuoteRow[]>`
        select quote
        from x402_router_quotes
        where id = ${quote.id}
        limit 1
      `;
      const existing = existingRows[0];
      if (existing !== undefined) {
        if (!sameJson(existing.quote, persistedQuote)) {
          throw new QuoteConflictError(quote.id);
        }
        return deserializeQuote(existing.quote);
      }

      for (const [key, required] of requiredByInventory) {
        const [network, asset] = key.split("\u0000");
        if (network === undefined || asset === undefined) {
          throw new Error("Invalid normalized inventory identity");
        }
        const maximum = maximumByInventory.get(key);
        if (maximum === undefined) {
          throw new InventoryReservationError(
            "Missing inventory availability bound",
            "availability_mismatch"
          );
        }
        const rows = await transaction<SumRow[]>`
          select coalesce(sum(amount), 0)::text as amount
          from x402_router_inventory_reservations
          where network = ${network}
            and asset = ${asset}
            and (
              status = 'committed'
              or (
                status = 'active'
                and expires_at > ${inventoryAt.toISOString()}
              )
            )
        `;
        const reserved = BigInt(rows[0]?.amount ?? "0");
        if (reserved + required > maximum) {
          throw new InventoryReservationError(
            `Insufficient available inventory for ${network}:${asset}`,
            "insufficient_inventory"
          );
        }
      }

      await transaction`
        insert into x402_router_quotes (
          id,
          action_kind,
          chain_id,
          payer,
          recipient,
          refund_address,
          target,
          quote,
          payment_identifier_hash,
          payment_network,
          payment_asset,
          payment_amount,
          application,
          gateway,
          intent_template_hash,
          payment_requirements,
          intent,
          expires_at,
          created_at
        ) values (
          ${quote.id},
          ${quote.kind},
          ${quote.execution.chainId},
          ${canonicalText(quote.payer)},
          ${canonicalText(quote.recipient)},
          ${canonicalText(quote.refundAddress)},
          ${canonicalText(quote.canonicalTarget)},
          ${transaction.json(persistedQuote)},
          ${hashIntentText(quote.paymentId).toLowerCase()},
          ${canonicalText(quote.sourcePayment.network)},
          ${canonicalText(quote.sourcePayment.asset)},
          ${quote.sourcePayment.amount},
          ${quote.intentQuote.intent.application},
          ${canonicalText(quote.intentQuote.intent.gateway)},
          ${quote.intentTemplateHash.toLowerCase()},
          ${transaction.json(jsonRecord(quote.paymentRequirements))},
          ${transaction.json(jsonRecord(quote.intentQuote.intent))},
          ${quote.expiresAt.toISOString()},
          ${quote.createdAt.toISOString()}
        )
      `;

      for (const reservation of reservations) {
        await transaction`
          insert into x402_router_inventory_reservations (
            quote_id,
            scope,
            network,
            asset,
            amount,
            status,
            expires_at,
            created_at,
            updated_at
          ) values (
            ${quote.id},
            ${reservation.scope},
            ${reservation.network},
            ${reservation.asset},
            ${reservation.amount.toString()},
            'active',
            ${quote.expiresAt.toISOString()},
            ${quote.createdAt.toISOString()},
            ${quote.createdAt.toISOString()}
          )
        `;
      }
      return quote;
    });
  }

  async get(id: string): Promise<MarketplaceQuote | undefined> {
    const rows = await this.sql<QuoteRow[]>`
      select quote
      from x402_router_quotes
      where id = ${id}
      limit 1
    `;
    const row = rows[0];
    return row === undefined ? undefined : deserializeQuote(row.quote);
  }

  async bindPaymentPayload(
    input: QuotePaymentBindingInput
  ): Promise<QuotePaymentBinding> {
    const attemptId = canonicalHash(input.attemptId, "Payment attempt id");
    const paymentPayloadHash = canonicalHash(
      input.paymentPayloadHash,
      "Payment payload hash"
    );
    const paymentRequirementsHash = canonicalHash(
      input.paymentRequirementsHash,
      "Payment requirements hash"
    );

    return this.sql.begin(async (transaction) => {
      const preliminaryQuoteRows = await transaction<QuoteRow[]>`
        select quote
        from x402_router_quotes
        where id = ${input.quoteId}
        limit 1
      `;
      const preliminaryQuoteRow = preliminaryQuoteRows[0];
      if (preliminaryQuoteRow === undefined) {
        throw new QuotePaymentBindingError(
          `Quote ${input.quoteId} was not found`,
          "quote_not_found"
        );
      }
      const preliminaryQuote = deserializeQuote(preliminaryQuoteRow.quote);
      if (
        preliminaryQuote.kind === "recurring_support" &&
        preliminaryQuote.supportInvoiceId === undefined
      ) {
        throw new QuotePaymentBindingError(
          `Recurring quote ${input.quoteId} has no invoice binding`,
          "binding_conflict"
        );
      }
      let supportSubscriptionId = "";
      let supportBoardroom = "";
      let supportPayer = "";
      if (preliminaryQuote.supportInvoiceId !== undefined) {
        const supportIdentityRows = await transaction<
          SupportInvoiceIdentityRow[]
        >`
          select boardroom, payer, subscription_id
          from x402_router_support_invoices
          where id = ${preliminaryQuote.supportInvoiceId}
          limit 1
        `;
        const supportIdentity = supportIdentityRows[0];
        if (!supportIdentity) {
          throw new QuotePaymentBindingError(
            `Recurring quote ${input.quoteId} references a missing invoice`,
            "binding_conflict"
          );
        }
        supportSubscriptionId = supportIdentity.subscription_id;
        supportBoardroom = supportIdentity.boardroom;
        supportPayer = supportIdentity.payer;
      }
      const reservationIdentities = await transaction<ReservationIdentityRow[]>`
        select distinct network, asset
        from x402_router_inventory_reservations
        where quote_id = ${input.quoteId}
        order by network, asset
      `;
      if (preliminaryQuote.supportInvoiceId !== undefined) {
        await advisoryLocks(transaction, [
          supportInvoiceLockKey(preliminaryQuote.supportInvoiceId),
          supportPayerBoardroomPaymentLockKey(
            supportBoardroom,
            supportPayer
          )
        ]);
      }
      await advisoryLocks(transaction, [
        quoteLockKey(input.quoteId),
        ...reservationIdentities.map(inventoryLockKey)
      ]);
      const quoteRows = await transaction<QuoteExpiryRow[]>`
        select quote, expires_at
        from x402_router_quotes
        where id = ${input.quoteId}
        limit 1
        for update
      `;
      const quoteRow = quoteRows[0];
      if (quoteRow === undefined) {
        throw new QuotePaymentBindingError(
          `Quote ${input.quoteId} was not found`,
          "quote_not_found"
        );
      }

      const bindingRows = await transaction<PaymentBindingRow[]>`
        select
          quote_id,
          attempt_id,
          payment_payload_hash,
          payment_requirements_hash,
          bound_at
        from x402_router_quote_payment_bindings
        where quote_id = ${input.quoteId}
        limit 1
        for update
      `;
      const existing = bindingRows[0];
      if (existing !== undefined) {
        const binding = paymentBindingFromRow(existing);
        if (
          binding.attemptId !== attemptId ||
          binding.paymentPayloadHash !== paymentPayloadHash ||
          binding.paymentRequirementsHash !== paymentRequirementsHash
        ) {
          throw new QuotePaymentBindingError(
            `Quote ${input.quoteId} is already bound to a different payment payload`,
            "binding_conflict"
          );
        }
        return binding;
      }

      const quote = deserializeQuote(quoteRow.quote);
      if (
        quote.kind === "recurring_support" &&
        quote.supportInvoiceId !== undefined
      ) {
        const supportRows = await transaction<SupportInvoiceBindingRow[]>`
          select
            invoice.active_quote_id,
            invoice.status as invoice_status,
            invoice.subscription_id,
            subscription.status as subscription_status,
            plan.status as plan_status,
            exists (
              select 1
              from x402_router_support_invoice_quotes link
              where link.invoice_id = invoice.id
                and link.quote_id = ${quote.id}
            ) as linked
          from x402_router_support_invoices invoice
          join x402_router_support_subscriptions subscription
            on subscription.id = invoice.subscription_id
          join x402_router_support_plans plan
            on plan.id = invoice.plan_id
          where invoice.id = ${quote.supportInvoiceId}
          limit 1
          for update of invoice, subscription, plan
        `;
        const support = supportRows[0];
        if (
          !support ||
          !support.linked ||
          support.active_quote_id !== quote.id ||
          support.subscription_id !== supportSubscriptionId ||
          support.invoice_status !== "open" ||
          support.subscription_status !== "active" ||
          support.plan_status !== "active"
        ) {
          throw new QuotePaymentBindingError(
            `Recurring quote ${input.quoteId} is no longer the payable invoice attempt`,
            "binding_conflict"
          );
        }
        const blockingRows = await transaction<Array<{ blocked: boolean }>>`
          select exists (
            select 1
            from x402_router_support_invoices prior_invoice
            join x402_router_support_invoice_quotes prior_link
              on prior_link.invoice_id = prior_invoice.id
            join x402_router_quote_payment_bindings prior_binding
              on prior_binding.quote_id = prior_link.quote_id
            left join x402_router_intent_payments prior_intent
              on prior_intent.quote_id = prior_link.quote_id
              and prior_intent.primary_payment
            left join x402_router_adapter_operations prior_settlement
              on prior_settlement.kind = 'payment_settlement'
              and prior_settlement.idempotency_key = prior_binding.attempt_id
            where prior_invoice.boardroom = ${supportBoardroom}
              and prior_invoice.payer = ${supportPayer}
              and prior_invoice.id <> ${quote.supportInvoiceId}
              and not (
                coalesce(
                  prior_intent.status in ('executed', 'refunded'),
                  false
                )
                or (
                  prior_intent.quote_id is null
                  and coalesce(
                    prior_settlement.status = 'confirmed_failure',
                    false
                  )
                )
              )
          ) as blocked
        `;
        if (blockingRows[0]?.blocked !== false) {
          throw new QuotePaymentBindingError(
            `Recurring quote ${input.quoteId} is blocked by an unresolved payment for this payer and Boardroom`,
            "binding_conflict"
          );
        }
      }
      const storedRequirementsHash = canonicalHash(
        hashPaymentRequirements(quote.paymentRequirements),
        "Stored payment requirements hash"
      );
      if (storedRequirementsHash !== paymentRequirementsHash) {
        throw new QuotePaymentBindingError(
          `Quote ${input.quoteId} payment requirements do not match the binding`,
          "binding_conflict"
        );
      }
      const reservations = await transaction<ReservationStateRow[]>`
        select scope, network, asset, status, revision
        from x402_router_inventory_reservations
        where quote_id = ${input.quoteId}
        order by scope, network, asset
        for update
      `;
      const boundAt = await databaseWallClock(transaction);
      if (quoteRow.expires_at.getTime() <= boundAt.getTime()) {
        throw new QuotePaymentBindingError(
          `Quote ${input.quoteId} expired before this payment payload was claimed`,
          "quote_expired"
        );
      }
      if (
        reservations.length === 0 ||
        reservations.some((reservation) => reservation.status !== "active")
      ) {
        throw new InventoryReservationError(
          `Quote ${input.quoteId} inventory is no longer claimable`,
          "reservation_state"
        );
      }

      const inserted = await transaction<PaymentBindingRow[]>`
        insert into x402_router_quote_payment_bindings (
          quote_id,
          attempt_id,
          payment_payload_hash,
          payment_requirements_hash,
          bound_at
        ) values (
          ${input.quoteId},
          ${attemptId},
          ${paymentPayloadHash},
          ${paymentRequirementsHash},
          ${boundAt.toISOString()}
        )
        returning
          quote_id,
          attempt_id,
          payment_payload_hash,
          payment_requirements_hash,
          bound_at
      `;
      const updated = await transaction<Array<{ readonly quote_id: string }>>`
        update x402_router_inventory_reservations
        set status = 'committed',
            revision = revision + 1,
            updated_at = ${boundAt.toISOString()}
        where quote_id = ${input.quoteId}
          and status = 'active'
        returning quote_id
      `;
      if (updated.length !== reservations.length || inserted[0] === undefined) {
        throw new InventoryReservationError(
          `Quote ${input.quoteId} inventory changed while its payment was claimed`,
          "reservation_state"
        );
      }
      return paymentBindingFromRow(inserted[0]);
    });
  }

  async getPaymentBinding(
    id: string
  ): Promise<QuotePaymentBinding | undefined> {
    const rows = await this.sql<PaymentBindingRow[]>`
      select
        quote_id,
        attempt_id,
        payment_payload_hash,
        payment_requirements_hash,
        bound_at
      from x402_router_quote_payment_bindings
      where quote_id = ${id}
      limit 1
    `;
    const row = rows[0];
    return row === undefined ? undefined : paymentBindingFromRow(row);
  }

  async listPaymentBindingsWithoutOrder(input: {
    before: Date;
    limit: number;
  }): Promise<readonly QuotePaymentBinding[]> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit <= 0 ||
      input.limit > 1_000
    ) {
      throw new Error("Payment binding recovery limit must be between 1 and 1000");
    }
    const rows = await this.sql<PaymentBindingRow[]>`
      select
        binding.quote_id,
        binding.attempt_id,
        binding.payment_payload_hash,
        binding.payment_requirements_hash,
        binding.bound_at
      from x402_router_quote_payment_bindings binding
      join x402_router_adapter_operations operation
        on operation.kind = 'payment_settlement'
       and operation.idempotency_key = binding.attempt_id
      left join x402_router_intent_payments intent
        on intent.quote_id = binding.quote_id
       and intent.primary_payment
      where intent.quote_id is null
        and binding.bound_at <= ${input.before.toISOString()}
        and (
          operation.status = 'confirmed_success'
          or (
            operation.status = 'confirmed_failure'
            and exists (
              select 1
              from x402_router_inventory_reservations reservation
              where reservation.quote_id = binding.quote_id
                and reservation.status = 'committed'
            )
          )
          or (
            operation.status in ('signed', 'submitted')
            and operation.lease_expires_at <= now()
          )
        )
      order by binding.bound_at asc
      limit ${input.limit}
    `;
    return rows.map(paymentBindingFromRow);
  }

  async releaseExpired(now: Date): Promise<number> {
    return this.sql.begin(async (transaction) => {
      const candidates = await transaction<Array<{ readonly quote_id: string }>>`
        select distinct quote_id
        from x402_router_inventory_reservations
        where status = 'active'
          and expires_at <= ${now.toISOString()}
        order by quote_id
      `;
      await advisoryLocks(
        transaction,
        candidates.map(({ quote_id }) => quoteLockKey(quote_id))
      );
      const rows = await transaction<Array<{ readonly quote_id: string }>>`
        update x402_router_inventory_reservations reservation
        set status = 'released',
            revision = revision + 1,
            updated_at = ${now.toISOString()}
        where reservation.status = 'active'
          and reservation.expires_at <= ${now.toISOString()}
          and not exists (
            select 1
            from x402_router_quote_payment_bindings binding
            where binding.quote_id = reservation.quote_id
          )
        returning reservation.quote_id
      `;
      return new Set(rows.map((row) => row.quote_id)).size;
    });
  }

  async commitReservations(id: string): Promise<void> {
    await this.transitionReservations(id, "commit");
  }

  async finalizeExecution(id: string): Promise<void> {
    await this.transitionReservations(id, "execution");
  }

  async finalizeRefund(id: string): Promise<void> {
    await this.transitionReservations(id, "refund");
  }

  async finalizeSettlementFailure(id: string): Promise<void> {
    await this.transitionReservations(id, "settlement_failure");
  }

  async releaseQuotedReservations(id: string): Promise<void> {
    await this.transitionReservations(id, "release_quote");
  }

  async reservedInventory(input: {
    network: string;
    asset: string;
    now: Date;
  }): Promise<bigint> {
    const rows = await this.sql<SumRow[]>`
      select coalesce(sum(amount), 0)::text as amount
      from x402_router_inventory_reservations
      where network = ${canonicalText(input.network)}
        and asset = ${canonicalText(input.asset)}
        and (
          status = 'committed'
          or (status = 'active' and expires_at > ${input.now.toISOString()})
        )
    `;
    return BigInt(rows[0]?.amount ?? "0");
  }

  private async transitionReservations(
    quoteId: string,
    transition:
      | "commit"
      | "execution"
      | "refund"
      | "release_quote"
      | "settlement_failure"
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await advisoryLocks(transaction, [quoteLockKey(quoteId)]);
      if (transition === "release_quote") {
        const bindings = await transaction<Array<{ readonly quote_id: string }>>`
          select quote_id
          from x402_router_quote_payment_bindings
          where quote_id = ${quoteId}
          limit 1
        `;
        if (bindings[0] !== undefined) return;
      }
      const current = await transaction<ReservationStateRow[]>`
        select scope, network, asset, status, revision
        from x402_router_inventory_reservations
        where quote_id = ${quoteId}
        order by scope, network, asset
        for update
      `;
      if (current.length === 0) {
        throw new InventoryReservationError(
          `No inventory reservation exists for quote ${quoteId}`,
          "reservation_state"
        );
      }

      for (const reservation of current) {
        const target =
          transition === "commit"
            ? "committed"
            : transition === "release_quote" ||
                transition === "settlement_failure"
              ? "released"
              : transition === "execution"
                ? reservation.scope === "destination_execution"
                  ? "consumed"
                  : "released"
                : reservation.scope === "destination_execution"
                  ? "released"
                  : "consumed";
        const requiredSource =
          transition === "commit" || transition === "release_quote"
            ? "active"
            : "committed";

        if (reservation.status === target) continue;
        if (reservation.status !== requiredSource) {
          throw new InventoryReservationError(
            `Quote ${quoteId} ${reservation.scope} reservation cannot transition from ${reservation.status} to ${target}`,
            "reservation_state"
          );
        }

        const updated = await transaction<Array<{ readonly revision: number }>>`
          update x402_router_inventory_reservations
          set status = ${target},
              revision = revision + 1,
              updated_at = now()
          where quote_id = ${quoteId}
            and scope = ${reservation.scope}
            and network = ${reservation.network}
            and asset = ${reservation.asset}
            and status = ${requiredSource}
            and revision = ${reservation.revision}
          returning revision
        `;
        if (updated[0] === undefined) {
          throw new InventoryReservationError(
            `Quote ${quoteId} ${reservation.scope} reservation changed concurrently`,
            "reservation_state"
          );
        }
      }
    });
  }
}
