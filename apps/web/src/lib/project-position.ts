import {
  erc20Abi,
  readBoardroomHolderPower,
  type Address,
  type BoardroomHolderPower,
  type PledgeCashBlockReadClient,
} from "@pledge.cash/sdk";
import { errorMessage } from "./forms";
import type { ProductBoardroomDashboardState } from "./product-boardroom";

export type ProjectGrantPosition = {
  error?: string | undefined;
  nextGrant?: Address | undefined;
  nextGrantSettleableTokens?: bigint | undefined;
  settleableGrantCount?: number | undefined;
  settleableProjectTokens?: bigint | undefined;
};

export type ProjectWalletPosition = {
  account: Address;
  boardroom: Address;
  directBalance?: bigint | undefined;
  directBalanceError?: string | undefined;
  grantError?: string | undefined;
  holderPower?: BoardroomHolderPower | undefined;
  holderPowerError?: string | undefined;
  nextGrant?: Address | undefined;
  nextGrantSettleableTokens?: bigint | undefined;
  settleableGrantCount?: number | undefined;
  settleableProjectTokens?: bigint | undefined;
  shareToken: Address;
};

export type ProjectPositionAction =
  | { kind: "grant"; grant: Address }
  | { kind: "governance" | "loading" | "participate" | "transparency" };

export type ProjectPositionReadRequest = {
  key: string;
  version: number;
};

export class ProjectPositionReadCoordinator {
  #activeKey: string | undefined;
  #version = 0;

  sync(key: string | undefined): void {
    if (this.#activeKey === key) return;
    this.#activeKey = key;
    this.#version += 1;
  }

  begin(key: string): ProjectPositionReadRequest {
    this.sync(key);
    this.#version += 1;
    return { key, version: this.#version };
  }

  isCurrent(request: ProjectPositionReadRequest): boolean {
    return this.#activeKey === request.key && this.#version === request.version;
  }

  invalidate(request: ProjectPositionReadRequest): void {
    if (this.isCurrent(request)) this.#version += 1;
  }
}

type ReadProjectWalletPositionOptions = {
  readHolderPower?: typeof readBoardroomHolderPower | undefined;
};

export async function readProjectWalletPosition(
  client: PledgeCashBlockReadClient,
  input: { account: Address; dashboard: ProductBoardroomDashboardState },
  options: ReadProjectWalletPositionOptions = {},
): Promise<ProjectWalletPosition> {
  const boardroom = input.dashboard.address;
  const shareToken = input.dashboard.snapshot.shareToken;
  const grantPosition = deriveProjectGrantPosition(input.dashboard, input.account);
  const readHolderPower = options.readHolderPower ?? readBoardroomHolderPower;
  const [balanceResult, holderPowerResult] = await Promise.allSettled([
    client.readContract({ address: shareToken, abi: erc20Abi, functionName: "balanceOf", args: [input.account] }),
    readHolderPower(client, { boardroom, account: input.account }),
  ]);

  const position: ProjectWalletPosition = {
    account: input.account,
    boardroom,
    shareToken,
    ...(grantPosition.error
      ? { grantError: grantPosition.error }
      : {
          nextGrant: grantPosition.nextGrant,
          nextGrantSettleableTokens: grantPosition.nextGrantSettleableTokens,
          settleableGrantCount: grantPosition.settleableGrantCount,
          settleableProjectTokens: grantPosition.settleableProjectTokens,
        }),
  };

  if (balanceResult.status === "fulfilled" && typeof balanceResult.value === "bigint") {
    position.directBalance = balanceResult.value;
  } else {
    position.directBalanceError = balanceResult.status === "rejected"
      ? errorMessage(balanceResult.reason)
      : "The project-token balance response was invalid.";
  }

  if (holderPowerResult.status === "fulfilled" && holderPowerMatches(
    holderPowerResult.value,
    boardroom,
    shareToken,
    input.account,
  )) {
    position.holderPower = holderPowerResult.value;
  } else {
    position.holderPowerError = holderPowerResult.status === "rejected"
      ? errorMessage(holderPowerResult.reason)
      : "The governance-power response did not match this project and wallet.";
  }

  return position;
}

export function deriveProjectGrantPosition(
  dashboard: ProductBoardroomDashboardState,
  account: Address,
): ProjectGrantPosition {
  if (dashboard.currentStateCoverage?.grants.complete === false) {
    return { error: "Grant coverage is incomplete for this project." };
  }

  const summaries = new Map(
    dashboard.snapshot.grantSummaries.map((summary) => [summary.address.toLowerCase(), summary] as const),
  );
  const activeGrants = dashboard.snapshot.issuedGrants.map((address) => summaries.get(address.toLowerCase()));
  if (activeGrants.some((summary) => !summary?.state || summary.error)) {
    return { error: "At least one active project grant could not be read." };
  }

  const projectTokenGrants = activeGrants.flatMap((summary) => {
    const state = summary?.state;
    return state
      && sameAddress(state.holder, account)
      && sameAddress(state.token, dashboard.snapshot.shareToken)
      && !state.closed
      ? [{ address: summary.address, settleable: state.settleable }]
      : [];
  });
  const settleable = projectTokenGrants.reduce((total, grant) => total + grant.settleable, 0n);
  const settleableGrants = projectTokenGrants.filter((grant) => grant.settleable > 0n);

  return {
    ...(settleableGrants[0] ? { nextGrant: settleableGrants[0].address } : {}),
    nextGrantSettleableTokens: settleableGrants[0]?.settleable ?? 0n,
    settleableGrantCount: settleableGrants.length,
    settleableProjectTokens: settleable,
  };
}

export function projectPositionAction(input: {
  connected: boolean;
  hasActiveParticipation: boolean;
  launched: boolean;
  loading?: boolean | undefined;
  position?: ProjectWalletPosition | undefined;
  status: number;
}): ProjectPositionAction {
  if (input.connected && input.loading) return { kind: "loading" };
  if (
    input.connected
    && input.position?.nextGrant
    && (input.position.nextGrantSettleableTokens ?? 0n) > 0n
  ) {
    return { kind: "grant", grant: input.position.nextGrant };
  }
  if (
    input.connected
    && input.launched
    && input.status !== 2
    && input.position?.holderPower
    && !input.position.holderPower.encumbered
    && input.position.holderPower.currentBalance > 0n
  ) {
    return { kind: "governance" };
  }
  if (input.status === 0 && input.hasActiveParticipation) return { kind: "participate" };
  return { kind: "transparency" };
}

export function projectWalletPositionKey(input: {
  account: Address;
  chainId: number;
  dashboard: ProductBoardroomDashboardState;
  deploymentIdentity: string;
  refreshGeneration?: number | undefined;
}): string {
  return [
    input.chainId.toString(),
    input.deploymentIdentity,
    input.dashboard.address.toLowerCase(),
    input.dashboard.snapshot.shareToken.toLowerCase(),
    input.account.toLowerCase(),
    (input.refreshGeneration ?? 0).toString(),
    projectPositionSourceKey(input.dashboard),
  ].join(":");
}

export function projectPositionHasUnknowns(position: ProjectWalletPosition | undefined): boolean {
  return !position
    || position.directBalance === undefined
    || position.nextGrantSettleableTokens === undefined
    || position.holderPower === undefined;
}

function projectPositionSourceKey(dashboard: ProductBoardroomDashboardState): string {
  const grantCoverage = dashboard.currentStateCoverage?.grants;
  return JSON.stringify([
    grantCoverage?.complete ?? "unreported",
    grantCoverage?.shown ?? "unreported",
    grantCoverage?.total ?? "unreported",
    dashboard.snapshot.issuedGrants.map((address) => address.toLowerCase()),
    dashboard.snapshot.grantSummaries.map((summary) => [
      summary.address.toLowerCase(),
      summary.error ?? "",
      summary.state?.holder.toLowerCase() ?? "",
      summary.state?.token.toLowerCase() ?? "",
      summary.state?.settleable.toString() ?? "",
      summary.state?.closed ?? "",
    ]),
  ]);
}

function holderPowerMatches(
  power: BoardroomHolderPower,
  boardroom: Address,
  shareToken: Address,
  account: Address,
): boolean {
  return sameAddress(power.boardroom, boardroom)
    && sameAddress(power.shareToken, shareToken)
    && sameAddress(power.account, account);
}

function sameAddress(first: Address | undefined, second: Address | undefined): boolean {
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase());
}
