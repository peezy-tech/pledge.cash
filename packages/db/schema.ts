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
  paymentType: t.text().$type<"personal" | "pledge-wallet">(),
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

export const pledgeWalletAccounts = table("pledge_wallet_accounts", {
  id: t
    .text()
    .primaryKey()
    .$default(() => `pwlt_${generateUniqueString(16)}`),
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
  pledgeWalletId: t
    .text()
    .references(() => pledgeWalletAccounts.id, {
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
