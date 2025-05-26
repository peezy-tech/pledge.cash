import {
  sqliteTable as table,
  type AnySQLiteColumn,
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
    solana_account: t.text().unique(),
    evm_address: t.text().unique(),
    selected_avatar_id: t.text().references(() => avatars.id),
  },
);

export const avatars = table("avatars", {
  id: t.text().primaryKey(),
  url: t.text(),
});

export const worlds = table("worlds", {
  id: t.text().primaryKey(),
  name: t.text(),
  description: t.text(),
  url: t.text(),
  created_at: t.integer().default(Date.now()),
});

export const pools = table("pools", {
  id: t.text().primaryKey().$default(() => `pool_${generateUniqueString(16)}`),
  name: t.text().notNull(),
  symbol: t.text().notNull(),
  uri: t.text().notNull(),
  configAddress: t.text().notNull(),
  baseMintAddress: t.text().notNull().unique(),
  quoteMintAddress: t.text().notNull(),
  creatorWalletAddress: t.text().notNull(),
  userId: t.text().references(() => users.id),
  transactionSignature: t.text().unique(),
  createdAt: t.integer().default(Date.now()).notNull(),
});

export const tokens = table("tokens", {
  id: t.text().primaryKey(),
  poolId: t.text().references(() => pools.id).notNull(),
  name: t.text().notNull(),
  symbol: t.text().notNull(),
  uri: t.text().notNull(),
  type: t.text().$type<"SPL" | "Token2022">().default("SPL").notNull(),
  createdAt: t.integer().default(Date.now()).notNull(),
});

export const configs = table("configs", {
  id: t.text().primaryKey(),
  feeClaimer: t.text().notNull(),
  leftoverReceiver: t.text().notNull(),
  quoteMint: t.text().notNull(),
  poolFees: t.text().$type<Record<string, any>>().notNull(),
  activationType: t.text().notNull(),
  collectFeeMode: t.text().notNull(),
  migrationOption: t.text().notNull(),
  tokenType: t.text().notNull(),
  tokenDecimal: t.text().notNull(),
  migrationQuoteThreshold: t.text().notNull(),
  partnerLpPercentage: t.integer().notNull(),
  creatorLpPercentage: t.integer().notNull(),
  partnerLockedLpPercentage: t.integer().notNull(),
  creatorLockedLpPercentage: t.integer().notNull(),
  sqrtStartPrice: t.text().notNull(),
  lockedVesting: t.text().$type<Record<string, any>>().notNull(),
  migrationFeeOption: t.text().notNull(),
  tokenSupply: t.text().$type<Record<string, any>>().notNull(),
  creatorTradingFeePercentage: t.integer().notNull(),
  curve: t.text().$type<Array<Record<string, any>>>().notNull(),
  creatorWalletAddress: t.text().notNull(),
  userId: t.text().references(() => users.id),
  transactionSignature: t.text().unique(),
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
