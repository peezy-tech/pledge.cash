import { describe, expect, test } from "bun:test";

import { buildLinks, renderNotification, type RenderableOutboxRow } from "../src/notify/render";

describe("notification rendering", () => {
  test("renders Telegram HTML with veto instructions and explorer links", () => {
    const rendered = renderNotification(makeRow("telegram"), {
      chainNames: { 998: "Test chain" },
      explorerUrls: { 998: "https://explorer.example" },
      now: new Date("2026-07-09T12:00:00.000Z"),
      webOrigin: "https://sentinel.example"
    });

    expect(rendered.html).toContain("HIGH Scheduled governance operation");
    expect(rendered.html).toContain("execution opens in 12h");
    expect(rendered.html).toContain("Execution deadline");
    expect(rendered.html).toContain("required 1% current and prior-block active-stake power");
    expect(rendered.html).toContain("veto(0x0000000000000000000000000000000000000000000000000000000000000abc)");
    expect(rendered.html).toContain("https://explorer.example/tx/0x0000000000000000000000000000000000000000000000000000000000000def");
    expect(rendered.text).toContain("updateConfiguration");
    expect(rendered.url).toBe(
      "https://sentinel.example/notifications?chain=998&boardroom=0x0000000000000000000000000000000000000b0a&operation=0x0000000000000000000000000000000000000000000000000000000000000abc"
    );
  });

  test("renders Twitter alerts within 280 characters", () => {
    const rendered = renderNotification(makeRow("twitter"), {
      chainNames: { 998: "Test chain" },
      now: new Date("2026-07-09T12:00:00.000Z"),
      webOrigin: "https://sentinel.example"
    });

    expect(rendered.text.length).toBeLessThanOrEqual(280);
    expect(rendered.text).toContain("HIGH-RISK operation scheduled");
    expect(rendered.text).toContain("Eligible 1% holders may cancel");
    expect(rendered.text).toContain("https://sentinel.example/notifications?chain=998");
    expect(rendered.html).toBeUndefined();
  });

  test("renders policy-admin updates with the admin label", () => {
    const rendered = renderNotification(makeRow("telegram", "policy-admin"), {
      chainNames: { 998: "Test chain" },
      now: new Date("2026-07-09T12:00:00.000Z"),
      webOrigin: "https://sentinel.example"
    });

    expect(rendered.html).toContain("Policy Admin Updated governance operation");
    expect(rendered.subject).toContain("Policy Admin Updated operation");
  });

  test("renders reminders as execution-opening prompts with exact cancellation eligibility", () => {
    const rendered = renderNotification(makeRow("telegram", "reminder"), {
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(rendered.subject).toContain("Reminder");
    expect(rendered.text).toContain("execution opens in 12h");
    expect(rendered.text).toContain("required 1% current and prior-block active-stake power");
    expect(rendered.text).toContain("veto");
  });

  test("renders epoch invalidation as terminal without cancellation instructions", () => {
    const rendered = renderNotification(makeRow("telegram", "invalidated"), {
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(rendered.subject).toContain("Invalidated");
    expect(rendered.text).toContain("no longer executable");
    expect(rendered.text).not.toContain("call veto");
  });

  test("renders a delayed scheduled notification as expired instead of actionable", () => {
    const row = makeRow("telegram");
    const rendered = renderNotification(
      {
        ...row,
        payload: {
          ...row.payload,
          action: { ...row.payload.action, expiresAt: "2026-07-08T00:00:00.000Z" }
        }
      },
      { now: new Date("2026-07-09T12:00:00.000Z") }
    );

    expect(rendered.text).toContain("execution window has expired");
    expect(rendered.text).toContain("This operation is expired and is no longer executable");
    expect(rendered.text).not.toContain("call veto");
  });

  test("renders a delayed scheduled Twitter notification as expired instead of actionable", () => {
    const row = makeRow("twitter");
    const rendered = renderNotification(
      {
        ...row,
        payload: {
          ...row.payload,
          action: { ...row.payload.action, expiresAt: "2026-07-08T00:00:00.000Z" }
        }
      },
      { now: new Date("2026-07-09T12:00:00.000Z") }
    );

    expect(rendered.text).toContain("expired and is no longer executable");
    expect(rendered.text).not.toContain("may cancel");
  });

  test("builds stable web and explorer links from render options", () => {
    const links = buildLinks(makeRow("telegram").payload, {
      explorerUrls: { 998: "https://explorer.example/" },
      webOrigin: "https://sentinel.example/"
    });

    expect(links).toEqual({
      explorerTx:
        "https://explorer.example/tx/0x0000000000000000000000000000000000000000000000000000000000000def",
      webAction:
        "https://sentinel.example/notifications?chain=998&boardroom=0x0000000000000000000000000000000000000b0a&operation=0x0000000000000000000000000000000000000000000000000000000000000abc"
    });
  });
});

function makeRow(
  channelType: "telegram" | "twitter",
  event: RenderableOutboxRow["event"] = "scheduled"
): RenderableOutboxRow {
  const now = new Date("2026-07-09T00:00:00.000Z");
  return {
    actionId: "00000000-0000-4000-8000-000000000001",
    attempts: 0,
    channelType,
    createdAt: now,
    dedupeKey: `998:0xabc:scheduled:${channelType}:public`,
    event,
    externalId: null,
    id: "00000000-0000-4000-8000-000000000003",
    lastError: null,
    nextAttemptAt: now,
    payload: {
      action: {
        operationId: "0x0000000000000000000000000000000000000000000000000000000000000abc",
        boardroom: "0x0000000000000000000000000000000000000b0a",
        chainId: 998,
        boardroomEpoch: "2",
        configurationEpoch: "1",
        controller: "0x000000000000000000000000000000000000c011",
        controllerGeneration: "1",
        eta: "2026-07-10T00:00:00.000Z",
        expiresAt: "2026-07-17T00:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000001",
        operationKind: "controller",
        proposer: "0x0000000000000000000000000000000000000a11",
        scheduleTxHash: "0x0000000000000000000000000000000000000000000000000000000000000def",
        status: "scheduled"
      },
      analysis: {
        affectedParties: ["shareholders"],
        effects: ["Changes the boardroom controller"],
        severityRationale: "controller changes can redirect governance execution.",
        source: "template",
        summary:
          "updateConfiguration changes controller configuration for the Boardroom; ready execution remains permissionless. This long summary intentionally exercises the public post truncation path while keeping the important veto link available."
      },
      boardroom: {
        address: "0x0000000000000000000000000000000000000b0a",
        chainId: 998,
        name: "Example Boardroom"
      },
      calls: [
        {
          actionId: "00000000-0000-4000-8000-000000000001",
          callIndex: 0,
          data: "0x12345678",
          decodedArgs: { controller: "0x0000000000000000000000000000000000000e0e" },
          decodedFunction: "updateConfiguration",
          policy: "0x0000000000000000000000000000000000000f00",
          selector: "0x12345678",
          target: "0x0000000000000000000000000000000000000b0a",
          value: "0"
        }
      ],
      risk: {
        findings: [
          {
            callIndex: 0,
            detail: "controller update",
            ruleId: "boardroom.controller-change",
            severity: "high"
          }
        ],
        severity: "high"
      }
    },
    sentAt: null,
    status: "pending",
    updatedAt: now,
    userId: channelType === "telegram" ? "00000000-0000-4000-8000-000000000004" : null
  };
}
