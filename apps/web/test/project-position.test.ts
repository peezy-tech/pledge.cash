import { describe, expect, test } from "bun:test";
import type {
  Address,
  BoardroomHolderPower,
  GrantState,
  PledgeCashBlockReadClient,
} from "@pledge.cash/sdk";
import {
  deriveProjectGrantPosition,
  ProjectPositionReadCoordinator,
  projectPositionAction,
  projectPositionHasUnknowns,
  projectWalletPositionKey,
  readProjectWalletPosition,
} from "../src/lib/project-position";
import type { ProductBoardroomDashboardState } from "../src/lib/product-boardroom";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const shareToken = "0x2000000000000000000000000000000000000000" as Address;
const otherToken = "0x3000000000000000000000000000000000000000" as Address;
const account = "0x4000000000000000000000000000000000000000" as Address;
const otherAccount = "0x5000000000000000000000000000000000000000" as Address;
const projectGrant = "0x6000000000000000000000000000000000000000" as Address;
const externalGrant = "0x7000000000000000000000000000000000000000" as Address;

const holderPower: BoardroomHolderPower = {
  account,
  blockNumber: 11n,
  boardroom,
  canStartWindDown: false,
  canVeto: true,
  currentBalance: 4n,
  currentEligibleSupply: 20n,
  encumbered: false,
  pastBalance: 4n,
  pastEligibleSupply: 20n,
  shareToken,
  snapshotBlock: 10n,
  vetoRequired: 1n,
  windDownRequired: 5n,
};

describe("project wallet position", () => {
  test("reads the direct canonical balance and keeps settleable grants scoped to the project token", async () => {
    const dashboard = projectDashboard();
    const client = fakeClient(4n);
    const position = await readProjectWalletPosition(client, { account, dashboard }, {
      readHolderPower: async () => holderPower,
    });

    expect(position.directBalance).toBe(4n);
    expect(position.settleableProjectTokens).toBe(5n);
    expect(position.settleableGrantCount).toBe(1);
    expect(position.nextGrant).toBe(projectGrant);
    expect(position.holderPower).toEqual(holderPower);
    expect(projectPositionHasUnknowns(position)).toBe(false);
  });

  test("marks failed independent reads unknown without turning them into zero", async () => {
    const client = fakeClient(new Error("balance unavailable"));
    const position = await readProjectWalletPosition(client, { account, dashboard: projectDashboard() }, {
      readHolderPower: async () => {
        throw new Error("history unavailable");
      },
    });

    expect(position.directBalance).toBeUndefined();
    expect(position.directBalanceError).toContain("balance unavailable");
    expect(position.settleableProjectTokens).toBe(5n);
    expect(position.holderPower).toBeUndefined();
    expect(position.holderPowerError).toContain("history unavailable");
    expect(projectPositionHasUnknowns(position)).toBe(true);
  });

  test("does not certify a zero grant position when active grant coverage is incomplete", () => {
    const dashboard = projectDashboard();
    dashboard.currentStateCoverage = {
      distributions: { complete: true, shown: 0, total: 0 },
      grants: { complete: false, shown: 1, total: 2 },
      lockedLiquidity: { complete: true, shown: 0, total: 0 },
      redeemableAssets: { complete: true, shown: 0, total: 0 },
    };

    expect(deriveProjectGrantPosition(dashboard, account)).toEqual({
      error: "Grant coverage is incomplete for this project.",
    });
  });

  test("keys position state to chain, deployment, project, share token, account, and grant source", () => {
    const dashboard = projectDashboard();
    const base = projectWalletPositionKey({ account, chainId: 31337, dashboard, deploymentIdentity: "release-a" });
    expect(projectWalletPositionKey({ account, chainId: 998, dashboard, deploymentIdentity: "release-a" })).not.toBe(base);
    expect(projectWalletPositionKey({ account, chainId: 31337, dashboard, deploymentIdentity: "release-b" })).not.toBe(base);
    expect(projectWalletPositionKey({ account: otherAccount, chainId: 31337, dashboard, deploymentIdentity: "release-a" })).not.toBe(base);
    expect(projectWalletPositionKey({
      account,
      chainId: 31337,
      dashboard: { ...dashboard, address: otherAccount },
      deploymentIdentity: "release-a",
    })).not.toBe(base);
    const changedGrantState = projectDashboard();
    changedGrantState.snapshot.grantSummaries[0]!.state!.settleable = 6n;
    expect(projectWalletPositionKey({
      account,
      chainId: 31337,
      dashboard: changedGrantState,
      deploymentIdentity: "release-a",
    })).not.toBe(base);
  });

  test("rejects a completed read after its active position identity changes", () => {
    const coordinator = new ProjectPositionReadCoordinator();
    coordinator.sync("chain:project:account-a:release-a");
    const request = coordinator.begin("chain:project:account-a:release-a");
    expect(coordinator.isCurrent(request)).toBe(true);

    coordinator.sync("chain:project:account-b:release-a");
    expect(coordinator.isCurrent(request)).toBe(false);

    const current = coordinator.begin("chain:project:account-b:release-a");
    coordinator.invalidate(current);
    expect(coordinator.isCurrent(current)).toBe(false);
  });

  test("chooses exactly one next action by grant, holder power, participation, then evidence", async () => {
    const position = await readProjectWalletPosition(fakeClient(4n), { account, dashboard: projectDashboard() }, {
      readHolderPower: async () => holderPower,
    });
    expect(projectPositionAction({ connected: true, hasActiveParticipation: true, launched: true, position, status: 0 }))
      .toEqual({ kind: "grant", grant: projectGrant });

    const noGrant = { ...position, nextGrant: undefined, settleableProjectTokens: 0n };
    expect(projectPositionAction({ connected: true, hasActiveParticipation: true, launched: true, position: noGrant, status: 0 }))
      .toEqual({ kind: "governance" });
    expect(projectPositionAction({ connected: false, hasActiveParticipation: true, launched: true, status: 0 }))
      .toEqual({ kind: "participate" });
    expect(projectPositionAction({ connected: false, hasActiveParticipation: true, launched: true, status: 1 }))
      .toEqual({ kind: "transparency" });
  });
});

function projectDashboard(): ProductBoardroomDashboardState {
  const grantState = (address: Address, token: Address, settleable: bigint): GrantState => ({
    address,
    claimable: 10n,
    closed: false,
    expired: false,
    expiry: 1_000n,
    factory: otherAccount,
    grantSize: 10n,
    halted: false,
    holder: account,
    issuer: boardroom,
    paymentToken: "0x0000000000000000000000000000000000000000",
    paymentTokenDecimals: 18,
    price: 0n,
    quarantined: false,
    quarantinedAmount: 0n,
    settleable,
    settledAmount: 0n,
    settlementCost: 0n,
    token,
    tokenDecimals: 18,
    tokenId: BigInt(address),
    transferable: false,
    transferLocked: false,
    transferUnlockTime: 0n,
    unsettledAmount: 10n,
    vestingCliff: 0n,
    vestingEnd: 100n,
  });
  return {
    address: boardroom,
    catalog: [],
    nativeBalance: 0n,
    snapshot: {
      address: boardroom,
      distributionSummaries: [],
      executor: account,
      governanceConfig: { actionGracePeriod: 1n, minimumDelay: 1n, vetoBps: 100n, windDownBps: 1_000n },
      governanceDelay: 1n,
      governanceEligibleSupply: 20n,
      governanceEpoch: 1n,
      grantSummaries: [
        { address: projectGrant, state: grantState(projectGrant, shareToken, 5n) },
        { address: externalGrant, state: grantState(externalGrant, otherToken, 900n) },
      ],
      issuedDistributions: [],
      issuedGrants: [projectGrant, externalGrant],
      launched: true,
      lockedLiquidityPositions: [],
      lockedLiquiditySummaries: [],
      owner: account,
      policyRegistry: otherAccount,
      redeemableAssets: [],
      shareToken,
      shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "PROJECT" },
      status: 0,
      wrappedNative: otherToken,
    },
    treasuryAssets: [],
  };
}

function fakeClient(balance: bigint | Error): PledgeCashBlockReadClient {
  return {
    getBlockNumber: async () => 11n,
    readContract: async () => {
      if (balance instanceof Error) throw balance;
      return balance;
    },
  } as PledgeCashBlockReadClient;
}
