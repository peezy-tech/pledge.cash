import { createHash, randomBytes } from "node:crypto";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, siwe } from "better-auth/plugins";
import { and, eq, sql } from "drizzle-orm";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey
} from "jose";
import { verifyMessage, type Address, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";

import type { Config, SocialProviderName } from "../config";
import type { SentinelDb } from "../db/client";
import * as schema from "../db/schema";
import type { AuthAdapter, SiweSignatureVerifier } from "./auth";

export const PRODUCT_SIWE_STATEMENT = "Sign in to pledge.cash.";
export const WALLET_LINK_SIWE_STATEMENT = "Link this wallet to pledge.cash.";
const INTERNAL_AUTH_HEADER_ALLOWLIST = [
  "cookie",
  "origin",
  "user-agent"
] as const;
const SIWE_MAX_AGE_MS = 15 * 60 * 1_000;
const SIWE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const TELEGRAM_ISSUER = "https://oauth.telegram.org";
const TELEGRAM_DISCOVERY_URL = `${TELEGRAM_ISSUER}/.well-known/openid-configuration`;
const TELEGRAM_JWKS = createRemoteJWKSet(
  new URL(`${TELEGRAM_ISSUER}/.well-known/jwks.json`)
);

type TelegramOAuthTokens = {
  readonly idToken?: string | undefined;
};

export function createBetterAuthAdapter(
  config: Pick<Config, "auth" | "webOrigin">,
  db: SentinelDb
): AuthAdapter {
  const socialProviders = configuredSocialProviders(config.auth.socialProviders);
  const verifySiweSignature = createWalletSiweVerifier(config, db);
  const github = config.auth.socialProviders.github;
  const apple = config.auth.socialProviders.apple;
  const discord = config.auth.socialProviders.discord;
  const telegram = config.auth.socialProviders.telegram;
  const twitter = config.auth.socialProviders.twitter;
  const telegramPlugins =
    telegram === undefined
      ? []
      : [
          genericOAuth({
            config: [
              {
                authentication: "basic",
                clientId: telegram.clientId,
                clientSecret: telegram.clientSecret,
                disableImplicitSignUp: true,
                disableSignUp: true,
                discoveryUrl: TELEGRAM_DISCOVERY_URL,
                getUserInfo: (tokens) => telegramUserInfo(tokens, telegram.clientId),
                issuer: TELEGRAM_ISSUER,
                pkce: true,
                providerId: "telegram",
                scopes: ["openid", "profile"],
                tokenUrlParams: { client_id: telegram.clientId }
              }
            ]
          })
        ];

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
      ...(discord === undefined
        ? {}
        : {
            discord: {
              ...discord,
              disableDefaultScope: true,
              disableImplicitSignUp: true,
              disableSignUp: true,
              mapProfileToUser: (profile) => ({
                email: socialProviderEmail("discord", profile.id)
              }),
              scope: ["identify"]
            }
          }),
      ...(github === undefined
        ? {}
        : {
            github: {
              ...github,
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
          }),
      ...(twitter === undefined
        ? {}
        : {
            twitter: {
              ...twitter,
              disableDefaultScope: true,
              disableImplicitSignUp: true,
              disableSignUp: true,
              mapProfileToUser: (profile) => ({
                email: socialProviderEmail("twitter", profile.data.id)
              }),
              scope: ["users.read"]
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
      ...telegramPlugins,
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
      })
    ]
  });

  return {
    socialProviders,
    async getSession(input) {
      const session = await auth.api.getSession({ headers: input.headers });
      return session === null ? null : { user: { id: session.user.id } };
    },
    handler: (request) => auth.handler(request),
    async startSocial(input) {
      const telegram = input.request.provider === "telegram";
      const path = input.link
        ? telegram
          ? "/oauth2/link"
          : "/link-social"
        : telegram
          ? "/sign-in/oauth2"
          : "/sign-in/social";
      const body = telegram
        ? {
            callbackURL: input.request.callbackURL,
            ...(input.request.errorCallbackURL === undefined
              ? {}
              : { errorCallbackURL: input.request.errorCallbackURL }),
            providerId: "telegram"
          }
        : input.request;
      const response = await auth.handler(
        new Request(`${config.auth.baseUrl}/auth${path}`, {
          body: JSON.stringify(body),
          headers: internalAuthHeaders(input.headers, input.clientIp),
          method: "POST"
        })
      );
      if (!response.ok) {
        throw new Error(`Legacy social authentication failed with status ${response.status}`);
      }
      return {
        headers: response.headers,
        response: (await response.json()) as {
          redirect: boolean;
          url?: string | undefined;
        }
      };
    }
  };
}

export function internalAuthHeaders(
  source: Headers,
  clientIp?: string
): Headers {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const name of INTERNAL_AUTH_HEADER_ALLOWLIST) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  const resolvedClientIp = clientIp?.trim();
  if (resolvedClientIp) {
    headers.set("X-Forwarded-For", resolvedClientIp);
  }
  return headers;
}

export function createSentinelAuthDatabaseAdapter(db: SentinelDb) {
  const createAdapter = drizzleAdapter(db, {
    provider: "pg",
    schema
  });

  return (...args: Parameters<typeof createAdapter>) => {
    const adapter = createAdapter(...args);

    return {
      ...adapter,
      findOne: async (...findOneArgs: Parameters<typeof adapter.findOne>) => {
        const [input] = findOneArgs;
        // Better Auth checksum-normalizes SIWE input, while a pre-existing credential
        // may have been stored in another valid casing. Ownership is case-insensitive.
        return adapter.findOne({
          ...input,
          ...(input.model === "walletAddress" && input.where !== undefined
            ? {
                where: input.where.map((condition) =>
                  condition.field === "address" ? { ...condition, mode: "insensitive" } : condition
                )
              }
            : {})
        });
      }
    };
  };
}

export async function verifyTelegramIdToken(
  idToken: string,
  clientId: string,
  getKey: JWTVerifyGetKey = TELEGRAM_JWKS
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, getKey, {
    algorithms: ["RS256"],
    audience: clientId,
    issuer: TELEGRAM_ISSUER
  });
  return payload;
}

export async function telegramUserInfo(
  tokens: TelegramOAuthTokens,
  clientId: string,
  getKey: JWTVerifyGetKey = TELEGRAM_JWKS
): Promise<{
  readonly email: string;
  readonly emailVerified: false;
  readonly id: string;
  readonly image?: string | undefined;
  readonly name: string;
  readonly sub: string;
} | null> {
  if (tokens.idToken === undefined) return null;

  let payload: JWTPayload;
  try {
    payload = await verifyTelegramIdToken(tokens.idToken, clientId, getKey);
  } catch {
    return null;
  }

  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const name = firstNonEmptyString(payload.name, payload.preferred_username);
  if (subject.length === 0 || name === undefined) return null;

  const image = firstNonEmptyString(payload.picture);
  return {
    email: socialProviderEmail("telegram", subject),
    emailVerified: false,
    id: subject,
    ...(image === undefined ? {} : { image }),
    name,
    sub: subject
  };
}

function socialProviderEmail(provider: SocialProviderName, accountId: string): string {
  const digest = createHash("sha256")
    .update(provider)
    .update("\0")
    .update(accountId)
    .digest("hex");
  return `${provider}-${digest}@social.pledge.cash.invalid`;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  )?.trim();
}

export function createPledgeCashSiweVerifier(
  config: Pick<Config, "webOrigin">,
  allowedStatements: readonly string[] = [PRODUCT_SIWE_STATEMENT, WALLET_LINK_SIWE_STATEMENT]
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

function createWalletSiweVerifier(
  config: Pick<Config, "webOrigin">,
  db: SentinelDb
): SiweSignatureVerifier {
  const verifyEoaSignature = createPledgeCashSiweVerifier(config, [PRODUCT_SIWE_STATEMENT]);

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

export function configuredSocialProviders(
  providers: Config["auth"]["socialProviders"]
): SocialProviderName[] {
  return (["discord", "twitter", "telegram", "github", "apple"] as const).filter(
    (provider) => providers[provider] !== undefined
  );
}
