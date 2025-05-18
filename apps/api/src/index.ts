import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { oauth2 } from "elysia-oauth2";

if (!process.env.TWITTER_CLIENT_ID || !process.env.TWITTER_CLIENT_SECRET) {
  throw new Error("TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET must be set");
}

const app = new Elysia()
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
      ]);
      return redirect(url.href);
    }
  )
  .get(
    "/auth/twitter/callback",
    async ({
      oauth2,
      query,
    }: {
      oauth2: any;
      query: {
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
      };
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
      // The 'query' parameter might be needed depending on how elysia-oauth2 handles Twitter's response.
      // Typically, code and state are in query params for OAuth2.
      // The library might handle this internally when calling authorize.
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
  .listen(3000);

console.log("Server running on port 3000");
