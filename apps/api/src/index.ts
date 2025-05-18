import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { oauth2 } from "elysia-oauth2";
import jwt from "jsonwebtoken";
import { db, orm } from "@repo/db";
import * as schemaImport from "@repo/db/schema";

// Define types for context
const { users } = schemaImport;
type DbType = typeof db;
type OrmType = typeof orm;
type SchemaType = typeof schemaImport;

if (!process.env.TWITTER_CLIENT_ID || !process.env.TWITTER_CLIENT_SECRET) {
  throw new Error("TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET must be set");
}

if (!process.env.COOKIE_SECRET) {
  throw new Error("COOKIE_SECRET must be set for signing cookies and JWTs");
}

const app = new Elysia({
  cookie: {
    secrets: process.env.COOKIE_SECRET,
    sign: ['authToken']
  }
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
  .use(
    oauth2({
      Twitter: [
        process.env.TWITTER_CLIENT_ID, // Replace with your Twitter client ID
        process.env.TWITTER_CLIENT_SECRET, // Replace with your Twitter client secret
        "http://localhost:3000/auth/twitter/callback", // Replace with your callback URL
      ],
    })
  )
  .get("/", () => {
    return { message: "Hello from Elysia!" };
  })
  .get(
    "/auth/twitter",
    async ({ oauth2, redirect }: { oauth2: any; redirect: any }) => {
      const url = await oauth2.createURL("Twitter", [
        "users.read",
        "tweet.read",
        "offline.access",
      ]);
      return redirect(url.href);
    }
  )
  .get(
    "/auth/twitter/callback",
    async ({
      oauth2,
      query,
      cookie,
      set,
      db,
      orm,
      schema
    }: {
      oauth2: any;
      query: {
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
      };
      cookie: any;
      set: any;
      db: DbType;
      orm: OrmType;
      schema: SchemaType;
    }) => {
      if (query.error) {
        console.error(
          "Twitter OAuth error (from query):",
          query.error,
          query.error_description
        );
        return {
          error: "Twitter OAuth failed",
          details: query.error_description || query.error,
        };
      }

      if (!query.code) {
        console.error(
          "Twitter OAuth error: No code provided in callback query."
        );
        return {
          error: "Twitter OAuth failed",
          details: "Authorization code missing.",
        };
      }
      try {
        const tokens = await oauth2.authorize(
          "Twitter",
          query.code as string,
          query.state as string
        ); // Adjust if the library expects different parameters
        const accessToken = tokens.accessToken();

        // Here you would typically use the accessToken to fetch user profile information from Twitter
        // For example:
        const twitterUserResponse = await fetch(
          "https://api.twitter.com/2/users/me",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );
        const twitterUserData = await twitterUserResponse.json();
        console.log(twitterUserData);

        const twitterApiData = twitterUserData.data;

        if (!twitterApiData || typeof twitterApiData.id !== "string") {
          console.error(
            "Twitter user data or ID is missing or invalid in the API response:",
            twitterUserData
          );
          // Throw an error, which will be caught by the surrounding try...catch block
          throw new Error("Twitter user data or ID is missing or invalid.");
        }

        const twitterUserId = twitterApiData.id;
        // Name might be null or not provided by the API, handle undefined
        const twitterUserName = twitterApiData.name as string | undefined;

        let user = await db
          .select()
          .from(schema.users)
          .where(
            orm.and(
              orm.eq(schema.users.oauthProvider, "twitter"),
              orm.eq(schema.users.oauthId, twitterUserId)
            )
          )
          .limit(1)
          .then((rows) => rows[0]);

        const userDbData: any = {
          oauthAccessToken: accessToken,
        };

        if (twitterUserName !== undefined) {
          userDbData.name = twitterUserName; // Update/set name if provided
        }

        console.log(tokens);

        const hasRefreshToken = tokens.hasRefreshToken();
        console.log({ hasRefreshToken });
        if (hasRefreshToken) {
          const refreshToken = tokens.refreshToken();
          console.log({ refreshToken });
          if (refreshToken) userDbData.oauthRefreshToken = refreshToken;
        }

        if (tokens.hasScopes()) {
          const scopeValue = tokens.scopes();
          if (scopeValue) userDbData.oauthScope = scopeValue.join(" ");
        }

        const tokenTypeValue = tokens.tokenType?.();
        if (tokenTypeValue) userDbData.oauthTokenType = tokenTypeValue;

        const expiresInSeconds = tokens.accessTokenExpiresInSeconds();
        const expiresAt = tokens.accessTokenExpiresAt();
        console.log({ expiresInSeconds, expiresAt });

        if (expiresInSeconds) userDbData.oauthExpiresAt = expiresAt;

        console.log(userDbData);

        if (user) {
          // User exists: Update their record (e.g., name, tokens)
          const updatedUsers = await db
            .update(schema.users)
            .set(userDbData) // Set new token info and potentially updated name
            .where(orm.eq(schema.users.id, user.id)) // Use schema.users
            .returning();
          user = updatedUsers[0]; // Drizzle returns an array
          console.log("Existing user updated:", user.id);
        } else {
          // User does not exist: Insert a new record
          const newUsers = await db
            .insert(schema.users)
            .values({
              ...userDbData, // Spread common fields (name, token data)
              oauthProvider: "twitter",
              oauthId: twitterUserId,
            })
            .returning();
          user = newUsers[0]; // Drizzle returns an array
          console.log("New user created:", user.id);
        }

        // Set session cookie with JWT
        if (user && user.id) {
          const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' });
          cookie.authToken.value = token;
          cookie.authToken.set({
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60, // 7 days
            path: '/',
            // secure: process.env.NODE_ENV === 'production', // Enable in production
            sameSite: 'lax'
          });
        } else {
          console.error("User or user.id is undefined, cannot set auth token cookie.");
          // Handle the case where user or user.id is not available
          // Potentially return an error or redirect
        }

        return {
          message: "Twitter OAuth successful!",
          accessToken,
          // twitterUserData
        };
      } catch (error: any) {
        console.error("Twitter OAuth error:", error);
        return { error: "Twitter OAuth failed", details: error.message };
      }
    }
  )
  .get('/me', async ({ cookie, set, db, orm, schema }: { cookie: any; set: any; db: DbType; orm: OrmType; schema: SchemaType; }) => {
    const token = cookie.authToken.value;

    if (!token) {
      set.status = 401;
      return { error: 'Unauthorized: No auth token provided' };
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string; iat: number; exp: number };
      const userId = decoded.userId;

      // Fetch user from DB using the userId from JWT
      const user = await db
        .select()
        .from(schema.users)
        .where(orm.eq(schema.users.id, userId))
        .limit(1)
        .then((rows) => rows[0]);

      if (!user) {
        set.status = 401;
        cookie.authToken.remove(); // Remove invalid token
        return { error: 'Unauthorized: Invalid token or user not found' };
      }

      // Return user data (excluding sensitive info like tokens)
      return {
        id: user.id,
        name: user.name,
        // Add other non-sensitive fields as needed
      };
    } catch (err) {
      set.status = 401;
      cookie.authToken.remove(); // Remove invalid or expired token
      return { error: 'Unauthorized: Invalid or expired token' };
    }
  }, {
    cookie: t.Cookie({
      authToken: t.Optional(t.String())
    })
  })
  .listen(3000);

console.log("Server running on port 3000");
