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

  test("preserves permanent module-policy identity fields", () => {
    const deployment = parseDeployment(`{
      "chainId": 998,
      "tokenGrantModulePolicy": true,
      "distributionModulePolicy": false,
      "lockedLiquidityModulePolicy": true
    }`);

    expect(deployment.tokenGrantModulePolicy).toBe(true);
    expect(deployment.distributionModulePolicy).toBe(false);
    expect(deployment.lockedLiquidityModulePolicy).toBe(true);
  });

  test("preserves Boardroom implementation and helper roots", () => {
    const deployment = parseDeployment(`{
      "chainId": 998,
      "boardroomGovernanceLogic": "0x1000000000000000000000000000000000000001",
      "boardroomRedemptionPayout": "0x1000000000000000000000000000000000000002",
      "boardroomLogic": "0x1000000000000000000000000000000000000003"
    }`);

    expect(deployment.boardroomGovernanceLogic).toBe("0x1000000000000000000000000000000000000001");
    expect(deployment.boardroomRedemptionPayout).toBe("0x1000000000000000000000000000000000000002");
    expect(deployment.boardroomLogic).toBe("0x1000000000000000000000000000000000000003");
  });
});
