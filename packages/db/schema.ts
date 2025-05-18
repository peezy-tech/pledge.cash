import {
  sqliteTable as table,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import * as t from "drizzle-orm/sqlite-core";

export const users = table(
  "users",
  {
    id: t.text().$default(() => `user_${generateUniqueString(16)}`).notNull().primaryKey(),
    name: t.text(),
    role: t.text().$type<"user" | "admin">().default("user"),
    oauthProvider: t.text(),
    oauthId: t.text(),
    oauthAccessToken: t.text(),
    oauthRefreshToken: t.text(),
    oauthExpiresAt: t.int(),
    oauthScope: t.text(),
    oauthTokenType: t.text(),
    oauthIdToken: t.text(),
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
