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
    };
    expect(me.user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(me.providers).toContain("siwe");

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
