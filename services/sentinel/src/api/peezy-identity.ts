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
import { genericOAuth, organization } from "better-auth/plugins";
import { and, eq, sql } from "drizzle-orm";
import { getAddress } from "viem";
import { z } from "zod";

import type { Config } from "../config";
import type { SentinelDb } from "../db/client";
import { authAccounts, users, walletOwners, wallets } from "../db/schema";
import type {
  AddressDto,
  AuthProviderDto,
  AuthRedirectResponse,
  AuthSiweNonceResponse,
  SocialProviderDto,
  WalletDto
} from "./dto";
import type { AuthAdapter } from "./auth";
import {
  createSentinelAuthDatabaseAdapter,
  internalAuthHeaders
} from "./better-auth";

const PEEZY_PROVIDER_ID = "peezy";
const IDENTITY_REQUEST_TIMEOUT_MS = 2_000;
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
  readonly requestTimeoutMs?: number;
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
          {
            authentication: "basic",
            authorizationUrlParams: (context) => {
              const provider = context.body.additionalData?.provider;
              return isSocialProvider(provider) ? { login_hint: provider } : {};
            },
            clientId: identity.clientId,
            clientSecret: identity.oidcClientSecret,
            discoveryUrl: `${identity.baseUrl}/api/auth/.well-known/openid-configuration`,
            getUserInfo: async (tokens) => {
              if (tokens.accessToken === undefined) return null;
              const profile = await fetchIdentityProfile(
                identity.baseUrl,
                tokens.accessToken,
                identityFetcher
              );
              const centralIdentity = await gateway.getIdentity(profile.sub);
              const productUser = await provisionProductUser(db, centralIdentity);
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
            },
            issuer: `${identity.baseUrl}/api/auth`,
            pkce: true,
            providerId: PEEZY_PROVIDER_ID,
            requireIssuerValidation: true,
            scopes: ["openid", "profile", "email"]
          }
        ]
      }),
      peezyWalletSessionPlugin(gateway, db),
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
    createWalletChallenge: ({ address, chainId, purpose }) =>
      gateway.createWalletChallenge({ address, chainId, purpose }),
    async getProviders(userId) {
      const subject = await identitySubjectForProductUser(db, userId);
      const identityUser = await gateway.getIdentity(subject);
      const providers: AuthProviderDto[] = [];
      for (const credential of identityUser.credentials) {
        if (credential.kind === "wallet") providers.push("siwe");
        if (credential.kind === "social") providers.push(credential.provider);
      }
      return [...new Set(providers)];
    },
    async getSocialProviders() {
      const capabilities = await gateway.capabilities();
      return capabilities.socialProviders;
    },
    async getSession(input) {
      const session = await auth.api.getSession({ headers: input.headers });
      return session === null ? null : { user: { id: session.user.id } };
    },
    handler: (request) => auth.handler(request),
    async linkWalletCredential(input) {
      const subject = await identitySubjectForProductUser(db, input.userId);
      return linkIdentityWalletCredential(db, gateway, {
        ...input,
        subject
      });
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
        const handoff = await gateway.createSocialLinkHandoff({
          callbackUrl: input.request.callbackURL,
          provider: input.request.provider,
          subject
        });
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

function peezyWalletSessionPlugin(
  gateway: ReturnType<typeof createIdentityGateway>,
  db: SentinelDb
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
            const exchanged = await gateway.exchangeWalletGrant(issued.grant);
            if (exchanged.subject !== issued.user.id) {
              throw new Error("Wallet grant subject mismatch");
            }
            const centralIdentity = await gateway.getIdentity(exchanged.subject);
            const address = getAddress(context.body.walletAddress).toLowerCase() as AddressDto;
            const verifiedWallet = centralIdentity.credentials.some(
              (credential) =>
                credential.kind === "wallet" &&
                credential.address === address &&
                credential.verifiedChainIds.includes(context.body.chainId)
            );
            if (!verifiedWallet) {
              throw new Error("Wallet grant did not verify the requested wallet");
            }
            const productUser = await provisionProductUser(db, centralIdentity, {
              walletCoverage: {
                address,
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

function createTimeoutFetcher(
  fetcher: IdentityFetch,
  timeoutMs: number
): IdentityFetch {
  return async (input, init) => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error(`Identity request timed out after ${timeoutMs}ms`);
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        fetcher(input, { ...init, signal: controller.signal }),
        deadline
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };
}

async function provisionProductUser(
  db: SentinelDb,
  identity: IdentityMeResponse,
  options: {
    readonly walletCoverage?: {
      readonly address: AddressDto;
      readonly chainId: number;
      readonly siweMessage: string;
      readonly verifiedAt: Date;
    };
  } = {}
): Promise<typeof users.$inferSelect> {
  return db.transaction(async (transaction) => {
    const identityUser = identity.user;
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`peezy-user:${identityUser.id}`}))`
    );
    if (options.walletCoverage !== undefined) {
      await lockWalletAddress(transaction, options.walletCoverage.address);
    }

    const candidateUserIds = new Set<string>();
    const [mappedAccount] = await transaction
      .select({ userId: authAccounts.userId })
      .from(authAccounts)
      .where(
        and(
          eq(authAccounts.providerId, PEEZY_PROVIDER_ID),
          eq(authAccounts.accountId, identityUser.id)
        )
      )
      .limit(1);
    if (mappedAccount !== undefined) candidateUserIds.add(mappedAccount.userId);

    const [sameSubjectUser] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, identityUser.id))
      .limit(1);
    if (sameSubjectUser !== undefined) candidateUserIds.add(sameSubjectUser.id);

    for (const credential of identity.credentials) {
      if (credential.kind === "wallet") {
        const [owner] = await transaction
          .select({ userId: walletOwners.userId })
          .from(walletOwners)
          .where(eq(walletOwners.address, credential.address))
          .limit(1);
        if (owner !== undefined) candidateUserIds.add(owner.userId);
      }
      if (credential.kind === "social") {
        const [legacyAccount] = await transaction
          .select({ userId: authAccounts.userId })
          .from(authAccounts)
          .where(
            and(
              eq(authAccounts.id, credential.id),
              eq(authAccounts.providerId, credential.provider)
            )
          )
          .limit(1);
        if (legacyAccount !== undefined) candidateUserIds.add(legacyAccount.userId);
      }
    }

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

async function identitySubjectForProductUser(
  db: SentinelDb,
  userId: string
): Promise<string> {
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
  return accounts[0]?.subject ?? userId;
}

async function bindIdentitySubject(
  transaction: SentinelTransaction,
  subject: string,
  userId: string
): Promise<void> {
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
  input: {
    readonly address: AddressDto;
    readonly chainId: number;
    readonly message: string;
    readonly signature: string;
    readonly subject: string;
    readonly userId: string;
    readonly verifiedAt: Date;
  }
): Promise<WalletDto> {
  return db.transaction(async (transaction) => {
    await lockWalletAddress(transaction, input.address);
    const [owner] = await transaction
      .select({ userId: walletOwners.userId })
      .from(walletOwners)
      .where(eq(walletOwners.address, input.address))
      .limit(1);
    if (owner !== undefined && owner.userId !== input.userId) {
      throw new Error("Wallet is already linked to another account");
    }

    const issued = await gateway.issueWalletGrant({
      message: input.message,
      signature: input.signature,
      subject: input.subject
    });
    const exchanged = await gateway.exchangeWalletGrant(issued.grant);
    if (exchanged.subject !== input.subject || issued.user.id !== input.subject) {
      throw new Error("Identity wallet grant resolved to another subject");
    }

    await bindIdentitySubject(transaction, input.subject, input.userId);
    return upsertWalletCoverage(transaction, {
      address: input.address,
      chainId: input.chainId,
      reenableAlerts: true,
      siweMessage: input.message,
      userId: input.userId,
      verifiedAt: input.verifiedAt
    });
  });
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
    canSignIn: true,
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
