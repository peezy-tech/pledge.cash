import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { db, orm, migrate } from "@repo/db";
import * as schemaImport from "@repo/db/schema";
import { staticPlugin } from "@elysiajs/static";
import serverManagerApp, { serverManager } from "./docker_client";
import { auth_routes, AUTH_TOKEN_COOKIE } from "./auth";
import { pool_routes } from "./pool_routes";
import { config_routes } from "./config_routes";
import { pools } from "@repo/db/schema";
import { eq } from "drizzle-orm";

migrate();

const app = new Elysia({
  // Cookie config handled by auth_routes or specific JWT setups
})
  .decorate({
    db,
    orm,
    schema: schemaImport,
    serverManager: serverManager
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
  .post("/game-servers/ensure/:id", async ({ params: { id }, db: currentDb, serverManager: currentSm, set }) => {
    console.log(`[API Index] POST /game-servers/ensure/${id} called`);
    try {
      let gameServer = await currentSm.getGameServer(id);

      if (gameServer && gameServer.status === 'running') {
        console.log(`[API Index] Server ${id} already running:`, gameServer);
        return { success: true, data: gameServer };
      }

      console.log(`[API Index] Server ${id} not running or not found. Attempting to (re)create...`);
      gameServer = await currentSm.createGameServer(id);

      if (gameServer.url) {
        console.log(`[API Index] Updating pool with baseMintAddress ${id} with gameServerUrl: ${gameServer.url}`);
        await currentDb.update(pools)
          .set({ gameServerUrl: gameServer.url })
          .where(eq(pools.baseMintAddress, id))
          .execute();
        console.log(`[API Index] Pool ${id} DB update successful.`);
      } else {
        console.warn(`[API Index] Game server ${id} created but missing URL. DB not updated.`);
      }
      
      console.log(`[API Index] Server ${id} ensured/created:`, gameServer);
      return { success: true, data: gameServer };

    } catch (error) {
      console.error(`[API Index] POST /game-servers/ensure/${id} error:`, error);
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to ensure game server",
      };
    }
  }, {
    params: t.Object({
        id: t.String()
    })
  })
  .guard((appInstance) =>
    appInstance
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
      alwaysStatic: true,
      indexHTML: true,
    })
  )
  .get("/*", () => Bun.file(`public/index.html`))
  .use(serverManagerApp)
  .listen(3000);

export type App = typeof app;

console.log("Server running on port 3000");
