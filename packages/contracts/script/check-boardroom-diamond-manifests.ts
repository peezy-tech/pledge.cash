import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifests = [
  {
    path: "docs/design/boardroom-diamond-release-a.md",
    expected:
      "0x42f9307e89ac60cc7fd7c2d98ec0064876f13c0ebfa64aee8fb272f03d600deb",
  },
  {
    path: "docs/design/boardroom-diamond-release-b.md",
    expected:
      "0x480533d1aec981866c51057fe59217f34407bc3b3a2cd963921fcda33f43a5ff",
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
