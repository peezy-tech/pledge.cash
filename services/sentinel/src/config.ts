import { isIP } from "node:net";
import { tmpdir } from "node:os";

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

const booleanFlagSchema = z
  .enum(["0", "1", "false", "true"])
  .default("0")
  .transform((value) => value === "1" || value === "true");

export const sentinelEnvSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    SENTINEL_PORT: z.coerce.number().int().positive().default(8787),
    SENTINEL_TRUSTED_PROXY_IPS: optionalStringSchema,
    SENTINEL_WEB_ORIGIN: z.string().url(),
    SENTINEL_CHAIN_IDS: z.string().min(1).default("10143"),
    SENTINEL_RPC_URL_10143: z.string().url().default("https://testnet-rpc.monad.xyz"),
    SENTINEL_RPC_URL_31337: optionalStringSchema,
    SENTINEL_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(12_000),
    SENTINEL_MAX_BLOCK_RANGE: z.coerce.number().int().positive().max(1_000).default(1_000),
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
    APPLE_CLIENT_SECRET: optionalStringSchema,
    SENTINEL_HARNESS: z.enum(["claude", "codex", "none"]).default("claude"),
    SENTINEL_HARNESS_CMD: optionalStringSchema,
    SENTINEL_HARNESS_MODEL: z.string().trim().min(1).default("claude-opus-4-8"),
    SENTINEL_HARNESS_WORKDIR: optionalStringSchema,
    SENTINEL_HARNESS_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
    SENTINEL_HARNESS_DAILY_LIMIT: z.coerce.number().int().nonnegative().default(50),
    SENTINEL_HARNESS_BOARDROOM_ALLOWLIST: optionalStringSchema,
    SENTINEL_REMINDER_HOURS_BEFORE_ETA: z.coerce.number().int().nonnegative().default(24),
    TELEGRAM_BOT_TOKEN: optionalStringSchema,
    TELEGRAM_BOT_USERNAME: optionalStringSchema,
    SENTINEL_TWITTER_ENABLED: booleanFlagSchema,
    TWITTER_API_KEY: optionalStringSchema,
    TWITTER_API_SECRET: optionalStringSchema,
    TWITTER_ACCESS_TOKEN: optionalStringSchema,
    TWITTER_ACCESS_TOKEN_SECRET: optionalStringSchema
  })
  .passthrough();

export type SentinelEnv = z.input<typeof sentinelEnvSchema>;
export type HarnessName = "claude" | "codex" | "none";
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

export type SentinelChainConfig = {
  readonly chainId: number;
  readonly confirmations: number;
  readonly explorerUrl?: string;
  readonly rpcUrl: string;
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
  readonly chains: SentinelChainConfig[];
  readonly databaseUrl: string;
  readonly harness: {
    readonly boardroomAllowlist: readonly string[];
    readonly cmd?: string;
    readonly dailyLimit: number;
    readonly model: string;
    readonly name: HarnessName;
    readonly timeoutMs: number;
    readonly workdir: string;
  };
  readonly maxBlockRange: number;
  readonly pollIntervalMs: number;
  readonly port: number;
  readonly reminderHoursBeforeEta: number;
  readonly telegram: {
    readonly botToken?: string;
    readonly botUsername?: string;
  };
  readonly trustedProxyIps: readonly string[];
  readonly twitter: {
    readonly accessToken?: string;
    readonly accessTokenSecret?: string;
    readonly apiKey?: string;
    readonly apiSecret?: string;
    readonly enabled: boolean;
  };
  readonly webOrigin: string;
};

function parseChainIds(value: string): number[] {
  const ids = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => z.coerce.number().int().positive().parse(part));

  if (ids.length === 0) {
    throw new Error("SENTINEL_CHAIN_IDS must include at least one chain id");
  }

  return [...new Set(ids)];
}

function parseAddressList(value: string | undefined): string[] {
  if (value === undefined) return [];

  return [
    ...new Set(
      value
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.length > 0)
        .map((part) => {
          if (!/^0x[0-9a-f]{40}$/.test(part)) {
            throw new Error(`Invalid boardroom address in SENTINEL_HARNESS_BOARDROOM_ALLOWLIST: ${part}`);
          }
          return part;
        })
    )
  ];
}

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

function readPositiveInteger(env: Record<string, unknown>, key: string, defaultValue: number): number {
  const value = readOptionalString(env, key);
  return value === undefined ? defaultValue : z.coerce.number().int().nonnegative().parse(value);
}

function readUrl(env: Record<string, unknown>, key: string): string {
  const value = readOptionalString(env, key);
  if (value === undefined) {
    throw new Error(`${key} is required for configured Sentinel chain`);
  }

  return z.string().url().parse(value);
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

  return clientId === undefined || clientSecret === undefined ? undefined : { clientId, clientSecret };
}

function withOptional<T extends object, K extends string, V>(
  target: T,
  key: K,
  value: V | undefined
): T & Partial<Record<K, V>> {
  if (value === undefined) {
    return target;
  }

  return { ...target, [key]: value };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const raw = sentinelEnvSchema.parse(env);
  const rawEnv = raw as Record<string, unknown>;
  const chainIds = parseChainIds(raw.SENTINEL_CHAIN_IDS);
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
  const webOrigin = readOrigin(raw.SENTINEL_WEB_ORIGIN, "SENTINEL_WEB_ORIGIN");

  const chains = chainIds.map((chainId): SentinelChainConfig => {
    const explorerUrl = readOptionalString(rawEnv, `SENTINEL_EXPLORER_URL_${chainId}`);
    return withOptional(
      {
        chainId,
        confirmations: readPositiveInteger(
          rawEnv,
          `SENTINEL_CONFIRMATIONS_${chainId}`,
          chainId === 31337 ? 0 : 5
        ),
        rpcUrl: readUrl(rawEnv, `SENTINEL_RPC_URL_${chainId}`)
      },
      "explorerUrl",
      explorerUrl
    );
  });

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
    chains,
    databaseUrl: raw.DATABASE_URL,
    harness: withOptional(
      {
        boardroomAllowlist: parseAddressList(raw.SENTINEL_HARNESS_BOARDROOM_ALLOWLIST),
        dailyLimit: raw.SENTINEL_HARNESS_DAILY_LIMIT,
        model: raw.SENTINEL_HARNESS_MODEL,
        name: raw.SENTINEL_HARNESS,
        timeoutMs: raw.SENTINEL_HARNESS_TIMEOUT_MS,
        workdir: raw.SENTINEL_HARNESS_WORKDIR ?? `${tmpdir()}/sentinel-analysis`
      },
      "cmd",
      raw.SENTINEL_HARNESS_CMD
    ),
    maxBlockRange: raw.SENTINEL_MAX_BLOCK_RANGE,
    pollIntervalMs: raw.SENTINEL_POLL_INTERVAL_MS,
    port: raw.SENTINEL_PORT,
    reminderHoursBeforeEta: raw.SENTINEL_REMINDER_HOURS_BEFORE_ETA,
    telegram: withOptional(
      withOptional({}, "botToken", raw.TELEGRAM_BOT_TOKEN),
      "botUsername",
      raw.TELEGRAM_BOT_USERNAME
    ),
    trustedProxyIps,
    twitter: withOptional(
      withOptional(
        withOptional(
          withOptional({ enabled: raw.SENTINEL_TWITTER_ENABLED }, "apiKey", raw.TWITTER_API_KEY),
          "apiSecret",
          raw.TWITTER_API_SECRET
        ),
        "accessToken",
        raw.TWITTER_ACCESS_TOKEN
      ),
      "accessTokenSecret",
      raw.TWITTER_ACCESS_TOKEN_SECRET
    ),
    webOrigin
  };
}
