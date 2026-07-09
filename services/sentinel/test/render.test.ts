import { describe, expect, test } from "bun:test";

import { buildLinks, renderNotification, type RenderableOutboxRow } from "../src/notify/render";

describe("notification rendering", () => {
  test("renders Telegram HTML with veto instructions and explorer links", () => {
    const rendered = renderNotification(makeRow("telegram"), {
      chainNames: { 998: "HyperEVM testnet" },
      explorerUrls: { 998: "https://explorer.example" },
      now: new Date("2026-07-09T12:00:00.000Z"),
      webOrigin: "https://sentinel.example"
    });

    expect(rendered.html).toContain("HIGH Queued governance action");
    expect(rendered.html).toContain("veto window ends in 12h");
    expect(rendered.html).toContain("cancelAction(0x0000000000000000000000000000000000000000000000000000000000000abc)");
    expect(rendered.html).toContain("https://explorer.example/tx/0x0000000000000000000000000000000000000000000000000000000000000def");
    expect(rendered.text).toContain("setExecutor");
    expect(rendered.url).toBe(
      "https://sentinel.example/boardrooms/998/0x0000000000000000000000000000000000000b0a?action=0x0000000000000000000000000000000000000000000000000000000000000abc"
    );
  });

  test("renders Twitter alerts within 280 characters", () => {
    const rendered = renderNotification(makeRow("twitter"), {
      chainNames: { 998: "HyperEVM testnet" },
      now: new Date("2026-07-09T12:00:00.000Z"),
      webOrigin: "https://sentinel.example"
    });

    expect(rendered.text.length).toBeLessThanOrEqual(280);
    expect(rendered.text).toContain("HIGH-RISK action queued");
    expect(rendered.text).toContain("Shareholders can veto");
    expect(rendered.text).toContain("https://sentinel.example/boardrooms/998");
    expect(rendered.html).toBeUndefined();
  });

  test("renders policy-admin updates with the admin label", () => {
    const rendered = renderNotification(makeRow("telegram", "policy-admin"), {
      chainNames: { 998: "HyperEVM testnet" },
      now: new Date("2026-07-09T12:00:00.000Z"),
      webOrigin: "https://sentinel.example"
    });

    expect(rendered.html).toContain("Policy Admin Updated governance action");
    expect(rendered.subject).toContain("Policy Admin Updated action");
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
        "https://sentinel.example/boardrooms/998/0x0000000000000000000000000000000000000b0a?action=0x0000000000000000000000000000000000000000000000000000000000000abc"
    });
  });
});

function makeRow(
  channelType: "telegram" | "twitter",
  event: RenderableOutboxRow["event"] = "queued"
): RenderableOutboxRow {
  const now = new Date("2026-07-09T00:00:00.000Z");
  return {
    actionId: "00000000-0000-4000-8000-000000000001",
    attempts: 0,
    channelId: channelType === "telegram" ? "00000000-0000-4000-8000-000000000002" : null,
    channelType,
    createdAt: now,
    dedupeKey: `998:0xabc:queued:${channelType}:public`,
    event,
    externalId: null,
    id: "00000000-0000-4000-8000-000000000003",
    lastError: null,
    nextAttemptAt: now,
    payload: {
      action: {
        actionHash: "0x0000000000000000000000000000000000000000000000000000000000000abc",
        boardroom: "0x0000000000000000000000000000000000000b0a",
        chainId: 998,
        eta: "2026-07-10T00:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000001",
        queueTxHash: "0x0000000000000000000000000000000000000000000000000000000000000def",
        status: "queued"
      },
      analysis: {
        affectedParties: ["shareholders"],
        effects: ["Changes the boardroom executor"],
        severityRationale: "Executor changes can redirect governance execution.",
        source: "template",
        summary:
          "setExecutor changes execution authority for the Boardroom. This long summary intentionally exercises the public post truncation path while keeping the important veto link available."
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
          decodedArgs: { executor: "0x0000000000000000000000000000000000000e0e" },
          decodedFunction: "setExecutor",
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
            detail: "Executor update",
            ruleId: "boardroom.executor-change",
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
