import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[];

export type RiskFindingJson = {
  callIndex: number | null;
  detail: string;
  ruleId: string;
  severity: "low" | "medium" | "high";
};

export const boardroomStatusEnum = pgEnum("sentinel_boardroom_status", [
  "prelaunch",
  "active",
  "winddown",
  "snapshotting",
  "redemptions-open"
]);

// Physical enum/table names remain for an in-place migration; runtime semantics are external controller operations.
export const scheduledOperationStatusEnum = pgEnum("sentinel_queued_action_status", [
  "scheduled",
  "cancelled",
  "executed",
  "invalidated"
]);

export const governanceOperationKindEnum = pgEnum("sentinel_governance_operation_kind", [
  "boardroom",
  "controller"
]);

export const decodeStatusEnum = pgEnum("sentinel_decode_status", ["decoded", "undecoded"]);
export const severityEnum = pgEnum("sentinel_severity", ["low", "medium", "high"]);
export const analysisSourceEnum = pgEnum("sentinel_analysis_source", ["harness", "template"]);
export const channelTypeEnum = pgEnum("sentinel_channel_type", ["telegram", "twitter"]);
export const subscriptionModeEnum = pgEnum("sentinel_subscription_mode", ["holdings", "explicit"]);
export const boardroomControlDestinationEnum = pgEnum("boardroom_control_destination", [
  "user",
  "organization"
]);

export const notificationEventEnum = pgEnum("sentinel_notification_event", [
  "scheduled",
  "cancelled",
  "executed",
  "invalidated",
  "reminder",
  "policy-admin"
]);

export const notificationStatusEnum = pgEnum("sentinel_notification_status", [
  "pending",
  "sent",
  "failed",
  "dead"
]);

export const policyAdminContractEnum = pgEnum("sentinel_policy_admin_contract", [
  "registry",
  "asset-policy"
]);

export const marketLifecycleSourceEnum = pgEnum("sentinel_market_lifecycle_source", [
  "boardroom",
  "bonding-curve",
  "liquidity-factory",
  "liquidity-locker"
]);

export const cursors = pgTable(
  "cursors",
  {
    chainId: integer("chain_id").notNull(),
    scope: text("scope").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.scope] })
  })
);

export const boardrooms = pgTable(
  "boardrooms",
  {
    chainId: integer("chain_id").notNull(),
    address: text("address").notNull(),
    shareToken: text("share_token").notNull(),
    name: text("name"),
    owner: text("owner").notNull(),
    controller: text("executor").notNull(),
    proposer: text("proposer").notNull().default("0x0000000000000000000000000000000000000000"),
    controllerGeneration: bigint("controller_generation", { mode: "bigint" }).notNull().default(sql`0`),
    configurationEpoch: bigint("configuration_epoch", { mode: "bigint" }).notNull().default(sql`0`),
    controllerDelay: bigint("governance_delay", { mode: "bigint" }).notNull(),
    gracePeriod: bigint("grace_period", { mode: "bigint" }).notNull().default(sql`0`),
    windDownDelay: bigint("wind_down_delay", { mode: "bigint" }).notNull().default(sql`0`),
    launched: boolean("launched").notNull().default(false),
    status: boardroomStatusEnum("status").notNull().default("prelaunch"),
    primaryMarketMode: integer("primary_market_mode").notNull().default(0),
    bondingCurve: text("bonding_curve"),
    primaryMarketQuoteAsset: text("primary_market_quote_asset"),
    bondingCurvePhase: integer("bonding_curve_phase"),
    bondingCurveSettlementReason: integer("bonding_curve_settlement_reason"),
    bondingCurvePhaseEndsAt: bigint("bonding_curve_phase_ends_at", { mode: "bigint" }).notNull().default(sql`0`),
    liquidityStatus: integer("liquidity_status").notNull().default(0),
    liquidityLocker: text("liquidity_locker"),
    liquidityPool: text("liquidity_pool"),
    liquidityQuoteAsset: text("liquidity_quote_asset"),
    liquidityReservationCurve: text("liquidity_reservation_curve"),
    liquidityReservationExpectedLocker: text("liquidity_reservation_expected_locker"),
    liquidityReservationExpectedPool: text("liquidity_reservation_expected_pool"),
    liquidityReservationPairKey: text("liquidity_reservation_pair_key"),
    liquidityReservationSalt: text("liquidity_reservation_salt"),
    liquidityReservationExpiresAt: bigint("liquidity_reservation_expires_at", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    createdBlock: bigint("created_block", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.address] }),
    bondingCurveIdx: index("boardrooms_bonding_curve_idx").on(table.chainId, table.bondingCurve),
    liquidityLockerIdx: index("boardrooms_liquidity_locker_idx").on(table.chainId, table.liquidityLocker),
    shareTokenIdx: index("boardrooms_share_token_idx").on(table.chainId, table.shareToken),
    statusIdx: index("boardrooms_status_idx").on(table.chainId, table.status)
  })
);

export const scheduledOperations = pgTable(
  "queued_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: integer("chain_id").notNull(),
    boardroom: text("boardroom").notNull(),
    operationId: text("action_hash").notNull(),
    scheduleTxHash: text("queue_tx_hash").notNull(),
    salt: text("salt").notNull(),
    controller: text("executor").notNull(),
    proposer: text("proposer").notNull().default("0x0000000000000000000000000000000000000000"),
    operationKind: governanceOperationKindEnum("operation_kind").notNull().default("boardroom"),
    controllerGeneration: bigint("controller_generation", { mode: "bigint" }).notNull().default(sql`0`),
    configurationEpoch: bigint("configuration_epoch", { mode: "bigint" }).notNull().default(sql`0`),
    facetSetHash: text("facet_set_hash").notNull(),
    eta: timestamp("eta", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    boardroomEpoch: bigint("epoch", { mode: "bigint" }),
    invalidatedByEpoch: bigint("invalidated_by_epoch", { mode: "bigint" }),
    scheduleBlock: bigint("queue_block", { mode: "bigint" }).notNull(),
    scheduleLogIndex: integer("queue_log_index").notNull().default(0),
    status: scheduledOperationStatusEnum("status").notNull().default("scheduled"),
    cancelledBy: text("cancelled_by"),
    executedBy: text("executed_by"),
    resolvedTxHash: text("resolved_tx_hash"),
    decodeStatus: decodeStatusEnum("decode_status").notNull().default("undecoded"),
    rawCalldata: text("raw_calldata").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    uniqueScheduledOperation: unique("queued_actions_chain_boardroom_hash_tx_unique").on(
      table.chainId,
      table.boardroom,
      table.operationId,
      table.scheduleTxHash
    ),
    boardroomIdx: index("queued_actions_boardroom_idx").on(table.chainId, table.boardroom),
    etaIdx: index("queued_actions_eta_idx").on(table.status, table.eta),
    hashIdx: index("queued_actions_hash_idx").on(table.chainId, table.operationId),
    publicFeedIdx: index("queued_actions_public_feed_idx").on(table.scheduleBlock, table.id)
  })
);

export const actionCalls = pgTable(
  "action_calls",
  {
    actionId: uuid("action_id")
      .notNull()
      .references(() => scheduledOperations.id, { onDelete: "cascade" }),
    callIndex: integer("call_index").notNull(),
    policy: text("policy").notNull(),
    target: text("target").notNull(),
    value: numeric("value", { precision: 78, scale: 0 }).notNull(),
    data: text("data").notNull(),
    selector: text("selector").notNull(),
    decodedFunction: text("decoded_function"),
    decodedArgs: jsonb("decoded_args").$type<JsonValue>()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.actionId, table.callIndex] }),
    policyIdx: index("action_calls_policy_idx").on(table.policy),
    selectorIdx: index("action_calls_selector_idx").on(table.selector),
    targetIdx: index("action_calls_target_idx").on(table.target)
  })
);

export const shareBalances = pgTable(
  "share_balances",
  {
    chainId: integer("chain_id").notNull(),
    token: text("token").notNull(),
    holder: text("holder").notNull(),
    balance: numeric("balance", { precision: 78, scale: 0 }).notNull(),
    updatedBlock: bigint("updated_block", { mode: "bigint" }).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.token, table.holder] }),
    holderIdx: index("share_balances_holder_idx").on(table.holder),
    tokenBalanceIdx: index("share_balances_token_balance_idx").on(table.chainId, table.token, table.balance)
  })
);

export const riskAssessments = pgTable("risk_assessments", {
  actionId: uuid("action_id")
    .primaryKey()
    .references(() => scheduledOperations.id, { onDelete: "cascade" }),
  rulesetVersion: integer("ruleset_version").notNull(),
  severity: severityEnum("severity").notNull(),
  findings: jsonb("findings").$type<RiskFindingJson[]>().notNull(),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow()
});

export const analyses = pgTable(
  "analyses",
  {
    actionId: uuid("action_id")
      .primaryKey()
      .references(() => scheduledOperations.id, { onDelete: "cascade" }),
    harness: text("harness").notNull(),
    model: text("model"),
    summary: text("summary").notNull(),
    effects: jsonb("effects").$type<string[]>().notNull(),
    affectedParties: jsonb("affected_parties").$type<string[]>().notNull(),
    severityRationale: text("severity_rationale").notNull(),
    source: analysisSourceEnum("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  }
);

export const harnessRuns = pgTable(
  "harness_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actionId: uuid("action_id")
      .notNull()
      .unique()
      .references(() => scheduledOperations.id, { onDelete: "cascade" }),
    harness: text("harness").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    startedAtIdx: index("harness_runs_started_at_idx").on(table.startedAt)
  })
);

export const policyAdminEvents = pgTable(
  "policy_admin_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: integer("chain_id").notNull(),
    contract: policyAdminContractEnum("contract").notNull(),
    eventName: text("event_name").notNull(),
    subject: text("subject").notNull(),
    enabled: boolean("enabled").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    uniqueLog: unique("policy_admin_events_chain_tx_log_unique").on(
      table.chainId,
      table.txHash,
      table.logIndex
    ),
    subjectIdx: index("policy_admin_events_subject_idx").on(table.chainId, table.subject)
  })
);

export const marketLifecycleEvents = pgTable(
  "market_lifecycle_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: integer("chain_id").notNull(),
    boardroom: text("boardroom").notNull(),
    source: marketLifecycleSourceEnum("source").notNull(),
    kind: text("kind").notNull(),
    contractAddress: text("contract_address").notNull(),
    actor: text("actor"),
    metadata: jsonb("metadata").$type<Record<string, JsonPrimitive>>().notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    uniqueLog: unique("market_lifecycle_events_chain_tx_log_unique").on(
      table.chainId,
      table.txHash,
      table.logIndex
    ),
    boardroomIdx: index("market_lifecycle_events_boardroom_idx").on(
      table.chainId,
      table.boardroom,
      table.blockNumber
    ),
    contractIdx: index("market_lifecycle_events_contract_idx").on(
      table.chainId,
      table.contractAddress,
      table.blockNumber
    )
  })
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activeOrganizationId: uuid("active_organization_id").references(() => organizations.id, {
      onDelete: "set null"
    })
  },
  (table) => ({
    userIdx: index("auth_sessions_user_idx").on(table.userId)
  })
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    providerAccountUnique: unique("auth_accounts_provider_account_unique").on(
      table.providerId,
      table.accountId
    ),
    userIdx: index("auth_accounts_user_idx").on(table.userId)
  })
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    identifierIdx: index("auth_verifications_identifier_idx").on(table.identifier)
  })
);

export const identityQuotaEvents = pgTable(
  "identity_quota_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    scopeConsumedAtIdx: index("identity_quota_events_scope_consumed_at_idx").on(
      table.scope,
      table.consumedAt
    )
  })
);

export const legacySiweNonces = pgTable(
  "legacy_siwe_nonces",
  {
    nonce: text("nonce").primaryKey(),
    address: text("address").notNull(),
    chainId: integer("chain_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    expiresAtIdx: index("legacy_siwe_nonces_expires_at_idx").on(table.expiresAt)
  })
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    organizationIdx: index("organization_members_organization_idx").on(table.organizationId),
    organizationUserUnique: unique("organization_members_organization_user_unique").on(
      table.organizationId,
      table.userId
    ),
    userIdx: index("organization_members_user_idx").on(table.userId)
  })
);

export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
  },
  (table) => ({
    emailIdx: index("organization_invitations_email_idx").on(table.email),
    organizationIdx: index("organization_invitations_organization_idx").on(table.organizationId)
  })
);

export const authWallets = pgTable(
  "auth_wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    chainId: integer("chain_id").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    addressChainUnique: uniqueIndex("auth_wallets_address_chain_unique").on(
      sql`lower(${table.address})`,
      table.chainId
    ),
    addressIdx: index("auth_wallets_address_idx").on(sql`lower(${table.address})`),
    userIdx: index("auth_wallets_user_idx").on(table.userId)
  })
);

export const walletOwners = pgTable(
  "wallet_owners",
  {
    address: text("address").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    userIdx: index("wallet_owners_user_idx").on(table.userId)
  })
);

export const wallets = pgTable(
  "wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    chainId: integer("chain_id").notNull(),
    alertsEnabled: boolean("alerts_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
    siweMessage: text("siwe_message")
  },
  (table) => ({
    addressChainUnique: uniqueIndex("wallets_address_chain_unique").on(
      sql`lower(${table.address})`,
      table.chainId
    ),
    addressIdx: index("wallets_address_idx").on(sql`lower(${table.address})`),
    userIdx: index("wallets_user_idx").on(table.userId)
  })
);

export const identityWalletLinkReconciliations = pgTable(
  "identity_wallet_link_reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subject: text("subject").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    chainId: integer("chain_id").notNull(),
    siweMessage: text("siwe_message").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    addressUnique: uniqueIndex(
      "identity_wallet_link_reconciliations_address_unique"
    ).on(sql`lower(${table.address})`),
    subjectIdx: index("identity_wallet_link_reconciliations_subject_idx").on(
      table.subject
    ),
    userIdx: index("identity_wallet_link_reconciliations_user_idx").on(
      table.userId
    )
  })
);

export const walletLinkNonces = pgTable("wallet_link_nonces", {
  nonce: text("nonce").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const boardroomControlChallenges = pgTable(
  "boardroom_control_challenges",
  {
    nonce: text("nonce").primaryKey(),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    destinationType: boardroomControlDestinationEnum("destination_type").notNull(),
    destinationId: uuid("destination_id").notNull(),
    scope: text("scope").notNull(),
    chainId: integer("chain_id").notNull(),
    boardroom: text("boardroom").notNull(),
    boardroomEpoch: bigint("boardroom_epoch", { mode: "bigint" }).notNull(),
    controller: text("controller").notNull(),
    controllerGeneration: bigint("controller_generation", { mode: "bigint" }).notNull(),
    configurationHash: text("configuration_hash").notNull(),
    configurationEpoch: bigint("configuration_epoch", { mode: "bigint" }).notNull(),
    facetSetHash: text("facet_set_hash").notNull(),
    issuedBlock: bigint("issued_block", { mode: "bigint" }).notNull(),
    issuedBlockHash: text("issued_block_hash").notNull(),
    audience: text("audience").notNull(),
    domain: text("domain").notNull(),
    message: text("message").notNull(),
    messageHash: text("message_hash").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    destinationIdx: index("boardroom_control_challenges_destination_idx").on(
      table.destinationType,
      table.destinationId,
      table.createdAt
    ),
    identityIdx: index("boardroom_control_challenges_identity_idx").on(
      table.chainId,
      table.boardroom,
      table.facetSetHash,
      table.boardroomEpoch,
      table.controller,
      table.controllerGeneration,
      table.configurationHash,
      table.configurationEpoch
    ),
    requesterIdx: index("boardroom_control_challenges_requester_idx").on(
      table.requestedByUserId,
      table.createdAt
    )
  })
);

export const boardroomControlClaims = pgTable(
  "boardroom_control_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeNonce: text("challenge_nonce")
      .notNull()
      .unique()
      .references(() => boardroomControlChallenges.nonce, { onDelete: "restrict" }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    destinationType: boardroomControlDestinationEnum("destination_type").notNull(),
    destinationId: uuid("destination_id").notNull(),
    scope: text("scope").notNull(),
    chainId: integer("chain_id").notNull(),
    boardroom: text("boardroom").notNull(),
    boardroomEpoch: bigint("boardroom_epoch", { mode: "bigint" }).notNull(),
    controller: text("controller").notNull(),
    controllerGeneration: bigint("controller_generation", { mode: "bigint" }).notNull(),
    configurationHash: text("configuration_hash").notNull(),
    configurationEpoch: bigint("configuration_epoch", { mode: "bigint" }).notNull(),
    facetSetHash: text("facet_set_hash").notNull(),
    verifiedBlock: bigint("verified_block", { mode: "bigint" }).notNull(),
    verifiedBlockHash: text("verified_block_hash").notNull(),
    messageHash: text("message_hash").notNull(),
    signatureHash: text("signature_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    destinationIdx: index("boardroom_control_claims_destination_idx").on(
      table.destinationType,
      table.destinationId,
      table.createdAt
    ),
    identityIdx: index("boardroom_control_claims_identity_idx").on(
      table.chainId,
      table.boardroom,
      table.facetSetHash,
      table.boardroomEpoch,
      table.controller,
      table.controllerGeneration,
      table.configurationHash,
      table.configurationEpoch,
      table.createdAt
    )
  })
);

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: channelTypeEnum("type").notNull(),
    telegramChatId: text("telegram_chat_id").unique(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, JsonValue>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    userIdx: index("channels_user_idx").on(table.userId)
  })
);

export const telegramLinkCodes = pgTable("telegram_link_codes", {
  code: text("code").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const subscriptions = pgTable("subscriptions", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  mode: subscriptionModeEnum("mode").notNull().default("holdings"),
  minSeverity: severityEnum("min_severity").notNull().default("medium"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const subscriptionBoardrooms = pgTable(
  "subscription_boardrooms",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => subscriptions.userId, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    boardroom: text("boardroom").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.chainId, table.boardroom] })
  })
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    channelType: channelTypeEnum("channel_type").notNull(),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    actionId: uuid("action_id")
      .notNull()
      .references(() => scheduledOperations.id, { onDelete: "cascade" }),
    event: notificationEventEnum("event").notNull(),
    payload: jsonb("payload").$type<JsonValue>().notNull(),
    status: notificationStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    externalId: text("external_id"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    deliveryIdx: index("notifications_delivery_idx").on(table.status, table.nextAttemptAt),
    actionEventIdx: index("notifications_action_event_idx").on(table.actionId, table.event),
    userIdx: index("notifications_user_idx").on(table.userId)
  })
);
