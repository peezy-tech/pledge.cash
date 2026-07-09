import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { buildSentinelSiweMessage } from "../src/features/notifications/wallet-link";
import {
  createSentinelClient,
  getSentinelBaseUrl,
  sentinelLoginUrl,
  SentinelApiError,
  type SentinelFetch,
} from "../src/lib/sentinel";

describe("sentinel web client", () => {
  test("reads an optional VITE_SENTINEL_API_URL", () => {
    expect(getSentinelBaseUrl({})).toBeUndefined();
    expect(getSentinelBaseUrl({ VITE_SENTINEL_API_URL: "" })).toBeUndefined();
    expect(getSentinelBaseUrl({ VITE_SENTINEL_API_URL: " https://api.example.test/sentinel/ " })).toBe(
      "https://api.example.test/sentinel",
    );
  });

  test("builds AuthKit redirect URLs with the SPA return URL", () => {
    const returnTo = "https://pledge.cash/project?chain=31337";
    const url = new URL(sentinelLoginUrl(returnTo, "https://api.example.test/sentinel"));

    expect(`${url.origin}${url.pathname}`).toBe("https://api.example.test/sentinel/auth/login");
    expect(url.searchParams.get("return_to")).toBe(returnTo);
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
      expect((error as Error).message).toBe("Sign in to manage Sentinel settings.");
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
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}
