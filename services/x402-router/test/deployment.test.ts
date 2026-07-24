import { describe, expect, test } from "bun:test";
import { resolveRouterDeployment } from "../src/deployment";

describe("tracked HyperEVM deployment gate", () => {
  test("fails closed while the generated 998 artifact is pending", () => {
    const result = resolveRouterDeployment({
      destinationUsdc: "0x00000000000000000000000000000000000000A1",
      executor: "0x00000000000000000000000000000000000000B1",
    });
    expect(result.ready).toBe(false);
    if (result.ready) throw new Error("expected pending deployment");
    expect(result.reason).toContain("not been broadcast");
    expect(result.release?.chainId).toBe(998);
  });
});
