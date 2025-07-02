import { Elysia, t } from "elysia";
import jwt from "@elysiajs/jwt";
import { SiweMessage, generateNonce, SiweErrorType } from "siwe";
import { db, orm } from "@repo/db";
import { users } from "@repo/db/schema";

export const SIWE_COOKIE_NAME = "siwe" as const;
const COOKIE_SECRET = "foo";

const cookieSchema = t.Cookie({
  [SIWE_COOKIE_NAME]: t.Optional(t.String()),
});

export const auth_routes = new Elysia({ name: "auth" })
  .use(
    jwt({
      name: SIWE_COOKIE_NAME,
      secret: COOKIE_SECRET,
      schema: t.Object({
        address: t.Optional(t.TemplateLiteral("0x${string}")),
        nonce: t.Optional(t.String()),
      }),
    })
  )
  .get(SIWE_COOKIE_NAME, async ({ [SIWE_COOKIE_NAME]: siweAuth, cookie }) => {
    const authTokenCookie = cookie[SIWE_COOKIE_NAME];
    const profile = await siweAuth.verify(authTokenCookie?.value);

    if (!profile || !profile?.address) {
      return { address: null };
    }

    return profile;
  })
  .put(
    SIWE_COOKIE_NAME,
    async ({ [SIWE_COOKIE_NAME]: siweAuth, cookie }) => {
      const authTokenCookie = cookie[SIWE_COOKIE_NAME];
      const profile = await siweAuth.verify(authTokenCookie?.value);

      if (!profile || (!profile?.nonce && !profile?.address)) {
        const nonce = generateNonce();

        authTokenCookie.set({
          value: await siweAuth.sign({ nonce }),
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
    SIWE_COOKIE_NAME,
    async ({ [SIWE_COOKIE_NAME]: siweAuth, set, cookie, body }) => {
      const authTokenCookie = cookie[SIWE_COOKIE_NAME];
      const profile = await siweAuth.verify(authTokenCookie?.value);

      if (!profile || !profile.nonce) {
        set.status = 401;
        return { msg: "Unauthorized" };
      }

      const { message, signature } = body;

      try {
        const siweMessage = new SiweMessage(message);
        const { data: fields } = await siweMessage.verify({
          signature,
          nonce: profile.nonce,
        });

        if (fields.nonce !== profile.nonce) {
          authTokenCookie.remove();
          set.status = 422;
          return { error: "INVALID NONCE" };
        }

        const ethAddress = fields.address as `0x${string}`;

        const user = await db
          .select()
          .from(users)
          .where(orm.eq(users.evm_address, ethAddress))
          .then((result) => result[0]);

        if (!user) {
          await db.insert(users).values({
            evm_address: ethAddress,
          });
        }

        authTokenCookie.set({
          value: await siweAuth.sign({
            address: ethAddress,
          }),
          httpOnly: true,
          maxAge: 7 * 86400,
          path: "/",
        });

        return { success: true };
      } catch (error: any) {
        authTokenCookie.remove();
        switch (error) {
          case SiweErrorType.EXPIRED_MESSAGE:
            set.status = 401;
            return { error: "EXPIRED_MESSAGE", message: error.message };
          case SiweErrorType.INVALID_SIGNATURE:
            set.status = 422;
            return { error: "INVALID_SIGNATURE", message: error.message };
          case SiweErrorType.INVALID_NONCE:
            set.status = 422;
            return { error: "INVALID_NONCE", message: error.message };
          default:
            if (
              error &&
              error.message &&
              Object.values(SiweErrorType).includes(
                error.message as SiweErrorType
              )
            ) {
              set.status = 422;
              return { error: error.message };
            }
            set.status = 400;
            return {
              error: "BAD_REQUEST",
              message: "An unexpected error occurred.",
            };
        }
      }
    },
    {
      body: t.Object({
        signature: t.String(),
        message: t.Union([
          t.String(),
          t.Object({
            domain: t.String(),
            address: t.String(),
            statement: t.Optional(t.String()),
            uri: t.String(),
            version: t.String(),
            chainId: t.Number(),
            nonce: t.String(),
            issuedAt: t.String(),
            expirationTime: t.Optional(t.String()),
            notBefore: t.Optional(t.String()),
            requestId: t.Optional(t.String()),
            resources: t.Optional(t.Array(t.String())),
          }),
        ]),
      }),
      cookie: cookieSchema,
    }
  )
  .delete(
    SIWE_COOKIE_NAME,
    async ({ [SIWE_COOKIE_NAME]: siweAuth, set, cookie }) => {
      const authTokenCookie = cookie[SIWE_COOKIE_NAME];
      const profile = await siweAuth.verify(authTokenCookie?.value);

      if (!profile) {
        set.status = 401;
        return { msg: "Unauthorized" };
      }

      authTokenCookie.remove();

      return { success: true };
    }
  )
  .derive({ as: "global" }, async (ctx) => {
    const { cookie } = ctx;
    const jwtInstance = ctx[SIWE_COOKIE_NAME];
    const tokenValue = cookie[SIWE_COOKIE_NAME]?.value;

    if (!tokenValue) {
      return { currentUser: undefined };
    }
    try {
      const payload = await jwtInstance.verify(tokenValue);
      if (!payload || typeof payload.address !== "string") {
        if (cookie[SIWE_COOKIE_NAME]) cookie[SIWE_COOKIE_NAME]?.remove();
        return { currentUser: undefined };
      }
      const user = await db
        .select()
        .from(users)
        .where(orm.eq(users.evm_address, payload.address))
        .then((result) => result[0]);
      return { currentUser: { walletAddress: payload.address, id: user?.id } };
    } catch (err) {
      console.error("deriving error:", err);
      if (cookie[SIWE_COOKIE_NAME]) cookie[SIWE_COOKIE_NAME]?.remove();
      return { currentUser: undefined };
    }
  });
