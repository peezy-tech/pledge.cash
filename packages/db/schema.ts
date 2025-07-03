import {
  sqliteTable as table,
} from "drizzle-orm/sqlite-core";
import * as t from "drizzle-orm/sqlite-core";

export const users = table(
  "users",
  {
    id: t
      .text()
      .$default(() => `user_${generateUniqueString(16)}`)
      .notNull()
      .primaryKey(),
    name: t.text(),
    role: t.text().$type<"user" | "admin">().default("user"),
    evm_address: t.text().unique(),
  },
);

export const hyperliquidInvoices = table("hyperliquid_invoices", {
  id: t.text().primaryKey().$default(() => `hlinv_${generateUniqueString(16)}`),
  
  // The user who created the invoice
  creatorId: t.text().references(() => users.id).notNull(), 
  
  // The EVM address of the user who is expected to pay the invoice
  payerAddress: t.text().notNull(),

  // The string identifier for the Hyperliquid spot asset (e.g., "USDC:0x...")
  token: t.text().notNull(), 

  // The amount to be paid, stored as a human-readable string (e.g., "1.5"). The Hyperliquid SDK is expected
  // to handle decimal conversion for sending, but the backend will need to handle it for verification.
  amount: t.text().notNull(),
  description: t.text(),
  
  status: t.text().$type<"pending" | "paid" | "expired">().default("pending").notNull(),
  
  txHash: t.text().unique(), // The Hyperliquid transaction hash, unique
  
  createdAt: t.integer().default(Date.now()).notNull(),
  paidAt: t.integer(),
  expiresAt: t.integer(), // Optional: for future implementation
});

export const multisigAccounts = table("multisig_accounts", {
  id: t.text().primaryKey().$default(() => `msig_${generateUniqueString(16)}`),
  userAddress: t.text().notNull().unique(),
  operatorAddress: t.text().notNull().unique(),
  operatorPrivateKey: t.text().notNull().unique(),
  address: t.text().notNull(),
  createdAt: t.integer().default(Date.now()).notNull(),
});

export const agentWallets = table("agent_wallets", {
  id: t.text().primaryKey().$default(() => `ag_${generateUniqueString(16)}`),
  multisigId: t.text().notNull().references(() => multisigAccounts.id).notNull(),
  userId: t.text().notNull().references(() => users.id).notNull(),
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
