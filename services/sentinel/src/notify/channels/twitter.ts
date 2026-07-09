import { TwitterApi } from "twitter-api-v2";

import type { NotificationChannel, NotificationSendResult } from "../types";
import type { OutboxRow, RenderedMessage } from "../../types";

export type TwitterTweetOptions = {
  readonly reply?: {
    readonly in_reply_to_tweet_id: string;
  };
};

export type TwitterTweetResponse = {
  readonly data?: {
    readonly id?: string;
  };
  readonly id?: string;
};

export type TwitterClientLike = {
  readonly v2: {
    tweet(text: string, options?: TwitterTweetOptions): Promise<TwitterTweetResponse>;
  };
};

export type TwitterChannelConfig = {
  readonly accessToken?: string;
  readonly accessTokenSecret?: string;
  readonly apiKey?: string;
  readonly apiSecret?: string;
  readonly clientFactory?: () => TwitterClientLike;
  readonly enabled?: boolean;
};

type TwitterPayload = OutboxRow["payload"] & {
  readonly delivery?: {
    readonly replyToExternalId?: string;
  };
};

export function createTwitterChannel(config: TwitterChannelConfig): NotificationChannel {
  const client = config.clientFactory?.() ?? createTwitterClient(config);

  return {
    type: "twitter",
    async send(row: OutboxRow, rendered: RenderedMessage): Promise<NotificationSendResult> {
      const payload = row.payload as TwitterPayload;
      const text = rendered.text.length <= 280 ? rendered.text : `${rendered.text.slice(0, 277)}...`;
      const replyTo = payload.delivery?.replyToExternalId;
      const options =
        replyTo === undefined ? undefined : { reply: { in_reply_to_tweet_id: replyTo } };

      try {
        const response = await client.v2.tweet(text, options);
        const externalId = response.data?.id ?? response.id;
        return externalId === undefined
          ? { ok: true }
          : ({ externalId, ok: true } as NotificationSendResult & { readonly externalId: string });
      } catch (error) {
        return {
          error: errorMessage(error),
          ok: false,
          retryable: isRetryableTwitterError(error)
        };
      }
    }
  };
}

function createTwitterClient(config: TwitterChannelConfig): TwitterClientLike {
  if (config.enabled === false) {
    throw new Error("SENTINEL_TWITTER_ENABLED must be true to create the Twitter channel");
  }

  const { accessToken, accessTokenSecret, apiKey, apiSecret } = config;
  if (
    apiKey === undefined ||
    apiSecret === undefined ||
    accessToken === undefined ||
    accessTokenSecret === undefined
  ) {
    throw new Error("Twitter API key, API secret, access token, and access token secret are required");
  }

  return new TwitterApi({
    accessSecret: accessTokenSecret,
    accessToken,
    appKey: apiKey,
    appSecret: apiSecret
  }) as unknown as TwitterClientLike;
}

function isRetryableTwitterError(error: unknown): boolean {
  const status = statusCode(error);
  if (status === undefined) {
    return true;
  }

  return status === 429 || status >= 500;
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const record = error as Readonly<Record<string, unknown>>;
  for (const key of ["code", "status", "statusCode"]) {
    const value = record[key];
    if (typeof value === "number") {
      return value;
    }
  }

  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
