import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";

import type { BoardroomControlChainReader } from "../chain/boardroom-control";
import type { BoardroomControlStore } from "./boardroom-control-store";

import {
  AuthCapabilitiesResponseSchema,
  AuthMeResponseSchema,
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
  type SocialProviderDto,
  type SubscriptionDto,
  type UserDto,
  type WalletDto
} from "./dto";

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
  getSession(input: { readonly headers: Headers }): Promise<AuthSession | null>;
  handler(request: Request): Promise<Response>;
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
  schema: z.ZodType<T>
): Promise<ParseResult<T>> {
  let value: unknown = {};

  try {
    const text = await c.req.text();
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
  scope: string
): MiddlewareHandler<ApiEnv> {
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();
  const capacity = deps.rateLimit?.capacity ?? 60;
  const refillMs = deps.rateLimit?.refillMs ?? 60_000;

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

export function createAuthRoutes(deps: SentinelApiDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.get("/capabilities", (c) =>
    c.json(
      AuthCapabilitiesResponseSchema.parse({ socialProviders: deps.auth.socialProviders })
    )
  );

  app.get("/me", async (c) => {
    const session = await deps.auth.getSession({ headers: c.req.raw.headers });
    if (session === null) {
      return c.json(null);
    }

    const user = UserDtoSchema.parse({ id: session.user.id });
    const snapshot = await deps.store.getAuthSnapshot(user.id);
    const response: AuthMeResponse = AuthMeResponseSchema.parse({ user, ...snapshot });
    return c.json(response);
  });

  return app;
}
