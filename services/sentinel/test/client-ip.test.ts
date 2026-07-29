import { describe, expect, test } from "bun:test";

import { resolveClientIp } from "../src/client-ip";

describe("Sentinel client IP resolution", () => {
  test("uses the address observed by a trusted HTTPS edge", () => {
    expect(
      resolveClientIp(
        new Headers({
          "X-Forwarded-For": "203.0.113.9, 192.0.2.44"
        }),
        "127.0.0.1",
        ["127.0.0.1"]
      )
    ).toBe("192.0.2.44");
  });

  test("ignores forwarding headers from direct or untrusted peers", () => {
    expect(
      resolveClientIp(
        new Headers({
          "CF-Connecting-IP": "192.0.2.44",
          "X-Forwarded-For": "203.0.113.9"
        }),
        "198.51.100.7",
        ["127.0.0.1"]
      )
    ).toBe("198.51.100.7");
  });

  test("falls back to the trusted peer when its client header is invalid", () => {
    expect(
      resolveClientIp(
        new Headers({ "X-Forwarded-For": "not-an-ip" }),
        "::1",
        ["::1"]
      )
    ).toBe("::1");
  });
});
