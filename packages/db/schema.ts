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

// Recurring payments
export const recurringPlans = table("recurring_plans", {
  id: t
    .text()
    .primaryKey()
    .$default(() => `rcplan_${generateUniqueString(16)}`),
  creatorId: t.text().references(() => users.id).notNull(),
  payerUserId: t.text().references(() => users.id),
  payerAddress: t.text(),
  token: t.text().notNull(),
  amount: t.text().notNull(),
  cadence: t.text().$type<"daily" | "weekly" | "monthly">().notNull(),
  startAt: t.integer().default(Date.now()).notNull(),
  endAt: t.integer(),
  autopayEnabled: t.integer().$type<boolean>().default(true).notNull(),
  nextRunAt: t.integer().notNull(),
  status: t
    .text()
    .$type<"active" | "paused" | "cancelled">()
    .default("active")
    .notNull(),
  createdAt: t.integer().default(Date.now()).notNull(),
});

export const recurringCharges = table("recurring_charges", {
  id: t
    .text()
    .primaryKey()
    .$default(() => `rcchg_${generateUniqueString(16)}`),
  planId: t.text().references(() => recurringPlans.id).notNull(),
  token: t.text().notNull(),
  amount: t.text().notNull(),
  dueAt: t.integer().notNull(),
  runAt: t.integer(),
  status: t
    .text()
    .$type<"pending" | "paid" | "failed" | "skipped">()
    .default("pending")
    .notNull(),
  txHash: t.text().references(() => txHashes.hash),
  error: t.text(),
  createdAt: t.integer().default(Date.now()).notNull(),
});

// Pledge campaigns and pledges
export const pledgeCampaigns = table("pledge_campaigns", {
  id: t
    .text()
    .primaryKey()
    .$default(() => `plcmp_${generateUniqueString(16)}`),
  creatorId: t.text().references(() => users.id).notNull(),
  name: t.text().notNull(),
  description: t.text(),
  goalToken: t.text().notNull(),
  goalAmount: t.text().notNull(),
  raisedAmount: t.text().default("0").notNull(),
  status: t
    .text()
    .$type<"active" | "paused" | "completed">()
    .default("active")
    .notNull(),
  createdAt: t.integer().default(Date.now()).notNull(),
});

export const pledges = table("pledges", {
  id: t
    .text()
    .primaryKey()
    .$default(() => `pldg_${generateUniqueString(16)}`),
  campaignId: t.text().references(() => pledgeCampaigns.id).notNull(),
  pledgerUserId: t.text().references(() => users.id),
  pledgerAddress: t.text(),
  token: t.text().notNull(),
  amountPerCadence: t.text().notNull(),
  cadence: t.text().$type<"daily" | "weekly" | "monthly">().notNull(),
  autopayEnabled: t.integer().$type<boolean>().default(true).notNull(),
  nextRunAt: t.integer().notNull(),
  status: t
    .text()
    .$type<"active" | "paused" | "cancelled">()
    .default("active")
    .notNull(),
  createdAt: t.integer().default(Date.now()).notNull(),
});

export const pledgeContributions = table("pledge_contributions", {
  id: t
    .text()
    .primaryKey()
    .$default(() => `plcon_${generateUniqueString(16)}`),
  pledgeId: t.text().references(() => pledges.id),
  campaignId: t.text().references(() => pledgeCampaigns.id).notNull(),
  payerUserId: t.text().references(() => users.id),
  fromAddress: t.text(),
  token: t.text().notNull(),
  amount: t.text().notNull(),
  txHash: t.text().references(() => txHashes.hash),
  createdAt: t.integer().default(Date.now()).notNull(),
});

// Donations
export const donations = table("donations", {
  id: t
    .text()
    .primaryKey()
    .$default(() => `dntn_${generateUniqueString(16)}`),
  creatorId: t.text().references(() => users.id).notNull(),
  payerUserId: t.text().references(() => users.id),
  fromAddress: t.text(),
  token: t.text().notNull(),
  amount: t.text().notNull(),
  txHash: t.text().references(() => txHashes.hash),
  linkedInvoiceId: t.text().references(() => hyperliquidInvoices.id),
  createdAt: t.integer().default(Date.now()).notNull(),
});

// Normalized payments table
export const payments = table("payments", {
  id: t
    .text()
    .primaryKey()
    .$default(() => `pay_${generateUniqueString(16)}`),
  type: t
    .text()
    .$type<"invoice" | "recurring" | "pledge" | "donation">()
    .notNull(),
  sourceId: t.text().notNull(),
  creatorId: t.text().references(() => users.id).notNull(),
  payerUserId: t.text().references(() => users.id),
  payerAddress: t.text(),
  token: t.text().notNull(),
  amount: t.text().notNull(),
  status: t
    .text()
    .$type<"pending" | "paid" | "failed">()
    .default("pending")
    .notNull(),
  txHash: t.text().references(() => txHashes.hash),
  createdAt: t.integer().default(Date.now()).notNull(),
  paidAt: t.integer(),
  metadata: t.text({ mode: "json" }),
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
