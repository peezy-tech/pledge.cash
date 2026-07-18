import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  MetricGrid,
  ParticipatePage,
  PortfolioPage,
  ProjectLayout,
} from "../src/app/pages";
import { ActionButton, AddressLink, Field } from "../src/components/shell";
import { Input } from "../src/components/ui/input";

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
      expect(html).toContain("Current contract state has not been loaded for this route.");
      expect(html).not.toContain("remain visible below");
    }
  });

  test("keeps ActionButton content and geometry stable while exposing pending state", () => {
    const idle = renderToString(
      <ActionButton actionId="pledge" pendingAction={undefined} pendingLabel="Submitting pledge">
        Confirm pledge
      </ActionButton>,
    );
    const pending = renderToString(
      <ActionButton actionId="pledge" pendingAction="pledge" pendingLabel="Submitting pledge">
        Confirm pledge
      </ActionButton>,
    );

    for (const html of [idle, pending]) {
      expect(html).toContain("Confirm pledge");
      expect(html).toContain("grid h-4 w-4 shrink-0 place-items-center");
    }
    expect(idle).not.toContain('aria-busy="true"');
    expect(idle).not.toContain("animate-spin");
    expect(pending).toContain('aria-busy="true"');
    expect(pending).toContain('disabled=""');
    expect(pending).toContain("animate-spin");
    expect(pending).toContain('aria-live="polite"');
    expect(pending).toContain('role="status"');
    expect(pending).toContain("Submitting pledge");
  });

  test("associates Field labels, descriptions, and errors with stable control IDs", () => {
    const html = renderToString(
      <Field
        controlId="pledge-amount"
        description="Enter the amount in whole tokens."
        error="Amount exceeds the available balance."
        label="Pledge amount"
        required
      >
        <Input aria-describedby="balance-help" />
      </Field>,
    );

    expect(html).toContain('for="pledge-amount"');
    expect(html).toContain('id="pledge-amount"');
    expect(html).toContain('id="pledge-amount-description"');
    expect(html).toContain('id="pledge-amount-error"');
    expect(html).toContain('aria-describedby="balance-help pledge-amount-description pledge-amount-error"');
    expect(html).toContain('aria-errormessage="pledge-amount-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('role="alert"');
  });

  test("associates Field labels with token-select and native-mode buttons", () => {
    const html = renderToString(
      <>
        <Field label="Input token">
          <button type="button">Choose token</button>
        </Field>
        <Field label="Use native asset">
          <button aria-checked="false" role="checkbox" type="button">Pay with wrapped token</button>
        </Field>
        <Field label="Output token">
          <button aria-label="Selected output token" aria-labelledby="output-token-purpose" type="button">
            <span id="output-token-purpose">Choose output token</span>
          </button>
        </Field>
      </>,
    );
    const labels = Array.from(html.matchAll(/<label[^>]*for="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g));

    expect(labels).toHaveLength(3);
    expect(labels[0]?.[2]).toContain("Input token");
    expect(labels[1]?.[2]).toContain("Use native asset");
    expect(labels[2]?.[2]).toContain("Output token");
    for (const label of labels) {
      expect(html).toMatch(new RegExp(`<button[^>]*id="${label[1]}"`));
    }
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-label="Selected output token"');
    expect(html).toContain('aria-labelledby="output-token-purpose"');
  });

  test("renders reusable metrics and text-labeled product states", () => {
    const html = renderToString(
      <>
        <MetricGrid columns={2} label="Project metrics">
          <Metric detail="Across all routes" label="Contributors" value="128" />
          <Metric label="Treasury" value="$42,000" />
        </MetricGrid>
        <LoadingState description="Reading current project state." title="Loading project" />
        <EmptyState description="Create a route to begin." title="No participation routes" />
        <ErrorState description="Try the request again." title="Project data unavailable" />
      </>,
    );

    expect(html).toContain('aria-label="Project metrics"');
    expect(html).toContain("--pc-metric-surface");
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/role="status"/g)?.length).toBe(2);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Loading project");
    expect(html).toContain("No participation routes");
    expect(html).toContain("Project data unavailable");
  });
});
