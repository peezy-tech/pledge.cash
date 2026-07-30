import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres, { type Sql } from "postgres";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

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
    expect(await capabilities.json()).toEqual({
      socialProviders: ["github"],
      walletlessSocialSignIn: true
    });

    const nonceResponse = await app.request(`${apiOrigin}/auth/peezy/siwe/nonce`, {
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
    const verifyResponse = await app.request(`${apiOrigin}/auth/peezy/siwe/verify`, {
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

    const oidcStart = await app.request(
      `${apiOrigin}/auth/peezy/sign-in`,
      {
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
      },
      { clientIp: "192.0.2.1" }
    );
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
    const [quotaAfterLink] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "identity_quota_events"
      WHERE "scope" = 'pledge-cash:wallet-grant-link'
    `;
    expect(quotaAfterLink?.count).toBe("1");
    const [readQuotaBeforeReplays] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "identity_quota_events"
      WHERE "scope" = 'pledge-cash:presentation-read'
    `;

    const replayStatuses = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const response = await app.request(`${apiOrigin}/wallets`, {
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
        return response.status;
      })
    );
    expect(replayStatuses.every((status) => status === 200)).toBe(true);
    const [quotaAfterReplays] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "identity_quota_events"
      WHERE "scope" = 'pledge-cash:wallet-grant-link'
    `;
    expect(quotaAfterReplays?.count).toBe("1");
    const [readQuotaAfterReplays] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "identity_quota_events"
      WHERE "scope" = 'pledge-cash:presentation-read'
    `;
    expect(readQuotaAfterReplays?.count).toBe(
      readQuotaBeforeReplays?.count
    );

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
    const updatedCoverage = await uncachedApp.request(
      `${apiOrigin}/wallets/${firstWallet.address}`,
      {
        body: JSON.stringify({ alertsEnabled: false }),
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: webOrigin
        },
        method: "PATCH"
      }
    );
    expect(updatedCoverage.status).toBe(200);
    expect(await updatedCoverage.json()).toMatchObject({
      wallet: {
        address: firstWallet.address.toLowerCase(),
        alertsEnabled: false,
        canSignIn: false
      }
    });
  });

  test("preserves an alert opt-out when wallet sign-in adds another chain", async () => {
    const wallet = privateKeyToAccount(
      `0x${randomBytes(32).toString("hex")}`
    );
    const firstSignIn = await signInWallet(app, wallet, 999, "192.0.2.81");
    expect(firstSignIn.status).toBe(200);
    const cookie = responseCookie(
      firstSignIn,
      "pledge-cash.session_token"
    );
    const firstSession = (await firstSignIn.json()) as {
      user: { id: string };
    };

    const stopWatching = await app.request(
      `${apiOrigin}/wallets/${wallet.address}`,
      {
        body: JSON.stringify({ alertsEnabled: false }),
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: webOrigin
        },
        method: "PATCH"
      }
    );
    expect(stopWatching.status).toBe(200);

    const secondSignIn = await signInWallet(app, wallet, 1, "192.0.2.81");
    expect(secondSignIn.status).toBe(200);
    const secondSession = (await secondSignIn.json()) as {
      user: { id: string };
    };
    expect(secondSession.user.id).toBe(firstSession.user.id);

    const coverage = await dbClient.sql<
      Array<{ alertsEnabled: boolean; chainId: number }>
    >`
      SELECT
        "alerts_enabled" AS "alertsEnabled",
        "chain_id" AS "chainId"
      FROM "wallets"
      WHERE "user_id" = ${firstSession.user.id}::uuid
        AND lower("address") = ${wallet.address.toLowerCase()}
      ORDER BY "chain_id"
    `;
    expect(coverage).toEqual([
      { alertsEnabled: false, chainId: 1 },
      { alertsEnabled: false, chainId: 999 }
    ]);
  });

  test("reconciles a central wallet link after the local coverage commit fails", async () => {
    const primaryWallet = privateKeyToAccount(
      `0x${randomBytes(32).toString("hex")}`
    );
    const linkedWallet = privateKeyToAccount(
      `0x${randomBytes(32).toString("hex")}`
    );
    const signIn = await signInWallet(app, primaryWallet);
    expect(signIn.status).toBe(200);
    const cookie = responseCookie(signIn, "pledge-cash.session_token");
    const session = (await signIn.json()) as { user: { id: string } };
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

    await dbClient.sql.unsafe(`
      CREATE FUNCTION fail_test_identity_wallet_coverage()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'simulated local wallet coverage failure';
      END;
      $$
    `);
    await dbClient.sql.unsafe(`
      CREATE TRIGGER fail_test_identity_wallet_coverage
      BEFORE INSERT ON wallets
      FOR EACH ROW
      WHEN (lower(NEW.address) = '${linkedWallet.address.toLowerCase()}')
      EXECUTE FUNCTION fail_test_identity_wallet_coverage()
    `);
    let linkResponse: Response;
    try {
      linkResponse = await app.request(`${apiOrigin}/wallets`, {
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
    } finally {
      await dbClient.sql.unsafe(
        `DROP TRIGGER IF EXISTS fail_test_identity_wallet_coverage ON wallets`
      );
      await dbClient.sql.unsafe(
        `DROP FUNCTION IF EXISTS fail_test_identity_wallet_coverage()`
      );
    }
    expect(linkResponse.status).toBe(503);
    const [centralLink, pendingLink, localCoverage] = await Promise.all([
      identitySql<{ count: string }[]>`
        SELECT count(*)::text AS "count"
        FROM "wallet_principal"
        WHERE lower("address") = ${linkedWallet.address.toLowerCase()}
      `,
      dbClient.sql<{ count: string }[]>`
        SELECT count(*)::text AS "count"
        FROM "identity_wallet_link_reconciliations"
        WHERE lower("address") = ${linkedWallet.address.toLowerCase()}
          AND "user_id" = ${session.user.id}::uuid
      `,
      dbClient.sql<{ count: string }[]>`
        SELECT count(*)::text AS "count"
        FROM "wallets"
        WHERE lower("address") = ${linkedWallet.address.toLowerCase()}
      `
    ]);
    expect(centralLink[0]?.count).toBe("1");
    expect(pendingLink[0]?.count).toBe("1");
    expect(localCoverage[0]?.count).toBe("0");

    const reconciledResponse = await app.request(`${apiOrigin}/auth/me`, {
      headers: { Cookie: cookie, Origin: webOrigin }
    });
    expect(reconciledResponse.status).toBe(200);
    expect(await reconciledResponse.json()).toMatchObject({
      wallets: expect.arrayContaining([
        expect.objectContaining({
          address: linkedWallet.address.toLowerCase(),
          canSignIn: true
        })
      ])
    });
    const [pendingAfter, coverageAfter] = await Promise.all([
      dbClient.sql<{ count: string }[]>`
        SELECT count(*)::text AS "count"
        FROM "identity_wallet_link_reconciliations"
        WHERE lower("address") = ${linkedWallet.address.toLowerCase()}
      `,
      dbClient.sql<{ count: string }[]>`
        SELECT count(*)::text AS "count"
        FROM "wallets"
        WHERE lower("address") = ${linkedWallet.address.toLowerCase()}
          AND "user_id" = ${session.user.id}::uuid
      `
    ]);
    expect(pendingAfter[0]?.count).toBe("0");
    expect(coverageAfter[0]?.count).toBe("1");
  });

  test("retains wallet-link reconciliation after an ambiguous Identity failure", async () => {
    const primaryWallet = privateKeyToAccount(
      `0x${randomBytes(32).toString("hex")}`
    );
    const linkedWallet = privateKeyToAccount(
      `0x${randomBytes(32).toString("hex")}`
    );
    const signIn = await signInWallet(app, primaryWallet);
    expect(signIn.status).toBe(200);
    const cookie = responseCookie(signIn, "pledge-cash.session_token");
    const session = (await signIn.json()) as { user: { id: string } };
    const ambiguousApp = createApp({
      auth: createPeezyIdentityAuthAdapter(
        config,
        dbClient.db,
        async (input, init) => {
          const requestUrl =
            input instanceof Request ? input.url : input.toString();
          if (
            new URL(requestUrl).pathname === "/v1/wallet/grants/issue"
          ) {
            return Response.json(
              { message: "Identity wallet grant outcome is unknown" },
              { status: 503 }
            );
          }
          return fetch(input, init);
        }
      ),
      config,
      store: createDrizzleApiStore(dbClient.db)
    });
    const nonceResponse = await ambiguousApp.request(
      `${apiOrigin}/wallets/nonce`,
      {
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
      }
    );
    expect(nonceResponse.status).toBe(200);
    const challenge = (await nonceResponse.json()) as { message: string };
    const signature = await linkedWallet.signMessage({
      message: challenge.message
    });

    const linkResponse = await ambiguousApp.request(`${apiOrigin}/wallets`, {
      body: JSON.stringify({ message: challenge.message, signature }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: webOrigin
      },
      method: "POST"
    });

    expect(linkResponse.status).toBe(503);
    expect(await linkResponse.json()).toEqual({
      error: { message: "Wallet linking is temporarily unavailable" }
    });
    const [pendingLink, localCoverage, centralLink] = await Promise.all([
      dbClient.sql<{ count: string }[]>`
        SELECT count(*)::text AS "count"
        FROM "identity_wallet_link_reconciliations"
        WHERE lower("address") = ${linkedWallet.address.toLowerCase()}
          AND "user_id" = ${session.user.id}::uuid
      `,
      dbClient.sql<{ count: string }[]>`
        SELECT count(*)::text AS "count"
        FROM "wallets"
        WHERE lower("address") = ${linkedWallet.address.toLowerCase()}
      `,
      identitySql<{ count: string }[]>`
        SELECT count(*)::text AS "count"
        FROM "wallet_principal"
        WHERE lower("address") = ${linkedWallet.address.toLowerCase()}
      `
    ]);
    expect(pendingLink[0]?.count).toBe("1");
    expect(localCoverage[0]?.count).toBe("0");
    expect(centralLink[0]?.count).toBe("0");
  });

  test("lets a pre-rollout client sign an existing wallet without creating a second credential", async () => {
    const account = privateKeyToAccount(
      `0x${randomBytes(32).toString("hex")}`
    );
    const legacyUserId = randomUUID();
    await dbClient.sql`
      INSERT INTO "users" (
        "id", "name", "email", "email_verified", "created_at", "updated_at"
      )
      VALUES (
        ${legacyUserId}::uuid,
        'Loaded legacy client',
        ${`${legacyUserId}@wallet.pledge.cash.invalid`},
        false,
        now(),
        now()
      )
    `;
    await dbClient.sql`
      INSERT INTO "auth_wallets" ("user_id", "address", "chain_id", "is_primary")
      VALUES (${legacyUserId}::uuid, ${account.address}, 999, true)
    `;
    await identitySql`
      INSERT INTO "user" (
        "id", "name", "email", "email_verified", "status", "created_at", "updated_at"
      )
      VALUES (
        ${legacyUserId},
        'Imported legacy client',
        ${`${legacyUserId}@wallet.pledge.cash.invalid`},
        false,
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
      VALUES (
        ${randomUUID()},
        ${legacyUserId},
        'evm',
        'eoa',
        ${account.address},
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
      VALUES (
        ${randomUUID()},
        ${legacyUserId},
        ${account.address},
        999,
        true,
        now()
      )
    `;
    const nonceResponse = await app.request(`${apiOrigin}/auth/siwe/nonce`, {
      body: JSON.stringify({
        chainId: 999,
        walletAddress: account.address
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(nonceResponse.status).toBe(200);
    const challenge = (await nonceResponse.json()) as {
      nonce: string;
    };
    const issuedAt = new Date();
    const message = createSiweMessage({
      address: account.address,
      chainId: 999,
      domain: "localhost:5173",
      expirationTime: new Date(issuedAt.getTime() + 10 * 60_000),
      issuedAt,
      nonce: challenge.nonce,
      statement: "Sign in to pledge.cash alerts.",
      uri: webOrigin,
      version: "1"
    });
    const signature = await account.signMessage({ message });
    const verifyResponse = await app.request(`${apiOrigin}/auth/siwe/verify`, {
      body: JSON.stringify({
        chainId: 999,
        message,
        signature,
        walletAddress: account.address
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(verifyResponse.status).toBe(200);
    expect(
      responseCookie(verifyResponse, "pledge-cash.session_token")
    ).toContain("pledge-cash.session_token");
    const [centralClaim] = await identitySql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "wallet_principal"
      WHERE lower("address") = ${account.address.toLowerCase()}
    `;
    expect(centralClaim?.count).toBe("1");
    const [localCredentials] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "auth_wallets"
      WHERE lower("address") = ${account.address.toLowerCase()}
    `;
    expect(localCredentials?.count).toBe("1");
    const [legacyMapping] = await dbClient.sql<{ subject: string }[]>`
      SELECT "account_id" AS "subject"
      FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${legacyUserId}::uuid
    `;
    expect(legacyMapping?.subject).toBe(legacyUserId);

    const socialResponse = await app.request(
      `${apiOrigin}/auth/sign-in/social`,
      {
        body: JSON.stringify({
          callbackURL: `${webOrigin}/alerts`,
          provider: "github"
        }),
        headers: {
          "Content-Type": "application/json",
          Origin: webOrigin,
          "X-Forwarded-For": "192.0.2.6"
        },
        method: "POST"
      },
      { clientIp: "192.0.2.6" }
    );
    expect(socialResponse.status).toBe(200);
    expect(await socialResponse.json()).toMatchObject({
      redirect: true,
      url: expect.any(String)
    });

    const centralSignIn = await signInWallet(app, account);
    expect(centralSignIn.status).toBe(200);
    await identitySql`
      UPDATE "user"
      SET "status" = 'disabled', "updated_at" = now()
      WHERE "id" = ${legacyUserId}
    `;
    await dbClient.sql`
      DELETE FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${legacyUserId}::uuid
    `;
    const disabledNonceResponse = await app.request(
      `${apiOrigin}/auth/siwe/nonce`,
      {
        body: JSON.stringify({
          chainId: 999,
          walletAddress: account.address
        }),
        headers: {
          "Content-Type": "application/json",
          Origin: webOrigin
        },
        method: "POST"
      }
    );
    expect(disabledNonceResponse.status).toBe(200);
    const disabledChallenge = (await disabledNonceResponse.json()) as {
      nonce: string;
    };
    const disabledIssuedAt = new Date();
    const disabledMessage = createSiweMessage({
      address: account.address,
      chainId: 999,
      domain: "localhost:5173",
      expirationTime: new Date(disabledIssuedAt.getTime() + 10 * 60_000),
      issuedAt: disabledIssuedAt,
      nonce: disabledChallenge.nonce,
      statement: "Sign in to pledge.cash alerts.",
      uri: webOrigin,
      version: "1"
    });
    const disabledSignature = await account.signMessage({
      message: disabledMessage
    });
    const disabledVerifyResponse = await app.request(
      `${apiOrigin}/auth/siwe/verify`,
      {
        body: JSON.stringify({
          chainId: 999,
          message: disabledMessage,
          signature: disabledSignature,
          walletAddress: account.address
        }),
        headers: {
          "Content-Type": "application/json",
          Origin: webOrigin
        },
        method: "POST"
      }
    );
    expect(disabledVerifyResponse.status).toBe(401);
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

    const nonceResponse = await app.request(`${apiOrigin}/auth/peezy/siwe/nonce`, {
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
    const verifyResponse = await app.request(`${apiOrigin}/auth/peezy/siwe/verify`, {
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
    expect(secondSignIn.status).toBe(503);
    expect(await secondSignIn.json()).toMatchObject({
      message: "Wallet sign-in is temporarily unavailable"
    });

    const [mappingCount] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${legacyUserId}::uuid
    `;
    expect(mappingCount?.count).toBe("1");
  });

  test("does not mutate Identity when an unmapped product session links a wallet", async () => {
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
    expect(linkResponse.status, JSON.stringify(linkBody)).toBe(409);
    expect(linkBody).toMatchObject({
      error: {
        message:
          "Sign in through peezy.tech Identity before linking another wallet"
      }
    });
    const [mapping] = await dbClient.sql<{ subject: string }[]>`
      SELECT "account_id" AS "subject"
      FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${legacyUserId}::uuid
    `;
    expect(mapping).toBeUndefined();
    const [centralWallet] = await identitySql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "wallet_principal"
      WHERE lower("address") = ${linkedWallet.address.toLowerCase()}
    `;
    expect(centralWallet?.count).toBe("0");
  });

  test("does not retain a local wallet claim when Identity rejects the link", async () => {
    const sessionWallet = privateKeyToAccount(
      `0x${randomBytes(32).toString("hex")}`
    );
    const centrallyOwnedWallet = privateKeyToAccount(
      `0x${randomBytes(32).toString("hex")}`
    );
    const signIn = await signInWallet(app, sessionWallet);
    expect(signIn.status).toBe(200);
    const cookie = responseCookie(signIn, "pledge-cash.session_token");

    const centralOwner = randomUUID();
    await identitySql`
      INSERT INTO "user" (
        "id", "name", "email", "email_verified", "status", "created_at", "updated_at"
      )
      VALUES (
        ${centralOwner},
        'Existing central wallet owner',
        ${`${centralOwner}@example.com`},
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
      VALUES (
        ${randomUUID()},
        ${centralOwner},
        'evm',
        'eoa',
        ${centrallyOwnedWallet.address},
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
      VALUES (
        ${randomUUID()},
        ${centralOwner},
        ${centrallyOwnedWallet.address},
        999,
        true,
        now()
      )
    `;

    const nonceResponse = await app.request(`${apiOrigin}/wallets/nonce`, {
      body: JSON.stringify({
        address: centrallyOwnedWallet.address,
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
    const signature = await centrallyOwnedWallet.signMessage({
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
    const [localOwner] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "wallet_owners"
      WHERE "address" = ${centrallyOwnedWallet.address.toLowerCase()}
    `;
    const [localCoverage] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "wallets"
      WHERE lower("address") = ${centrallyOwnedWallet.address.toLowerCase()}
    `;
    const [pendingReconciliation] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "identity_wallet_link_reconciliations"
      WHERE lower("address") = ${centrallyOwnedWallet.address.toLowerCase()}
    `;
    expect(localOwner?.count).toBe("0");
    expect(localCoverage?.count).toBe("0");
    expect(pendingReconciliation?.count).toBe("0");
  });

  test("expires centrally absent wallet-link reconciliations before enforcing the cap", async () => {
    const sessionWallet = privateKeyToAccount(
      `0x${randomBytes(32).toString("hex")}`
    );
    const linkedWallet = privateKeyToAccount(
      `0x${randomBytes(32).toString("hex")}`
    );
    const signIn = await signInWallet(app, sessionWallet);
    expect(signIn.status).toBe(200);
    const cookie = responseCookie(signIn, "pledge-cash.session_token");
    const session = (await signIn.json()) as { user: { id: string } };
    const [mapping] = await dbClient.sql<{ subject: string }[]>`
      SELECT "account_id" AS "subject"
      FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${session.user.id}::uuid
    `;
    if (mapping === undefined) {
      throw new Error("Expected a peezy.tech subject mapping");
    }

    const staleAt = new Date(Date.now() - 6 * 60_000).toISOString();
    for (let index = 0; index < 10; index += 1) {
      const address = `0x${(index + 1).toString(16).padStart(40, "0")}`;
      await dbClient.sql`
        INSERT INTO "identity_wallet_link_reconciliations" (
          "id", "subject", "user_id", "address", "chain_id",
          "siwe_message", "verified_at", "created_at"
        )
        VALUES (
          ${randomUUID()}::uuid,
          ${mapping.subject},
          ${session.user.id}::uuid,
          ${address},
          999,
          ${`stale wallet link ${index}`},
          ${staleAt},
          ${staleAt}
        )
      `;
    }

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
      body: JSON.stringify({ message: challenge.message, signature }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: webOrigin
      },
      method: "POST"
    });
    expect(linkResponse.status).toBe(200);

    const [pendingAfter] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "identity_wallet_link_reconciliations"
      WHERE "subject" = ${mapping.subject}
    `;
    expect(pendingAfter?.count).toBe("0");
  });

  test("refuses a wallet link when the central credentials span product users", async () => {
    const sessionUserId = randomUUID();
    const conflictingUserId = randomUUID();
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
    const [mapping] = await dbClient.sql<{ subject: string }[]>`
      SELECT "account_id" AS "subject"
      FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${sessionUserId}::uuid
    `;
    if (mapping === undefined) {
      throw new Error("Expected a peezy.tech subject mapping");
    }
    const centralSubject = mapping.subject;
    await identitySql`
      INSERT INTO "wallet_principal" (
        "id", "user_id", "family", "account_kind", "address",
        "chain_id", "sign_in_enabled", "created_at", "updated_at"
      )
      VALUES (
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
      VALUES (
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
    const [mappingCount] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "auth_accounts"
      WHERE "provider_id" = 'peezy'
        AND "user_id" = ${sessionUserId}::uuid
    `;
    expect(mappingCount?.count).toBe("1");
    const [linkedWallet] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "wallets"
      WHERE "user_id" = ${sessionUserId}::uuid
        AND lower("address") = ${requestedWallet.address.toLowerCase()}
    `;
    expect(linkedWallet?.count).toBe("0");
    const [centralWallet] = await identitySql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "wallet_principal"
      WHERE lower("address") = ${requestedWallet.address.toLowerCase()}
    `;
    expect(centralWallet?.count).toBe("0");
  });

  test("refreshes central credentials before OIDC provisioning conflict checks", async () => {
    if (!identityUrl || !identityAppSecret) return;
    const subject = randomUUID();
    const socialAccountId = randomUUID();
    const conflictingUserId = randomUUID();
    const conflictingSocialAccountId = randomUUID();
    await identitySql`
      INSERT INTO "user" (
        "id", "name", "email", "email_verified", "status", "created_at", "updated_at"
      )
      VALUES (
        ${subject},
        'OIDC cache conflict user',
        ${`${subject}@example.com`},
        true,
        'active',
        now(),
        now()
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
        now(),
        now()
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

    const initialOidcStart = await app.request(
      `${apiOrigin}/auth/peezy/sign-in`,
      {
        body: JSON.stringify({
          callbackURL: `${webOrigin}/alerts`,
          provider: "github"
        }),
        headers: {
          "Content-Type": "application/json",
          Origin: webOrigin
        },
        method: "POST"
      },
      { clientIp: "192.0.2.2" }
    );
    expect(initialOidcStart.status).toBe(200);
    const initialStateCookie = responseCookie(
      initialOidcStart,
      "pledge-cash.state"
    );
    const initialAuthorization = (await initialOidcStart.json()) as {
      url: string;
    };
    const initialAuthorizationResponse = await fetch(initialAuthorization.url, {
      headers: { Cookie: identityCookie },
      redirect: "manual"
    });
    expect(initialAuthorizationResponse.status).toBe(302);
    const initialCallbackUrl =
      initialAuthorizationResponse.headers.get("location");
    if (!initialCallbackUrl) throw new Error("Expected OIDC callback redirect");
    const initialCallbackResponse = await app.request(initialCallbackUrl, {
      headers: { Cookie: initialStateCookie }
    });
    expect(initialCallbackResponse.status).toBe(302);
    const productCookie = responseCookie(
      initialCallbackResponse,
      "pledge-cash.session_token"
    );
    const cachedMeResponse = await app.request(`${apiOrigin}/auth/me`, {
      headers: { Cookie: productCookie, Origin: webOrigin }
    });
    expect(cachedMeResponse.status).toBe(200);

    await dbClient.sql`
      INSERT INTO "users" (
        "id", "name", "email", "email_verified", "created_at", "updated_at"
      )
      VALUES (
        ${conflictingUserId}::uuid,
        'OIDC conflicting product user',
        ${`${conflictingUserId}@wallet.pledge.cash.invalid`},
        false,
        now(),
        now()
      )
    `;
    await dbClient.sql`
      INSERT INTO "auth_accounts" (
        "id", "account_id", "provider_id", "user_id", "created_at", "updated_at"
      )
      VALUES (
        ${conflictingSocialAccountId}::uuid,
        ${`discord-${subject}`},
        'discord',
        ${conflictingUserId}::uuid,
        now(),
        now()
      )
    `;
    await identitySql`
      INSERT INTO "account" (
        "id", "account_id", "provider_id", "user_id", "created_at", "updated_at"
      )
      VALUES (
        ${conflictingSocialAccountId},
        ${`discord-${subject}`},
        'discord',
        ${subject},
        now(),
        now()
      )
    `;

    const conflictingOidcStart = await app.request(
      `${apiOrigin}/auth/peezy/sign-in`,
      {
        body: JSON.stringify({
          callbackURL: `${webOrigin}/alerts`,
          provider: "github"
        }),
        headers: {
          "Content-Type": "application/json",
          Origin: webOrigin
        },
        method: "POST"
      },
      { clientIp: "192.0.2.3" }
    );
    expect(conflictingOidcStart.status).toBe(200);
    const conflictingStateCookie = responseCookie(
      conflictingOidcStart,
      "pledge-cash.state"
    );
    const conflictingAuthorization = (await conflictingOidcStart.json()) as {
      url: string;
    };
    const conflictingAuthorizationResponse = await fetch(
      conflictingAuthorization.url,
      {
        headers: { Cookie: identityCookie },
        redirect: "manual"
      }
    );
    expect(conflictingAuthorizationResponse.status).toBe(302);
    const conflictingCallbackUrl =
      conflictingAuthorizationResponse.headers.get("location");
    if (!conflictingCallbackUrl) {
      throw new Error("Expected conflicting OIDC callback redirect");
    }
    const conflictingCallbackResponse = await app.request(
      conflictingCallbackUrl,
      {
        headers: { Cookie: conflictingStateCookie }
      }
    );
    expect(conflictingCallbackResponse.status).toBe(500);
    const [productSessionCount] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "auth_sessions"
      WHERE "user_id" = ${subject}::uuid
    `;
    expect(productSessionCount?.count).toBe("1");
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
    const [quotaBefore] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "identity_quota_events"
      WHERE "scope" = 'pledge-cash:presentation-read'
    `;
    const oidcStart = await app.request(
      `${apiOrigin}/auth/peezy/sign-in`,
      {
        body: JSON.stringify({
          callbackURL: `${webOrigin}/alerts`,
          provider: "github"
        }),
        headers: {
          "Content-Type": "application/json",
          Origin: webOrigin
        },
        method: "POST"
      },
      { clientIp: "192.0.2.4" }
    );
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
    const [quotaAfter] = await dbClient.sql<{ count: string }[]>`
      SELECT count(*)::text AS "count"
      FROM "identity_quota_events"
      WHERE "scope" = 'pledge-cash:presentation-read'
    `;
    expect(Number(quotaAfter?.count ?? 0)).toBe(
      Number(quotaBefore?.count ?? 0) + 1
    );
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

    const oidcStart = await app.request(
      `${apiOrigin}/auth/peezy/sign-in`,
      {
        body: JSON.stringify({
          callbackURL: `${webOrigin}/alerts`,
          provider: "github"
        }),
        headers: {
          "Content-Type": "application/json",
          Origin: webOrigin
        },
        method: "POST"
      },
      { clientIp: "192.0.2.5" }
    );
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
  wallet: ReturnType<typeof privateKeyToAccount>,
  chainId = 999,
  clientIp?: string
): Promise<Response> {
  const socketIp =
    clientIp ??
    `198.51.100.${(Number.parseInt(wallet.address.slice(-2), 16) % 254) + 1}`;
  const nonceResponse = await app.request(
    `${apiOrigin}/auth/peezy/siwe/nonce`,
    {
      body: JSON.stringify({
        chainId,
        walletAddress: wallet.address
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: webOrigin,
        ...(clientIp === undefined ? {} : { "X-Forwarded-For": clientIp })
      },
      method: "POST"
    },
    { clientIp: socketIp }
  );
  expect(nonceResponse.status).toBe(200);
  const challenge = (await nonceResponse.json()) as { message: string };
  const signature = await wallet.signMessage({
    message: challenge.message
  });
  return app.request(
    `${apiOrigin}/auth/peezy/siwe/verify`,
    {
      body: JSON.stringify({
        chainId,
        message: challenge.message,
        signature,
        walletAddress: wallet.address
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: webOrigin,
        ...(clientIp === undefined ? {} : { "X-Forwarded-For": clientIp })
      },
      method: "POST"
    },
    { clientIp: socketIp }
  );
}
