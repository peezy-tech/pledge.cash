/**
 * Push current branch to a selected remote, open a PR, and tag @codex.
 *
 * Usage examples:
 *   bun scripts/push-pr.ts                    # interactive remote selection
 *   bun scripts/push-pr.ts -r origin          # specify remote
 *   bun scripts/push-pr.ts -r pledge.cash -b main -t "My PR" -m "Body..."
 *   bun scripts/push-pr.ts --draft            # open as draft
 */

import { $ } from "bun";

type Args = {
  remote?: string;
  base?: string;
  title?: string;
  body?: string;
  draft?: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-r":
      case "--remote":
        args.remote = argv[++i];
        break;
      case "-b":
      case "--base":
        args.base = argv[++i];
        break;
      case "-t":
      case "--title":
        args.title = argv[++i];
        break;
      case "-m":
      case "--body":
        args.body = argv[++i];
        break;
      case "-d":
      case "--draft":
        args.draft = true;
        break;
      default:
        // ignore unknown
        break;
    }
  }
  return args;
}

function parseOwnerRepoFromRemoteUrl(url: string): string | null {
  // Supports:
  //  - https://github.com/owner/repo.git
  //  - git@github.com:owner/repo.git
  //  - https://github.com/owner/repo
  const httpsMatch = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`;
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
  if (remotes.length === 1) return remotes[0];
  console.log("Select a remote to push to:");
  remotes.forEach((r, i) => console.log(`  [${i + 1}] ${r}`));
  process.stdout.write("Enter number: ");
  const choice = await new Response(await Bun.stdin.stream().read()).text();
  const n = Number((choice || "").trim());
  if (!Number.isInteger(n) || n < 1 || n > remotes.length) {
    throw new Error("Invalid selection");
  }
  return remotes[n - 1];
}

async function getRemoteRepo(remote: string): Promise<string> {
  const url = (await $`git remote get-url ${remote}`.text()).trim();
  const ownerRepo = parseOwnerRepoFromRemoteUrl(url);
  if (!ownerRepo) throw new Error(`Could not parse owner/repo from remote URL: ${url}`);
  return ownerRepo;
}

async function ensurePushed(remote: string, branch: string) {
  // Try a normal push first; if no upstream, set it.
  const first = await $`git push ${remote} ${branch}`.nothrow();
  if (first.exitCode !== 0) {
    const second = await $`git push --set-upstream ${remote} ${branch}`.nothrow();
    if (second.exitCode !== 0) {
      throw new Error(`Failed to push branch to ${remote}`);
    }
  }
}

async function prExists(repo: string, branch: string): Promise<string | null> {
  const existing = await $`gh pr list --repo ${repo} --head ${branch} --json url --jq '.[0].url'`
    .nothrow()
    .text();
  const url = existing.trim();
  return url || null;
}

async function createPr(repo: string, head: string, base?: string, title?: string, body?: string, draft?: boolean): Promise<string> {
  const args: string[] = ["pr", "create", "--repo", repo, "--head", head];
  if (base) args.push("--base", base);
  if (title) args.push("--title", title);
  if (body) args.push("--body", body);
  if (draft) args.push("--draft");
  // Prefer commit messages if no title/body was passed
  if (!title && !body) args.push("--fill");

  const out = await $`gh ${args}`.text();
  // gh prints the PR URL on the last line typically
  const lines = out.trim().split("\n");
  const url = lines[lines.length - 1];
  if (!url.startsWith("http")) throw new Error(`Unexpected gh output creating PR: ${out}`);
  return url;
}

async function commentOnPr(repo: string, pr: string, body: string) {
  await $`gh pr comment ${pr} --repo ${repo} --body ${body}`.quiet();
}

async function main() {
  const args = parseArgs(process.argv);
  const branch = await getCurrentBranch();
  const remotes = await listRemotes();
  const remote = args.remote || (await pickRemote(remotes));
  const repo = await getRemoteRepo(remote);

  console.log(`Pushing '${branch}' to '${remote}' (${repo})...`);
  await ensurePushed(remote, branch);

  const existing = await prExists(repo, branch);
  const prUrl = existing || (await createPr(repo, branch, args.base || "main", args.title, args.body, !!args.draft));
  console.log(`PR: ${prUrl}`);

  // Tag Codex for review
  await commentOnPr(repo, prUrl, "@codex can you make a code review?");
  console.log("Commented to tag @codex for review.");
}

main().catch((err) => {
  console.error("push-pr failed:", err?.message || err);
  process.exit(1);
});

