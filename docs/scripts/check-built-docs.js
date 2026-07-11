import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { normalizeDocsBasePath } from "../base-path.js";
import { docsRedirects } from "../redirects.js";
import config from "../tome.config.js";

const outDir = resolve(process.env.PLEDGE_CASH_DOCS_OUT_DIR ?? "out");
const basePath = normalizeDocsBasePath(
  process.env.PLEDGE_CASH_DOCS_BASE_PATH ?? "/docs",
  "PLEDGE_CASH_DOCS_BASE_PATH",
);
const errors = [];

function navigationPageIds(entries) {
  const pages = [];
  for (const entry of entries) {
    if (typeof entry === "string") pages.push(entry);
    else if (Array.isArray(entry?.pages)) pages.push(...navigationPageIds(entry.pages));
  }
  return pages;
}

function generatedPageId(page) {
  if (page === "index") return "index";
  return page.endsWith("/index") ? page.slice(0, -6) : page;
}

function generatedPageUrl(page) {
  const id = generatedPageId(page);
  if (id === "index") return `${basePath}/` || "/";
  return `${basePath}/${id}` || `/${id}`;
}

async function filesWithExtension(dir, extension) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await filesWithExtension(path, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(path);
  }
  return files;
}

async function readRequired(relativePath) {
  const path = join(outDir, relativePath);
  try {
    if ((await stat(path)).size === 0) throw new Error("empty");
    return await readFile(path, "utf8");
  } catch {
    errors.push(`Missing or empty generated artifact: ${relativePath}`);
    return "";
  }
}

const searchSource = await readRequired("search.json");
const mcpSource = await readRequired("mcp.json");
const pagefindEntrySource = await readRequired("_pagefind/pagefind-entry.json");
const llmsFull = await readRequired("llms-full.txt");
for (const artifact of ["llms.txt", "skill.md", "robots.txt", "favicon.svg", "_pagefind/pagefind.js"]) {
  await readRequired(artifact);
}

let search = {};
let mcp = {};
let pagefindEntry = {};
try { search = JSON.parse(searchSource); } catch { errors.push("Generated search.json is invalid JSON"); }
try { mcp = JSON.parse(mcpSource); } catch { errors.push("Generated mcp.json is invalid JSON"); }
try { pagefindEntry = JSON.parse(pagefindEntrySource); } catch { errors.push("Generated Pagefind entry is invalid JSON"); }

const searchPages = Array.isArray(search.pages) ? search.pages : [];
const mcpPages = Array.isArray(mcp.pages) ? mcp.pages : [];
const configuredPages = navigationPageIds(config.navigation ?? []);
const expectedIds = new Set(configuredPages.map(generatedPageId));
const expectedUrls = new Set(configuredPages.map(generatedPageUrl));
const expectedPages = expectedIds.size;
if (expectedPages === 0 || expectedPages !== configuredPages.length) {
  errors.push("Configured documentation navigation has no pages or duplicate generated ids");
}
if (searchPages.length !== expectedPages) errors.push(`search.json has ${searchPages.length.toString()} pages, expected ${expectedPages.toString()}`);
if (search.totalPages !== expectedPages) errors.push(`search.json totalPages is ${String(search.totalPages)}, expected ${expectedPages.toString()}`);
if (mcpPages.length !== expectedPages) errors.push(`mcp.json has ${mcpPages.length.toString()} pages, expected ${expectedPages.toString()}`);
if (search.searchEndpoint !== `${basePath}/_pagefind/pagefind.js` && !(basePath === "" && search.searchEndpoint === "/_pagefind/pagefind.js")) {
  errors.push(`search.json has the wrong Pagefind endpoint: ${String(search.searchEndpoint)}`);
}

const pagefindPages = Object.values(pagefindEntry.languages ?? {})
  .reduce((total, language) => total + (Number(language?.page_count) || 0), 0);
if (pagefindPages !== expectedPages) {
  errors.push(`Pagefind indexed ${pagefindPages.toString()} pages, expected ${expectedPages.toString()}`);
}

const urls = new Set();
const ids = new Set();
const expectedPrefix = `${basePath}/` || "/";
const faviconPath = `${basePath}/favicon.svg` || "/favicon.svg";
for (const page of searchPages) {
  if (typeof page.id !== "string" || !expectedIds.has(page.id)) errors.push(`Generated page has an unexpected id: ${String(page.id)}`);
  if (ids.has(page.id)) errors.push(`Duplicate generated page id: ${String(page.id)}`);
  ids.add(page.id);
  if (typeof page.url !== "string" || !page.url.startsWith(expectedPrefix)) {
    errors.push(`Generated page has an invalid base-aware URL: ${String(page.url)}`);
    continue;
  }
  if (urls.has(page.url)) errors.push(`Duplicate generated page URL: ${page.url}`);
  if (!expectedUrls.has(page.url)) errors.push(`Generated page has an unexpected URL: ${page.url}`);
  urls.add(page.url);

  const relativePath = page.url.slice(basePath.length).replace(/^\/+|\/+$/g, "");
  const htmlPath = relativePath ? join(relativePath, "index.html") : "index.html";
  const html = await readRequired(htmlPath);
  if (!html.includes("data-pagefind-body")) errors.push(`${htmlPath} is missing data-pagefind-body`);
  const canonicalMarkup = `<link rel="canonical" href="${page.url}">`;
  if (html.split(canonicalMarkup).length - 1 !== 1) errors.push(`${htmlPath} has the wrong canonical URL`);
  const descriptions = html.match(/<meta\s+name=["']description["']\s+content=["'][^"']+["']\s*\/?\s*>/gi) ?? [];
  if (descriptions.length !== 1) {
    errors.push(`${htmlPath} is missing a non-empty meta description`);
  }
  if (!html.includes('id="pledge-docs-page-metadata"')) {
    errors.push(`${htmlPath} is missing page metadata for client-side navigation`);
  }
  if (!html.includes(`<link rel="icon" href="${faviconPath}" type="image/svg+xml" />`)) {
    errors.push(`${htmlPath} has the wrong favicon URL`);
  }
}

for (const id of expectedIds) {
  if (!ids.has(id)) errors.push(`Generated search manifest is missing page id: ${id}`);
}
const mcpUrls = new Set(mcpPages.map((page) => page.url));
for (const url of expectedUrls) {
  if (!urls.has(url)) errors.push(`Generated search manifest is missing page URL: ${url}`);
  if (!mcpUrls.has(url)) errors.push(`Generated MCP manifest is missing page URL: ${url}`);
}
for (const url of mcpUrls) {
  if (!expectedUrls.has(url)) errors.push(`Generated MCP manifest has an unexpected page URL: ${String(url)}`);
}

const sourceMarkers = llmsFull.match(/<!-- Source: \/[^\n]+ -->/g) ?? [];
if (sourceMarkers.length !== expectedPages) {
  errors.push(`llms-full.txt has ${sourceMarkers.length.toString()} source markers, expected ${expectedPages.toString()}`);
}

const htmlFiles = await filesWithExtension(outDir, ".html");
const expectedHtml = expectedPages + Object.keys(docsRedirects).length;
if (htmlFiles.length !== expectedHtml) {
  errors.push(`Generated output has ${htmlFiles.length.toString()} HTML routes, expected ${expectedHtml.toString()}`);
}

for (const file of await filesWithExtension(join(outDir, "assets"), ".js")) {
  const source = await readFile(file, "utf8");
  if (/<h[1-6](?![^>]*\bid=)[^>]*><a class="heading-anchor"/.test(source)) {
    errors.push(`Generated Markdown heading is missing its fragment id: ${file}`);
  }
}

if (errors.length > 0) {
  console.error([...new Set(errors)].sort().map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Checked ${expectedPages.toString()} built docs pages, ${pagefindPages.toString()} Pagefind entries, metadata, machine artifacts, and ${htmlFiles.length.toString()} routes for ${basePath || "/"}.`);
