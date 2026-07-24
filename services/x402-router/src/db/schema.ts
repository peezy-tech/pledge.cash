import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import type {
  IntentExecutionRecord,
  IntentExecutionStatus
} from "x402-hl/intents/server";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];
export type JsonRecord = { readonly [key: string]: JsonValue };

export type RouterActionKind = "amm_swap" | "fixed_price_sale";
export type InventoryReservationScope = "destination_execution" | "source_refund";
export type InventoryReservationStatus =
  | "active"
  | "committed"
  | "consumed"
  | "released";
export type AdapterOperationKind = "payment_settlement" | "execution" | "refund";
export type AdapterOperationStatus =
  | "claimed"
  | "signed"
  | "submitted"
  | "confirmed_success"
  | "confirmed_failure"
  | "manual_intervention";

export const routerQuotes = pgTable(
  "x402_router_quotes",
  {
    id: text("id").primaryKey(),
    actionKind: text("action_kind").$type<RouterActionKind>().notNull(),
    chainId: integer("chain_id").notNull(),
    payer: text("payer").notNull(),
    recipient: text("recipient").notNull(),
    refundAddress: text("refund_address").notNull(),
    target: text("target").notNull(),
    quote: jsonb("quote").$type<JsonRecord>().notNull(),
    paymentIdentifierHash: text("payment_identifier_hash").notNull(),
    paymentNetwork: text("payment_network").notNull(),
    paymentAsset: text("payment_asset").notNull(),
    paymentAmount: numeric("payment_amount", { precision: 78, scale: 0 }).notNull(),
    application: text("application").notNull(),
    gateway: text("gateway").notNull(),
    intentTemplateHash: text("intent_template_hash").notNull(),
    paymentRequirements: jsonb("payment_requirements").$type<JsonRecord>().notNull(),
    intent: jsonb("intent").$type<JsonRecord>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    actionKindCheck: check(
      "x402_router_quotes_action_kind_check",
      sql`${table.actionKind} in ('amm_swap', 'fixed_price_sale')`
    ),
    expiresAtIdx: index("x402_router_quotes_expires_at_idx").on(table.expiresAt),
    paymentIdentifierUnique: uniqueIndex(
      "x402_router_quotes_payment_identifier_hash_unique"
    ).on(table.paymentIdentifierHash)
  })
);

export const quotePaymentBindings = pgTable(
  "x402_router_quote_payment_bindings",
  {
    quoteId: text("quote_id")
      .primaryKey()
      .references(() => routerQuotes.id, { onDelete: "restrict" }),
    attemptId: text("attempt_id").notNull(),
    paymentPayloadHash: text("payment_payload_hash").notNull(),
    paymentRequirementsHash: text("payment_requirements_hash").notNull(),
    boundAt: timestamp("bound_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    attemptUnique: uniqueIndex(
      "x402_router_quote_payment_bindings_attempt_unique"
    ).on(table.attemptId),
    payloadUnique: uniqueIndex(
      "x402_router_quote_payment_bindings_payload_unique"
    ).on(table.paymentPayloadHash)
  })
);

export const inventoryReservations = pgTable(
  "x402_router_inventory_reservations",
  {
    quoteId: text("quote_id")
      .notNull()
      .references(() => routerQuotes.id, { onDelete: "restrict" }),
    scope: text("scope").$type<InventoryReservationScope>().notNull(),
    network: text("network").notNull(),
    asset: text("asset").notNull(),
    amount: numeric("amount", { precision: 78, scale: 0 }).notNull(),
    status: text("status").$type<InventoryReservationStatus>().notNull().default("active"),
    revision: integer("revision").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.quoteId, table.scope, table.network, table.asset] }),
    assetStatusIdx: index("x402_router_inventory_asset_status_idx").on(
      table.network,
      table.asset,
      table.status,
      table.expiresAt
    ),
    scopeCheck: check(
      "x402_router_inventory_scope_check",
      sql`${table.scope} in ('destination_execution', 'source_refund')`
    ),
    statusCheck: check(
      "x402_router_inventory_status_check",
      sql`${table.status} in ('active', 'committed', 'consumed', 'released')`
    )
  })
);

export const intentPayments = pgTable(
  "x402_router_intent_payments",
  {
    paymentNetwork: text("payment_network").notNull(),
    paymentTransaction: text("payment_transaction").notNull(),
    intentHash: text("intent_hash").notNull(),
    primaryPayment: boolean("primary_payment").notNull(),
    application: text("application").notNull(),
    gateway: text("gateway").notNull(),
    quoteId: text("quote_id").notNull(),
    executionNetwork: text("execution_network"),
    executionTransaction: text("execution_transaction"),
    refundNetwork: text("refund_network"),
    refundTransaction: text("refund_transaction"),
    revision: integer("revision").notNull(),
    status: text("status").$type<IntentExecutionStatus>().notNull(),
    claimToken: text("claim_token"),
    record: jsonb("record").$type<IntentExecutionRecord>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.paymentNetwork, table.paymentTransaction] }),
    intentPrimaryUnique: uniqueIndex("x402_router_intent_primary_unique")
      .on(table.intentHash)
      .where(sql`${table.primaryPayment}`),
    quotePrimaryUnique: uniqueIndex("x402_router_intent_quote_primary_unique")
      .on(table.application, table.gateway, table.quoteId)
      .where(sql`${table.primaryPayment}`),
    executionTransactionUnique: uniqueIndex("x402_router_intent_execution_tx_unique")
      .on(table.executionNetwork, table.executionTransaction)
      .where(sql`${table.executionTransaction} is not null`),
    refundTransactionUnique: uniqueIndex("x402_router_intent_refund_tx_unique")
      .on(table.refundNetwork, table.refundTransaction)
      .where(sql`${table.refundTransaction} is not null`),
    statusIdx: index("x402_router_intent_status_idx").on(table.status, table.updatedAt)
  })
);

export const adapterOperations = pgTable(
  "x402_router_adapter_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<AdapterOperationKind>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    network: text("network").notNull(),
    signer: text("signer").notNull(),
    status: text("status").$type<AdapterOperationStatus>().notNull().default("claimed"),
    signerNonce: numeric("signer_nonce", {
      precision: 20,
      scale: 0,
      mode: "bigint"
    }),
    payloadCiphertext: text("payload_ciphertext"),
    payloadIv: text("payload_iv"),
    payloadAuthTag: text("payload_auth_tag"),
    transactionHash: text("transaction_hash"),
    receipt: jsonb("receipt").$type<JsonRecord>(),
    failureCode: text("failure_code"),
    revision: integer("revision").notNull().default(0),
    leaseToken: uuid("lease_token").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    kindCheck: check(
      "x402_router_adapter_operations_kind_check",
      sql`${table.kind} in ('payment_settlement', 'execution', 'refund')`
    ),
    statusCheck: check(
      "x402_router_adapter_operations_status_check",
      sql`${table.status} in (
        'claimed',
        'signed',
        'submitted',
        'confirmed_success',
        'confirmed_failure',
        'manual_intervention'
      )`
    ),
    signerNonceCheck: check(
      "x402_router_adapter_operations_signer_nonce_check",
      sql`${table.signerNonce} is null or (
        ${table.signerNonce} >= 0
        and ${table.signerNonce} <= 9007199254740991
      )`
    ),
    executionSignedFieldsCheck: check(
      "x402_router_adapter_operations_execution_signed_fields_check",
      sql`${table.kind} <> 'execution' or (
        (
          ${table.status} = 'claimed'
          and ${table.signerNonce} is null
          and ${table.transactionHash} is null
          and ${table.payloadCiphertext} is null
        )
        or (
          ${table.status} = 'manual_intervention'
          and (
            ${table.signerNonce} is null
            or (
              ${table.signerNonce} is not null
              and ${table.transactionHash} is not null
            )
          )
        )
        or (
          ${table.status} in (
            'signed',
            'submitted',
            'confirmed_success',
            'confirmed_failure'
          )
          and ${table.signerNonce} is not null
          and ${table.transactionHash} is not null
        )
      )`
    ),
    idempotencyUnique: uniqueIndex("x402_router_adapter_operations_idempotency_unique").on(
      table.kind,
      table.idempotencyKey
    ),
    transactionUnique: uniqueIndex("x402_router_adapter_operations_transaction_unique")
      .on(table.network, table.transactionHash)
      .where(sql`${table.transactionHash} is not null`),
    signerNonceUnique: uniqueIndex(
      "x402_router_adapter_operations_signer_nonce_unique"
    )
      .on(table.network, table.signer, table.signerNonce)
      .where(sql`${table.signerNonce} is not null`),
    leaseIdx: index("x402_router_adapter_operations_lease_idx").on(
      table.status,
      table.leaseExpiresAt
    )
  })
);
