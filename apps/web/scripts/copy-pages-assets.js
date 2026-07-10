import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outDir = process.env.VITE_OUT_DIR ?? "dist";
const appRoutes = [
  "explore",
  "portfolio",
  "projects",
  "studio",
  "settings/alerts",
  "project",
  "boardroom",
  "market",
  "swap",
  "wallet",
  "positions",
  "grants",
  "grant",
  "manage",
  "boardroom-tools",
  "activity",
  "notifications",
  "tools",
  "advanced",
  "direct",
  "discovery",
];

await copyFile("CNAME", join(outDir, "CNAME"));
await copyFile(".nojekyll", join(outDir, ".nojekyll"));
await copyFile(join(outDir, "index.html"), join(outDir, "404.html"));
await copyFile(join(outDir, "favicon.svg"), join(outDir, "favicon.ico"));

for (const route of appRoutes) {
  const routeDir = join(outDir, route);
  await mkdir(routeDir, { recursive: true });
  await copyFile(join(outDir, "index.html"), join(routeDir, "index.html"));
}

const deploymentOutDir = join(outDir, "deployments");
await mkdir(deploymentOutDir, { recursive: true });

const deploymentDir = "../../packages/contracts/deployments";
const deploymentFiles = (await readdir(deploymentDir)).filter((file) => file.endsWith(".json"));
if (deploymentFiles.length === 0) {
  await writeFile(
    join(deploymentOutDir, "998.json"),
    `${JSON.stringify({ status: "pending", reason: "Broadcast artifact not published yet" })}\n`,
  );
} else {
  await Promise.all(
    deploymentFiles.map((file) => copyFile(join(deploymentDir, file), join(deploymentOutDir, file))),
  );
}
