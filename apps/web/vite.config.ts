import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { access, readFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";

const allowedHosts = process.env.VITE_ALLOWED_HOSTS?.split(",").filter(Boolean);
const outDir = process.env.VITE_OUT_DIR ?? "dist";
const localRpcTarget = process.env.VITE_PLEDGE_CASH_DEV_RPC_TARGET ?? "http://127.0.0.1:8547";
const localRpcProxy = {
  "/pledge-cash/rpc": {
    target: localRpcTarget,
    changeOrigin: true,
    rewrite: () => "/",
  },
};

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
  plugins: [previewDirectoryIndexPlugin(), deploymentArtifactsPlugin(), react(), tailwindcss()],
  preview: {
    ...(allowedHosts?.length ? { allowedHosts } : {}),
    proxy: localRpcProxy,
  },
  server: {
    ...(allowedHosts?.length ? { allowedHosts } : {}),
    proxy: localRpcProxy,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

export function previewDirectoryIndexRoute(requestUrl: string, base: string, outputRoot: string) {
  if (!base.startsWith("/")) return undefined;

  const basePath = base === "/" ? "/" : `/${base.replace(/^\/+|\/+$/g, "")}/`;
  let url: URL;
  let pathname: string;
  try {
    url = new URL(requestUrl, "http://localhost");
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }

  const docsRoot = `${basePath}docs`;
  if ((pathname !== docsRoot && !pathname.startsWith(`${docsRoot}/`)) || pathname.endsWith("/")) {
    return undefined;
  }
  if (extname(pathname)) return undefined;

  const relativePath = pathname.slice(basePath.length);
  const indexFile = normalize(join(outputRoot, relativePath, "index.html"));
  const relativeIndex = relative(outputRoot, indexFile);
  if (relativeIndex === ".." || relativeIndex.startsWith(`..${sep}`) || isAbsolute(relativeIndex)) {
    return undefined;
  }

  return {
    indexFile,
    rewrittenUrl: `${url.pathname}/${url.search}`,
  };
}

function previewDirectoryIndexPlugin(): Plugin {
  return {
    name: "pledge-cash-preview-directory-index",
    configurePreviewServer(server) {
      const outputRoot = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use(async (request, _response, next) => {
        try {
          if (request.method !== "GET" && request.method !== "HEAD") return;

          const route = previewDirectoryIndexRoute(request.url ?? "/", server.config.base, outputRoot);
          if (!route) return;

          await access(route.indexFile);
          request.url = route.rewrittenUrl;
        } catch {
          // Malformed requests and missing static routes must retain the application fallback.
        } finally {
          next();
        }
      });
    },
  };
}

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
