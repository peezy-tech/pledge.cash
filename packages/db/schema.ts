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

export const coins = table("coins", {
  id: t.text().primaryKey(),
  name: t.text(),
  description: t.text(),
  url: t.text(),
  created_at: t.integer().default(Date.now()),
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
