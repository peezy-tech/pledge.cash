import type {
  AuthCapabilitiesResponse,
  AuthMeResponse,
  AuthRedirectRequest,
  AuthRedirectResponse,
  AuthSiweNonceRequest,
  AuthSiweNonceResponse,
  AuthSiweVerifyRequest,
  BoardroomActionsQuery,
  ChannelsResponse,
  DeleteChannelResponse,
  HealthResponse,
  LinkWalletRequest,
  LinkWalletResponse,
  NotificationDeliveriesQuery,
  NotificationDeliveriesResponse,
  PublicActionsQuery,
  PublicActionsResponse,
  PutSubscriptionRequest,
  SocialProviderDto,
  SubscriptionResponse,
  TelegramLinkCodeResponse,
  UpdateWalletAlertsRequest,
  UpdateWalletAlertsResponse,
  WalletNonceRequest,
  WalletNonceResponse,
} from "@pledge.cash/sentinel/dto";

export type SentinelEnv = {
  readonly VITE_SENTINEL_API_URL?: string | undefined;
};

export type SentinelFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type SentinelSocialProvider = SocialProviderDto;

export type AuthSiweVerifyResponse = {
  success: boolean;
};

export type AuthSignOutResponse = {
  success: boolean;
};

export type SocialAuthRequest = AuthRedirectRequest & {
  errorCallbackURL?: string | undefined;
};

export type SentinelPublicActionsQuery = Partial<PublicActionsQuery>;
export type SentinelBoardroomActionsQuery = Partial<BoardroomActionsQuery>;
export type SentinelNotificationDeliveriesQuery = Partial<NotificationDeliveriesQuery>;

export type SentinelClient = ReturnType<typeof createSentinelClient>;

type SentinelClientOptions = {
  baseUrl?: string | undefined;
  fetcher?: SentinelFetch | undefined;
};

type JsonRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  cache?: RequestCache | undefined;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal | undefined;
};

type QueryValue = string | number | boolean | null | undefined;
type GenericOAuthRedirectRequest = Omit<AuthRedirectRequest, "provider"> & {
  providerId: "telegram";
};

export class SentinelApiError extends Error {
  readonly body: string | undefined;
  readonly status: number;

  constructor(status: number, message: string, body?: string | undefined) {
    super(message);
    this.name = "SentinelApiError";
    this.status = status;
    this.body = body;
  }
}

export function getSentinelBaseUrl(env: SentinelEnv = import.meta.env): string | undefined {
  const raw = env.VITE_SENTINEL_API_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "");
}

export function hasSentinelApi(env: SentinelEnv = import.meta.env): boolean {
  return getSentinelBaseUrl(env) !== undefined;
}

export function createSentinelClient(options: SentinelClientOptions = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? getRequiredSentinelBaseUrl());
  const fetcher = options.fetcher ?? fetch;

  return {
    health: (signal?: AbortSignal) =>
      sentinelJson<HealthResponse>(baseUrl, fetcher, "/health", { cache: "no-store", signal }),
    authCapabilities: (signal?: AbortSignal) =>
      sentinelJson<AuthCapabilitiesResponse>(baseUrl, fetcher, "/auth/capabilities", { signal }),
    authMe: (signal?: AbortSignal) => sentinelJson<AuthMeResponse | null>(baseUrl, fetcher, "/auth/me", { signal }),
    createAuthSiweNonce: (body: AuthSiweNonceRequest) =>
      sentinelJsonWithNotFoundFallback<AuthSiweNonceResponse>(
        () => sentinelJson(baseUrl, fetcher, "/auth/peezy/siwe/nonce", { method: "POST", body }),
        () => sentinelJson(baseUrl, fetcher, "/auth/siwe/nonce", { method: "POST", body }),
      ),
    createTelegramLinkCode: () =>
      sentinelJson<TelegramLinkCodeResponse>(baseUrl, fetcher, "/channels/telegram/link-code", { method: "POST" }),
    createWalletNonce: (body: WalletNonceRequest) =>
      sentinelJson<WalletNonceResponse>(baseUrl, fetcher, "/wallets/nonce", { method: "POST", body }),
    deleteChannel: (id: string) =>
      sentinelJson<DeleteChannelResponse>(baseUrl, fetcher, `/channels/${encodeURIComponent(id)}`, { method: "DELETE" }),
    linkWallet: (body: LinkWalletRequest) =>
      sentinelJson<LinkWalletResponse>(baseUrl, fetcher, "/wallets", { method: "POST", body }),
    setWalletAlerts: (address: string, body: UpdateWalletAlertsRequest) =>
      sentinelJson<UpdateWalletAlertsResponse>(baseUrl, fetcher, `/wallets/${encodeURIComponent(address)}`, {
        method: "PATCH",
        body,
      }),
    listBoardroomActions: ({
      address,
      chainId,
      query,
      signal,
    }: {
      address: string;
      chainId: number;
      query?: SentinelBoardroomActionsQuery | undefined;
      signal?: AbortSignal | undefined;
    }) =>
      sentinelJson<PublicActionsResponse>(
        baseUrl,
        fetcher,
        `/public/chains/${chainId.toString()}/boardrooms/${encodeURIComponent(address)}/actions`,
        { cache: "no-store", query: queryParams(query), signal },
      ),
    listChannels: () => sentinelJson<ChannelsResponse>(baseUrl, fetcher, "/channels"),
    listNotificationDeliveries: (
      query?: SentinelNotificationDeliveriesQuery | undefined,
      signal?: AbortSignal | undefined,
    ) =>
      sentinelJson<NotificationDeliveriesResponse>(baseUrl, fetcher, "/notifications", {
        cache: "no-store",
        query: notificationDeliveryQueryParams(query),
        signal,
      }),
    listPublicActions: (query?: SentinelPublicActionsQuery | undefined, signal?: AbortSignal | undefined) =>
      sentinelJson<PublicActionsResponse>(baseUrl, fetcher, "/public/actions", { query: queryParams(query), signal }),
    linkSocial: (body: SocialAuthRequest) =>
      sentinelJsonWithNotFoundFallback<AuthRedirectResponse>(
        () => sentinelJson(baseUrl, fetcher, "/auth/peezy/link", { method: "POST", body }),
        () =>
          sentinelJson(
            baseUrl,
            fetcher,
            body.provider === "telegram" ? "/auth/oauth2/link" : "/auth/link-social",
            { method: "POST", body: socialAuthBody(body) },
          ),
      ),
    logout: () => sentinelJson<AuthSignOutResponse>(baseUrl, fetcher, "/auth/sign-out", { method: "POST" }),
    putSubscription: (body: PutSubscriptionRequest) =>
      sentinelJson<SubscriptionResponse>(baseUrl, fetcher, "/subscriptions", { method: "PUT", body }),
    signInSocial: (body: SocialAuthRequest) =>
      sentinelJsonWithNotFoundFallback<AuthRedirectResponse>(
        () => sentinelJson(baseUrl, fetcher, "/auth/peezy/sign-in", { method: "POST", body }),
        () =>
          sentinelJson(
            baseUrl,
            fetcher,
            body.provider === "telegram" ? "/auth/sign-in/oauth2" : "/auth/sign-in/social",
            { method: "POST", body: socialAuthBody(body) },
          ),
      ),
    verifyAuthSiwe: (body: AuthSiweVerifyRequest) =>
      sentinelJsonWithNotFoundFallback<AuthSiweVerifyResponse>(
        () => sentinelJson(baseUrl, fetcher, "/auth/peezy/siwe/verify", { method: "POST", body }),
        () => sentinelJson(baseUrl, fetcher, "/auth/siwe/verify", { method: "POST", body }),
      ),
  };
}

function socialAuthBody(
  body: SocialAuthRequest,
): AuthRedirectRequest | GenericOAuthRedirectRequest {
  if (body.provider !== "telegram") return body;
  return {
    callbackURL: body.callbackURL,
    ...(body.errorCallbackURL === undefined ? {} : { errorCallbackURL: body.errorCallbackURL }),
    providerId: "telegram",
  };
}

async function sentinelJsonWithNotFoundFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    if (!(error instanceof SentinelApiError) || error.status !== 404) throw error;
    return fallback();
  }
}

async function sentinelJson<T>(
  baseUrl: string,
  fetcher: SentinelFetch,
  path: string,
  options: JsonRequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = {
    ...(options.cache === undefined ? {} : { cache: options.cache }),
    credentials: "include",
    headers,
    method: options.method ?? "GET",
  };

  if (options.signal) init.signal = options.signal;

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetcher(sentinelUrl(baseUrl, path, options.query), init);
  const text = await response.text();

  if (!response.ok) {
    throw new SentinelApiError(response.status, sentinelErrorMessage(response.status, text), text || undefined);
  }

  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

function sentinelUrl(baseUrl: string, path: string, query?: Record<string, QueryValue> | undefined): URL {
  const normalizedPath = path.replace(/^\/+/, "");
  const url = new URL(normalizedPath, `${normalizeBaseUrl(baseUrl)}/`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  return url;
}

function queryParams(query: SentinelPublicActionsQuery | SentinelBoardroomActionsQuery | undefined): Record<string, QueryValue> {
  if (!query) return {};

  return {
    cursor: query.cursor,
    limit: query.limit,
    minSeverity: query.minSeverity,
    status: query.status,
    ...("boardroom" in query ? { boardroom: query.boardroom } : {}),
    ...("chainId" in query ? { chainId: query.chainId } : {}),
  };
}

function notificationDeliveryQueryParams(
  query: SentinelNotificationDeliveriesQuery | undefined,
): Record<string, QueryValue> {
  return {
    cursor: query?.cursor,
    limit: query?.limit,
  };
}

function getRequiredSentinelBaseUrl(): string {
  const baseUrl = getSentinelBaseUrl();
  if (!baseUrl) throw new Error("Sentinel API URL is not configured.");
  return baseUrl;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function sentinelErrorMessage(status: number, body: string): string {
  if (status === 401) return "Sign with your wallet to manage alerts.";
  if (!body) return `Sentinel request failed with status ${status.toString()}.`;

  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const message = typeof parsed.message === "string" ? parsed.message : errorMessageValue(parsed.error);
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    return body;
  }

  return body;
}

function errorMessageValue(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (typeof error !== "object" || error === null) return undefined;

  const message = (error as { readonly message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}
