import { beforeEach, describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

import {
  AuthRateLimitError,
  AuthSocialDependencyError,
  type AuthAdapter,
  type AuthSnapshot,
  type RateLimitConfig
} from "../src/api/auth";
import { WALLET_LINK_SIWE_STATEMENT } from "../src/api/better-auth";
import { createApp, type SentinelApiDeps, type SentinelApiStore } from "../src/api/server";
import type {
  AddressDto,
  AuthMeResponse,
  HealthResponse,
  WalletDto,
  WalletNonceResponse
} from "../src/api/dto";
import { AUTH_SIWE_MAX_MESSAGE_LENGTH } from "../src/api/dto";

const WEB_ORIGIN = "https://pledge.cash";
const FIXED_NOW = new Date("2026-07-09T12:00:00.000Z");
const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_COOKIE = "better-auth.session_token=stub-session";
const PRIMARY_WALLET = "0x5555555555555555555555555555555555555555" as AddressDto;
const AUTH_ACCOUNT = privateKeyToAccount(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
);

type ForwardedAuthRequest = {
  readonly body: unknown;
  readonly method: string;
  readonly path: string;
};

class StubAuth implements AuthAdapter {
  readonly forwarded: ForwardedAuthRequest[] = [];
  socialFailure?: Error;
  readonly socialStarts: Array<
    Parameters<AuthAdapter["startSocial"]>[0]
  > = [];
  readonly socialProviders = ["discord", "twitter", "telegram"] as const;
  readonly sharedIdentityClientId = "pledge-cash-test";

  createWalletChallenge = async (input: {
    readonly address: AddressDto;
    readonly chainId: number;
  }) => ({
    address: input.address,
    chainId: input.chainId,
    domain: "pledge.cash",
    expirationTime: new Date(FIXED_NOW.getTime() + 10 * 60_000).toISOString(),
    issuedAt: FIXED_NOW.toISOString(),
    message: "Identity challenge",
    nonce: "0123456789abcdef",
    statement: WALLET_LINK_SIWE_STATEMENT,
    uri: WEB_ORIGIN,
    version: "1" as const
  });

  async getSocialProviders() {
    return this.socialProviders;
  }

  async hydrateAuthSnapshot(_userId: string, snapshot: AuthSnapshot) {
    return snapshot;
  }

  async getSession(input: { readonly headers: Headers }) {
    return input.headers.get("cookie")?.includes(SESSION_COOKIE) === true
      ? { user: { id: USER_ID } }
      : null;
  }

  async handler(request: Request): Promise<Response> {
    const bodyText = request.method === "GET" ? "" : await request.text();
    const body = bodyText.length === 0 ? null : (JSON.parse(bodyText) as unknown);
    const path = new URL(request.url).pathname;
    this.forwarded.push({ body, method: request.method, path });

    const headers = new Headers({ "Content-Type": "application/json" });
    if (path.endsWith("/siwe/verify")) {
      headers.set(
        "Set-Cookie",
        `${SESSION_COOKIE}; Path=/; HttpOnly; Secure; SameSite=Lax`
      );
    }

    return new Response(JSON.stringify({ forwarded: true, path }), { headers, status: 200 });
  }

  async linkWalletCredential(input: {
    readonly address: AddressDto;
    readonly verifiedAt: Date;
  }): Promise<WalletDto> {
    return {
      address: input.address,
      canSignIn: true,
      verifiedAt: input.verifiedAt.toISOString()
    };
  }

  startSocial = async (
    input: Parameters<AuthAdapter["startSocial"]>[0]
  ) => {
    if (this.socialFailure !== undefined) {
      throw this.socialFailure;
    }
    this.socialStarts.push(input);
    return {
      response: {
        redirect: true,
        url: `https://identity.example.test/${input.request.provider}`
      }
    };
  };
}

class InMemoryStore implements SentinelApiStore {
  readonly identityQuotaEvents = new Map<string, number[]>();
  pingCount = 0;
  providersByUser = new Map<
    string,
    Array<"apple" | "discord" | "github" | "siwe" | "telegram" | "twitter">
  >();
  walletsByUser = new Map<string, WalletDto[]>();

  async getAuthSnapshot(userId: string) {
    return {
      providers: this.providersByUser.get(userId) ?? [],
      wallets: this.walletsByUser.get(userId) ?? []
    };
  }

  async ping(): Promise<void> {
    this.pingCount += 1;
  }

  async takeIdentityQuota(input: {
    readonly capacity: number;
    readonly now: Date;
    readonly scope: string;
    readonly windowMs: number;
  }): Promise<boolean> {
    const windowStart = input.now.getTime() - input.windowMs;
    const events = (this.identityQuotaEvents.get(input.scope) ?? []).filter(
      (consumedAt) => consumedAt > windowStart
    );
    if (events.length >= input.capacity) {
      this.identityQuotaEvents.set(input.scope, events);
      return false;
    }
    events.push(input.now.getTime());
    this.identityQuotaEvents.set(input.scope, events);
    return true;
  }
}

function createHarness(
  options: {
    readonly rateLimit?: RateLimitConfig;
    readonly store?: InMemoryStore;
  } = {}
) {
  const auth = new StubAuth();
  const store = options.store ?? new InMemoryStore();
  const deps: SentinelApiDeps = {
    auth,
    config: {
      webOrigin: WEB_ORIGIN
    },
    now: () => FIXED_NOW,
    rateLimit: options.rateLimit ?? { capacity: 100 },
    store
  };

  return { app: createApp(deps), auth, store };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function authSiweRequest(statement = "Sign in to pledge.cash.") {
  const message = createSiweMessage({
    address: AUTH_ACCOUNT.address,
    chainId: 31337,
    domain: "pledge.cash",
    expirationTime: new Date(FIXED_NOW.getTime() + 5 * 60_000),
    issuedAt: FIXED_NOW,
    nonce: "0123456789abcdef",
    statement,
    uri: WEB_ORIGIN,
    version: "1"
  });
  return {
    chainId: 31337,
    message,
    signature: await AUTH_ACCOUNT.signMessage({ message }),
    walletAddress: AUTH_ACCOUNT.address
  };
}

async function signedInCookie(harness: ReturnType<typeof createHarness>): Promise<string> {
  const verify = await harness.app.request("/auth/siwe/verify", {
    body: JSON.stringify(await authSiweRequest()),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
  expect(verify.status).toBe(200);
  expect(verify.headers.get("set-cookie")).toContain(SESSION_COOKIE);
  return SESSION_COOKIE;
}

describe("PledgeCash identity API", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  test("reports health and credentialed CORS", async () => {
    const response = await harness.app.request("/health", {
      headers: { Origin: WEB_ORIGIN }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");

    const body = await readJson<HealthResponse>(response);
    expect(body).toEqual({ database: "ok", ok: true });
    expect(harness.store.pingCount).toBe(1);
  });

  test("reports auth capabilities and returns a wallet-first auth snapshot", async () => {
    const capabilities = await harness.app.request("/auth/capabilities");
    expect(capabilities.status).toBe(200);
    expect(
      await readJson<{
        socialProviders: string[];
        walletlessSocialSignIn: boolean;
      }>(capabilities)
    ).toEqual({
      socialProviders: ["discord", "twitter", "telegram"],
      walletlessSocialSignIn: true
    });

    harness.store.providersByUser.set(USER_ID, ["siwe", "github"]);
    harness.store.walletsByUser.set(USER_ID, [
      {
        address: PRIMARY_WALLET,
        canSignIn: true,
        verifiedAt: FIXED_NOW.toISOString()
      }
    ]);
    const cookie = await signedInCookie(harness);
    const me = await harness.app.request("/auth/me", { headers: { Cookie: cookie } });

    expect(me.status).toBe(200);
    const meBody = await readJson<AuthMeResponse>(me);
    expect(meBody).toEqual({
      providers: ["siwe", "github"],
      user: { id: USER_ID },
      wallets: [
        {
          address: PRIMARY_WALLET,
          canSignIn: true,
          verifiedAt: FIXED_NOW.toISOString()
        }
      ]
    });
    expect(meBody.user).not.toHaveProperty("email");
    expect(meBody.user).not.toHaveProperty("workosUserId");
  });

  test("keeps an existing product session readable when Identity metadata is unavailable", async () => {
    Object.assign(harness.auth, {
      hydrateAuthSnapshot: async () => {
        throw new Error("Identity unavailable");
      },
      getSocialProviders: async () => {
        throw new Error("Identity unavailable");
      }
    });
    harness.store.providersByUser.set(USER_ID, ["siwe"]);
    const cookie = await signedInCookie(harness);

    const capabilities = await harness.app.request("/auth/capabilities");
    expect(capabilities.status).toBe(200);
    expect(
      await readJson<{
        socialProviders: string[];
        walletlessSocialSignIn: boolean;
      }>(capabilities)
    ).toEqual({
      socialProviders: ["discord", "twitter", "telegram"],
      walletlessSocialSignIn: true
    });

    const me = await harness.app.request("/auth/me", {
      headers: { Cookie: cookie }
    });
    expect(me.status).toBe(200);
    expect(await readJson<AuthMeResponse>(me)).toMatchObject({
      providers: [],
      user: { id: USER_ID }
    });
  });

  test("uses shared Identity hydration and fails closed on wallet sign-in metadata", async () => {
    harness.store.providersByUser.set(USER_ID, ["siwe", "github"]);
    harness.store.walletsByUser.set(USER_ID, [
      {
        address: PRIMARY_WALLET,
        canSignIn: true,
        verifiedAt: FIXED_NOW.toISOString()
      }
    ]);
    Object.assign(harness.auth, {
      hydrateAuthSnapshot: async (
        _userId: string,
        snapshot: AuthSnapshot
      ): Promise<AuthSnapshot> => ({
        ...snapshot,
        providers: [],
        wallets: snapshot.wallets.map((wallet) => ({
          ...wallet,
          canSignIn: false
        }))
      })
    });
    const cookie = await signedInCookie(harness);

    const hydrated = await harness.app.request("/auth/me", {
      headers: { Cookie: cookie }
    });
    expect(await readJson<AuthMeResponse>(hydrated)).toMatchObject({
      providers: [],
      wallets: [{ canSignIn: false }]
    });
    Object.assign(harness.auth, {
      hydrateAuthSnapshot: async () => {
        throw new Error("Identity unavailable");
      }
    });
    const unavailable = await harness.app.request("/auth/me", {
      headers: { Cookie: cookie }
    });
    expect(await readJson<AuthMeResponse>(unavailable)).toMatchObject({
      providers: [],
      wallets: [{ canSignIn: false }]
    });
  });

  test("forwards SIWE and sign-out requests to the Better Auth handler", async () => {
    const nonceBody = { chainId: 31337, walletAddress: PRIMARY_WALLET };
    const nonce = await harness.app.request("/auth/siwe/nonce", {
      body: JSON.stringify(nonceBody),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const cookie = await signedInCookie(harness);
    const signOut = await harness.app.request("/auth/sign-out", {
      headers: { Cookie: cookie },
      method: "POST"
    });

    expect(nonce.status).toBe(200);
    expect(signOut.status).toBe(200);
    expect(harness.auth.forwarded).toEqual([
      { body: nonceBody, method: "POST", path: "/auth/siwe/nonce" },
      {
        body: await authSiweRequest(),
        method: "POST",
        path: "/auth/siwe/verify"
      },
      { body: null, method: "POST", path: "/auth/sign-out" }
    ]);
  });

  test("does not expose internal legacy Identity SIWE routes", async () => {
    const identityHarness = createHarness();
    const responses = await Promise.all([
      identityHarness.app.request("/auth/legacy/siwe/nonce", {
        body: "{}",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }),
      identityHarness.app.request("/auth/legacy/siwe/verify", {
        body: "{}",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      })
    ]);

    expect(responses.map((response) => response.status)).toEqual([404, 404]);
    expect(identityHarness.auth.forwarded).toEqual([]);
  });

  test("starts canonical social sign-in and linking routes", async () => {
    const identityHarness = createHarness();
    const capabilities = await identityHarness.app.request(
      "/auth/capabilities"
    );
    expect(await capabilities.json()).toMatchObject({
      walletlessSocialSignIn: true
    });
    const callbackURL = `${WEB_ORIGIN}/account`;
    const requests = [
      {
        body: { callbackURL, provider: "github" },
        path: "/auth/peezy/sign-in"
      },
      {
        body: { callbackURL, provider: "telegram" },
        path: "/auth/peezy/link",
        session: true
      }
    ] as const;

    for (const request of requests) {
      const response = await identityHarness.app.request(
        request.path,
        {
          body: JSON.stringify(request.body),
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": "192.0.2.250",
            ...(request.session ? { Cookie: SESSION_COOKIE } : {})
          },
          method: "POST"
        },
        { clientIp: "198.51.100.7" }
      );
      expect(response.status).toBe(200);
    }

    expect(
      identityHarness.auth.socialStarts.map(
        ({ clientIp, link, request, userId }) => ({
          clientIp,
          link,
          provider: request.provider,
          userId
        })
      )
    ).toEqual([
      {
        clientIp: "198.51.100.7",
        link: false,
        provider: "github",
        userId: undefined
      },
      {
        clientIp: "198.51.100.7",
        link: true,
        provider: "telegram",
        userId: USER_ID
      }
    ]);
  });

  test("does not advertise walletless sign-in without a shared social provider", async () => {
    for (const getSocialProviders of [
      async () => [],
      async () => {
        throw new Error("Identity unavailable");
      }
    ]) {
      const identityHarness = createHarness();
      Object.assign(identityHarness.auth, {
        getSocialProviders,
        socialProviders: []
      });

      const capabilities = await identityHarness.app.request(
        "/auth/capabilities"
      );
      expect(await capabilities.json()).toEqual({
        socialProviders: [],
        walletlessSocialSignIn: false
      });
    }
  });

  test("preserves retryable social-auth dependency statuses", async () => {
    for (const expected of [
      {
        error: new AuthSocialDependencyError(429, "17"),
        message: "Too many social authentication attempts",
        retryAfter: "17",
        status: 429
      },
      {
        error: new AuthSocialDependencyError(500),
        message: "Social authentication is temporarily unavailable",
        retryAfter: null,
        status: 503
      }
    ] as const) {
      const identityHarness = createHarness();
      identityHarness.auth.socialFailure = expected.error;

      const response = await identityHarness.app.request(
        "/auth/peezy/sign-in",
        {
          body: JSON.stringify({
            callbackURL: `${WEB_ORIGIN}/account`,
            provider: "github"
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST"
        }
      );

      expect(response.status).toBe(expected.status);
      expect(response.headers.get("Retry-After")).toBe(expected.retryAfter);
      expect(await response.json()).toEqual({
        error: { message: expected.message }
      });
    }
  });

  test("rejects oversized social-auth request bodies before parsing them", async () => {
    const identityHarness = createHarness();
    const oversizedPadding = "a".repeat(129 * 1024);
    const requests = [
      {
        body: {
          callbackURL: `${WEB_ORIGIN}/account`,
          padding: oversizedPadding,
          provider: "github"
        },
        path: "/auth/peezy/sign-in"
      },
      {
        body: {
          callbackURL: `${WEB_ORIGIN}/account`,
          padding: oversizedPadding,
          provider: "github"
        },
        path: "/auth/peezy/link",
        session: true
      }
    ] as const;

    for (const request of requests) {
      const response = await identityHarness.app.request(request.path, {
        body: JSON.stringify(request.body),
        headers: {
          "Content-Type": "application/json",
          ...(request.session ? { Cookie: SESSION_COOKIE } : {})
        },
        method: "POST"
      });
      expect(response.status).toBe(413);
    }
    expect(identityHarness.auth.socialStarts).toEqual([]);
  });

  test("rejects invalid EOA SIWE proofs before forwarding them", async () => {
    const identityHarness = createHarness();
    const request = await authSiweRequest();
    const statuses: number[] = [];
    for (const signature of [
      `0x${"ab".repeat(65)}`,
      `0x${"ab".repeat(66)}`
    ]) {
      const response = await identityHarness.app.request("/auth/peezy/siwe/verify", {
        body: JSON.stringify({ ...request, signature }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      statuses.push(response.status);
    }

    expect(statuses).toEqual([401, 401]);
    expect(identityHarness.auth.forwarded).toEqual([]);
  });

  test("rate limits malformed SIWE bodies before parsing them", async () => {
    const identityHarness = createHarness();
    const clientAddress = "192.0.2.1";
    const malformed = await identityHarness.app.request("/auth/peezy/siwe/verify", {
      body: "{",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": clientAddress
      },
      method: "POST"
    });
    expect(malformed.status).toBe(400);

    const request = await authSiweRequest();
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      const response = await identityHarness.app.request("/auth/peezy/siwe/verify", {
        body: JSON.stringify(request),
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": clientAddress
        },
        method: "POST"
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 9).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(9)).toEqual([429, 429]);
    expect(identityHarness.auth.forwarded).toHaveLength(9);
  });

  test("keeps public Identity challenge limits independent across resolved edge clients", async () => {
    const identityHarness = createHarness();
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      const response = await identityHarness.app.request(
        index % 2 === 0
          ? "/auth/peezy/siwe/nonce"
          : "/auth/siwe/nonce",
        {
          body: JSON.stringify({
            chainId: 31337,
            walletAddress: PRIMARY_WALLET
          }),
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": `192.0.2.${index + 1}`
          },
          method: "POST"
        },
        { clientIp: `192.0.2.${index + 1}` }
      );
      statuses.push(response.status);
    }

    expect(statuses.every((status) => status === 200)).toBe(true);
    expect(identityHarness.auth.forwarded).toHaveLength(11);
  });

  test("rejects oversized public SIWE requests before parsing or quota work", async () => {
    const identityHarness = createHarness();
    const request = await authSiweRequest();
    const requests = [
      {
        body: JSON.stringify({
          ...request,
          message: "a".repeat(129 * 1024)
        }),
        path: "/auth/peezy/siwe/verify"
      },
      {
        body: JSON.stringify({
          chainId: 31337,
          padding: "a".repeat(129 * 1024),
          walletAddress: PRIMARY_WALLET
        }),
        path: "/auth/peezy/siwe/nonce"
      },
      {
        body: JSON.stringify({
          chainId: 31337,
          padding: "a".repeat(129 * 1024),
          walletAddress: PRIMARY_WALLET
        }),
        path: "/auth/siwe/nonce"
      }
    ] as const;

    for (const request of requests) {
      const response = await identityHarness.app.request(request.path, {
        body: request.body,
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      expect(response.status).toBe(413);
    }
    expect(identityHarness.store.identityQuotaEvents.size).toBe(0);
    expect(identityHarness.auth.forwarded).toEqual([]);
  });

  test("rate limits invalid signatures before signature recovery", async () => {
    const identityHarness = createHarness();
    const request = await authSiweRequest();
    const statuses: number[] = [];
    for (let index = 0; index < 51; index += 1) {
      const response = await identityHarness.app.request("/auth/peezy/siwe/verify", {
        body: JSON.stringify({
          ...request,
          signature: `0x${"ab".repeat(66)}`
        }),
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": `203.0.113.${index + 1}, 192.0.2.1`
        },
        method: "POST"
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(10).every((status) => status === 429)).toBe(true);
    expect(identityHarness.auth.forwarded).toEqual([]);
    expect(
      identityHarness.store.identityQuotaEvents.get(
        "pledge-cash-test:wallet-grant-public"
      )
    ).toBeUndefined();

    const valid = await identityHarness.app.request("/auth/peezy/siwe/verify", {
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "192.0.2.1"
      },
      method: "POST"
    });
    expect(valid.status).toBe(429);
    expect(identityHarness.auth.forwarded).toEqual([]);
  });

  test("globally rate limits SIWE attempts before JSON parsing", async () => {
    const identityHarness = createHarness();
    const statuses: number[] = [];
    for (let index = 0; index < 301; index += 1) {
      const response = await identityHarness.app.request(
        "/auth/peezy/siwe/verify",
        {
          body: "{",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": `192.0.2.${index + 1}`
          },
          method: "POST"
        },
        { clientIp: `198.51.100.${index + 1}` }
      );
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 300).every((status) => status === 400)).toBe(true);
    expect(statuses[300]).toBe(429);
    expect(
      identityHarness.store.identityQuotaEvents.get(
        "pledge-cash-test:wallet-proof-public"
      )
    ).toHaveLength(300);
    expect(identityHarness.auth.forwarded).toEqual([]);
  });

  test("reserves shared Identity wallet-grant quota from anonymous traffic", async () => {
    const store = new InMemoryStore();
    const identityHarnesses = [
      createHarness({ store }),
      createHarness({ store })
    ] as const;
    const request = await authSiweRequest();
    const statuses: number[] = [];
    for (let index = 0; index < 51; index += 1) {
      const harness = identityHarnesses[index % identityHarnesses.length]!;
      const response = await harness.app.request(
        "/auth/peezy/siwe/verify",
        {
          body: JSON.stringify(request),
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": `192.0.2.${index + 1}`
          },
          method: "POST"
        },
        { clientIp: `198.51.100.${index + 1}` }
      );
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 50).every((status) => status === 200)).toBe(true);
    expect(statuses[50]).toBe(429);
    expect(
      identityHarnesses.reduce(
        (total, harness) => total + harness.auth.forwarded.length,
        0
      )
    ).toBe(50);
  });

  test("ignores every caller-controlled forwarding address for client quota", async () => {
    const identityHarness = createHarness();
    const request = await authSiweRequest();
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      const response = await identityHarness.app.request(
        "/auth/peezy/siwe/verify",
        {
          body: JSON.stringify(request),
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": `203.0.113.${index + 1}, 192.0.2.1`
          },
          method: "POST"
        },
        { clientIp: "198.51.100.1" }
      );
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(identityHarness.auth.forwarded).toHaveLength(10);
  });

  test("caller-controlled addresses cannot create fresh rate-limit buckets", async () => {
    const boundedHarness = createHarness({
      rateLimit: {
        capacity: 1,
        maxBuckets: 2,
        refillMs: 5 * 60_000
      }
    });
    const statuses: number[] = [];
    for (const address of ["192.0.2.1", "192.0.2.2", "192.0.2.3", "192.0.2.1"]) {
      const response = await boundedHarness.app.request("/wallets/nonce", {
        body: "{}",
        headers: {
          "Content-Type": "application/json",
          Cookie: SESSION_COOKIE,
          "X-Forwarded-For": address
        },
        method: "POST"
      });
      statuses.push(response.status);
    }

    expect(statuses).toEqual([400, 429, 429, 429]);
  });

  test("reserves ten shared Identity grants for authenticated wallet links", async () => {
    const store = new InMemoryStore();
    const identityHarnesses = [
      createHarness({ store }),
      createHarness({ store })
    ] as const;
    let linkCalls = 0;
    const linkWalletCredential = async (
        input: Parameters<AuthAdapter["linkWalletCredential"]>[0]
      ): Promise<WalletDto> => {
        const admitted = await store.takeIdentityQuota({
          capacity: 10,
          now: input.verifiedAt,
          scope: "pledge-cash-test:wallet-grant-link",
          windowMs: 5 * 60_000
        });
        if (!admitted) {
          throw new AuthRateLimitError();
        }
        linkCalls += 1;
        return {
          address: input.address,
          canSignIn: true,
          verifiedAt: input.verifiedAt.toISOString()
        };
      };
    for (const harness of identityHarnesses) {
      Object.assign(harness.auth, { linkWalletCredential });
    }
    const request = await authSiweRequest(WALLET_LINK_SIWE_STATEMENT);
    const invalidStatuses: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      const harness = identityHarnesses[index % identityHarnesses.length]!;
      const response = await harness.app.request("/wallets", {
        body: JSON.stringify({
          message: request.message,
          signature: `0x${"ab".repeat(65)}`
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: SESSION_COOKIE,
          "X-Forwarded-For": `203.0.113.${index + 1}`
        },
        method: "POST"
      });
      invalidStatuses.push(response.status);
    }
    expect(invalidStatuses.every((status) => status === 400)).toBe(true);

    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      const harness = identityHarnesses[index % identityHarnesses.length]!;
      const response = await harness.app.request("/wallets", {
        body: JSON.stringify({
          message: request.message,
          signature: request.signature
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: SESSION_COOKIE,
          "X-Forwarded-For": `198.51.100.${index + 1}`
        },
        method: "POST"
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(linkCalls).toBe(10);
  });

  test("reports an anonymous session and protects wallet-link routes", async () => {
    const me = await harness.app.request("/auth/me");
    expect(me.status).toBe(200);
    expect(await readJson<null>(me)).toBeNull();

    const response = await harness.app.request("/wallets/nonce", { method: "POST" });
    expect(response.status).toBe(401);
    expect(await readJson<{ error: { message: string } }>(response)).toEqual({
      error: { message: "Authentication required" }
    });
  });

  test("returns Identity's exact wallet-link challenge", async () => {
    const identityHarness = createHarness();
    const cookie = await signedInCookie(identityHarness);
    let challengeClientIp: string | undefined;
    const address = "0x8ba1f109551bd432803012645ac136ddd64dba72";
    const checksumAddress = getAddress(address);
    const issuedAt = FIXED_NOW;
    const expirationTime = new Date(FIXED_NOW.getTime() + 10 * 60_000);
    const challenge = {
      address,
      chainId: 1,
      domain: "pledge.cash",
      expirationTime: expirationTime.toISOString(),
      issuedAt: issuedAt.toISOString(),
      nonce: "0123456789abcdef",
      statement: WALLET_LINK_SIWE_STATEMENT,
      uri: WEB_ORIGIN,
      version: "1" as const
    };
    const message = createSiweMessage({
      ...challenge,
      address: checksumAddress,
      expirationTime,
      issuedAt
    });
    Object.assign(identityHarness.auth, {
      createWalletChallenge: async (input: { clientIp?: string }) => {
        challengeClientIp = input.clientIp;
        return { ...challenge, message };
      }
    });

    const response = await identityHarness.app.request(
      "/wallets/nonce",
      {
        body: JSON.stringify({ address, chainId: 1 }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "POST"
      },
      { clientIp: "198.51.100.8" }
    );

    expect(response.status).toBe(200);
    expect(challengeClientIp).toBe("198.51.100.8");
    const returned = await readJson<WalletNonceResponse>(response);
    expect(returned.address).toBe(address);
    expect(returned.message).toBe(message);
  });

  test("rejects oversized wallet-link messages and request bodies before linking", async () => {
    const identityHarness = createHarness();
    let linkCalls = 0;
    Object.assign(identityHarness.auth, {
      linkWalletCredential: async () => {
        linkCalls += 1;
        throw new Error("unexpected wallet link");
      }
    });

    const overlongMessage = await identityHarness.app.request("/wallets", {
      body: JSON.stringify({
        message: "a".repeat(AUTH_SIWE_MAX_MESSAGE_LENGTH + 1),
        signature: "0x"
      }),
      headers: { "Content-Type": "application/json", Cookie: SESSION_COOKIE },
      method: "POST"
    });
    const oversizedBody = await identityHarness.app.request("/wallets", {
      body: JSON.stringify({
        message: "a".repeat(AUTH_SIWE_MAX_MESSAGE_LENGTH * 2),
        signature: "0x"
      }),
      headers: { "Content-Type": "application/json", Cookie: SESSION_COOKIE },
      method: "POST"
    });

    expect(overlongMessage.status).toBe(400);
    expect(oversizedBody.status).toBe(413);
    expect(linkCalls).toBe(0);
  });

  test("reports wallet-link dependency failures as retryable", async () => {
    const identityHarness = createHarness();
    Object.assign(identityHarness.auth, {
      linkWalletCredential: async () => {
        throw new Error("Identity request timed out after 2000ms");
      }
    });
    const request = await authSiweRequest(WALLET_LINK_SIWE_STATEMENT);

    const response = await identityHarness.app.request("/wallets", {
      body: JSON.stringify({
        message: request.message,
        signature: request.signature
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: SESSION_COOKIE
      },
      method: "POST"
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { message: "Wallet linking is temporarily unavailable" }
    });
  });

  test("rejects non-link SIWE messages before delegated wallet linking", async () => {
    const identityHarness = createHarness();
    let linkCalls = 0;
    Object.assign(identityHarness.auth, {
      linkWalletCredential: async () => {
        linkCalls += 1;
        throw new Error("unexpected wallet link");
      }
    });
    const request = await authSiweRequest();

    const response = await identityHarness.app.request("/wallets", {
      body: JSON.stringify({
        message: request.message,
        signature: request.signature
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: SESSION_COOKIE
      },
      method: "POST"
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        message: "SIWE statement is not valid for wallet linking"
      }
    });
    expect(linkCalls).toBe(0);
  });

  test("does not expose deleted surveillance and fanout routes", async () => {
    const responses = await Promise.all([
      harness.app.request("/boardroom-control/challenges", { method: "POST" }),
      harness.app.request("/subscriptions"),
      harness.app.request("/channels"),
      harness.app.request("/notifications"),
      harness.app.request("/public/actions")
    ]);
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);
  });
});
