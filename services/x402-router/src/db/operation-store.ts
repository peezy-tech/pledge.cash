import { randomUUID } from "node:crypto";

import type { Sql, TransactionSql } from "postgres";
import type { Address, Hex } from "viem";

import {
  decryptJournalPayload,
  encryptJournalPayload,
  type EncryptedJournalPayload
} from "./journal-crypto";
import type {
  AdapterOperationKind,
  AdapterOperationStatus,
  JsonRecord
} from "./schema";

type AdapterOperationDbRow = {
  readonly id: string;
  readonly kind: AdapterOperationKind;
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly network: string;
  readonly signer: string;
  readonly status: AdapterOperationStatus;
  readonly signer_nonce: string | null;
  readonly payload_ciphertext: string | null;
  readonly payload_iv: string | null;
  readonly payload_auth_tag: string | null;
  readonly transaction_hash: string | null;
  readonly receipt: unknown | null;
  readonly failure_code: string | null;
  readonly revision: number;
  readonly lease_token: string;
  readonly lease_expires_at: Date;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type MaximumNonceRow = {
  readonly nonce: string | null;
};

export type AdapterOperationRecord = {
  readonly id: string;
  readonly kind: AdapterOperationKind;
  readonly idempotencyKey: string;
  readonly requestHash: Hex;
  readonly network: string;
  readonly signer: Address;
  readonly status: AdapterOperationStatus;
  readonly signerNonce?: bigint;
  readonly transactionHash?: string;
  readonly receipt?: JsonRecord;
  readonly failureCode?: string;
  readonly revision: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly hasEncryptedPayload: boolean;
};

export type AdapterOperationClaimResult =
  | { readonly kind: "claimed"; readonly operation: AdapterOperationRecord }
  | { readonly kind: "existing"; readonly operation: AdapterOperationRecord }
  | { readonly kind: "conflict"; readonly operation: AdapterOperationRecord };

export type AdapterOperationTransitionResult =
  | { readonly kind: "updated"; readonly operation: AdapterOperationRecord }
  | { readonly kind: "not_found" }
  | {
      readonly kind: "conflict";
      readonly key: "revision" | "status" | "lease_token" | "transaction_hash";
      readonly operation: AdapterOperationRecord;
    };

export type AtomicSignedOperationResult =
  | AdapterOperationTransitionResult
  | {
      readonly kind: "signing_failed";
      readonly operation: AdapterOperationRecord;
    };

type OperationStoreOptions = {
  readonly createLeaseToken?: () => string;
  readonly now?: () => Date;
};

const TERMINAL_STATUSES = new Set<AdapterOperationStatus>([
  "confirmed_success",
  "confirmed_failure",
  "manual_intervention"
]);

const LEGAL_TRANSITIONS: Readonly<
  Record<AdapterOperationStatus, readonly AdapterOperationStatus[]>
> = {
  claimed: ["signed", "confirmed_failure", "manual_intervention"],
  signed: ["submitted", "confirmed_failure", "manual_intervention"],
  submitted: [
    "submitted",
    "confirmed_success",
    "confirmed_failure",
    "manual_intervention"
  ],
  confirmed_success: [],
  confirmed_failure: [],
  manual_intervention: []
};

function canonicalText(value: string, label: string): string {
  const canonical = value.trim().toLowerCase();
  if (canonical === "") throw new Error(`${label} must not be empty`);
  return canonical;
}

function canonicalIdempotencyKey(value: string): string {
  const canonical = value.trim();
  if (canonical === "" || canonical.length > 512) {
    throw new Error(
      "Adapter operation idempotencyKey must contain 1 to 512 characters"
    );
  }
  return canonical;
}

function canonicalRequestHash(value: string): Hex {
  const canonical = value.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(canonical)) {
    throw new Error("Adapter operation requestHash must be a bytes32 value");
  }
  return canonical as Hex;
}

function canonicalSigner(value: string): Address {
  const canonical = value.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(canonical)) {
    throw new Error("Adapter operation signer must be an EVM address");
  }
  return canonical as Address;
}

function canonicalTransaction(value: string): string {
  return canonicalText(value, "Adapter operation transaction hash");
}

function operationLock(kind: AdapterOperationKind, idempotencyKey: string): string {
  return JSON.stringify(["adapter-operation", kind, idempotencyKey]);
}

function transactionLock(network: string, transactionHash: string): string {
  return JSON.stringify([
    "adapter-operation-transaction",
    network,
    canonicalTransaction(transactionHash)
  ]);
}

function signerLock(network: string, signer: string): string {
  return JSON.stringify(["adapter-operation-signer", network, signer]);
}

function operationAad(input: {
  readonly kind: AdapterOperationKind;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}): string {
  return [
    "pledge.cash/x402-router/journal/v1",
    input.kind,
    input.idempotencyKey,
    input.requestHash
  ].join("\u0000");
}

function parseReceipt(value: unknown): JsonRecord | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored adapter operation receipt is malformed");
  }
  return value as JsonRecord;
}

function recordFromRow(row: AdapterOperationDbRow): AdapterOperationRecord {
  const receipt = parseReceipt(row.receipt);
  return {
    id: row.id,
    kind: row.kind,
    idempotencyKey: row.idempotency_key,
    requestHash: canonicalRequestHash(row.request_hash),
    network: row.network,
    signer: canonicalSigner(row.signer),
    status: row.status,
    ...(row.signer_nonce === null ? {} : { signerNonce: BigInt(row.signer_nonce) }),
    ...(row.transaction_hash === null ? {} : { transactionHash: row.transaction_hash }),
    ...(receipt === undefined ? {} : { receipt }),
    ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
    revision: row.revision,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasEncryptedPayload:
      row.payload_ciphertext !== null &&
      row.payload_iv !== null &&
      row.payload_auth_tag !== null
  };
}

function encryptedFromRow(
  row: AdapterOperationDbRow
): EncryptedJournalPayload | undefined {
  if (
    row.payload_ciphertext === null ||
    row.payload_iv === null ||
    row.payload_auth_tag === null
  ) {
    return undefined;
  }
  return {
    ciphertext: row.payload_ciphertext,
    iv: row.payload_iv,
    authTag: row.payload_auth_tag
  };
}

async function advisoryLocks(
  transaction: TransactionSql,
  keys: readonly string[]
): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await transaction`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

async function selectOperation(
  transaction: TransactionSql,
  kind: AdapterOperationKind,
  idempotencyKey: string,
  forUpdate = false
): Promise<AdapterOperationDbRow | undefined> {
  const rows = forUpdate
    ? await transaction<AdapterOperationDbRow[]>`
        select *
        from x402_router_adapter_operations
        where kind = ${kind}
          and idempotency_key = ${idempotencyKey}
        limit 1
        for update
      `
    : await transaction<AdapterOperationDbRow[]>`
        select *
        from x402_router_adapter_operations
        where kind = ${kind}
          and idempotency_key = ${idempotencyKey}
        limit 1
      `;
  return rows[0];
}

function validateLeaseMs(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 3_600_000) {
    throw new Error("Adapter operation lease must be between 1 and 3600000 milliseconds");
  }
  return value;
}

const MAX_EVM_NONCE = BigInt(Number.MAX_SAFE_INTEGER);

function validateMinimumNonce(value: bigint): bigint {
  if (value < 0n || value > MAX_EVM_NONCE) {
    throw new Error("Adapter operation minimum nonce must be a safe integer");
  }
  return value;
}

export class PostgresAdapterOperationStore {
  private readonly createLeaseToken: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly sql: Sql,
    private readonly encryptionKey: Hex,
    options: OperationStoreOptions = {}
  ) {
    this.createLeaseToken = options.createLeaseToken ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async claim(input: {
    readonly kind: AdapterOperationKind;
    readonly idempotencyKey: string;
    readonly requestHash: Hex | string;
    readonly network: string;
    readonly signer: Address | string;
    readonly leaseMs: number;
  }): Promise<AdapterOperationClaimResult> {
    const idempotencyKey = canonicalIdempotencyKey(input.idempotencyKey);
    const requestHash = canonicalRequestHash(input.requestHash);
    const network = canonicalText(input.network, "Adapter operation network");
    const signer = canonicalSigner(input.signer);
    const leaseMs = validateLeaseMs(input.leaseMs);

    return this.sql.begin(async (transaction) => {
      await advisoryLocks(transaction, [operationLock(input.kind, idempotencyKey)]);
      const existing = await selectOperation(
        transaction,
        input.kind,
        idempotencyKey,
        true
      );
      const now = this.now();
      if (existing === undefined) {
        const leaseToken = this.createLeaseToken();
        const leaseExpiresAt = new Date(now.getTime() + leaseMs);
        const rows = await transaction<AdapterOperationDbRow[]>`
          insert into x402_router_adapter_operations (
            kind,
            idempotency_key,
            request_hash,
            network,
            signer,
            status,
            revision,
            lease_token,
            lease_expires_at,
            created_at,
            updated_at
          ) values (
            ${input.kind},
            ${idempotencyKey},
            ${requestHash},
            ${network},
            ${signer},
            'claimed',
            0,
            ${leaseToken},
            ${leaseExpiresAt.toISOString()},
            ${now.toISOString()},
            ${now.toISOString()}
          )
          returning *
        `;
        const created = rows[0];
        if (created === undefined) throw new Error("Failed to create adapter operation");
        return { kind: "claimed" as const, operation: recordFromRow(created) };
      }

      const current = recordFromRow(existing);
      if (
        current.requestHash !== requestHash ||
        current.network !== network ||
        current.signer !== signer
      ) {
        return { kind: "conflict" as const, operation: current };
      }
      if (
        TERMINAL_STATUSES.has(current.status) ||
        current.leaseExpiresAt.getTime() > now.getTime()
      ) {
        return { kind: "existing" as const, operation: current };
      }

      const leaseToken = this.createLeaseToken();
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      const rows = await transaction<AdapterOperationDbRow[]>`
        update x402_router_adapter_operations
        set lease_token = ${leaseToken},
            lease_expires_at = ${leaseExpiresAt.toISOString()},
            revision = revision + 1,
            updated_at = ${now.toISOString()}
        where id = ${existing.id}
          and revision = ${existing.revision}
        returning *
      `;
      const reclaimed = rows[0];
      if (reclaimed === undefined) {
        const winner = await selectOperation(transaction, input.kind, idempotencyKey, true);
        if (winner === undefined) throw new Error("Adapter operation disappeared during claim");
        return { kind: "existing" as const, operation: recordFromRow(winner) };
      }
      return { kind: "claimed" as const, operation: recordFromRow(reclaimed) };
    });
  }

  async get(
    kind: AdapterOperationKind,
    idempotencyKey: string
  ): Promise<AdapterOperationRecord | undefined> {
    const canonicalKey = canonicalIdempotencyKey(idempotencyKey);
    const rows = await this.sql<AdapterOperationDbRow[]>`
      select *
      from x402_router_adapter_operations
      where kind = ${kind}
        and idempotency_key = ${canonicalKey}
      limit 1
    `;
    const row = rows[0];
    return row === undefined ? undefined : recordFromRow(row);
  }

  async loadPayload(
    kind: AdapterOperationKind,
    idempotencyKey: string
  ): Promise<string | undefined> {
    const canonicalKey = canonicalIdempotencyKey(idempotencyKey);
    const rows = await this.sql<AdapterOperationDbRow[]>`
      select *
      from x402_router_adapter_operations
      where kind = ${kind}
        and idempotency_key = ${canonicalKey}
      limit 1
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    const encrypted = encryptedFromRow(row);
    if (encrypted === undefined) return undefined;
    return decryptJournalPayload(
      encrypted,
      this.encryptionKey,
      operationAad({
        kind: row.kind,
        idempotencyKey: row.idempotency_key,
        requestHash: row.request_hash
      })
    );
  }

  async recordSignedWithSignerNonce(input: {
    readonly kind: "execution" | "refund";
    readonly idempotencyKey: string;
    readonly expectedRevision: number;
    readonly leaseToken: string;
    readonly minimumNonce: bigint;
    readonly signingFailureCode: string;
    readonly createSignedPayload: (
      nonce: bigint
    ) =>
      | Promise<{
          readonly payload: string;
          readonly transactionHash?: string;
        }>
      | {
          readonly payload: string;
          readonly transactionHash?: string;
        };
  }): Promise<AtomicSignedOperationResult> {
    const minimumNonce = validateMinimumNonce(input.minimumNonce);
    const idempotencyKey = canonicalIdempotencyKey(input.idempotencyKey);
    const signingFailureCode = canonicalText(
      input.signingFailureCode,
      "Adapter operation signing failure code"
    );

    return this.sql.begin(async (transaction) => {
      await advisoryLocks(transaction, [
        operationLock(input.kind, idempotencyKey)
      ]);
      const row = await selectOperation(
        transaction,
        input.kind,
        idempotencyKey,
        true
      );
      if (row === undefined) return { kind: "not_found" as const };
      const current = recordFromRow(row);
      if (current.revision !== input.expectedRevision) {
        return {
          kind: "conflict" as const,
          key: "revision" as const,
          operation: current
        };
      }
      if (current.status !== "claimed") {
        return {
          kind: "conflict" as const,
          key: "status" as const,
          operation: current
        };
      }
      if (current.leaseToken !== input.leaseToken) {
        return {
          kind: "conflict" as const,
          key: "lease_token" as const,
          operation: current
        };
      }
      if (current.signerNonce !== undefined || current.hasEncryptedPayload) {
        throw new Error(
          "Claimed operation must not contain a nonce or signed payload"
        );
      }

      await advisoryLocks(transaction, [
        signerLock(current.network, current.signer)
      ]);
      if (
        current.signerNonce !== undefined &&
        current.signerNonce >= minimumNonce
      ) {
        return { kind: "updated" as const, operation: current };
      }

      const nonceRows = await transaction<MaximumNonceRow[]>`
        select max(signer_nonce)::text as nonce
        from x402_router_adapter_operations
        where network = ${current.network}
          and signer = ${current.signer}
          and signer_nonce is not null
          and id <> ${current.id}
      `;
      const maximumReserved =
        nonceRows[0]?.nonce === null || nonceRows[0]?.nonce === undefined
          ? undefined
          : BigInt(nonceRows[0].nonce);
      const nextReserved =
        maximumReserved === undefined ? 0n : maximumReserved + 1n;
      const nonce = minimumNonce > nextReserved ? minimumNonce : nextReserved;
      if (nonce > MAX_EVM_NONCE) {
        throw new Error("Adapter operation signer nonce space is exhausted");
      }

      let signed:
        | {
            readonly payload: string;
            readonly transactionHash?: string;
          }
        | undefined;
      try {
        const candidate = await input.createSignedPayload(nonce);
        if (candidate.payload.trim() === "") {
          throw new Error("Signed adapter operation payload must not be empty");
        }
        if (
          input.kind === "execution" &&
          candidate.transactionHash === undefined
        ) {
          throw new Error(
            "Signed execution operation must include its transaction hash"
          );
        }
        signed = {
          payload: candidate.payload,
          ...(candidate.transactionHash === undefined
            ? {}
            : {
                transactionHash: canonicalTransaction(
                  candidate.transactionHash
                )
              })
        };
      } catch {
        const signingFailureStatus =
          input.kind === "refund"
            ? ("confirmed_failure" as const)
            : ("manual_intervention" as const);
        const abandonedPayload = encryptJournalPayload(
          JSON.stringify({ abandoned: true, reason: signingFailureCode }),
          this.encryptionKey,
          operationAad({
            kind: current.kind,
            idempotencyKey: current.idempotencyKey,
            requestHash: current.requestHash
          })
        );
        const now = this.now();
        const rows = await transaction<AdapterOperationDbRow[]>`
          update x402_router_adapter_operations
          set status = ${signingFailureStatus},
              signer_nonce = null,
              payload_ciphertext = ${abandonedPayload.ciphertext},
              payload_iv = ${abandonedPayload.iv},
              payload_auth_tag = ${abandonedPayload.authTag},
              transaction_hash = null,
              failure_code = ${signingFailureCode},
              revision = revision + 1,
              updated_at = ${now.toISOString()}
          where id = ${current.id}
            and revision = ${input.expectedRevision}
            and status = 'claimed'
            and lease_token = ${input.leaseToken}
          returning *
        `;
        const abandoned = rows[0];
        if (abandoned === undefined) {
          throw new Error(
            "Claimed operation changed while abandoning a signing failure"
          );
        }
        return {
          kind: "signing_failed" as const,
          operation: recordFromRow(abandoned)
        };
      }

      if (signed.transactionHash !== undefined) {
        await advisoryLocks(transaction, [
          transactionLock(current.network, signed.transactionHash)
        ]);
        const owners = await transaction<AdapterOperationDbRow[]>`
          select *
          from x402_router_adapter_operations
          where network = ${current.network}
            and transaction_hash = ${signed.transactionHash}
            and id <> ${current.id}
          limit 1
        `;
        if (owners[0] !== undefined) {
          return {
            kind: "conflict" as const,
            key: "transaction_hash" as const,
            operation: current
          };
        }
      }

      const encrypted = encryptJournalPayload(
        signed.payload,
        this.encryptionKey,
        operationAad({
          kind: current.kind,
          idempotencyKey: current.idempotencyKey,
          requestHash: current.requestHash
        })
      );
      const now = this.now();
      const rows = await transaction<AdapterOperationDbRow[]>`
        update x402_router_adapter_operations
        set status = 'signed',
            signer_nonce = ${nonce.toString()},
            payload_ciphertext = ${encrypted.ciphertext},
            payload_iv = ${encrypted.iv},
            payload_auth_tag = ${encrypted.authTag},
            transaction_hash = ${signed.transactionHash ?? null},
            revision = revision + 1,
            updated_at = ${now.toISOString()}
        where id = ${current.id}
          and revision = ${input.expectedRevision}
          and status = 'claimed'
          and lease_token = ${input.leaseToken}
        returning *
      `;
      const updated = rows[0];
      if (updated === undefined) {
        const winner = await selectOperation(
          transaction,
          input.kind,
          idempotencyKey,
          true
        );
        if (winner === undefined) return { kind: "not_found" as const };
        const winnerRecord = recordFromRow(winner);
        return {
          kind: "conflict" as const,
          key:
            winnerRecord.revision !== input.expectedRevision
              ? ("revision" as const)
              : winnerRecord.status !== "claimed"
                ? ("status" as const)
                : ("lease_token" as const),
          operation: winnerRecord
        };
      }
      return { kind: "updated" as const, operation: recordFromRow(updated) };
    });
  }

  async recordSigned(input: {
    readonly kind: Exclude<AdapterOperationKind, "execution">;
    readonly idempotencyKey: string;
    readonly expectedRevision: number;
    readonly leaseToken: string;
    readonly payload: string;
    readonly transactionHash?: string;
  }): Promise<AdapterOperationTransitionResult> {
    return this.transition({
      ...input,
      from: "claimed",
      to: "signed",
      encryptPayload: input.payload
    });
  }

  async recordUnsubmittedExecutionFailure(input: {
    readonly idempotencyKey: string;
    readonly expectedRevision: number;
    readonly leaseToken: string;
    readonly failureCode: string;
  }): Promise<AdapterOperationTransitionResult> {
    const failureCode = canonicalText(
      input.failureCode,
      "Adapter operation failure code"
    );
    return this.transition({
      kind: "execution",
      idempotencyKey: input.idempotencyKey,
      expectedRevision: input.expectedRevision,
      leaseToken: input.leaseToken,
      from: "claimed",
      to: "manual_intervention",
      encryptPayload: JSON.stringify({
        abandoned: true,
        reason: failureCode
      }),
      failureCode
    });
  }

  async recordUnsubmittedRefundFailure(input: {
    readonly idempotencyKey: string;
    readonly expectedRevision: number;
    readonly leaseToken: string;
    readonly failureCode: string;
  }): Promise<AdapterOperationTransitionResult> {
    const failureCode = canonicalText(
      input.failureCode,
      "Adapter operation failure code"
    );
    return this.transition({
      kind: "refund",
      idempotencyKey: input.idempotencyKey,
      expectedRevision: input.expectedRevision,
      leaseToken: input.leaseToken,
      from: "claimed",
      to: "confirmed_failure",
      encryptPayload: JSON.stringify({
        abandoned: true,
        reason: failureCode
      }),
      failureCode
    });
  }

  async recordSubmitted(input: {
    readonly kind: AdapterOperationKind;
    readonly idempotencyKey: string;
    readonly expectedRevision: number;
    readonly leaseToken: string;
    readonly transactionHash?: string;
  }): Promise<AdapterOperationTransitionResult> {
    return this.transition({
      ...input,
      from: "signed",
      to: "submitted"
    });
  }

  async recordUnsubmittedPaymentFailure(input: {
    readonly idempotencyKey: string;
    readonly expectedRevision: number;
    readonly leaseToken: string;
    readonly failureCode: string;
  }): Promise<AdapterOperationTransitionResult> {
    return this.transition({
      kind: "payment_settlement",
      idempotencyKey: input.idempotencyKey,
      expectedRevision: input.expectedRevision,
      leaseToken: input.leaseToken,
      from: "signed",
      to: "confirmed_failure",
      failureCode: input.failureCode,
    });
  }

  async recordUncertainResult(input: {
    readonly kind: "payment_settlement" | "refund";
    readonly idempotencyKey: string;
    readonly expectedRevision: number;
    readonly leaseToken: string;
    readonly receipt: JsonRecord;
    readonly failureCode: string;
  }): Promise<AdapterOperationTransitionResult> {
    return this.transition({
      ...input,
      from: "submitted",
      to: "submitted"
    });
  }

  async recordOutcome(input: {
    readonly kind: AdapterOperationKind;
    readonly idempotencyKey: string;
    readonly expectedRevision: number;
    readonly leaseToken: string;
    readonly outcome: "confirmed_success" | "confirmed_failure";
    readonly transactionHash?: string;
    readonly receipt?: JsonRecord;
    readonly failureCode?: string;
  }): Promise<AdapterOperationTransitionResult> {
    return this.transition({
      ...input,
      from: "submitted",
      to: input.outcome
    });
  }

  async markManualIntervention(input: {
    readonly kind: AdapterOperationKind;
    readonly idempotencyKey: string;
    readonly expectedRevision: number;
    readonly leaseToken: string;
    readonly from: "claimed" | "signed" | "submitted";
    readonly failureCode: string;
    readonly transactionHash?: string;
    readonly receipt?: JsonRecord;
  }): Promise<AdapterOperationTransitionResult> {
    return this.transition({
      ...input,
      to: "manual_intervention"
    });
  }

  async listRecoverable(
    limit = 100,
    now: Date = this.now()
  ): Promise<AdapterOperationRecord[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) {
      throw new Error("Recoverable adapter operation limit must be between 1 and 1000");
    }
    const rows = await this.sql<AdapterOperationDbRow[]>`
      select *
      from x402_router_adapter_operations
      where status not in (
        'confirmed_success',
        'confirmed_failure',
        'manual_intervention'
      )
        and lease_expires_at <= ${now.toISOString()}
      order by updated_at asc
      limit ${limit}
    `;
    return rows.map(recordFromRow);
  }

  async hasManualIntervention(): Promise<boolean> {
    const rows = await this.sql<{ exists: boolean }[]>`
      select exists(
        select 1 from x402_router_adapter_operations
        where status = 'manual_intervention'
      )
    `;
    return rows[0]?.exists ?? false;
  }

  private async transition(input: {
    readonly kind: AdapterOperationKind;
    readonly idempotencyKey: string;
    readonly expectedRevision: number;
    readonly leaseToken: string;
    readonly from: AdapterOperationStatus;
    readonly to: AdapterOperationStatus;
    readonly encryptPayload?: string;
    readonly transactionHash?: string;
    readonly receipt?: JsonRecord;
    readonly failureCode?: string;
  }): Promise<AdapterOperationTransitionResult> {
    if (!LEGAL_TRANSITIONS[input.from].includes(input.to)) {
      throw new Error(`Illegal adapter operation transition ${input.from} -> ${input.to}`);
    }
    const transactionHash =
      input.transactionHash === undefined
        ? undefined
        : canonicalTransaction(input.transactionHash);
    const idempotencyKey = canonicalIdempotencyKey(input.idempotencyKey);

    return this.sql.begin(async (transaction) => {
      await advisoryLocks(transaction, [
        operationLock(input.kind, idempotencyKey)
      ]);
      const row = await selectOperation(
        transaction,
        input.kind,
        idempotencyKey,
        true
      );
      if (row === undefined) return { kind: "not_found" as const };
      const current = recordFromRow(row);
      if (current.revision !== input.expectedRevision) {
        return {
          kind: "conflict" as const,
          key: "revision" as const,
          operation: current
        };
      }
      if (current.status !== input.from) {
        return {
          kind: "conflict" as const,
          key: "status" as const,
          operation: current
        };
      }
      if (current.leaseToken !== input.leaseToken) {
        return {
          kind: "conflict" as const,
          key: "lease_token" as const,
          operation: current
        };
      }

      const effectiveTransactionHash = transactionHash ?? current.transactionHash;
      if (effectiveTransactionHash !== undefined) {
        await advisoryLocks(transaction, [
          transactionLock(current.network, effectiveTransactionHash)
        ]);
        const owners = await transaction<AdapterOperationDbRow[]>`
          select *
          from x402_router_adapter_operations
          where network = ${current.network}
            and transaction_hash = ${effectiveTransactionHash}
            and id <> ${current.id}
          limit 1
        `;
        if (owners[0] !== undefined) {
          return {
            kind: "conflict" as const,
            key: "transaction_hash" as const,
            operation: current
          };
        }
      }

      const previousEncrypted = encryptedFromRow(row);
      const encrypted =
        input.encryptPayload === undefined
          ? previousEncrypted
          : encryptJournalPayload(
              input.encryptPayload,
              this.encryptionKey,
              operationAad({
                kind: current.kind,
                idempotencyKey: current.idempotencyKey,
                requestHash: current.requestHash
              })
            );
      if (input.to !== "claimed" && encrypted === undefined) {
        throw new Error("Signed adapter operation states require an encrypted payload");
      }

      const now = this.now();
      const receipt = input.receipt ?? current.receipt;
      const receiptParameter =
        receipt === undefined ? null : transaction.json(receipt);
      const rows = await transaction<AdapterOperationDbRow[]>`
        update x402_router_adapter_operations
        set status = ${input.to},
            signer_nonce = ${current.signerNonce?.toString() ?? null},
            payload_ciphertext = ${encrypted?.ciphertext ?? null},
            payload_iv = ${encrypted?.iv ?? null},
            payload_auth_tag = ${encrypted?.authTag ?? null},
            transaction_hash = ${effectiveTransactionHash ?? null},
            receipt = ${receiptParameter},
            failure_code = ${input.failureCode ?? current.failureCode ?? null},
            revision = revision + 1,
            updated_at = ${now.toISOString()}
        where id = ${current.id}
          and revision = ${input.expectedRevision}
          and status = ${input.from}
          and lease_token = ${input.leaseToken}
        returning *
      `;
      const updated = rows[0];
      if (updated === undefined) {
        const winner = await selectOperation(
          transaction,
          input.kind,
          idempotencyKey,
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
                : ("lease_token" as const),
          operation: winnerRecord
        };
      }
      return { kind: "updated" as const, operation: recordFromRow(updated) };
    });
  }
}
