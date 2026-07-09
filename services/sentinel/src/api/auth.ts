import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";

import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";

import {
  AuthCallbackQuerySchema,
  AuthLoginQuerySchema,
  AuthMeResponseSchema,
  LogoutResponseSchema,
  type AddressDto,
  type AuthMeResponse,
  type BoardroomRef,
  type ChannelDto,
  type HealthResponse,
  type PublicActionsQuery,
  type PublicActionsResponse,
  type SubscriptionDto,
  type UserDto,
  type WalletDto
} from "./dto";

export const SESSION_COOKIE_NAME = "__Secure-pledge_cash_sentinel_session";
export const AUTH_STATE_COOKIE_NAME = "__Secure-pledge_cash_sentinel_auth_state";
const AUTH_STATE_TTL_MS = 10 * 60 * 1000;

const sessionCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "Lax" as const,
  secure: true
};

const authStateCookieOptions = {
  ...sessionCookieOptions,
  maxAge: AUTH_STATE_TTL_MS / 1000,
  path: "/auth"
};

type AuthStateCookie = {
  readonly expiresAt: string;
  readonly returnTo: string;
  readonly state: string;
};

export type ApiChainConfig = {
  readonly chainId: number;
};

export type ApiConfig = {
  readonly chains: readonly ApiChainConfig[];
  readonly telegram: {
    readonly botUsername?: string;
  };
  readonly webOrigin: string;
  readonly workos?: {
    readonly clientId?: string;
    readonly cookiePassword?: string;
    readonly redirectUri?: string;
  };
};

export type AuthKitUser = {
  readonly email: string;
  readonly id: string;
};

export type AuthKitAdapter = {
  authenticateWithCode(input: {
    readonly code: string;
    readonly state?: string;
  }): Promise<{
    readonly sealedSession: string;
    readonly user: AuthKitUser;
  }>;
  getAuthorizationUrl(input: { readonly returnTo: string; readonly state: string }): Promise<string> | string;
  getSession(input: { readonly sealedSession: string }): Promise<{ readonly user: AuthKitUser } | null>;
  revokeSession(input: { readonly sealedSession: string }): Promise<void>;
};

export type AuthSnapshot = {
  readonly channels: ChannelDto[];
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
  getPublicActions(query: PublicActionsQuery): Promise<PublicActionsResponse>;
  getSubscription(userId: string): Promise<SubscriptionDto>;
  getWalletNonce(nonce: string): Promise<WalletNonceRecord | null>;
  linkWallet(input: {
    readonly address: AddressDto;
    readonly siweMessage: string;
    readonly userId: string;
    readonly verifiedAt: Date;
  }): Promise<WalletDto>;
  ping(): Promise<void>;
  putSubscription(input: {
    readonly boardrooms: readonly BoardroomRef[];
    readonly minSeverity: SubscriptionDto["minSeverity"];
    readonly mode: SubscriptionDto["mode"];
    readonly userId: string;
  }): Promise<SubscriptionDto>;
  unlinkWallet(input: { readonly address: AddressDto; readonly userId: string }): Promise<boolean>;
  upsertUser(user: { readonly email: string; readonly workosUserId: string }): Promise<UserDto>;
};

export type SiweSignatureVerifier = (input: {
  readonly address: AddressDto;
  readonly message: string;
  readonly signature: string;
}) => Promise<boolean>;

export type RateLimitConfig = {
  readonly capacity?: number;
  readonly refillMs?: number;
};

export type SentinelApiDeps = {
  readonly auth: AuthKitAdapter;
  readonly config: ApiConfig;
  readonly generateLinkCode?: () => string;
  readonly generateNonce?: () => string;
  readonly now?: () => Date;
  readonly rateLimit?: RateLimitConfig;
  readonly store: SentinelApiStore;
  readonly verifySiweSignature?: SiweSignatureVerifier;
};

export type ApiVariables = {
  sealedSession: string;
  user: UserDto;
  workosUser: AuthKitUser;
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

export function validateReturnTo(webOrigin: string, candidate: string | undefined): string {
  if (candidate === undefined) {
    return webOrigin;
  }

  try {
    const webOriginUrl = new URL(webOrigin);
    const returnToUrl = new URL(candidate);
    return returnToUrl.origin === webOriginUrl.origin ? returnToUrl.toString() : webOrigin;
  } catch {
    return webOrigin;
  }
}

function generateAuthState(deps: SentinelApiDeps): string {
  return deps.generateNonce?.() ?? randomBytes(16).toString("base64url");
}

function encodeAuthStateCookie(value: AuthStateCookie): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeAuthStateCookie(value: string | undefined, now: Date): AuthStateCookie | null {
  if (value === undefined || value.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<AuthStateCookie>;
    if (
      typeof parsed.expiresAt !== "string" ||
      typeof parsed.returnTo !== "string" ||
      typeof parsed.state !== "string" ||
      parsed.state.length === 0
    ) {
      return null;
    }

    const expiresAt = Date.parse(parsed.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
      return null;
    }

    return {
      expiresAt: parsed.expiresAt,
      returnTo: parsed.returnTo,
      state: parsed.state
    };
  } catch {
    return null;
  }
}

export function createSessionMiddleware(deps: SentinelApiDeps): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const sealedSession = getCookie(c, SESSION_COOKIE_NAME);
    if (sealedSession === undefined || sealedSession.length === 0) {
      return jsonError(c, 401, "Authentication required");
    }

    const session = await deps.auth.getSession({ sealedSession });
    if (session === null) {
      return jsonError(c, 401, "Authentication required");
    }

    const user = await deps.store.upsertUser({
      email: session.user.email,
      workosUserId: session.user.id
    });

    c.set("sealedSession", sealedSession);
    c.set("user", user);
    c.set("workosUser", session.user);

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
  const rateLimit = createRateLimitMiddleware(deps, "auth");
  const requireSession = createSessionMiddleware(deps);

  app.get("/login", rateLimit, async (c) => {
    const parsed = parseQuery(c, AuthLoginQuerySchema, c.req.query());
    if (!parsed.ok) {
      return parsed.response;
    }

    const returnTo = validateReturnTo(deps.config.webOrigin, parsed.value.return_to);
    const state = generateAuthState(deps);
    const expiresAt = new Date(getNow(deps).getTime() + AUTH_STATE_TTL_MS).toISOString();
    setCookie(
      c,
      AUTH_STATE_COOKIE_NAME,
      encodeAuthStateCookie({ expiresAt, returnTo, state }),
      authStateCookieOptions
    );

    const authorizationUrl = await deps.auth.getAuthorizationUrl({ returnTo, state });
    return c.redirect(authorizationUrl, 302);
  });

  app.get("/callback", rateLimit, async (c) => {
    const parsed = parseQuery(c, AuthCallbackQuerySchema, c.req.query());
    if (!parsed.ok) {
      return parsed.response;
    }

    const expectedState = decodeAuthStateCookie(getCookie(c, AUTH_STATE_COOKIE_NAME), getNow(deps));
    deleteCookie(c, AUTH_STATE_COOKIE_NAME, authStateCookieOptions);
    if (
      expectedState === null ||
      parsed.value.state === undefined ||
      parsed.value.state !== expectedState.state
    ) {
      return jsonError(c, 400, "Invalid authentication state");
    }

    const authenticated = await deps.auth.authenticateWithCode({
      code: parsed.value.code,
      state: expectedState.state
    });

    await deps.store.upsertUser({
      email: authenticated.user.email,
      workosUserId: authenticated.user.id
    });

    setCookie(c, SESSION_COOKIE_NAME, authenticated.sealedSession, sessionCookieOptions);

    const returnTo = validateReturnTo(deps.config.webOrigin, expectedState.returnTo);
    return c.redirect(returnTo, 302);
  });

  app.get("/me", requireSession, async (c) => {
    const user = c.get("user");
    const snapshot = await deps.store.getAuthSnapshot(user.id);
    const response: AuthMeResponse = AuthMeResponseSchema.parse({ user, ...snapshot });
    return c.json(response);
  });

  app.post("/logout", requireSession, async (c) => {
    const sealedSession = c.get("sealedSession");
    await deps.auth.revokeSession({ sealedSession });
    deleteCookie(c, SESSION_COOKIE_NAME, sessionCookieOptions);
    return c.json(LogoutResponseSchema.parse({ ok: true }));
  });

  return app;
}
