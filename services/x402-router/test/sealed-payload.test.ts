import { describe, expect, test } from "bun:test";
import {
  openOperationPayload,
  sealOperationPayload,
} from "../src/execution/sealed-payload";

const key = `0x${"11".repeat(32)}` as const;

describe("sealed operation payloads", () => {
  test("round-trips signed envelopes without storing plaintext", () => {
    const payload = {
      payment: {
        signature: `0x${"22".repeat(65)}`,
        nonce: 123,
      },
    };
    const sealed = sealOperationPayload(
      key,
      payload,
      Buffer.from("00112233445566778899aabb", "hex"),
    );
    expect(sealed).toStartWith("v1.");
    expect(sealed).not.toContain("signature");
    expect(openOperationPayload<typeof payload>(key, sealed)).toEqual(payload);
  });

  test("rejects tampering and the wrong key", () => {
    const sealed = sealOperationPayload(key, { secret: true });
    expect(() =>
      openOperationPayload(`0x${"33".repeat(32)}`, sealed),
    ).toThrow();
    expect(() =>
      openOperationPayload(key, `${sealed.slice(0, -1)}A`),
    ).toThrow();
  });
});
