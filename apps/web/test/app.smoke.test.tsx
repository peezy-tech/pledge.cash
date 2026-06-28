import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { App } from "../src/App";

describe("web app shell", () => {
  test("renders core protocol sections without a browser", () => {
    const html = renderToString(<App />);

    expect(html).toContain("pledge.cash");
    expect(html).toContain("Deployment");
    expect(html).toContain("TokenGrantFactory");
    expect(html).toContain("Ready");
    expect(html).toContain("Direct Grant");
    expect(html).toContain("Inspect Grant");
    expect(html).toContain("Boardroom");
  });
});
