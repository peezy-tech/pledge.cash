import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { buildAlertsSiweMessage } from "../src/features/notifications/alerts-identity";
import { alertsViewState } from "../src/features/notifications/alerts-view-state";
import { buildSentinelSiweMessage } from "../src/features/notifications/wallet-link";
import {
  createSentinelClient,
  getSentinelBaseUrl,
  SentinelApiError,
  type SentinelFetch,
} from "../src/lib/sentinel";
import { notificationFocusFromLocation } from "../src/app/views/sentinel-settings";
import {
  governanceWatchSuggestionState,
  watchGovernanceSubscriptionDraft,
} from "../src/features/notifications/subscription-settings";

describe("sentinel web client", () => {
  test("preserves local alert-rule drafts when adding a governance watch", () => {
    const existing = {
      address: "0x2000000000000000000000000000000000000000" as const,
      chainId: 8453,
    };
    const suggested = {
      address: "0x3000000000000000000000000000000000000000" as const,
      chainId: 31337,
    };

    expect(watchGovernanceSubscriptionDraft({ boardrooms: [existing], minSeverity: "high" }, suggested)).toEqual({
      boardrooms: [existing, suggested],
      minSeverity: "high",
      mode: "explicit",
    });
    const persisted = { boardrooms: [], minSeverity: "medium" as const, mode: "holdings" as const };
    const pendingDraft = { boardrooms: [existing, suggested], minSeverity: "high" as const, mode: "explicit" as const };
    expect(governanceWatchSuggestionState(persisted, pendingDraft, suggested)).toBe("pending");
    expect(watchGovernanceSubscriptionDraft(pendingDraft, suggested)).toEqual({
      boardrooms: [existing, suggested],
      minSeverity: "high",
      mode: "explicit",
    });
  });

  test("preserves a canonical project watch focus and rejects unsafe return URLs", () => {
    const boardroom = "0x1000000000000000000000000000000000000000";
    expect(notificationFocusFromLocation(`?chain=31337&boardroom=${boardroom}&return=%2Fprojects%2F31337%2F${boardroom}%2Fgovernance`))
      .toEqual({
        boardroom,
        chainId: 31337,
        returnHref: `/projects/31337/${boardroom}/governance`,
      });
    expect(notificationFocusFromLocation(`?chain=31337&boardroom=${boardroom}&return=%2F%2Fevil.example`))
      .toEqual({ boardroom, chainId: 31337 });
    for (const control of ["%09", "%0a", "%0d"]) {
      expect(notificationFocusFromLocation(`?chain=31337&boardroom=${boardroom}&return=%2F${control}%2Fevil.example`))
        .toEqual({ boardroom, chainId: 31337 });
    }
  });
  test("reads an optional VITE_SENTINEL_API_URL", () => {
    expect(getSentinelBaseUrl({})).toBeUndefined();
    expect(getSentinelBaseUrl({ VITE_SENTINEL_API_URL: "" })).toBeUndefined();
    expect(getSentinelBaseUrl({ VITE_SENTINEL_API_URL: " https://api.example.test/sentinel/ " })).toBe(
      "https://api.example.test/sentinel",
    );
  });

  test("reads uncached index health with cancellation support", async () => {
    const calls: { input: string; init: RequestInit | undefined }[] = [];
    const fetcher: SentinelFetch = async (input, init) => {
      calls.push({ input: input.toString(), init });
      return jsonResponse({ chains: [{ chainId: 998, governanceBlock: "200" }], database: "ok", ok: true });
    };
    const controller = new AbortController();
    const client = createSentinelClient({ baseUrl: "https://api.example.test", fetcher });

    await client.health(controller.signal);

    expect(calls[0]?.input).toBe("https://api.example.test/health");
    expect(calls[0]?.init?.cache).toBe("no-store");
    expect(calls[0]?.init?.signal).toBe(controller.signal);
  });

  test("sends JSON requests with session credentials", async () => {
    const calls: { input: string; init: RequestInit | undefined }[] = [];
    const fetcher: SentinelFetch = async (input, init) => {
      calls.push({ input: input.toString(), init });
      return jsonResponse({ wallet: { address: "0x1000000000000000000000000000000000000000", verifiedAt: "2026-07-09T00:00:00.000Z" } });
    };
    const client = createSentinelClient({ baseUrl: "https://api.example.test/sentinel/", fetcher });

    await client.linkWallet({ message: "hello", signature: "0x1234" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("https://api.example.test/sentinel/wallets");
    expect(calls[0]?.init?.credentials).toBe("include");
    expect(calls[0]?.init?.method).toBe("POST");
    expect((calls[0]?.init?.headers as Record<string, string> | undefined)?.["Content-Type"]).toBe("application/json");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ message: "hello", signature: "0x1234" }));
  });

  test("uses the connected wallet chain for the SIWE nonce request", async () => {
    const calls: { input: string; init: RequestInit | undefined }[] = [];
    const fetcher: SentinelFetch = async (input, init) => {
      calls.push({ input: input.toString(), init });
      return jsonResponse({ nonce: "abcdefghi" });
    };
    const client = createSentinelClient({ baseUrl: "https://api.example.test", fetcher });

    await client.createAuthSiweNonce({
      chainId: 8453,
      walletAddress: "0x1000000000000000000000000000000000000000",
    });

    expect(calls[0]?.input).toBe("https://api.example.test/auth/peezy/siwe/nonce");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ chainId: 8453, walletAddress: "0x1000000000000000000000000000000000000000" }),
    );
  });

  test("falls back to the legacy auth routes while the API rollout is pending", async () => {
    const calls: { input: string; init: RequestInit | undefined }[] = [];
    const fetcher: SentinelFetch = async (input, init) => {
      const url = input.toString();
      calls.push({ input: url, init });
      if (url.includes("/auth/peezy/")) {
        return jsonResponse({ error: { message: "Not found" } }, { status: 404 });
      }
      return jsonResponse(
        url.endsWith("/nonce")
          ? { nonce: "abcdefghi" }
          : { redirect: true, success: true, url: "https://oauth.telegram.org/auth" },
      );
    };
    const client = createSentinelClient({ baseUrl: "https://api.example.test", fetcher });
    const walletRequest = {
      chainId: 8453,
      message: "legacy SIWE message",
      signature: "0x1234",
      walletAddress: "0x1000000000000000000000000000000000000000",
    };

    await client.createAuthSiweNonce(walletRequest);
    await client.verifyAuthSiwe(walletRequest);
    await client.linkSocial({
      callbackURL: "https://pledge.cash/notifications",
      provider: "telegram",
    });

    expect(calls.map((call) => call.input)).toEqual([
      "https://api.example.test/auth/peezy/siwe/nonce",
      "https://api.example.test/auth/siwe/nonce",
      "https://api.example.test/auth/peezy/siwe/verify",
      "https://api.example.test/auth/siwe/verify",
      "https://api.example.test/auth/peezy/link",
      "https://api.example.test/auth/oauth2/link",
    ]);
    expect(calls[5]?.init?.body).toBe(
      JSON.stringify({
        callbackURL: "https://pledge.cash/notifications",
        providerId: "telegram",
      }),
    );
  });

  test("updates alert coverage without changing wallet sign-in authority", async () => {
    const calls: { input: string; init: RequestInit | undefined }[] = [];
    const fetcher: SentinelFetch = async (input, init) => {
      calls.push({ input: input.toString(), init });
      return jsonResponse({
        wallet: {
          address: "0x1000000000000000000000000000000000000000",
          alertsEnabled: false,
          canSignIn: true,
          verifiedAt: "2026-07-09T00:00:00.000Z",
        },
      });
    };
    const client = createSentinelClient({ baseUrl: "https://api.example.test", fetcher });
    const address = "0x1000000000000000000000000000000000000000";

    await expect(client.setWalletAlerts(address, { alertsEnabled: false })).resolves.toMatchObject({
      wallet: { alertsEnabled: false, canSignIn: true },
    });

    expect(calls[0]?.input).toBe(`https://api.example.test/wallets/${address}`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ alertsEnabled: false }));
  });

  test("starts peezy.tech social linking with the current callback", async () => {
    const calls: { input: string; init: RequestInit | undefined }[] = [];
    const fetcher: SentinelFetch = async (input, init) => {
      calls.push({ input: input.toString(), init });
      return jsonResponse({ redirect: true, url: "https://github.com/login/oauth/authorize" });
    };
    const client = createSentinelClient({ baseUrl: "https://api.example.test", fetcher });
    const body = {
      callbackURL: "https://pledge.cash/notifications",
      errorCallbackURL: "https://pledge.cash/notifications",
      provider: "github" as const,
    };

    await client.linkSocial(body);

    expect(calls[0]?.input).toBe("https://api.example.test/auth/peezy/link");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify(body));
  });

  test("routes every provider through the shared peezy.tech identity endpoints", async () => {
    const calls: { input: string; init: RequestInit | undefined }[] = [];
    const fetcher: SentinelFetch = async (input, init) => {
      calls.push({ input: input.toString(), init });
      return jsonResponse({ redirect: true, url: "https://oauth.telegram.org/auth" });
    };
    const client = createSentinelClient({ baseUrl: "https://api.example.test", fetcher });
    const body = {
      callbackURL: "https://pledge.cash/notifications/",
      errorCallbackURL: "https://pledge.cash/notifications/",
      provider: "telegram" as const,
    };

    await client.linkSocial(body);
    await client.signInSocial(body);

    expect(calls.map((call) => call.input)).toEqual([
      "https://api.example.test/auth/peezy/link",
      "https://api.example.test/auth/peezy/sign-in",
    ]);
    for (const call of calls) {
      expect(call.init?.method).toBe("POST");
      expect(call.init?.body).toBe(
        JSON.stringify(body),
      );
    }
  });

  test("encodes public action filters without a network request dependency", async () => {
    const calls: string[] = [];
    const fetcher: SentinelFetch = async (input) => {
      calls.push(input.toString());
      return jsonResponse({ items: [], page: { limit: 5, nextCursor: null } });
    };
    const client = createSentinelClient({ baseUrl: "https://api.example.test", fetcher });

    await client.listPublicActions({ chainId: 31337, limit: 5, minSeverity: "high", status: "queued" });

    expect(calls[0]).toBe("https://api.example.test/public/actions?limit=5&minSeverity=high&status=queued&chainId=31337");
  });

  test("reads account-scoped delivery receipts with pagination and cancellation", async () => {
    const calls: { input: string; init: RequestInit | undefined }[] = [];
    const fetcher: SentinelFetch = async (input, init) => {
      calls.push({ input: input.toString(), init });
      return jsonResponse({ items: [], page: { limit: 10, nextCursor: null } });
    };
    const controller = new AbortController();
    const client = createSentinelClient({ baseUrl: "https://api.example.test", fetcher });

    await client.listNotificationDeliveries({ cursor: "opaque-cursor", limit: 10 }, controller.signal);

    expect(calls[0]?.input).toBe("https://api.example.test/notifications?cursor=opaque-cursor&limit=10");
    expect(calls[0]?.init?.cache).toBe("no-store");
    expect(calls[0]?.init?.credentials).toBe("include");
    expect(calls[0]?.init?.signal).toBe(controller.signal);
  });

  test("surfaces API errors with status", async () => {
    const client = createSentinelClient({
      baseUrl: "https://api.example.test",
      fetcher: async () => jsonResponse({ message: "session expired" }, { status: 401 }),
    });

    try {
      await client.authMe();
      throw new Error("Expected authMe to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(SentinelApiError);
      expect((error as SentinelApiError).status).toBe(401);
      expect((error as Error).message).toBe("Sign with your wallet to manage alerts.");
    }
  });

  test("surfaces nested Sentinel API error messages", async () => {
    const client = createSentinelClient({
      baseUrl: "https://api.example.test",
      fetcher: async () => jsonResponse({ error: { message: "Invalid authentication state" } }, { status: 400 }),
    });

    try {
      await client.listChannels();
      throw new Error("Expected listChannels to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(SentinelApiError);
      expect((error as SentinelApiError).status).toBe(400);
      expect((error as Error).message).toBe("Invalid authentication state");
    }
  });

  test("builds the SIWE wallet-link message from nonce fields", () => {
    const address = "0x1000000000000000000000000000000000000000" as Address;
    const message = buildSentinelSiweMessage(
      {
        address,
        chainId: 31337,
        domain: "pledge.cash",
        expirationTime: "2026-07-09T00:10:00.000Z",
        issuedAt: "2026-07-09T00:00:00.000Z",
        nonce: "abcdefghi",
        statement: "Link this wallet to Sentinel.",
        uri: "https://pledge.cash/notifications",
        version: "1",
      },
      address,
      31337,
    );

    expect(message).toContain("pledge.cash wants you to sign in with your Ethereum account:");
    expect(message).toContain(address);
    expect(message).toContain("Chain ID: 31337");
    expect(message).toContain("Nonce: abcdefghi");
  });

  test("builds the wallet-first sign-in message required by Alerts", () => {
    const address = "0x1000000000000000000000000000000000000000" as Address;
    const message = buildAlertsSiweMessage({
      address,
      chainId: 8453,
      domain: "pledge.cash",
      issuedAt: new Date("2026-07-10T12:00:00.000Z"),
      nonce: "abcdefghi",
      uri: "https://pledge.cash/notifications",
    });

    expect(message).toContain("pledge.cash wants you to sign in with your Ethereum account:");
    expect(message).toContain("Sign in to pledge.cash alerts.");
    expect(message).toContain("URI: https://pledge.cash/notifications");
    expect(message).toContain("Chain ID: 8453");
    expect(message).toContain("Nonce: abcdefghi");
  });
});

describe("alerts view state", () => {
  const address = "0x1000000000000000000000000000000000000000" as Address;
  const otherAddress = "0x2000000000000000000000000000000000000000" as Address;

  test("asks for a wallet before authentication", () => {
    expect(alertsViewState({}, undefined)).toBe("connect-wallet");
  });

  test("asks a connected wallet to sign", () => {
    expect(alertsViewState({ account: address, chainId: 8453 }, undefined)).toBe("sign-wallet");
  });

  test("keeps an authenticated account active with an unlinked connected wallet", () => {
    expect(
      alertsViewState(
        { account: otherAddress, chainId: 8453 },
        { channels: [{ enabled: true }] },
      ),
    ).toBe("active");
  });

  test("moves a verified wallet to delivery setup", () => {
    expect(
      alertsViewState(
        { account: address, chainId: 8453 },
        { channels: [] },
      ),
    ).toBe("link-delivery");
  });

  test("reports active when identity and delivery are ready", () => {
    expect(
      alertsViewState(
        { account: address, chainId: 8453 },
        { channels: [{ enabled: true }] },
      ),
    ).toBe("active");
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}
