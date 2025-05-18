import { defineConfig } from "drizzle-kit";
import path from "path";

const DB_PATH = `${
  process.env.DB_PATH
    ? path.resolve(__dirname, process.env.DB_PATH)
    : __dirname
}/${process.env.DB_NAME ?? "sqlite.db"}`;

export default defineConfig({
  out: "./drizzle",
  dialect: "sqlite",
  schema: "./schema.ts",
  dbCredentials: {
    url: `file:${DB_PATH}`,
  },
});
