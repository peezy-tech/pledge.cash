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

export type RouterActionKind =
  | "amm_swap"
  | "fixed_price_sale"
  | "recurring_support";
export type SupportChallengeAction =
  | "plan_create"
  | "plan_retire"
  | "subscription_create"
  | "subscription_cancel";
export type SupportAuthorityMode = "prelaunch_owner" | "launched_controller";
export type SupportPlanStatus = "active" | "retired";
export type SupportSubscriptionStatus = "active" | "cancelled";
export type SupportInvoiceStatus = "open" | "cancelled";
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
      sql`${table.actionKind} in ('amm_swap', 'fixed_price_sale', 'recurring_support')`
    ),
    expiresAtIdx: index("x402_router_quotes_expires_at_idx").on(table.expiresAt),
    paymentIdentifierUnique: uniqueIndex(
      "x402_router_quotes_payment_identifier_hash_unique"
    ).on(table.paymentIdentifierHash)
  })
);

export const supportChallenges = pgTable(
  "x402_router_support_challenges",
  {
    id: uuid("id").primaryKey(),
    action: text("action").$type<SupportChallengeAction>().notNull(),
    actor: text("actor").notNull(),
    boardroom: text("boardroom").notNull(),
    chainId: integer("chain_id").notNull(),
    authorityMode: text("authority_mode").$type<SupportAuthorityMode>(),
    authority: text("authority"),
    controllerGeneration: numeric("controller_generation", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    configurationEpoch: numeric("configuration_epoch", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    planId: uuid("plan_id").notNull(),
    payload: jsonb("payload").$type<JsonRecord>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    message: text("message").notNull(),
    issuedBlock: numeric("issued_block", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    issuedBlockHash: text("issued_block_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    signatureHash: text("signature_hash"),
    verifiedBlock: numeric("verified_block", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }),
    verifiedBlockHash: text("verified_block_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    actionCheck: check(
      "x402_router_support_challenges_action_check",
      sql`${table.action} in (
        'plan_create',
        'plan_retire',
        'subscription_create',
        'subscription_cancel'
      )`,
    ),
    authorityModeCheck: check(
      "x402_router_support_challenges_authority_mode_check",
      sql`${table.authorityMode} is null or ${table.authorityMode} in (
        'prelaunch_owner',
        'launched_controller'
      )`,
    ),
    authorityCheck: check(
      "x402_router_support_challenges_authority_check",
      sql`(
          ${table.action} in ('plan_create', 'plan_retire')
          and ${table.authorityMode} is not null
          and ${table.authority} is not null
          and ${table.authority} = lower(btrim(${table.authority}))
          and ${table.authority} ~ '^0x[0-9a-f]{40}$'
        ) or (
          ${table.action} in ('subscription_create', 'subscription_cancel')
          and ${table.authorityMode} is null
          and ${table.authority} is null
        )`,
    ),
    actorCheck: check(
      "x402_router_support_challenges_actor_check",
      sql`${table.actor} = lower(btrim(${table.actor}))
        and ${table.actor} ~ '^0x[0-9a-f]{40}$'`,
    ),
    boardroomCheck: check(
      "x402_router_support_challenges_boardroom_check",
      sql`${table.boardroom} = lower(btrim(${table.boardroom}))
        and ${table.boardroom} ~ '^0x[0-9a-f]{40}$'`,
    ),
    chainCheck: check(
      "x402_router_support_challenges_chain_check",
      sql`${table.chainId} = 998`,
    ),
    generationCheck: check(
      "x402_router_support_challenges_generation_check",
      sql`${table.controllerGeneration} >= 0
        and ${table.configurationEpoch} >= 0`,
    ),
    payloadCheck: check(
      "x402_router_support_challenges_payload_check",
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
    payloadHashCheck: check(
      "x402_router_support_challenges_payload_hash_check",
      sql`${table.payloadHash} = lower(${table.payloadHash})
        and ${table.payloadHash} ~ '^0x[0-9a-f]{64}$'`,
    ),
    issuedBlockCheck: check(
      "x402_router_support_challenges_issued_block_check",
      sql`${table.issuedBlock} >= 0
        and ${table.issuedBlockHash} = lower(${table.issuedBlockHash})
        and ${table.issuedBlockHash} ~ '^0x[0-9a-f]{64}$'`,
    ),
    expiryCheck: check(
      "x402_router_support_challenges_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    consumedCheck: check(
      "x402_router_support_challenges_consumed_check",
      sql`(
          ${table.consumedAt} is null
          and ${table.signatureHash} is null
          and ${table.verifiedBlock} is null
          and ${table.verifiedBlockHash} is null
        ) or (
          ${table.consumedAt} is not null
          and ${table.signatureHash} is not null
          and ${table.signatureHash} ~ '^0x[0-9a-f]{64}$'
          and ${table.verifiedBlock} is not null
          and ${table.verifiedBlock} >= 0
          and ${table.verifiedBlockHash} is not null
          and ${table.verifiedBlockHash} ~ '^0x[0-9a-f]{64}$'
        )`,
    ),
    expiryIdx: index("x402_router_support_challenges_expiry_idx").on(
      table.expiresAt,
    ),
  }),
);

export const supportPlans = pgTable(
  "x402_router_support_plans",
  {
    id: uuid("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    boardroom: text("boardroom").notNull(),
    asset: text("asset").notNull(),
    amount: numeric("amount", { precision: 78, scale: 0 }).notNull(),
    cadence: text("cadence").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    termsHash: text("terms_hash").notNull(),
    status: text("status").$type<SupportPlanStatus>().notNull(),
    authorityMode: text("authority_mode").$type<SupportAuthorityMode>().notNull(),
    authority: text("authority").notNull(),
    controllerGeneration: numeric("controller_generation", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    configurationEpoch: numeric("configuration_epoch", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    verifiedBlock: numeric("verified_block", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    verifiedBlockHash: text("verified_block_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (table) => ({
    chainCheck: check(
      "x402_router_support_plans_chain_check",
      sql`${table.chainId} = 998`,
    ),
    boardroomCheck: check(
      "x402_router_support_plans_boardroom_check",
      sql`${table.boardroom} = lower(btrim(${table.boardroom}))
        and ${table.boardroom} ~ '^0x[0-9a-f]{40}$'`,
    ),
    assetCheck: check(
      "x402_router_support_plans_asset_check",
      sql`${table.asset} = lower(btrim(${table.asset}))
        and ${table.asset} ~ '^0x[0-9a-f]{40}$'`,
    ),
    amountCheck: check(
      "x402_router_support_plans_amount_check",
      sql`${table.amount} > 0`,
    ),
    cadenceCheck: check(
      "x402_router_support_plans_cadence_check",
      sql`${table.cadence} = 'monthly'`,
    ),
    titleCheck: check(
      "x402_router_support_plans_title_check",
      sql`length(${table.title}) between 1 and 80
        and ${table.title} = btrim(${table.title})`,
    ),
    descriptionCheck: check(
      "x402_router_support_plans_description_check",
      sql`length(${table.description}) between 1 and 280
        and ${table.description} = btrim(${table.description})`,
    ),
    termsHashCheck: check(
      "x402_router_support_plans_terms_hash_check",
      sql`${table.termsHash} = lower(${table.termsHash})
        and ${table.termsHash} ~ '^0x[0-9a-f]{64}$'`,
    ),
    statusCheck: check(
      "x402_router_support_plans_status_check",
      sql`${table.status} in ('active', 'retired')`,
    ),
    authorityModeCheck: check(
      "x402_router_support_plans_authority_mode_check",
      sql`${table.authorityMode} in ('prelaunch_owner', 'launched_controller')`,
    ),
    authorityCheck: check(
      "x402_router_support_plans_authority_check",
      sql`${table.authority} = lower(btrim(${table.authority}))
        and ${table.authority} ~ '^0x[0-9a-f]{40}$'`,
    ),
    generationCheck: check(
      "x402_router_support_plans_generation_check",
      sql`${table.controllerGeneration} >= 0
        and ${table.configurationEpoch} >= 0`,
    ),
    verifiedBlockHashCheck: check(
      "x402_router_support_plans_verified_block_hash_check",
      sql`${table.verifiedBlock} >= 0
        and ${table.verifiedBlockHash} = lower(${table.verifiedBlockHash})
        and ${table.verifiedBlockHash} ~ '^0x[0-9a-f]{64}$'`,
    ),
    retiredCheck: check(
      "x402_router_support_plans_retired_check",
      sql`(
          ${table.status} = 'active'
          and ${table.retiredAt} is null
        ) or (
          ${table.status} = 'retired'
          and ${table.retiredAt} is not null
        )`,
    ),
    boardroomStatusIdx: index(
      "x402_router_support_plans_boardroom_status_idx",
    ).on(table.chainId, table.boardroom, table.status, table.createdAt),
    termsHashUnique: uniqueIndex(
      "x402_router_support_plans_terms_hash_unique",
    ).on(table.termsHash),
  }),
);

export const supportSubscriptions = pgTable(
  "x402_router_support_subscriptions",
  {
    id: uuid("id").primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => supportPlans.id, { onDelete: "restrict" }),
    payer: text("payer").notNull(),
    status: text("status").$type<SupportSubscriptionStatus>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => ({
    payerCheck: check(
      "x402_router_support_subscriptions_payer_check",
      sql`${table.payer} = lower(btrim(${table.payer}))
        and ${table.payer} ~ '^0x[0-9a-f]{40}$'`,
    ),
    statusCheck: check(
      "x402_router_support_subscriptions_status_check",
      sql`${table.status} in ('active', 'cancelled')`,
    ),
    cancelledCheck: check(
      "x402_router_support_subscriptions_cancelled_check",
      sql`(
          ${table.status} = 'active'
          and ${table.cancelledAt} is null
        ) or (
          ${table.status} = 'cancelled'
          and ${table.cancelledAt} is not null
        )`,
    ),
    activePayerUnique: uniqueIndex(
      "x402_router_support_subscriptions_active_payer_unique",
    )
      .on(table.planId, table.payer)
      .where(sql`${table.status} = 'active'`),
  }),
);

export const supportInvoices = pgTable(
  "x402_router_support_invoices",
  {
    id: uuid("id").primaryKey(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => supportSubscriptions.id, { onDelete: "restrict" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => supportPlans.id, { onDelete: "restrict" }),
    activeQuoteId: text("active_quote_id").references(() => routerQuotes.id, {
      onDelete: "restrict",
    }),
    periodIndex: integer("period_index").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    payer: text("payer").notNull(),
    boardroom: text("boardroom").notNull(),
    asset: text("asset").notNull(),
    amount: numeric("amount", { precision: 78, scale: 0 }).notNull(),
    status: text("status").$type<SupportInvoiceStatus>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => ({
    payerCheck: check(
      "x402_router_support_invoices_payer_check",
      sql`${table.payer} = lower(btrim(${table.payer}))
        and ${table.payer} ~ '^0x[0-9a-f]{40}$'`,
    ),
    boardroomCheck: check(
      "x402_router_support_invoices_boardroom_check",
      sql`${table.boardroom} = lower(btrim(${table.boardroom}))
        and ${table.boardroom} ~ '^0x[0-9a-f]{40}$'`,
    ),
    assetCheck: check(
      "x402_router_support_invoices_asset_check",
      sql`${table.asset} = lower(btrim(${table.asset}))
        and ${table.asset} ~ '^0x[0-9a-f]{40}$'`,
    ),
    amountCheck: check(
      "x402_router_support_invoices_amount_check",
      sql`${table.amount} > 0`,
    ),
    statusCheck: check(
      "x402_router_support_invoices_status_check",
      sql`${table.status} in ('open', 'cancelled')`,
    ),
    periodCheck: check(
      "x402_router_support_invoices_period_check",
      sql`${table.periodIndex} >= 0
        and ${table.periodEnd} > ${table.periodStart}
        and ${table.dueAt} = ${table.periodStart}`,
    ),
    cancelledCheck: check(
      "x402_router_support_invoices_cancelled_check",
      sql`(
          ${table.status} = 'open'
          and ${table.cancelledAt} is null
        ) or (
          ${table.status} = 'cancelled'
          and ${table.cancelledAt} is not null
        )`,
    ),
    subscriptionPeriodUnique: uniqueIndex(
      "x402_router_support_invoices_subscription_period_unique",
    ).on(table.subscriptionId, table.periodIndex),
    boardroomPayerIdx: index(
      "x402_router_support_invoices_boardroom_payer_idx",
    ).on(table.boardroom, table.payer),
  }),
);

export const supportInvoiceQuotes = pgTable(
  "x402_router_support_invoice_quotes",
  {
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => supportInvoices.id, { onDelete: "restrict" }),
    quoteId: text("quote_id")
      .notNull()
      .references(() => routerQuotes.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.invoiceId, table.quoteId] }),
    quoteUnique: uniqueIndex(
      "x402_router_support_invoice_quotes_quote_unique",
    ).on(table.quoteId),
    invoiceCreatedIdx: index(
      "x402_router_support_invoice_quotes_invoice_created_idx",
    ).on(table.invoiceId, table.createdAt),
  }),
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
