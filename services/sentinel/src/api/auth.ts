import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { verifyMessage, type Address, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { z } from "zod";

import type { BoardroomControlChainReader } from "../chain/boardroom-control";
import type { BoardroomControlStore } from "./boardroom-control-store";
import { identityQuotaScope } from "./identity-quota";

import {
  AuthCapabilitiesResponseSchema,
  AuthMeResponseSchema,
  AuthRedirectRequestSchema,
  AuthSiweVerifyRequestSchema,
  UserDtoSchema,
  type AddressDto,
  type AuthMeResponse,
  type AuthProviderDto,
  type BoardroomRef,
  type ChannelDto,
  type HealthResponse,
  type NotificationDeliveriesQuery,
  type NotificationDeliveriesResponse,
  type PublicActionsQuery,
  type PublicActionsResponse,
  type AuthRedirectRequest,
  type AuthRedirectResponse,
  type AuthSiweNonceResponse,
  type SocialProviderDto,
  type SubscriptionDto,
  type UserDto,
  type WalletDto
} from "./dto";

const AUTH_SIWE_MAX_AGE_MS = 15 * 60_000;
const AUTH_SIWE_CLOCK_SKEW_MS = 5 * 60_000;
const AUTH_JSON_MAX_BODY_BYTES = 128 * 1024;
const DEFAULT_RATE_LIMIT_MAX_BUCKETS = 10_000;
const IDENTITY_RATE_WINDOW_MS = 5 * 60_000;
// Identity v0.1 permits 20 challenges per observed caller and wallet. Keep one
// anonymous Sentinel caller from consuming that entire upstream bucket.
const PUBLIC_SIWE_CHALLENGE_CLIENT_LIMIT = 10;
const PUBLIC_SIWE_CLIENT_LIMIT = 10;
const PUBLIC_SIWE_ATTEMPT_GLOBAL_LIMIT = 300;
// Identity v0.1 allows 60 wallet-grant issues per client and window. Keep ten
// available for authenticated wallet links even if the public sign-in route is abused.
const PUBLIC_SIWE_GLOBAL_LIMIT = 50;
const LegacyTelegramAuthRedirectRequestSchema = AuthRedirectRequestSchema
  .omit({ provider: true })
  .extend({ providerId: z.literal("telegram") });

export class AuthRateLimitError extends Error {
  constructor(message = "Rate limit exceeded") {
    super(message);
    this.name = "AuthRateLimitError";
  }
}

export class AuthSocialDependencyError extends Error {
  readonly retryAfter?: string;
  readonly status: 429 | 503;

  constructor(upstreamStatus: number, retryAfter?: string) {
    const rateLimited = upstreamStatus === 429;
    super(
      rateLimited
        ? "Too many social authentication attempts"
        : "Social authentication is temporarily unavailable"
    );
    this.name = "AuthSocialDependencyError";
    this.status = rateLimited ? 429 : 503;
    const normalizedRetryAfter = retryAfter?.trim();
    if (normalizedRetryAfter) {
      this.retryAfter = normalizedRetryAfter;
    }
  }
}

export class AuthWalletCredentialRejectedError extends Error {
  constructor(error: unknown) {
    super(
      error instanceof Error
        ? error.message
        : "Identity rejected the wallet credential"
    );
    this.name = "AuthWalletCredentialRejectedError";
  }
}

export type ApiChainConfig = {
  readonly chainId: number;
};

export type ApiConfig = {
  readonly chains: readonly ApiChainConfig[];
  readonly telegram: {
    readonly botUsername?: string;
  };
  readonly webOrigin: string;
};

export type AuthSession = {
  readonly user: {
    readonly id: string;
  };
};

export type AuthAdapter = {
  readonly socialProviders: readonly SocialProviderDto[];
  readonly sharedIdentityClientId?: string;
  readonly usesSharedIdentity?: boolean;
  createWalletChallenge?(input: {
    readonly address: AddressDto;
    readonly chainId: number;
    readonly clientIp?: string;
    readonly purpose: "link" | "sign-in";
    readonly userId?: string;
  }): Promise<AuthSiweNonceResponse & {
    readonly address: AddressDto;
    readonly chainId: number;
    readonly domain: string;
    readonly expirationTime: string;
    readonly issuedAt: string;
    readonly statement: string;
    readonly uri: string;
    readonly version: "1";
  }>;
  hydrateAuthSnapshot?(
    userId: string,
    snapshot: AuthSnapshot
  ): Promise<AuthSnapshot>;
  hydrateWallet?(
    userId: string,
    wallet: WalletDto
  ): Promise<WalletDto>;
  getProviders?(userId: string): Promise<AuthProviderDto[]>;
  getSocialProviders?(): Promise<SocialProviderDto[]>;
  getSession(input: { readonly headers: Headers }): Promise<AuthSession | null>;
  handler(
    request: Request,
    context?: { readonly clientIp?: string }
  ): Promise<Response>;
  linkWalletCredential?(input: {
    readonly address: AddressDto;
    readonly chainId: number;
    readonly message: string;
    readonly signature: string;
    readonly userId: string;
    readonly verifiedAt: Date;
  }): Promise<WalletDto>;
  startSocial?(input: {
    readonly clientIp?: string;
    readonly headers: Headers;
    readonly link: boolean;
    readonly request: AuthRedirectRequest;
    readonly userId?: string;
  }): Promise<{
    readonly headers?: Headers;
    readonly response: AuthRedirectResponse;
  }>;
};

export type AuthSnapshot = {
  readonly channels: ChannelDto[];
  readonly providers: AuthProviderDto[];
  readonly subscription: SubscriptionDto;
  readonly wallets: WalletDto[];
};

export type WalletNonceRecord = {
  readonly expiresAt: Date;
  readonly nonce: string;
  readonly usedAt: Date | null;
  readonly userId: string;
};

export type TelegramLinkCodeRecord = {
  readonly code: string;
  readonly expiresAt: Date;
};

export type SentinelApiStore = {
  consumeWalletNonce(input: {
    readonly nonce: string;
    readonly now: Date;
    readonly userId: string;
  }): Promise<boolean>;
  createTelegramLinkCode(input: {
    readonly code: string;
    readonly expiresAt: Date;
    readonly userId: string;
  }): Promise<TelegramLinkCodeRecord>;
  createWalletNonce(input: {
    readonly expiresAt: Date;
    readonly nonce: string;
    readonly userId: string;
  }): Promise<WalletNonceRecord>;
  deleteChannel(input: { readonly id: string; readonly userId: string }): Promise<boolean>;
  getAuthSnapshot(userId: string): Promise<AuthSnapshot>;
  getChannels(userId: string): Promise<ChannelDto[]>;
  getCursorLags(chainIds: readonly number[]): Promise<HealthResponse["chains"]>;
  getNotificationDeliveries(
    userId: string,
    query: NotificationDeliveriesQuery
  ): Promise<NotificationDeliveriesResponse>;
  getPublicActions(query: PublicActionsQuery): Promise<PublicActionsResponse>;
  getSubscription(userId: string): Promise<SubscriptionDto>;
  getWalletNonce(nonce: string): Promise<WalletNonceRecord | null>;
  linkWallet(input: {
    readonly address: AddressDto;
    readonly chainId: number;
    readonly siweMessage: string;
    readonly userId: string;
    readonly verifiedAt: Date;
  }): Promise<WalletDto | null>;
  ping(): Promise<void>;
  putSubscription(input: {
    readonly boardrooms: readonly BoardroomRef[];
    readonly minSeverity: SubscriptionDto["minSeverity"];
    readonly mode: SubscriptionDto["mode"];
    readonly userId: string;
  }): Promise<SubscriptionDto>;
  setWalletAlerts(input: {
    readonly address: AddressDto;
    readonly alertsEnabled: boolean;
    readonly userId: string;
  }): Promise<WalletDto | null>;
  takeIdentityQuota(input: {
    readonly capacity: number;
    readonly now: Date;
    readonly scope: string;
    readonly windowMs: number;
  }): Promise<boolean>;
};

export type SiweSignatureVerifier = (input: {
  readonly address: AddressDto;
  readonly chainId: number;
  readonly message: string;
  readonly signature: string;
}) => Promise<boolean>;

export type RateLimitConfig = {
  readonly capacity?: number;
  readonly maxBuckets?: number;
  readonly refillMs?: number;
};

export type SentinelApiDeps = {
  readonly auth: AuthAdapter;
  readonly boardroomControl?: {
    readonly chain: BoardroomControlChainReader;
    readonly store: BoardroomControlStore;
  };
  readonly config: ApiConfig;
  readonly generateLinkCode?: () => string;
  readonly generateNonce?: () => string;
  readonly now?: () => Date;
  readonly rateLimit?: RateLimitConfig;
  readonly store: SentinelApiStore;
  readonly verifySiweSignature?: SiweSignatureVerifier;
};

export type ApiVariables = {
  user: UserDto;
};

export type ApiEnv = {
  Bindings: {
    readonly clientIp?: string;
  };
  Variables: ApiVariables;
};

type JsonErrorStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 413
  | 422
  | 429
  | 500
  | 503;

type ParseResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly response: Response;
    };

export function getNow(deps: SentinelApiDeps): Date {
  return deps.now?.() ?? new Date();
}

export function jsonError(
  c: Context<ApiEnv>,
  status: JsonErrorStatus,
  message: string
): Response {
  return c.json({ error: { message } }, status);
}

function zodErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) {
    return "Invalid request";
  }

  const path = issue.path.length === 0 ? "request" : issue.path.join(".");
  return `${path}: ${issue.message}`;
}

export function parseQuery<T>(
  c: Context<ApiEnv>,
  schema: z.ZodType<T>,
  input: unknown
): ParseResult<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, response: jsonError(c, 400, zodErrorMessage(parsed.error)) };
  }

  return { ok: true, value: parsed.data };
}

export async function parseJson<T>(
  c: Context<ApiEnv>,
  schema: z.ZodType<T>,
  request: Request = c.req.raw
): Promise<ParseResult<T>> {
  let value: unknown = {};

  try {
    const text = await request.text();
    value = text.trim().length === 0 ? {} : JSON.parse(text);
  } catch {
    return { ok: false, response: jsonError(c, 400, "Body must be valid JSON") };
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, response: jsonError(c, 400, zodErrorMessage(parsed.error)) };
  }

  return { ok: true, value: parsed.data };
}

export function createSessionMiddleware(deps: SentinelApiDeps): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const session = await deps.auth.getSession({ headers: c.req.raw.headers });
    if (session === null) {
      return jsonError(c, 401, "Authentication required");
    }

    const user = UserDtoSchema.parse({ id: session.user.id });
    c.set("user", user);
    return await next();
  };
}

function clientIp(c: Context<ApiEnv>): string {
  return c.env?.clientIp?.trim() || "unknown";
}

export function createRateLimitMiddleware(
  deps: SentinelApiDeps,
  scope: string,
  options: RateLimitConfig = {}
): MiddlewareHandler<ApiEnv> {
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();
  const capacity = options.capacity ?? deps.rateLimit?.capacity ?? 60;
  const maxBuckets = Math.max(
    1,
    Math.floor(
      options.maxBuckets ??
        deps.rateLimit?.maxBuckets ??
        DEFAULT_RATE_LIMIT_MAX_BUCKETS
    )
  );
  const refillMs = options.refillMs ?? deps.rateLimit?.refillMs ?? 60_000;

  return async (c, next) => {
    const nowMs = getNow(deps).getTime();
    const userId = c.var.user?.id ?? "anonymous";
    const key = `${scope}:${clientIp(c)}:${userId}`;
    const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: nowMs };
    const elapsed = Math.max(0, nowMs - bucket.updatedAt);
    const refill = Math.floor(elapsed / refillMs) * capacity;
    const tokens = Math.min(capacity, bucket.tokens + refill);
    const updatedAt = refill > 0 ? nowMs : bucket.updatedAt;
    const storeBucket = (nextBucket: {
      readonly tokens: number;
      readonly updatedAt: number;
    }) => {
      buckets.delete(key);
      buckets.set(key, nextBucket);
      while (buckets.size > maxBuckets) {
        const oldest = buckets.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        buckets.delete(oldest);
      }
    };

    if (tokens <= 0) {
      storeBucket({ tokens, updatedAt });
      return jsonError(c, 429, "Rate limit exceeded");
    }

    storeBucket({ tokens: tokens - 1, updatedAt });
    return await next();
  };
}

function createIdentityQuotaMiddleware(
  deps: SentinelApiDeps,
  kind: "wallet-proof-public" | "wallet-grant-public",
  capacity: number,
  windowMs: number
): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const admitted = await deps.store.takeIdentityQuota({
      capacity,
      now: getNow(deps),
      scope: identityQuotaScope(
        deps.auth.sharedIdentityClientId ?? "shared-identity",
        kind
      ),
      windowMs
    });
    if (!admitted) {
      return jsonError(c, 429, "Rate limit exceeded");
    }
    return await next();
  };
}

export function createAuthRoutes(deps: SentinelApiDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const publicSiweClientRateLimit = createRateLimitMiddleware(
    deps,
    "auth-siwe-verify-client",
    {
      capacity: PUBLIC_SIWE_CLIENT_LIMIT,
      maxBuckets: PUBLIC_SIWE_GLOBAL_LIMIT,
      refillMs: IDENTITY_RATE_WINDOW_MS
    }
  );
  const publicSiweChallengeClientRateLimit = createRateLimitMiddleware(
    deps,
    "auth-siwe-challenge-client",
    {
      capacity: PUBLIC_SIWE_CHALLENGE_CLIENT_LIMIT,
      refillMs: IDENTITY_RATE_WINDOW_MS
    }
  );
  const publicSiweGlobalRateLimit = createIdentityQuotaMiddleware(
    deps,
    "wallet-grant-public",
    PUBLIC_SIWE_GLOBAL_LIMIT,
    IDENTITY_RATE_WINDOW_MS
  );
  const publicSiweAttemptGlobalRateLimit = createIdentityQuotaMiddleware(
    deps,
    "wallet-proof-public",
    PUBLIC_SIWE_ATTEMPT_GLOBAL_LIMIT,
    IDENTITY_RATE_WINDOW_MS
  );
  const authBodyLimit = bodyLimit({
    maxSize: AUTH_JSON_MAX_BODY_BYTES,
    onError: (c) => jsonError(c, 413, "Request body is too large")
  });

  app.get("/capabilities", async (c) => {
    let socialProviders = deps.auth.socialProviders;
    try {
      socialProviders =
        (await deps.auth.getSocialProviders?.()) ?? socialProviders;
    } catch {
      // Product sessions and alert delivery remain usable during an Identity
      // outage; only new central social authentication is unavailable.
    }
    return c.json(
      AuthCapabilitiesResponseSchema.parse({
        socialProviders,
        walletlessSocialSignIn:
          deps.auth.usesSharedIdentity === true && socialProviders.length > 0
      })
    );
  });

  app.get("/me", async (c) => {
    const session = await deps.auth.getSession({ headers: c.req.raw.headers });
    if (session === null) {
      return c.json(null);
    }

    const user = UserDtoSchema.parse({ id: session.user.id });
    let snapshot = await deps.store.getAuthSnapshot(user.id);
    if (deps.auth.hydrateAuthSnapshot !== undefined) {
      try {
        snapshot = await deps.auth.hydrateAuthSnapshot(user.id, snapshot);
      } catch {
        // Keep the product session readable during an Identity outage, but do
        // not claim that any centrally owned credential is still active.
        snapshot = {
          ...snapshot,
          providers: [],
          wallets: snapshot.wallets.map((wallet) => ({
            ...wallet,
            canSignIn: false
          }))
        };
      }
    } else {
      try {
        snapshot = {
          ...snapshot,
          providers:
            (await deps.auth.getProviders?.(user.id)) ?? snapshot.providers
        };
      } catch {
        // Provider labels are presentation data. Do not turn an Identity outage
        // into revocation of an otherwise valid PledgeCash product session.
      }
    }
    const response: AuthMeResponse = AuthMeResponseSchema.parse({
      user,
      ...snapshot
    });
    return c.json(response);
  });

  const startSocial = deps.auth.startSocial;
  if (startSocial !== undefined) {
    const start = async (
      c: Context<ApiEnv>,
      request: AuthRedirectRequest,
      link: boolean,
      userId?: string
    ) => {
      try {
        const result = await startSocial({
          headers: c.req.raw.headers,
          link,
          request,
          ...(c.env?.clientIp === undefined
            ? {}
            : { clientIp: c.env.clientIp }),
          ...(userId === undefined ? {} : { userId })
        });
        copySetCookies(c, result.headers);
        return c.json(result.response);
      } catch (error) {
        if (error instanceof AuthSocialDependencyError) {
          if (error.retryAfter !== undefined) {
            c.header("Retry-After", error.retryAfter);
          }
          return jsonError(c, error.status, error.message);
        }
        throw error;
      }
    };

    app.post("/peezy/sign-in", authBodyLimit, async (c) => {
      const body = await parseJson(c, AuthRedirectRequestSchema);
      if (!body.ok) return body.response;
      return start(c, body.value, false);
    });
    app.post(
      "/peezy/link",
      createSessionMiddleware(deps),
      authBodyLimit,
      async (c) => {
        const body = await parseJson(c, AuthRedirectRequestSchema);
        if (!body.ok) return body.response;
        return start(c, body.value, true, c.get("user").id);
      }
    );

    if (deps.auth.usesSharedIdentity === true) {
      app.post("/sign-in/social", authBodyLimit, async (c) => {
        const body = await parseJson(c, AuthRedirectRequestSchema);
        if (!body.ok) return body.response;
        return start(c, body.value, false);
      });
      app.post(
        "/link-social",
        createSessionMiddleware(deps),
        authBodyLimit,
        async (c) => {
          const body = await parseJson(c, AuthRedirectRequestSchema);
          if (!body.ok) return body.response;
          return start(c, body.value, true, c.get("user").id);
        }
      );
      app.post("/sign-in/oauth2", authBodyLimit, async (c) => {
        const body = await parseJson(c, LegacyTelegramAuthRedirectRequestSchema);
        if (!body.ok) return body.response;
        return start(c, { ...body.value, provider: "telegram" }, false);
      });
      app.post(
        "/oauth2/link",
        createSessionMiddleware(deps),
        authBodyLimit,
        async (c) => {
          const body = await parseJson(
            c,
            LegacyTelegramAuthRedirectRequestSchema
          );
          if (!body.ok) return body.response;
          return start(
            c,
            { ...body.value, provider: "telegram" },
            true,
            c.get("user").id
          );
        }
      );
    }
  }

  const validateIdentitySiwe: MiddlewareHandler<ApiEnv> = async (c, next) => {
    const body = await parseJson(
      c,
      AuthSiweVerifyRequestSchema,
      c.req.raw.clone()
    );
    if (!body.ok) return body.response;

    let siwe: ReturnType<typeof parseSiweMessage>;
    try {
      siwe = parseSiweMessage(body.value.message);
    } catch {
      return jsonError(c, 400, "SIWE message is invalid");
    }
    const expectedOrigin = new URL(deps.config.webOrigin);
    let siweOrigin: string | undefined;
    try {
      siweOrigin =
        siwe.uri === undefined ? undefined : new URL(siwe.uri).origin;
    } catch {
      return jsonError(c, 400, "SIWE message is invalid");
    }
    const nowMs = getNow(deps).getTime();
    if (
      siwe.address === undefined ||
      siwe.address.toLowerCase() !== body.value.walletAddress.toLowerCase() ||
      siwe.chainId !== body.value.chainId ||
      siwe.domain !== expectedOrigin.host ||
      siweOrigin !== expectedOrigin.origin ||
      siwe.version !== "1" ||
      siwe.issuedAt === undefined ||
      siwe.expirationTime === undefined ||
      siwe.issuedAt.getTime() > nowMs + AUTH_SIWE_CLOCK_SKEW_MS ||
      nowMs - siwe.issuedAt.getTime() > AUTH_SIWE_MAX_AGE_MS ||
      siwe.expirationTime.getTime() <= nowMs ||
      siwe.expirationTime.getTime() - siwe.issuedAt.getTime() >
        AUTH_SIWE_MAX_AGE_MS ||
      (siwe.notBefore !== undefined && siwe.notBefore.getTime() > nowMs)
    ) {
      return jsonError(c, 400, "SIWE message is invalid");
    }

    // Identity v0.1 accepts only standard 65-byte EOA signatures. Reject every
    // other proof shape locally so it cannot spend the shared wallet-grant quota.
    if (body.value.signature.length !== 132) {
      return jsonError(c, 401, "Wallet signature could not be verified");
    }
    let signatureValid = false;
    try {
      signatureValid = await verifyMessage({
        address: body.value.walletAddress as Address,
        message: body.value.message,
        signature: body.value.signature as Hex
      });
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      return jsonError(c, 401, "Wallet signature could not be verified");
    }
    return await next();
  };
  const forwardAuthRequest = (c: Context<ApiEnv>) =>
    deps.auth.handler(c.req.raw, {
      ...(c.env?.clientIp === undefined ? {} : { clientIp: c.env.clientIp })
    });

  if (deps.auth.usesSharedIdentity === true) {
    app.post(
      "/peezy/siwe/nonce",
      authBodyLimit,
      publicSiweChallengeClientRateLimit,
      forwardAuthRequest
    );
    app.post(
      "/siwe/nonce",
      authBodyLimit,
      publicSiweChallengeClientRateLimit,
      forwardAuthRequest
    );
    app.post(
      "/peezy/siwe/verify",
      authBodyLimit,
      publicSiweClientRateLimit,
      publicSiweAttemptGlobalRateLimit,
      validateIdentitySiwe,
      publicSiweGlobalRateLimit,
      forwardAuthRequest
    );
    app.post(
      "/siwe/verify",
      authBodyLimit,
      publicSiweClientRateLimit,
      publicSiweAttemptGlobalRateLimit,
      validateIdentitySiwe,
      forwardAuthRequest
    );
  } else {
    app.post("/siwe/verify", forwardAuthRequest);
  }

  return app;
}

function copySetCookies(c: Context<ApiEnv>, headers: Headers | undefined): void {
  if (headers === undefined) return;
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter((value): value is string => value !== null);
  for (const value of values) {
    c.header("Set-Cookie", value, { append: true });
  }
}
