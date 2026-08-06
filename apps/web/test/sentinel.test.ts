import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { buildIdentitySiweMessage } from "../src/features/notifications/alerts-identity";
import { buildWalletLinkSiweMessage } from "../src/features/notifications/wallet-link";
import {
  createSentinelClient,
  getSentinelBaseUrl,
  SentinelApiError,
  type SentinelFetch,
} from "../src/lib/sentinel";

const wallet = "0x1000000000000000000000000000000000000000" as Address;

describe("identity-only Sentinel web client", () => {
  test("reads an optional identity API URL", () => {
    expect(getSentinelBaseUrl({})).toBeUndefined();
    expect(getSentinelBaseUrl({ VITE_SENTINEL_API_URL: "" })).toBeUndefined();
    expect(getSentinelBaseUrl({ VITE_SENTINEL_API_URL: " https://api.example.test/identity/ " })).toBe("https://api.example.test/identity");
  });

  test("uses canonical peezy.tech SIWE and social endpoints without compatibility fallbacks", async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const fetcher: SentinelFetch = async (input, init) => {
      calls.push({ input: input.toString(), ...(init ? { init } : {}) });
      return jsonResponse(input.toString().endsWith("/nonce") ? { nonce: "abcdefghi" } : { success: true, url: "https://identity.example/continue" });
    };
    const client = createSentinelClient({ baseUrl: "https://api.example.test", fetcher });

    await client.createAuthSiweNonce({ chainId: 8453, walletAddress: wallet });
    await client.verifyAuthSiwe({ chainId: 8453, walletAddress: wallet, message: "message", signature: "0x1234" });
    await client.linkSocial({ callbackURL: "https://pledge.cash/settings/identity", provider: "github" });
    await client.signInSocial({ callbackURL: "https://pledge.cash/settings/identity", provider: "telegram" });

    expect(calls.map(({ input }) => input)).toEqual([
      "https://api.example.test/auth/peezy/siwe/nonce",
      "https://api.example.test/auth/peezy/siwe/verify",
      "https://api.example.test/auth/peezy/link",
      "https://api.example.test/auth/peezy/sign-in",
    ]);
    expect(calls.every(({ init }) => init?.credentials === "include" && init.method === "POST")).toBe(true);
  });

  test("links and lists wallets without notification preferences", async () => {
    const calls: string[] = [];
    const fetcher: SentinelFetch = async (input) => {
      calls.push(input.toString());
      return jsonResponse({ wallet: { address: wallet, canSignIn: true, verifiedAt: "2026-08-06T00:00:00.000Z" } });
    };
    const client = createSentinelClient({ baseUrl: "https://api.example.test", fetcher });
    const result = await client.linkWallet({ message: "hello", signature: "0x1234" });

    expect(calls).toEqual(["https://api.example.test/wallets"]);
    expect(result.wallet).not.toHaveProperty("alertsEnabled");
    expect(client).not.toHaveProperty("setWalletAlerts");
    expect(client).not.toHaveProperty("subscriptions");
    expect(client).not.toHaveProperty("notifications");
  });

  test("reads health without cache and forwards cancellation", async () => {
    let observed: RequestInit | undefined;
    const fetcher: SentinelFetch = async (_input, init) => {
      observed = init;
      return jsonResponse({ database: "ok", ok: true });
    };
    const controller = new AbortController();
    await createSentinelClient({ baseUrl: "https://api.example.test", fetcher }).health(controller.signal);
    expect(observed?.cache).toBe("no-store");
    expect(observed?.signal).toBe(controller.signal);
  });

  test("builds identity SIWE with the settled statement", () => {
    const message = buildIdentitySiweMessage({
      address: wallet,
      chainId: 8453,
      domain: "pledge.cash",
      issuedAt: new Date("2026-08-06T00:00:00.000Z"),
      nonce: "abcdefghi",
      uri: "https://pledge.cash/settings/identity",
    });
    expect(message).toContain("Sign in to pledge.cash.");
    expect(message).toContain("Chain ID: 8453");
    expect(message).not.toContain("alert");
  });

  test("uses server-provided wallet-link messages or builds the exact fallback", () => {
    expect(buildWalletLinkSiweMessage({ message: "server challenge", nonce: "abcdefghi" } as never, wallet, 8453)).toBe("server challenge");
    const fallback = buildWalletLinkSiweMessage({
      address: wallet,
      chainId: 8453,
      domain: "pledge.cash",
      expirationTime: "2026-08-06T00:10:00.000Z",
      issuedAt: "2026-08-06T00:00:00.000Z",
      nonce: "abcdefghi",
      statement: "Link this wallet to your pledge.cash identity.",
      uri: "https://pledge.cash/settings/identity",
      version: "1",
    }, wallet, 8453);
    expect(fallback).toContain("Link this wallet to your pledge.cash identity.");
    expect(fallback).toContain(`Nonce: abcdefghi`);
  });

  test("returns actionable API errors", async () => {
    const client = createSentinelClient({
      baseUrl: "https://api.example.test",
      fetcher: async () => jsonResponse({ error: { message: "Signature invalid" } }, { status: 401 }),
    });
    const error = await client.authMe().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SentinelApiError);
    expect((error as SentinelApiError).status).toBe(401);
    expect((error as Error).message).toBe("Sign with your wallet to manage this identity.");
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, ...init });
}
