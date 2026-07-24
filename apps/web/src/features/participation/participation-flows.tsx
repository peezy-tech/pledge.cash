import type { ReactNode } from "react";
import type { BoardroomDistributionSnapshot } from "../../lib/types";
import { ReadError } from "./flow-primitives";
import { DutchAuctionFlow } from "./dutch-auction-flow";
import { FixedPriceSaleFlow } from "./fixed-price-sale-flow";
import { BondingCurveFlow } from "./bonding-curve-flow";
import { MerkleAirdropFlow } from "./merkle-airdrop-flow";
import { BondMarketFlow } from "./bond-market-flow";
import {
  participationDistributionKey,
  type ParticipationContentKey,
  type ParticipationFlowContext,
  type ParticipationFlowsProps,
  type ParticipationPath,
} from "./types";

export function ParticipationFlows({
  distribution,
  path,
  ...context
}: ParticipationFlowsProps): React.JSX.Element {
  const selected = distribution ?? findParticipationDistribution(context.dashboard.snapshot.distributionSummaries, path);
  if (!selected) {
    return <ReadError>No {participationPathLabel(path)} contract was discovered for this project.</ReadError>;
  }

  if (path === "bond-market") return <BondMarketFlow {...context} distribution={selected} />;
  if (path === "dutch-auction") return <DutchAuctionFlow {...context} distribution={selected} />;
  if (path === "fixed-price-sale") return <FixedPriceSaleFlow {...context} distribution={selected} />;
  if (path === "migrating-bonding-curve") return <BondingCurveFlow {...context} distribution={selected} />;
  return <MerkleAirdropFlow {...context} distribution={selected} />;
}

export function createParticipationFlowContent(
  context: ParticipationFlowContext,
): Partial<Record<ParticipationContentKey, ReactNode>> {
  const entries = context.dashboard.snapshot.distributionSummaries.flatMap((distribution) => {
    if (!isParticipationPath(distribution.kind)) return [];
    const key = participationDistributionKey(distribution.kind, distribution.address);
    return [[key, (
      <ParticipationFlows
        {...context}
        distribution={distribution}
        key={key}
        path={distribution.kind}
      />
    )] as const];
  });
  return Object.fromEntries(entries) as Partial<Record<ParticipationContentKey, ReactNode>>;
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
  if (distribution.kind === "bond-market" && "live" in state) return state.live && state.capacity > 0n;
  if (distribution.kind === "dutch-auction" && "saleStatus" in state) return state.saleStatus === 0;
  if (distribution.kind === "fixed-price-sale" && "saleStatus" in state) return state.saleStatus === 0;
  if (distribution.kind === "migrating-bonding-curve" && "curveStatus" in state) return state.curveStatus === 0;
  if (distribution.kind === "merkle-airdrop" && "airdropStatus" in state) return state.airdropStatus === 0;
  return false;
}

function isParticipationPath(kind: BoardroomDistributionSnapshot["kind"]): kind is ParticipationPath {
  return kind === "bond-market" || kind === "dutch-auction" || kind === "fixed-price-sale" || kind === "migrating-bonding-curve" || kind === "merkle-airdrop";
}

function participationPathLabel(path: ParticipationPath): string {
  if (path === "bond-market") return "bond market";
  if (path === "dutch-auction") return "Dutch auction";
  if (path === "fixed-price-sale") return "fixed-price sale";
  if (path === "migrating-bonding-curve") return "bonding curve";
  return "airdrop";
}
