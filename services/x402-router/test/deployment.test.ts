import { describe, expect, test } from "bun:test";
import { resolveRouterDeployment } from "../src/deployment";

describe("tracked HyperEVM deployment gate", () => {
  test("resolves the verified generated 998 artifact", () => {
    const result = resolveRouterDeployment({
      destinationUsdc: "0x00000000000000000000000000000000000000A1",
      executor: "0x00000000000000000000000000000000000000B1",
    });
    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error(result.reason);
    expect(result.release.chainId).toBe(998);
    expect(result.deployment).toEqual({
      chainId: 998,
      ammFactory: "0xF982604BD39834c5459B0C2B37995D7187d09a49",
      ammRouter: "0x302F6b16Ce7fc23fAF8D59C3BD8aF9236aa673Bc",
      distributionFactory: "0xc15a24eE0e281Ca68F29869816E48B57760DDB2F",
      boardroomFactory: "0xd0b2aE6603d7Ae140cd0Cb4Eb4451923C28cAaef",
      destinationUsdc: "0x00000000000000000000000000000000000000A1",
      executor: "0x00000000000000000000000000000000000000B1",
    });
  });
});
