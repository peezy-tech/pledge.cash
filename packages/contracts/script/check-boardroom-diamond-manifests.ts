import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifests = [
  {
    path: "docs/design/boardroom-diamond-release-a.md",
    expected:
      "0x8c199ca4a93cc6a29d722c2ce418a72bd7176687a477b13d66cb1f750fa3d224",
  },
  {
    path: "docs/design/boardroom-diamond-release-b.md",
    expected:
      "0x505052ba0730f40bbbd440574f00a3d707a9d604ae74b6bfe0f91ac45c02dd0e",
  },
] as const;

const repoRoot = resolve(import.meta.dir, "../../..");
for (const manifest of manifests) {
  const contents = await readFile(resolve(repoRoot, manifest.path));
  const process = Bun.spawn(["cast", "keccak", `0x${contents.toString("hex")}`], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const actual = (await new Response(process.stdout).text()).trim();
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`cast keccak failed for ${manifest.path} with exit code ${exitCode}`);
  }
  if (actual !== manifest.expected) {
    throw new Error(`${manifest.path}: expected ${manifest.expected}, received ${actual}`);
  }
}

console.log("Boardroom diamond manifest hashes match their human-readable specifications.");
