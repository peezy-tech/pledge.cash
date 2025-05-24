import { Elysia, t, type Context, type Cookie } from "elysia";
import { cors } from "@elysiajs/cors";
import { db, orm } from "@repo/db";
import * as schemaImport from "@repo/db/schema";
import { staticPlugin } from "@elysiajs/static";
import serverManager from "./docker_client";
import { auth_routes, AUTH_TOKEN_COOKIE } from "./auth";

// Define types for context
const { users } = schemaImport;
type DbType = typeof db;
type OrmType = typeof orm;
type SchemaType = typeof schemaImport;

// Define types for the guard
interface GuardJWTPayload {
  walletAddress?: string;
  nonce?: string; // nonce is part of auth_routes' JWT, though not directly used for user lookup here
}

interface GuardAuthJwtInstance {
  verify: (token?: string) => Promise<GuardJWTPayload | null | undefined>;
  // sign is also available but not used by this resolver
}

// Temporarily simplified CurrentUser due to schema issues
// You'll need to ensure schema.users.walletAddress exists and update this
type CurrentUser = {
  walletAddress: string; 
} | undefined;

// This type represents the context *after* the outer guard's resolve has run
// and *within* the scope of the (app) => app.guard(...) callback.
interface ContextWithCurrentUser extends Context { // Extends base Context
  db: DbType; // From .decorate
  orm: OrmType; // From .decorate
  schema: SchemaType; // From .decorate
  [AUTH_TOKEN_COOKIE]: GuardAuthJwtInstance; // From .use(auth_routes)
  currentUser: CurrentUser; // Added by the outer guard's resolve
  // set and cookie should be available via base Context or Elysia's inference
}

const app = new Elysia({
  // Cookie config handled by auth_routes or specific JWT setups
})
  .decorate({
    db,
    orm,
    schema: schemaImport
  })
  .use(
    cors({
      origin: (req) => true,
      methods: ["GET", "PUT", "POST", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", "sec-fetch-site"],
      credentials: true,
    })
  )
  .use(auth_routes)
  .guard(
    {
      // The context 'ctx' for resolve itself is augmented by .decorate and .use(auth_routes)
      async resolve(ctx: Context & { db: DbType; orm: OrmType; schema: SchemaType; [AUTH_TOKEN_COOKIE]: GuardAuthJwtInstance; cookie: Record<typeof AUTH_TOKEN_COOKIE, Cookie<string|undefined>|undefined> & Record<string, Cookie<any>> }): Promise<{ currentUser: CurrentUser }> {
        const { cookie, db, orm, schema, set } = ctx;
        const jwtInstance = ctx[AUTH_TOKEN_COOKIE];
        const tokenValue = cookie[AUTH_TOKEN_COOKIE]?.value;

        if (!tokenValue) {
          return { currentUser: undefined };
        }
        try {
          const payload = await jwtInstance.verify(tokenValue);
          if (!payload || typeof payload.walletAddress !== 'string') {
            if (cookie[AUTH_TOKEN_COOKIE]) cookie[AUTH_TOKEN_COOKIE]?.remove();
            return { currentUser: undefined };
          }
          return { currentUser: { walletAddress: payload.walletAddress } };
        } catch (err) {
          console.error("Guard Resolve Error:", err);
          if (cookie[AUTH_TOKEN_COOKIE]) cookie[AUTH_TOKEN_COOKIE]?.remove();
          return { currentUser: undefined };
        }
      },
      cookie: t.Cookie({
        [AUTH_TOKEN_COOKIE]: t.Optional(t.String())
      })
    },
    // The 'app' parameter here represents Elysia instance with context augmented by the above 'resolve'
    // So, handlers within this scope should have 'currentUser' on their context.
    (app) =>
      app.guard(
        {
          beforeHandle: async (context: ContextWithCurrentUser) => {
            if (!context.currentUser) {
              context.set.status = 401;
              return { error: "Unauthorized: Access denied. Please log in." };
            }
          },
        },
        (appWithAuth) =>
          appWithAuth.get("/protected/user-profile", (context: ContextWithCurrentUser) => {
            return { user: context.currentUser! };
          })
      )
  )
  .use(staticPlugin({ prefix: "/", indexHTML: true }))
  .use(serverManager)
  .listen(3000);

console.log("Server running on port 3000");
