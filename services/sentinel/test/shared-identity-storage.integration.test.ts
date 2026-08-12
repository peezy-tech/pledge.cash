import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import postgres, { type Sql } from "postgres";

import { discardOAuthTokensForSharedIdentity } from "../src/api/peezy-identity";
import { createDrizzleApiStore } from "../src/api/store";
import { loadConfig } from "../src/config";
import { createDbClient, type SentinelDbClient } from "../src/db/client";
import { authAccounts, users, wallets } from "../src/db/schema";

const adminDatabaseUrl = process.env.SENTINEL_AUTH_TEST_DATABASE_URL;
const describeWithDatabase = adminDatabaseUrl ? describe : describe.skip;

describeWithDatabase("shared Identity Postgres storage", () => {
  let adminSql: Sql;
  let appSql: Sql;
  let dbClient: SentinelDbClient;
  let databaseName: string;

  beforeAll(async () => {
    if (!adminDatabaseUrl) return;

    databaseName = `sentinel_identity_${randomBytes(6).toString("hex")}`;
    const adminUrl = new URL(adminDatabaseUrl);
    const databaseUrl = new URL(adminDatabaseUrl);
    databaseUrl.pathname = `/${databaseName}`;
    adminSql = postgres(adminUrl.toString(), { max: 1 });
    await adminSql.unsafe(`CREATE DATABASE ${databaseName}`);
    appSql = postgres(databaseUrl.toString(), { max: 1 });
    dbClient = createDbClient(
      loadConfig({
        BETTER_AUTH_SECRET: "sentinel-auth-integration-secret-0000000000000000",
        BETTER_AUTH_URL: "http://127.0.0.1:8787",
        DATABASE_URL: databaseUrl.toString(),
        PEEZY_IDENTITY_APP_CLIENT_SECRET: "app-secret-at-least-32-characters",
        PEEZY_IDENTITY_CLIENT_ID: "pledge-cash-test",
        PEEZY_IDENTITY_OIDC_CLIENT_SECRET: "oidc-secret-at-least-32-characters",
        PEEZY_IDENTITY_URL: "http://127.0.0.1:8790",
        SENTINEL_WEB_ORIGIN: "https://pledge.cash"
      })
    );
    await dbClient.migrate();
  });

  afterAll(async () => {
    if (!adminDatabaseUrl) return;
    await dbClient.close();
    await appSql.end({ timeout: 5 });
    await adminSql.unsafe(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await adminSql.end({ timeout: 5 });
  });

  test("discards legacy OAuth tokens without changing product account metadata", async () => {
    const [user] = await dbClient.db
      .insert(users)
      .values({
        email: `legacy-oauth-${randomBytes(8).toString("hex")}@pledge.cash.invalid`,
        emailVerified: false,
        name: "Legacy OAuth account"
      })
      .returning({ id: users.id });
    expect(user).toBeDefined();

    const [account] = await dbClient.db
      .insert(authAccounts)
      .values({
        accessToken: "encrypted-access-token",
        accountId: `legacy-${randomBytes(8).toString("hex")}`,
        idToken: "legacy-id-token",
        password: "preserved-password",
        providerId: "github",
        refreshToken: "encrypted-refresh-token",
        scope: "read:user",
        userId: user!.id
      })
      .returning({ id: authAccounts.id });

    await discardOAuthTokensForSharedIdentity(dbClient.db);

    const [stored] = await dbClient.db
      .select({
        accessToken: authAccounts.accessToken,
        idToken: authAccounts.idToken,
        password: authAccounts.password,
        refreshToken: authAccounts.refreshToken,
        scope: authAccounts.scope
      })
      .from(authAccounts)
      .where(eq(authAccounts.id, account!.id));
    expect(stored).toEqual({
      accessToken: null,
      idToken: null,
      password: "preserved-password",
      refreshToken: null,
      scope: "read:user"
    });
  });

  test("shares Identity quotas across store instances", async () => {
    const firstStore = createDrizzleApiStore(dbClient.db);
    const secondStore = createDrizzleApiStore(dbClient.db);
    const input = {
      capacity: 2,
      now: new Date(),
      scope: `integration:${randomBytes(8).toString("hex")}`,
      windowMs: 5 * 60_000
    };

    const results = await Promise.all([
      firstStore.takeIdentityQuota(input),
      secondStore.takeIdentityQuota(input),
      firstStore.takeIdentityQuota(input)
    ]);
    expect(results.filter(Boolean)).toHaveLength(2);
  });

  test("keeps normalized wallet ownership bound to one product principal", async () => {
    const inserted = await dbClient.db
      .insert(users)
      .values([
        { email: `owner-a-${randomBytes(4).toString("hex")}@example.test`, name: "Owner A" },
        { email: `owner-b-${randomBytes(4).toString("hex")}@example.test`, name: "Owner B" }
      ])
      .returning({ id: users.id });
    const [ownerA, ownerB] = inserted;
    expect(ownerA).toBeDefined();
    expect(ownerB).toBeDefined();

    const address = "0x1111111111111111111111111111111111111111";
    await dbClient.db.insert(wallets).values({ address, chainId: 1, userId: ownerA!.id });
    await expect(
      dbClient.db.insert(wallets).values({
        address: address.toUpperCase(),
        chainId: 8453,
        userId: ownerB!.id
      }).execute()
    ).rejects.toThrow();
  });

  test("refuses to drop nonempty standalone nonce storage", async () => {
    await appSql.unsafe(`
      CREATE TABLE wallet_link_nonces (
        nonce text PRIMARY KEY,
        user_id uuid NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO wallet_link_nonces (nonce, user_id, expires_at)
      VALUES ('still-live', '00000000-0000-4000-8000-000000000001', now() + interval '5 minutes');
    `);
    const migration = await readFile(
      new URL("../drizzle/0015_boring_mysterio.sql", import.meta.url),
      "utf8"
    );
    const executable = migration.replaceAll("--> statement-breakpoint", "");

    let migrationError: unknown;
    try {
      await appSql.unsafe(executable);
    } catch (error) {
      migrationError = error;
    }
    expect(migrationError).toBeInstanceOf(Error);
    expect((migrationError as Error).message).toContain(
      "Refusing to remove standalone wallet-link nonce storage because it contains data"
    );
    expect((await appSql`SELECT count(*)::int AS count FROM wallet_link_nonces`)[0]?.count).toBe(1);

    await appSql`DELETE FROM wallet_link_nonces`;
    await appSql.unsafe(executable);
    expect((await appSql`SELECT to_regclass('wallet_link_nonces') AS name`)[0]?.name).toBeNull();
  }, 15_000);
});
