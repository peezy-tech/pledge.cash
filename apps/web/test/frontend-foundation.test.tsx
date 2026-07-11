import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import {
  DesktopPrimaryNav,
  MobilePrimaryNav,
  ProjectSectionNav,
  shouldHandleClientNavigation,
  StudioSectionNav,
} from "../src/app/product-navigation";
import { Web3Provider } from "../src/components/web3-provider";
import { AppHeader } from "../src/features/wallet/app-header";
import { PLEDGE_CASH_NETWORKS } from "../src/lib/contracts";

const boardroom = "0x7000000000000000000000000000000000000000" as Address;

describe("frontend foundation", () => {
  test("renders accessible desktop and mobile primary navigation", () => {
    const html = renderToString(
      <>
        <DesktopPrimaryNav active="portfolio" chainId={31337} />
        <MobilePrimaryNav active="portfolio" chainId={31337} />
      </>,
    );

    expect(html.match(/aria-label="Primary"/g)?.length).toBe(2);
    expect(html).toContain('href="/explore?chain=31337"');
    expect(html).toContain('href="/portfolio?chain=31337"');
    expect(html).toContain('href="/studio?chain=31337"');
    expect(html.match(/aria-current="page"/g)?.length).toBe(2);
  });

  test("renders four canonical project sections with compact mobile labels", () => {
    const html = renderToString(
      <ProjectSectionNav active="governance" boardroom={boardroom} chainId={31337} />,
    );

    expect(html).toContain('aria-label="Project sections"');
    expect(html).toContain(`/projects/31337/${boardroom}/overview`);
    expect(html).toContain(`/projects/31337/${boardroom}/participate`);
    expect(html).toContain(`/projects/31337/${boardroom}/governance`);
    expect(html).toContain(`/projects/31337/${boardroom}/transparency`);
    expect(html).toContain("Govern");
    expect(html).toContain("Transparency");
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
  });

  test("keeps every operator workflow reachable from Studio", () => {
    const html = renderToString(<StudioSectionNav active="distributions" boardroom={boardroom} chainId={31337} />);
    expect(html).toContain('aria-label="Studio sections"');
    expect(html).toContain(`/studio/31337/${boardroom}/setup`);
    expect(html).toContain(`/studio/31337/${boardroom}/governance`);
    expect(html).toContain(`/studio/31337/${boardroom}/close`);
    expect(html).toContain('aria-current="page"');
  });

  test("only intercepts unmodified primary-button anchor navigation", () => {
    const plainClick = { altKey: false, button: 0, ctrlKey: false, metaKey: false, shiftKey: false };
    expect(shouldHandleClientNavigation(plainClick)).toBe(true);
    expect(shouldHandleClientNavigation({ ...plainClick, button: 1 })).toBe(false);
    expect(shouldHandleClientNavigation({ ...plainClick, ctrlKey: true })).toBe(false);
    expect(shouldHandleClientNavigation({ ...plainClick, metaKey: true })).toBe(false);
    expect(shouldHandleClientNavigation({ ...plainClick, shiftKey: true })).toBe(false);
    expect(shouldHandleClientNavigation({ ...plainClick, altKey: true })).toBe(false);
  });

  test("keeps the compact header usable and gates all wallet controls while pending", () => {
    const html = renderToString(
      <Web3Provider>
        <AppHeader
          chainId={31337}
          chainName="Local Anvil"
          networks={PLEDGE_CASH_NETWORKS}
          onNetworkChange={() => undefined}
          pendingAction="queued-transaction"
          runAction={async (_label, action) => action()}
          switchChain={async () => undefined}
          wallet={{}}
        />
      </Web3Provider>,
    );

    expect(html).toContain('href="/explore"');
    expect(html).toContain('aria-label="pledge.cash Explore"');
    expect(html).toContain('aria-label="Network"');
    expect(html).toContain('aria-label="Connect Wallet"');
    expect(html).toContain(">Connect<");
    expect(html).not.toContain('aria-label="Switch wallet network"');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("keeps small muted text above WCAG AA contrast on raised surfaces", async () => {
    const css = await Bun.file(new URL("../src/index.css", import.meta.url)).text();
    const raisedSurface = cssColor(css, "--pc-surface-raised");

    for (const token of ["--color-zinc-500", "--color-zinc-600", "--pc-text-subtle"]) {
      expect(contrastRatio(cssColor(css, token), raisedSurface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("keeps strict governance index validation out of the initial application chunk", async () => {
    const source = await Bun.file(new URL("../src/app/App.tsx", import.meta.url)).text();

    expect(source).toContain('import("../lib/governance-actions")');
    expect(source).not.toMatch(/^import .*governance-actions/m);
  });
});

function cssColor(css: string, token: string): string {
  const match = css.match(new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`Missing CSS color token ${token}`);
  return match[1];
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function relativeLuminance(hex: string): number {
  const channels = hex.match(/[0-9a-fA-F]{2}/g)?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3) throw new Error(`Invalid hex color ${hex}`);
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
