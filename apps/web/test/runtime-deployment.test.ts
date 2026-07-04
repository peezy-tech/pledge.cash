import { describe, expect, test } from "bun:test";
import { isRuntimeDeploymentForChain } from "../src/hooks/use-runtime-deployment";
import { parseDeployment } from "../src/lib/deployment";

describe("runtime deployment artifacts", () => {
  test("accepts status-only placeholders for the requested deployment path", () => {
    const deployment = parseDeployment('{"status":"pending","reason":"Broadcast artifact not published yet"}');

    expect(isRuntimeDeploymentForChain(deployment, 998)).toBe(true);
  });

  test("rejects chain-specific artifacts from a different chain", () => {
    const deployment = parseDeployment('{"chainId":998,"tokenGrantFactory":"0x1000000000000000000000000000000000000000"}');

    expect(isRuntimeDeploymentForChain(deployment, 10143)).toBe(false);
  });
});
