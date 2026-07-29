import { expect, test } from "bun:test";

import type { AuthSnapshot } from "../src/api/auth";
import {
  createPeezyIdentityAuthAdapter,
  createPeezyOidcProviderConfig,
  createTimeoutFetcher
} from "../src/api/peezy-identity";
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
      new Request("http://localhost:8787/auth/peezy/siwe/verify", {
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

test("aborts stalled Identity response bodies at the application deadline", async () => {
  let signal: AbortSignal | undefined;
  const adapter = createPeezyIdentityAuthAdapter(
    config,
    {} as SentinelDb,
    async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Response(new ReadableStream({ start() {} }), {
        headers: { "Content-Type": "application/json" },
        status: 200
      });
    },
    { requestTimeoutMs: 10 }
  );

  await expect(adapter.getSocialProviders?.()).rejects.toThrow(
    "Identity request timed out after 10ms"
  );
  expect(signal?.aborted).toBe(true);
});

test("uses the application deadline for the static Identity OIDC token exchange", async () => {
  let requestInit: RequestInit | undefined;
  let requestUrl: string | undefined;
  let signal: AbortSignal | undefined;
  const oidc = createPeezyOidcProviderConfig(
    config.auth.identity,
    createTimeoutFetcher(
      (input, init) => {
        requestInit = init;
        requestUrl = input.toString();
        signal = init?.signal ?? undefined;
        return new Promise(() => {});
      },
      10
    ),
    async () => null
  );

  expect(oidc).toMatchObject({
    authorizationUrl:
      "https://identity.peezy.tech/api/auth/oauth2/authorize",
    issuer: "https://identity.peezy.tech/api/auth",
    tokenUrl: "https://identity.peezy.tech/api/auth/oauth2/token"
  });
  expect(oidc).not.toHaveProperty("discoveryUrl");
  await expect(
    oidc.getToken?.({
      code: "authorization-code",
      codeVerifier: "pkce-verifier",
      redirectURI: "http://localhost:8787/auth/oauth2/callback/peezy"
    })
  ).rejects.toThrow("Identity request timed out after 10ms");
  expect(requestUrl).toBe(
    "https://identity.peezy.tech/api/auth/oauth2/token"
  );
  expect(requestInit?.method).toBe("POST");
  expect(requestInit?.redirect).toBe("manual");
  expect(new Headers(requestInit?.headers).get("authorization")).toMatch(
    /^Basic /
  );
  const requestBody = requestInit?.body;
  expect(requestBody).toBeInstanceOf(URLSearchParams);
  if (!(requestBody instanceof URLSearchParams)) {
    throw new Error("Expected an OIDC token form body");
  }
  expect(Object.fromEntries(requestBody)).toMatchObject({
    code: "authorization-code",
    code_verifier: "pkce-verifier",
    grant_type: "authorization_code",
    redirect_uri: "http://localhost:8787/auth/oauth2/callback/peezy"
  });
  expect(signal?.aborted).toBe(true);
});

test("rejects oversized Identity credential sets before provisioning", async () => {
  const subject = "00000000-0000-4000-8000-000000000001";
  const address = "0x1111111111111111111111111111111111111111";
  let transactions = 0;
  const db = {
    transaction: () => {
      transactions += 1;
      throw new Error("unexpected provisioning transaction");
    }
  } as unknown as SentinelDb;
  const adapter = createPeezyIdentityAuthAdapter(
    config,
    db,
    async (input) => {
      const pathname = new URL(input.toString()).pathname;
      if (pathname === "/v1/wallet/grants/issue") {
        return Response.json({
          expiresAt: "2026-07-29T00:05:00.000Z",
          grant: "g".repeat(32),
          user: {
            createdAt: "2026-07-29T00:00:00.000Z",
            id: subject,
            status: "active"
          }
        });
      }
      if (pathname === "/v1/wallet/grants/exchange") {
        return Response.json({
          expiresAt: "2026-07-29T00:05:00.000Z",
          subject
        });
      }
      if (pathname === `/v1/users/${subject}`) {
        return Response.json({
          credentials: [
            {
              accountKind: "eoa",
              address,
              family: "evm",
              id: "00000000-0000-4000-8000-000000000002",
              kind: "wallet",
              linkedAt: "2026-07-29T00:00:00.000Z",
              signInEnabled: true,
              verifiedChainIds: [1]
            },
            ...Array.from({ length: 256 }, (_, index) => ({
              id: `00000000-0000-4000-8000-${(index + 3)
                .toString(16)
                .padStart(12, "0")}`,
              kind: "passkey",
              linkedAt: "2026-07-29T00:00:00.000Z"
            }))
          ],
          user: {
            createdAt: "2026-07-29T00:00:00.000Z",
            id: subject,
            status: "active"
          }
        });
      }
      throw new Error(`Unexpected Identity request: ${pathname}`);
    }
  );

  const response = await adapter.handler(
    new Request("http://localhost:8787/auth/peezy/siwe/verify", {
      body: JSON.stringify({
        chainId: 1,
        message: "oversized identity",
        signature: `0x${"ab".repeat(65)}`,
        walletAddress: address
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      },
      method: "POST"
    })
  );

  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({
    message: "peezy.tech identity exceeds the 256-credential provisioning limit"
  });
  expect(transactions).toBe(0);
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
    select: () => query,
    transaction: async (
      callback: (transaction: {
        delete(): {
          where(): Promise<never[]>;
        };
        execute(): Promise<never[]>;
        insert(): {
          values(): Promise<never[]>;
        };
        select(): {
          from(): {
            where(): Promise<Array<{ value: number }>>;
          };
        };
      }) => Promise<unknown>
    ) =>
      callback({
        delete: () => ({
          where: () => Promise.resolve([])
        }),
        execute: () => Promise.resolve([]),
        insert: () => ({
          values: () => Promise.resolve([])
        }),
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ value: 0 }])
          })
        })
      })
  } as unknown as SentinelDb;
  let identityReads = 0;
  const adapter = createPeezyIdentityAuthAdapter(config, db, async (input) => {
    identityReads += 1;
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

  const expected = {
    ...snapshot,
    providers: ["github"],
    wallets: [
      {
        ...snapshot.wallets[0],
        canSignIn: false
      }
    ]
  };
  await expect(
    Promise.all([
      adapter.hydrateAuthSnapshot?.(subject, snapshot),
      adapter.hydrateAuthSnapshot?.(subject, snapshot)
    ])
  ).resolves.toEqual([expected, expected]);
  await expect(
    adapter.hydrateAuthSnapshot?.(subject, snapshot)
  ).resolves.toEqual(expected);
  await expect(
    adapter.hydrateWallet?.(subject, snapshot.wallets[0]!)
  ).resolves.toEqual({
    ...snapshot.wallets[0],
    canSignIn: false
  });
  expect(identityReads).toBe(1);
});
