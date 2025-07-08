import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { auth_routes } from "../src/auth";
import { hyperliquidRoutes } from "../src/hyperliquid_routes";

/**
 * Creates a clean Elysia app instance for testing
 * This excludes database migrations and WebSocket initialization
 * to avoid side effects during testing
 */
export function createTestApp() {
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
    .get("/*", () => new Response("Test HTML", { 
      headers: { "Content-Type": "text/html" } 
    }));

  return app;
}

export type TestApp = ReturnType<typeof createTestApp>; 