import type { AuthMeResponse } from "@pledge.cash/sentinel/dto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createSentinelClient, getSentinelBaseUrl, SentinelApiError, type SentinelClient } from "../../lib/sentinel";

export type SentinelSession = {
  authenticated: boolean;
  client: SentinelClient | undefined;
  error: string | undefined;
  loading: boolean;
  me: AuthMeResponse | undefined;
  refresh: () => Promise<void>;
};

export function useSentinelSession(): SentinelSession {
  const baseUrl = getSentinelBaseUrl();
  const client = useMemo(() => (baseUrl ? createSentinelClient({ baseUrl }) : undefined), [baseUrl]);
  const [me, setMe] = useState<AuthMeResponse>();
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(Boolean(client));

  const refresh = useCallback(async (): Promise<void> => {
    if (!client) {
      setMe(undefined);
      setAuthenticated(false);
      setError(undefined);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const next = await client.authMe();
      setMe(next);
      setAuthenticated(true);
      setError(undefined);
    } catch (error) {
      if (error instanceof SentinelApiError && error.status === 401) {
        setMe(undefined);
        setAuthenticated(false);
        setError(undefined);
      } else {
        setError(errorMessage(error));
      }
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { authenticated, client, error, loading, me, refresh };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function formatSentinelDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
