import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import {
  DesktopPrimaryNav,
  MobilePrimaryNav,
  ProjectSectionNav,
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
    expect(html).not.toContain('aria-label="Switch wallet network"');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
