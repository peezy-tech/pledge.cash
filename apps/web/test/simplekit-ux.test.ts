import { describe, expect, test } from "bun:test";
import type { Connector } from "wagmi";
import {
  WALLET_CONNECTION_ERROR,
  connectorDisplayName,
  connectorProviderAvailable,
} from "../src/components/simplekit";

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

  test("keeps the mobile drawer modal, focused, and explicitly dismissible", async () => {
    const source = await Bun.file(new URL("../src/components/ui/drawer.tsx", import.meta.url)).text();

    expect(source).toContain("autoFocus = true");
    expect(source).toContain("modal = true");
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("<DrawerPrimitive.Close");
    expect(source).toContain(">Close</span>");
  });
});
