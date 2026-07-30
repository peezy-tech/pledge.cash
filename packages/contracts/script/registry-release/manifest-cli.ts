#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseReleaseManifestJson } from "./manifest";

const [manifestPath] = process.argv.slice(2);
if (manifestPath === undefined || process.argv.length !== 3) {
  console.error("usage: bun manifest-cli.ts <release-manifest.json>");
  process.exit(64);
}

try {
  const source = await readFile(resolve(manifestPath), "utf8");
  const manifest = parseReleaseManifestJson(source);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
