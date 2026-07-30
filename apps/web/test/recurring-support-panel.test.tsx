import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "@pledge.cash/sdk";
import { createRequire } from "node:module";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RecurringSupportPanel } from "../src/features/support";
import {
  saveRecurringSupportSubscription,
  type RecurringSupportPlan,
  type RecurringSupportSubscriptionView,
} from "../src/lib/recurring-support";
import type { X402RouterConfig } from "../src/lib/x402-router";

const boardroom =
  "0x1000000000000000000000000000000000000000" as Address;
const payer =
  "0x2000000000000000000000000000000000000000" as Address;
const usdc =
  "0x3000000000000000000000000000000000000000" as Address;
const gateway =
  "0x4000000000000000000000000000000000000000" as Address;
const activePlanId = "00000000-0000-4000-8000-000000000101";
const retiredPlanId = "00000000-0000-4000-8000-000000000102";
const activeSubscriptionId = "00000000-0000-4000-8000-000000000201";
const retiredSubscriptionId = "00000000-0000-4000-8000-000000000202";
const facetSetHash = `0x${"44".repeat(32)}` as Hex;

const config: X402RouterConfig = {
  application: "api.pledge.cash/x402-router/v1/execute",
  baseUrl: "https://router.example",
  gateway,
  hyperevmUsdc: usdc,
};

const { JSDOM } = createRequire(import.meta.url)(
  "../../../node_modules/.bun/node_modules/jsdom",
) as {
  JSDOM: new (
    html: string,
    options: { url: string },
  ) => {
    window: Window & typeof globalThis & { close(): void };
  };
};

describe("recurring support plan identity", () => {
  test("keeps a late plan response from replacing the selected retired schedule", async () => {
    const dom = new JSDOM(
      "<!doctype html><html><body><div id=\"root\"></div></body></html>",
      { url: "https://pledge.test" },
    );
    const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
    const setGlobal = (key: PropertyKey, value: unknown): void => {
      descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(
        globalThis,
        key,
        { configurable: true, value, writable: true },
      );
    };
    const activePlan = plan(activePlanId, "Active terms", "active");
    const retiredPlan = plan(retiredPlanId, "Retired terms", "retired");
    const activeView = subscriptionView(
      activePlan,
      activeSubscriptionId,
      "00000000-0000-4000-8000-000000000301",
    );
    const retiredView = subscriptionView(
      retiredPlan,
      retiredSubscriptionId,
      "00000000-0000-4000-8000-000000000302",
    );
    let resolveActive!: (response: Response) => void;
    let resolveRetired!: (response: Response) => void;
    const activeResponse = new Promise<Response>(resolve => {
      resolveActive = resolve;
    });
    const retiredResponse = new Promise<Response>(resolve => {
      resolveRetired = resolve;
    });

    setGlobal("window", dom.window);
    setGlobal("document", dom.window.document);
    setGlobal("navigator", dom.window.navigator);
    setGlobal("HTMLElement", dom.window.HTMLElement);
    setGlobal("Node", dom.window.Node);
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/support/plans") {
        expect(url.searchParams.get("payer")).toBe(payer);
        return Response.json({ plans: [activePlan, retiredPlan] });
      }
      if (url.pathname.endsWith(activeSubscriptionId)) return activeResponse;
      if (url.pathname.endsWith(retiredSubscriptionId)) return retiredResponse;
      throw new Error(`Unexpected recurring-support request ${url.pathname}`);
    });
    saveRecurringSupportSubscription(
      dom.window.localStorage,
      config,
      activeView,
    );
    saveRecurringSupportSubscription(
      dom.window.localStorage,
      config,
      retiredView,
    );

    const container = dom.window.document.getElementById("root") as HTMLElement;
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <RecurringSupportPanel
            account={payer}
            boardroom={boardroom}
            canPublish={false}
            checkout={{
              config,
              walletClient: () => {
                throw new Error("This read-only test must not request a signature.");
              },
            }}
            pendingAction={undefined}
            runAction={async (_label, action) => await action()}
          />,
        );
        await flush();
      });
      const retiredButton = Array.from(container.querySelectorAll("button"))
        .find(candidate => candidate.textContent?.includes("Retired terms"));
      if (!retiredButton) throw new Error("Retired plan control was not rendered");

      await act(async () => {
        retiredButton.click();
        await flush();
      });
      await act(async () => {
        resolveRetired(Response.json(retiredView));
        await flush();
      });
      expect(container.textContent).toContain(
        `Schedule ${retiredSubscriptionId}`,
      );
      expect(container.textContent).toContain(
        "These terms are retired, so no future invoice will be created.",
      );

      await act(async () => {
        resolveActive(Response.json(activeView));
        await flush();
      });
      expect(container.textContent).toContain(
        `Schedule ${retiredSubscriptionId}`,
      );
      expect(container.textContent).not.toContain(
        `Schedule ${activeSubscriptionId}`,
      );
    } finally {
      act(() => root.unmount());
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      dom.window.close();
    }
  });
});

function plan(
  id: string,
  title: string,
  status: RecurringSupportPlan["status"],
): RecurringSupportPlan {
  return {
    id,
    chainId: 998,
    boardroom,
    asset: usdc,
    amount: "10000000",
    cadence: "monthly",
    title,
    description: `${title} description.`,
    termsHash: `0x${(status === "active" ? "11" : "22").repeat(32)}` as Hex,
    status,
    authority: boardroom,
    authorityMode: "launched_controller",
    facetSetHash,
    createdAt: "2026-01-31T15:45:00.000Z",
    ...(status === "retired"
      ? { retiredAt: "2026-02-01T15:45:00.000Z" }
      : {}),
  };
}

function subscriptionView(
  supportPlan: RecurringSupportPlan,
  subscriptionId: string,
  invoiceId: string,
): RecurringSupportSubscriptionView {
  return {
    plan: supportPlan,
    subscription: {
      id: subscriptionId,
      planId: supportPlan.id,
      payer,
      status: "active",
      startedAt: "2026-01-31T15:45:00.000Z",
      createdAt: "2026-01-31T15:45:00.000Z",
    },
    invoice: {
      id: invoiceId,
      subscriptionId,
      planId: supportPlan.id,
      periodIndex: 0,
      periodStart: "2026-01-31T15:45:00.000Z",
      periodEnd: "2026-02-28T15:45:00.000Z",
      dueAt: "2026-01-31T15:45:00.000Z",
      payer,
      boardroom,
      asset: usdc,
      amount: supportPlan.amount,
      status: "paid",
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
