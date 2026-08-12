import type {
  AuthCapabilitiesResponse,
  AuthMeResponse,
  AuthRedirectRequest,
  AuthRedirectResponse,
  AuthSiweNonceRequest,
  AuthSiweNonceResponse,
  AuthSiweVerifyRequest,
  HealthResponse,
  LinkWalletRequest,
  LinkWalletResponse,
  SocialProviderDto,
  WalletNonceRequest,
  WalletNonceResponse,
} from "@pledge.cash/sentinel/dto";

export type SentinelEnv = { readonly VITE_SENTINEL_API_URL?: string | undefined };
export type SentinelFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type SentinelSocialProvider = SocialProviderDto;
export type SentinelAuthCapabilities = AuthCapabilitiesResponse;
export type AuthSiweVerifyResponse = { success: boolean };
export type AuthSignOutResponse = { success: boolean };
export type SocialAuthRequest = AuthRedirectRequest & { errorCallbackURL?: string | undefined };
export type SentinelClient = ReturnType<typeof createSentinelClient>;

type SentinelClientOptions = {
  baseUrl?: string | undefined;
  fetcher?: SentinelFetch | undefined;
};

type JsonRequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  cache?: RequestCache | undefined;
  signal?: AbortSignal | undefined;
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
  return raw ? raw.replace(/\/+$/, "") : undefined;
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
      sentinelJson<AuthSiweNonceResponse>(baseUrl, fetcher, "/auth/peezy/siwe/nonce", { method: "POST", body }),
    createWalletNonce: (body: WalletNonceRequest) =>
      sentinelJson<WalletNonceResponse>(baseUrl, fetcher, "/wallets/nonce", { method: "POST", body }),
    linkWallet: (body: LinkWalletRequest) =>
      sentinelJson<LinkWalletResponse>(baseUrl, fetcher, "/wallets", { method: "POST", body }),
    linkSocial: (body: SocialAuthRequest) =>
      sentinelJson<AuthRedirectResponse>(baseUrl, fetcher, "/auth/peezy/link", { method: "POST", body }),
    logout: () => sentinelJson<AuthSignOutResponse>(baseUrl, fetcher, "/auth/sign-out", { method: "POST" }),
    signInSocial: (body: SocialAuthRequest) =>
      sentinelJson<AuthRedirectResponse>(baseUrl, fetcher, "/auth/peezy/sign-in", { method: "POST", body }),
    verifyAuthSiwe: (body: AuthSiweVerifyRequest) =>
      sentinelJson<AuthSiweVerifyResponse>(baseUrl, fetcher, "/auth/peezy/siwe/verify", { method: "POST", body }),
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

  const response = await fetcher(new URL(path.replace(/^\/+/, ""), `${baseUrl}/`), init);
  const body = await response.text();
  if (!response.ok) throw new SentinelApiError(response.status, sentinelErrorMessage(response.status, body), body || undefined);
  return body ? JSON.parse(body) as T : {} as T;
}

function getRequiredSentinelBaseUrl(): string {
  const baseUrl = getSentinelBaseUrl();
  if (!baseUrl) throw new Error("Identity API URL is not configured.");
  return baseUrl;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function sentinelErrorMessage(status: number, body: string): string {
  if (status === 401) return "Sign with your wallet to manage this identity.";
  if (!body) return `Identity request failed with status ${status.toString()}.`;
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const message = typeof parsed.message === "string" ? parsed.message : errorMessageValue(parsed.error);
    return typeof message === "string" && message.trim() ? message : body;
  } catch {
    return body;
  }
}

function errorMessageValue(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return undefined;
  const message = (error as { readonly message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}
