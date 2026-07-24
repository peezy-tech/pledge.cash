import {
  getPledgeCashDeployment,
  type PledgeCashDeployment,
} from "@pledge.cash/sdk";
import type { Address } from "viem";
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
    !release.ammFactory ||
    !release.ammRouter ||
    !release.distributionFactory ||
    !release.boardroomFactory
  ) {
    return {
      ready: false,
      reason:
        "The tracked HyperEVM deployment is missing AMM or distribution addresses.",
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
      ammRouter: release.ammRouter,
      distributionFactory: release.distributionFactory,
      boardroomFactory: release.boardroomFactory,
      destinationUsdc: input.destinationUsdc,
      executor: input.executor,
    },
    release,
  };
}
