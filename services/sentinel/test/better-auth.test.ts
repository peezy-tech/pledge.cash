import { describe, expect, test } from "bun:test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
  type JWTPayload
} from "jose";

import {
  configuredSocialProviders,
  internalAuthHeaders,
  telegramUserInfo,
  verifyTelegramIdToken
} from "../src/api/better-auth";
import type { Config } from "../src/config";

const CLIENT_ID = "123456789";
const ISSUER = "https://oauth.telegram.org";

describe("Better Auth social providers", () => {
  test("reports configured providers in a stable product order", () => {
    const providers: Config["auth"]["socialProviders"] = {
      apple: { clientId: "apple", clientSecret: "secret" },
      discord: { clientId: "discord", clientSecret: "secret" },
      github: { clientId: "github", clientSecret: "secret" },
      telegram: { clientId: "telegram", clientSecret: "secret" },
      twitter: { clientId: "twitter", clientSecret: "secret" }
    };

    expect(configuredSocialProviders(providers)).toEqual([
      "discord",
      "twitter",
      "telegram",
      "github",
      "apple"
    ]);
  });

  test("forwards only session, origin, agent, and proxy identity into internal auth requests", () => {
    const headers = internalAuthHeaders(
      new Headers({
        Authorization: "Bearer must-not-cross-the-auth-facade",
        "Content-Length": "999",
        Cookie: "pledge-cash.session_token=session",
        Host: "attacker.example",
        Origin: "https://pledge.cash",
        "User-Agent": "PledgeCash test",
        "X-Forwarded-For": "192.0.2.1"
      })
    );

    expect(Object.fromEntries(headers)).toEqual({
      "content-type": "application/json",
      cookie: "pledge-cash.session_token=session",
      origin: "https://pledge.cash",
      "user-agent": "PledgeCash test",
      "x-forwarded-for": "192.0.2.1"
    });
  });

  test("verifies Telegram signatures and maps only pseudonymous identity fields", async () => {
    const fixture = await telegramToken({
      name: "Pledge User",
      picture: "https://example.test/avatar.png",
      preferred_username: "pledger",
      sub: "99887766"
    });

    await expect(verifyTelegramIdToken(fixture.token, CLIENT_ID, fixture.getKey)).resolves.toMatchObject({
      aud: CLIENT_ID,
      iss: ISSUER,
      sub: "99887766"
    });
    await expect(
      telegramUserInfo({ idToken: fixture.token }, CLIENT_ID, fixture.getKey)
    ).resolves.toEqual({
      email:
        "telegram-93df49d8e98074420cccb11a6fd24c9e6a1f617ad811154a74e70496bbc671bf@social.pledge.cash.invalid",
      emailVerified: false,
      id: "99887766",
      image: "https://example.test/avatar.png",
      name: "Pledge User",
      sub: "99887766"
    });
  });

  test("rejects Telegram tokens for another client or without a usable profile", async () => {
    const wrongAudience = await telegramToken({ name: "Pledge User", sub: "99887766" }, "other-client");
    const missingName = await telegramToken({ sub: "99887766" });
    const expired = await telegramToken(
      { name: "Pledge User", sub: "99887766" },
      CLIENT_ID,
      "0s"
    );

    await expect(
      telegramUserInfo({ idToken: wrongAudience.token }, CLIENT_ID, wrongAudience.getKey)
    ).resolves.toBeNull();
    await expect(
      telegramUserInfo({ idToken: missingName.token }, CLIENT_ID, missingName.getKey)
    ).resolves.toBeNull();
    await expect(
      telegramUserInfo({ idToken: expired.token }, CLIENT_ID, expired.getKey)
    ).resolves.toBeNull();
    await expect(telegramUserInfo({}, CLIENT_ID, missingName.getKey)).resolves.toBeNull();
  });
});

async function telegramToken(
  payload: JWTPayload,
  audience = CLIENT_ID,
  expirationTime: string | number | Date = "5m"
): Promise<{ readonly getKey: ReturnType<typeof createLocalJWKSet>; readonly token: string }> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "test-key" };
  const getKey = createLocalJWKSet({ keys: [publicJwk] });
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expirationTime)
    .sign(privateKey);
  return { getKey, token };
}
