import { spawnSync } from "node:child_process";
import { access, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeDocsBasePath } from "../base-path.js";
import { assertValidJavaScriptModule } from "./javascript-syntax.js";

const outDir = resolve(process.env.PLEDGE_CASH_DOCS_OUT_DIR ?? "out");
const basePath = normalizeDocsBasePath(
  process.env.PLEDGE_CASH_DOCS_BASE_PATH ?? "/docs",
  "PLEDGE_CASH_DOCS_BASE_PATH",
);
const publicPagefindPath = `${basePath}/_pagefind/pagefind.js` || "/_pagefind/pagefind.js";
const pagefindDir = join(outDir, "_pagefind");
const pagefindEntry = join(pagefindDir, "pagefind.js");
const pagefindCore = join(pagefindDir, "pagefind-core.js");
const docsDir = fileURLToPath(new URL("../", import.meta.url));
const pagefindRunner = join(
  docsDir,
  "node_modules",
  "pagefind",
  "lib",
  "runner",
  "bin.cjs",
);

function baseAwarePath(value) {
  if (!value.startsWith("/") || !basePath) return value;
  if (value === basePath || value.startsWith(`${basePath}/`)) return value;
  return `${basePath}${value}`;
}

function rewriteMarkdownRootLinks(source) {
  return source.replace(/\]\((\/[^)\s]*)\)/g, (_match, path) => `](${baseAwarePath(path)})`);
}

function resolvePageMarkdownTarget(target, pageUrl) {
  if (!target || target.startsWith("#") || target.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(target)) {
    return target;
  }
  if (target.startsWith("/")) return baseAwarePath(target);
  const resolved = new URL(target, `https://pledge-docs.invalid${pageUrl}`);
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

function rewritePageMarkdownLinks(source, pageUrl) {
  return source
    .replace(/(!?\[[^\]\n]*\]\(\s*)(?:<([^>]+)>|([^\s)]+))/g, (_match, prefix, angleTarget, plainTarget) => {
      const target = angleTarget ?? plainTarget;
      const rewritten = resolvePageMarkdownTarget(target, pageUrl);
      return `${prefix}${angleTarget === undefined ? rewritten : `<${rewritten}>`}`;
    })
    .replace(/^(\s*\[[^\]\n]+\]:\s*)(?:<([^>]+)>|(\S+))/gm, (_match, prefix, angleTarget, plainTarget) => {
      const target = angleTarget ?? plainTarget;
      const rewritten = resolvePageMarkdownTarget(target, pageUrl);
      return `${prefix}${angleTarget === undefined ? rewritten : `<${rewritten}>`}`;
    });
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

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jsonForInlineScript(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

const rawManifest = JSON.parse(await readFile(join(outDir, "mcp.json"), "utf8"));
const rawSearchManifest = JSON.parse(await readFile(join(outDir, "search.json"), "utf8"));
if (
  !Array.isArray(rawSearchManifest.pages)
  || rawSearchManifest.pages.length !== rawManifest.pages?.length
  || rawSearchManifest.pages.some((page) => typeof page.id !== "string" || typeof page.description !== "string")
) {
  throw new Error("Generated search manifest is missing page descriptions for client-side metadata.");
}
const rootPage = rawManifest.pages?.find((page) => page.url === "/");
if (
  typeof rootPage?.title !== "string"
  || typeof rootPage.description !== "string"
  || typeof rootPage.content !== "string"
) {
  throw new Error("Generated MCP manifest is missing the documentation landing page.");
}

const rootCanonical = `${basePath}/` || "/";
const rootTitle = `${rootPage.title} | ${rawManifest.name ?? "pledge.cash"}`;
const rootMetadata = [
  `<meta name="description" content="${escapeHtml(rootPage.description)}">`,
  `<link rel="canonical" href="${rootCanonical}">`,
  `<script id="pledge-docs-page-metadata">window.__PLEDGE_DOCS_PAGE_DESCRIPTIONS__=${jsonForInlineScript(Object.fromEntries(
    (rawSearchManifest.pages ?? []).map((page) => [page.id, page.description]),
  ))};</script>`,
].join("\n");
const rootSearchBody = `<div data-pagefind-body style="display:none"><h1>${escapeHtml(rootPage.title)}</h1>\n${escapeHtml(rootPage.content)}</div>`;
const rootHtmlFile = join(outDir, "index.html");
let rootHtml = await readFile(rootHtmlFile, "utf8");
if (!rootHtml.includes("</head>") || !rootHtml.includes("</body>")) {
  throw new Error("Generated documentation landing page is missing required HTML structure.");
}
rootHtml = rootHtml
  .replace(/<meta\b(?=[^>]*\bname=["']description["'])[^>]*>\s*/gi, "")
  .replace(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>\s*/gi, "")
  .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(rootTitle)}</title>`)
  .replace("</head>", `  ${rootMetadata}\n</head>`);
if (!rootHtml.includes("data-pagefind-body")) {
  rootHtml = rootHtml.replace("</body>", `  ${rootSearchBody}\n</body>`);
}
await writeFile(rootHtmlFile, rootHtml);

const pagefindBuild = spawnSync(
  process.execPath,
  [pagefindRunner, "--site", outDir, "--output-subdir", "_pagefind"],
  { cwd: docsDir, encoding: "utf8" },
);
if (pagefindBuild.status !== 0) {
  const detail = pagefindBuild.error?.message || pagefindBuild.stderr?.trim() || "unknown error";
  throw new Error(`Pagefind rebuild failed after landing-page injection:\n${detail}`);
}

const needle = "/_pagefind/pagefind.js";
let replacements = 0;

for (const file of await filesWithExtension(join(outDir, "assets"), ".js")) {
  const source = await readFile(file, "utf8");
  if (/<h[1-6](?![^>]*\bid=)[^>]*><a class="heading-anchor"/.test(source)) {
    throw new Error(`Generated Markdown heading is missing its fragment id: ${file}`);
  }
  const matches = source.split(needle).length - 1;
  if (matches === 0) continue;
  await writeFile(file, source.replaceAll(needle, publicPagefindPath));
  replacements += matches;
}

if (replacements !== 1) {
  throw new Error(`Tome's Pagefind loader signature changed (${replacements.toString()} references); refusing to publish a build with unverified search paths.`);
}

await rename(pagefindEntry, pagefindCore);
await writeFile(pagefindEntry, `// Generated by docs/scripts/fix-built-shell.js.
// Tome 0.8.1 assumes both a domain-root index and domain-root result URLs.
import * as pagefind from "./pagefind-core.js";

const docsBasePath = ${JSON.stringify(basePath)};
const indexBasePath = new URL("./", import.meta.url).pathname;
let initialization;

function normalizeResultUrl(value) {
  if (!value) return value;
  const parsed = new URL(value, window.location.origin);
  let pathname = parsed.pathname;
  if (docsBasePath && (pathname === docsBasePath || pathname.startsWith(docsBasePath + "/"))) {
    pathname = pathname.slice(docsBasePath.length) || "/";
  }
  if (pathname.length > 1) pathname = pathname.replace(/\\/+$/, "");
  return pathname;
}

function normalizeResults(result) {
  if (!result?.results) return result;
  for (const item of result.results) {
    const load = item.data;
    item.data = async () => {
      const data = await load();
      return { ...data, url: normalizeResultUrl(data.url) };
    };
  }
  return result;
}

export function init() {
  initialization ??= (async () => {
    await pagefind.options({ basePath: indexBasePath, baseUrl: "/" });
    await pagefind.init();
  })();
  return initialization;
}

export async function search(query, options) {
  await init();
  return normalizeResults(await pagefind.search(query, options));
}

export async function preload(query, options) {
  await init();
  return pagefind.preload(query, options);
}

export async function filters() {
  await init();
  return pagefind.filters();
}
`);

assertValidJavaScriptModule(await readFile(pagefindEntry, "utf8"), "Generated Pagefind wrapper");

const faviconPath = `${basePath}/favicon.svg` || "/favicon.svg";
const builtRootHtml = await readFile(join(outDir, "index.html"), "utf8");
const headFragments = [
  ["script", "pledge-docs-initial-hash"],
  ["script", "pledge-docs-page-metadata"],
  ["style", "pledge-docs-theme"],
].map(([tag, id]) => {
  const match = builtRootHtml.match(new RegExp(`<${tag}\\b[^>]*\\bid=["']${id}["'][^>]*>[\\s\\S]*?</${tag}>`, "i"));
  if (!match) throw new Error(`Generated root page is missing required head element #${id}.`);
  return { id, markup: match[0] };
});

let faviconPages = 0;
for (const file of await filesWithExtension(outDir, ".html")) {
  const source = await readFile(file, "utf8");
  let fixed = source.replace(/<link\b[^>]*\brel=["']icon["'][^>]*>\s*/gi, "");
  fixed = fixed
    .replaceAll('href="/llms.txt"', `href="${baseAwarePath("/llms.txt")}"`)
    .replaceAll("href='/llms.txt'", `href='${baseAwarePath("/llms.txt")}'`);
  if (!fixed.includes("</head>")) {
    throw new Error(`Generated page has no </head> for favicon injection: ${file}`);
  }
  for (const fragment of headFragments) {
    if (!fixed.includes(`id="${fragment.id}"`) && !fixed.includes(`id='${fragment.id}'`)) {
      fixed = fixed.replace("</head>", `  ${fragment.markup}\n</head>`);
    }
  }
  fixed = fixed.replace("</head>", `  <link rel="icon" href="${faviconPath}" type="image/svg+xml" />\n</head>`);
  await writeFile(file, fixed);
  faviconPages += 1;
}

const machineResourcePaths = [
  "/llms.txt",
  "/llms-full.txt",
  "/skill.md",
  "/mcp.json",
  "/robots.txt",
  "/search.json",
];

for (const filename of ["llms.txt", "skill.md", "robots.txt"]) {
  const file = join(outDir, filename);
  let source = await readFile(file, "utf8");
  source = source.replaceAll("/pagefind/pagefind.js", baseAwarePath("/_pagefind/pagefind.js"));
  for (const resourcePath of machineResourcePaths) {
    source = source.replaceAll(resourcePath, baseAwarePath(resourcePath));
  }
  source = rewriteMarkdownRootLinks(source);
  await writeFile(file, source);
}

let mcpManifest;
for (const filename of ["mcp.json", "search.json"]) {
  const file = join(outDir, filename);
  const value = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(value.pages) || value.pages.length === 0) {
    throw new Error(`Generated ${filename} has no pages.`);
  }
  for (const page of value.pages) {
    if (typeof page.url !== "string" || !page.url.startsWith("/")) {
      throw new Error(`Generated ${filename} contains an invalid page URL.`);
    }
    const generatedUrl = page.url;
    page.url = baseAwarePath(generatedUrl);
    if (typeof page.content === "string") {
      page.content = rewritePageMarkdownLinks(page.content, page.url);
      if (filename === "mcp.json") {
        const markdownFile = generatedUrl === "/"
          ? join(outDir, "index.md")
          : join(outDir, `${generatedUrl.replace(/^\//, "")}.md`);
        await access(markdownFile);
        await writeFile(markdownFile, `${page.content.trim()}\n`);
      }
    }
  }
  if (filename === "search.json") {
    value.searchEndpoint = baseAwarePath("/_pagefind/pagefind.js");
  }
  if (filename === "mcp.json") mcpManifest = value;
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

if (!mcpManifest) throw new Error("Generated MCP manifest was not processed.");
const llmsFull = [
  `# ${mcpManifest.name}`,
  ...mcpManifest.pages.map((page) => [
    "---",
    `<!-- Source: ${page.url} -->`,
    `## ${page.title}`,
    page.content.trim(),
  ].join("\n\n")),
].join("\n\n");
await writeFile(join(outDir, "llms-full.txt"), `${llmsFull}\n`);

if (faviconPages === 0) throw new Error("Tome produced no HTML pages.");

console.log(`Fixed Tome shell for ${basePath || "/"}: ${replacements.toString()} search loader reference(s), ${faviconPages.toString()} favicon page(s).`);
