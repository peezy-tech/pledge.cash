import { beforeEach, describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

import { type AuthAdapter, type WalletNonceRecord } from "../src/api/auth";
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
  WalletDto
} from "../src/api/dto";

const WEB_ORIGIN = "https://pledge.cash";
const FIXED_NOW = new Date("2026-07-09T12:00:00.000Z");
const USER_ID = "00000000-0000-4000-8000-000000000001";
const CHANNEL_ID = "00000000-0000-4000-8000-000000000002";
const ACTION_ID = "00000000-0000-4000-8000-000000000003";
const SESSION_COOKIE = "better-auth.session_token=stub-session";
const PRIMARY_WALLET = "0x5555555555555555555555555555555555555555" as AddressDto;
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
    if (path === "/auth/siwe/verify") {
      headers.set(
        "Set-Cookie",
        `${SESSION_COOKIE}; Path=/; HttpOnly; Secure; SameSite=Lax`
      );
    }

    return new Response(JSON.stringify({ forwarded: true, path }), { headers, status: 200 });
  }
}

class InMemoryStore implements SentinelApiStore {
  deliveriesByUser = new Map<string, NotificationDeliveryDto[]>();
  readonly linkCodes = new Map<string, { expiresAt: Date; userId: string }>();
  readonly nonces = new Map<string, WalletNonceRecord>();
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
}

function createHarness() {
  const auth = new StubAuth();
  const store = new InMemoryStore();
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
    rateLimit: { capacity: 100 },
    store
  };

  return { app: createApp(deps), auth, store };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function signedInCookie(harness: ReturnType<typeof createHarness>): Promise<string> {
  const verify = await harness.app.request("/auth/siwe/verify", {
    body: JSON.stringify({
      chainId: 31337,
      message: "stub SIWE message",
      signature: `0x${"ab".repeat(65)}`,
      walletAddress: PRIMARY_WALLET
    }),
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
    expect(await readJson<{ socialProviders: string[] }>(capabilities)).toEqual({
      socialProviders: ["discord", "twitter", "telegram"]
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
        body: {
          chainId: 31337,
          message: "stub SIWE message",
          signature: `0x${"ab".repeat(65)}`,
          walletAddress: PRIMARY_WALLET
        },
        method: "POST",
        path: "/auth/siwe/verify"
      },
      { body: null, method: "POST", path: "/auth/sign-out" }
    ]);
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
