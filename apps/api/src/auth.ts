import { Elysia, t } from "elysia";

import jwt from "@elysiajs/jwt";

import crypto from "crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { db, orm } from "@repo/db";
import { users } from "@repo/db/schema";

export const generateNonce = () => crypto.randomBytes(32).toString("hex");

export const verifySolanaSignature = (
  signature: string,
  message: string,
  walletAddress: string
) => {
  const publicKey = bs58.decode(walletAddress);
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = bs58.decode(signature);
  return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
};

export const AUTH_TOKEN_COOKIE = "auth_token" as const;
const COOKIE_SECRET = "foo";

const cookieSchema = t.Cookie({
  [AUTH_TOKEN_COOKIE]: t.Optional(t.String()),
});

export const auth_routes = new Elysia({ name: "auth" })
  .use(
    jwt({
      name: AUTH_TOKEN_COOKIE,
      secret: COOKIE_SECRET,
      schema: t.Object({
        walletAddress: t.Optional(t.String()),
        nonce: t.Optional(t.String()),
      }),
    })
  )
  .get(
    AUTH_TOKEN_COOKIE,
    async ({ [AUTH_TOKEN_COOKIE]: auth, cookie }) => {
      const authTokenCookie = cookie[AUTH_TOKEN_COOKIE];
      const profile = await auth.verify(authTokenCookie?.value);

      if (!profile || !profile?.walletAddress) {
        return { walletAddress: null };
      }

      return profile;
    }
  )
  .put(
    AUTH_TOKEN_COOKIE,
    async ({ [AUTH_TOKEN_COOKIE]: auth, cookie }) => {
      const authTokenCookie = cookie[AUTH_TOKEN_COOKIE];
      const profile = await auth.verify(authTokenCookie?.value);

      if (!profile || (!profile?.nonce && !profile?.walletAddress)) {
        const nonce = generateNonce();

        authTokenCookie.set({
          value: await auth.sign({ nonce }),
          httpOnly: true,
          maxAge: 7 * 86400,
          path: "/",
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
    async ({ [AUTH_TOKEN_COOKIE]: auth, set, cookie, body }) => {
      const authTokenCookie = cookie[AUTH_TOKEN_COOKIE];
      const profile = await auth.verify(authTokenCookie?.value);

      if (!profile || !profile.nonce) {
        set.status = 401;
        return { msg: "Unauthorized" };
      }

      const { message, signature, walletAddress } = body;

      try {
        const isValid = verifySolanaSignature(
          signature,
          message,
          walletAddress
        );

        if (!isValid) {
          authTokenCookie.remove();
          set.status = 422;
          return { error: "INVALID SIGNATURE" };
        }

        const user = await db
          .select()
          .from(users)
          .where(orm.eq(users.solana_account, walletAddress))
          .then((result) => result[0]);

        if (!user) {
          await db.insert(users).values({
            solana_account: walletAddress,
          });
        }

        authTokenCookie.set({
          value: await auth.sign({
            walletAddress: walletAddress,
          }),
          httpOnly: true,
          maxAge: 7 * 86400,
          path: "/",
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
  .delete(
    AUTH_TOKEN_COOKIE,
    async ({ [AUTH_TOKEN_COOKIE]: auth, set, cookie }) => {
      const authTokenCookie = cookie[AUTH_TOKEN_COOKIE];
      const profile = await auth.verify(authTokenCookie?.value);

      if (!profile) {
        set.status = 401;
        return { msg: "Unauthorized" };
      }

      authTokenCookie.remove();

      return { success: true };
    }
  );
