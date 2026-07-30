import { describe, expect, test } from "bun:test";
import type { PledgeCashDeployment } from "@pledge.cash/sdk";
import {
  resolveRouterDeployment,
  resolveRouterDeploymentRelease,
} from "../src/deployment";

const destinationUsdc =
  "0x00000000000000000000000000000000000000A1" as const;
const executor =
  "0x00000000000000000000000000000000000000B1" as const;
const hash = `0x${"11".repeat(32)}` as const;

function canonicalRelease(
  overrides: Partial<PledgeCashDeployment> = {},
): PledgeCashDeployment {
  return {
    chainId: 998,
    status: "deployed",
    protocolVersion: "pledge.cash.protocol.v1",
    deterministicDeployment: true,
    ammFactory: "0x0000000000000000000000000000000000000011",
    ammFactoryCodeHash: hash,
    ammFactoryOwner: "0x0000000000000000000000000000000000000020",
    ammRouter: "0x0000000000000000000000000000000000000012",
    ammRouterCodeHash: hash,
    ammLiquidityRouter: "0x0000000000000000000000000000000000000012",
    distributionFactory: "0x0000000000000000000000000000000000000013",
    distributionFactoryCodeHash: hash,
    boardroomFactory: "0x0000000000000000000000000000000000000014",
    boardroomFactoryCodeHash: hash,
    boardroomControllerFactory:
      "0x0000000000000000000000000000000000000021",
    boardroomControllerFactoryCodeHash: hash,
    boardroomControllerLogic:
      "0x0000000000000000000000000000000000000022",
    boardroomControllerLogicCodeHash: hash,
    boardroomGovernanceLogic:
      "0x0000000000000000000000000000000000000023",
    boardroomGovernanceLogicCodeHash: hash,
    boardroomMarketLogic:
      "0x0000000000000000000000000000000000000024",
    boardroomMarketLogicCodeHash: hash,
    boardroomRedemptionPayout:
      "0x0000000000000000000000000000000000000025",
    boardroomRedemptionPayoutCodeHash: hash,
    protocolFacetRegistry:
      "0x0000000000000000000000000000000000000015",
    boardroomKernel: "0x0000000000000000000000000000000000000016",
    protocolFacetRegistryOwner:
      "0x0000000000000000000000000000000000000026",
    protocolGovernance:
      "0x0000000000000000000000000000000000000027",
    kernelSelectorSetHash: hash,
    protocolFacetRegistryCodeHash: hash,
    boardroomKernelCodeHash: hash,
    ...overrides,
  };
}

describe("tracked HyperEVM deployment gate", () => {
  test("keeps the unbroadcast tracked artifact disabled", () => {
    expect(
      resolveRouterDeployment({ destinationUsdc, executor }),
    ).toMatchObject({
      ready: false,
    });
  });

  test("resolves only a complete canonical diamond release", () => {
    const release = canonicalRelease();
    const result = resolveRouterDeploymentRelease(release, {
      destinationUsdc,
      executor,
    });
    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error(result.reason);
    expect(result.release).toBe(release);
    expect(result.deployment).toEqual({
      chainId: 998,
      ammFactory: "0x0000000000000000000000000000000000000011",
      ammRouter: "0x0000000000000000000000000000000000000012",
      distributionFactory:
        "0x0000000000000000000000000000000000000013",
      boardroomFactory:
        "0x0000000000000000000000000000000000000014",
      boardroomFactoryCodeHash: hash,
      boardroomControllerFactory:
        "0x0000000000000000000000000000000000000021",
      boardroomControllerFactoryCodeHash: hash,
      boardroomControllerLogic:
        "0x0000000000000000000000000000000000000022",
      boardroomControllerLogicCodeHash: hash,
      boardroomGovernanceLogic:
        "0x0000000000000000000000000000000000000023",
      boardroomGovernanceLogicCodeHash: hash,
      boardroomMarketLogic:
        "0x0000000000000000000000000000000000000024",
      boardroomMarketLogicCodeHash: hash,
      boardroomRedemptionPayout:
        "0x0000000000000000000000000000000000000025",
      boardroomRedemptionPayoutCodeHash: hash,
      protocolFacetRegistry:
        "0x0000000000000000000000000000000000000015",
      protocolFacetRegistryCodeHash: hash,
      protocolFacetRegistryOwner:
        "0x0000000000000000000000000000000000000026",
      protocolGovernance:
        "0x0000000000000000000000000000000000000027",
      boardroomKernel:
        "0x0000000000000000000000000000000000000016",
      boardroomKernelCodeHash: hash,
      kernelSelectorSetHash: hash,
      ammFactoryCodeHash: hash,
      ammFactoryOwner:
        "0x0000000000000000000000000000000000000020",
      ammRouterCodeHash: hash,
      distributionFactoryCodeHash: hash,
      destinationUsdc,
      executor,
    });
  });

  test("keeps registry ceremony ownership independent from protocol governance", () => {
    expect(
      resolveRouterDeploymentRelease(canonicalRelease(), {
        destinationUsdc,
        executor,
      }),
    ).toMatchObject({
      ready: true,
      deployment: {
        protocolFacetRegistryOwner:
          "0x0000000000000000000000000000000000000026",
        protocolGovernance:
          "0x0000000000000000000000000000000000000027",
      },
    });
  });

  test("requires both deployment-era authority fields to be nonzero addresses", () => {
    for (const field of [
      "protocolFacetRegistryOwner",
      "protocolGovernance",
    ] as const) {
      expect(
        resolveRouterDeploymentRelease(
          canonicalRelease({
            [field]: "0x0000000000000000000000000000000000000000",
          }),
          { destinationUsdc, executor },
        ),
      ).toMatchObject({ ready: false });
    }
  });

  test("rejects an otherwise complete release without a permanent-root hash", () => {
    const incomplete = canonicalRelease();
    delete incomplete.boardroomControllerLogicCodeHash;
    expect(
      resolveRouterDeploymentRelease(
        incomplete,
        { destinationUsdc, executor },
      ),
    ).toMatchObject({
      ready: false,
      reason:
        "The tracked HyperEVM deployment is missing canonical permanent-root or marketplace evidence.",
    });
  });
});
