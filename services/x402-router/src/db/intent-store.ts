import type { Sql, TransactionSql } from "postgres";
import {
  IntentExecutionRecordSchema,
  isLegalIntentExecutionTransition,
  type IntentExecutionRecord,
  type IntentExecutionStore,
  type IntentExecutionTransition,
  type IntentStoreConflictKey,
  type IntentStoreRegistrationResult,
  type IntentStoreTransitionResult
} from "x402-hl/intents/server";

type IntentPaymentRow = {
  readonly payment_network: string;
  readonly payment_transaction: string;
  readonly primary_payment: boolean;
  readonly record: unknown;
};

type IntentStoreOptions = {
  readonly now?: () => Date;
};

export function canonicalizeTransactionIdentifier(value: string): string {
  const canonical = value.trim().toLowerCase();
  if (canonical === "") {
    throw new Error("Transaction identifier must not be empty");
  }
  return canonical;
}

function normalizeHash(value: string): string {
  return value.toLowerCase();
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

export function canonicalizeIntentRecord(
  input: IntentExecutionRecord
): IntentExecutionRecord {
  return IntentExecutionRecordSchema.parse({
    ...input,
    intentHash: normalizeHash(input.intentHash),
    gateway: normalizeAddress(input.gateway),
    paymentTransaction: canonicalizeTransactionIdentifier(input.paymentTransaction),
    executionTransaction:
      input.executionTransaction === undefined
        ? undefined
        : canonicalizeTransactionIdentifier(input.executionTransaction),
    refundTransaction:
      input.refundTransaction === undefined
        ? undefined
        : canonicalizeTransactionIdentifier(input.refundTransaction)
  });
}

export function sameIntentRegistration(
  left: IntentExecutionRecord,
  right: IntentExecutionRecord
): boolean {
  return (
    normalizeHash(left.intentHash) === normalizeHash(right.intentHash) &&
    normalizeHash(left.intentTemplateHash) === normalizeHash(right.intentTemplateHash) &&
    left.application === right.application &&
    normalizeAddress(left.gateway) === normalizeAddress(right.gateway) &&
    left.quoteId === right.quoteId &&
    normalizeHash(left.paymentRequirementsHash) ===
      normalizeHash(right.paymentRequirementsHash) &&
    left.paymentScheme === right.paymentScheme &&
    left.paymentNetwork === right.paymentNetwork &&
    left.paymentAsset === right.paymentAsset &&
    left.paymentAmount === right.paymentAmount &&
    normalizeAddress(left.paymentPayTo) === normalizeAddress(right.paymentPayTo)
  );
}

export function samePaymentRegistration(
  left: IntentExecutionRecord,
  right: IntentExecutionRecord
): boolean {
  return (
    sameIntentRegistration(left, right) &&
    normalizeAddress(left.payer) === normalizeAddress(right.payer) &&
    canonicalizeTransactionIdentifier(left.paymentTransaction) ===
      canonicalizeTransactionIdentifier(right.paymentTransaction)
  );
}

function sameQuotedExecution(
  left: IntentExecutionRecord,
  right: IntentExecutionRecord
): boolean {
  return (
    normalizeHash(left.intentTemplateHash) ===
      normalizeHash(right.intentTemplateHash) &&
    left.application === right.application &&
    normalizeAddress(left.gateway) === normalizeAddress(right.gateway) &&
    left.quoteId === right.quoteId
  );
}

export function buildDuplicatePaymentRecord(
  input: IntentExecutionRecord,
  now: Date = new Date()
): IntentExecutionRecord {
  return IntentExecutionRecordSchema.parse({
    ...canonicalizeIntentRecord(input),
    revision: 0,
    status: "refund_pending",
    duplicatePayment: true,
    executionNetwork: undefined,
    executionTransaction: undefined,
    refundNetwork: undefined,
    refundTransaction: undefined,
    executionAttempts: 0,
    refundAttempts: 0,
    claimToken: undefined,
    failure: {
      reason: "duplicate_payment",
      message: "An additional settled payment for this intent must be refunded",
      retryable: true
    },
    updatedAt: now.toISOString()
  });
}

function recordFromRow(row: IntentPaymentRow): IntentExecutionRecord {
  return IntentExecutionRecordSchema.parse(row.record);
}

function quoteLock(record: IntentExecutionRecord): string {
  return JSON.stringify([
    "intent-quote",
    record.application,
    normalizeAddress(record.gateway),
    record.quoteId
  ]);
}

function paymentLock(network: string, transaction: string): string {
  return JSON.stringify([
    "intent-payment",
    network,
    canonicalizeTransactionIdentifier(transaction)
  ]);
}

function intentLock(intentHash: string): string {
  return JSON.stringify(["intent-hash", normalizeHash(intentHash)]);
}

function indexedTransactionLock(
  kind: "execution" | "refund",
  network: string,
  transaction: string
): string {
  return JSON.stringify([
    `intent-${kind}`,
    network,
    canonicalizeTransactionIdentifier(transaction)
  ]);
}

async function advisoryLocks(
  transaction: TransactionSql,
  keys: readonly string[]
): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await transaction`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

async function selectByPayment(
  transaction: TransactionSql,
  paymentNetwork: string,
  paymentTransaction: string,
  forUpdate = false
): Promise<IntentPaymentRow | undefined> {
  const canonicalTransaction = canonicalizeTransactionIdentifier(paymentTransaction);
  const rows = forUpdate
    ? await transaction<IntentPaymentRow[]>`
        select payment_network, payment_transaction, primary_payment, record
        from x402_router_intent_payments
        where payment_network = ${paymentNetwork}
          and payment_transaction = ${canonicalTransaction}
        limit 1
        for update
      `
    : await transaction<IntentPaymentRow[]>`
        select payment_network, payment_transaction, primary_payment, record
        from x402_router_intent_payments
        where payment_network = ${paymentNetwork}
          and payment_transaction = ${canonicalTransaction}
        limit 1
      `;
  return rows[0];
}

async function selectPrimaryByIntent(
  transaction: TransactionSql,
  intentHash: string,
  forUpdate = false
): Promise<IntentPaymentRow | undefined> {
  const normalized = normalizeHash(intentHash);
  const rows = forUpdate
    ? await transaction<IntentPaymentRow[]>`
        select payment_network, payment_transaction, primary_payment, record
        from x402_router_intent_payments
        where intent_hash = ${normalized}
          and primary_payment
        limit 1
        for update
      `
    : await transaction<IntentPaymentRow[]>`
        select payment_network, payment_transaction, primary_payment, record
        from x402_router_intent_payments
        where intent_hash = ${normalized}
          and primary_payment
        limit 1
      `;
  return rows[0];
}

async function insertRecord(
  transaction: TransactionSql,
  record: IntentExecutionRecord,
  primaryPayment: boolean
): Promise<void> {
  await transaction`
    insert into x402_router_intent_payments (
      payment_network,
      payment_transaction,
      intent_hash,
      primary_payment,
      application,
      gateway,
      quote_id,
      execution_network,
      execution_transaction,
      refund_network,
      refund_transaction,
      revision,
      status,
      claim_token,
      record,
      created_at,
      updated_at
    ) values (
      ${record.paymentNetwork},
      ${record.paymentTransaction},
      ${record.intentHash},
      ${primaryPayment},
      ${record.application},
      ${normalizeAddress(record.gateway)},
      ${record.quoteId},
      ${record.executionNetwork ?? null},
      ${record.executionTransaction ?? null},
      ${record.refundNetwork ?? null},
      ${record.refundTransaction ?? null},
      ${record.revision},
      ${record.status},
      ${record.claimToken ?? null},
      ${transaction.json(record)},
      ${record.createdAt},
      ${record.updatedAt}
    )
  `;
}

function transactionPatch(input: IntentExecutionTransition): IntentExecutionTransition["patch"] {
  if (input.patch === undefined) return undefined;
  const {
    executionTransaction,
    refundTransaction,
    ...rest
  } = input.patch;
  return {
    ...rest,
    ...(executionTransaction === undefined
      ? {}
      : {
          executionTransaction: canonicalizeTransactionIdentifier(
            executionTransaction
          )
        }),
    ...(refundTransaction === undefined
      ? {}
      : {
          refundTransaction: canonicalizeTransactionIdentifier(
            refundTransaction
          )
        })
  };
}

function conflictKeyForIndexedTransaction(
  kind: "execution" | "refund"
): IntentStoreConflictKey {
  return kind === "execution" ? "execution_transaction" : "refund_transaction";
}

export class PostgresIntentExecutionStore implements IntentExecutionStore {
  private readonly now: () => Date;

  constructor(
    private readonly sql: Sql,
    options: IntentStoreOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async registerPaid(
    input: IntentExecutionRecord
  ): Promise<IntentStoreRegistrationResult> {
    const record = canonicalizeIntentRecord(input);
    return this.sql.begin(async (transaction) => {
      await advisoryLocks(transaction, [
        intentLock(record.intentHash),
        paymentLock(record.paymentNetwork, record.paymentTransaction),
        quoteLock(record)
      ]);

      const paymentRow = await selectByPayment(
        transaction,
        record.paymentNetwork,
        record.paymentTransaction,
        true
      );
      if (paymentRow !== undefined) {
        const paymentRecord = recordFromRow(paymentRow);
        if (samePaymentRegistration(paymentRecord, record)) {
          return paymentRow.primary_payment
            ? { kind: "existing" as const, record: paymentRecord }
            : { kind: "duplicate_payment" as const, record: paymentRecord };
        }
        return {
          kind: "conflict" as const,
          key: "payment_transaction" as const,
          record: paymentRecord
        };
      }

      const intentRow = await selectPrimaryByIntent(transaction, record.intentHash, true);
      if (intentRow !== undefined) {
        const intentRecord = recordFromRow(intentRow);
        if (!sameIntentRegistration(intentRecord, record)) {
          return {
            kind: "conflict" as const,
            key: "intent_hash" as const,
            record: intentRecord
          };
        }
        const duplicate = buildDuplicatePaymentRecord(record, this.now());
        await insertRecord(transaction, duplicate, false);
        return { kind: "duplicate_payment" as const, record: duplicate };
      }

      const quoteRows = await transaction<IntentPaymentRow[]>`
        select payment_network, payment_transaction, primary_payment, record
        from x402_router_intent_payments
        where application = ${record.application}
          and gateway = ${normalizeAddress(record.gateway)}
          and quote_id = ${record.quoteId}
          and primary_payment
        limit 1
        for update
      `;
      const quoteRow = quoteRows[0];
      if (quoteRow !== undefined) {
        const quoteRecord = recordFromRow(quoteRow);
        if (!sameQuotedExecution(quoteRecord, record)) {
          return {
            kind: "conflict" as const,
            key: "quote_id" as const,
            record: quoteRecord
          };
        }
        const duplicate = buildDuplicatePaymentRecord(record, this.now());
        await insertRecord(transaction, duplicate, false);
        return { kind: "duplicate_payment" as const, record: duplicate };
      }

      await insertRecord(transaction, record, true);
      return { kind: "created" as const, record };
    });
  }

  async get(intentHash: string): Promise<IntentExecutionRecord | undefined> {
    const rows = await this.sql<IntentPaymentRow[]>`
      select payment_network, payment_transaction, primary_payment, record
      from x402_router_intent_payments
      where intent_hash = ${normalizeHash(intentHash)}
        and primary_payment
      limit 1
    `;
    const row = rows[0];
    return row === undefined ? undefined : recordFromRow(row);
  }

  async getPayment(
    paymentNetwork: string,
    paymentTransaction: string
  ): Promise<IntentExecutionRecord | undefined> {
    const canonicalTransaction = canonicalizeTransactionIdentifier(paymentTransaction);
    const rows = await this.sql<IntentPaymentRow[]>`
      select payment_network, payment_transaction, primary_payment, record
      from x402_router_intent_payments
      where payment_network = ${paymentNetwork}
        and payment_transaction = ${canonicalTransaction}
      limit 1
    `;
    const row = rows[0];
    return row === undefined ? undefined : recordFromRow(row);
  }

  async getByQuoteId(quoteId: string): Promise<IntentExecutionRecord | undefined> {
    const rows = await this.sql<IntentPaymentRow[]>`
      select payment_network, payment_transaction, primary_payment, record
      from x402_router_intent_payments
      where quote_id = ${quoteId}
        and primary_payment
      limit 1
    `;
    const row = rows[0];
    return row === undefined ? undefined : recordFromRow(row);
  }

  async listRecoverable(
    limit = 100,
    before: Date = this.now()
  ): Promise<IntentExecutionRecord[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) {
      throw new Error("Recoverable intent limit must be between 1 and 1000");
    }
    const rows = await this.sql<IntentPaymentRow[]>`
      select payment_network, payment_transaction, primary_payment, record
      from x402_router_intent_payments
      where status not in ('executed', 'refunded', 'manual_intervention')
        and updated_at <= ${before.toISOString()}
      order by updated_at asc
      limit ${limit}
    `;
    return rows.map(recordFromRow);
  }

  async transition(
    input: IntentExecutionTransition
  ): Promise<IntentStoreTransitionResult> {
    const patch = transactionPatch(input);
    const paymentNetwork =
      "paymentNetwork" in input ? input.paymentNetwork : undefined;
    const paymentTransaction =
      "paymentTransaction" in input ? input.paymentTransaction : undefined;
    const hasPaymentIdentity =
      paymentNetwork !== undefined && paymentTransaction !== undefined;

    return this.sql.begin(async (transaction) => {
      const locatorLock = hasPaymentIdentity
        ? paymentLock(paymentNetwork, paymentTransaction)
        : intentLock(input.intentHash);
      await advisoryLocks(transaction, [locatorLock]);

      const row = hasPaymentIdentity
        ? await selectByPayment(transaction, paymentNetwork, paymentTransaction, true)
        : await selectPrimaryByIntent(transaction, input.intentHash, true);
      if (row === undefined) return { kind: "not_found" as const };

      const current = recordFromRow(row);
      if (normalizeHash(current.intentHash) !== normalizeHash(input.intentHash)) {
        return { kind: "not_found" as const };
      }
      if (current.revision !== input.expectedRevision) {
        return {
          kind: "conflict" as const,
          key: "revision" as const,
          record: current
        };
      }
      if (current.status !== input.from) {
        return {
          kind: "conflict" as const,
          key: "status" as const,
          record: current
        };
      }
      if (current.claimToken !== undefined && current.claimToken !== input.claimToken) {
        return {
          kind: "conflict" as const,
          key: "claim_token" as const,
          record: current
        };
      }
      if (!isLegalIntentExecutionTransition(input.from, input.to)) {
        return {
          kind: "conflict" as const,
          key: "status" as const,
          record: current
        };
      }

      const next = canonicalizeIntentRecord(
        IntentExecutionRecordSchema.parse({
          ...current,
          ...(patch ?? {}),
          status: input.to,
          revision: current.revision + 1,
          updatedAt: this.now().toISOString()
        })
      );

      for (const kind of ["execution", "refund"] as const) {
        const network =
          kind === "execution" ? next.executionNetwork : next.refundNetwork;
        const transactionId =
          kind === "execution" ? next.executionTransaction : next.refundTransaction;
        if (network === undefined || transactionId === undefined) continue;
        await advisoryLocks(transaction, [
          indexedTransactionLock(kind, network, transactionId)
        ]);
        const ownerRows = kind === "execution"
          ? await transaction<IntentPaymentRow[]>`
              select payment_network, payment_transaction, primary_payment, record
              from x402_router_intent_payments
              where execution_network = ${network}
                and execution_transaction = ${transactionId}
              limit 1
            `
          : await transaction<IntentPaymentRow[]>`
              select payment_network, payment_transaction, primary_payment, record
              from x402_router_intent_payments
              where refund_network = ${network}
                and refund_transaction = ${transactionId}
              limit 1
            `;
        const owner = ownerRows[0];
        if (
          owner !== undefined &&
          (
            owner.payment_network !== row.payment_network ||
            owner.payment_transaction !== row.payment_transaction
          )
        ) {
          return {
            kind: "conflict" as const,
            key: conflictKeyForIndexedTransaction(kind),
            record: current
          };
        }
      }

      const updated = await transaction<IntentPaymentRow[]>`
        update x402_router_intent_payments
        set execution_network = ${next.executionNetwork ?? null},
            execution_transaction = ${next.executionTransaction ?? null},
            refund_network = ${next.refundNetwork ?? null},
            refund_transaction = ${next.refundTransaction ?? null},
            revision = ${next.revision},
            status = ${next.status},
            claim_token = ${next.claimToken ?? null},
            record = ${transaction.json(next)},
            updated_at = ${next.updatedAt}
        where payment_network = ${row.payment_network}
          and payment_transaction = ${row.payment_transaction}
          and revision = ${input.expectedRevision}
          and status = ${input.from}
        returning payment_network, payment_transaction, primary_payment, record
      `;
      const updatedRow = updated[0];
      if (updatedRow === undefined) {
        const winner = await selectByPayment(
          transaction,
          row.payment_network,
          row.payment_transaction,
          true
        );
        if (winner === undefined) return { kind: "not_found" as const };
        const winnerRecord = recordFromRow(winner);
        return {
          kind: "conflict" as const,
          key:
            winnerRecord.revision !== input.expectedRevision
              ? ("revision" as const)
              : winnerRecord.status !== input.from
                ? ("status" as const)
                : ("claim_token" as const),
          record: winnerRecord
        };
      }
      return { kind: "updated" as const, record: recordFromRow(updatedRow) };
    });
  }
}
