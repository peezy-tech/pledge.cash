import { fileURLToPath } from "node:url";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate as runMigrations } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";

import type { X402RouterConfig } from "../config";
import * as schema from "./schema";

const defaultMigrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
export const ROUTER_MIGRATIONS_SCHEMA = "x402_router_drizzle";
export const ROUTER_MIGRATIONS_TABLE = "__drizzle_migrations";

export type X402RouterDb = PostgresJsDatabase<typeof schema>;

export type X402RouterDbClient = {
  readonly coordinationSql: Sql;
  readonly db: X402RouterDb;
  readonly sql: Sql;
  close(): Promise<void>;
  migrate(migrationsFolder?: string): Promise<void>;
};

export type CreateDbClientOptions = {
  readonly maxConnections?: number;
};

export function createDbClient(
  configOrDatabaseUrl: Pick<X402RouterConfig, "databaseUrl"> | string,
  options: CreateDbClientOptions = {}
): X402RouterDbClient {
  const databaseUrl =
    typeof configOrDatabaseUrl === "string" ? configOrDatabaseUrl : configOrDatabaseUrl.databaseUrl;
  const sql = postgres(databaseUrl, {
    max: options.maxConnections ?? 10,
    onnotice: () => undefined
  });
  const coordinationSql = postgres(databaseUrl, {
    max: options.maxConnections ?? 10,
    onnotice: () => undefined
  });
  // Drizzle installs column serializers on the postgres-js client it wraps.
  // Keep that migration/query-builder connection isolated so the raw SQL
  // stores retain postgres-js's native Date and JSON parameter serializers.
  const drizzleSql = postgres(databaseUrl, {
    max: 1,
    onnotice: () => undefined
  });
  const db = drizzle(drizzleSql, { schema });

  return {
    // Runtime advisory-lock coordinators use an isolated bounded pool. Distinct
    // lock keys can proceed concurrently while each winning action remains free
    // to use the main query pool.
    coordinationSql,
    db,
    sql,
    async close() {
      await Promise.all([
        sql.end({ timeout: 5 }),
        coordinationSql.end({ timeout: 5 }),
        drizzleSql.end({ timeout: 5 })
      ]);
    },
    async migrate(migrationsFolder = defaultMigrationsFolder) {
      await runMigrations(db, {
        migrationsFolder,
        migrationsSchema: ROUTER_MIGRATIONS_SCHEMA,
        migrationsTable: ROUTER_MIGRATIONS_TABLE
      });
    }
  };
}
