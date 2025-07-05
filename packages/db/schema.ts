import { sqliteTable as table } from "drizzle-orm/sqlite-core";
import * as t from "drizzle-orm/sqlite-core";

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
    .notNull()
    .references(() => multisigAccounts.id)
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
