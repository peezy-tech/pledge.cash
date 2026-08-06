import type { Address } from "@pledge.cash/sdk";

export type CapabilityStatus = "enabled" | "connect" | "switch" | "blocked" | "hidden";

export type ProjectCapability =
  | "swap.execute"
  | "grant.settle"
  | "grant.halt"
  | "studio.mint"
  | "studio.createGrant"
  | "studio.manageLiquidity"
  | "liquidity.collectFees"
  | "liquidity.exit"
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
    status: "active" | "winding-down" | "snapshotting" | "redemptions-open";
    windDownBlockers?: number | undefined;
    windDownMatured?: boolean | undefined;
    snapshotComplete?: boolean | undefined;
  } | undefined;
  wallet?: {
    shareBalance?: bigint | undefined;
  } | undefined;
  opportunities?: Partial<Record<OpportunityCapability, CapabilityOpportunity>> | undefined;
};

export type ProjectCapabilityMap = Record<ProjectCapability, Capability>;

export type OpportunityCapability = Extract<
  ProjectCapability,
  "swap.execute" | "grant.settle" | "grant.halt"
>;

const PROJECT_CAPABILITIES: ProjectCapability[] = [
  "swap.execute",
  "grant.settle",
  "grant.halt",
  "studio.mint",
  "studio.createGrant",
  "studio.manageLiquidity",
  "liquidity.collectFees",
  "liquidity.exit",
  "windDown.start",
  "windDown.registerAsset",
  "windDown.beginSnapshot",
  "windDown.processSnapshot",
  "windDown.openRedemptions",
  "redemption.redeem",
];

const OPPORTUNITY_CAPABILITIES: OpportunityCapability[] = ["swap.execute", "grant.settle", "grant.halt"];

export function resolveProjectCapabilities(context: ProjectCapabilityContext): ProjectCapabilityMap {
  const capabilities = emptyCapabilityMap();
  for (const key of OPPORTUNITY_CAPABILITIES) {
    capabilities[key] = opportunityCapability(context, context.opportunities?.[key]);
  }

  const project = context.project;
  if (!project) return blockProjectCapabilities(capabilities, "Boardroom state is still loading.");

  const owner = sameAddress(context.account, project.owner);
  const active = project.status === "active";
  for (const key of ["studio.mint", "studio.createGrant", "studio.manageLiquidity"] as const) {
    capabilities[key] = active
      ? authorityCapability(context, owner, "Only the Boardroom owner can perform this action.")
      : hidden();
  }

  capabilities["liquidity.collectFees"] = project.status === "active" || project.status === "winding-down"
    ? walletGate(context)
    : hidden();
  capabilities["liquidity.exit"] = project.status === "winding-down"
    ? authorityCapability(context, owner, "Only the Boardroom owner can exit locked liquidity.")
    : hidden();
  capabilities["windDown.start"] = active
    ? authorityCapability(context, owner, "Only the Boardroom owner can start wind-down.")
    : hidden();
  capabilities["windDown.registerAsset"] = project.status === "active" || project.status === "winding-down"
    ? authorityCapability(context, owner, "Only the Boardroom owner can register a redemption asset.")
    : hidden();

  const windingDown = project.status === "winding-down";
  capabilities["windDown.beginSnapshot"] = windingDown
    ? (project.windDownBlockers ?? 0) > 0
      ? blocked("Close every grant and liquidity obligation before snapshotting.")
      : project.windDownMatured === false
        ? blocked("The Boardroom wind-down delay has not elapsed.")
        : walletGate(context)
    : hidden();
  capabilities["windDown.processSnapshot"] = project.status === "snapshotting" && project.snapshotComplete !== true
    ? walletGate(context)
    : hidden();
  capabilities["windDown.openRedemptions"] = project.status === "snapshotting" && project.snapshotComplete === true
    ? walletGate(context)
    : hidden();
  capabilities["redemption.redeem"] = project.status === "redemptions-open"
    ? (context.wallet?.shareBalance ?? 0n) > 0n
      ? walletGate(context)
      : blocked("This wallet has no Boardroom shares to redeem.")
    : hidden();

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
    if (!OPPORTUNITY_CAPABILITIES.includes(key as OpportunityCapability) || capabilities[key].status !== "hidden") {
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
    return { status: "switch", reason: `Switch the wallet to chain ${context.routeChainId.toString()} to continue.` };
  }
  return enabled();
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

function sameAddress(left: Address | undefined, right: Address): boolean {
  return left?.toLowerCase() === right.toLowerCase();
}
