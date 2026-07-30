import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

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
import { and, eq, gt, inArray, lt, lte, sql } from "drizzle-orm";
import { getAddress } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { z } from "zod";

import type { Config } from "../config";
import type { SentinelDb } from "../db/client";
import {
  authAccounts,
  authWallets,
  authVerifications,
  identityWalletLinkReconciliations,
  legacySiweNonces,
  users,
  walletOwners,
  wallets
} from "../db/schema";
import {
  identityQuotaScope,
  takeIdentityQuota,
  takeIdentityQuotaInTransaction
} from "./identity-quota";
import {
  AUTH_SIWE_MAX_MESSAGE_LENGTH,
  type AddressDto,
  type AuthRedirectResponse,
  type AuthSiweNonceResponse,
  type SocialProviderDto,
  type WalletDto
} from "./dto";
import {
  AuthRateLimitError,
  AuthSocialDependencyError,
  AuthWalletCredentialRejectedError,
  type AuthAdapter,
  type AuthSnapshot
} from "./auth";
import {
  createSentinelAuthDatabaseAdapter,
  createPledgeCashSiweVerifier,
  ALERTS_SIWE_STATEMENT,
  internalAuthHeaders,
  WALLET_LINK_SIWE_STATEMENT
} from "./better-auth";

const PEEZY_PROVIDER_ID = "peezy";
const IDENTITY_REQUEST_TIMEOUT_MS = 2_000;
// Identity v0.1 does not cap a user's total credentials. Fail closed instead
// of skipping conflict checks or building an unbounded migration query.
const IDENTITY_PROVISIONING_MAX_CREDENTIALS = 256;
const IDENTITY_RECORD_MAX_BYTES = 256 * 1024;
const IDENTITY_HYDRATION_CACHE_TTL_MS = 60_000;
const IDENTITY_HYDRATION_CACHE_MAX_ENTRIES = 1_000;
const IDENTITY_PRESENTATION_READ_WINDOW_MS = 5 * 60_000;
const IDENTITY_WALLET_LINK_WINDOW_MS = 5 * 60_000;
const IDENTITY_WALLET_LINK_LIMIT = 10;
// Identity v0.1 allows 300 reads per client and window. Wallet sign-in reserves
// 50 reads and ten wallet links reserve two reads each, leaving 230 for
// presentation hydration and social callbacks.
const IDENTITY_PRESENTATION_READ_BUDGET = 230;
const LEGACY_SIWE_NONCE_TTL_MS = 15 * 60_000;
const IDENTITY_PENDING_LINK_LIMIT = 10;
const IDENTITY_PENDING_LINK_TTL_MS = 5 * 60_000;
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
type IdentityRequestContext = {
  readonly clientIp?: string;
  readonly linkUserId?: string;
};
type IdentityHydrator = {
  get(subject: string): Promise<IdentityMeResponse>;
  getWithFreshness(subject: string): Promise<{
    readonly fresh: boolean;
    readonly identity: IdentityMeResponse;
  }>;
  getFresh(subject: string): Promise<IdentityMeResponse>;
  invalidate(subject: string): void;
  set(subject: string, identity: IdentityMeResponse): void;
};
type SentinelTransaction = Parameters<Parameters<SentinelDb["transaction"]>[0]>[0];

export async function discardOAuthTokensForSharedIdentity(
  db: SentinelDb
): Promise<void> {
  await db
    .update(authAccounts)
    .set({
      accessToken: null,
      accessTokenExpiresAt: null,
      idToken: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      updatedAt: new Date()
    })
    .where(
      sql`${authAccounts.accessToken} IS NOT NULL
        OR ${authAccounts.accessTokenExpiresAt} IS NOT NULL
        OR ${authAccounts.idToken} IS NOT NULL
        OR ${authAccounts.refreshToken} IS NOT NULL
        OR ${authAccounts.refreshTokenExpiresAt} IS NOT NULL`
    );
}

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
  const requestContext = new AsyncLocalStorage<IdentityRequestContext>();
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
      peezyWalletSessionPlugin(
        gateway,
        db,
        identityHydrator,
        config.webOrigin,
        requestContext
      ),
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
    async createWalletChallenge({ address, chainId, clientIp, purpose }) {
      return gateway.createWalletChallenge({
        address,
        chainId,
        purpose,
        ...(clientIp === undefined ? {} : { forwardedFor: clientIp })
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
      const reconciledWallets = await reconcilePendingIdentityWalletLinks(
        db,
        subject,
        identityUser
      );
      return hydrateIdentitySnapshot(
        mergeReconciledWallets(snapshot, reconciledWallets),
        identityUser
      );
    },
    async hydrateWallet(userId, wallet) {
      const subject = await identitySubjectForProductUser(db, userId);
      if (subject === undefined) {
        return { ...wallet, canSignIn: false };
      }
      const identityUser = await identityHydrator.get(subject);
      return hydrateIdentityWallet(wallet, identityUser);
    },
    async getSocialProviders() {
      const capabilities = await gateway.capabilities();
      return capabilities.socialProviders;
    },
    async getSession(input) {
      const session = await auth.api.getSession({ headers: input.headers });
      return session === null ? null : { user: { id: session.user.id } };
    },
    async handler(request, handlerContext) {
      const identityRequest = rewriteLegacyWalletAuthRequest(request);
      const linkUserId = await identityLinkUserForCallback(db, identityRequest);
      return requestContext.run(
        {
          ...(handlerContext?.clientIp === undefined
            ? {}
            : { clientIp: handlerContext.clientIp }),
          ...(linkUserId === undefined ? {} : { linkUserId })
        },
        () => auth.handler(identityRequest)
      );
    },
    async linkWalletCredential(input) {
      const subject = await identitySubjectForProductUser(db, input.userId);
      return linkIdentityWalletCredential(
        db,
        gateway,
        identityHydrator,
        identity.clientId,
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
              headers: internalAuthHeaders(input.headers, input.clientIp),
              method: "POST"
            })
          );
          if (!response.ok) {
            throw new AuthSocialDependencyError(
              response.status,
              response.headers.get("Retry-After") ?? undefined
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
          headers: internalAuthHeaders(input.headers, input.clientIp),
          method: "POST"
        })
      );
      if (!response.ok) {
        throw new AuthSocialDependencyError(
          response.status,
          response.headers.get("Retry-After") ?? undefined
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

function rewriteLegacyWalletAuthRequest(request: Request): Request {
  const url = new URL(request.url);
  const path = {
    "/auth/siwe/nonce": "/auth/legacy/siwe/nonce",
    "/auth/siwe/verify": "/auth/legacy/siwe/verify"
  }[url.pathname];
  if (path === undefined) {
    return request;
  }
  url.pathname = path;
  return new Request(url, request);
}

function hydrateIdentitySnapshot(
  snapshot: AuthSnapshot,
  identity: IdentityMeResponse
): AuthSnapshot {
  assertIdentityCredentialLimit(identity);
  const providers = new Set<AuthSnapshot["providers"][number]>();
  const walletSignIn = new Map<string, boolean>();
  for (const credential of identity.credentials) {
    if (
      credential.kind === "wallet" &&
      credential.accountKind === "eoa"
    ) {
      walletSignIn.set(
        credential.address.toLowerCase(),
        credential.signInEnabled
      );
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

function mergeReconciledWallets(
  snapshot: AuthSnapshot,
  reconciledWallets: readonly WalletDto[]
): AuthSnapshot {
  if (reconciledWallets.length === 0) return snapshot;
  const wallets = new Map(
    snapshot.wallets.map((wallet) => [wallet.address.toLowerCase(), wallet])
  );
  for (const wallet of reconciledWallets) {
    wallets.set(wallet.address.toLowerCase(), wallet);
  }
  return { ...snapshot, wallets: [...wallets.values()] };
}

function hydrateIdentityWallet(
  wallet: WalletDto,
  identity: IdentityMeResponse
): WalletDto {
  const credential = identity.credentials.find(
    (candidate) =>
      candidate.kind === "wallet" &&
      candidate.accountKind === "eoa" &&
      candidate.address.toLowerCase() === wallet.address.toLowerCase()
  );
  return {
    ...wallet,
    canSignIn:
      credential?.kind === "wallet" ? credential.signInEnabled : false
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
  identityHydrator: IdentityHydrator,
  webOrigin: string,
  requestContext: AsyncLocalStorage<IdentityRequestContext>
) {
  const verifyLegacySiwe = createPledgeCashSiweVerifier(
    { webOrigin },
    [ALERTS_SIWE_STATEMENT]
  );
  return {
    id: "peezy-wallet-session",
    endpoints: {
      getLegacyWalletChallenge: createAuthEndpoint(
        "/legacy/siwe/nonce",
        {
          method: "POST",
          body: z.object({
            chainId: z.number().int().positive(),
            walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/)
          })
        },
        async (context) => {
          const nonce = randomBytes(24).toString("hex");
          const now = new Date();
          await db.transaction(async (transaction) => {
            await transaction
              .delete(legacySiweNonces)
              .where(lt(legacySiweNonces.expiresAt, now));
            await transaction.insert(legacySiweNonces).values({
              address: getAddress(context.body.walletAddress).toLowerCase(),
              chainId: context.body.chainId,
              expiresAt: new Date(now.getTime() + LEGACY_SIWE_NONCE_TTL_MS),
              nonce
            });
          });
          return context.json({ nonce });
        }
      ),
      verifyLegacyWallet: createAuthEndpoint(
        "/legacy/siwe/verify",
        {
          method: "POST",
          body: z.object({
            chainId: z.number().int().positive(),
            message: z.string().min(1).max(AUTH_SIWE_MAX_MESSAGE_LENGTH),
            signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
            walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/)
          })
        },
        async (context) => {
          try {
            const address = getAddress(
              context.body.walletAddress
            ).toLowerCase() as AddressDto;
            const parsed = parseSiweMessage(context.body.message);
            if (
              parsed.nonce === undefined ||
              !(await verifyLegacySiwe({
                address,
                chainId: context.body.chainId,
                message: context.body.message,
                signature: context.body.signature
              }))
            ) {
              throw new Error("Legacy SIWE proof is invalid");
            }
            const userId = await consumeLegacySiweNonce(db, {
              address,
              chainId: context.body.chainId,
              nonce: parsed.nonce,
              now: new Date()
            });
            if (userId === undefined) {
              throw new Error(
                "Legacy SIWE sign-in is limited to an existing PledgeCash wallet; refresh to use peezy.tech Identity"
              );
            }
            const mappedSubject = await identitySubjectForProductUser(
              db,
              userId
            );
            // The compatibility import preserves every PledgeCash user UUID
            // as its Identity subject. Until the local mapping is hydrated,
            // that UUID is the only deterministic central account to trust.
            const subject = mappedSubject ?? userId;
            const centralIdentity = await identityHydrator.getFresh(subject);
            if (centralIdentity.user.id !== subject) {
              throw new Error("peezy.tech Identity subject mismatch");
            }
            const centralWallet = centralIdentity.credentials.find(
              (credential) =>
                credential.kind === "wallet" &&
                credential.accountKind === "eoa" &&
                credential.address.toLowerCase() === address &&
                credential.verifiedChainIds.includes(context.body.chainId)
            );
            if (
              centralWallet?.kind !== "wallet" ||
              !centralWallet.signInEnabled
            ) {
              throw new Error(
                "Wallet sign-in is not enabled by peezy.tech Identity"
              );
            }
            if (mappedSubject === undefined) {
              await db.transaction((transaction) =>
                bindIdentitySubject(transaction, subject, userId)
              );
            }
            const [user] = await db
              .select()
              .from(users)
              .where(eq(users.id, userId))
              .limit(1);
            if (user === undefined) {
              throw new Error("PledgeCash user could not be found");
            }
            const session =
              await context.context.internalAdapter.createSession(userId);
            if (session === null) {
              throw new Error("PledgeCash session could not be created");
            }
            await setSessionCookie(context, { session, user });
            return context.json({
              success: true,
              token: session.token,
              user: { id: userId }
            });
          } catch (error) {
            throw new APIError("UNAUTHORIZED", {
              message:
                error instanceof Error
                  ? error.message
                  : "Legacy SIWE proof is invalid"
            });
          }
        }
      ),
      getPeezyWalletChallenge: createAuthEndpoint(
        "/peezy/siwe/nonce",
        {
          method: "POST",
          body: z.object({
            chainId: z.number().int().positive(),
            walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/)
          })
        },
        async (context) => {
          const forwardedFor = requestContext.getStore()?.clientIp;
          const address = getAddress(
            context.body.walletAddress
          ).toLowerCase() as AddressDto;
          const target = await walletSignInTarget(db, address);
          const challenge = await gateway.createWalletChallenge({
            address,
            chainId: context.body.chainId,
            purpose: target.subject === undefined ? "sign-in" : "link",
            ...(forwardedFor === undefined ? {} : { forwardedFor })
          });
          return context.json(challenge);
        }
      ),
      verifyPeezyWallet: createAuthEndpoint(
        "/peezy/siwe/verify",
        {
          method: "POST",
          body: z.object({
            chainId: z.number().int().positive(),
            message: z.string().min(1).max(AUTH_SIWE_MAX_MESSAGE_LENGTH),
            signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
            walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/)
          })
        },
        async (context) => {
          try {
            const address = getAddress(
              context.body.walletAddress
            ).toLowerCase() as AddressDto;
            const target = await walletSignInTarget(db, address);
            if (
              target.subject !== undefined &&
              parseSiweMessage(context.body.message).statement !==
                WALLET_LINK_SIWE_STATEMENT
            ) {
              throw new Error(
                "Mapped wallet sign-in requires a central link challenge"
              );
            }
            const issued = await gateway.issueWalletGrant({
              message: context.body.message,
              signature: context.body.signature,
              ...(target.subject === undefined
                ? {}
                : { subject: target.subject })
            });
            identityHydrator.invalidate(issued.user.id);
            const exchanged = await gateway.exchangeWalletGrant(issued.grant);
            if (
              exchanged.subject !== issued.user.id ||
              (target.subject !== undefined &&
                exchanged.subject !== target.subject)
            ) {
              throw new Error("Wallet grant subject mismatch");
            }
            const centralIdentity = await gateway.getIdentity(exchanged.subject);
            identityHydrator.set(exchanged.subject, centralIdentity);
            const verifiedWallet = centralIdentity.credentials.find(
              (credential) =>
                credential.kind === "wallet" &&
                credential.accountKind === "eoa" &&
                credential.address === address &&
                credential.verifiedChainIds.includes(context.body.chainId)
            );
            if (verifiedWallet?.kind !== "wallet") {
              throw new Error("Wallet grant did not verify the requested wallet");
            }
            const productUser = await provisionProductUser(db, centralIdentity, {
              ...(target.userId === undefined
                ? {}
                : { requiredUserId: target.userId }),
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
            if (error instanceof AuthWalletCredentialRejectedError) {
              throw new APIError("UNAUTHORIZED", {
                message: "Wallet signature could not be verified"
              });
            }
            throw new APIError("SERVICE_UNAVAILABLE", {
              message: "Wallet sign-in is temporarily unavailable"
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
  const identityRecordFetcher = createResponseSizeLimitFetcher(
    fetcher,
    IDENTITY_RECORD_MAX_BYTES
  );
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
      forwardedFor?: string;
      purpose: "link" | "sign-in";
    }) => {
      const { forwardedFor, ...challenge } = input;
      const challengeFetcher =
        forwardedFor === undefined
          ? client.fetcher
          : (request: RequestInfo | URL, init?: RequestInit) => {
              const headers = new Headers(init?.headers);
              headers.set("X-Forwarded-For", forwardedFor);
              return client.fetcher(request, { ...init, headers });
            };
      return createWalletChallenge({
        ...client,
        ...challenge,
        fetcher: challengeFetcher,
        origin: webOrigin
      });
    },
    exchangeWalletGrant: (grant: string) =>
      exchangeWalletGrant({ ...client, grant }),
    getIdentity: (subject: string) =>
      getIdentity({
        ...client,
        fetcher: identityRecordFetcher,
        subject
      }),
    async issueWalletGrant(input: {
      message: string;
      signature: string;
      subject?: string;
    }) {
      let definitivelyRejected = false;
      const grantFetcher: IdentityFetch = async (request, init) => {
        const response = await client.fetcher(request, init);
        definitivelyRejected =
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429;
        return response;
      };
      try {
        return await issueWalletGrant({
          ...client,
          ...input,
          fetcher: grantFetcher
        });
      } catch (error) {
        if (definitivelyRejected) {
          throw new AuthWalletCredentialRejectedError(error);
        }
        throw error;
      }
    }
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
        assertIdentityCredentialLimit(identity);
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
    async getWithFreshness(subject) {
      const now = Date.now();
      const cached = cache.get(subject);
      if (cached !== undefined && cached.expiresAt > now) {
        return { fresh: false, identity: cached.identity };
      }
      cache.delete(subject);

      const pendingRead = pending.get(subject);
      if (pendingRead !== undefined) {
        return { fresh: false, identity: await pendingRead.read };
      }

      return { fresh: true, identity: await readIdentity(subject, now) };
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
      assertIdentityCredentialLimit(identity);
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

function createResponseSizeLimitFetcher(
  fetcher: IdentityFetch,
  maxBytes: number
): IdentityFetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    const error = new Error(
      `peezy.tech identity exceeds the ${maxBytes}-byte response limit`
    );
    const contentLength = response.headers.get("content-length");
    if (
      contentLength !== null &&
      /^\d+$/.test(contentLength) &&
      Number(contentLength) > maxBytes
    ) {
      void response.body?.cancel(error).catch(() => undefined);
      throw error;
    }
    if (response.body === null) return response;

    const reader = response.body.getReader();
    let receivedBytes = 0;
    const limitedBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await reader.read();
          if (result.done) {
            controller.close();
            return;
          }
          receivedBytes += result.value.byteLength;
          if (receivedBytes > maxBytes) {
            controller.error(error);
            void reader.cancel(error).catch(() => undefined);
            return;
          }
          controller.enqueue(result.value);
        } catch (readError) {
          controller.error(readError);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      }
    });
    const limitedResponse = new Response(limitedBody, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText
    });
    Object.defineProperties(limitedResponse, {
      redirected: { value: response.redirected },
      type: { value: response.type },
      url: { value: response.url }
    });
    return limitedResponse;
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
  assertIdentityCredentialLimit(identity);
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
    if (
      credential.kind === "wallet" &&
      credential.accountKind === "eoa"
    ) {
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

function assertIdentityCredentialLimit(identity: IdentityMeResponse): void {
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

async function walletSignInTarget(
  db: SentinelDb,
  address: AddressDto
): Promise<{
  readonly subject?: string;
  readonly userId?: string;
}> {
  const [owner] = await db
    .select({ userId: walletOwners.userId })
    .from(walletOwners)
    .where(eq(walletOwners.address, address))
    .limit(1);
  if (owner === undefined) return {};
  const subject = await identitySubjectForProductUser(db, owner.userId);
  return {
    ...(subject === undefined ? {} : { subject }),
    userId: owner.userId
  };
}

async function consumeLegacySiweNonce(
  db: SentinelDb,
  input: {
    readonly address: AddressDto;
    readonly chainId: number;
    readonly nonce: string;
    readonly now: Date;
  }
): Promise<string | undefined> {
  return db.transaction(async (transaction) => {
    const [nonce] = await transaction
      .delete(legacySiweNonces)
      .where(
        and(
          eq(legacySiweNonces.nonce, input.nonce),
          eq(legacySiweNonces.address, input.address),
          eq(legacySiweNonces.chainId, input.chainId),
          gt(legacySiweNonces.expiresAt, input.now)
        )
      )
      .returning();
    if (nonce === undefined) {
      throw new Error("Legacy SIWE nonce is invalid or expired");
    }

    const candidateUserIds = new Set<string>();
    const [owner, credentials, coverage] = await Promise.all([
      transaction
        .select({ userId: walletOwners.userId })
        .from(walletOwners)
        .where(eq(walletOwners.address, input.address))
        .limit(2),
      transaction
        .select({ userId: authWallets.userId })
        .from(authWallets)
        .where(sql`lower(${authWallets.address}) = lower(${input.address})`)
        .limit(2),
      transaction
        .select({ userId: wallets.userId })
        .from(wallets)
        .where(sql`lower(${wallets.address}) = lower(${input.address})`)
        .limit(2)
    ]);
    for (const row of [...owner, ...credentials, ...coverage]) {
      candidateUserIds.add(row.userId);
    }
    if (candidateUserIds.size > 1) {
      throw new Error("Legacy wallet resolves to multiple PledgeCash users");
    }
    return candidateUserIds.values().next().value;
  });
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
  identityClientId: string,
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
  if (input.subject === undefined) {
    throw new Error(
      "PledgeCash account must sign in through peezy.tech Identity before linking another wallet"
    );
  }
  const subject = input.subject;

  const hydration = await identityHydrator.getWithFreshness(subject);
  let existingIdentity = hydration.identity;
  if (existingIdentity.user.id !== subject) {
    throw new Error("Identity wallet link subject mismatch");
  }
  if (!hydration.fresh) {
    await reconcilePendingIdentityWalletLinks(
      db,
      subject,
      existingIdentity
    );
    const cachedCentralWallet = findCentralIdentityWallet(
      existingIdentity,
      input.address,
      input.chainId
    );
    if (cachedCentralWallet !== undefined) {
      return finalizeIdentityWalletCoverage(db, existingIdentity, {
        address: input.address,
        canSignIn: cachedCentralWallet.signInEnabled,
        chainId: input.chainId,
        siweMessage: input.message,
        subject,
        userId: input.userId,
        verifiedAt: input.verifiedAt
      });
    }
    existingIdentity = await identityHydrator.getFresh(subject);
    if (existingIdentity.user.id !== subject) {
      throw new Error("Identity wallet link subject mismatch");
    }
  }
  await reconcilePendingIdentityWalletLinks(
    db,
    subject,
    existingIdentity,
    {
      // Prune only against this fresh central read; cached hydration cannot
      // prove that an ambiguous grant attempt never linked the wallet.
      pruneMissingBefore: new Date(
        input.verifiedAt.getTime() - IDENTITY_PENDING_LINK_TTL_MS
      )
    }
  );
  const existingCentralWallet = findCentralIdentityWallet(
    existingIdentity,
    input.address,
    input.chainId
  );
  if (existingCentralWallet !== undefined) {
    return finalizeIdentityWalletCoverage(db, existingIdentity, {
      address: input.address,
      canSignIn: existingCentralWallet.signInEnabled,
      chainId: input.chainId,
      siweMessage: input.message,
      subject,
      userId: input.userId,
      verifiedAt: input.verifiedAt
    });
  }

  await stageIdentityWalletLink(db, existingIdentity, identityClientId, {
    address: input.address,
    chainId: input.chainId,
    siweMessage: input.message,
    subject,
    userId: input.userId,
    verifiedAt: input.verifiedAt
  });

  // A timeout can hide a successful remote mutation, so force the next
  // authenticated read to re-fetch Identity even when issuance never returns.
  identityHydrator.invalidate(subject);
  let issued: Awaited<ReturnType<typeof gateway.issueWalletGrant>>;
  try {
    issued = await gateway.issueWalletGrant({
      message: input.message,
      signature: input.signature,
      subject
    });
  } catch (error) {
    if (error instanceof AuthWalletCredentialRejectedError) {
      await deleteRejectedIdentityWalletLink(db, {
        address: input.address,
        subject,
        verifiedAt: input.verifiedAt
      });
    }
    throw error;
  }
  identityHydrator.invalidate(issued.user.id);
  const exchanged = await gateway.exchangeWalletGrant(issued.grant);
  if (
    exchanged.subject !== issued.user.id ||
    exchanged.subject !== subject
  ) {
    throw new Error("Identity wallet grant resolved to another subject");
  }
  const centralIdentity = await gateway.getIdentity(exchanged.subject);
  identityHydrator.set(exchanged.subject, centralIdentity);
  assertIdentityCredentialLimit(centralIdentity);
  const centralWallet = findCentralIdentityWallet(
    centralIdentity,
    input.address,
    input.chainId
  );
  if (centralWallet === undefined) {
    throw new Error("Identity wallet grant did not link the requested wallet");
  }
  return finalizeIdentityWalletCoverage(db, centralIdentity, {
    address: input.address,
    canSignIn: centralWallet.signInEnabled,
    chainId: input.chainId,
    siweMessage: input.message,
    subject,
    userId: input.userId,
    verifiedAt: input.verifiedAt
  });
}

function findCentralIdentityWallet(
  identity: IdentityMeResponse,
  address: AddressDto,
  chainId: number
) {
  const credential = identity.credentials.find(
    (candidate) =>
      candidate.kind === "wallet" &&
      candidate.accountKind === "eoa" &&
      candidate.address.toLowerCase() === address.toLowerCase() &&
      candidate.verifiedChainIds.includes(chainId)
  );
  return credential?.kind === "wallet" ? credential : undefined;
}

async function stageIdentityWalletLink(
  db: SentinelDb,
  identity: IdentityMeResponse,
  identityClientId: string,
  input: {
    readonly address: AddressDto;
    readonly chainId: number;
    readonly siweMessage: string;
    readonly subject: string;
    readonly userId: string;
    readonly verifiedAt: Date;
  }
): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`peezy-user:${input.subject}`}))`
    );
    await lockWalletAddress(transaction, input.address);
    await assertWalletOwnerAvailable(transaction, input.address, input.userId);
    const candidateUserIds = await identityCandidateUserIds(
      transaction,
      identity,
      input.userId
    );
    if (candidateUserIds.size > 1) {
      throw new Error("peezy.tech credentials resolve to multiple PledgeCash users");
    }

    const [pending] = await transaction
      .select()
      .from(identityWalletLinkReconciliations)
      .where(
        sql`lower(${identityWalletLinkReconciliations.address}) = lower(${input.address})`
      )
      .limit(1);
    if (
      pending !== undefined &&
      (pending.subject !== input.subject || pending.userId !== input.userId)
    ) {
      throw new Error("Wallet link reconciliation belongs to another account");
    }
    const subjectPending = await transaction
      .select({ id: identityWalletLinkReconciliations.id })
      .from(identityWalletLinkReconciliations)
      .where(eq(identityWalletLinkReconciliations.subject, input.subject))
      .limit(IDENTITY_PENDING_LINK_LIMIT + 1);
    if (
      pending === undefined &&
      subjectPending.length >= IDENTITY_PENDING_LINK_LIMIT
    ) {
      throw new Error("Too many pending Identity wallet links");
    }
    // Central replays return before staging. Local conflicts fail above, so a
    // quota event now corresponds to an actual wallet-grant issuance attempt.
    if (
      !(await takeIdentityQuotaInTransaction(transaction, {
        capacity: IDENTITY_WALLET_LINK_LIMIT,
        now: input.verifiedAt,
        scope: identityQuotaScope(identityClientId, "wallet-grant-link"),
        windowMs: IDENTITY_WALLET_LINK_WINDOW_MS
      }))
    ) {
      throw new AuthRateLimitError();
    }
    if (pending === undefined) {
      await transaction
        .insert(identityWalletLinkReconciliations)
        .values({
          address: input.address.toLowerCase(),
          chainId: input.chainId,
          createdAt: input.verifiedAt,
          siweMessage: input.siweMessage,
          subject: input.subject,
          userId: input.userId,
          verifiedAt: input.verifiedAt
        })
        .onConflictDoNothing();
      const [stored] = await transaction
        .select({
          subject: identityWalletLinkReconciliations.subject,
          userId: identityWalletLinkReconciliations.userId
        })
        .from(identityWalletLinkReconciliations)
        .where(
          sql`lower(${identityWalletLinkReconciliations.address}) = lower(${input.address})`
        )
        .limit(1);
      if (
        stored === undefined ||
        stored.subject !== input.subject ||
        stored.userId !== input.userId
      ) {
        throw new Error("Wallet link reconciliation belongs to another account");
      }
      return;
    }
    await transaction
      .update(identityWalletLinkReconciliations)
      .set({
        chainId: input.chainId,
        createdAt: input.verifiedAt,
        siweMessage: input.siweMessage,
        verifiedAt: input.verifiedAt
      })
      .where(eq(identityWalletLinkReconciliations.id, pending.id));
  });
}

async function reconcilePendingIdentityWalletLinks(
  db: SentinelDb,
  subject: string,
  identity: IdentityMeResponse,
  options: {
    readonly pruneMissingBefore?: Date;
  } = {}
): Promise<WalletDto[]> {
  if (identity.user.id !== subject) {
    throw new Error("Identity reconciliation subject mismatch");
  }
  assertIdentityCredentialLimit(identity);
  const pending = await db
    .select()
    .from(identityWalletLinkReconciliations)
    .where(eq(identityWalletLinkReconciliations.subject, subject))
    .limit(IDENTITY_PENDING_LINK_LIMIT + 1);
  if (pending.length > IDENTITY_PENDING_LINK_LIMIT) {
    throw new Error("Too many pending Identity wallet links");
  }
  const reconciled: WalletDto[] = [];
  const staleMissingIds: string[] = [];
  for (const link of pending) {
    const centralWallet = findCentralIdentityWallet(
      identity,
      link.address as AddressDto,
      link.chainId
    );
    if (centralWallet === undefined) {
      if (
        options.pruneMissingBefore !== undefined &&
        link.createdAt <= options.pruneMissingBefore
      ) {
        staleMissingIds.push(link.id);
      }
      continue;
    }
    reconciled.push(
      await finalizeIdentityWalletCoverage(db, identity, {
        address: link.address as AddressDto,
        canSignIn: centralWallet.signInEnabled,
        chainId: link.chainId,
        siweMessage: link.siweMessage,
        subject,
        userId: link.userId,
        verifiedAt: link.verifiedAt
      })
    );
  }
  if (
    options.pruneMissingBefore !== undefined &&
    staleMissingIds.length > 0
  ) {
    const pruneMissingBefore = options.pruneMissingBefore;
    await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`peezy-user:${subject}`}))`
      );
      await transaction
        .delete(identityWalletLinkReconciliations)
        .where(
          and(
            eq(identityWalletLinkReconciliations.subject, subject),
            inArray(identityWalletLinkReconciliations.id, staleMissingIds),
            lte(
              identityWalletLinkReconciliations.createdAt,
              pruneMissingBefore
            )
          )
        );
    });
  }
  return reconciled;
}

async function deleteRejectedIdentityWalletLink(
  db: SentinelDb,
  input: {
    readonly address: AddressDto;
    readonly subject: string;
    readonly verifiedAt: Date;
  }
): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`peezy-user:${input.subject}`}))`
    );
    await lockWalletAddress(transaction, input.address);
    await transaction
      .delete(identityWalletLinkReconciliations)
      .where(
        and(
          eq(identityWalletLinkReconciliations.subject, input.subject),
          eq(identityWalletLinkReconciliations.verifiedAt, input.verifiedAt),
          sql`lower(${identityWalletLinkReconciliations.address}) = lower(${input.address})`
        )
      );
  });
}

async function finalizeIdentityWalletCoverage(
  db: SentinelDb,
  identity: IdentityMeResponse,
  input: {
    readonly address: AddressDto;
    readonly canSignIn: boolean;
    readonly chainId: number;
    readonly siweMessage: string;
    readonly subject: string;
    readonly userId: string;
    readonly verifiedAt: Date;
  }
): Promise<WalletDto> {
  if (identity.user.id !== input.subject) {
    throw new Error("Identity wallet link subject mismatch");
  }
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`peezy-user:${input.subject}`}))`
    );
    await lockWalletAddress(transaction, input.address);
    await assertWalletOwnerAvailable(transaction, input.address, input.userId);
    const candidateUserIds = await identityCandidateUserIds(
      transaction,
      identity,
      input.userId
    );
    if (candidateUserIds.size > 1) {
      throw new Error("peezy.tech credentials resolve to multiple PledgeCash users");
    }
    await bindIdentitySubject(transaction, input.subject, input.userId);
    const wallet = await upsertWalletCoverage(transaction, {
      address: input.address,
      canSignIn: input.canSignIn,
      chainId: input.chainId,
      reenableAlerts: true,
      siweMessage: input.siweMessage,
      userId: input.userId,
      verifiedAt: input.verifiedAt
    });
    await transaction
      .delete(identityWalletLinkReconciliations)
      .where(
        and(
          eq(identityWalletLinkReconciliations.subject, input.subject),
          sql`lower(${identityWalletLinkReconciliations.address}) = lower(${input.address})`
        )
      );
    return wallet;
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
    .insert(walletOwners)
    .values({
      address: checksumAddress.toLowerCase(),
      userId: input.userId
    })
    .onConflictDoNothing();
  const [owner] = await transaction
    .select({ userId: walletOwners.userId })
    .from(walletOwners)
    .where(eq(walletOwners.address, checksumAddress.toLowerCase()))
    .for("update")
    .limit(1);
  if (owner?.userId !== input.userId) {
    throw new Error("Wallet is already linked to another account");
  }

  const [alertPreference] = await transaction
    .select({
      alertsEnabled: sql<boolean | null>`bool_or(${wallets.alertsEnabled})`
    })
    .from(wallets)
    .where(
      and(
        eq(wallets.userId, input.userId),
        sql`lower(${wallets.address}) = lower(${checksumAddress})`
      )
    );
  const alertsEnabled =
    input.reenableAlerts || (alertPreference?.alertsEnabled ?? true);

  await transaction
    .insert(wallets)
    .values({
      address: checksumAddress,
      alertsEnabled,
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
