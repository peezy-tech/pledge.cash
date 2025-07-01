import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { migrate } from "@repo/db";
import { staticPlugin } from "@elysiajs/static";
import { auth_routes } from "./auth";
import { hyperliquidRoutes } from "./hyperliquid_routes";

migrate();

const app = new Elysia()
  .use(
    cors({
      origin: () => true,
      methods: ["GET", "PUT", "POST", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", "sec-fetch-site"],
      credentials: true,
    })
  )
  .use(auth_routes)
  .use(hyperliquidRoutes)
  .use(
    staticPlugin({
      prefix: "/",
      alwaysStatic: true,
      indexHTML: true,
    })
  )
  .get("/*", () => Bun.file(`public/index.html`))
  .listen(3000);

export type App = typeof app;
