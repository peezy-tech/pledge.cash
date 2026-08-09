import { describe, expect, test } from "bun:test";
import type { Address, BoardroomState, LiquidityLockerState } from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import {
  DesktopPrimaryNav,
  MobilePrimaryNav,
  ProjectSectionNav,
  shouldHandleClientNavigation,
  StudioSectionNav,
} from "../src/app/product-navigation";
import { Web3Provider } from "../src/components/web3-provider";
import { BoardroomWorkspace, type BoardroomWorkspaceForm } from "../src/features/boardrooms/boardroom-workspace";
import {
  defaultBoardroomGrantForm,
  defaultLiquidityExitForm,
  defaultLiquidityLockerForm,
  defaultLiquidityPositionForm,
  defaultWindDownForm,
} from "../src/lib/forms";
import {
  AppHeader,
  networkAvailabilityLabel,
  networkOptionDisabled,
  networkOptionLabel,
} from "../src/features/wallet/app-header";
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

  test("renders the three canonical project sections", () => {
    const html = renderToString(
      <ProjectSectionNav active="swap" boardroom={boardroom} chainId={31337} />,
    );

    expect(html).toContain('aria-label="Project sections"');
    expect(html).toContain(`/projects/31337/${boardroom}/overview`);
    expect(html).toContain(`/projects/31337/${boardroom}/swap`);
    expect(html).toContain(`/projects/31337/${boardroom}/transparency`);
    expect(html).toContain("Swap");
    expect(html).toContain("Transparency");
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
  });

  test("keeps every operator workflow reachable from Studio", () => {
    const html = renderToString(<StudioSectionNav active="liquidity" boardroom={boardroom} chainId={31337} />);
    expect(html).toContain('aria-label="Studio sections"');
    expect(html).toContain(`/studio/31337/${boardroom}/setup`);
    expect(html).toContain(`/studio/31337/${boardroom}/token`);
    expect(html).toContain(`/studio/31337/${boardroom}/grants`);
    expect(html).toContain(`/studio/31337/${boardroom}/liquidity`);
    expect(html).toContain(`/studio/31337/${boardroom}/close`);
    expect(html).toContain('aria-current="page"');
  });

  test("renders every retained project and studio workflow through the Boardroom workspace", () => {
    const state = boardroomState();
    const locker = lockerState();
    const form = workspaceForm();
    const common = {
      account: state.owner,
      boardroom: state,
      canManage: true,
      canWrite: true,
      chainId: 31337,
      form,
      locker,
      pendingAction: undefined,
      setForm: () => undefined,
      onAction: async () => undefined,
    } as const;
    const project = renderToString(<BoardroomWorkspace {...common} mode="project" projectSection="swap" swap={<p>Executable v4 swap</p>} />);
    expect(project).toContain("Executable v4 swap");
    expect(project).toContain(`/projects/31337/${boardroom}/transparency`);

    const sections = ["setup", "token", "grants", "liquidity", "close"] as const;
    const html = sections.map((section) => renderToString(<BoardroomWorkspace {...common} mode="studio" studioSection={section} />)).join("\n");
    expect(html).toContain("Authority and custody");
    expect(html).toContain("Share token");
    expect(html).toContain("Minting");
    expect(html).toContain("Mint shares");
    expect(html).not.toContain(">Launch<");
    expect(html).toContain("Treasury-funded grant");
    expect(html).toContain("Position custody");
    expect(html).toContain("Wind down and redeem");
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
    expect(html).toContain('aria-label="Local environment: Local, resettable environment with no real value. State depends on the current local chain."');
    expect(html).toContain(">Connect<");
    expect(html).not.toContain('aria-label="Switch wallet network"');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("labels and disables networks whose deployment is not ready", () => {
    const local = PLEDGE_CASH_NETWORKS.find((network) => network.chainId === 31337)!;
    const sepolia = PLEDGE_CASH_NETWORKS.find((network) => network.chainId === 11155111)!;

    expect(networkOptionLabel(local)).toBe("Local Anvil — Local (resettable, no real value)");
    expect(networkOptionLabel(sepolia, "pending")).toBe("Ethereum Sepolia — Testnet — deployment pending");
    expect(networkAvailabilityLabel("missing")).toBe("not deployed");
    expect(networkOptionDisabled("pending")).toBe(true);
    expect(networkOptionDisabled("ready")).toBe(false);

    const html = renderToString(
      <Web3Provider>
        <AppHeader
          chainId={31337}
          chainName="Local Anvil"
          networkAvailability={{ 11155111: "pending", 31337: "ready" }}
          networks={PLEDGE_CASH_NETWORKS}
          onNetworkChange={() => undefined}
          pendingAction={undefined}
          runAction={async (_label, action) => action()}
          switchChain={async () => undefined}
          wallet={{}}
        />
      </Web3Provider>,
    );

    expect(html).toContain("Ethereum Sepolia — Testnet — deployment pending");
    expect(html.match(/<option disabled=""/g)?.length).toBe(1);
  });

  test("keeps small muted text above WCAG AA contrast on raised surfaces", async () => {
    const css = await Bun.file(new URL("../src/index.css", import.meta.url)).text();
    const raisedSurface = cssColor(css, "--pc-surface-raised");

    for (const token of ["--color-zinc-500", "--color-zinc-600", "--pc-text-subtle"]) {
      expect(contrastRatio(cssColor(css, token), raisedSurface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("keeps control boundaries discernible and avoids external font dependencies", async () => {
    const css = await Bun.file(new URL("../src/index.css", import.meta.url)).text();
    const controlBorder = cssColor(css, "--pc-control-border");

    expect(contrastRatio(controlBorder, cssColor(css, "--pc-control-surface"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(controlBorder, cssColor(css, "--pc-surface-raised"))).toBeGreaterThanOrEqual(3);
    expect(css).toContain("--pc-control-min-size: 2.75rem");
    expect(css).toContain("--pc-metric-value: #f3f2e9");
    expect(css).not.toContain("fonts.googleapis.com");
    expect(css).not.toContain("DM Sans");
    expect(css).not.toContain("JetBrains Mono");
  });

});

function boardroomState(): BoardroomState {
  return {
    address: boardroom,
    blockNumber: 10n,
    factory: "0x1000000000000000000000000000000000000001",
    owner: "0x1000000000000000000000000000000000000002",
    wrappedNative: "0x1000000000000000000000000000000000000003",
    shareToken: "0x1000000000000000000000000000000000000004",
    redemptionExcessRecipient: "0x1000000000000000000000000000000000000005",
    status: 0,
    windDownDelay: 100n,
    windDownStartedAt: 0n,
    totalShareSupply: 1_000n,
    treasuryShareBalance: 10n,
    redeemableAssetCount: 1n,
    snapshotAssetCount: 0n,
    snapshotCursor: 0n,
    snapshotFrozen: false,
    redemptionSupply: 0n,
    redemptionSupplyFrozen: false,
    openEscrowCount: 1n,
    liquidityMutationAllowed: true,
    lockedLiquidityExitAllowed: false,
  };
}

function lockerState(): LiquidityLockerState {
  return {
    address: "0x2000000000000000000000000000000000000001",
    boardroom,
    shareToken: "0x1000000000000000000000000000000000000004",
    quoteAsset: "0x2000000000000000000000000000000000000002",
    currency0: "0x1000000000000000000000000000000000000004",
    currency1: "0x2000000000000000000000000000000000000002",
    protocolFeeRouter: "0x2000000000000000000000000000000000000003",
    positionManager: "0x2000000000000000000000000000000000000004",
    poolFee: 3000,
    tickSpacing: 60,
    tokenId: 7n,
    pendingTokenId: 0n,
    positionRegistered: true,
    transferPrepared: false,
    closed: false,
    positionLiquidity: 500n,
  };
}

function workspaceForm(): BoardroomWorkspaceForm {
  return {
    mintTo: "",
    mintAmount: "1",
    snapshotMaximum: "32",
    grant: defaultBoardroomGrantForm(),
    locker: defaultLiquidityLockerForm(),
    position: defaultLiquidityPositionForm(),
    exit: defaultLiquidityExitForm(),
    windDown: defaultWindDownForm(),
  };
}

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
