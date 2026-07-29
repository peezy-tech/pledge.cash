import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres, { type Sql } from "postgres";
import { privateKeyToAccount } from "viem/accounts";

import { createPeezyIdentityAuthAdapter } from "../src/api/peezy-identity";
import { createApp } from "../src/api/server";
import { createDrizzleApiStore } from "../src/api/store";
import { loadConfig, type Config } from "../src/config";
import { createDbClient, type SentinelDbClient } from "../src/db/client";

const adminDatabaseUrl = process.env.SENTINEL_AUTH_TEST_DATABASE_URL;
const identityUrl = process.env.PEEZY_IDENTITY_TEST_URL;
const identityAppSecret = process.env.PEEZY_IDENTITY_TEST_APP_CLIENT_SECRET;
const identityOidcSecret = process.env.PEEZY_IDENTITY_TEST_OIDC_CLIENT_SECRET;
const identityDatabaseUrl = process.env.PEEZY_IDENTITY_TEST_DATABASE_URL;
const describeWithIdentity =
  adminDatabaseUrl &&
  identityUrl &&
  identityAppSecret &&
  identityOidcSecret &&
  identityDatabaseUrl
    ? describe
    : describe.skip;
const webOrigin = "http://localhost:5173";
const apiOrigin = "http://localhost:8787";
const firstWallet = privateKeyToAccount(
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
);
const secondWallet = privateKeyToAccount(
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
);
const legacyWallet = privateKeyToAccount(
  "0x9876543210abcdef9876543210abcdef9876543210abcdef9876543210abcdef"
);
const conflictedWallet = privateKeyToAccount(
  "0x1111111111111111111111111111111111111111111111111111111111111111"
);
const secondLegacyWallet = privateKeyToAccount(
  "0x2222222222222222222222222222222222222222222222222222222222222222"
);
const migrationWallet = privateKeyToAccount(
  "0x3333333333333333333333333333333333333333333333333333333333333333"
);

describeWithIdentity("peezy.tech Identity compatibility integration", () => {
  let adminSql: Sql;
  let app: ReturnType<typeof createApp>;
  let config: Config;
  let dbClient: SentinelDbClient;
  let databaseName: string;
  let identitySql: Sql;

  beforeAll(async () => {
    if (
      !adminDatabaseUrl ||
      !identityUrl ||
      !identityAppSecret ||
      !identityOidcSecret ||
      !identityDatabaseUrl
    )
      return;
    databaseName = `sentinel_peezy_${randomBytes(6).toString("hex")}`;
    const databaseUrl = new URL(adminDatabaseUrl);
    databaseUrl.pathname = `/${databaseName}`;
    adminSql = postgres(adminDatabaseUrl, { max: 1 });
    identitySql = postgres(identityDatabaseUrl, { max: 1 });
    await adminSql.unsafe(`CREATE DATABASE ${databaseName}`);
    config = loadConfig({
      BETTER_AUTH_SECRET: "sentinel-peezy-integration-secret-000000000000000",
      BETTER_AUTH_URL: apiOrigin,
      DATABASE_URL: databaseUrl.toString(),
      PEEZY_IDENTITY_APP_CLIENT_SECRET: identityAppSecret,
      PEEZY_IDENTITY_CLIENT_ID: "pledge-cash",
      PEEZY_IDENTITY_OIDC_CLIENT_SECRET: identityOidcSecret,
      PEEZY_IDENTITY_URL: identityUrl,
      SENTINEL_CHAIN_IDS: "31337",
      SENTINEL_HARNESS: "none",
      SENTINEL_RPC_URL_31337: "http://127.0.0.1:8545",
      SENTINEL_TWITTER_ENABLED: "0",
      SENTINEL_WEB_ORIGIN: webOrigin
    });
    dbClient = createDbClient(config);
    await dbClient.migrate();
    app = createApp({
      auth: createPeezyIdentityAuthAdapter(config, dbClient.db),
      config,
      store: createDrizzleApiStore(dbClient.db)
    });
  });

  afterAll(async () => {
    if (!adminDatabaseUrl) return;
    await dbClient?.close();
    if (databaseName) {
      await adminSql.unsafe(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    }
    await Promise.all([
      adminSql?.end({ timeout: 5 }),
      identitySql?.end({ timeout: 5 })
    ]);
  });

  test("keeps wallet sign-in and linking behind PledgeCash routes", async () => {
    const capabilities = await app.request(`${apiOrigin}/auth/capabilities`, {
      headers: { Origin: webOrigin }
    });
    expect(capabilities.status).toBe(200);
    expect(await capabilities.json()).toEqual({ socialProviders: ["github"] });

    const nonceResponse = await app.request(`${apiOrigin}/auth/siwe/nonce`, {
      body: JSON.stringify({
        chainId: 999,
        walletAddress: firstWallet.address
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(nonceResponse.status).toBe(200);
    const challenge = (await nonceResponse.json()) as { message: string };
    const signature = await firstWallet.signMessage({
      message: challenge.message
    });
    const verifyResponse = await app.request(`${apiOrigin}/auth/siwe/verify`, {
      body: JSON.stringify({
        chainId: 999,
        message: challenge.message,
        signature,
        walletAddress: firstWallet.address
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(verifyResponse.status).toBe(200);
    const cookie = responseCookie(
      verifyResponse,
      "pledge-cash.session_token"
    );

    const meResponse = await app.request(`${apiOrigin}/auth/me`, {
      headers: { Cookie: cookie, Origin: webOrigin }
    });
    expect(meResponse.status).toBe(200);
    const me = (await meResponse.json()) as {
      providers: string[];
      user: { id: string };
      wallets: Array<{ address: string }>;
    };
    expect(me.user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(me.providers).toContain("siwe");
    expect(me.wallets).toContainEqual(
      expect.objectContaining({ address: firstWallet.address.toLowerCase() })
    );

    const socialLinkStart = await app.request(`${apiOrigin}/auth/peezy/link`, {
      body: JSON.stringify({
        callbackURL: `${webOrigin}/alerts`,
        errorCallbackURL: `${webOrigin}/alerts`,
        provider: "github"
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(socialLinkStart.status).toBe(200);
    const socialHandoff = (await socialLinkStart.json()) as { url: string };
    const [identityMapping] = await dbClient.sql<{ subject: string }[]>`
      SELECT "account_id" AS "subject"
      FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${me.user.id}::uuid
    `;
    if (identityMapping === undefined) {
      throw new Error("Expected a peezy.tech subject mapping");
    }
    await identitySql`
      INSERT INTO "account" (
        "id",
        "account_id",
        "provider_id",
        "user_id",
        "created_at",
        "updated_at"
      )
      VALUES (
        ${randomUUID()},
        ${`github-${randomUUID()}`},
        'github',
        ${identityMapping.subject},
        now(),
        now()
      )
    `;
    const socialMeResponse = await app.request(`${apiOrigin}/auth/me`, {
      headers: { Cookie: cookie, Origin: webOrigin }
    });
    expect(socialMeResponse.status).toBe(200);
    expect(await socialMeResponse.json()).toMatchObject({
      providers: expect.arrayContaining(["github", "siwe"])
    });

    const handoffResponse = await fetch(socialHandoff.url, {
      redirect: "manual"
    });
    expect(handoffResponse.status).toBe(302);
    const identityCookie = responseCookie(
      handoffResponse,
      "peezy-identity.session_token"
    );

    const oidcStart = await app.request(`${apiOrigin}/auth/peezy/sign-in`, {
      body: JSON.stringify({
        callbackURL: `${webOrigin}/alerts`,
        errorCallbackURL: `${webOrigin}/alerts`,
        provider: "github"
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(oidcStart.status).toBe(200);
    const stateCookie = responseCookie(oidcStart, "pledge-cash.state");
    const authorization = (await oidcStart.json()) as { url: string };
    const authorizationResponse = await fetch(authorization.url, {
      headers: { Cookie: identityCookie },
      redirect: "manual"
    });
    expect(authorizationResponse.status).toBe(302);
    const callbackUrl = authorizationResponse.headers.get("location");
    if (!callbackUrl) throw new Error("Expected OIDC callback redirect");
    const callbackResponse = await app.request(callbackUrl, {
      headers: { Cookie: stateCookie }
    });
    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe(
      `${webOrigin}/alerts`
    );
    expect(
      responseCookie(callbackResponse, "pledge-cash.session_token")
    ).toContain(
      "pledge-cash.session_token"
    );

    const linkNonceResponse = await app.request(`${apiOrigin}/wallets/nonce`, {
      body: JSON.stringify({
        address: secondWallet.address,
        chainId: 999
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(linkNonceResponse.status).toBe(200);
    const linkChallenge = (await linkNonceResponse.json()) as {
      message: string;
    };
    const linkSignature = await secondWallet.signMessage({
      message: linkChallenge.message
    });
    const linkResponse = await app.request(`${apiOrigin}/wallets`, {
      body: JSON.stringify({
        message: linkChallenge.message,
        signature: linkSignature
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(linkResponse.status).toBe(200);
    expect(await linkResponse.json()).toMatchObject({
      wallet: {
        address: secondWallet.address.toLowerCase(),
        canSignIn: true
      }
    });
    const [localCredential] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "auth_wallets"
      WHERE lower("address") = ${secondWallet.address.toLowerCase()}
    `;
    const [alertCoverage] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "wallets"
      WHERE lower("address") = ${secondWallet.address.toLowerCase()}
        AND "user_id" = ${me.user.id}::uuid
    `;
    expect(localCredential?.count).toBe("0");
    expect(alertCoverage?.count).toBe("1");
    const linkedMeResponse = await app.request(`${apiOrigin}/auth/me`, {
      headers: { Cookie: cookie, Origin: webOrigin }
    });
    expect(linkedMeResponse.status).toBe(200);
    expect(await linkedMeResponse.json()).toMatchObject({
      wallets: expect.arrayContaining([
        expect.objectContaining({
          address: secondWallet.address.toLowerCase(),
          canSignIn: true
        })
      ])
    });

    const otherUserId = randomUUID();
    await dbClient.sql`
      INSERT INTO "users" (
        "id", "name", "email", "email_verified", "created_at", "updated_at"
      )
      VALUES (
        ${otherUserId}::uuid,
        'Other local user',
        ${`${otherUserId}@wallet.pledge.cash.invalid`},
        false,
        now(),
        now()
      )
    `;
    await dbClient.sql`
      INSERT INTO "wallets" (
        "user_id", "address", "chain_id", "alerts_enabled", "verified_at"
      )
      VALUES (
        ${otherUserId}::uuid,
        ${conflictedWallet.address.toLowerCase()},
        999,
        true,
        now()
      )
    `;
    const conflictNonceResponse = await app.request(`${apiOrigin}/wallets/nonce`, {
      body: JSON.stringify({
        address: conflictedWallet.address,
        chainId: 999
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(conflictNonceResponse.status).toBe(200);
    const conflictChallenge = (await conflictNonceResponse.json()) as {
      message: string;
    };
    const conflictSignature = await conflictedWallet.signMessage({
      message: conflictChallenge.message
    });
    const conflictResponse = await app.request(`${apiOrigin}/wallets`, {
      body: JSON.stringify({
        message: conflictChallenge.message,
        signature: conflictSignature
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(conflictResponse.status).toBe(409);
    const [centralConflict] = await identitySql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "wallet_principal"
      WHERE lower("address") = ${conflictedWallet.address.toLowerCase()}
    `;
    expect(centralConflict?.count).toBe("0");

    await identitySql`
      UPDATE "wallet_principal"
      SET "sign_in_enabled" = false
      WHERE lower("address") IN (
        ${firstWallet.address.toLowerCase()},
        ${secondWallet.address.toLowerCase()}
      )
    `;
    const uncachedApp = createApp({
      auth: createPeezyIdentityAuthAdapter(config, dbClient.db, fetch, {
        hydrationCacheMs: 0
      }),
      config,
      store: createDrizzleApiStore(dbClient.db)
    });
    const disabledResponse = await uncachedApp.request(`${apiOrigin}/auth/me`, {
      headers: { Cookie: cookie, Origin: webOrigin }
    });
    expect(disabledResponse.status).toBe(200);
    const disabledSnapshot = (await disabledResponse.json()) as {
      providers: string[];
      wallets: Array<{ address: string; canSignIn: boolean }>;
    };
    expect(disabledSnapshot.providers).not.toContain("siwe");
    const disabledWallets = disabledSnapshot.wallets.filter((wallet) =>
      [firstWallet.address, secondWallet.address]
        .map((address) => address.toLowerCase())
        .includes(wallet.address)
    );
    expect(disabledWallets).toHaveLength(2);
    expect(disabledWallets.every((wallet) => wallet.canSignIn === false)).toBe(
      true
    );
  });

  test("maps a central subject back to legacy PledgeCash product data by wallet ownership", async () => {
    const legacyUserId = randomUUID();
    await dbClient.sql`
      INSERT INTO "users" (
        "id", "name", "email", "email_verified", "created_at", "updated_at"
      )
      VALUES (
        ${legacyUserId}::uuid,
        'Legacy product user',
        ${`${legacyUserId}@wallet.pledge.cash.invalid`},
        false,
        now(),
        now()
      )
    `;
    await dbClient.sql`
      INSERT INTO "wallets" (
        "user_id", "address", "chain_id", "alerts_enabled", "verified_at"
      )
      VALUES (
        ${legacyUserId}::uuid,
        ${legacyWallet.address.toLowerCase()},
        999,
        false,
        now()
      )
    `;
    await dbClient.sql`
      INSERT INTO "subscriptions" ("user_id", "mode", "min_severity")
      VALUES (${legacyUserId}::uuid, 'explicit', 'high')
    `;
    await dbClient.sql`
      INSERT INTO "channels" ("user_id", "type", "telegram_chat_id")
      VALUES (${legacyUserId}::uuid, 'telegram', ${`legacy-${legacyUserId}`})
    `;

    const nonceResponse = await app.request(`${apiOrigin}/auth/siwe/nonce`, {
      body: JSON.stringify({
        chainId: 999,
        walletAddress: legacyWallet.address
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(nonceResponse.status).toBe(200);
    const challenge = (await nonceResponse.json()) as { message: string };
    const signature = await legacyWallet.signMessage({
      message: challenge.message
    });
    const verifyResponse = await app.request(`${apiOrigin}/auth/siwe/verify`, {
      body: JSON.stringify({
        chainId: 999,
        message: challenge.message,
        signature,
        walletAddress: legacyWallet.address
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(verifyResponse.status).toBe(200);
    const cookie = responseCookie(verifyResponse, "pledge-cash.session_token");
    const meResponse = await app.request(`${apiOrigin}/auth/me`, {
      headers: { Cookie: cookie, Origin: webOrigin }
    });
    expect(meResponse.status).toBe(200);
    expect(await meResponse.json()).toMatchObject({
      channels: [
        {
          enabled: true,
          telegramChatId: `legacy-${legacyUserId}`,
          type: "telegram"
        }
      ],
      subscription: {
        minSeverity: "high",
        mode: "explicit"
      },
      user: { id: legacyUserId },
      wallets: [
        {
          address: legacyWallet.address.toLowerCase(),
          alertsEnabled: false
        }
      ]
    });
    const [mapping] = await dbClient.sql<{ subject: string }[]>`
      SELECT "account_id" AS "subject"
      FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${legacyUserId}::uuid
    `;
    expect(mapping?.subject).toBeDefined();
    expect(mapping?.subject).not.toBe(legacyUserId);
  });

  test("refuses to bind a second central subject to one legacy product user", async () => {
    const legacyUserId = randomUUID();
    await dbClient.sql`
      INSERT INTO "users" (
        "id", "name", "email", "email_verified", "created_at", "updated_at"
      )
      VALUES (
        ${legacyUserId}::uuid,
        'Multi-wallet legacy user',
        ${`${legacyUserId}@wallet.pledge.cash.invalid`},
        false,
        now(),
        now()
      )
    `;
    await dbClient.sql`
      INSERT INTO "wallets" (
        "user_id", "address", "chain_id", "alerts_enabled", "verified_at"
      )
      VALUES
        (
          ${legacyUserId}::uuid,
          ${secondLegacyWallet.address.toLowerCase()},
          999,
          true,
          now()
        ),
        (
          ${legacyUserId}::uuid,
          ${migrationWallet.address.toLowerCase()},
          999,
          true,
          now()
        )
    `;

    const firstSignIn = await signInWallet(app, secondLegacyWallet);
    expect(firstSignIn.status).toBe(200);
    const secondSignIn = await signInWallet(app, migrationWallet);
    expect(secondSignIn.status).toBe(401);

    const [mappingCount] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${legacyUserId}::uuid
    `;
    expect(mappingCount?.count).toBe("1");
  });

  test("migrates an existing unmapped product session while linking credentials", async () => {
    const legacyUserId = randomUUID();
    const sessionWallet = privateKeyToAccount(
      "0x4444444444444444444444444444444444444444444444444444444444444444"
    );
    const linkedWallet = privateKeyToAccount(
      "0x5555555555555555555555555555555555555555555555555555555555555555"
    );
    await dbClient.sql`
      INSERT INTO "users" (
        "id", "name", "email", "email_verified", "created_at", "updated_at"
      )
      VALUES (
        ${legacyUserId}::uuid,
        'Unmapped legacy user',
        ${`${legacyUserId}@wallet.pledge.cash.invalid`},
        false,
        now(),
        now()
      )
    `;
    await dbClient.sql`
      INSERT INTO "wallets" (
        "user_id", "address", "chain_id", "alerts_enabled", "verified_at"
      )
      VALUES (
        ${legacyUserId}::uuid,
        ${sessionWallet.address.toLowerCase()},
        999,
        true,
        now()
      )
    `;
    const signIn = await signInWallet(app, sessionWallet);
    expect(signIn.status).toBe(200);
    const cookie = responseCookie(signIn, "pledge-cash.session_token");
    const [initialMapping] = await dbClient.sql<{ subject: string }[]>`
      SELECT "account_id" AS "subject"
      FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${legacyUserId}::uuid
    `;
    if (initialMapping === undefined) {
      throw new Error("Expected initial peezy.tech subject mapping");
    }
    const handoffResponse = await fetch(
      `${identityUrl}/v1/social-link-handoffs`,
      {
        body: JSON.stringify({
          callbackUrl: `${webOrigin}/alerts`,
          clientId: "pledge-cash",
          provider: "github",
          subject: initialMapping.subject
        }),
        headers: {
          Authorization: `Basic ${Buffer.from(
            `pledge-cash:${identityAppSecret}`
          ).toString("base64")}`,
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    expect(handoffResponse.status).toBe(201);
    const handoff = (await handoffResponse.json()) as { url: string };
    const identitySessionResponse = await fetch(handoff.url, {
      redirect: "manual"
    });
    expect(identitySessionResponse.status).toBe(302);
    const identityCookie = responseCookie(
      identitySessionResponse,
      "peezy-identity.session_token"
    );
    await dbClient.sql`
      DELETE FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${legacyUserId}::uuid
    `;

    const socialLinkResponse = await app.request(
      `${apiOrigin}/auth/peezy/link`,
      {
        body: JSON.stringify({
          callbackURL: `${webOrigin}/alerts`,
          errorCallbackURL: `${webOrigin}/alerts`,
          provider: "github"
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: webOrigin
        },
        method: "POST"
      }
    );
    expect(socialLinkResponse.status).toBe(200);
    const socialLink = (await socialLinkResponse.json()) as { url: string };
    expect(new URL(socialLink.url).searchParams.get("login_hint")).toBe(
      "github"
    );
    const stateCookie = responseCookie(
      socialLinkResponse,
      "pledge-cash.state"
    );
    const authorizationResponse = await fetch(socialLink.url, {
      headers: { Cookie: identityCookie },
      redirect: "manual"
    });
    expect(authorizationResponse.status).toBe(302);
    const callbackUrl = authorizationResponse.headers.get("location");
    if (!callbackUrl) throw new Error("Expected OIDC callback redirect");
    const callbackResponse = await app.request(callbackUrl, {
      headers: { Cookie: stateCookie }
    });
    expect(callbackResponse.status).toBe(302);
    const [socialMapping] = await dbClient.sql<{ subject: string }[]>`
      SELECT "account_id" AS "subject"
      FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${legacyUserId}::uuid
    `;
    expect(socialMapping?.subject).toBe(initialMapping.subject);
    await dbClient.sql`
      DELETE FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${legacyUserId}::uuid
    `;

    const nonceResponse = await app.request(`${apiOrigin}/wallets/nonce`, {
      body: JSON.stringify({
        address: linkedWallet.address,
        chainId: 999
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(nonceResponse.status).toBe(200);
    const challenge = (await nonceResponse.json()) as { message: string };
    const signature = await linkedWallet.signMessage({
      message: challenge.message
    });
    const linkResponse = await app.request(`${apiOrigin}/wallets`, {
      body: JSON.stringify({
        message: challenge.message,
        signature
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: webOrigin
      },
      method: "POST"
    });
    const linkBody = await linkResponse.json();
    expect(linkResponse.status, JSON.stringify(linkBody)).toBe(200);
    expect(linkBody).toMatchObject({
      wallet: {
        address: linkedWallet.address.toLowerCase(),
        canSignIn: true
      }
    });
    const [mapping] = await dbClient.sql<{ subject: string }[]>`
      SELECT "account_id" AS "subject"
      FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${legacyUserId}::uuid
    `;
    expect(mapping?.subject).toBeDefined();
    expect(mapping?.subject).not.toBe(legacyUserId);
  });

  test("refuses a wallet link when the central credentials span product users", async () => {
    const sessionUserId = randomUUID();
    const conflictingUserId = randomUUID();
    const centralSubject = randomUUID();
    const sessionWallet = privateKeyToAccount(
      `0x${randomBytes(32).toString("hex")}`
    );
    const requestedWallet = privateKeyToAccount(
      `0x${randomBytes(32).toString("hex")}`
    );
    const conflictingWallet = privateKeyToAccount(
      `0x${randomBytes(32).toString("hex")}`
    );
    await dbClient.sql`
      INSERT INTO "users" (
        "id", "name", "email", "email_verified", "created_at", "updated_at"
      )
      VALUES
        (
          ${sessionUserId}::uuid,
          'Linking session user',
          ${`${sessionUserId}@wallet.pledge.cash.invalid`},
          false,
          now(),
          now()
        ),
        (
          ${conflictingUserId}::uuid,
          'Conflicting credential user',
          ${`${conflictingUserId}@wallet.pledge.cash.invalid`},
          false,
          now(),
          now()
        )
    `;
    await dbClient.sql`
      INSERT INTO "wallets" (
        "user_id", "address", "chain_id", "alerts_enabled", "verified_at"
      )
      VALUES
        (
          ${sessionUserId}::uuid,
          ${sessionWallet.address.toLowerCase()},
          999,
          true,
          now()
        ),
        (
          ${conflictingUserId}::uuid,
          ${conflictingWallet.address.toLowerCase()},
          999,
          true,
          now()
        )
    `;
    const signIn = await signInWallet(app, sessionWallet);
    expect(signIn.status).toBe(200);
    const cookie = responseCookie(signIn, "pledge-cash.session_token");
    await dbClient.sql`
      DELETE FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${sessionUserId}::uuid
    `;

    await identitySql`
      INSERT INTO "user" (
        "id", "name", "email", "email_verified", "status", "created_at", "updated_at"
      )
      VALUES (
        ${centralSubject},
        'Conflicting central user',
        ${`${centralSubject}@example.com`},
        true,
        'active',
        now(),
        now()
      )
    `;
    await identitySql`
      INSERT INTO "wallet_principal" (
        "id", "user_id", "family", "account_kind", "address",
        "chain_id", "sign_in_enabled", "created_at", "updated_at"
      )
      VALUES
        (
          ${randomUUID()},
          ${centralSubject},
          'evm',
          'eoa',
          ${requestedWallet.address},
          NULL,
          true,
          now(),
          now()
        ),
        (
          ${randomUUID()},
          ${centralSubject},
          'evm',
          'eoa',
          ${conflictingWallet.address},
          NULL,
          true,
          now(),
          now()
        )
    `;
    await identitySql`
      INSERT INTO "wallet_address" (
        "id", "user_id", "address", "chain_id", "is_primary", "created_at"
      )
      VALUES
        (
          ${randomUUID()},
          ${centralSubject},
          ${requestedWallet.address},
          999,
          true,
          now()
        ),
        (
          ${randomUUID()},
          ${centralSubject},
          ${conflictingWallet.address},
          999,
          false,
          now()
        )
    `;

    const nonceResponse = await app.request(`${apiOrigin}/wallets/nonce`, {
      body: JSON.stringify({
        address: requestedWallet.address,
        chainId: 999
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(nonceResponse.status).toBe(200);
    const challenge = (await nonceResponse.json()) as { message: string };
    const signature = await requestedWallet.signMessage({
      message: challenge.message
    });
    const linkResponse = await app.request(`${apiOrigin}/wallets`, {
      body: JSON.stringify({ message: challenge.message, signature }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: webOrigin
      },
      method: "POST"
    });

    expect(linkResponse.status).toBe(409);
    const [mapping] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${sessionUserId}::uuid
    `;
    expect(mapping?.count).toBe("0");
    const [linkedWallet] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "wallets"
      WHERE "user_id" = ${sessionUserId}::uuid
        AND lower("address") = ${requestedWallet.address.toLowerCase()}
    `;
    expect(linkedWallet?.count).toBe("0");
  });

  test("maps imported social credentials back to legacy PledgeCash product data", async () => {
    if (!identityUrl || !identityAppSecret) return;
    const legacyUserId = randomUUID();
    const subject = randomUUID();
    const socialAccountId = randomUUID();
    const email = `${subject}@example.com`;
    const now = new Date();
    await dbClient.sql`
      INSERT INTO "users" (
        "id", "name", "email", "email_verified", "created_at", "updated_at"
      )
      VALUES (
        ${legacyUserId}::uuid,
        'Legacy social user',
        ${email},
        true,
        now(),
        now()
      )
    `;
    await dbClient.sql`
      INSERT INTO "auth_accounts" (
        "id", "account_id", "provider_id", "user_id", "created_at", "updated_at"
      )
      VALUES (
        ${socialAccountId}::uuid,
        ${`github-${subject}`},
        'github',
        ${legacyUserId}::uuid,
        now(),
        now()
      )
    `;
    await dbClient.sql`
      INSERT INTO "subscriptions" ("user_id", "mode", "min_severity")
      VALUES (${legacyUserId}::uuid, 'explicit', 'high')
    `;
    await identitySql`
      INSERT INTO "user" (
        "id", "name", "email", "email_verified", "status", "created_at", "updated_at"
      )
      VALUES (
        ${subject},
        'Legacy social user',
        ${email},
        true,
        'active',
        ${now},
        ${now}
      )
    `;
    await identitySql`
      INSERT INTO "account" (
        "id", "account_id", "provider_id", "user_id", "created_at", "updated_at"
      )
      VALUES (
        ${socialAccountId},
        ${`github-${subject}`},
        'github',
        ${subject},
        ${now},
        ${now}
      )
    `;

    const handoffResponse = await fetch(
      `${identityUrl}/v1/social-link-handoffs`,
      {
        body: JSON.stringify({
          callbackUrl: `${webOrigin}/alerts`,
          clientId: "pledge-cash",
          provider: "github",
          subject
        }),
        headers: {
          Authorization: `Basic ${Buffer.from(
            `pledge-cash:${identityAppSecret}`
          ).toString("base64")}`,
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    expect(handoffResponse.status).toBe(201);
    const handoff = (await handoffResponse.json()) as { url: string };
    const identitySessionResponse = await fetch(handoff.url, {
      redirect: "manual"
    });
    expect(identitySessionResponse.status).toBe(302);
    const identityCookie = responseCookie(
      identitySessionResponse,
      "peezy-identity.session_token"
    );
    const oidcStart = await app.request(`${apiOrigin}/auth/peezy/sign-in`, {
      body: JSON.stringify({
        callbackURL: `${webOrigin}/alerts`,
        provider: "github"
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(oidcStart.status).toBe(200);
    const stateCookie = responseCookie(oidcStart, "pledge-cash.state");
    const authorization = (await oidcStart.json()) as { url: string };
    const authorizationResponse = await fetch(authorization.url, {
      headers: { Cookie: identityCookie },
      redirect: "manual"
    });
    expect(authorizationResponse.status).toBe(302);
    const callbackUrl = authorizationResponse.headers.get("location");
    if (!callbackUrl) throw new Error("Expected OIDC callback redirect");
    const callbackResponse = await app.request(callbackUrl, {
      headers: { Cookie: stateCookie }
    });
    expect(callbackResponse.status).toBe(302);
    const productCookie = responseCookie(
      callbackResponse,
      "pledge-cash.session_token"
    );
    const meResponse = await app.request(`${apiOrigin}/auth/me`, {
      headers: { Cookie: productCookie, Origin: webOrigin }
    });
    expect(meResponse.status).toBe(200);
    expect(await meResponse.json()).toMatchObject({
      providers: ["github"],
      subscription: {
        minSeverity: "high",
        mode: "explicit"
      },
      user: { id: legacyUserId }
    });
    const [mapping] = await dbClient.sql<{ userId: string }[]>`
      SELECT "user_id"::text AS "userId"
      FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "account_id" = ${subject}
    `;
    expect(mapping?.userId).toBe(legacyUserId);
  });

  test("creates a PledgeCash product session for a walletless central account", async () => {
    if (!identityUrl || !identityAppSecret || !identityOidcSecret) return;
    const subject = randomUUID();
    const socialAccountId = randomUUID();
    const now = new Date();
    await identitySql`
      INSERT INTO "user" (
        "id", "name", "email", "email_verified", "status", "created_at", "updated_at"
      )
      VALUES (
        ${subject},
        'Walletless User',
        ${`${subject}@example.com`},
        true,
        'active',
        ${now},
        ${now}
      )
    `;
    await identitySql`
      INSERT INTO "account" (
        "id", "account_id", "provider_id", "user_id", "created_at", "updated_at"
      )
      VALUES (
        ${socialAccountId},
        ${`github-${subject}`},
        'github',
        ${subject},
        ${now},
        ${now}
      )
    `;

    const handoffResponse = await fetch(
      `${identityUrl}/v1/social-link-handoffs`,
      {
        body: JSON.stringify({
          callbackUrl: `${webOrigin}/alerts`,
          clientId: "pledge-cash",
          provider: "github",
          subject
        }),
        headers: {
          Authorization: `Basic ${Buffer.from(
            `pledge-cash:${identityAppSecret}`
          ).toString("base64")}`,
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    expect(handoffResponse.status).toBe(201);
    const handoff = (await handoffResponse.json()) as { url: string };
    const identitySessionResponse = await fetch(handoff.url, {
      redirect: "manual"
    });
    expect(identitySessionResponse.status).toBe(302);
    const identityCookie = responseCookie(
      identitySessionResponse,
      "peezy-identity.session_token"
    );

    const oidcStart = await app.request(`${apiOrigin}/auth/peezy/sign-in`, {
      body: JSON.stringify({
        callbackURL: `${webOrigin}/alerts`,
        provider: "github"
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(oidcStart.status).toBe(200);
    const stateCookie = responseCookie(oidcStart, "pledge-cash.state");
    const authorization = (await oidcStart.json()) as { url: string };
    const authorizationResponse = await fetch(authorization.url, {
      headers: { Cookie: identityCookie },
      redirect: "manual"
    });
    expect(authorizationResponse.status).toBe(302);
    const callbackUrl = authorizationResponse.headers.get("location");
    if (!callbackUrl) throw new Error("Expected OIDC callback redirect");
    const callbackResponse = await app.request(callbackUrl, {
      headers: { Cookie: stateCookie }
    });
    expect(callbackResponse.status).toBe(302);
    const productCookie = responseCookie(
      callbackResponse,
      "pledge-cash.session_token"
    );

    const meResponse = await app.request(`${apiOrigin}/auth/me`, {
      headers: { Cookie: productCookie, Origin: webOrigin }
    });
    expect(meResponse.status).toBe(200);
    expect(await meResponse.json()).toMatchObject({
      providers: ["github"],
      user: { id: subject },
      wallets: []
    });
    const [productIdentityAccount] = await dbClient.sql<
      {
        accessToken: string | null;
        accessTokenExpiresAt: Date | null;
        idToken: string | null;
        refreshToken: string | null;
        refreshTokenExpiresAt: Date | null;
      }[]
    >`
      SELECT
        "access_token" AS "accessToken",
        "access_token_expires_at" AS "accessTokenExpiresAt",
        "id_token" AS "idToken",
        "refresh_token" AS "refreshToken",
        "refresh_token_expires_at" AS "refreshTokenExpiresAt"
      FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "account_id" = ${subject}
    `;
    expect(productIdentityAccount).toEqual({
      accessToken: null,
      accessTokenExpiresAt: null,
      idToken: null,
      refreshToken: null,
      refreshTokenExpiresAt: null
    });
  });
});

function responseCookie(response: Response, name: string): string {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(
          (value): value is string => value !== null
        );
  for (const candidate of values) {
    const pair = candidate.split(";")[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const cookieName = pair.slice(0, separator);
    if (
      cookieName === name ||
      cookieName === `__Secure-${name}` ||
      cookieName === `__Host-${name}`
    ) {
      return pair;
    }
  }
  throw new Error(`Expected ${name} cookie`);
}

async function signInWallet(
  app: ReturnType<typeof createApp>,
  wallet: ReturnType<typeof privateKeyToAccount>
): Promise<Response> {
  const nonceResponse = await app.request(`${apiOrigin}/auth/siwe/nonce`, {
    body: JSON.stringify({
      chainId: 999,
      walletAddress: wallet.address
    }),
    headers: {
      "Content-Type": "application/json",
      Origin: webOrigin
    },
    method: "POST"
  });
  expect(nonceResponse.status).toBe(200);
  const challenge = (await nonceResponse.json()) as { message: string };
  const signature = await wallet.signMessage({
    message: challenge.message
  });
  return app.request(`${apiOrigin}/auth/siwe/verify`, {
    body: JSON.stringify({
      chainId: 999,
      message: challenge.message,
      signature,
      walletAddress: wallet.address
    }),
    headers: {
      "Content-Type": "application/json",
      Origin: webOrigin
    },
    method: "POST"
  });
}
