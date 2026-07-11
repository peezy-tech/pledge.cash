import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import config from "../tome.config.js";

const root = dirname(fileURLToPath(import.meta.url));
const docsRoot = dirname(root);
const repoRoot = dirname(docsRoot);
const pagesRoot = join(docsRoot, "pages");
const deploymentsRoot = join(repoRoot, "packages", "contracts", "deployments");

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
  return files.sort();
}

function pageId(path) {
  return relative(pagesRoot, path).replace(/\.md$/, "").split(sep).join("/");
}

function frontmatterValue(source, key) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  const line = match[1].split(/\r?\n/).find((entry) => entry.startsWith(`${key}:`));
  return line?.slice(key.length + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
}

function navigationPages(navigation) {
  const pages = [];
  for (const group of navigation) {
    for (const entry of group.pages ?? []) {
      if (typeof entry === "string") pages.push(entry);
      else if (entry && Array.isArray(entry.pages)) pages.push(...navigationPages([entry]));
    }
  }
  return pages;
}

function proseSource(source) {
  return source
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, "")
    .replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, "")
    .replace(/`([^`\n]+)`/g, "$1");
}

function markdownLinkTargets(source) {
  const prose = proseSource(source);
  const targets = [];
  const inlineLink = /(!?)\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*["'])?\s*\)/g;
  const referenceLink = /^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm;
  let match;

  while ((match = inlineLink.exec(prose)) !== null) {
    if (match[1] !== "!") targets.push({ target: match[2] ?? match[3], index: match.index });
  }
  while ((match = referenceLink.exec(prose)) !== null) {
    targets.push({ target: match[1] ?? match[2], index: match.index });
  }
  return targets;
}

function lineNumber(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function normalizedDocsBase() {
  const value = config.basePath ?? "/";
  if (value === "/") return "";
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

function cleanTarget(target) {
  const withoutTitle = target.trim().replace(/^<|>$/g, "");
  return withoutTitle.split("#", 1)[0].split("?", 1)[0];
}

function isExternalTarget(target) {
  return target === ""
    || target.startsWith("#")
    || target.startsWith("//")
    || /^[a-z][a-z\d+.-]*:/i.test(target);
}

function resolvePageLink(fromPage, target, filePages) {
  const cleaned = cleanTarget(target);
  if (isExternalTarget(target) || cleaned === "") return { kind: "skip" };

  const docsBase = normalizedDocsBase();
  if (cleaned.startsWith("/")) {
    if (docsBase && (cleaned === docsBase || cleaned.startsWith(`${docsBase}/`))) {
      return { kind: "hardcoded-base" };
    }
    const candidate = cleaned.replace(/^\/+|\/+$/g, "").replace(/\.md$/, "") || "index";
    const roots = new Set([...filePages].map((page) => page.split("/", 1)[0]));
    return filePages.has(candidate) || roots.has(candidate.split("/", 1)[0])
      ? { kind: "hardcoded-base" }
      : { kind: "skip" };
  }

  const fromDir = dirname(join(pagesRoot, `${fromPage}.md`));
  const filesystemTarget = resolve(fromDir, cleaned);
  const relativeToPages = relative(pagesRoot, filesystemTarget);
  const escapesPages = relativeToPages === ".." || relativeToPages.startsWith(`..${sep}`);

  // Relative links that leave docs/pages are app handoffs. The authoring standard
  // deliberately uses ../../explore-style URLs so one source works at both bases.
  if (escapesPages) return { kind: "skip" };

  let candidate = relativeToPages.split(sep).join("/").replace(/\.md$/, "").replace(/\/$/, "");
  if (candidate.endsWith("/index")) candidate = candidate.slice(0, -6) || "index";
  if (candidate === "") candidate = "index";
  return filePages.has(candidate) ? { kind: "ok" } : { kind: "missing", candidate };
}

function unsafeClaims(page, source) {
  const prose = proseSource(source);
  const staleVocabulary = [
    /\/(?:wallet|boardroom-tools|direct|discovery|manage|market|positions|swap)(?:[/?#\s)`]|$)/i,
  ];

  for (const pattern of staleVocabulary) {
    const match = pattern.exec(prose);
    if (match) errors.push(`${page}:${lineNumber(prose, match.index)} uses stale app route vocabulary: ${match[0]}`);
  }

  for (const paragraph of prose.split(/\r?\n\s*\r?\n/)) {
    const normalized = paragraph.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const explicitlyUnavailable = /\b(?:blocked|disabled|pending|unavailable|cannot|can't|does not|doesn't|not (?:available|shown|supported|safe))\b/i.test(normalized);
    const launchClaim = /\b(?:(?:click|choose|press|select|use) (?:the )?|(?:you|owners?|operators?) (?:can|may|should) )(?:launch governance|launch boardroom governance)\b/i.test(normalized);
    if (launchClaim && !explicitlyUnavailable) {
      errors.push(`${page} presents governance launch as available; the current app blocks that transaction`);
    }

    const unsupportedGrantFact = /\b(?:exact settlement cost|transfer state|quarantine status)\b/i.exec(normalized);
    if (unsupportedGrantFact && !explicitlyUnavailable) {
      errors.push(`${page} claims the app presents unsupported grant fact "${unsupportedGrantFact[0]}"`);
    }

    if (/\b(?:simulation|simulating) (?:guarantees?|ensures?) (?:success|safety|a transaction will succeed)\b/i.test(normalized)) {
      errors.push(`${page} overstates transaction simulation as a guarantee`);
    }
    if (/\b(?:unknown|failed (?:read|history)|incomplete (?:read|history)) (?:means|is treated as|equals) zero\b/i.test(normalized)) {
      errors.push(`${page} turns incomplete on-chain information into a zero value`);
    }
  }
}

async function pendingDeploymentChecks(pageSources) {
  const networkNames = new Map([
    [998, "HyperEVM"],
    [10143, "Monad"],
  ]);
  const artifacts = (await readdir(deploymentsRoot))
    .filter((name) => name.endsWith(".json"))
    .sort();

  for (const artifact of artifacts) {
    const deployment = JSON.parse(await readFile(join(deploymentsRoot, artifact), "utf8"));
    if (deployment.status !== "pending") continue;
    const name = networkNames.get(deployment.chainId) ?? `chain ${deployment.chainId.toString()}`;
    let hasVisibleStatus = false;

    for (const { page, source } of pageSources) {
      const prose = proseSource(source);
      if (!new RegExp(`\\b${name}\\b`, "i").test(prose)) continue;
      const statusPattern = "(?:pending|unavailable|not (?:broadcast|deployed|live|available|usable|supported))";
      const pageStatesPending = new RegExp(
        `(?:\\b${name}\\b[\\s\\S]{0,1200}\\b${statusPattern}\\b|\\b${statusPattern}\\b[\\s\\S]{0,400}\\b${name}\\b)`,
        "i",
      ).test(prose);
      if (pageStatesPending) hasVisibleStatus = true;
      else errors.push(`${page} mentions pending ${name} without presenting its pending or unavailable status on the page`);

      for (const paragraph of prose.split(/\r?\n\s*\r?\n/)) {
        if (!new RegExp(`\\b${name}\\b`, "i").test(paragraph)) continue;
        const positiveLiveClaim = /\b(?:is|are|runs?|was|were) (?:currently )?(?:live|deployed|available|supported)\b|\blive (?:deployment|protocol stack)\b/i.test(paragraph);
        const qualified = /\bpending\b|\bnot (?:broadcast|deployed|live|available|usable|supported)\b|\bunavailable\b/i.test(paragraph);
        if (positiveLiveClaim && !qualified) {
          errors.push(`${page} presents pending ${name} as live or available`);
        }
      }
    }

    if (!hasVisibleStatus) {
      errors.push(`No public docs page presents ${name} deployment ${artifact} as pending or unavailable`);
    }
  }
}

const navPages = navigationPages(config.navigation);
const navSet = new Set(navPages);

for (const page of navPages) {
  if (!/^[a-z0-9/-]+$/.test(page)) errors.push(`Invalid nav page id: ${page}`);
}

for (const page of navSet) {
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

const titles = new Map();
const pageSources = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  const page = pageId(file);
  const title = frontmatterValue(source, "title");
  pageSources.push({ page, source });

  if (!title) errors.push(`${page} is missing frontmatter title`);
  else {
    const key = title.toLocaleLowerCase();
    const previous = titles.get(key);
    if (previous) errors.push(`Duplicate frontmatter title "${title}": ${previous} and ${page}`);
    else titles.set(key, page);
  }
  if (!frontmatterValue(source, "description")) errors.push(`${page} is missing frontmatter description`);
  if (!/^#\s+\S/m.test(proseSource(source))) errors.push(`${page} is missing an h1`);

  for (const { target, index } of markdownLinkTargets(source)) {
    const result = resolvePageLink(page, target, filePages);
    if (result.kind === "hardcoded-base") {
      errors.push(`${page}:${lineNumber(source, index)} hard-codes docs link ${target}; use a relative link so every deployed base path works`);
    } else if (result.kind === "missing") {
      errors.push(`${page}:${lineNumber(source, index)} links to missing docs page ${result.candidate} (${target})`);
    }
  }

  unsafeClaims(page, source);
}

await pendingDeploymentChecks(pageSources);

if (errors.length > 0) {
  console.error([...new Set(errors)].sort().map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Checked ${files.length.toString()} docs pages, ${navPages.length.toString()} navigation entries, links, titles, product claims, and deployment status.`);
