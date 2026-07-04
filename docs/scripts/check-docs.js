import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import config from "../tome.config.js";

const root = dirname(fileURLToPath(import.meta.url));
const docsRoot = dirname(root);
const pagesRoot = join(docsRoot, "pages");

const errors = [];

async function markdownFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await markdownFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

function pageId(path) {
  return relative(pagesRoot, path).replace(/\.md$/, "").split("/").join("/");
}

function frontmatterValue(source, key) {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return undefined;
  const line = match[1].split("\n").find((entry) => entry.startsWith(`${key}:`));
  return line?.slice(key.length + 1).trim();
}

const navPages = config.navigation.flatMap((group) => group.pages ?? []);
const navSet = new Set(navPages);

for (const page of navPages) {
  if (!/^[a-z0-9/-]+$/.test(page)) {
    errors.push(`Invalid nav page id: ${page}`);
  }
}

for (const page of navPages) {
  const count = navPages.filter((candidate) => candidate === page).length;
  if (count > 1) errors.push(`Duplicate nav page: ${page}`);
}

const files = await markdownFiles(pagesRoot);
const filePages = new Set(files.map(pageId));

for (const page of navSet) {
  if (!filePages.has(page)) errors.push(`Navigation references missing page: docs/pages/${page}.md`);
}

for (const page of filePages) {
  if (!navSet.has(page)) errors.push(`Markdown page is missing from navigation: ${page}`);
}

for (const file of files) {
  const source = await readFile(file, "utf8");
  const page = pageId(file);
  if (!frontmatterValue(source, "title")) errors.push(`${page} is missing frontmatter title`);
  if (!frontmatterValue(source, "description")) errors.push(`${page} is missing frontmatter description`);
  if (!source.includes(`\n# `)) errors.push(`${page} is missing an h1`);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Checked ${files.length.toString()} docs pages and ${navPages.length.toString()} navigation entries.`);
