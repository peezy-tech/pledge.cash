import { beforeEach, describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

import {
  AUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  type AuthKitAdapter,
  type WalletNonceRecord
} from "../src/api/auth";
import { createApp, type SentinelApiDeps, type SentinelApiStore } from "../src/api/server";
import type {
  AddressDto,
  AuthMeResponse,
  BoardroomRef,
  ChannelDto,
  HealthResponse,
  PublicActionDto,
  PublicActionsQuery,
  PublicActionsResponse,
  SubscriptionDto,
  TelegramLinkCodeResponse,
  UserDto,
  WalletDto
} from "../src/api/dto";

const WEB_ORIGIN = "https://pledge.cash";
const FIXED_NOW = new Date("2026-07-09T12:00:00.000Z");
const WORKOS_USER = { email: "ada@example.com", id: "user_workos_123" };
const USER_ID = "00000000-0000-4000-8000-000000000001";
const CHANNEL_ID = "00000000-0000-4000-8000-000000000002";
const ACTION_ID = "00000000-0000-4000-8000-000000000003";
const BOARDROOM = "0x1111111111111111111111111111111111111111" as AddressDto;
const SHARE_TOKEN = "0x2222222222222222222222222222222222222222" as AddressDto;
const POLICY = "0x3333333333333333333333333333333333333333" as AddressDto;
const TARGET = "0x4444444444444444444444444444444444444444" as AddressDto;

class StubAuth implements AuthKitAdapter {
  readonly sessions = new Map<string, typeof WORKOS_USER>([["sealed-session", WORKOS_USER]]);
  authenticatedInput: { code: string; state?: string } | undefined;
  authorizationInput: { returnTo: string; state: string } | undefined;
  revokedSession: string | undefined;

  async authenticateWithCode(input: { readonly code: string; readonly state?: string }) {
    this.authenticatedInput = input;
    if (input.code !== "ok") {
      throw new Error("unexpected auth code");
    }

    return { sealedSession: "sealed-session", user: WORKOS_USER };
  }

  getAuthorizationUrl(input: { readonly returnTo: string; readonly state: string }): string {
    this.authorizationInput = input;
    return `https://workos.example/authorize?state=${encodeURIComponent(input.state)}`;
  }

  async getSession(input: { readonly sealedSession: string }) {
    const user = this.sessions.get(input.sealedSession);
    return user === undefined ? null : { user };
  }

  async revokeSession(input: { readonly sealedSession: string }): Promise<void> {
    this.revokedSession = input.sealedSession;
    this.sessions.delete(input.sealedSession);
  }
}

class InMemoryStore implements SentinelApiStore {
  readonly linkCodes = new Map<string, { expiresAt: Date; userId: string }>();
  readonly nonces = new Map<string, WalletNonceRecord>();
  readonly usersByWorkos = new Map<string, UserDto>();
  channelsByUser = new Map<string, ChannelDto[]>();
  lastPublicQuery: PublicActionsQuery | undefined;
  pingCount = 0;
  subscriptionsByUser = new Map<string, SubscriptionDto>();
  walletsByUser = new Map<string, WalletDto[]>();

  actions: PublicActionDto[] = [
    {
      actionHash: `0x${"ab".repeat(32)}`,
      analysis: {
        affectedParties: ["shareholders"],
        effects: ["executor changes"],
        harness: "template",
        model: null,
        severityRationale: "Executor authority changes are high impact.",
        source: "template",
        summary: "Queued executor rotation."
      },
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
          decodedFunction: "setExecutor",
          policy: POLICY,
          selector: "0x12345678",
          target: TARGET,
          value: "0"
        }
      ],
      chainId: 31337,
      decodeStatus: "decoded",
      eta: new Date(FIXED_NOW.getTime() + 86_400_000).toISOString(),
      event: "queued",
      id: ACTION_ID,
      queueBlock: "123",
      queueTxHash: `0x${"cd".repeat(32)}`,
      risk: {
        evaluatedAt: FIXED_NOW.toISOString(),
        findings: [
          {
            callIndex: 0,
            detail: "Executor update can redirect execution authority.",
            ruleId: "executor-change",
            severity: "high"
          }
        ],
        rulesetVersion: 1,
        severity: "high"
      },
      status: "queued"
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
    readonly siweMessage: string;
    readonly userId: string;
    readonly verifiedAt: Date;
  }): Promise<WalletDto> {
    expect(input.siweMessage.toLowerCase()).toContain(input.address.slice(2));
    const wallet = { address: input.address, verifiedAt: input.verifiedAt.toISOString() };
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

  async unlinkWallet(input: { readonly address: AddressDto; readonly userId: string }): Promise<boolean> {
    const wallets = this.walletsByUser.get(input.userId) ?? [];
    const nextWallets = wallets.filter((wallet) => wallet.address !== input.address);
    this.walletsByUser.set(input.userId, nextWallets);
    return nextWallets.length !== wallets.length;
  }

  async upsertUser(user: { readonly email: string; readonly workosUserId: string }): Promise<UserDto> {
    const existing = this.usersByWorkos.get(user.workosUserId);
    const nextUser = {
      email: user.email,
      id: existing?.id ?? USER_ID,
      workosUserId: user.workosUserId
    };
    this.usersByWorkos.set(user.workosUserId, nextUser);
    return nextUser;
  }
}

function createHarness() {
  const auth = new StubAuth();
  const store = new InMemoryStore();
  const deps: SentinelApiDeps = {
    auth,
    config: {
      chains: [{ chainId: 31337 }],
      telegram: { botUsername: "PledgeCashBot" },
      webOrigin: WEB_ORIGIN,
      workos: {}
    },
    generateLinkCode: () => "ABC123",
    generateNonce: () => "nonce0001",
    now: () => FIXED_NOW,
    rateLimit: { capacity: 100 },
    store
  };

  return { app: createApp(deps), auth, store };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toContain(SESSION_COOKIE_NAME);
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Secure");
  expect(setCookie).toContain("SameSite=Lax");
  return responseCookie(response, SESSION_COOKIE_NAME);
}

function authStateCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toContain(AUTH_STATE_COOKIE_NAME);
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Max-Age=600");
  expect(setCookie).toContain("Path=/auth");
  expect(setCookie).toContain("Secure");
  expect(setCookie).toContain("SameSite=Lax");
  return responseCookie(response, AUTH_STATE_COOKIE_NAME);
}

function responseCookie(response: Response, name: string): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = setCookie.match(new RegExp(`(?:^|,\\s*)(${escaped}=[^;,]*)`));
  expect(match?.[1]).toBeDefined();
  return match?.[1] ?? "";
}

async function signedInCookie(harness: ReturnType<typeof createHarness>): Promise<string> {
  const login = await harness.app.request(
    "/auth/login?return_to=https%3A%2F%2Fpledge.cash%2Fsettings"
  );
  const authCookie = authStateCookie(login);
  const state = harness.auth.authorizationInput?.state ?? "";
  const callback = await harness.app.request(
    `/auth/callback?code=ok&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: authCookie } }
  );
  expect(callback.status).toBe(302);
  return sessionCookie(callback);
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

  test("runs AuthKit redirect, callback, session, me, and logout through stubs", async () => {
    const login = await harness.app.request(
      "/auth/login?return_to=https%3A%2F%2Fpledge.cash%2Fsettings"
    );

    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toBe(
      "https://workos.example/authorize?state=nonce0001"
    );
    const authCookie = authStateCookie(login);
    expect(harness.auth.authorizationInput).toEqual({
      returnTo: "https://pledge.cash/settings",
      state: "nonce0001"
    });

    const callback = await harness.app.request(
      "/auth/callback?code=ok&state=nonce0001",
      { headers: { Cookie: authCookie } }
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("https://pledge.cash/settings");
    expect(harness.auth.authenticatedInput).toEqual({ code: "ok", state: "nonce0001" });
    expect(callback.headers.get("set-cookie")).toContain(`${AUTH_STATE_COOKIE_NAME}=`);
    expect(callback.headers.get("set-cookie")).toContain("Max-Age=0");
    const cookie = sessionCookie(callback);

    const me = await harness.app.request("/auth/me", { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    const meBody = await readJson<AuthMeResponse>(me);
    expect(meBody.user).toEqual({
      email: WORKOS_USER.email,
      id: USER_ID,
      workosUserId: WORKOS_USER.id
    });
    expect(meBody.subscription).toEqual({ boardrooms: [], minSeverity: "medium", mode: "holdings" });

    const logout = await harness.app.request("/auth/logout", {
      headers: { Cookie: cookie },
      method: "POST"
    });
    expect(logout.status).toBe(200);
    expect(await readJson<{ ok: true }>(logout)).toEqual({ ok: true });
    expect(harness.auth.revokedSession).toBe("sealed-session");
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("rejects AuthKit callbacks without the matching state cookie", async () => {
    const login = await harness.app.request(
      "/auth/login?return_to=https%3A%2F%2Fpledge.cash%2Fsettings"
    );
    const authCookie = authStateCookie(login);

    const missingCookie = await harness.app.request("/auth/callback?code=ok&state=nonce0001");
    expect(missingCookie.status).toBe(400);
    expect(await readJson<{ error: { message: string } }>(missingCookie)).toEqual({
      error: { message: "Invalid authentication state" }
    });

    const mismatchedState = await harness.app.request(
      "/auth/callback?code=ok&state=attacker",
      { headers: { Cookie: authCookie } }
    );
    expect(mismatchedState.status).toBe(400);
    expect(await readJson<{ error: { message: string } }>(mismatchedState)).toEqual({
      error: { message: "Invalid authentication state" }
    });
  });

  test("rejects protected routes without a valid session", async () => {
    const response = await harness.app.request("/auth/me");

    expect(response.status).toBe(401);
    expect(await readJson<{ error: { message: string } }>(response)).toEqual({
      error: { message: "Authentication required" }
    });
  });

  test("links and unlinks a SIWE wallet with a single-use nonce", async () => {
    const cookie = await signedInCookie(harness);
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
    expect(linked.wallet.address).toBe(account.address.toLowerCase());

    const replay = await harness.app.request("/wallets", {
      body: JSON.stringify({ message, signature }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST"
    });
    expect(replay.status).toBe(409);

    const unlink = await harness.app.request(`/wallets/${account.address}`, {
      headers: { Cookie: cookie },
      method: "DELETE"
    });
    expect(unlink.status).toBe(200);
    expect(await readJson<{ ok: true }>(unlink)).toEqual({ ok: true });
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
      "/public/chains/31337/boardrooms/0x1111111111111111111111111111111111111111/actions?status=queued"
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
      status: "queued"
    });
  });
});
