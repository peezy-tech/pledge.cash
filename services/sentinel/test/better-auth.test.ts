import { describe, expect, test } from "bun:test";

import { internalAuthHeaders } from "../src/api/better-auth";

describe("shared Identity request boundary", () => {
  test("forwards only trusted session context and the resolved client IP", () => {
    const headers = internalAuthHeaders(
      new Headers({
        Authorization: "Bearer must-not-cross-the-auth-facade",
        "Cf-Connecting-Ip": "192.0.2.2",
        "Content-Length": "999",
        Cookie: "pledge-cash.session_token=session",
        Host: "attacker.example",
        Origin: "https://pledge.cash",
        "True-Client-Ip": "192.0.2.3",
        "User-Agent": "PledgeCash test",
        "X-Forwarded-For": "192.0.2.1",
        "X-Real-Ip": "192.0.2.4"
      }),
      "198.51.100.7"
    );

    expect(Object.fromEntries(headers)).toEqual({
      "content-type": "application/json",
      cookie: "pledge-cash.session_token=session",
      origin: "https://pledge.cash",
      "user-agent": "PledgeCash test",
      "x-forwarded-for": "198.51.100.7"
    });
    expect(
      internalAuthHeaders(
        new Headers({ "X-Forwarded-For": "192.0.2.1" })
      ).has("x-forwarded-for")
    ).toBe(false);
  });
});
