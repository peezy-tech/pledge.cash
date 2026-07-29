import {
  IdentityCapabilitiesSchema,
  type PeezyUser,
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
import { z } from "zod";

import type { Config } from "../config";
import type { SentinelDb } from "../db/client";
import { authAccounts, users } from "../db/schema";
import type {
  AddressDto,
  AuthProviderDto,
  AuthRedirectResponse,
  AuthSiweNonceResponse,
  SocialProviderDto
} from "./dto";
import type { AuthAdapter } from "./auth";
import {
  createSentinelAuthDatabaseAdapter,
  internalAuthHeaders
} from "./better-auth";

const PEEZY_PROVIDER_ID = "peezy";
const SOCIAL_PROVIDERS = new Set<SocialProvider>([
  "apple",
  "discord",
  "github",
  "telegram",
  "twitter"
]);

type IdentityConfig = NonNullable<Config["auth"]["identity"]>;
type IdentityFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createPeezyIdentityAuthAdapter(
  config: Pick<Config, "auth" | "webOrigin">,
  db: SentinelDb,
  fetcher: IdentityFetch = fetch
): AuthAdapter {
  if (config.auth.identity === undefined) {
    throw new Error("peezy.tech Identity is not configured");
  }
  const identity = config.auth.identity;
  const gateway = createIdentityGateway(identity, config.webOrigin, fetcher);
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
          before: async (account) => ({ data: { ...account, idToken: null } })
        },
        update: {
          before: async (account) => ({ data: { ...account, idToken: null } })
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
                fetcher
              );
              const centralIdentity = await gateway.getIdentity(profile.sub);
              const productUser = await provisionProductUser(db, centralIdentity.user);
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
      const identityUser = await gateway.getIdentity(userId);
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
      const issued = await gateway.issueWalletGrant({
        message: input.message,
        signature: input.signature,
        subject: input.userId
      });
      const exchanged = await gateway.exchangeWalletGrant(issued.grant);
      if (exchanged.subject !== input.userId) {
        throw new Error("Identity wallet grant resolved to another subject");
      }
    },
    async startSocial(input): Promise<{
      headers?: Headers;
      response: AuthRedirectResponse;
    }> {
      if (input.link) {
        if (input.userId === undefined) {
          throw new Error("A PledgeCash session is required to link a social credential");
        }
        const handoff = await gateway.createSocialLinkHandoff({
          callbackUrl: input.request.callbackURL,
          provider: input.request.provider,
          subject: input.userId
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
            const productUser = await provisionProductUser(db, issued.user);
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

async function provisionProductUser(
  db: SentinelDb,
  identityUser: PeezyUser
): Promise<typeof users.$inferSelect> {
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`peezy-user:${identityUser.id}`}))`
    );
    const fallbackEmail = `${identityUser.id}@identity.pledge.cash.invalid`;
    const email = identityUser.primaryEmail?.value ?? fallbackEmail;
    const name = identityUser.displayName ?? "peezy.tech user";
    await transaction
      .insert(users)
      .values({
        createdAt: new Date(identityUser.createdAt),
        email,
        emailVerified: identityUser.primaryEmail?.verified ?? false,
        id: identityUser.id,
        image: identityUser.avatarUrl,
        name,
        updatedAt: new Date()
      })
      .onConflictDoNothing();

    const [productUser] = await transaction
      .select()
      .from(users)
      .where(eq(users.id, identityUser.id))
      .limit(1);
    if (productUser === undefined) {
      throw new Error("PledgeCash identity shadow could not be provisioned");
    }

    await transaction
      .insert(authAccounts)
      .values({
        accountId: identityUser.id,
        createdAt: new Date(),
        providerId: PEEZY_PROVIDER_ID,
        updatedAt: new Date(),
        userId: identityUser.id
      })
      .onConflictDoNothing();
    const [identityAccount] = await transaction
      .select({ userId: authAccounts.userId })
      .from(authAccounts)
      .where(
        and(
          eq(authAccounts.providerId, PEEZY_PROVIDER_ID),
          eq(authAccounts.accountId, identityUser.id)
        )
      )
      .limit(1);
    if (identityAccount?.userId !== identityUser.id) {
      throw new Error("peezy.tech subject is linked to another PledgeCash user");
    }
    return productUser;
  });
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
