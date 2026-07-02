import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

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
  plugins: [react(), tailwindcss()],
  ...(allowedHosts?.length ? { preview: { allowedHosts }, server: { allowedHosts } } : {}),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
