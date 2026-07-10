import type { Address } from "@pledge.cash/sdk";
import type { PublicClient } from "viem";
import type { ProductBoardroomDashboardState } from "../../lib/product-boardroom";
import type { BoardroomDistributionSnapshot } from "../../lib/types";

export type ParticipationPath = "fixed-price-sale" | "migrating-bonding-curve" | "merkle-airdrop";

export type RunParticipationAction = (
  label: string,
  action: () => Promise<void>,
) => Promise<void>;

export type SubmitParticipationTransaction = (
  label: string,
  request: Record<string, unknown>,
) => Promise<unknown>;

export type ParticipationFlowContext = {
  account: Address | undefined;
  dashboard: ProductBoardroomDashboardState;
  pendingAction: string | undefined;
  publicClient: PublicClient;
  runAction: RunParticipationAction;
  submitTransaction: SubmitParticipationTransaction;
};

export type ParticipationFlowsProps = ParticipationFlowContext & {
  distribution?: BoardroomDistributionSnapshot | undefined;
  path: ParticipationPath;
};

