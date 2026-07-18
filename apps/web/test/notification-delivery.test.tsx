import { describe, expect, test } from "bun:test";
import type { NotificationDeliveryDto } from "@pledge.cash/sentinel/dto";
import { renderToString } from "react-dom/server";
import { notificationFocusFromSearch } from "../src/app/views/sentinel-settings";
import {
  DeliveryActivityRows,
  notificationDeliveryHref,
} from "../src/features/notifications/delivery-activity";

const boardroom = "0x1111111111111111111111111111111111111111" as const;
const actionHash = `0x${"ab".repeat(32)}` as const;

describe("recent alert deliveries", () => {
  test("renders clear operational states without exposing provider errors", () => {
    const deliveries: NotificationDeliveryDto[] = [
      delivery("00000000-0000-4000-8000-000000000001", "sent"),
      delivery("00000000-0000-4000-8000-000000000002", "pending"),
      delivery("00000000-0000-4000-8000-000000000003", "failed"),
      delivery("00000000-0000-4000-8000-000000000004", "dead"),
    ];

    const html = renderToString(<DeliveryActivityRows deliveries={deliveries} />);

    expect(html).toContain("Delivered");
    expect(html).toContain("Queued");
    expect(html).toContain("Retry scheduled");
    expect(html).toContain("Delivery stopped");
    expect(html).toContain("Review or replace the delivery channel.");
    expect(html).toContain("Executor authority changes.");
    expect(html).toMatch(/2(?:<!-- -->)? delivery (?:<!-- -->)?attempts/);
    expect(html).not.toContain("testnet.purrsec.com/address");
    expect(html).not.toContain("lastError");
    expect(html).not.toContain("bot token");
  });

  test("links each receipt back to the exact chain, boardroom, and action", () => {
    const href = notificationDeliveryHref(
      delivery("00000000-0000-4000-8000-000000000001", "sent"),
      "/pledge-cash/",
    );
    expect(href).toBe(
      `/pledge-cash/settings/alerts?action=${actionHash}&boardroom=${boardroom}&chain=31337`,
    );
    expect(notificationFocusFromSearch(new URL(href, "https://pledge.cash").search)).toEqual({
      actionHash,
      boardroom,
      chainId: 31337,
    });
  });
});

function delivery(id: string, status: NotificationDeliveryDto["status"]): NotificationDeliveryDto {
  return {
    action: {
      actionHash,
      boardroom,
      chainId: 31337,
      eta: "2026-07-13T12:00:00.000Z",
      expiresAt: "2026-07-20T12:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000010",
      status: "queued",
    },
    attempts: status === "pending" ? 0 : 2,
    channelType: "telegram",
    createdAt: "2026-07-12T12:00:00.000Z",
    event: "queued",
    id,
    nextAttemptAt: "2026-07-12T12:05:00.000Z",
    sentAt: status === "sent" ? "2026-07-12T12:01:00.000Z" : null,
    severity: "high",
    status,
    summary: "Executor authority changes.",
    updatedAt: "2026-07-12T12:01:00.000Z",
  };
}
