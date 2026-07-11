import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { preview, type PreviewServer } from "vite";

import { previewDirectoryIndexRoute } from "../vite.config";

const outputRoot = "/srv/pledge.cash/dist-local";

function rawHttpRequest(port: number, target: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let response = "";
    socket.setEncoding("utf8");
    socket.setTimeout(5_000, () => socket.destroy(new Error("Raw preview request timed out.")));
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
  });
}

async function closePreview(server: PreviewServer | undefined) {
  if (!server) return;
  const closing = server.close();
  server.httpServer.closeAllConnections();
  await closing;
}

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

  test("rejects malformed request targets without throwing", () => {
    expect(() => previewDirectoryIndexRoute("//[", "/pledge-cash/", outputRoot)).not.toThrow();
    expect(previewDirectoryIndexRoute("//[", "/pledge-cash/", outputRoot)).toBeUndefined();
    expect(previewDirectoryIndexRoute("/%E0%A4%A", "/", outputRoot)).toBeUndefined();
  });

  test("integrates before Vite static serving and preserves the SPA fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "pledge-preview-routing-"));
    const outDir = join(root, "dist");
    const docsDir = join(outDir, "docs/guides/example");
    let server: PreviewServer | undefined;

    try {
      await mkdir(docsDir, { recursive: true });
      await writeFile(join(outDir, "index.html"), "<!doctype html><title>APP</title><p>APP SHELL</p>");
      await writeFile(join(docsDir, "index.html"), "<!doctype html><title>DOC</title><p>DOC PAGE</p>");
      await writeFile(join(outDir, "docs/search.json"), '{"fixture":"SEARCH FILE"}');

      server = await preview({
        appType: "spa",
        base: "/pledge-cash/",
        build: { outDir: "dist" },
        configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
        logLevel: "silent",
        preview: { allowedHosts: true, host: "127.0.0.1", port: 0, strictPort: true },
        root,
      });
      const address = server.httpServer.address();
      if (!address || typeof address === "string") throw new Error("Preview server did not bind a TCP port.");
      const origin = `http://127.0.0.1:${address.port.toString()}/pledge-cash`;
      const request = (path: string, init?: RequestInit) => fetch(`${origin}${path}`, {
        ...init,
        headers: { connection: "close" },
      });

      const deep = await request("/docs/guides/example?audit=hq");
      expect(deep.status).toBe(200);
      expect(await deep.text()).toContain("DOC PAGE");

      const head = await request("/docs/guides/example", { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");

      expect(await (await request("/docs/guides/example/")).text()).toContain("DOC PAGE");
      expect(await (await request("/docs/search.json")).json()).toEqual({ fixture: "SEARCH FILE" });
      expect(await (await request("/docs/missing")).text()).toContain("APP SHELL");
      expect(await (await request("/explore")).text()).toContain("APP SHELL");
      expect((await request("/docs/guides/example", { method: "POST" })).status).toBe(404);

      const malformed = await rawHttpRequest(address.port, "//[");
      expect(malformed.startsWith("HTTP/1.1 404")).toBe(true);
      expect(await (await request("/docs/guides/example")).text()).toContain("DOC PAGE");
    } finally {
      await closePreview(server);
      await rm(root, { force: true, recursive: true });
    }
  }, 30_000);
});
