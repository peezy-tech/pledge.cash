import { expect, test } from "bun:test";

import type { AuthSnapshot } from "../src/api/auth";
import { createPeezyIdentityAuthAdapter } from "../src/api/peezy-identity";
import type { Config } from "../src/config";
import type { SentinelDb } from "../src/db/client";

const config = {
  auth: {
    baseUrl: "http://localhost:8787",
    identity: {
      appClientSecret: "app-secret-at-least-32-characters",
      baseUrl: "https://identity.peezy.tech",
      clientId: "pledge-cash",
      oidcClientSecret: "oidc-secret-at-least-32-characters"
    },
    secret: "sentinel-secret-at-least-32-characters",
    socialProviders: {}
  },
  webOrigin: "http://localhost:5173"
} satisfies Pick<Config, "auth" | "webOrigin">;

test("aborts every stalled Identity request at the application deadline", async () => {
  const signals: AbortSignal[] = [];
  const stalledFetcher = (
    _input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    if (init?.signal !== null && init?.signal !== undefined) {
      signals.push(init.signal);
    }
    return new Promise(() => {});
  };
  const adapter = createPeezyIdentityAuthAdapter(
    config,
    {} as SentinelDb,
    stalledFetcher,
    { requestTimeoutMs: 10 }
  );

  const results = await Promise.allSettled([
    adapter.createWalletChallenge?.({
      address: "0x1111111111111111111111111111111111111111",
      chainId: 1,
      purpose: "sign-in"
    }),
    adapter.getSocialProviders?.(),
    adapter.handler(
      new Request("http://localhost:8787/auth/siwe/verify", {
        body: JSON.stringify({
          chainId: 1,
          message: "stalled wallet grant",
          signature: `0x${"ab".repeat(65)}`,
          walletAddress: "0x1111111111111111111111111111111111111111"
        }),
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173"
        },
        method: "POST"
      })
    )
  ]);

  expect(results).toHaveLength(3);
  for (const result of results.slice(0, 2)) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toBeInstanceOf(Error);
      expect((result.reason as Error).message).toBe(
        "Identity request timed out after 10ms"
      );
    }
  }
  const verify = results[2];
  expect(verify?.status).toBe("fulfilled");
  if (verify?.status === "fulfilled") {
    expect(verify.value.status).toBe(401);
    expect(await verify.value.json()).toMatchObject({
      message: "Identity request timed out after 10ms"
    });
  }
  expect(signals).toHaveLength(3);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});

test("hydrates wallet sign-in authority from the central Identity credential", async () => {
  const subject = "00000000-0000-4000-8000-000000000010";
  const address = "0x1111111111111111111111111111111111111111";
  const query = {
    from() {
      return this;
    },
    limit() {
      return Promise.resolve([{ subject }]);
    },
    where() {
      return this;
    }
  };
  const db = {
    select: () => query
  } as unknown as SentinelDb;
  const adapter = createPeezyIdentityAuthAdapter(config, db, async (input) => {
    expect(input.toString()).toBe(
      `https://identity.peezy.tech/v1/users/${subject}`
    );
    return Response.json({
      credentials: [
        {
          accountKind: "eoa",
          address,
          family: "evm",
          id: "00000000-0000-4000-8000-000000000011",
          kind: "wallet",
          linkedAt: "2026-07-29T00:00:00.000Z",
          signInEnabled: false,
          verifiedChainIds: [1]
        },
        {
          id: "00000000-0000-4000-8000-000000000012",
          kind: "social",
          linkedAt: "2026-07-29T00:00:00.000Z",
          provider: "github"
        }
      ],
      user: {
        createdAt: "2026-07-29T00:00:00.000Z",
        id: subject,
        status: "active"
      }
    });
  });
  const snapshot: AuthSnapshot = {
    channels: [],
    providers: ["siwe"],
    subscription: {
      boardrooms: [],
      minSeverity: "medium",
      mode: "holdings"
    },
    wallets: [
      {
        address,
        alertsEnabled: true,
        canSignIn: true,
        verifiedAt: "2026-07-29T00:00:00.000Z"
      }
    ]
  };

  await expect(
    adapter.hydrateAuthSnapshot?.(subject, snapshot)
  ).resolves.toEqual({
    ...snapshot,
    providers: ["github"],
    wallets: [
      {
        ...snapshot.wallets[0],
        canSignIn: false
      }
    ]
  });
});
