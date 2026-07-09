import type { ChannelType, OutboxRow, RenderedMessage } from "../types";

export type NotificationSendResult =
  | { readonly ok: true }
  | { readonly error: string; readonly ok: false; readonly retryable: boolean };

export type NotificationRateLimit = {
  readonly intervalMs: number;
  readonly key: string;
};

export interface NotificationChannel {
  readonly type: ChannelType;
  rateLimits?(row: OutboxRow): readonly NotificationRateLimit[];
  send(row: OutboxRow, rendered: RenderedMessage): Promise<NotificationSendResult>;
}
