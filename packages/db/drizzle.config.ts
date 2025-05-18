import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  dialect: "sqlite",
  schema: "./schema.ts",
  dbCredentials: {
    url: "file:local.db",
  },
});
