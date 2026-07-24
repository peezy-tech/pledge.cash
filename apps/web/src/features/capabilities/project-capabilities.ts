import type { Address } from "@pledge.cash/sdk";

export type CapabilityStatus = "enabled" | "connect" | "switch" | "blocked" | "hidden";

export type ProjectCapability =
  | "participate.bond.purchase"
  | "participate.dutchAuction.buy"
  | "participate.fixedSale.buy"
  | "participate.curve.buy"
  | "participate.curve.sell"
  | "participate.airdrop.claim"
  | "participate.airdrop.claimGrant"
  | "participate.amm.swap"
  | "grant.settle"
  | "grant.halt"
  | "studio.mint"
  | "studio.createGrant"
  | "studio.createDistribution"
  | "studio.manageLiquidity"
  | "governance.launch"
  | "governance.schedule"
  | "governance.veto"
  | "governance.executeReady"
  | "windDown.start"
  | "windDown.registerAsset"
  | "windDown.beginSnapshot"
  | "windDown.processSnapshot"
  | "windDown.openRedemptions"
  | "redemption.redeem";

export type Capability = {
  status: CapabilityStatus;
  reason?: string | undefined;
};

export type CapabilityOpportunity = {
  available: boolean;
  reason?: string | undefined;
};

export type ProjectCapabilityContext = {
  account?: Address | undefined;
  routeChainId: number;
  walletChainId?: number | undefined;
  project?: {
    owner: Address;
    proposer: Address;
    launched: boolean;
    status: "active" | "winding-down" | "snapshotting" | "redemptions-open" | "closed";
    launchReady?: boolean | undefined;
    launchBlockedReason?: string | undefined;
    windDownBlockers?: number | undefined;
    snapshotComplete?: boolean | undefined;
  } | undefined;
  wallet?: {
    shareBalance?: bigint | undefined;
    vetoEligible?: boolean | undefined;
    windDownEligible?: boolean | undefined;
  } | undefined;
  governance?: {
    scheduledOperationCount?: number | undefined;
    readyActionCount?: number | undefined;
  } | undefined;
  opportunities?: Partial<Record<OpportunityCapability, CapabilityOpportunity>> | undefined;
};

export type ProjectCapabilityMap = Record<ProjectCapability, Capability>;

export type OpportunityCapability = Extract<
  ProjectCapability,
  | `participate.${string}`
  | "grant.settle"
  | "grant.halt"
>;

const PROJECT_CAPABILITIES: ProjectCapability[] = [
  "participate.bond.purchase",
  "participate.dutchAuction.buy",
  "participate.fixedSale.buy",
  "participate.curve.buy",
  "participate.curve.sell",
  "participate.airdrop.claim",
  "participate.airdrop.claimGrant",
  "participate.amm.swap",
  "grant.settle",
  "grant.halt",
  "studio.mint",
  "studio.createGrant",
  "studio.createDistribution",
  "studio.manageLiquidity",
  "governance.launch",
  "governance.schedule",
  "governance.veto",
  "governance.executeReady",
  "windDown.start",
  "windDown.registerAsset",
  "windDown.beginSnapshot",
  "windDown.processSnapshot",
  "windDown.openRedemptions",
  "redemption.redeem",
];

const OPPORTUNITY_CAPABILITIES: OpportunityCapability[] = [
  "participate.bond.purchase",
  "participate.dutchAuction.buy",
  "participate.fixedSale.buy",
  "participate.curve.buy",
  "participate.curve.sell",
  "participate.airdrop.claim",
  "participate.airdrop.claimGrant",
  "participate.amm.swap",
  "grant.settle",
  "grant.halt",
];

export function resolveProjectCapabilities(context: ProjectCapabilityContext): ProjectCapabilityMap {
  const capabilities = emptyCapabilityMap();

  for (const key of OPPORTUNITY_CAPABILITIES) {
    capabilities[key] = opportunityCapability(context, context.opportunities?.[key]);
  }

  const project = context.project;
  if (!project) {
    return blockProjectCapabilities(capabilities, "Project state is still loading.");
  }

  const active = project.status === "active";
  const ownerAuthority = !project.launched && sameAddress(context.account, project.owner);
  const proposerAuthority = project.launched && sameAddress(context.account, project.proposer);

  for (const key of ["studio.mint", "studio.createGrant", "studio.createDistribution", "studio.manageLiquidity"] as const) {
    if (!active) {
      capabilities[key] = blocked("This action is only available while the project is active.");
    } else {
      capabilities[key] = authorityCapability(
        context,
        ownerAuthority || proposerAuthority,
        project.launched ? "Only the controller proposer can schedule this change." : "Only the project owner can make this change before launch.",
      );
    }
  }

  capabilities["governance.launch"] = launchCapability(context);
  capabilities["governance.schedule"] = project.launched && active
    ? authorityCapability(context, proposerAuthority, "Only the controller proposer can schedule a governance operation.")
    : hidden();

  const scheduledOperationCount = context.governance?.scheduledOperationCount ?? 0;
  capabilities["governance.veto"] = project.launched && active && scheduledOperationCount > 0
    ? authorityCapability(context, context.wallet?.vetoEligible === true, "This wallet does not have enough eligible governance power to veto.")
    : hidden();

  const readyActionCount = context.governance?.readyActionCount ?? 0;
  capabilities["governance.executeReady"] = project.launched && readyActionCount > 0
    ? walletGate(context)
    : hidden();

  capabilities["windDown.start"] = windDownStartCapability(context);

  const windingDown = project.status === "winding-down";
  if (windingDown && !project.launched) {
    capabilities["windDown.registerAsset"] = authorityCapability(
      context,
      ownerAuthority,
      "Only the project owner can manage wind-down assets before launch.",
    );
  } else {
    capabilities["windDown.registerAsset"] = hidden();
  }

  capabilities["windDown.beginSnapshot"] = windingDown
    ? (project.windDownBlockers ?? 0) === 0
      ? walletGate(context)
      : blocked("Every active obligation and protocol-liquidity reservation must close before snapshotting.")
    : hidden();
  const snapshotting = project.status === "snapshotting";
  capabilities["windDown.processSnapshot"] = snapshotting && project.snapshotComplete !== true
    ? walletGate(context)
    : hidden();
  capabilities["windDown.openRedemptions"] = snapshotting && project.snapshotComplete === true
    ? walletGate(context)
    : hidden();

  capabilities["redemption.redeem"] = redemptionCapability(context);
  return capabilities;
}

export function capabilityAllowsAction(capability: Capability): boolean {
  return capability.status === "enabled";
}

export function capabilityNeedsWalletAction(capability: Capability): capability is Capability & { status: "connect" | "switch" } {
  return capability.status === "connect" || capability.status === "switch";
}

function emptyCapabilityMap(): ProjectCapabilityMap {
  return Object.fromEntries(PROJECT_CAPABILITIES.map((key) => [key, hidden()])) as ProjectCapabilityMap;
}

function blockProjectCapabilities(capabilities: ProjectCapabilityMap, reason: string): ProjectCapabilityMap {
  for (const key of PROJECT_CAPABILITIES) {
    if (capabilities[key].status !== "hidden" || !OPPORTUNITY_CAPABILITIES.includes(key as OpportunityCapability)) {
      capabilities[key] = blocked(reason);
    }
  }
  return capabilities;
}

function opportunityCapability(
  context: ProjectCapabilityContext,
  opportunity: CapabilityOpportunity | undefined,
): Capability {
  if (!opportunity) return hidden();
  if (!opportunity.available) return blocked(opportunity.reason ?? "This action is not available right now.");
  return walletGate(context);
}

function launchCapability(context: ProjectCapabilityContext): Capability {
  const project = context.project;
  if (!project || project.launched || project.status !== "active") return hidden();
  const wallet = walletGate(context);
  if (wallet.status !== "enabled") return wallet;
  if (!sameAddress(context.account, project.owner)) return blocked("Only the project owner can launch governance.");
  if (project.launchReady === false) {
    return blocked(project.launchBlockedReason ?? "Complete the launch readiness checks first.");
  }
  return enabled();
}

function windDownStartCapability(context: ProjectCapabilityContext): Capability {
  const project = context.project;
  if (!project || project.status !== "active") return hidden();
  const wallet = walletGate(context);
  if (wallet.status !== "enabled") return wallet;
  if (project.launched) {
    return context.wallet?.windDownEligible
      ? enabled()
      : blocked("This wallet does not have enough eligible governance power to start wind-down.");
  }
  return sameAddress(context.account, project.owner)
    ? enabled()
    : blocked("Only the project owner can start wind-down before launch.");
}

function redemptionCapability(context: ProjectCapabilityContext): Capability {
  if (context.project?.status !== "redemptions-open") return hidden();
  const wallet = walletGate(context);
  if (wallet.status !== "enabled") return wallet;
  return (context.wallet?.shareBalance ?? 0n) > 0n
    ? enabled()
    : blocked("This wallet has no project shares to redeem.");
}

function authorityCapability(
  context: ProjectCapabilityContext,
  authorized: boolean,
  unauthorizedReason: string,
): Capability {
  const wallet = walletGate(context);
  if (wallet.status !== "enabled") return wallet;
  return authorized ? enabled() : blocked(unauthorizedReason);
}

function walletGate(context: ProjectCapabilityContext): Capability {
  if (!context.account) return { status: "connect", reason: "Connect a wallet to continue." };
  if (context.walletChainId !== context.routeChainId) {
    return { status: "switch", reason: `Switch your wallet to chain ${context.routeChainId.toString()} to continue.` };
  }
  return enabled();
}

function sameAddress(first: Address | undefined, second: Address | undefined): boolean {
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase());
}

function enabled(): Capability {
  return { status: "enabled" };
}

function blocked(reason: string): Capability {
  return { status: "blocked", reason };
}

function hidden(): Capability {
  return { status: "hidden" };
}
