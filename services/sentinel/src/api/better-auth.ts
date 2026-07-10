import { randomBytes } from "node:crypto";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, siwe } from "better-auth/plugins";
import { and, eq, sql } from "drizzle-orm";
import { verifyMessage, type Address, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";

import type { Config, SocialProviderName } from "../config";
import type { SentinelDb } from "../db/client";
import * as schema from "../db/schema";
import type { AuthAdapter, SiweSignatureVerifier } from "./auth";

export const ALERTS_SIWE_STATEMENT = "Sign in to pledge.cash alerts.";
export const WALLET_LINK_SIWE_STATEMENT = "Link this wallet to pledge.cash Sentinel notifications.";
const SIWE_MAX_AGE_MS = 15 * 60 * 1_000;
const SIWE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export function createBetterAuthAdapter(
  config: Pick<Config, "auth" | "chains" | "webOrigin">,
  db: SentinelDb
): AuthAdapter {
  const socialProviders = configuredSocialProviders(config.auth.socialProviders);
  const verifySiweSignature = createPrimarySiweVerifier(config, db);
  const github = config.auth.socialProviders.github;
  const google = config.auth.socialProviders.google;
  const apple = config.auth.socialProviders.apple;

  const auth = betterAuth({
    appName: "pledge.cash",
    basePath: "/auth",
    baseURL: config.auth.baseUrl,
    secret: config.auth.secret,
    trustedOrigins: [new URL(config.webOrigin).origin],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema
    }),
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
        trustedProviders: socialProviders,
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
    socialProviders: {
      ...(github === undefined
        ? {}
        : {
            github: {
              ...github,
              disableImplicitSignUp: true,
              disableSignUp: true
            }
          }),
      ...(google === undefined
        ? {}
        : {
            google: {
              ...google,
              disableIdTokenSignIn: true,
              disableImplicitSignUp: true,
              disableSignUp: true
            }
          }),
      ...(apple === undefined
        ? {}
        : {
            apple: {
              ...apple,
              disableIdTokenSignIn: true,
              disableImplicitSignUp: true,
              disableSignUp: true
            }
          })
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
      siwe({
        anonymous: true,
        domain: new URL(config.webOrigin).host,
        emailDomainName: "wallet.pledge.cash.invalid",
        getNonce: async () => randomBytes(24).toString("hex"),
        schema: {
          walletAddress: { modelName: "authWallets" }
        },
        verifyMessage: ({ address, chainId, message, signature }) =>
          verifySiweSignature({
            address: address.toLowerCase() as Address,
            chainId,
            message,
            signature
          })
      }),
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
    socialProviders,
    async getSession(input) {
      const session = await auth.api.getSession({ headers: input.headers });
      return session === null ? null : { user: { id: session.user.id } };
    },
    handler: (request) => auth.handler(request)
  };
}

export function createPledgeCashSiweVerifier(
  config: Pick<Config, "webOrigin">,
  allowedStatements: readonly string[] = [ALERTS_SIWE_STATEMENT, WALLET_LINK_SIWE_STATEMENT]
): SiweSignatureVerifier {
  const expectedOrigin = new URL(config.webOrigin).origin;
  const expectedDomain = new URL(config.webOrigin).host;

  return async ({ address, chainId, message, signature }) => {
    let parsed: ReturnType<typeof parseSiweMessage>;
    try {
      parsed = parseSiweMessage(message);
    } catch {
      return false;
    }

    if (
      parsed.address === undefined ||
      parsed.address.toLowerCase() !== address.toLowerCase() ||
      parsed.chainId !== chainId ||
      parsed.domain !== expectedDomain ||
      !allowedStatements.includes(parsed.statement ?? "") ||
      parsed.uri === undefined ||
      parsed.version !== "1" ||
      parsed.issuedAt === undefined ||
      parsed.expirationTime === undefined
    ) {
      return false;
    }

    let uriOrigin: string;
    try {
      uriOrigin = new URL(parsed.uri).origin;
    } catch {
      return false;
    }

    if (uriOrigin !== expectedOrigin) {
      return false;
    }

    const now = Date.now();
    const issuedAt = parsed.issuedAt.getTime();
    const expiresAt = parsed.expirationTime.getTime();
    if (
      issuedAt > now + SIWE_CLOCK_SKEW_MS ||
      now - issuedAt > SIWE_MAX_AGE_MS ||
      expiresAt <= now ||
      expiresAt - issuedAt > SIWE_MAX_AGE_MS
    ) {
      return false;
    }

    // The standalone verifier performs EOA signature recovery only. Better Auth 1.6.x
    // merges identical addresses across chains, which is safe for EOAs but not for
    // ERC-1271 accounts whose controller can differ by chain.
    return verifyMessage({
      address: address as Address,
      message,
      signature: signature as Hex
    });
  };
}

function createPrimarySiweVerifier(
  config: Pick<Config, "webOrigin">,
  db: SentinelDb
): SiweSignatureVerifier {
  const verifyEoaSignature = createPledgeCashSiweVerifier(config, [ALERTS_SIWE_STATEMENT]);

  return async (input) => {
    if (!(await verifyEoaSignature(input))) {
      return false;
    }

    const [owner] = await db
      .select({ userId: schema.walletOwners.userId })
      .from(schema.walletOwners)
      .where(sql`lower(${schema.walletOwners.address}) = lower(${input.address})`)
      .limit(1);
    if (owner === undefined) {
      return true;
    }

    const [credential] = await db
      .select({ id: schema.authWallets.id })
      .from(schema.authWallets)
      .where(
        and(
          eq(schema.authWallets.userId, owner.userId),
          sql`lower(${schema.authWallets.address}) = lower(${input.address})`
        )
      )
      .limit(1);
    return credential !== undefined;
  };
}

function configuredSocialProviders(
  providers: Config["auth"]["socialProviders"]
): SocialProviderName[] {
  return (["github", "google", "apple"] as const).filter(
    (provider) => providers[provider] !== undefined
  );
}
