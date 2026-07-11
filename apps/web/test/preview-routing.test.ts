import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { previewDirectoryIndexRoute } from "../vite.config";

const outputRoot = "/srv/pledge.cash/dist-local";

describe("preview directory routing", () => {
  test("rewrites extensionless docs routes to their generated directory index", () => {
    expect(previewDirectoryIndexRoute(
      "/pledge-cash/docs/guides/wind-down-and-redeem?audit=hq",
      "/pledge-cash/",
      outputRoot,
    )).toEqual({
      indexFile: join(outputRoot, "docs/guides/wind-down-and-redeem/index.html"),
      rewrittenUrl: "/pledge-cash/docs/guides/wind-down-and-redeem/?audit=hq",
    });

    expect(previewDirectoryIndexRoute("/docs/flows/receive-grant?source=legacy", "/", outputRoot)).toEqual({
      indexFile: join(outputRoot, "docs/flows/receive-grant/index.html"),
      rewrittenUrl: "/docs/flows/receive-grant/?source=legacy",
    });
  });

  test("leaves app routes, files, existing directory URLs, and paths outside the base untouched", () => {
    expect(previewDirectoryIndexRoute("/pledge-cash/explore", "/pledge-cash/", outputRoot)).toBeUndefined();
    expect(previewDirectoryIndexRoute("/pledge-cash/docs/search.json", "/pledge-cash/", outputRoot)).toBeUndefined();
    expect(previewDirectoryIndexRoute("/pledge-cash/docs/guides/wind-down-and-redeem/", "/pledge-cash/", outputRoot)).toBeUndefined();
    expect(previewDirectoryIndexRoute("/docs/guides/wind-down-and-redeem", "/pledge-cash/", outputRoot)).toBeUndefined();
    expect(previewDirectoryIndexRoute("/pledge-cash/docs", "./", outputRoot)).toBeUndefined();
  });

  test("keeps decoded traversal candidates inside the configured output root", () => {
    expect(previewDirectoryIndexRoute(
      "/pledge-cash/docs/guides/%2e%2e/%2e%2e/%2e%2e/secrets",
      "/pledge-cash/",
      outputRoot,
    )).toBeUndefined();
  });
});
