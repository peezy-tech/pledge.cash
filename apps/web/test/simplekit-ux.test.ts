import { describe, expect, test } from "bun:test";
import type { Connector } from "wagmi";
import {
  NO_PROVIDER_WALLET_GUIDANCE,
  WALLET_CONNECTION_ERROR,
  connectorDisplayName,
  connectorProviderAvailable,
  formatWalletBalance,
  walletBalanceDisplayState,
} from "../src/components/simplekit";
import { networkForChainId } from "../src/lib/contracts";

describe("SimpleKit wallet UX", () => {
  test("uses a human connector label and truthful single-connector recovery copy", () => {
    expect(connectorDisplayName({ name: "Injected" })).toBe("Browser wallet");
    expect(connectorDisplayName({ name: "MetaMask" })).toBe("MetaMask");
    expect(WALLET_CONNECTION_ERROR).toContain("installed, unlocked, and allowed");
    expect(WALLET_CONNECTION_ERROR).not.toContain("choose another wallet");
  });

  test("distinguishes an available injected provider from missing or failed providers", async () => {
    const connector = (getProvider: () => Promise<unknown>) => ({ getProvider }) as Pick<Connector, "getProvider">;

    expect(await connectorProviderAvailable(connector(async () => ({ request: () => undefined })))).toBe(true);
    expect(await connectorProviderAvailable(connector(async () => undefined))).toBe(false);
    expect(await connectorProviderAvailable(connector(async () => { throw new Error("not installed"); }))).toBe(false);
  });

  test("offers read-only use and wallet-app browser guidance when no provider exists", () => {
    expect(NO_PROVIDER_WALLET_GUIDANCE).toContain("Continue read-only");
    expect(NO_PROVIDER_WALLET_GUIDANCE).toContain("wallet app's built-in browser");
    expect(NO_PROVIDER_WALLET_GUIDANCE).toContain("injected wallet");
    expect(NO_PROVIDER_WALLET_GUIDANCE).not.toContain("the only option");
  });

  test("distinguishes balance loading, zero, value, error, and disconnected states", () => {
    const network = networkForChainId(31337);
    const address = "0x1000000000000000000000000000000000000000";
    const state = (overrides: Partial<Parameters<typeof walletBalanceDisplayState>[0]> = {}) => walletBalanceDisplayState({
      accountStatus: "connected",
      address,
      balanceStatus: "success",
      network,
      userBalance: { value: 0n, decimals: 18, symbol: "HYPE" },
      ...overrides,
    });

    expect(state({ balanceStatus: "pending", userBalance: undefined })).toEqual({ status: "loading", text: "Loading balance…" });
    expect(state()).toEqual({ status: "zero", text: "0 HYPE" });
    expect(state({ userBalance: { value: 1_234_567_000_000_000_000n, decimals: 18, symbol: "HYPE" } })).toEqual({
      status: "value",
      text: "1.2346 HYPE",
    });
    expect(state({ balanceStatus: "error", userBalance: undefined })).toEqual({ status: "unavailable", text: "Balance unavailable" });
    expect(state({ accountStatus: "disconnected", address: undefined, balanceStatus: "pending" })).toEqual({
      status: "hidden",
      text: undefined,
    });
    expect(formatWalletBalance(undefined)).toBeUndefined();
  });

  test("keeps the mobile drawer modal, focused, and explicitly dismissible", async () => {
    const source = await Bun.file(new URL("../src/components/ui/drawer.tsx", import.meta.url)).text();

    expect(source).toContain("autoFocus = true");
    expect(source).toContain("modal = true");
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("<DrawerPrimitive.Close");
    expect(source).toContain(">Close</span>");
  });
});
