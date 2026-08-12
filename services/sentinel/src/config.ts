import { isIP } from "node:net";

import { z } from "zod";

const optionalStringSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);
const clientIdSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._~-]+$/)
);

export const sentinelEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  SENTINEL_PORT: z.coerce.number().int().positive().default(8787),
  SENTINEL_TRUSTED_PROXY_IPS: optionalStringSchema,
  SENTINEL_WEB_ORIGIN: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  PEEZY_IDENTITY_URL: z.string().url(),
  PEEZY_IDENTITY_CLIENT_ID: clientIdSchema,
  PEEZY_IDENTITY_APP_CLIENT_SECRET: z.string().min(32),
  PEEZY_IDENTITY_OIDC_CLIENT_SECRET: z.string().min(32)
});

export type SentinelEnv = z.input<typeof sentinelEnvSchema>;
export type Config = {
  readonly auth: {
    readonly baseUrl: string;
    readonly identity: {
      readonly baseUrl: string;
      readonly appClientSecret: string;
      readonly clientId: string;
      readonly oidcClientSecret: string;
    };
    readonly secret: string;
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

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const raw = sentinelEnvSchema.parse(env);
  const authBaseUrl = readOrigin(raw.BETTER_AUTH_URL, "BETTER_AUTH_URL");
  const identityBaseUrl = readIdentityOrigin(raw.PEEZY_IDENTITY_URL);
  if (
    raw.PEEZY_IDENTITY_APP_CLIENT_SECRET === raw.PEEZY_IDENTITY_OIDC_CLIENT_SECRET
  ) {
    throw new Error(
      "PEEZY_IDENTITY_APP_CLIENT_SECRET and PEEZY_IDENTITY_OIDC_CLIENT_SECRET must be distinct"
    );
  }
  const trustedProxyIps = parseIpList(raw.SENTINEL_TRUSTED_PROXY_IPS);
  if (
    new URL(authBaseUrl).protocol === "https:" &&
    trustedProxyIps.length === 0
  ) {
    throw new Error(
      "SENTINEL_TRUSTED_PROXY_IPS must identify the HTTPS edge in shared Identity mode"
    );
  }

  return {
    auth: {
      baseUrl: authBaseUrl,
      identity: {
        appClientSecret: raw.PEEZY_IDENTITY_APP_CLIENT_SECRET,
        baseUrl: identityBaseUrl,
        clientId: raw.PEEZY_IDENTITY_CLIENT_ID,
        oidcClientSecret: raw.PEEZY_IDENTITY_OIDC_CLIENT_SECRET
      },
      secret: raw.BETTER_AUTH_SECRET
    },
    databaseUrl: raw.DATABASE_URL,
    port: raw.SENTINEL_PORT,
    trustedProxyIps,
    webOrigin: readOrigin(raw.SENTINEL_WEB_ORIGIN, "SENTINEL_WEB_ORIGIN")
  };
}
