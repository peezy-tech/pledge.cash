import { beforeEach, describe, expect, test } from "bun:test";
import { getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

import {
  AuthRateLimitError,
  type AuthAdapter,
  type AuthSnapshot,
  type RateLimitConfig,
  type WalletNonceRecord
} from "../src/api/auth";
import { createApp, type SentinelApiDeps, type SentinelApiStore } from "../src/api/server";
import type {
  AddressDto,
  AuthMeResponse,
  BoardroomRef,
  ChannelDto,
  HealthResponse,
  NotificationDeliveriesQuery,
  NotificationDeliveriesResponse,
  NotificationDeliveryDto,
  PublicActionDto,
  PublicActionsQuery,
  PublicActionsResponse,
  SubscriptionDto,
  TelegramLinkCodeResponse,
  WalletDto,
  WalletNonceResponse
} from "../src/api/dto";
import { AUTH_SIWE_MAX_MESSAGE_LENGTH } from "../src/api/dto";

const WEB_ORIGIN = "https://pledge.cash";
const FIXED_NOW = new Date("2026-07-09T12:00:00.000Z");
const USER_ID = "00000000-0000-4000-8000-000000000001";
const CHANNEL_ID = "00000000-0000-4000-8000-000000000002";
const ACTION_ID = "00000000-0000-4000-8000-000000000003";
const SESSION_COOKIE = "better-auth.session_token=stub-session";
const PRIMARY_WALLET = "0x5555555555555555555555555555555555555555" as AddressDto;
const AUTH_ACCOUNT = privateKeyToAccount(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
);
const BOARDROOM = "0x1111111111111111111111111111111111111111" as AddressDto;
const SHARE_TOKEN = "0x2222222222222222222222222222222222222222" as AddressDto;
const POLICY = "0x3333333333333333333333333333333333333333" as AddressDto;
const TARGET = "0x4444444444444444444444444444444444444444" as AddressDto;

type ForwardedAuthRequest = {
  readonly body: unknown;
  readonly method: string;
  readonly path: string;
};

class StubAuth implements AuthAdapter {
  readonly forwarded: ForwardedAuthRequest[] = [];
  readonly socialStarts: Array<
    Parameters<NonNullable<AuthAdapter["startSocial"]>>[0]
  > = [];
  readonly socialProviders = ["discord", "twitter", "telegram"] as const;

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

  startSocial = async (
    input: Parameters<NonNullable<AuthAdapter["startSocial"]>>[0]
  ) => {
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
  deliveriesByUser = new Map<string, NotificationDeliveryDto[]>();
  readonly linkCodes = new Map<string, { expiresAt: Date; userId: string }>();
  readonly nonces = new Map<string, WalletNonceRecord>();
  readonly identityQuotaEvents = new Map<string, number[]>();
  channelsByUser = new Map<string, ChannelDto[]>();
  conflictedWallets = new Set<AddressDto>();
  lastPublicQuery: PublicActionsQuery | undefined;
  lastNotificationDeliveriesInput:
    | { readonly query: NotificationDeliveriesQuery; readonly userId: string }
    | undefined;
  lastLinkedWalletInput:
    | {
        readonly address: AddressDto;
        readonly chainId: number;
        readonly userId: string;
      }
    | undefined;
  pingCount = 0;
  providersByUser = new Map<
    string,
    Array<"apple" | "discord" | "github" | "siwe" | "telegram" | "twitter">
  >();
  subscriptionsByUser = new Map<string, SubscriptionDto>();
  walletsByUser = new Map<string, WalletDto[]>();

  actions: PublicActionDto[] = [
    {
      operationId: `0x${"ab".repeat(32)}`,
      analysis: {
        affectedParties: ["shareholders"],
        effects: ["controller configuration changes"],
        harness: "template",
        model: null,
        severityRationale: "Executor authority changes are high impact.",
        source: "template",
        summary: "Scheduled controller configuration."
      },
      boardroomEpoch: "1",
      boardroom: {
        address: BOARDROOM,
        name: "Sentinel Test Boardroom",
        shareToken: SHARE_TOKEN,
        status: "active"
      },
      calls: [
        {
          callIndex: 0,
          data: "0x12345678",
          decodedArgs: null,
          decodedFunction: "updateConfiguration",
          policy: POLICY,
          selector: "0x12345678",
          target: TARGET,
          value: "0"
        }
      ],
      chainId: 31337,
      configurationEpoch: "1",
      controller: TARGET,
      controllerGeneration: "1",
      decodeStatus: "decoded",
      eta: new Date(FIXED_NOW.getTime() + 86_400_000).toISOString(),
      event: "scheduled",
      expiresAt: new Date(FIXED_NOW.getTime() + 8 * 86_400_000).toISOString(),
      id: ACTION_ID,
      invalidatedByEpoch: null,
      operationKind: "controller",
      proposer: POLICY,
      scheduleBlock: "123",
      scheduleTxHash: `0x${"cd".repeat(32)}`,
      risk: {
        evaluatedAt: FIXED_NOW.toISOString(),
        findings: [
          {
            callIndex: 0,
            detail: "Executor update can redirect queue authority; ready execution remains permissionless.",
            ruleId: "controller-configuration",
            severity: "high"
          }
        ],
        rulesetVersion: 1,
        severity: "high"
      },
      status: "scheduled"
    }
  ];

  async consumeWalletNonce(input: {
    readonly nonce: string;
    readonly now: Date;
    readonly userId: string;
  }): Promise<boolean> {
    const nonce = this.nonces.get(input.nonce);
    if (nonce === undefined || nonce.userId !== input.userId || nonce.usedAt !== null) {
      return false;
    }

    this.nonces.set(input.nonce, { ...nonce, usedAt: input.now });
    return true;
  }

  async createTelegramLinkCode(input: {
    readonly code: string;
    readonly expiresAt: Date;
    readonly userId: string;
  }) {
    this.linkCodes.set(input.code, { expiresAt: input.expiresAt, userId: input.userId });
    return { code: input.code, expiresAt: input.expiresAt };
  }

  async createWalletNonce(input: {
    readonly expiresAt: Date;
    readonly nonce: string;
    readonly userId: string;
  }): Promise<WalletNonceRecord> {
    const record = { expiresAt: input.expiresAt, nonce: input.nonce, usedAt: null, userId: input.userId };
    this.nonces.set(input.nonce, record);
    return record;
  }

  async deleteChannel(input: { readonly id: string; readonly userId: string }): Promise<boolean> {
    const channels = this.channelsByUser.get(input.userId) ?? [];
    const nextChannels = channels.filter((channel) => channel.id !== input.id);
    this.channelsByUser.set(input.userId, nextChannels);
    return nextChannels.length !== channels.length;
  }

  async getAuthSnapshot(userId: string) {
    return {
      channels: await this.getChannels(userId),
      providers: this.providersByUser.get(userId) ?? [],
      subscription: await this.getSubscription(userId),
      wallets: this.walletsByUser.get(userId) ?? []
    };
  }

  async getChannels(userId: string): Promise<ChannelDto[]> {
    return this.channelsByUser.get(userId) ?? [];
  }

  async getCursorLags(chainIds: readonly number[]): Promise<HealthResponse["chains"]> {
    return chainIds.map((chainId) => ({
      chainId,
      factoryDiscoveryBlock: "100",
      governanceBlock: "110",
      lagBlocks: "3",
      shareTransfersBlock: "105"
    }));
  }

  async getNotificationDeliveries(
    userId: string,
    query: NotificationDeliveriesQuery
  ): Promise<NotificationDeliveriesResponse> {
    this.lastNotificationDeliveriesInput = { query, userId };
    const items = (this.deliveriesByUser.get(userId) ?? []).slice(0, query.limit);
    return { items, page: { limit: query.limit, nextCursor: null } };
  }

  async getPublicActions(query: PublicActionsQuery): Promise<PublicActionsResponse> {
    this.lastPublicQuery = query;
    const minimumSeverity = query.minSeverity;
    const severityRank = { high: 2, low: 0, medium: 1 } as const;
    const items = this.actions.filter((action) => {
      if (query.chainId !== undefined && action.chainId !== query.chainId) {
        return false;
      }

      if (query.boardroom !== undefined && action.boardroom.address !== query.boardroom) {
        return false;
      }

      if (query.status !== undefined && action.status !== query.status) {
        return false;
      }

      if (
        minimumSeverity !== undefined &&
        (action.risk === null ||
          severityRank[action.risk.severity] < severityRank[minimumSeverity])
      ) {
        return false;
      }

      return true;
    });

    return { items: items.slice(0, query.limit), page: { limit: query.limit, nextCursor: null } };
  }

  async getSubscription(userId: string): Promise<SubscriptionDto> {
    return this.subscriptionsByUser.get(userId) ?? { boardrooms: [], minSeverity: "medium", mode: "holdings" };
  }

  async getWalletNonce(nonce: string): Promise<WalletNonceRecord | null> {
    return this.nonces.get(nonce) ?? null;
  }

  async linkWallet(input: {
    readonly address: AddressDto;
    readonly chainId: number;
    readonly siweMessage: string;
    readonly userId: string;
    readonly verifiedAt: Date;
  }): Promise<WalletDto | null> {
    expect(input.siweMessage.toLowerCase()).toContain(input.address.slice(2));
    this.lastLinkedWalletInput = {
      address: input.address,
      chainId: input.chainId,
      userId: input.userId
    };
    if (this.conflictedWallets.has(input.address)) {
      return null;
    }

    const wallet = {
      alertsEnabled: true,
      address: input.address,
      canSignIn: true as const,
      verifiedAt: input.verifiedAt.toISOString()
    };
    const wallets = this.walletsByUser.get(input.userId) ?? [];
    this.walletsByUser.set(input.userId, [
      ...wallets.filter((existing) => existing.address !== input.address),
      wallet
    ]);
    return wallet;
  }

  async ping(): Promise<void> {
    this.pingCount += 1;
  }

  async putSubscription(input: {
    readonly boardrooms: readonly BoardroomRef[];
    readonly minSeverity: SubscriptionDto["minSeverity"];
    readonly mode: SubscriptionDto["mode"];
    readonly userId: string;
  }): Promise<SubscriptionDto> {
    const subscription = {
      boardrooms: [...input.boardrooms],
      minSeverity: input.minSeverity,
      mode: input.mode
    };
    this.subscriptionsByUser.set(input.userId, subscription);
    return subscription;
  }

  async setWalletAlerts(input: {
    readonly address: AddressDto;
    readonly alertsEnabled: boolean;
    readonly userId: string;
  }) {
    const wallets = this.walletsByUser.get(input.userId) ?? [];
    const matches = wallets.filter((wallet) => wallet.address === input.address);
    if (matches.length === 0) {
      return null;
    }

    const nextWallets = wallets.map((wallet) =>
      wallet.address === input.address ? { ...wallet, alertsEnabled: input.alertsEnabled } : wallet
    );
    this.walletsByUser.set(input.userId, nextWallets);
    return nextWallets.find((wallet) => wallet.address === input.address) ?? null;
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
    readonly sharedIdentity?: boolean;
    readonly store?: InMemoryStore;
  } = {}
) {
  const auth = new StubAuth();
  if (options.sharedIdentity === true) {
    Object.assign(auth, {
      sharedIdentityClientId: "pledge-cash-test",
      usesSharedIdentity: true
    });
  }
  const store = options.store ?? new InMemoryStore();
  let nonceSequence = 0;
  const deps: SentinelApiDeps = {
    auth,
    config: {
      chains: [{ chainId: 31337 }],
      telegram: { botUsername: "PledgeCashBot" },
      webOrigin: WEB_ORIGIN
    },
    generateLinkCode: () => "ABC123",
    generateNonce: () => {
      nonceSequence += 1;
      return `nonce${nonceSequence.toString().padStart(4, "0")}`;
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

async function authSiweRequest() {
  const message = createSiweMessage({
    address: AUTH_ACCOUNT.address,
    chainId: 31337,
    domain: "pledge.cash",
    expirationTime: new Date(FIXED_NOW.getTime() + 5 * 60_000),
    issuedAt: FIXED_NOW,
    nonce: "0123456789abcdef",
    statement: "Sign in to pledge.cash.",
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

describe("Sentinel WP5 API", () => {
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
    expect(body).toEqual({
      chains: [
        {
          chainId: 31337,
          factoryDiscoveryBlock: "100",
          governanceBlock: "110",
          lagBlocks: "3",
          shareTransfersBlock: "105"
        }
      ],
      database: "ok",
      ok: true
    });
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
      walletlessSocialSignIn: false
    });

    harness.store.providersByUser.set(USER_ID, ["siwe", "github"]);
    harness.store.walletsByUser.set(USER_ID, [
      {
        alertsEnabled: true,
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
      channels: [],
      providers: ["siwe", "github"],
      subscription: { boardrooms: [], minSeverity: "medium", mode: "holdings" },
      user: { id: USER_ID },
      wallets: [
        {
          alertsEnabled: true,
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
      getProviders: async () => {
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
      walletlessSocialSignIn: false
    });

    const me = await harness.app.request("/auth/me", {
      headers: { Cookie: cookie }
    });
    expect(me.status).toBe(200);
    expect(await readJson<AuthMeResponse>(me)).toMatchObject({
      providers: ["siwe"],
      user: { id: USER_ID }
    });
  });

  test("uses shared Identity hydration and fails closed on wallet sign-in metadata", async () => {
    harness.store.providersByUser.set(USER_ID, ["siwe", "github"]);
    harness.store.walletsByUser.set(USER_ID, [
      {
        alertsEnabled: true,
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
      }),
      hydrateWallet: async (_userId: string, wallet: WalletDto) => ({
        ...wallet,
        canSignIn: false
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
    const updated = await harness.app.request(`/wallets/${PRIMARY_WALLET}`, {
      body: JSON.stringify({ alertsEnabled: false }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie
      },
      method: "PATCH"
    });
    expect(await readJson<{ wallet: WalletDto }>(updated)).toMatchObject({
      wallet: { alertsEnabled: false, canSignIn: false }
    });

    Object.assign(harness.auth, {
      hydrateAuthSnapshot: async () => {
        throw new Error("Identity unavailable");
      },
      hydrateWallet: async () => {
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
    const unavailableUpdate = await harness.app.request(
      `/wallets/${PRIMARY_WALLET}`,
      {
        body: JSON.stringify({ alertsEnabled: true }),
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie
        },
        method: "PATCH"
      }
    );
    expect(
      await readJson<{ wallet: WalletDto }>(unavailableUpdate)
    ).toMatchObject({
      wallet: { alertsEnabled: true, canSignIn: false }
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

  test("keeps the previous social-auth routes compatible in shared Identity mode", async () => {
    const identityHarness = createHarness({ sharedIdentity: true });
    const capabilities = await identityHarness.app.request(
      "/auth/capabilities"
    );
    expect(await capabilities.json()).toMatchObject({
      walletlessSocialSignIn: true
    });
    const callbackURL = `${WEB_ORIGIN}/notifications`;
    const requests = [
      {
        body: { callbackURL, provider: "github" },
        path: "/auth/sign-in/social"
      },
      {
        body: { callbackURL, providerId: "telegram" },
        path: "/auth/sign-in/oauth2"
      },
      {
        body: { callbackURL, provider: "github" },
        path: "/auth/link-social",
        session: true
      },
      {
        body: { callbackURL, providerId: "telegram" },
        path: "/auth/oauth2/link",
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
        link: false,
        provider: "telegram",
        userId: undefined
      },
      {
        clientIp: "198.51.100.7",
        link: true,
        provider: "github",
        userId: USER_ID
      },
      {
        clientIp: "198.51.100.7",
        link: true,
        provider: "telegram",
        userId: USER_ID
      }
    ]);
  });

  test("rejects oversized social-auth request bodies before parsing them", async () => {
    const identityHarness = createHarness({ sharedIdentity: true });
    const oversizedPadding = "a".repeat(129 * 1024);
    const requests = [
      {
        body: {
          callbackURL: `${WEB_ORIGIN}/notifications`,
          padding: oversizedPadding,
          provider: "github"
        },
        path: "/auth/peezy/sign-in"
      },
      {
        body: {
          callbackURL: `${WEB_ORIGIN}/notifications`,
          padding: oversizedPadding,
          provider: "github"
        },
        path: "/auth/peezy/link",
        session: true
      },
      {
        body: {
          callbackURL: `${WEB_ORIGIN}/notifications`,
          padding: oversizedPadding,
          provider: "github"
        },
        path: "/auth/sign-in/social"
      },
      {
        body: {
          callbackURL: `${WEB_ORIGIN}/notifications`,
          padding: oversizedPadding,
          provider: "github"
        },
        path: "/auth/link-social",
        session: true
      },
      {
        body: {
          callbackURL: `${WEB_ORIGIN}/notifications`,
          padding: oversizedPadding,
          providerId: "telegram"
        },
        path: "/auth/sign-in/oauth2"
      },
      {
        body: {
          callbackURL: `${WEB_ORIGIN}/notifications`,
          padding: oversizedPadding,
          providerId: "telegram"
        },
        path: "/auth/oauth2/link",
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
    const identityHarness = createHarness({ sharedIdentity: true });
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
    const identityHarness = createHarness({ sharedIdentity: true });
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
    const identityHarness = createHarness({ sharedIdentity: true });
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
    const identityHarness = createHarness({ sharedIdentity: true });
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
    const identityHarness = createHarness({ sharedIdentity: true });
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
    const identityHarness = createHarness({ sharedIdentity: true });
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
      createHarness({ sharedIdentity: true, store }),
      createHarness({ sharedIdentity: true, store })
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
    const identityHarness = createHarness({ sharedIdentity: true });
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

  test("does not apply shared Identity quotas when shared Identity is disabled", async () => {
    const request = await authSiweRequest();
    const statuses = await Promise.all(
      Array.from({ length: 51 }, async () => {
        const response = await harness.app.request("/auth/siwe/verify", {
          body: JSON.stringify(request),
          headers: { "Content-Type": "application/json" },
          method: "POST"
        });
        return response.status;
      })
    );

    expect(statuses.every((status) => status === 200)).toBe(true);
    expect(harness.auth.forwarded).toHaveLength(51);
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

    expect(statuses).toEqual([200, 429, 429, 429]);
  });

  test("reserves ten shared Identity grants for authenticated wallet links", async () => {
    const store = new InMemoryStore();
    const identityHarnesses = [
      createHarness({ sharedIdentity: true, store }),
      createHarness({ sharedIdentity: true, store })
    ] as const;
    let linkCalls = 0;
    const linkWalletCredential = async (
        input: Parameters<NonNullable<AuthAdapter["linkWalletCredential"]>>[0]
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
          alertsEnabled: true,
          canSignIn: true,
          verifiedAt: input.verifiedAt.toISOString()
        };
      };
    for (const harness of identityHarnesses) {
      Object.assign(harness.auth, { linkWalletCredential });
    }
    const request = await authSiweRequest();
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

  test("reports an anonymous session without noisy errors and protects account routes", async () => {
    const me = await harness.app.request("/auth/me");
    expect(me.status).toBe(200);
    expect(await readJson<null>(me)).toBeNull();

    const requests = [
      harness.app.request("/wallets/nonce", { method: "POST" }),
      harness.app.request("/subscriptions"),
      harness.app.request("/channels"),
      harness.app.request("/notifications")
    ];

    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(401);
      expect(await readJson<{ error: { message: string } }>(response)).toEqual({
        error: { message: "Authentication required" }
      });
    }
  });

  test("preserves Identity's checksum address for pre-rollout wallet-link clients", async () => {
    const identityHarness = createHarness({ sharedIdentity: true });
    const cookie = await signedInCookie(identityHarness);
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
      statement: "Link this wallet to pledge.cash Sentinel notifications.",
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
      createWalletChallenge: async () => ({ ...challenge, message })
    });

    const response = await identityHarness.app.request("/wallets/nonce", {
      body: JSON.stringify({ address, chainId: 1 }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST"
    });

    expect(response.status).toBe(200);
    const returned = await readJson<WalletNonceResponse>(response);
    expect(returned.address).toBe(checksumAddress);
    expect(
      createSiweMessage({
        address: returned.address as Address,
        chainId: returned.chainId!,
        domain: returned.domain,
        expirationTime: new Date(returned.expirationTime),
        issuedAt: new Date(returned.issuedAt),
        nonce: returned.nonce,
        statement: returned.statement,
        uri: returned.uri,
        version: returned.version
      })
    ).toBe(returned.message);
  });

  test("rejects oversized wallet-link messages and request bodies before linking", async () => {
    const identityHarness = createHarness({ sharedIdentity: true });
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
    const identityHarness = createHarness({ sharedIdentity: true });
    Object.assign(identityHarness.auth, {
      linkWalletCredential: async () => {
        throw new Error("Identity request timed out after 2000ms");
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

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { message: "Wallet linking is temporarily unavailable" }
    });
  });

  test("links equal wallet credentials and controls alert coverage with chain and conflict checks", async () => {
    const cookie = await signedInCookie(harness);
    harness.store.walletsByUser.set(USER_ID, [
      {
        alertsEnabled: true,
        address: PRIMARY_WALLET,
        canSignIn: true,
        verifiedAt: FIXED_NOW.toISOString()
      }
    ]);
    const account = privateKeyToAccount(
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );

    const nonceResponse = await harness.app.request("/wallets/nonce", {
      body: JSON.stringify({ address: account.address, chainId: 31337 }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST"
    });
    expect(nonceResponse.status).toBe(200);
    const nonce = await readJson<{
      address: AddressDto;
      chainId: number;
      domain: string;
      expirationTime: string;
      issuedAt: string;
      nonce: string;
      statement: string;
      uri: string;
      version: "1";
    }>(nonceResponse);
    expect(nonce).toMatchObject({
      address: account.address.toLowerCase(),
      chainId: 31337,
      domain: "pledge.cash",
      nonce: "nonce0001",
      uri: WEB_ORIGIN,
      version: "1"
    });

    const message = createSiweMessage({
      address: account.address,
      chainId: 31337,
      domain: nonce.domain,
      expirationTime: new Date(nonce.expirationTime),
      issuedAt: new Date(nonce.issuedAt),
      nonce: nonce.nonce,
      statement: nonce.statement,
      uri: nonce.uri,
      version: "1"
    });
    const signature = await account.signMessage({ message });

    const link = await harness.app.request("/wallets", {
      body: JSON.stringify({ message, signature }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST"
    });
    expect(link.status).toBe(200);
    const linked = await readJson<{ wallet: WalletDto }>(link);
    expect(linked.wallet).toEqual({
      alertsEnabled: true,
      address: account.address.toLowerCase(),
      canSignIn: true,
      verifiedAt: FIXED_NOW.toISOString()
    });
    expect(harness.store.lastLinkedWalletInput).toEqual({
      address: account.address.toLowerCase(),
      chainId: 31337,
      userId: USER_ID
    });

    const replay = await harness.app.request("/wallets", {
      body: JSON.stringify({ message, signature }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST"
    });
    expect(replay.status).toBe(409);

    const stopWatching = await harness.app.request(`/wallets/${account.address}`, {
      body: JSON.stringify({ alertsEnabled: false }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH"
    });
    expect(stopWatching.status).toBe(200);
    expect(await readJson<{ wallet: WalletDto }>(stopWatching)).toEqual({
      wallet: { ...linked.wallet, alertsEnabled: false }
    });
    expect(harness.store.walletsByUser.get(USER_ID)).toContainEqual({
      ...linked.wallet,
      alertsEnabled: false
    });

    const watchAgain = await harness.app.request(`/wallets/${account.address}`, {
      body: JSON.stringify({ alertsEnabled: true }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH"
    });
    expect(watchAgain.status).toBe(200);
    expect(await readJson<{ wallet: WalletDto }>(watchAgain)).toMatchObject({
      wallet: { address: account.address.toLowerCase(), alertsEnabled: true, canSignIn: true }
    });

    const stopWatchingInitial = await harness.app.request(`/wallets/${PRIMARY_WALLET}`, {
      body: JSON.stringify({ alertsEnabled: false }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH"
    });
    expect(stopWatchingInitial.status).toBe(200);
    expect(await readJson<{ wallet: WalletDto }>(stopWatchingInitial)).toMatchObject({
      wallet: { address: PRIMARY_WALLET, alertsEnabled: false, canSignIn: true }
    });

    const legacyStopWatching = await harness.app.request(`/wallets/${PRIMARY_WALLET}`, {
      headers: { Cookie: cookie },
      method: "DELETE"
    });
    expect(legacyStopWatching.status).toBe(200);
    expect(await readJson<{ alertsEnabled: false; ok: true }>(legacyStopWatching)).toEqual({
      alertsEnabled: false,
      ok: true
    });
    expect(harness.store.walletsByUser.get(USER_ID)).toContainEqual({
      ...linked.wallet,
      address: PRIMARY_WALLET,
      alertsEnabled: false
    });

    const conflictedAccount = privateKeyToAccount(
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    );
    const conflictedAddress = conflictedAccount.address.toLowerCase() as AddressDto;
    harness.store.conflictedWallets.add(conflictedAddress);
    const conflictedNonceResponse = await harness.app.request("/wallets/nonce", {
      body: JSON.stringify({ address: conflictedAccount.address, chainId: 1 }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST"
    });
    const conflictedNonce = await readJson<{
      domain: string;
      expirationTime: string;
      issuedAt: string;
      nonce: string;
      statement: string;
      uri: string;
    }>(conflictedNonceResponse);
    const conflictedMessage = createSiweMessage({
      address: conflictedAccount.address,
      chainId: 1,
      domain: conflictedNonce.domain,
      expirationTime: new Date(conflictedNonce.expirationTime),
      issuedAt: new Date(conflictedNonce.issuedAt),
      nonce: conflictedNonce.nonce,
      statement: conflictedNonce.statement,
      uri: conflictedNonce.uri,
      version: "1"
    });
    const conflictedSignature = await conflictedAccount.signMessage({ message: conflictedMessage });
    const conflict = await harness.app.request("/wallets", {
      body: JSON.stringify({ message: conflictedMessage, signature: conflictedSignature }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST"
    });

    expect(conflict.status).toBe(409);
    expect(await readJson<{ error: { message: string } }>(conflict)).toEqual({
      error: { message: "Wallet is already linked to another account" }
    });
    expect(harness.store.lastLinkedWalletInput?.chainId).toBe(1);
  });

  test("updates subscriptions and manages Telegram channels", async () => {
    const cookie = await signedInCookie(harness);
    const channel: ChannelDto = {
      enabled: true,
      id: CHANNEL_ID,
      telegramChatId: "12345",
      type: "telegram"
    };
    harness.store.channelsByUser.set(USER_ID, [channel]);

    const putSubscription = await harness.app.request("/subscriptions", {
      body: JSON.stringify({
        boardrooms: [{ address: BOARDROOM, chainId: 31337 }],
        minSeverity: "high",
        mode: "explicit"
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PUT"
    });
    expect(putSubscription.status).toBe(200);
    expect(await readJson<{ subscription: SubscriptionDto }>(putSubscription)).toEqual({
      subscription: {
        boardrooms: [{ address: BOARDROOM, chainId: 31337 }],
        minSeverity: "high",
        mode: "explicit"
      }
    });

    const getSubscription = await harness.app.request("/subscriptions", {
      headers: { Cookie: cookie }
    });
    expect(getSubscription.status).toBe(200);
    expect(await readJson<{ subscription: SubscriptionDto }>(getSubscription)).toEqual({
      subscription: {
        boardrooms: [{ address: BOARDROOM, chainId: 31337 }],
        minSeverity: "high",
        mode: "explicit"
      }
    });

    const linkCode = await harness.app.request("/channels/telegram/link-code", {
      headers: { Cookie: cookie },
      method: "POST"
    });
    expect(linkCode.status).toBe(200);
    expect(await readJson<TelegramLinkCodeResponse>(linkCode)).toEqual({
      code: "ABC123",
      deepLink: "https://t.me/PledgeCashBot?start=ABC123",
      expiresAt: new Date(FIXED_NOW.getTime() + 600_000).toISOString()
    });

    const channels = await harness.app.request("/channels", { headers: { Cookie: cookie } });
    expect(channels.status).toBe(200);
    expect(await readJson<{ channels: ChannelDto[] }>(channels)).toEqual({ channels: [channel] });

    const deleteChannel = await harness.app.request(`/channels/${CHANNEL_ID}`, {
      headers: { Cookie: cookie },
      method: "DELETE"
    });
    expect(deleteChannel.status).toBe(200);
    expect(await readJson<{ ok: true }>(deleteChannel)).toEqual({ ok: true });
  });

  test("returns only the signed-in user's safe paginated delivery receipts", async () => {
    const cookie = await signedInCookie(harness);
    const delivery: NotificationDeliveryDto = {
      action: {
        operationId: `0x${"ab".repeat(32)}`,
        boardroom: BOARDROOM,
        chainId: 31337,
        eta: new Date(FIXED_NOW.getTime() + 86_400_000).toISOString(),
        expiresAt: new Date(FIXED_NOW.getTime() + 8 * 86_400_000).toISOString(),
        id: ACTION_ID,
        status: "scheduled"
      },
      attempts: 2,
      channelType: "telegram",
      createdAt: FIXED_NOW.toISOString(),
      event: "scheduled",
      id: "00000000-0000-4000-8000-000000000004",
      nextAttemptAt: new Date(FIXED_NOW.getTime() + 60_000).toISOString(),
      sentAt: null,
      severity: "high",
      status: "failed",
      summary: "Scheduled controller configuration.",
      updatedAt: FIXED_NOW.toISOString()
    };
    harness.store.deliveriesByUser.set(USER_ID, [delivery]);
    harness.store.deliveriesByUser.set("00000000-0000-4000-8000-000000000099", [
      { ...delivery, id: "00000000-0000-4000-8000-000000000099" }
    ]);

    const response = await harness.app.request("/notifications?limit=1", {
      headers: { Cookie: cookie }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await readJson<NotificationDeliveriesResponse>(response);
    expect(body).toEqual({ items: [delivery], page: { limit: 1, nextCursor: null } });
    expect(harness.store.lastNotificationDeliveriesInput).toEqual({
      query: { limit: 1 },
      userId: USER_ID
    });
    expect(JSON.stringify(body)).not.toContain("lastError");
    expect(JSON.stringify(body)).not.toContain("telegramChatId");
  });

  test("rejects invalid delivery pagination before querying the store", async () => {
    const cookie = await signedInCookie(harness);
    const response = await harness.app.request("/notifications?cursor=not-a-cursor", {
      headers: { Cookie: cookie }
    });

    expect(response.status).toBe(400);
    expect(await readJson<{ error: { message: string } }>(response)).toEqual({
      error: { message: "cursor is invalid" }
    });
    expect(harness.store.lastNotificationDeliveriesInput).toBeUndefined();
  });

  test("serves cacheable public action feeds and boardroom scoped queries", async () => {
    const feed = await harness.app.request(
      "/public/actions?chainId=31337&boardroom=0x1111111111111111111111111111111111111111&minSeverity=medium&limit=10"
    );

    expect(feed.status).toBe(200);
    expect(feed.headers.get("cache-control")).toBe("public, max-age=15");
    const feedBody = await readJson<PublicActionsResponse>(feed);
    expect(feedBody.items).toHaveLength(1);
    expect(feedBody.items[0]?.id).toBe(ACTION_ID);
    expect(harness.store.lastPublicQuery).toMatchObject({
      boardroom: BOARDROOM,
      chainId: 31337,
      limit: 10,
      minSeverity: "medium"
    });

    const scoped = await harness.app.request(
      "/public/chains/31337/boardrooms/0x1111111111111111111111111111111111111111/actions?status=scheduled"
    );

    expect(scoped.status).toBe(200);
    expect(scoped.headers.get("cache-control")).toBe("public, max-age=15");
    expect(await readJson<PublicActionsResponse>(scoped)).toEqual({
      items: harness.store.actions,
      page: { limit: 25, nextCursor: null }
    });
    expect(harness.store.lastPublicQuery).toMatchObject({
      boardroom: BOARDROOM,
      chainId: 31337,
      limit: 25,
      status: "scheduled"
    });
  });
});
