import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as orm from "drizzle-orm";
import path from "path";

const DB_PATH = `${
  process.env.DB_PATH
    ? path.resolve(import.meta.dir, process.env.DB_PATH)
    : import.meta.dir
}/${process.env.DB_NAME ?? "sqlite.db"}`;

const client = createClient({
  url: `file:sqlite.db`,
});

const db = drizzle(client);

export { db, orm };
