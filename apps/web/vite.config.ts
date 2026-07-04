import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { access, readFile } from "node:fs/promises";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";

const allowedHosts = process.env.VITE_ALLOWED_HOSTS?.split(",").filter(Boolean);
const outDir = process.env.VITE_OUT_DIR ?? "dist";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  build: {
    outDir,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          viem: ["viem"],
        },
      },
    },
  },
  plugins: [deploymentArtifactsPlugin(), react(), tailwindcss()],
  ...(allowedHosts?.length ? { preview: { allowedHosts }, server: { allowedHosts } } : {}),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

function deploymentArtifactsPlugin(): Plugin {
  const deploymentDir = fileURLToPath(new URL("../../packages/contracts/deployments", import.meta.url));

  return {
    name: "pledge-cash-deployment-artifacts",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        try {
          const url = new URL(request.url ?? "/", "http://localhost");
          const base = server.config.base === "/" ? "/" : server.config.base;
          const basePath = base.endsWith("/") ? base : `${base}/`;
          const path = url.pathname.startsWith(basePath) ? `/${url.pathname.slice(basePath.length)}` : url.pathname;
          const match = /^\/deployments\/([^/]+\.json)$/.exec(path);
          if (!match) {
            next();
            return;
          }

          const name = match[1]!;
          if (extname(name) !== ".json") {
            next();
            return;
          }

          const filePath = normalize(join(deploymentDir, name));
          if (relative(deploymentDir, filePath).startsWith("..")) {
            next();
            return;
          }

          await access(filePath);
          const body = await readFile(filePath, "utf8");
          response.statusCode = 200;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.end(body);
        } catch {
          next();
        }
      });
    },
  };
}
