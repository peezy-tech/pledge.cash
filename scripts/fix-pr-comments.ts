/**
 * Fetch all UNRESOLVED review comments for the PR associated with the
 * current branch on a given remote, and for each comment run:
 *   codex exec "{COMMENT_BODY}" --full-auto
 * Save each run's output under logs/codex-comment-<id>.log
 *
 * Usage:
 *   bun scripts/fix-pr-comments.ts -r <remote>
 *   bun scripts/fix-pr-comments.ts              # interactive remote selection
 */

import { $ } from "bun";
import { mkdir, writeFile, appendFile } from "fs/promises";

type ThreadComment = {
  id: string;
  body: string;
  url: string;
  path?: string | null;
  author?: { login: string } | null;
};

function parseOwnerRepoFromRemoteUrl(url: string): string | null {
  try {
    if (url.startsWith("http")) {
      const u = new URL(url);
      // pathname like "/owner/repo.git" or "/owner/repo"
      const parts = u.pathname.replace(/^\/+/, "").replace(/\.git$/, "").split("/");
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    }
  } catch {}
  // git@github.com:owner/repo.git OR github.com:owner/repo
  const scp = url.match(/github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (scp) return `${scp[1]}/${scp[2]}`;
  // fallback broad regex
  const generic = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
  if (generic) return `${generic[1]}/${generic[2]}`;
  return null;
}

async function getCurrentBranch(): Promise<string> {
  return (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
}

async function listRemotes(): Promise<string[]> {
  const out = await $`git remote`.text();
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

async function pickRemote(remotes: string[]): Promise<string> {
  if (remotes.includes("pledge.cash")) return "pledge.cash";
  if (remotes.includes("origin")) return "origin";
  if (remotes.length >= 1) return remotes[0];
  throw new Error("No git remotes configured");
}

async function getOwnerRepoFromRemote(remote: string): Promise<string> {
  const url = (await $`git remote get-url ${remote}`.text()).trim();
  const ownerRepo = parseOwnerRepoFromRemoteUrl(url);
  if (!ownerRepo) throw new Error(`Could not parse owner/repo from: ${url}`);
  return ownerRepo;
}

async function getPrNumber(repo: string, branch: string): Promise<number> {
  const n = (await $`gh pr list --repo ${repo} --head ${branch} --json number --jq '.[0].number'`.text()).trim();
  if (!n) throw new Error(`No PR found in ${repo} for branch ${branch}`);
  return Number(n);
}

async function fetchUnresolvedComments(repo: string, prNumber: number): Promise<ThreadComment[]> {
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) {
            nodes {
              isResolved
              comments(first: 100) {
                nodes { id body url path author { login } }
              }
            }
          }
        }
      }
    }
  `;

  const [owner, name] = repo.split("/");
  const res = await $`gh api graphql -f query=${query} -F owner=${owner} -F name=${name} -F number=${prNumber}`.json();
  const nodes = res?.data?.repository?.pullRequest?.reviewThreads?.nodes || [];
  const comments: ThreadComment[] = [];
  for (const t of nodes) {
    if (t?.isResolved) continue; // only unresolved
    if (t?.comments?.nodes) {
      for (const c of t.comments.nodes) {
        comments.push({ id: c.id, body: c.body, url: c.url, path: c.path, author: c.author });
      }
    }
  }
  return comments;
}

async function ensureLogsDir(): Promise<string> {
  const dir = "logs";
  await mkdir(dir, { recursive: true });
  return dir;
}

async function runCodexOnComment(prompt: string, filePath: string) {
  const header = `\n===== Codex run: ${new Date().toISOString()} =====\n`;
  await appendFile(filePath, header).catch(async () => {
    await writeFile(filePath, header);
  });
  const out = await $`codex exec ${prompt} --full-auto`.nothrow();
  const text = [out.stdout?.toString?.() || "", out.stderr?.toString?.() || ""].join("");
  await appendFile(filePath, text);
}

async function main() {
  const argv = process.argv.slice(2);
  let remote: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-r" || argv[i] === "--remote") {
      remote = argv[++i];
    }
  }

  const remotes = await listRemotes();
  const chosenRemote = remote || (await pickRemote(remotes));
  const repo = await getOwnerRepoFromRemote(chosenRemote);
  const branch = await getCurrentBranch();
  const prNumber = await getPrNumber(repo, branch);
  console.log(`Repo: ${repo}  PR: #${prNumber}  Branch: ${branch}`);

  const comments = await fetchUnresolvedComments(repo, prNumber);
  if (!comments.length) {
    console.log("No unresolved review comments found.");
    return;
  }

  const dir = await ensureLogsDir();
  for (const c of comments) {
    const shortId = c.id.split("/").pop() || c.id;
    const file = `${dir}/codex-comment-${shortId}.log`;
    const meta = `# Comment ${c.id}\n# Author: ${c.author?.login || "unknown"}\n# Path: ${c.path || "(n/a)"}\n# URL: ${c.url}\n\n`;
    await writeFile(file, meta);
    console.log(`Running Codex for comment ${shortId} -> ${file}`);
    await runCodexOnComment(c.body, file);
  }

  console.log("Done. Logs saved under ./logs/");
}

main().catch((err) => {
  console.error("fix-pr-comments failed:", err?.message || err);
  console.error(err)
  process.exit(1);
});
