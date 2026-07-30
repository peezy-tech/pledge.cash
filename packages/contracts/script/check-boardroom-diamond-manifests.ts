import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifests = [
  {
    path: "docs/design/boardroom-diamond-release-a.md",
    expected:
      "0x49203191b8b3958946efa6e4da2562dc1a9af4c7a75855751c8abd05505025ab",
  },
  {
    path: "docs/design/boardroom-diamond-release-b.md",
    expected:
      "0xe50a0e6d677c939d5767190157bb3955f3da8fe3ebb86400077e3a99ff659934",
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
