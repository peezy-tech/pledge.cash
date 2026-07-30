import {
  getPledgeCashDeployment,
  type PledgeCashDeployment,
} from "@pledge.cash/sdk";
import { isAddress, zeroAddress, type Address, type Hex } from "viem";
import type { CanonicalMarketplaceDeployment } from "./quotes/canonical";

export type RouterDeploymentResolution =
  | {
      ready: true;
      deployment: CanonicalMarketplaceDeployment;
      release: PledgeCashDeployment;
    }
  | {
      ready: false;
      reason: string;
      release: PledgeCashDeployment | undefined;
    };

export function resolveRouterDeployment(input: {
  destinationUsdc: Address;
  executor: Address;
}): RouterDeploymentResolution {
  const release = getPledgeCashDeployment(998);
  return resolveRouterDeploymentRelease(release, input);
}

export function resolveRouterDeploymentRelease(
  release: PledgeCashDeployment | undefined,
  input: {
    destinationUsdc: Address;
    executor: Address;
  },
): RouterDeploymentResolution {
  if (!release) {
    return {
      ready: false,
      reason: "No tracked Pledge deployment exists for HyperEVM testnet.",
      release,
    };
  }
  if (release.status === "pending") {
    return {
      ready: false,
      reason:
        release.reason ??
        "The tracked HyperEVM testnet deployment is still pending.",
      release,
    };
  }
  if (
    release.protocolVersion !== "pledge.cash.protocol.v1" ||
    release.deterministicDeployment !== true ||
    !release.ammFactory ||
    !isBytes32(release.ammFactoryCodeHash) ||
    !release.ammFactoryOwner ||
    !release.ammRouter ||
    !isBytes32(release.ammRouterCodeHash) ||
    !release.distributionFactory ||
    !isBytes32(release.distributionFactoryCodeHash) ||
    !release.boardroomFactory ||
    !isBytes32(release.boardroomFactoryCodeHash) ||
    !release.boardroomControllerFactory ||
    !isBytes32(release.boardroomControllerFactoryCodeHash) ||
    !release.boardroomControllerLogic ||
    !isBytes32(release.boardroomControllerLogicCodeHash) ||
    !release.boardroomGovernanceLogic ||
    !isBytes32(release.boardroomGovernanceLogicCodeHash) ||
    !release.boardroomMarketLogic ||
    !isBytes32(release.boardroomMarketLogicCodeHash) ||
    !release.boardroomRedemptionPayout ||
    !isBytes32(release.boardroomRedemptionPayoutCodeHash) ||
    !release.protocolFacetRegistry ||
    !isBytes32(release.protocolFacetRegistryCodeHash) ||
    !isNonzeroAddress(release.protocolFacetRegistryOwner) ||
    !isNonzeroAddress(release.protocolGovernance) ||
    !release.boardroomKernel ||
    !isBytes32(release.boardroomKernelCodeHash) ||
    !isBytes32(release.kernelSelectorSetHash)
  ) {
    return {
      ready: false,
      reason:
        "The tracked HyperEVM deployment is missing canonical permanent-root or marketplace evidence.",
      release,
    };
  }
  if (
    release.ammLiquidityRouter &&
    release.ammLiquidityRouter.toLowerCase() !==
      release.ammRouter.toLowerCase()
  ) {
    return {
      ready: false,
      reason:
        "The tracked AMM liquidity router does not match the canonical AMM router.",
      release,
    };
  }

  return {
    ready: true,
    deployment: {
      chainId: 998,
      ammFactory: release.ammFactory,
      ammFactoryCodeHash: release.ammFactoryCodeHash as Hex,
      ammFactoryOwner: release.ammFactoryOwner,
      ammRouter: release.ammRouter,
      ammRouterCodeHash: release.ammRouterCodeHash as Hex,
      distributionFactory: release.distributionFactory,
      distributionFactoryCodeHash: release.distributionFactoryCodeHash as Hex,
      boardroomFactory: release.boardroomFactory,
      boardroomFactoryCodeHash: release.boardroomFactoryCodeHash as Hex,
      boardroomControllerFactory: release.boardroomControllerFactory,
      boardroomControllerFactoryCodeHash:
        release.boardroomControllerFactoryCodeHash as Hex,
      boardroomControllerLogic: release.boardroomControllerLogic,
      boardroomControllerLogicCodeHash:
        release.boardroomControllerLogicCodeHash as Hex,
      boardroomGovernanceLogic: release.boardroomGovernanceLogic,
      boardroomGovernanceLogicCodeHash:
        release.boardroomGovernanceLogicCodeHash as Hex,
      boardroomMarketLogic: release.boardroomMarketLogic,
      boardroomMarketLogicCodeHash:
        release.boardroomMarketLogicCodeHash as Hex,
      boardroomRedemptionPayout: release.boardroomRedemptionPayout,
      boardroomRedemptionPayoutCodeHash:
        release.boardroomRedemptionPayoutCodeHash as Hex,
      boardroomKernel: release.boardroomKernel,
      boardroomKernelCodeHash: release.boardroomKernelCodeHash as Hex,
      protocolFacetRegistry: release.protocolFacetRegistry,
      protocolFacetRegistryCodeHash:
        release.protocolFacetRegistryCodeHash as Hex,
      protocolFacetRegistryOwner: release.protocolFacetRegistryOwner,
      protocolGovernance: release.protocolGovernance,
      kernelSelectorSetHash: release.kernelSelectorSetHash as Hex,
      destinationUsdc: input.destinationUsdc,
      executor: input.executor,
    },
    release,
  };
}

function isBytes32(value: string | undefined): value is Hex {
  return value !== undefined && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isNonzeroAddress(value: string | undefined): value is Address {
  return value !== undefined && isAddress(value) && value.toLowerCase() !== zeroAddress;
}
