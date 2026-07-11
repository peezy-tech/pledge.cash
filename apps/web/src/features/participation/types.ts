import type { Address } from "@pledge.cash/sdk";
import type { PublicClient } from "viem";
import type { ProductBoardroomDashboardState } from "../../lib/product-boardroom";
import type { BoardroomDistributionSnapshot } from "../../lib/types";
import type { TransactionActionGuard } from "../../lib/transaction-identity";

export type ParticipationPath = "fixed-price-sale" | "migrating-bonding-curve" | "merkle-airdrop";
export type ParticipationRoutePath = ParticipationPath | "amm";
export type DistributionParticipationKey = `${ParticipationPath}:${Address}`;
export type AmmParticipationKey = `amm:${Address}`;
export type ParticipationContentKey = ParticipationRoutePath | DistributionParticipationKey | AmmParticipationKey;

export function participationDistributionKey(
  path: ParticipationPath,
  address: Address,
): DistributionParticipationKey {
  return `${path}:${address.toLowerCase()}` as DistributionParticipationKey;
}

export function participationAmmKey(address: Address): AmmParticipationKey {
  return `amm:${address.toLowerCase()}` as AmmParticipationKey;
}

export function participationPathFromContentKey(key: ParticipationContentKey): ParticipationRoutePath {
  if (key === "amm" || key.startsWith("amm:")) return "amm";
  if (key.startsWith("fixed-price-sale")) return "fixed-price-sale";
  if (key.startsWith("migrating-bonding-curve")) return "migrating-bonding-curve";
  return "merkle-airdrop";
}

export type RunParticipationAction = (
  label: string,
  action: () => Promise<void>,
) => Promise<void>;

export type SubmitParticipationTransaction = (
  label: string,
  request: Record<string, unknown>,
  guard?: TransactionActionGuard | undefined,
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
