import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as orm from "drizzle-orm";
import path from "path";
import { migrate as runLibsqlMigrations } from "drizzle-orm/libsql/migrator";

const DB_PATH = `${
  process.env.DB_PATH
    ? path.resolve(import.meta.dir, process.env.DB_PATH)
    : import.meta.dir
}/${process.env.DB_NAME ?? "sqlite.db"}`;

const client = createClient({
  url: `file:${DB_PATH}`,
});

const db = drizzle(client);

async function migrate() {
  await runLibsqlMigrations(db, {
    migrationsFolder: `${import.meta.dir}/drizzle`,
  });
  console.log("Migrations ran successfully.");
}

export { db, orm, migrate };
