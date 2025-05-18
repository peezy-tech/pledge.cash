import {
  sqliteTable as table,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import * as t from "drizzle-orm/sqlite-core";

export const users = table(
  "users",
  {
    id: t.int().primaryKey({ autoIncrement: true }),
    name: t.text().notNull(),
    referralId: t.int().references((): AnySQLiteColumn => users.id),
    role: t.text().$type<"user" | "admin">().default("user"),
    oauthProvider: t.text().notNull(),
    oauthId: t.text().notNull(),
    oauthAccessToken: t.text().notNull(),
    oauthRefreshToken: t.text().notNull(),
    oauthExpiresAt: t.int().notNull(),
    oauthScope: t.text().notNull(),
    oauthTokenType: t.text().notNull(),
    oauthIdToken: t.text().notNull(),
  },
  (table) => [t.uniqueIndex("name_idx").on(table.name)]
);

export const posts = table(
  "posts",
  {
    id: t.int().primaryKey({ autoIncrement: true }),
    slug: t.text().$default(() => generateUniqueString(16)),
    title: t.text(),
    ownerId: t.int("owner_id").references(() => users.id),
  },
  (table) => [
    t.uniqueIndex("slug_idx").on(table.slug),
    t.index("title_idx").on(table.title),
  ]
);

export const comments = table("comments", {
  id: t.int().primaryKey({ autoIncrement: true }),
  text: t.text({ length: 256 }),
  postId: t.int("post_id").references(() => posts.id),
  ownerId: t.int("owner_id").references(() => users.id),
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
