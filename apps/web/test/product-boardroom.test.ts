import { describe, expect, test } from "bun:test";
import { readJsonObjectResponse } from "../src/lib/product-boardroom";

describe("product boardroom artifacts", () => {
  test("treats Vite HTML fallback responses as missing JSON artifacts", async () => {
    const response = new Response("<!doctype html><html></html>", {
      headers: { "content-type": "text/html" },
      status: 200,
    });

    await expect(readJsonObjectResponse(response)).resolves.toBeUndefined();
  });

  test("reads JSON artifact responses", async () => {
    const response = new Response('{"chainId":31337}', {
      headers: { "content-type": "application/json" },
      status: 200,
    });

    await expect(readJsonObjectResponse(response)).resolves.toEqual({ chainId: 31337 });
  });
});
