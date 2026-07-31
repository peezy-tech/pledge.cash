import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { docsRedirects } from "../redirects.js";
import config from "../tome.config.js";

const root = dirname(fileURLToPath(import.meta.url));
const docsRoot = dirname(root);
const repoRoot = dirname(docsRoot);
const pagesRoot = join(docsRoot, "pages");
const deploymentsRoot = join(repoRoot, "packages", "contracts", "deployments");
const appRoutes = new Set(["explore", "portfolio", "settings/alerts", "studio", "tools"]);
const safeExternalSchemes = new Set(["http", "https", "mailto"]);

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
    || /^[a-z][a-z\d+.-]*:/i.test(target);
}

function canonicalPageRoute(page) {
  if (page === "index") return "/";
  if (page.endsWith("/index")) return `/${page.slice(0, -6)}`;
  return `/${page}`;
}

function resolvePageLink(fromPage, target, filePages) {
  const cleaned = cleanTarget(target);
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(target)?.[1]?.toLocaleLowerCase();
  if (target.startsWith("//") || (scheme && !safeExternalSchemes.has(scheme))) {
    return { kind: "unsafe-scheme", candidate: scheme ?? "protocol-relative" };
  }
  if (isExternalTarget(target) || cleaned === "") return { kind: "skip" };

  const docsBase = normalizedDocsBase();
  if (cleaned.startsWith("/")) {
    if (docsBase && (cleaned === docsBase || cleaned.startsWith(`${docsBase}/`))) {
      return { kind: "hardcoded-base" };
    }
    const candidate = cleaned.replace(/^\/+|\/+$/g, "").replace(/\.md$/, "") || "index";
    if (appRoutes.has(candidate)) return { kind: "hardcoded-app-handoff", candidate };
    const roots = new Set([...filePages].map((page) => page.split("/", 1)[0]));
    return filePages.has(candidate) || roots.has(candidate.split("/", 1)[0])
      ? { kind: "hardcoded-base" }
      : { kind: "invalid-absolute", candidate };
  }

  // Tome renders source hrefs unchanged, so validate them against each page's
  // canonical browser URL rather than the Markdown file's filesystem directory.
  // The synthetic base preserves root-relative app handoffs when docs are built
  // at `/` while keeping the same resolution behavior as nested deployments.
  const validationBase = docsBase || "/__docs__";
  const fromRoute = canonicalPageRoute(fromPage);
  const destination = new URL(cleaned, `https://pledge-docs.invalid${validationBase}${fromRoute}`);
  const insideDocs = destination.pathname === validationBase
    || destination.pathname.startsWith(`${validationBase}/`);

  if (insideDocs) {
    let route = destination.pathname.slice(validationBase.length) || "/";
    if (route.length > 1) route = route.replace(/\/+$/, "");
    const routes = new Map([...filePages].map((page) => [canonicalPageRoute(page), page]));
    const candidate = routes.get(route);
    return candidate
      ? { kind: "ok" }
      : { kind: "missing", candidate: route.replace(/^\/+/, "") || "index" };
  }

  const candidate = destination.pathname.replace(/^\/+|\/+$/g, "");
  return appRoutes.has(candidate)
    ? { kind: "app-handoff", candidate }
    : { kind: "invalid-app-handoff", candidate };
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

for (const [from, to] of Object.entries(docsRedirects)) {
  if (!/^[a-z0-9/-]+$/.test(from) || !/^[a-z0-9/-]+$/.test(to)) {
    errors.push(`Invalid compatibility redirect: ${from} -> ${to}`);
  }
  if (filePages.has(from)) errors.push(`Compatibility redirect still has a source page: ${from}`);
  if (!filePages.has(to)) errors.push(`Compatibility redirect points to a missing page: ${from} -> ${to}`);
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
    } else if (result.kind === "invalid-app-handoff") {
      errors.push(`${page}:${lineNumber(source, index)} links to an unknown or escaping app route ${result.candidate} (${target})`);
    } else if (result.kind === "hardcoded-app-handoff") {
      errors.push(`${page}:${lineNumber(source, index)} hard-codes app route ${target}; use a relative handoff so every deployed base path works`);
    } else if (result.kind === "invalid-absolute") {
      errors.push(`${page}:${lineNumber(source, index)} links to unsupported absolute route ${target}`);
    } else if (result.kind === "unsafe-scheme") {
      errors.push(`${page}:${lineNumber(source, index)} uses unsafe or unsupported link scheme ${result.candidate} (${target})`);
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
