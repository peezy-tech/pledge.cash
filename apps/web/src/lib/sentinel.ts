import type {
  AuthMeResponse,
  BoardroomActionsQuery,
  ChannelsResponse,
  DeleteChannelResponse,
  DeleteWalletResponse,
  LinkWalletRequest,
  LinkWalletResponse,
  LogoutResponse,
  PublicActionsQuery,
  PublicActionsResponse,
  PutSubscriptionRequest,
  SubscriptionResponse,
  TelegramLinkCodeResponse,
  WalletNonceRequest,
  WalletNonceResponse,
} from "@pledge.cash/sentinel/dto";

export type SentinelEnv = {
  readonly VITE_SENTINEL_API_URL?: string | undefined;
};

export type SentinelFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type SentinelPublicActionsQuery = Partial<PublicActionsQuery>;
export type SentinelBoardroomActionsQuery = Partial<BoardroomActionsQuery>;

export type SentinelClient = ReturnType<typeof createSentinelClient>;

type SentinelClientOptions = {
  baseUrl?: string | undefined;
  fetcher?: SentinelFetch | undefined;
};

type JsonRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal | undefined;
};

type QueryValue = string | number | boolean | null | undefined;

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

export function sentinelLoginUrl(returnTo: string, baseUrl = getRequiredSentinelBaseUrl()): string {
  const url = sentinelUrl(baseUrl, "/auth/login");
  url.searchParams.set("return_to", returnTo);
  return url.toString();
}

export function redirectToSentinelLogin(returnTo = browserReturnUrl(), baseUrl = getRequiredSentinelBaseUrl()): void {
  if (typeof window === "undefined") {
    throw new Error("Sentinel login requires a browser window.");
  }
  window.location.assign(sentinelLoginUrl(returnTo, baseUrl));
}

export function createSentinelClient(options: SentinelClientOptions = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? getRequiredSentinelBaseUrl());
  const fetcher = options.fetcher ?? fetch;

  return {
    authMe: (signal?: AbortSignal) => sentinelJson<AuthMeResponse>(baseUrl, fetcher, "/auth/me", { signal }),
    createTelegramLinkCode: () =>
      sentinelJson<TelegramLinkCodeResponse>(baseUrl, fetcher, "/channels/telegram/link-code", { method: "POST" }),
    createWalletNonce: (body: WalletNonceRequest) =>
      sentinelJson<WalletNonceResponse>(baseUrl, fetcher, "/wallets/nonce", { method: "POST", body }),
    deleteChannel: (id: string) =>
      sentinelJson<DeleteChannelResponse>(baseUrl, fetcher, `/channels/${encodeURIComponent(id)}`, { method: "DELETE" }),
    deleteWallet: (address: string) =>
      sentinelJson<DeleteWalletResponse>(baseUrl, fetcher, `/wallets/${encodeURIComponent(address)}`, { method: "DELETE" }),
    linkWallet: (body: LinkWalletRequest) =>
      sentinelJson<LinkWalletResponse>(baseUrl, fetcher, "/wallets", { method: "POST", body }),
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
        { query: queryParams(query), signal },
      ),
    listChannels: () => sentinelJson<ChannelsResponse>(baseUrl, fetcher, "/channels"),
    listPublicActions: (query?: SentinelPublicActionsQuery | undefined, signal?: AbortSignal | undefined) =>
      sentinelJson<PublicActionsResponse>(baseUrl, fetcher, "/public/actions", { query: queryParams(query), signal }),
    logout: () => sentinelJson<LogoutResponse>(baseUrl, fetcher, "/auth/logout", { method: "POST" }),
    putSubscription: (body: PutSubscriptionRequest) =>
      sentinelJson<SubscriptionResponse>(baseUrl, fetcher, "/subscriptions", { method: "PUT", body }),
  };
}

async function sentinelJson<T>(
  baseUrl: string,
  fetcher: SentinelFetch,
  path: string,
  options: JsonRequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = {
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

function getRequiredSentinelBaseUrl(): string {
  const baseUrl = getSentinelBaseUrl();
  if (!baseUrl) throw new Error("Sentinel API URL is not configured.");
  return baseUrl;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function browserReturnUrl(): string {
  if (typeof window === "undefined") return "/";
  return window.location.href;
}

function sentinelErrorMessage(status: number, body: string): string {
  if (status === 401) return "Sign in to manage Sentinel settings.";
  if (!body) return `Sentinel request failed with status ${status.toString()}.`;

  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const message = typeof parsed.message === "string" ? parsed.message : parsed.error;
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    return body;
  }

  return body;
}
