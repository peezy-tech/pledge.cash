import { randomBytes } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, count, eq, sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { createSiweMessage } from "viem/siwe";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import {
  ALERTS_SIWE_STATEMENT,
  createBetterAuthAdapter,
  createPledgeCashSiweVerifier,
  WALLET_LINK_SIWE_STATEMENT
} from "../src/api/better-auth";
import { createApp } from "../src/api/server";
import { createDrizzleApiStore } from "../src/api/store";
import { loadConfig, type Config } from "../src/config";
import { createDbClient, type SentinelDbClient } from "../src/db/client";
import {
  authAccounts,
  authSessions,
  authWallets,
  users,
  walletOwners,
  wallets
} from "../src/db/schema";

const adminDatabaseUrl = process.env.SENTINEL_AUTH_TEST_DATABASE_URL;
const describeWithDatabase = adminDatabaseUrl ? describe : describe.skip;
const webOrigin = "https://pledge.cash";
const apiOrigin = "http://127.0.0.1:8787";
const account = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
);
const secondaryAccount = privateKeyToAccount(
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
);
const migrationsDirectory = fileURLToPath(new URL("../drizzle", import.meta.url));

describeWithDatabase("Better Auth Postgres integration", () => {
  let adminSql: Sql;
  let app: ReturnType<typeof createApp>;
  let config: Config;
  let dbClient: SentinelDbClient;
  let databaseName: string;

  beforeAll(async () => {
    if (!adminDatabaseUrl) return;

    databaseName = `sentinel_auth_${randomBytes(6).toString("hex")}`;
    const adminUrl = new URL(adminDatabaseUrl);
    const databaseUrl = new URL(adminDatabaseUrl);
    databaseUrl.pathname = `/${databaseName}`;
    adminSql = postgres(adminUrl.toString(), { max: 1 });
    await adminSql.unsafe(`CREATE DATABASE ${databaseName}`);

    config = loadConfig({
      BETTER_AUTH_SECRET: "sentinel-auth-integration-secret-0000000000000000",
      BETTER_AUTH_URL: apiOrigin,
      DATABASE_URL: databaseUrl.toString(),
      SENTINEL_CHAIN_IDS: "31337",
      SENTINEL_HARNESS: "none",
      SENTINEL_RPC_URL_31337: "http://127.0.0.1:8545",
      SENTINEL_WEB_ORIGIN: webOrigin,
      SENTINEL_TWITTER_ENABLED: "0"
    });
    dbClient = createDbClient(config);
    await dbClient.migrate();
    app = createApp({
      auth: createBetterAuthAdapter(config, dbClient.db),
      config,
      store: createDrizzleApiStore(dbClient.db),
      verifySiweSignature: createPledgeCashSiweVerifier(config, [WALLET_LINK_SIWE_STATEMENT])
    });
  });

  afterAll(async () => {
    if (!adminDatabaseUrl) return;
    await dbClient.close();
    await adminSql.unsafe(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await adminSql.end({ timeout: 5 });
  });

  test("creates one wallet principal across chains and revokes its session", async () => {
    const first = await signInWithWallet(app, 8453);
    const me = await app.request(`${apiOrigin}/auth/me`, {
      headers: { Cookie: first.cookie, Origin: webOrigin }
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      providers: ["siwe"],
      user: { id: first.userId },
      wallets: [
        {
          address: account.address.toLowerCase(),
          alertsEnabled: true,
          canSignIn: true
        }
      ]
    });

    const second = await signInWithWallet(app, 1);
    expect(second.userId).toBe(first.userId);

    const [userCount, authWalletCount, walletCount, ownerCount, accountCount, sessionCount] = await Promise.all([
      tableCount(dbClient, users),
      tableCount(dbClient, authWallets),
      tableCount(dbClient, wallets),
      tableCount(dbClient, walletOwners),
      tableCount(dbClient, authAccounts),
      tableCount(dbClient, authSessions)
    ]);
    expect({ accountCount, authWalletCount, ownerCount, sessionCount, userCount, walletCount }).toEqual({
      accountCount: 2,
      authWalletCount: 2,
      ownerCount: 1,
      sessionCount: 2,
      userCount: 1,
      walletCount: 2
    });

    const organization = await app.request(`${apiOrigin}/auth/organization/create`, {
      body: JSON.stringify({ name: "Not yet", slug: "not-yet" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: first.cookie,
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(organization.status).toBe(403);

    const logout = await app.request(`${apiOrigin}/auth/sign-out`, {
      headers: { Cookie: first.cookie, Origin: webOrigin },
      method: "POST"
    });
    expect(logout.status).toBe(200);
    expect(await logout.json()).toEqual({ success: true });

    const afterLogout = await app.request(`${apiOrigin}/auth/me`, {
      headers: { Cookie: first.cookie, Origin: webOrigin }
    });
    expect(afterLogout.status).toBe(200);
    expect(await afterLogout.json()).toBeNull();
  });

  test("shares Identity client quotas across store instances", async () => {
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
    expect(results.filter((result) => !result)).toHaveLength(1);
  });

  test("rejects a SIWE message with an untrusted URI", async () => {
    const nonce = await authNonce(app, 10);
    const issuedAt = new Date();
    const message = createSiweMessage({
      address: account.address,
      chainId: 10,
      domain: "pledge.cash",
      expirationTime: new Date(issuedAt.getTime() + 10 * 60 * 1_000),
      issuedAt,
      nonce,
      statement: ALERTS_SIWE_STATEMENT,
      uri: "https://attacker.invalid/notifications",
      version: "1"
    });
    const signature = await account.signMessage({ message });

    const response = await app.request(`${apiOrigin}/auth/siwe/verify`, {
      body: JSON.stringify({
        chainId: 10,
        message,
        signature,
        walletAddress: account.address
      }),
      headers: { "Content-Type": "application/json", Origin: webOrigin },
      method: "POST"
    });
    expect(response.status).toBe(401);
  });

  test("consumes each SIWE nonce exactly once", async () => {
    const request = await walletSignInRequest(app, 10, account);
    const sessionsBefore = await tableCount(dbClient, authSessions);

    const first = await app.request(request.input, request.init);
    expect(first.status).toBe(200);
    const sessionsAfterFirst = await tableCount(dbClient, authSessions);
    expect(sessionsAfterFirst).toBe(sessionsBefore + 1);

    const replay = await app.request(request.input, request.init);
    expect(replay.status).toBe(401);
    expect(await tableCount(dbClient, authSessions)).toBe(sessionsAfterFirst);
  });

  test("makes every linked wallet an equal sign-in credential while preserving alert coverage", async () => {
    const primary = await signInWithWallet(app, 8453);
    const before = await authStorageCounts(dbClient);

    const link = await linkAlertWallet(app, primary.cookie, secondaryAccount, 10);
    expect(link.status).toBe(200);
    expect(await link.json()).toMatchObject({
      wallet: {
        address: secondaryAccount.address.toLowerCase(),
        alertsEnabled: true,
        canSignIn: true
      }
    });

    const afterLink = await authStorageCounts(dbClient);
    expect(afterLink).toEqual({ ...before, wallets: before.wallets + 1 });
    const [linkedCoverage] = await secondaryCoverageRows(dbClient, primary.userId);
    expect(linkedCoverage).toEqual({ alertsEnabled: true });

    const secondarySignIn = await signInWithWallet(app, 10, secondaryAccount);
    expect(secondarySignIn.userId).toBe(primary.userId);

    const stopWatching = await app.request(`${apiOrigin}/wallets/${secondaryAccount.address}`, {
      body: JSON.stringify({ alertsEnabled: false }),
      headers: { "Content-Type": "application/json", Cookie: primary.cookie, Origin: webOrigin },
      method: "PATCH"
    });
    expect(stopWatching.status).toBe(200);
    expect(await stopWatching.json()).toMatchObject({
      wallet: { alertsEnabled: false, canSignIn: true }
    });
    expect(await secondaryCoverageRows(dbClient, primary.userId)).toEqual([
      { alertsEnabled: false }
    ]);

    const secondarySignInAfterStoppingAlerts = await signInWithWallet(app, 10, secondaryAccount);
    expect(secondarySignInAfterStoppingAlerts.userId).toBe(primary.userId);

    const secondarySignInOnAnotherChain = await signInWithWallet(app, 1, secondaryAccount);
    expect(secondarySignInOnAnotherChain.userId).toBe(primary.userId);
    expect(await secondaryCoverageRows(dbClient, primary.userId)).toEqual([
      { alertsEnabled: false },
      { alertsEnabled: false }
    ]);
  });

  test("prevents the same normalized address from crossing principal ownership", async () => {
    const [otherUser] = await dbClient.db
      .insert(users)
      .values({
        email: "other@wallet.pledge.cash.invalid",
        emailVerified: false,
        name: "Other wallet account"
      })
      .returning({ id: users.id });
    expect(otherUser).toBeDefined();

    await expect(
      dbClient.db
        .insert(wallets)
        .values({
          address: account.address.toLowerCase(),
          chainId: 42161,
          userId: otherUser?.id ?? "00000000-0000-0000-0000-000000000000"
        })
        .execute()
    ).rejects.toThrow();

    const crossOwned = await dbClient.db
      .select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.userId, otherUser?.id ?? "00000000-0000-0000-0000-000000000000"));
    expect(crossOwned).toHaveLength(0);
  });

  test("backfills legacy alert wallets into sign-in credentials without reenabling coverage", async () => {
    if (!adminDatabaseUrl) return;

    const legacyDatabaseName = `sentinel_wallet_migration_${randomBytes(6).toString("hex")}`;
    const legacyDatabaseUrl = new URL(adminDatabaseUrl);
    legacyDatabaseUrl.pathname = `/${legacyDatabaseName}`;
    const legacyMigrationsDirectory = await createLegacyMigrationsDirectory();
    let legacyClient: SentinelDbClient | undefined;

    try {
      await adminSql.unsafe(`CREATE DATABASE ${legacyDatabaseName}`);
      legacyClient = createDbClient(legacyDatabaseUrl.toString());
      await legacyClient.migrate(legacyMigrationsDirectory);

      const [legacyUser] = await legacyClient.db
        .insert(users)
        .values({
          email: "legacy@wallet.pledge.cash.invalid",
          emailVerified: false,
          name: "Legacy wallet account"
        })
        .returning({ id: users.id });
      expect(legacyUser).toBeDefined();
      const userId = legacyUser?.id ?? "00000000-0000-0000-0000-000000000000";

      await legacyClient.db.insert(authWallets).values({
        address: account.address,
        chainId: 8453,
        isPrimary: true,
        userId
      });
      await legacyClient.db.insert(authAccounts).values({
        accountId: `${account.address}:8453`,
        providerId: "siwe",
        userId
      });
      await legacyClient.db.insert(wallets).values({
        address: secondaryAccount.address.toLowerCase(),
        alertsEnabled: false,
        chainId: 10,
        siweMessage: "legacy alert coverage",
        userId
      });

      await legacyClient.migrate();

      const [credential] = await legacyClient.db
        .select({
          address: authWallets.address,
          isPrimary: authWallets.isPrimary,
          userId: authWallets.userId
        })
        .from(authWallets)
        .where(
          and(
            eq(authWallets.chainId, 10),
            sql`lower(${authWallets.address}) = lower(${secondaryAccount.address})`
          )
        )
        .limit(1);
      expect(credential).toEqual({
        address: secondaryAccount.address.toLowerCase(),
        isPrimary: false,
        userId
      });

      const [coverage] = await legacyClient.db
        .select({ alertsEnabled: wallets.alertsEnabled })
        .from(wallets)
        .where(
          and(
            eq(wallets.chainId, 10),
            sql`lower(${wallets.address}) = lower(${secondaryAccount.address})`
          )
        )
        .limit(1);
      expect(coverage).toEqual({ alertsEnabled: false });
      expect(await tableCount(legacyClient, authAccounts)).toBe(1);

      const legacyConfig = loadConfig({
        BETTER_AUTH_SECRET: "sentinel-auth-integration-secret-0000000000000000",
        BETTER_AUTH_URL: apiOrigin,
        DATABASE_URL: legacyDatabaseUrl.toString(),
        SENTINEL_CHAIN_IDS: "31337",
        SENTINEL_HARNESS: "none",
        SENTINEL_RPC_URL_31337: "http://127.0.0.1:8545",
        SENTINEL_WEB_ORIGIN: webOrigin,
        SENTINEL_TWITTER_ENABLED: "0"
      });
      const legacyApp = createApp({
        auth: createBetterAuthAdapter(legacyConfig, legacyClient.db),
        config: legacyConfig,
        store: createDrizzleApiStore(legacyClient.db),
        verifySiweSignature: createPledgeCashSiweVerifier(legacyConfig, [WALLET_LINK_SIWE_STATEMENT])
      });
      const migratedSignIn = await signInWithWallet(legacyApp, 10, secondaryAccount);
      expect(migratedSignIn.userId).toBe(userId);
    } finally {
      await legacyClient?.close();
      await adminSql.unsafe(`DROP DATABASE IF EXISTS ${legacyDatabaseName} WITH (FORCE)`);
      await rm(legacyMigrationsDirectory, { force: true, recursive: true });
    }
  });
});

async function createLegacyMigrationsDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sentinel-wallet-migrations-"));
  const metaDirectory = join(directory, "meta");
  await mkdir(metaDirectory);

  const journal = JSON.parse(
    await readFile(join(migrationsDirectory, "meta", "_journal.json"), "utf8")
  ) as {
    dialect: string;
    entries: Array<{ idx: number; tag: string; version: string; when: number; breakpoints: boolean }>;
    version: string;
  };
  const entries = journal.entries.filter((entry) => entry.idx <= 5);
  await writeFile(
    join(metaDirectory, "_journal.json"),
    `${JSON.stringify({ ...journal, entries }, null, 2)}\n`
  );
  await Promise.all(
    entries.map((entry) =>
      copyFile(
        join(migrationsDirectory, `${entry.tag}.sql`),
        join(directory, `${entry.tag}.sql`)
      )
    )
  );

  return directory;
}

async function signInWithWallet(
  app: ReturnType<typeof createApp>,
  chainId: number,
  signer: PrivateKeyAccount = account
): Promise<{ readonly cookie: string; readonly userId: string }> {
  const response = await walletSignInResponse(app, chainId, signer);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { readonly user: { readonly id: string } };
  return { cookie: sessionCookie(response), userId: body.user.id };
}

async function walletSignInResponse(
  app: ReturnType<typeof createApp>,
  chainId: number,
  signer: PrivateKeyAccount
): Promise<Response> {
  const request = await walletSignInRequest(app, chainId, signer);
  return app.request(request.input, request.init);
}

async function walletSignInRequest(
  app: ReturnType<typeof createApp>,
  chainId: number,
  signer: PrivateKeyAccount
): Promise<{ readonly init: RequestInit; readonly input: string }> {
  const nonce = await authNonce(app, chainId, signer.address);
  const issuedAt = new Date();
  const message = createSiweMessage({
    address: signer.address,
    chainId,
    domain: "pledge.cash",
    expirationTime: new Date(issuedAt.getTime() + 10 * 60 * 1_000),
    issuedAt,
    nonce,
    statement: ALERTS_SIWE_STATEMENT,
    uri: `${webOrigin}/notifications`,
    version: "1"
  });
  const signature = await signer.signMessage({ message });
  return {
    init: {
      body: JSON.stringify({ chainId, message, signature, walletAddress: signer.address }),
      headers: { "Content-Type": "application/json", Origin: webOrigin },
      method: "POST"
    },
    input: `${apiOrigin}/auth/siwe/verify`
  };
}

async function authNonce(
  app: ReturnType<typeof createApp>,
  chainId: number,
  walletAddress = account.address
): Promise<string> {
  const response = await app.request(`${apiOrigin}/auth/siwe/nonce`, {
    body: JSON.stringify({ chainId, walletAddress }),
    headers: { "Content-Type": "application/json", Origin: webOrigin },
    method: "POST"
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { readonly nonce: string };
  return body.nonce;
}

async function linkAlertWallet(
  app: ReturnType<typeof createApp>,
  cookie: string,
  signer: PrivateKeyAccount,
  chainId: number
): Promise<Response> {
  const nonceResponse = await app.request(`${apiOrigin}/wallets/nonce`, {
    body: JSON.stringify({ address: signer.address, chainId }),
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: webOrigin },
    method: "POST"
  });
  expect(nonceResponse.status).toBe(200);
  const nonce = (await nonceResponse.json()) as {
    readonly domain: string;
    readonly expirationTime: string;
    readonly issuedAt: string;
    readonly nonce: string;
    readonly statement: string;
    readonly uri: string;
  };
  const message = createSiweMessage({
    address: signer.address,
    chainId,
    domain: nonce.domain,
    expirationTime: new Date(nonce.expirationTime),
    issuedAt: new Date(nonce.issuedAt),
    nonce: nonce.nonce,
    statement: nonce.statement,
    uri: nonce.uri,
    version: "1"
  });
  const signature = await signer.signMessage({ message });
  return app.request(`${apiOrigin}/wallets`, {
    body: JSON.stringify({ message, signature }),
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: webOrigin },
    method: "POST"
  });
}

async function authStorageCounts(
  dbClient: SentinelDbClient
): Promise<{
  readonly accounts: number;
  readonly sessions: number;
  readonly users: number;
  readonly wallets: number;
}> {
  const [accounts, sessions, userCount, authWalletCount] = await Promise.all([
    tableCount(dbClient, authAccounts),
    tableCount(dbClient, authSessions),
    tableCount(dbClient, users),
    tableCount(dbClient, authWallets)
  ]);
  return { accounts, sessions, users: userCount, wallets: authWalletCount };
}

async function secondaryCoverageRows(
  dbClient: SentinelDbClient,
  userId: string
): Promise<Array<{ readonly alertsEnabled: boolean }>> {
  return dbClient.db
    .select({ alertsEnabled: wallets.alertsEnabled })
    .from(wallets)
    .where(
      and(
        eq(wallets.userId, userId),
        sql`lower(${wallets.address}) = lower(${secondaryAccount.address})`
      )
    );
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/((?:__Secure-)?pledge-cash\.session_token=[^;,]+)/);
  expect(match?.[1]).toBeDefined();
  return match?.[1] ?? "";
}

async function tableCount(
  dbClient: SentinelDbClient,
  table:
    | typeof users
    | typeof authWallets
    | typeof wallets
    | typeof walletOwners
    | typeof authAccounts
    | typeof authSessions
): Promise<number> {
  const [row] = await dbClient.db.select({ value: count() }).from(table);
  return row?.value ?? 0;
}
