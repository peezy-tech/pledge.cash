import { sqliteTable as table } from "drizzle-orm/sqlite-core";
import * as t from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

export const users = table("users", {
  id: t
    .text()
    .$default(() => `user_${generateUniqueString(16)}`)
    .notNull()
    .primaryKey(),
  name: t.text(),
  role: t.text().$type<"user" | "admin">().default("user"),
  evm_address: t.text().unique(),
});

export const txHashes = table("tx_hashes", {
  hash: t.text().notNull().primaryKey(),
  createdAt: t.integer().default(Date.now()).notNull(),
  metadata: t.text({ mode: "json" }),
});

// "paid" invoices always have a txHash, but "pending" and "expired" invoices do not.
// "paid" invoices always have a payerAddress, but "pending" and "expired" invoices not necessarily.
export const hyperliquidInvoices = table("hyperliquid_invoices", {
  id: t
    .text()
    .primaryKey()
    .$default(() => `hlinv_${generateUniqueString(16)}`),
  creatorId: t
    .text()
    .references(() => users.id)
    .notNull(),
  payerAddress: t.text(),
  payerUserId: t.text().references(() => users.id),
  paymentType: t.text().$type<"personal" | "multisig">(),
  actualPayerAddress: t.text(),
  token: t.text().notNull(),
  amount: t.text().notNull(),
  description: t.text(),
  status: t
    .text()
    .$type<"pending" | "paid" | "expired">()
    .default("pending")
    .notNull(),
  txHash: t.text().references(() => txHashes.hash),
  createdAt: t.integer().default(Date.now()).notNull(),
  paidAt: t.integer(),
  expiresAt: t.integer(), // Optional: for future implementation
});

export const hyperliquidInvoicesRelations = relations(
  hyperliquidInvoices,
  ({ one, many }) => ({
    creator: one(users, {
      fields: [hyperliquidInvoices.creatorId],
      references: [users.id],
    }),
    payer: one(users, {
      fields: [hyperliquidInvoices.payerUserId],
      references: [users.id],
    }),
    hooks: many(invoiceHooks),
  })
);

export const invoiceHooks = table("invoice_hooks", {
  id: t
    .text()
    .primaryKey()
    .$default(() => `hook_${generateUniqueString(16)}`),
  invoiceId: t
    .text()
    .notNull()
    .references(() => hyperliquidInvoices.id),
  event: t.text().$type<"invoice.paid" | "invoice.created">().notNull(),
  type: t.text().$type<"discord" | "webhook">().notNull(),
  url: t.text().notNull(),
  createdAt: t.integer().default(Date.now()).notNull(),
});

export const invoiceHooksRelations = relations(invoiceHooks, ({ one }) => ({
  invoice: one(hyperliquidInvoices, {
    fields: [invoiceHooks.invoiceId],
    references: [hyperliquidInvoices.id],
  }),
}));

export const multisigAccounts = table("multisig_accounts", {
  id: t
    .text()
    .primaryKey()
    .$default(() => `msig_${generateUniqueString(16)}`),
  userAddress: t.text().notNull().unique(),
  operatorAddress: t.text().notNull().unique(),
  operatorPrivateKey: t.text().notNull().unique(),
  address: t.text().notNull(),
  createdAt: t.integer().default(Date.now()).notNull(),
});

export const agentWallets = table("agent_wallets", {
  id: t
    .text()
    .primaryKey()
    .$default(() => `ag_${generateUniqueString(16)}`),
  multisigId: t
    .text()
    .references(() => multisigAccounts.id, {
      onDelete: "cascade",
    })
    .notNull(),
  userId: t
    .text()
    .notNull()
    .references(() => users.id)
    .notNull(),
  address: t.text().notNull(),
  createdAt: t.integer().default(Date.now()).notNull(),
});

// Spot tokens metadata table
export const spotTokensMetadata = table("spot_tokens_metadata", {
  id: t
    .text()
    .primaryKey()
    .$default(() => `st_${generateUniqueString(16)}`),
  tokenName: t.text().notNull().unique(),
  szDecimals: t.integer().notNull(),
  weiDecimals: t.integer().notNull(),
  tokenId: t.text().notNull(),
  isCanonical: t.integer({ mode: "boolean" }).default(false).notNull(),
  fullName: t.text(),
  evmContract: t.text({ mode: "json" }), // Store as JSON for EvmContract data
  index: t.integer().notNull(),
  createdAt: t.integer().default(Date.now()).notNull(),
  updatedAt: t.integer().default(Date.now()).notNull(),
});

// Spot tokens mid prices table (real-time data from WebSocket)
export const spotTokensMidPrices = table("spot_tokens_mid_prices", {
  id: t
    .text()
    .primaryKey()
    .$default(() => `mid_${generateUniqueString(16)}`),
  tokenName: t.text().notNull(),
  midPrice: t.text().notNull(), // Store as string to maintain precision
  timestamp: t.integer().default(Date.now()).notNull(),
  source: t.text().$type<"websocket" | "rest">().default("websocket").notNull(),
});

// Cache metadata table for managing cache invalidation
export const spotTokensCache = table("spot_tokens_cache", {
  id: t
    .text()
    .primaryKey()
    .$default(() => `cache_${generateUniqueString(16)}`),
  cacheKey: t.text().notNull().unique(), // e.g., "spot_tokens_metadata", "spot_tokens_mids"
  lastUpdated: t.integer().default(Date.now()).notNull(),
  lastUpdateSource: t.text().$type<"websocket" | "rest" | "manual">().default("rest").notNull(),
  dataCount: t.integer().default(0).notNull(), // Number of records in the cache
  isValid: t.integer({ mode: "boolean" }).default(true).notNull(),
  expiresAt: t.integer(), // Optional expiration time
  metadata: t.text({ mode: "json" }), // Additional metadata as JSON
});

// Relations for spot tokens
export const spotTokensMetadataRelations = relations(spotTokensMetadata, ({ many }) => ({
  midPrices: many(spotTokensMidPrices),
}));

// Indexes for better query performance
export const spotTokensMidPricesIndexes = {
  tokenTimestamp: t.index("mid_prices_token_timestamp_idx")
    .on(spotTokensMidPrices.tokenName, spotTokensMidPrices.timestamp),
  timestamp: t.index("mid_prices_timestamp_idx")
    .on(spotTokensMidPrices.timestamp),
};

function generateUniqueString(length: number = 12): string {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let uniqueString = "";

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    uniqueString += characters[randomIndex];
  }

  return uniqueString;
}
