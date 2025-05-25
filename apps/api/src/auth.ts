import { Elysia, Context, t, RouteSchema } from "elysia";

import jwt from "@elysiajs/jwt";
import { Cookie, UnwrapSchema } from "elysia";

import crypto from 'crypto'
import bs58 from 'bs58'
import nacl from 'tweetnacl'

export const generateNonce = () => crypto.randomBytes(32).toString('hex')

export const verifySolanaSignature = (signature: string, message: string, walletAddress: string) => {
  const publicKey = bs58.decode(walletAddress)
  const messageBytes = new TextEncoder().encode(message)
  const signatureBytes = bs58.decode(signature)
  return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey)
}

export const AUTH_TOKEN_COOKIE = "auth_token" as const;
const COOKIE_SECRET = "foo";

// Define a type for the JWT payload
interface AuthJWTPayload {
  walletAddress?: string;
  nonce?: string;
}

// Define a type for the context decorated by the JWT plugin
interface AuthContext {
  [AUTH_TOKEN_COOKIE]: {
    sign: (payload: AuthJWTPayload) => Promise<string>;
    verify: (token?: string) => Promise<AuthJWTPayload | null | undefined>;
  };
  cookie: {
    [AUTH_TOKEN_COOKIE]: Cookie<string | undefined>;
  };
  set: Context['set'];
  body?: any; // For POST requests, define more specifically if needed
}

const cookieSchema = t.Cookie({
  [AUTH_TOKEN_COOKIE]: t.Optional(t.String()),
});

export const auth_routes = new Elysia()
  .use(
    jwt({
      name: AUTH_TOKEN_COOKIE,
      secret: COOKIE_SECRET,
      schema: t.Object({
        walletAddress: t.Optional(t.String()),
        nonce: t.Optional(t.String()),
      })
    })
  )
  .get(AUTH_TOKEN_COOKIE, async ({ [AUTH_TOKEN_COOKIE]: auth, set, cookie }: AuthContext) => {
    const authTokenCookie = cookie[AUTH_TOKEN_COOKIE];
    const profile = await auth.verify(authTokenCookie?.value);

    if (!profile || !profile?.walletAddress) {
      return { walletAddress: null };
    }

    return profile;
  })
  .put(
    AUTH_TOKEN_COOKIE,
    async ({ [AUTH_TOKEN_COOKIE]: auth, set, cookie }: AuthContext) => {
      const authTokenCookie = cookie[AUTH_TOKEN_COOKIE];
      const profile = await auth.verify(authTokenCookie?.value);

      if (!profile || (!profile?.nonce && !profile?.walletAddress)) {
        const nonce = generateNonce();

        authTokenCookie.set({
          value: await auth.sign({ nonce }),
          httpOnly: true,
          maxAge: 7 * 86400,
          path: '/',
        });

        return { nonce };
      }

      return { auth: profile };
    },
    {
      cookie: cookieSchema,
    }
  )
  .post(
    AUTH_TOKEN_COOKIE,
    async ({ [AUTH_TOKEN_COOKIE]: auth, set, cookie, body }: AuthContext & { body: { signature: string; message: string; walletAddress: string; } }) => {
      const authTokenCookie = cookie[AUTH_TOKEN_COOKIE];
      const profile = await auth.verify(authTokenCookie?.value);

      if (!profile || !profile.nonce) {
        set.status = 401;
        return { msg: "Unauthorized" };
      }

      const { message, signature, walletAddress } = body;

      try {
        const isValid = verifySolanaSignature(signature, message, walletAddress);

        if (!isValid) {
          authTokenCookie.remove();
          set.status = 422;
          return { error: "INVALID SIGNATURE" };
        }

        authTokenCookie.set({
          value: await auth.sign({
            walletAddress: walletAddress,
          }),
          httpOnly: true,
          maxAge: 7 * 86400,
          path: '/',
        });

        return { success: true };
      } catch (error) {
        switch (error) {
          default:
            set.status = 400;
            return "Bad Request";
        }
      }
    },
    {
      body: t.Object({
        signature: t.String(),
        message: t.String(),
        walletAddress: t.String(),
      }),
    }
  )
  .delete(AUTH_TOKEN_COOKIE, async ({ [AUTH_TOKEN_COOKIE]: auth, set, cookie }: AuthContext) => {
    const authTokenCookie = cookie[AUTH_TOKEN_COOKIE];
    const profile = await auth.verify(authTokenCookie?.value);

    if (!profile) {
      set.status = 401;
      return { msg: "Unauthorized" };
    }

    authTokenCookie.remove();

    return { success: true };
  });


// export const server = new Elysia()
//   .use(auth_routes)
//   .guard({}, (app) =>
//     app
//       .resolve(async ({ set, cookie, [AUTH_TOKEN_COOKIE]: auth }) => {
//         const authTokenCookie = cookie[AUTH_TOKEN_COOKIE];
//         const profile = await auth.verify(authTokenCookie.value);
//         return {
//           walletAddress: profile ? profile.walletAddress as string : undefined,
//           actor: {
//             address: "0x0",
//             chainId: 0,
//             world: "0x0",
//           },
//         };
//       })
//       .guard(
//         {
//           beforeHandle: async ({ walletAddress, set }) => {
//             if (!walletAddress) return (set.status = "Unauthorized");
//           },
//         },
//         (app) =>
//           app
//             .get("foo", ({ walletAddress }) => ({ walletAddress }) => {
//               return { walletAddress };
//             })

//       )
//   );

// export type Server = typeof server;
