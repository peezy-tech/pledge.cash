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
  uuid
} from "drizzle-orm/pg-core";

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
  "winddown"
]);

export const queuedActionStatusEnum = pgEnum("sentinel_queued_action_status", [
  "queued",
  "cancelled",
  "executed"
]);

export const decodeStatusEnum = pgEnum("sentinel_decode_status", ["decoded", "undecoded"]);
export const severityEnum = pgEnum("sentinel_severity", ["low", "medium", "high"]);
export const analysisSourceEnum = pgEnum("sentinel_analysis_source", ["harness", "template"]);
export const channelTypeEnum = pgEnum("sentinel_channel_type", ["telegram", "twitter"]);
export const subscriptionModeEnum = pgEnum("sentinel_subscription_mode", ["holdings", "explicit"]);

export const notificationEventEnum = pgEnum("sentinel_notification_event", [
  "queued",
  "cancelled",
  "executed"
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
    executor: text("executor").notNull(),
    governanceDelay: bigint("governance_delay", { mode: "bigint" }).notNull(),
    launched: boolean("launched").notNull().default(false),
    status: boardroomStatusEnum("status").notNull().default("prelaunch"),
    createdBlock: bigint("created_block", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.address] }),
    shareTokenIdx: index("boardrooms_share_token_idx").on(table.chainId, table.shareToken),
    statusIdx: index("boardrooms_status_idx").on(table.chainId, table.status)
  })
);

export const queuedActions = pgTable(
  "queued_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: integer("chain_id").notNull(),
    boardroom: text("boardroom").notNull(),
    actionHash: text("action_hash").notNull(),
    queueTxHash: text("queue_tx_hash").notNull(),
    salt: text("salt").notNull(),
    executor: text("executor").notNull(),
    eta: timestamp("eta", { withTimezone: true }).notNull(),
    queueBlock: bigint("queue_block", { mode: "bigint" }).notNull(),
    status: queuedActionStatusEnum("status").notNull().default("queued"),
    cancelledBy: text("cancelled_by"),
    executedBy: text("executed_by"),
    resolvedTxHash: text("resolved_tx_hash"),
    decodeStatus: decodeStatusEnum("decode_status").notNull().default("undecoded"),
    rawCalldata: text("raw_calldata").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    uniqueQueuedAction: unique("queued_actions_chain_boardroom_hash_tx_unique").on(
      table.chainId,
      table.boardroom,
      table.actionHash,
      table.queueTxHash
    ),
    boardroomIdx: index("queued_actions_boardroom_idx").on(table.chainId, table.boardroom),
    etaIdx: index("queued_actions_eta_idx").on(table.status, table.eta),
    hashIdx: index("queued_actions_hash_idx").on(table.chainId, table.actionHash)
  })
);

export const actionCalls = pgTable(
  "action_calls",
  {
    actionId: uuid("action_id")
      .notNull()
      .references(() => queuedActions.id, { onDelete: "cascade" }),
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
    .references(() => queuedActions.id, { onDelete: "cascade" }),
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
      .references(() => queuedActions.id, { onDelete: "cascade" }),
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

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  workosUserId: text("workos_user_id").notNull().unique(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const wallets = pgTable(
  "wallets",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
    siweMessage: text("siwe_message").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.address] }),
    addressIdx: index("wallets_address_idx").on(table.address)
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
      .references(() => queuedActions.id, { onDelete: "cascade" }),
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
