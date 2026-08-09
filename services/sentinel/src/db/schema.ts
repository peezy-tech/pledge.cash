import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
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
      .references(() => users.id, { onDelete: "cascade" })
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
    consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull().defaultNow()
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
    addressUnique: uniqueIndex("identity_wallet_link_reconciliations_address_unique").on(
      sql`lower(${table.address})`
    ),
    subjectIdx: index("identity_wallet_link_reconciliations_subject_idx").on(table.subject),
    userIdx: index("identity_wallet_link_reconciliations_user_idx").on(table.userId)
  })
);
