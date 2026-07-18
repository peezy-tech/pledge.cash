import { describe, expect, test } from "bun:test";
import { isRuntimeDeploymentForChain } from "../src/hooks/use-runtime-deployment";
import { deploymentRuntimeIdentity, parseDeployment } from "../src/lib/deployment";

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
      "bondMarketModulePolicy": true,
      "lockedLiquidityModulePolicy": true
    }`);

    expect(deployment.tokenGrantModulePolicy).toBe(true);
    expect(deployment.distributionModulePolicy).toBe(false);
    expect(deployment.bondMarketModulePolicy).toBe(true);
    expect(deployment.lockedLiquidityModulePolicy).toBe(true);
  });

  test("preserves bond-market deployment provenance", () => {
    const deployment = parseDeployment(`{
      "chainId": 998,
      "bondMarketFactory": "0x1000000000000000000000000000000000000001",
      "bondMarketLogic": "0x1000000000000000000000000000000000000002",
      "assetBondMarketSpenderAllowed": true,
      "bondMarketFactoryCodeHash": "0xabc123"
    }`);

    expect(deployment.bondMarketFactory).toBe("0x1000000000000000000000000000000000000001");
    expect(deployment.bondMarketLogic).toBe("0x1000000000000000000000000000000000000002");
    expect(deployment.assetBondMarketSpenderAllowed).toBe(true);
    expect(deployment.bondMarketFactoryCodeHash).toBe("0xabc123");
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

  test("uses every write-critical artifact value in the runtime identity", () => {
    const base = {
      chainId: 998,
      boardroomFactory: "0x1000000000000000000000000000000000000001" as const,
      tokenGrantFactory: "0x1000000000000000000000000000000000000002" as const,
      ammRouter: "0x1000000000000000000000000000000000000003" as const,
      assetPolicy: "0x1000000000000000000000000000000000000004" as const,
      wrappedNative: "0x1000000000000000000000000000000000000005" as const,
      creationFee: 1n,
    };
    const identity = deploymentRuntimeIdentity(base);

    expect(deploymentRuntimeIdentity({ ...base, ammRouter: "0x2000000000000000000000000000000000000003" })).not.toBe(identity);
    expect(deploymentRuntimeIdentity({ ...base, assetPolicy: "0x2000000000000000000000000000000000000004" })).not.toBe(identity);
    expect(deploymentRuntimeIdentity({ ...base, wrappedNative: "0x2000000000000000000000000000000000000005" })).not.toBe(identity);
    expect(deploymentRuntimeIdentity({ ...base, creationFee: 2n })).not.toBe(identity);
  });

  test("keeps runtime identity stable across artifact property order", () => {
    expect(deploymentRuntimeIdentity({
      chainId: 998,
      creationFee: 5n,
      ammRouter: "0x1000000000000000000000000000000000000003",
    })).toBe(deploymentRuntimeIdentity({
      ammRouter: "0x1000000000000000000000000000000000000003",
      creationFee: 5n,
      chainId: 998,
    }));
  });

  test("preserves deterministic provenance and code hashes from runtime artifacts", () => {
    const deployment = parseDeployment(`{
      "chainId": 998,
      "deterministicDeployment": true,
      "deterministicDeploymentVersion": "v2",
      "deterministicDeployer": "0x1000000000000000000000000000000000000001",
      "create2Factory": "0x1000000000000000000000000000000000000002",
      "ammRouterCodeHash": "0xabc123"
    }`);

    expect(deployment.deterministicDeployment).toBe(true);
    expect(deployment.deterministicDeploymentVersion).toBe("v2");
    expect(deployment.deterministicDeployer).toBe("0x1000000000000000000000000000000000000001");
    expect(deployment.create2Factory).toBe("0x1000000000000000000000000000000000000002");
    expect(deployment.ammRouterCodeHash).toBe("0xabc123");
  });
});
