import { Hono, type Context, type MiddlewareHandler } from "hono";
import { verifyMessage, type Address, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { z } from "zod";

import type { BoardroomControlChainReader } from "../chain/boardroom-control";
import type { BoardroomControlStore } from "./boardroom-control-store";

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
const IDENTITY_RATE_WINDOW_MS = 5 * 60_000;
const PUBLIC_SIWE_CLIENT_LIMIT = 10;
// Identity v0.1 allows 60 wallet-grant issues per client and window. Keep ten
// available for authenticated wallet links even if the public sign-in route is abused.
const PUBLIC_SIWE_GLOBAL_LIMIT = 50;

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
  createWalletChallenge?(input: {
    readonly address: AddressDto;
    readonly chainId: number;
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
  getProviders?(userId: string): Promise<AuthProviderDto[]>;
  getSocialProviders?(): Promise<SocialProviderDto[]>;
  getSession(input: { readonly headers: Headers }): Promise<AuthSession | null>;
  handler(request: Request): Promise<Response>;
  linkWalletCredential?(input: {
    readonly address: AddressDto;
    readonly chainId: number;
    readonly message: string;
    readonly signature: string;
    readonly userId: string;
    readonly verifiedAt: Date;
  }): Promise<WalletDto>;
  startSocial?(input: {
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
};

export type SiweSignatureVerifier = (input: {
  readonly address: AddressDto;
  readonly chainId: number;
  readonly message: string;
  readonly signature: string;
}) => Promise<boolean>;

export type RateLimitConfig = {
  readonly capacity?: number;
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
  Variables: ApiVariables;
};

type JsonErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;

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
  const forwardedFor = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor ?? c.req.header("cf-connecting-ip") ?? "unknown";
}

export function createRateLimitMiddleware(
  deps: SentinelApiDeps,
  scope: string,
  options: RateLimitConfig = {}
): MiddlewareHandler<ApiEnv> {
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();
  const capacity = options.capacity ?? deps.rateLimit?.capacity ?? 60;
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

    if (tokens <= 0) {
      buckets.set(key, { tokens, updatedAt });
      return jsonError(c, 429, "Rate limit exceeded");
    }

    buckets.set(key, { tokens: tokens - 1, updatedAt });
    return await next();
  };
}

function createGlobalSlidingWindowRateLimitMiddleware(
  deps: SentinelApiDeps,
  capacity: number,
  windowMs: number
): MiddlewareHandler<ApiEnv> {
  const requestTimes: number[] = [];

  return async (c, next) => {
    const nowMs = getNow(deps).getTime();
    while (
      requestTimes[0] !== undefined &&
      requestTimes[0] <= nowMs - windowMs
    ) {
      requestTimes.shift();
    }
    if (requestTimes.length >= capacity) {
      return jsonError(c, 429, "Rate limit exceeded");
    }
    requestTimes.push(nowMs);
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
      refillMs: IDENTITY_RATE_WINDOW_MS
    }
  );
  const publicSiweGlobalRateLimit = createGlobalSlidingWindowRateLimitMiddleware(
    deps,
    PUBLIC_SIWE_GLOBAL_LIMIT,
    IDENTITY_RATE_WINDOW_MS
  );

  app.get("/capabilities", async (c) => {
    let socialProviders = deps.auth.socialProviders;
    try {
      socialProviders =
        (await deps.auth.getSocialProviders?.()) ?? socialProviders;
    } catch {
      // Product sessions and alert delivery remain usable during an Identity
      // outage; only new central social authentication is unavailable.
    }
    return c.json(AuthCapabilitiesResponseSchema.parse({ socialProviders }));
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
    app.post("/peezy/sign-in", async (c) => {
      const body = await parseJson(c, AuthRedirectRequestSchema);
      if (!body.ok) return body.response;
      const result = await startSocial({
        headers: c.req.raw.headers,
        link: false,
        request: body.value
      });
      copySetCookies(c, result.headers);
      return c.json(result.response);
    });
    app.post("/peezy/link", createSessionMiddleware(deps), async (c) => {
      const body = await parseJson(c, AuthRedirectRequestSchema);
      if (!body.ok) return body.response;
      const result = await startSocial({
        headers: c.req.raw.headers,
        link: true,
        request: body.value,
        userId: c.get("user").id
      });
      copySetCookies(c, result.headers);
      return c.json(result.response);
    });
  }

  app.post(
    "/siwe/verify",
    publicSiweClientRateLimit,
    async (c, next) => {
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

      // Standard EOA signatures can be rejected locally without spending the
      // confidential Identity client's shared grant quota. Longer signatures
      // may be ERC-1271 or EIP-6492 proofs and remain Identity-owned.
      if (body.value.signature.length === 132) {
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
      }
      return await next();
    },
    publicSiweGlobalRateLimit,
    (c) => deps.auth.handler(c.req.raw)
  );

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
