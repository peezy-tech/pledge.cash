import { fileURLToPath } from "node:url";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate as runMigrations } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";

import type { Config } from "../config";
import * as schema from "./schema";

const defaultMigrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export type SentinelDb = PostgresJsDatabase<typeof schema>;

export type SentinelDbClient = {
  readonly db: SentinelDb;
  readonly sql: Sql;
  close(): Promise<void>;
  migrate(migrationsFolder?: string): Promise<void>;
};

export type CreateDbClientOptions = {
  readonly maxConnections?: number;
};

export function createDbClient(
  configOrDatabaseUrl: Pick<Config, "databaseUrl"> | string,
  options: CreateDbClientOptions = {}
): SentinelDbClient {
  const databaseUrl =
    typeof configOrDatabaseUrl === "string" ? configOrDatabaseUrl : configOrDatabaseUrl.databaseUrl;
  const sql = postgres(databaseUrl, { max: options.maxConnections ?? 10 });
  const db = drizzle(sql, { schema });

  return {
    db,
    sql,
    async close() {
      await sql.end({ timeout: 5 });
    },
    async migrate(migrationsFolder = defaultMigrationsFolder) {
      await runMigrations(db, { migrationsFolder });
    }
  };
}
