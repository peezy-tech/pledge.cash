import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { db, orm, migrate } from "@repo/db";
import * as schemaImport from "@repo/db/schema";
import { staticPlugin } from "@elysiajs/static";
import serverManager from "./docker_client";
import { auth_routes, AUTH_TOKEN_COOKIE } from "./auth";
import { pool_routes } from "./pool_routes";
import { config_routes } from "./config_routes";

migrate();

const app = new Elysia({
  // Cookie config handled by auth_routes or specific JWT setups
})
  .decorate({
    db,
    orm,
    schema: schemaImport,
  })
  .use(
    cors({
      origin: () => true,
      methods: ["GET", "PUT", "POST", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", "sec-fetch-site"],
      credentials: true,
    })
  )
  .use(auth_routes)
  .guard((app) =>
    app
      .resolve(async (ctx) => {
        const { cookie } = ctx;
        const jwtInstance = ctx[AUTH_TOKEN_COOKIE];
        const tokenValue = cookie[AUTH_TOKEN_COOKIE]?.value;

        if (!tokenValue) {
          return { currentUser: undefined };
        }
        try {
          const payload = await jwtInstance.verify(tokenValue);
          if (!payload || typeof payload.walletAddress !== "string") {
            if (cookie[AUTH_TOKEN_COOKIE]) cookie[AUTH_TOKEN_COOKIE]?.remove();
            return { currentUser: undefined };
          }
          return { currentUser: { walletAddress: payload.walletAddress } };
        } catch (err) {
          console.error("Guard Resolve Error:", err);
          if (cookie[AUTH_TOKEN_COOKIE]) cookie[AUTH_TOKEN_COOKIE]?.remove();
          return { currentUser: undefined };
        }
      })
      .onBeforeHandle(async (context) => {
        if (!context.currentUser) {
          context.set.status = 401;
          return { error: "Unauthorized: Access denied. Please log in." };
        }
      })
      .get("/protected/user-profile", (context) => {
        return { user: context.currentUser };
      })
      .use(pool_routes)
      .use(config_routes)
  )
  .use(
    staticPlugin({
      prefix: "/",
      indexHTML: true,
      alwaysStatic: true,
      assets: "./public",
    })
  )
  .use(serverManager)
  .listen(3000);

export type App = typeof app;

console.log("Server running on port 3000");
