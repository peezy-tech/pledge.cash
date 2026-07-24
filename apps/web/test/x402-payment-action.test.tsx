import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { createRequire } from "node:module";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  HyperliquidPaymentAction,
  HyperliquidRecoveryCenter,
} from "../src/features/x402";
import {
  HYPERCORE_TESTNET,
  HYPERCORE_TESTNET_USDC,
  saveHyperliquidPendingPayment,
  type HyperliquidMarketplaceOrder,
  type HyperliquidMarketplaceQuote,
  type X402RouterConfig,
} from "../src/lib/x402-router";

const payer = "0x1000000000000000000000000000000000000000" as Address;
const gateway = "0x2000000000000000000000000000000000000000" as Address;
const destinationUsdc =
  "0x3000000000000000000000000000000000000000" as Address;
const shareToken =
  "0x4000000000000000000000000000000000000000" as Address;
const sale = "0x5000000000000000000000000000000000000000" as Address;
const payTo = "0x6000000000000000000000000000000000000000" as Address;
const callDataHash = `0x${"11".repeat(32)}` as const;
const deadline = 4_102_444_800;
const config: X402RouterConfig = {
  application: "api.pledge.cash/x402-router/v1/execute",
  baseUrl: "https://x402.example",
  gateway,
  hyperevmUsdc: destinationUsdc,
};
const quote: HyperliquidMarketplaceQuote = {
  execution: {
    callDataHash,
    chainId: 998,
    deadline,
    expectedOutput: "1000000000000000000",
    inputAmount: "3000000",
    inputToken: destinationUsdc,
    minimumOutput: "1000000000000000000",
    outputToken: shareToken,
    recipient: payer,
    selector: "0x12345678",
    target: sale,
  },
  expiresAt: new Date(deadline * 1_000).toISOString(),
  kind: "fixed_price_sale",
  orderId: "quote-1234567890abcdef",
  payer,
  payment: {
    amount: "303000000",
    asset: HYPERCORE_TESTNET_USDC,
    decimals: 8,
    network: HYPERCORE_TESTNET,
    payTo,
    principal: "300000000",
    serviceFee: "3000000",
    symbol: "USDC",
  },
  paymentId: "payment-1234567890abcdef",
  quoteId: "quote-1234567890abcdef",
  recipient: payer,
  refundAddress: payer,
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

describe("Hyperliquid payment recovery surface", () => {
  test("restores and immediately polls a created payment across form changes and remounts", async () => {
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
    let statusReads = 0;
    setGlobal("window", dom.window);
    setGlobal("document", dom.window.document);
    setGlobal("navigator", dom.window.navigator);
    setGlobal("HTMLElement", dom.window.HTMLElement);
    setGlobal("Node", dom.window.Node);
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setGlobal("fetch", async () => {
      statusReads += 1;
      return Response.json({ order: recoveryOrder() });
    });

    saveHyperliquidPendingPayment(
      dom.window.localStorage,
      config,
      payer,
      "fixed_price_sale",
      quote,
      { decimals: 18, symbol: "PLEDGE" },
    );

    const container = dom.window.document.getElementById("root") as HTMLElement;
    const renderAction = (requestPresent: boolean): React.JSX.Element => (
      <HyperliquidPaymentAction
        checkout={{
          config,
          walletClient: () => {
            throw new Error("A restored payment must never ask the wallet to pay again.");
          },
        }}
        expectations={requestPresent
          ? {
              inputToken: destinationUsdc,
              outputToken: shareToken,
              target: sale,
            }
          : undefined}
        kind="fixed_price_sale"
        output={{ decimals: 6, symbol: "CHANGED" }}
        payer={payer}
        pendingAction={undefined}
        request={requestPresent
          ? {
              boardroom: payer,
              chainId: 998,
              kind: "fixed_price_sale",
              maxSlippageBps: 100,
              payer,
              recipient: payer,
              refundAddress: payer,
              sale,
              shareAmount: "2",
            }
          : undefined}
        runAction={async (_label, action) => await action()}
      />
    );

    let firstRoot = createRoot(container);
    try {
      await act(async () => {
        firstRoot.render(renderAction(true));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(statusReads).toBeGreaterThanOrEqual(1);
      expect(container.textContent).toContain("Review Hyperliquid order");

      await act(async () => {
        firstRoot.render(renderAction(false));
        await Promise.resolve();
      });
      expect(container.textContent).toContain("Review Hyperliquid order");
      expect(dom.window.localStorage.length).toBe(1);

      act(() => firstRoot.unmount());
      firstRoot = createRoot(container);
      const readsBeforeRemount = statusReads;
      await act(async () => {
        firstRoot.render(renderAction(false));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(statusReads).toBeGreaterThan(readsBeforeRemount);
      const button = Array.from(container.querySelectorAll("button"))
        .find((candidate) =>
          candidate.textContent?.includes("Review Hyperliquid order"),
        );
      expect(button?.disabled).toBe(false);
      expect(dom.window.localStorage.length).toBe(1);
    } finally {
      act(() => firstRoot.unmount());
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      dom.window.close();
    }
  });

  test("keeps recovery visible outside a marketplace route and clears a resolved lock", async () => {
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
    let statusReads = 0;
    Object.defineProperty(dom.window.navigator, "locks", {
      configurable: true,
      value: {
        async request<T>(
          _name: string,
          _options: { mode: "exclusive" },
          callback: () => Promise<T>,
        ): Promise<T> {
          return callback();
        },
      },
    });
    setGlobal("window", dom.window);
    setGlobal("document", dom.window.document);
    setGlobal("navigator", dom.window.navigator);
    setGlobal("HTMLElement", dom.window.HTMLElement);
    setGlobal("Node", dom.window.Node);
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setGlobal("fetch", async () => {
      statusReads += 1;
      return Response.json({
        order: {
          ...recoveryOrder(),
          executionTransaction: `0x${"22".repeat(32)}`,
          message: "The marketplace transaction completed.",
          status: "executed",
        },
      });
    });

    saveHyperliquidPendingPayment(
      dom.window.localStorage,
      config,
      payer,
      "fixed_price_sale",
      quote,
      { decimals: 18, symbol: "PLEDGE" },
    );

    const container = dom.window.document.getElementById("root") as HTMLElement;
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <HyperliquidRecoveryCenter config={config} payer={payer} />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(statusReads).toBeGreaterThanOrEqual(1);
      expect(container.textContent).toContain("Hyperliquid order executed");
      expect(container.textContent).toContain(
        "The marketplace transaction completed.",
      );
      expect(dom.window.localStorage.length).toBe(0);
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

function recoveryOrder(): HyperliquidMarketplaceOrder {
  return {
    execution: quote.execution,
    expiresAt: quote.expiresAt,
    kind: quote.kind,
    message: "Reconciling the created payment.",
    orderId: quote.orderId,
    payer,
    quoteId: quote.quoteId,
    recipient: payer,
    refundAddress: payer,
    sourcePayment: quote.payment,
    status: "recovery_pending",
  };
}
