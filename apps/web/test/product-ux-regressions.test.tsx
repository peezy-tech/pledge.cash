import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { PortfolioPage } from "../src/app/pages";

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
});
