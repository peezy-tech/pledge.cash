import { tmpdir } from "node:os";

import { z } from "zod";

const optionalStringSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);

const booleanFlagSchema = z
  .enum(["0", "1", "false", "true"])
  .default("0")
  .transform((value) => value === "1" || value === "true");

export const sentinelEnvSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    SENTINEL_PORT: z.coerce.number().int().positive().default(8787),
    SENTINEL_WEB_ORIGIN: z.string().url(),
    SENTINEL_CHAIN_IDS: z.string().min(1).default("998,10143"),
    SENTINEL_RPC_URL_998: z.string().url().default("https://rpc.hyperliquid-testnet.xyz/evm"),
    SENTINEL_RPC_URL_10143: z.string().url().default("https://testnet-rpc.monad.xyz"),
    SENTINEL_RPC_URL_31337: optionalStringSchema,
    SENTINEL_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(12_000),
    SENTINEL_MAX_BLOCK_RANGE: z.coerce.number().int().positive().default(2_000),
    WORKOS_API_KEY: optionalStringSchema,
    WORKOS_CLIENT_ID: optionalStringSchema,
    WORKOS_COOKIE_PASSWORD: optionalStringSchema,
    WORKOS_REDIRECT_URI: optionalStringSchema,
    SENTINEL_HARNESS: z.enum(["claude", "codex", "none"]).default("claude"),
    SENTINEL_HARNESS_CMD: optionalStringSchema,
    SENTINEL_HARNESS_MODEL: z.string().trim().min(1).default("claude-opus-4-8"),
    SENTINEL_HARNESS_WORKDIR: optionalStringSchema,
    SENTINEL_HARNESS_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
    SENTINEL_HARNESS_DAILY_LIMIT: z.coerce.number().int().nonnegative().default(50),
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

export type SentinelChainConfig = {
  readonly chainId: number;
  readonly confirmations: number;
  readonly explorerUrl?: string;
  readonly rpcUrl: string;
};

export type Config = {
  readonly chains: SentinelChainConfig[];
  readonly databaseUrl: string;
  readonly harness: {
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
  readonly twitter: {
    readonly accessToken?: string;
    readonly accessTokenSecret?: string;
    readonly apiKey?: string;
    readonly apiSecret?: string;
    readonly enabled: boolean;
  };
  readonly webOrigin: string;
  readonly workos: {
    readonly apiKey?: string;
    readonly clientId?: string;
    readonly cookiePassword?: string;
    readonly redirectUri?: string;
  };
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
    chains,
    databaseUrl: raw.DATABASE_URL,
    harness: withOptional(
      {
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
    webOrigin: raw.SENTINEL_WEB_ORIGIN,
    workos: withOptional(
      withOptional(
        withOptional(
          withOptional({}, "apiKey", raw.WORKOS_API_KEY),
          "clientId",
          raw.WORKOS_CLIENT_ID
        ),
        "cookiePassword",
        raw.WORKOS_COOKIE_PASSWORD
      ),
      "redirectUri",
      raw.WORKOS_REDIRECT_URI
    )
  };
}
