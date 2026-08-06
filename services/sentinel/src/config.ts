import { isIP } from "node:net";

import { z } from "zod";

const optionalStringSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);
const optionalSecretSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(32).optional()
);
const optionalClientIdSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._~-]+$/)
    .optional()
);

export const sentinelEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  SENTINEL_PORT: z.coerce.number().int().positive().default(8787),
  SENTINEL_TRUSTED_PROXY_IPS: optionalStringSchema,
  SENTINEL_WEB_ORIGIN: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  PEEZY_IDENTITY_URL: optionalStringSchema,
  PEEZY_IDENTITY_CLIENT_ID: optionalClientIdSchema,
  PEEZY_IDENTITY_APP_CLIENT_SECRET: optionalSecretSchema,
  PEEZY_IDENTITY_OIDC_CLIENT_SECRET: optionalSecretSchema,
  GITHUB_CLIENT_ID: optionalStringSchema,
  GITHUB_CLIENT_SECRET: optionalStringSchema,
  DISCORD_CLIENT_ID: optionalStringSchema,
  DISCORD_CLIENT_SECRET: optionalStringSchema,
  TWITTER_CLIENT_ID: optionalStringSchema,
  TWITTER_CLIENT_SECRET: optionalStringSchema,
  TELEGRAM_OAUTH_CLIENT_ID: optionalStringSchema,
  TELEGRAM_OAUTH_CLIENT_SECRET: optionalStringSchema,
  APPLE_CLIENT_ID: optionalStringSchema,
  APPLE_CLIENT_SECRET: optionalStringSchema
});

export type SentinelEnv = z.input<typeof sentinelEnvSchema>;
export type SocialProviderName =
  | "apple"
  | "discord"
  | "github"
  | "telegram"
  | "twitter";

export type SocialProviderConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
};

export type Config = {
  readonly auth: {
    readonly baseUrl: string;
    readonly identity?: {
      readonly baseUrl: string;
      readonly appClientSecret: string;
      readonly clientId: string;
      readonly oidcClientSecret: string;
    };
    readonly secret: string;
    readonly socialProviders: Partial<Record<SocialProviderName, SocialProviderConfig>>;
  };
  readonly databaseUrl: string;
  readonly port: number;
  readonly trustedProxyIps: readonly string[];
  readonly webOrigin: string;
};

function parseIpList(value: string | undefined): string[] {
  if (value === undefined) return [];

  return [
    ...new Set(
      value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => {
          if (isIP(part) === 0) {
            throw new Error(`Invalid IP address in SENTINEL_TRUSTED_PROXY_IPS: ${part}`);
          }
          return part;
        })
    )
  ];
}

function readOptionalString(env: Record<string, unknown>, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readOrigin(value: string, key: string): string {
  const url = new URL(value);
  if (
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error(
      `${key} must be an origin without credentials, a path, a query, or a fragment`
    );
  }
  return url.origin;
}

function readIdentityOrigin(value: string): string {
  const origin = readOrigin(value, "PEEZY_IDENTITY_URL");
  const url = new URL(origin);
  const loopback = new Set(["127.0.0.1", "[::1]", "localhost"]).has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("PEEZY_IDENTITY_URL must use HTTPS outside loopback development");
  }
  return origin;
}

function readSocialProvider(
  rawEnv: Record<string, unknown>,
  envPrefix: string
): SocialProviderConfig | undefined {
  const clientId = readOptionalString(rawEnv, `${envPrefix}_CLIENT_ID`);
  const clientSecret = readOptionalString(rawEnv, `${envPrefix}_CLIENT_SECRET`);

  if ((clientId === undefined) !== (clientSecret === undefined)) {
    throw new Error(
      `${envPrefix}_CLIENT_ID and ${envPrefix}_CLIENT_SECRET must be configured together`
    );
  }

  return clientId === undefined || clientSecret === undefined
    ? undefined
    : { clientId, clientSecret };
}

function withOptional<T extends object, K extends string, V>(
  target: T,
  key: K,
  value: V | undefined
): T & Partial<Record<K, V>> {
  return value === undefined ? target : { ...target, [key]: value };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const raw = sentinelEnvSchema.parse(env);
  const rawEnv = raw as Record<string, unknown>;
  const apple = readSocialProvider(rawEnv, "APPLE");
  const discord = readSocialProvider(rawEnv, "DISCORD");
  const github = readSocialProvider(rawEnv, "GITHUB");
  const telegram = readSocialProvider(rawEnv, "TELEGRAM_OAUTH");
  const twitter = readSocialProvider(rawEnv, "TWITTER");
  const authBaseUrl = readOrigin(raw.BETTER_AUTH_URL, "BETTER_AUTH_URL");
  const identityBaseUrl =
    raw.PEEZY_IDENTITY_URL === undefined
      ? undefined
      : readIdentityOrigin(raw.PEEZY_IDENTITY_URL);
  const identityValues = [
    identityBaseUrl,
    raw.PEEZY_IDENTITY_CLIENT_ID,
    raw.PEEZY_IDENTITY_APP_CLIENT_SECRET,
    raw.PEEZY_IDENTITY_OIDC_CLIENT_SECRET
  ];
  if (
    identityValues.some((value) => value !== undefined) &&
    identityValues.some((value) => value === undefined)
  ) {
    throw new Error(
      "PEEZY_IDENTITY_URL, PEEZY_IDENTITY_CLIENT_ID, PEEZY_IDENTITY_APP_CLIENT_SECRET, and PEEZY_IDENTITY_OIDC_CLIENT_SECRET must be configured together"
    );
  }
  if (
    raw.PEEZY_IDENTITY_APP_CLIENT_SECRET !== undefined &&
    raw.PEEZY_IDENTITY_OIDC_CLIENT_SECRET !== undefined &&
    raw.PEEZY_IDENTITY_APP_CLIENT_SECRET === raw.PEEZY_IDENTITY_OIDC_CLIENT_SECRET
  ) {
    throw new Error(
      "PEEZY_IDENTITY_APP_CLIENT_SECRET and PEEZY_IDENTITY_OIDC_CLIENT_SECRET must be distinct"
    );
  }
  const trustedProxyIps = parseIpList(raw.SENTINEL_TRUSTED_PROXY_IPS);
  if (
    identityBaseUrl !== undefined &&
    new URL(authBaseUrl).protocol === "https:" &&
    trustedProxyIps.length === 0
  ) {
    throw new Error(
      "SENTINEL_TRUSTED_PROXY_IPS must identify the HTTPS edge in shared Identity mode"
    );
  }

  return {
    auth: withOptional(
      {
        baseUrl: authBaseUrl,
        secret: raw.BETTER_AUTH_SECRET,
        socialProviders: {
          ...(apple === undefined ? {} : { apple }),
          ...(discord === undefined ? {} : { discord }),
          ...(github === undefined ? {} : { github }),
          ...(telegram === undefined ? {} : { telegram }),
          ...(twitter === undefined ? {} : { twitter })
        }
      },
      "identity",
      identityBaseUrl === undefined ||
        raw.PEEZY_IDENTITY_CLIENT_ID === undefined ||
        raw.PEEZY_IDENTITY_APP_CLIENT_SECRET === undefined ||
        raw.PEEZY_IDENTITY_OIDC_CLIENT_SECRET === undefined
        ? undefined
        : {
            appClientSecret: raw.PEEZY_IDENTITY_APP_CLIENT_SECRET,
            baseUrl: identityBaseUrl,
            clientId: raw.PEEZY_IDENTITY_CLIENT_ID,
            oidcClientSecret: raw.PEEZY_IDENTITY_OIDC_CLIENT_SECRET
          }
    ),
    databaseUrl: raw.DATABASE_URL,
    port: raw.SENTINEL_PORT,
    trustedProxyIps,
    webOrigin: readOrigin(raw.SENTINEL_WEB_ORIGIN, "SENTINEL_WEB_ORIGIN")
  };
}
