import type { ReactNode } from "react";
import type { BoardroomDistributionSnapshot } from "../../lib/types";
import { ReadError } from "./flow-primitives";
import { FixedPriceSaleFlow } from "./fixed-price-sale-flow";
import { BondingCurveFlow } from "./bonding-curve-flow";
import { MerkleAirdropFlow } from "./merkle-airdrop-flow";
import type { ParticipationFlowContext, ParticipationFlowsProps, ParticipationPath } from "./types";

export function ParticipationFlows({
  distribution,
  path,
  ...context
}: ParticipationFlowsProps): React.JSX.Element {
  const selected = distribution ?? findParticipationDistribution(context.dashboard.snapshot.distributionSummaries, path);
  if (!selected) {
    return <ReadError>No {participationPathLabel(path)} contract was discovered for this project.</ReadError>;
  }

  if (path === "fixed-price-sale") return <FixedPriceSaleFlow {...context} distribution={selected} />;
  if (path === "migrating-bonding-curve") return <BondingCurveFlow {...context} distribution={selected} />;
  return <MerkleAirdropFlow {...context} distribution={selected} />;
}

export function createParticipationFlowContent(
  context: ParticipationFlowContext,
): Partial<Record<ParticipationPath, ReactNode>> {
  const paths = (["fixed-price-sale", "migrating-bonding-curve", "merkle-airdrop"] as const)
    .filter((path) => findParticipationDistribution(context.dashboard.snapshot.distributionSummaries, path));
  return Object.fromEntries(paths.map((path) => [path, <ParticipationFlows {...context} key={path} path={path} />]));
}

export function findParticipationDistribution(
  distributions: readonly BoardroomDistributionSnapshot[],
  path: ParticipationPath,
): BoardroomDistributionSnapshot | undefined {
  const matching = distributions.filter((distribution) => distribution.kind === path);
  return matching.find(isActiveDistribution) ?? matching[0];
}

function isActiveDistribution(distribution: BoardroomDistributionSnapshot): boolean {
  const state = distribution.state;
  if (!state || state.closed) return false;
  if (distribution.kind === "fixed-price-sale" && "saleStatus" in state) return state.saleStatus === 0;
  if (distribution.kind === "migrating-bonding-curve" && "curveStatus" in state) return state.curveStatus === 0;
  if (distribution.kind === "merkle-airdrop" && "airdropStatus" in state) return state.airdropStatus === 0;
  return false;
}

function participationPathLabel(path: ParticipationPath): string {
  if (path === "fixed-price-sale") return "fixed-price sale";
  if (path === "migrating-bonding-curve") return "bonding curve";
  return "airdrop";
}

