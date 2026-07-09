import type { ChannelType, OutboxRow, RenderedMessage } from "../types";

export type NotificationSendResult =
  | { readonly ok: true }
  | { readonly error: string; readonly ok: false; readonly retryable: boolean };

export interface NotificationChannel {
  readonly type: ChannelType;
  send(row: OutboxRow, rendered: RenderedMessage): Promise<NotificationSendResult>;
}
