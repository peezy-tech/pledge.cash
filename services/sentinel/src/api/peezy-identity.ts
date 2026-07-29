import { AsyncLocalStorage } from "node:async_hooks";

import {
  IdentityCapabilitiesSchema,
  type IdentityMeResponse,
  type SocialProvider
} from "@peezy.tech/identity";
import {
  createSocialLinkHandoff,
  createWalletChallenge,
  exchangeWalletGrant,
  getIdentity,
  issueWalletGrant
} from "@peezy.tech/identity-server";
import { betterAuth } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { authorizationCodeRequest, getOAuth2Tokens } from "better-auth/oauth2";
import {
  genericOAuth,
  organization,
  type GenericOAuthConfig
} from "better-auth/plugins";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getAddress } from "viem";
import { z } from "zod";

import type { Config } from "../config";
import type { SentinelDb } from "../db/client";
import {
  authAccounts,
  authVerifications,
  users,
  walletOwners,
  wallets
} from "../db/schema";
import {
  identityQuotaScope,
  takeIdentityQuota
} from "./identity-quota";
import type {
  AddressDto,
  AuthRedirectResponse,
  AuthSiweNonceResponse,
  SocialProviderDto,
  WalletDto
} from "./dto";
import type { AuthAdapter, AuthSnapshot } from "./auth";
import {
  createSentinelAuthDatabaseAdapter,
  internalAuthHeaders
} from "./better-auth";

const PEEZY_PROVIDER_ID = "peezy";
const IDENTITY_REQUEST_TIMEOUT_MS = 2_000;
// Identity v0.1 does not cap a user's total credentials. Fail closed instead
// of skipping conflict checks or building an unbounded migration query.
const IDENTITY_PROVISIONING_MAX_CREDENTIALS = 256;
const IDENTITY_HYDRATION_CACHE_TTL_MS = 60_000;
const IDENTITY_HYDRATION_CACHE_MAX_ENTRIES = 1_000;
const IDENTITY_PRESENTATION_READ_WINDOW_MS = 5 * 60_000;
// Identity v0.1 allows 300 reads per client and window. Hydration and social
// callbacks share 240 reads, leaving 60 for wallet sign-in and linking.
const IDENTITY_PRESENTATION_READ_BUDGET = 240;
const SOCIAL_PROVIDERS = new Set<SocialProvider>([
  "apple",
  "discord",
  "github",
  "telegram",
  "twitter"
]);

type IdentityConfig = NonNullable<Config["auth"]["identity"]>;
type IdentityFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type PeezyIdentityAuthAdapterOptions = {
  readonly hydrationCacheMs?: number;
  readonly requestTimeoutMs?: number;
};
type IdentityHydrator = {
  get(subject: string): Promise<IdentityMeResponse>;
  getFresh(subject: string): Promise<IdentityMeResponse>;
  invalidate(subject: string): void;
  set(subject: string, identity: IdentityMeResponse): void;
};
type SentinelTransaction = Parameters<Parameters<SentinelDb["transaction"]>[0]>[0];

export function createPeezyIdentityAuthAdapter(
  config: Pick<Config, "auth" | "webOrigin">,
  db: SentinelDb,
  fetcher: IdentityFetch = fetch,
  options: PeezyIdentityAuthAdapterOptions = {}
): AuthAdapter {
  if (config.auth.identity === undefined) {
    throw new Error("peezy.tech Identity is not configured");
  }
  const identity = config.auth.identity;
  const identityFetcher = createTimeoutFetcher(
    fetcher,
    options.requestTimeoutMs ?? IDENTITY_REQUEST_TIMEOUT_MS
  );
  const gateway = createIdentityGateway(identity, config.webOrigin, identityFetcher);
  const identityHydrator = createIdentityHydrator(
    gateway,
    db,
    identity.clientId,
    options.hydrationCacheMs ?? IDENTITY_HYDRATION_CACHE_TTL_MS
  );
  const requestContext = new AsyncLocalStorage<{
    readonly linkUserId?: string;
  }>();
  const auth = betterAuth({
    appName: "pledge.cash",
    basePath: "/auth",
    baseURL: config.auth.baseUrl,
    secret: config.auth.secret,
    trustedOrigins: [new URL(config.webOrigin).origin],
    database: createSentinelAuthDatabaseAdapter(db),
    user: {
      modelName: "users"
    },
    session: {
      modelName: "authSessions"
    },
    account: {
      modelName: "authAccounts",
      encryptOAuthTokens: true,
      storeStateStrategy: "database",
      accountLinking: {
        allowDifferentEmails: true,
        allowUnlinkingAll: false,
        disableImplicitLinking: true,
        enabled: true,
        trustedProviders: [PEEZY_PROVIDER_ID],
        updateUserInfoOnLink: false
      }
    },
    verification: {
      modelName: "authVerifications"
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => ({
            data: {
              ...account,
              accessToken: null,
              accessTokenExpiresAt: null,
              idToken: null,
              refreshToken: null,
              refreshTokenExpiresAt: null
            }
          })
        },
        update: {
          before: async (account) => ({
            data: {
              ...account,
              accessToken: null,
              accessTokenExpiresAt: null,
              idToken: null,
              refreshToken: null,
              refreshTokenExpiresAt: null
            }
          })
        }
      }
    },
    advanced: {
      cookiePrefix: "pledge-cash",
      database: { generateId: "uuid" },
      useSecureCookies: new URL(config.auth.baseUrl).protocol === "https:"
    },
    rateLimit: {
      enabled: true,
      storage: "memory"
    },
    telemetry: { enabled: false },
    plugins: [
      genericOAuth({
        config: [
          createPeezyOidcProviderConfig(
            identity,
            identityFetcher,
            async (tokens) => {
              if (tokens.accessToken === undefined) return null;
              const profile = await fetchIdentityProfile(
                identity.baseUrl,
                tokens.accessToken,
                identityFetcher
              );
              const centralIdentity = await identityHydrator.getFresh(
                profile.sub
              );
              const linkUserId = requestContext.getStore()?.linkUserId;
              const productUser = await provisionProductUser(db, centralIdentity, {
                ...(linkUserId === undefined ? {} : { requiredUserId: linkUserId })
              });
              return {
                email: productUser.email,
                emailVerified: productUser.emailVerified,
                id: profile.sub,
                ...(productUser.image === null
                  ? {}
                  : { image: productUser.image }),
                name: productUser.name,
                sub: profile.sub
              };
            }
          )
        ]
      }),
      peezyWalletSessionPlugin(gateway, db, identityHydrator),
      organization({
        allowUserToCreateOrganization: false,
        requireEmailVerificationOnInvitation: true,
        schema: {
          invitation: { modelName: "organizationInvitations" },
          member: { modelName: "organizationMembers" },
          organization: { modelName: "organizations" },
          session: { fields: { activeOrganizationId: "activeOrganizationId" } }
        }
      })
    ]
  });

  return {
    socialProviders: [],
    sharedIdentityClientId: identity.clientId,
    usesSharedIdentity: true,
    async createWalletChallenge({ address, chainId, purpose, userId }) {
      const subject =
        purpose === "link" && userId !== undefined
          ? await identitySubjectForProductUser(db, userId)
          : undefined;
      return gateway.createWalletChallenge({
        address,
        chainId,
        purpose:
          purpose === "link" && subject === undefined ? "sign-in" : purpose
      });
    },
    async hydrateAuthSnapshot(userId, snapshot) {
      const subject = await identitySubjectForProductUser(db, userId);
      if (subject === undefined) {
        return {
          ...snapshot,
          providers: [],
          wallets: snapshot.wallets.map((wallet) => ({
            ...wallet,
            canSignIn: false
          }))
        };
      }
      const identityUser = await identityHydrator.get(subject);
      return hydrateIdentitySnapshot(snapshot, identityUser);
    },
    async getSocialProviders() {
      const capabilities = await gateway.capabilities();
      return capabilities.socialProviders;
    },
    async getSession(input) {
      const session = await auth.api.getSession({ headers: input.headers });
      return session === null ? null : { user: { id: session.user.id } };
    },
    async handler(request) {
      const linkUserId = await identityLinkUserForCallback(db, request);
      return requestContext.run(
        linkUserId === undefined ? {} : { linkUserId },
        () => auth.handler(request)
      );
    },
    async linkWalletCredential(input) {
      const subject = await identitySubjectForProductUser(db, input.userId);
      return linkIdentityWalletCredential(
        db,
        gateway,
        identityHydrator,
        {
          ...input,
          ...(subject === undefined ? {} : { subject })
        }
      );
    },
    async startSocial(input): Promise<{
      headers?: Headers;
      response: AuthRedirectResponse;
    }> {
      if (input.link) {
        if (input.userId === undefined) {
          throw new Error("A PledgeCash session is required to link a social credential");
        }
        const subject = await identitySubjectForProductUser(db, input.userId);
        if (subject === undefined) {
          const response = await auth.handler(
            new Request(`${config.auth.baseUrl}/auth/oauth2/link`, {
              body: JSON.stringify({
                callbackURL: input.request.callbackURL,
                ...(input.request.errorCallbackURL === undefined
                  ? {}
                  : { errorCallbackURL: input.request.errorCallbackURL }),
                providerId: PEEZY_PROVIDER_ID
              }),
              headers: internalAuthHeaders(input.headers),
              method: "POST"
            })
          );
          if (!response.ok) {
            throw new Error(
              `peezy.tech OIDC account migration failed with status ${response.status}`
            );
          }
          const result = (await response.json()) as AuthRedirectResponse;
          if (result.url !== undefined) {
            const authorizationUrl = new URL(result.url);
            authorizationUrl.searchParams.set(
              "login_hint",
              input.request.provider
            );
            result.url = authorizationUrl.toString();
          }
          return {
            headers: response.headers,
            response: result
          };
        }
        const handoff = await gateway.createSocialLinkHandoff({
          callbackUrl: input.request.callbackURL,
          provider: input.request.provider,
          subject
        });
        identityHydrator.invalidate(subject);
        return {
          response: { redirect: true, url: handoff.url }
        };
      }

      const response = await auth.handler(
        new Request(`${config.auth.baseUrl}/auth/sign-in/oauth2`, {
          body: JSON.stringify({
            additionalData: { provider: input.request.provider },
            callbackURL: input.request.callbackURL,
            ...(input.request.errorCallbackURL === undefined
              ? {}
              : { errorCallbackURL: input.request.errorCallbackURL }),
            providerId: PEEZY_PROVIDER_ID,
            requestSignUp: true
          }),
          headers: internalAuthHeaders(input.headers),
          method: "POST"
        })
      );
      if (!response.ok) {
        throw new Error(
          `peezy.tech OIDC sign-in failed with status ${response.status}`
        );
      }
      return {
        headers: response.headers,
        response: (await response.json()) as AuthRedirectResponse
      };
    }
  };
}

export function createPeezyOidcProviderConfig(
  identity: Pick<
    IdentityConfig,
    "baseUrl" | "clientId" | "oidcClientSecret"
  >,
  fetcher: IdentityFetch,
  getUserInfo: NonNullable<GenericOAuthConfig["getUserInfo"]>
): GenericOAuthConfig {
  const issuer = `${identity.baseUrl}/api/auth`;
  const tokenUrl = `${issuer}/oauth2/token`;

  return {
    authentication: "basic",
    authorizationUrl: `${issuer}/oauth2/authorize`,
    authorizationUrlParams: (context) => {
      const provider = context.body.additionalData?.provider;
      return isSocialProvider(provider) ? { login_hint: provider } : {};
    },
    clientId: identity.clientId,
    clientSecret: identity.oidcClientSecret,
    getToken: async ({ code, codeVerifier, redirectURI }) => {
      const request = await authorizationCodeRequest({
        authentication: "basic",
        code,
        ...(codeVerifier === undefined ? {} : { codeVerifier }),
        options: {
          clientId: identity.clientId,
          clientSecret: identity.oidcClientSecret,
          redirectURI
        },
        redirectURI
      });
      const response = await fetcher(tokenUrl, {
        body: request.body,
        headers: request.headers,
        method: "POST",
        redirect: "manual"
      });
      if (
        response.type === "opaqueredirect" ||
        (response.status >= 300 && response.status < 400)
      ) {
        throw new Error("Identity OIDC token endpoint returned a redirect");
      }
      if (!response.ok) {
        throw new Error(
          `Identity OIDC token exchange failed with status ${response.status}`
        );
      }
      return getOAuth2Tokens(
        z.record(z.unknown()).parse(await response.json())
      );
    },
    getUserInfo,
    issuer,
    pkce: true,
    providerId: PEEZY_PROVIDER_ID,
    requireIssuerValidation: true,
    scopes: ["openid", "profile", "email"],
    tokenUrl
  };
}

function hydrateIdentitySnapshot(
  snapshot: AuthSnapshot,
  identity: IdentityMeResponse
): AuthSnapshot {
  const providers = new Set<AuthSnapshot["providers"][number]>();
  const walletSignIn = new Map<string, boolean>();
  for (const credential of identity.credentials) {
    if (credential.kind === "wallet") {
      walletSignIn.set(credential.address.toLowerCase(), credential.signInEnabled);
      if (credential.signInEnabled) providers.add("siwe");
    }
    if (credential.kind === "social") providers.add(credential.provider);
  }
  return {
    ...snapshot,
    providers: [...providers],
    wallets: snapshot.wallets.map((wallet) => ({
      ...wallet,
      canSignIn: walletSignIn.get(wallet.address.toLowerCase()) ?? false
    }))
  };
}

async function identityLinkUserForCallback(
  db: SentinelDb,
  request: Request
): Promise<string | undefined> {
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.pathname !== `/auth/oauth2/callback/${PEEZY_PROVIDER_ID}`
  ) {
    return undefined;
  }
  const state = url.searchParams.get("state");
  if (state === null) return undefined;
  const [verification] = await db
    .select({ value: authVerifications.value })
    .from(authVerifications)
    .where(eq(authVerifications.identifier, state))
    .limit(1);
  if (verification === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(verification.value);
  } catch {
    return undefined;
  }
  const parsed = z
    .object({
      link: z
        .object({
          userId: z.string().uuid()
        })
        .optional()
    })
    .passthrough()
    .safeParse(value);
  return parsed.success ? parsed.data.link?.userId : undefined;
}

function peezyWalletSessionPlugin(
  gateway: ReturnType<typeof createIdentityGateway>,
  db: SentinelDb,
  identityHydrator: IdentityHydrator
) {
  return {
    id: "peezy-wallet-session",
    endpoints: {
      getPeezyWalletChallenge: createAuthEndpoint(
        "/siwe/nonce",
        {
          method: "POST",
          body: z.object({
            chainId: z.number().int().positive(),
            walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/)
          })
        },
        async (context) => {
          const challenge = await gateway.createWalletChallenge({
            address: context.body.walletAddress,
            chainId: context.body.chainId,
            purpose: "sign-in"
          });
          return context.json(challenge);
        }
      ),
      verifyPeezyWallet: createAuthEndpoint(
        "/siwe/verify",
        {
          method: "POST",
          body: z.object({
            chainId: z.number().int().positive(),
            message: z.string().min(1),
            signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
            walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/)
          })
        },
        async (context) => {
          try {
            const issued = await gateway.issueWalletGrant({
              message: context.body.message,
              signature: context.body.signature
            });
            identityHydrator.invalidate(issued.user.id);
            const exchanged = await gateway.exchangeWalletGrant(issued.grant);
            if (exchanged.subject !== issued.user.id) {
              throw new Error("Wallet grant subject mismatch");
            }
            const centralIdentity = await gateway.getIdentity(exchanged.subject);
            identityHydrator.set(exchanged.subject, centralIdentity);
            const address = getAddress(context.body.walletAddress).toLowerCase() as AddressDto;
            const verifiedWallet = centralIdentity.credentials.find(
              (credential) =>
                credential.kind === "wallet" &&
                credential.address === address &&
                credential.verifiedChainIds.includes(context.body.chainId)
            );
            if (verifiedWallet?.kind !== "wallet") {
              throw new Error("Wallet grant did not verify the requested wallet");
            }
            const productUser = await provisionProductUser(db, centralIdentity, {
              walletCoverage: {
                address,
                canSignIn: verifiedWallet.signInEnabled,
                chainId: context.body.chainId,
                siweMessage: context.body.message,
                verifiedAt: new Date()
              }
            });
            const session = await context.context.internalAdapter.createSession(
              productUser.id
            );
            if (session === null) {
              throw new Error("PledgeCash session could not be created");
            }
            await setSessionCookie(context, {
              session,
              user: productUser
            });
            return context.json({
              success: true,
              token: session.token,
              user: {
                id: productUser.id
              }
            });
          } catch (error) {
            throw new APIError("UNAUTHORIZED", {
              message:
                error instanceof Error
                  ? error.message
                  : "Wallet signature could not be verified"
            });
          }
        }
      )
    }
  } as const;
}

function createIdentityGateway(
  identity: IdentityConfig,
  webOrigin: string,
  fetcher: IdentityFetch
) {
  const client = {
    baseUrl: identity.baseUrl,
    clientId: identity.clientId,
    clientSecret: identity.appClientSecret,
    fetcher
  };
  return {
    async capabilities() {
      const response = await fetcher(`${identity.baseUrl}/v1/capabilities`, {
        headers: { Accept: "application/json" }
      });
      if (!response.ok) {
        throw new Error(`Identity capabilities failed with status ${response.status}`);
      }
      return IdentityCapabilitiesSchema.parse(await response.json());
    },
    createSocialLinkHandoff: (input: {
      callbackUrl: string;
      provider: SocialProviderDto;
      subject: string;
    }) => createSocialLinkHandoff({ ...client, ...input }),
    createWalletChallenge: (input: {
      address: string;
      chainId: number;
      purpose: "link" | "sign-in";
    }) =>
      createWalletChallenge({
        ...client,
        ...input,
        origin: webOrigin
      }),
    exchangeWalletGrant: (grant: string) =>
      exchangeWalletGrant({ ...client, grant }),
    getIdentity: (subject: string) => getIdentity({ ...client, subject }),
    issueWalletGrant: (input: {
      message: string;
      signature: string;
      subject?: string;
    }) => issueWalletGrant({ ...client, ...input })
  };
}

function createIdentityHydrator(
  gateway: ReturnType<typeof createIdentityGateway>,
  db: SentinelDb,
  clientId: string,
  cacheTtlMs: number
): IdentityHydrator {
  const cache = new Map<
    string,
    { readonly expiresAt: number; readonly identity: IdentityMeResponse }
  >();
  const pending = new Map<
    string,
    { readonly read: Promise<IdentityMeResponse>; readonly token: symbol }
  >();
  const ttlMs = Math.max(0, cacheTtlMs);

  const cacheIdentity = (subject: string, identity: IdentityMeResponse) => {
    cache.delete(subject);
    if (ttlMs <= 0) return;
    cache.set(subject, { expiresAt: Date.now() + ttlMs, identity });
    while (cache.size > IDENTITY_HYDRATION_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const readIdentity = (subject: string, now: number) => {
    const token = Symbol(subject);
    const read = takeIdentityQuota(db, {
      capacity: IDENTITY_PRESENTATION_READ_BUDGET,
      now: new Date(now),
      scope: identityQuotaScope(clientId, "presentation-read"),
      windowMs: IDENTITY_PRESENTATION_READ_WINDOW_MS
    })
      .then((admitted) => {
        if (!admitted) {
          throw new Error("Identity presentation read budget exhausted");
        }
        return gateway.getIdentity(subject);
      })
      .then((identity) => {
        if (pending.get(subject)?.token === token) {
          cacheIdentity(subject, identity);
        }
        return identity;
      })
      .finally(() => {
        if (pending.get(subject)?.token === token) {
          pending.delete(subject);
        }
      });
    pending.set(subject, { read, token });
    return read;
  };

  return {
    async get(subject) {
      const now = Date.now();
      const cached = cache.get(subject);
      if (cached !== undefined && cached.expiresAt > now) {
        return cached.identity;
      }
      cache.delete(subject);

      const pendingRead = pending.get(subject);
      if (pendingRead !== undefined) return pendingRead.read;

      return readIdentity(subject, now);
    },
    getFresh(subject) {
      // Provisioning must not reuse credentials fetched before this callback.
      cache.delete(subject);
      pending.delete(subject);
      return readIdentity(subject, Date.now());
    },
    invalidate(subject) {
      cache.delete(subject);
      pending.delete(subject);
    },
    set(subject, identity) {
      pending.delete(subject);
      cacheIdentity(subject, identity);
    }
  };
}

export function createTimeoutFetcher(
  fetcher: IdentityFetch,
  timeoutMs: number
): IdentityFetch {
  return async (input, init) => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const clearDeadline = () => {
      if (timeout === undefined) return;
      clearTimeout(timeout);
      timeout = undefined;
    };
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error(`Identity request timed out after ${timeoutMs}ms`);
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });

    let response: Response;
    try {
      response = await Promise.race([
        fetcher(input, { ...init, signal: controller.signal }),
        deadline
      ]);
    } catch (error) {
      clearDeadline();
      throw error;
    }

    if (response.body === null) {
      clearDeadline();
      return response;
    }

    const reader = response.body.getReader();
    const timedBody = new ReadableStream<Uint8Array>({
      async pull(bodyController) {
        try {
          const result = await Promise.race([reader.read(), deadline]);
          if (result.done) {
            clearDeadline();
            bodyController.close();
            return;
          }
          bodyController.enqueue(result.value);
        } catch (error) {
          clearDeadline();
          bodyController.error(error);
          void reader.cancel(error).catch(() => undefined);
        }
      },
      cancel(reason) {
        clearDeadline();
        controller.abort(reason);
        return reader.cancel(reason);
      }
    });
    const timedResponse = new Response(timedBody, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText
    });
    Object.defineProperties(timedResponse, {
      redirected: { value: response.redirected },
      type: { value: response.type },
      url: { value: response.url }
    });
    return timedResponse;
  };
}

async function provisionProductUser(
  db: SentinelDb,
  identity: IdentityMeResponse,
  options: {
    readonly requiredUserId?: string;
    readonly walletCoverage?: {
      readonly address: AddressDto;
      readonly canSignIn: boolean;
      readonly chainId: number;
      readonly siweMessage: string;
      readonly verifiedAt: Date;
    };
  } = {}
): Promise<typeof users.$inferSelect> {
  assertProvisionableIdentity(identity);
  return db.transaction(async (transaction) => {
    const identityUser = identity.user;
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`peezy-user:${identityUser.id}`}))`
    );
    if (options.walletCoverage !== undefined) {
      await lockWalletAddress(transaction, options.walletCoverage.address);
    }

    const candidateUserIds = await identityCandidateUserIds(
      transaction,
      identity,
      options.requiredUserId
    );

    if (candidateUserIds.size > 1) {
      throw new Error("peezy.tech credentials resolve to multiple PledgeCash users");
    }

    let productUserId = candidateUserIds.values().next().value as string | undefined;
    if (productUserId === undefined) {
      if (identityUser.primaryEmail !== undefined) {
        const [emailOwner] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = lower(${identityUser.primaryEmail.value})`)
          .limit(1);
        if (emailOwner !== undefined) {
          throw new Error(
            "Existing PledgeCash account requires an explicit peezy.tech identity migration"
          );
        }
      }

      const fallbackEmail = `${identityUser.id}@identity.pledge.cash.invalid`;
      await transaction
        .insert(users)
        .values({
          createdAt: new Date(identityUser.createdAt),
          email: identityUser.primaryEmail?.value ?? fallbackEmail,
          emailVerified: identityUser.primaryEmail?.verified ?? false,
          id: identityUser.id,
          image: identityUser.avatarUrl,
          name: identityUser.displayName ?? "peezy.tech user",
          updatedAt: new Date()
        })
        .onConflictDoNothing();
      productUserId = identityUser.id;
    }

    const [productUser] = await transaction
      .select()
      .from(users)
      .where(eq(users.id, productUserId))
      .limit(1);
    if (productUser === undefined) {
      throw new Error("PledgeCash identity shadow could not be provisioned");
    }

    await bindIdentitySubject(
      transaction,
      identityUser.id,
      productUser.id
    );
    if (options.walletCoverage !== undefined) {
      await upsertWalletCoverage(transaction, {
        ...options.walletCoverage,
        reenableAlerts: false,
        userId: productUser.id
      });
    }
    return productUser;
  });
}

async function identityCandidateUserIds(
  transaction: SentinelTransaction,
  identity: IdentityMeResponse,
  requiredUserId?: string
): Promise<Set<string>> {
  const candidateUserIds = new Set<string>();
  if (requiredUserId !== undefined) candidateUserIds.add(requiredUserId);

  const [mappedAccount] = await transaction
    .select({ userId: authAccounts.userId })
    .from(authAccounts)
    .where(
      and(
        eq(authAccounts.providerId, PEEZY_PROVIDER_ID),
        eq(authAccounts.accountId, identity.user.id)
      )
    )
    .limit(1);
  if (mappedAccount !== undefined) candidateUserIds.add(mappedAccount.userId);

  const [sameSubjectUser] = await transaction
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, identity.user.id))
    .limit(1);
  if (sameSubjectUser !== undefined) candidateUserIds.add(sameSubjectUser.id);

  const walletAddresses = new Set<string>();
  const socialProvidersByCredentialId = new Map<string, Set<SocialProvider>>();
  for (const credential of identity.credentials) {
    if (credential.kind === "wallet") {
      walletAddresses.add(credential.address);
    }
    if (credential.kind === "social") {
      const providers =
        socialProvidersByCredentialId.get(credential.id) ??
        new Set<SocialProvider>();
      providers.add(credential.provider);
      socialProvidersByCredentialId.set(credential.id, providers);
    }
  }

  if (walletAddresses.size > 0) {
    const owners = await transaction
      .select({ userId: walletOwners.userId })
      .from(walletOwners)
      .where(inArray(walletOwners.address, [...walletAddresses]));
    for (const owner of owners) candidateUserIds.add(owner.userId);
  }

  if (socialProvidersByCredentialId.size > 0) {
    const legacyAccounts = await transaction
      .select({
        id: authAccounts.id,
        providerId: authAccounts.providerId,
        userId: authAccounts.userId
      })
      .from(authAccounts)
      .where(
        inArray(authAccounts.id, [...socialProvidersByCredentialId.keys()])
      );
    for (const account of legacyAccounts) {
      if (
        socialProvidersByCredentialId
          .get(account.id)
          ?.has(account.providerId as SocialProvider)
      ) {
        candidateUserIds.add(account.userId);
      }
    }
  }
  return candidateUserIds;
}

function assertProvisionableIdentity(identity: IdentityMeResponse): void {
  if (identity.credentials.length > IDENTITY_PROVISIONING_MAX_CREDENTIALS) {
    throw new Error(
      `peezy.tech identity exceeds the ${IDENTITY_PROVISIONING_MAX_CREDENTIALS}-credential provisioning limit`
    );
  }
}

async function identitySubjectForProductUser(
  db: SentinelDb,
  userId: string
): Promise<string | undefined> {
  const accounts = await db
    .select({ subject: authAccounts.accountId })
    .from(authAccounts)
    .where(
      and(
        eq(authAccounts.providerId, PEEZY_PROVIDER_ID),
        eq(authAccounts.userId, userId)
      )
    )
    .limit(2);
  if (accounts.length > 1) {
    throw new Error("PledgeCash user is linked to multiple peezy.tech subjects");
  }
  return accounts[0]?.subject;
}

async function bindIdentitySubject(
  transaction: SentinelTransaction,
  subject: string,
  userId: string
): Promise<void> {
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`peezy-product-user:${userId}`}))`
  );
  const [existingUserAccount] = await transaction
    .select({ subject: authAccounts.accountId })
    .from(authAccounts)
    .where(
      and(
        eq(authAccounts.providerId, PEEZY_PROVIDER_ID),
        eq(authAccounts.userId, userId)
      )
    )
    .limit(1);
  if (
    existingUserAccount !== undefined &&
    existingUserAccount.subject !== subject
  ) {
    throw new Error("PledgeCash user is linked to another peezy.tech subject");
  }
  await transaction
    .insert(authAccounts)
    .values({
      accountId: subject,
      createdAt: new Date(),
      providerId: PEEZY_PROVIDER_ID,
      updatedAt: new Date(),
      userId
    })
    .onConflictDoNothing();
  const [identityAccount] = await transaction
    .select({ userId: authAccounts.userId })
    .from(authAccounts)
    .where(
      and(
        eq(authAccounts.providerId, PEEZY_PROVIDER_ID),
        eq(authAccounts.accountId, subject)
      )
    )
    .limit(1);
  if (identityAccount?.userId !== userId) {
    throw new Error("peezy.tech subject is linked to another PledgeCash user");
  }
}

async function linkIdentityWalletCredential(
  db: SentinelDb,
  gateway: ReturnType<typeof createIdentityGateway>,
  identityHydrator: IdentityHydrator,
  input: {
    readonly address: AddressDto;
    readonly chainId: number;
    readonly message: string;
    readonly signature: string;
    readonly subject?: string;
    readonly userId: string;
    readonly verifiedAt: Date;
  }
): Promise<WalletDto> {
  await assertWalletOwnerAvailable(db, input.address, input.userId);
  const issued = await gateway.issueWalletGrant({
    message: input.message,
    signature: input.signature,
    ...(input.subject === undefined ? {} : { subject: input.subject })
  });
  identityHydrator.invalidate(issued.user.id);
  const exchanged = await gateway.exchangeWalletGrant(issued.grant);
  if (
    exchanged.subject !== issued.user.id ||
    (input.subject !== undefined && exchanged.subject !== input.subject)
  ) {
    throw new Error("Identity wallet grant resolved to another subject");
  }
  const centralIdentity = await gateway.getIdentity(exchanged.subject);
  identityHydrator.set(exchanged.subject, centralIdentity);
  assertProvisionableIdentity(centralIdentity);
  const centralWallet = centralIdentity.credentials.find(
    (credential) =>
      credential.kind === "wallet" &&
      credential.address.toLowerCase() === input.address.toLowerCase() &&
      credential.verifiedChainIds.includes(input.chainId)
  );
  if (centralWallet?.kind !== "wallet") {
    throw new Error("Identity wallet grant did not link the requested wallet");
  }

  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`peezy-user:${centralIdentity.user.id}`}))`
    );
    await lockWalletAddress(transaction, input.address);
    const candidateUserIds = await identityCandidateUserIds(
      transaction,
      centralIdentity,
      input.userId
    );
    if (candidateUserIds.size > 1) {
      throw new Error("peezy.tech credentials resolve to multiple PledgeCash users");
    }
    await bindIdentitySubject(transaction, exchanged.subject, input.userId);
    return upsertWalletCoverage(transaction, {
      address: input.address,
      canSignIn: centralWallet.signInEnabled,
      chainId: input.chainId,
      reenableAlerts: true,
      siweMessage: input.message,
      userId: input.userId,
      verifiedAt: input.verifiedAt
    });
  });
}

async function assertWalletOwnerAvailable(
  db: SentinelDb | SentinelTransaction,
  address: AddressDto,
  userId: string
): Promise<void> {
  const [owner] = await db
    .select({ userId: walletOwners.userId })
    .from(walletOwners)
    .where(eq(walletOwners.address, address))
    .limit(1);
  if (owner !== undefined && owner.userId !== userId) {
    throw new Error("Wallet is already linked to another account");
  }
}

async function lockWalletAddress(
  transaction: SentinelTransaction,
  address: AddressDto
): Promise<void> {
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(lower(${address})))`
  );
}

async function upsertWalletCoverage(
  transaction: SentinelTransaction,
  input: {
    readonly address: AddressDto;
    readonly canSignIn: boolean;
    readonly chainId: number;
    readonly reenableAlerts: boolean;
    readonly siweMessage: string;
    readonly userId: string;
    readonly verifiedAt: Date;
  }
): Promise<WalletDto> {
  const checksumAddress = getAddress(input.address);
  await transaction
    .insert(wallets)
    .values({
      address: checksumAddress,
      alertsEnabled: true,
      chainId: input.chainId,
      siweMessage: input.siweMessage,
      userId: input.userId,
      verifiedAt: input.verifiedAt
    })
    .onConflictDoNothing();

  const [existing] = await transaction
    .select({ userId: wallets.userId })
    .from(wallets)
    .where(
      and(
        eq(wallets.chainId, input.chainId),
        sql`lower(${wallets.address}) = lower(${checksumAddress})`
      )
    )
    .for("update")
    .limit(1);
  if (existing?.userId !== input.userId) {
    throw new Error("Wallet is already linked to another account");
  }

  const [row] = await transaction
    .update(wallets)
    .set({
      ...(input.reenableAlerts ? { alertsEnabled: true } : {}),
      siweMessage: input.siweMessage,
      verifiedAt: input.verifiedAt
    })
    .where(
      and(
        eq(wallets.userId, input.userId),
        eq(wallets.chainId, input.chainId),
        sql`lower(${wallets.address}) = lower(${checksumAddress})`
      )
    )
    .returning();
  if (row === undefined) {
    throw new Error("PledgeCash wallet coverage could not be provisioned");
  }
  return {
    address: row.address.toLowerCase() as AddressDto,
    alertsEnabled: row.alertsEnabled,
    canSignIn: input.canSignIn,
    verifiedAt: row.verifiedAt.toISOString()
  };
}

async function fetchIdentityProfile(
  baseUrl: string,
  accessToken: string,
  fetcher: IdentityFetch
): Promise<{ sub: string }> {
  const response = await fetcher(`${baseUrl}/api/auth/oauth2/userinfo`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) {
    throw new Error(`Identity userinfo failed with status ${response.status}`);
  }
  return z.object({ sub: z.string().uuid() }).parse(await response.json());
}

function isSocialProvider(value: unknown): value is SocialProvider {
  return typeof value === "string" && SOCIAL_PROVIDERS.has(value as SocialProvider);
}

export type PeezyWalletChallenge = AuthSiweNonceResponse & {
  readonly address: AddressDto;
  readonly chainId: number;
  readonly domain: string;
  readonly expirationTime: string;
  readonly issuedAt: string;
  readonly statement: string;
  readonly uri: string;
  readonly version: "1";
};
