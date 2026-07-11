import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import { ParticipatePage, PortfolioPage, ProjectLayout } from "../src/app/pages";
import { AddressLink } from "../src/components/shell";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;

describe("product UX regressions", () => {
  test("renders one contextual Portfolio connection action", () => {
    const html = renderToString(
      <PortfolioPage
        connectAction={<button type="button">Connect test wallet</button>}
        loading={false}
        tasks={[]}
      />,
    );

    expect(html.match(/Connect test wallet/g)?.length).toBe(1);
    expect(html).toContain("No wallet connected");
  });

  test("gives each address action an exact accessible name and one explorer destination", () => {
    const html = renderToString(<AddressLink address={boardroom} />);

    expect(html).toContain(`aria-label="Copy address ${boardroom}"`);
    expect(html).toContain(`aria-label="Open address ${boardroom} in explorer"`);
    expect(html.match(/<a\b/g)?.length).toBe(1);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
  });

  test("shows the full canonical project name instead of truncating it", () => {
    const name = "A canonical project name that must remain fully visible across the narrowest mobile viewport";
    const html = renderToString(
      <ProjectLayout
        activeSection="overview"
        chainName="Local Anvil"
        loading={false}
        onNavigateSection={() => undefined}
        projectName={name}
      >
        <div>Project content</div>
      </ProjectLayout>,
    );

    expect(html).toContain(`>${name}</h1>`);
    expect(html).toMatch(/<h1 class="[^"]*\[overflow-wrap:anywhere\][^"]*"/);
    expect(html).not.toMatch(/<h1 class="[^"]*\btruncate\b[^"]*"/);
  });

  test("uses layout-neutral inactive-route guidance in single and multi-route views", () => {
    const singleRoute = renderToString(
      <ParticipatePage content={{ "fixed-price-sale": <div>Sale controls</div> }} loading={false} />,
    );
    const multipleRoutes = renderToString(
      <ParticipatePage
        content={{ "fixed-price-sale": <div>Sale controls</div>, amm: <div>AMM controls</div> }}
        loading={false}
        selectedRoute="fixed-price-sale"
      />,
    );

    for (const html of [singleRoute, multipleRoutes]) {
      expect(html).toContain("Its historical terms and contract remain visible in the route details.");
      expect(html).not.toContain("remain visible below");
    }
  });
});
