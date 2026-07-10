import { describe, expect, test } from "bun:test";
import type { Address, BoardroomHolderPower } from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import {
  ExplorePage,
  GovernancePage,
  NotFoundPage,
  ParticipatePage,
  PortfolioPage,
  ProjectLayout,
  ProjectOverviewPage,
  RedirectState,
  StudioPage,
  TransparencyPage,
  filterProjects,
  orderPortfolioTasks,
  participationOptions,
  studioGuidance,
  studioLifecycle,
  type PortfolioTask,
} from "../src/app/pages";
import type { ProductBoardroomCatalogEntry, ProductBoardroomDashboardState } from "../src/lib/product-boardroom";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const owner = "0x2000000000000000000000000000000000000000" as Address;
const shareToken = "0x3000000000000000000000000000000000000000" as Address;
const paymentToken = "0x4000000000000000000000000000000000000000" as Address;
const sale = "0x5000000000000000000000000000000000000000" as Address;
const grant = "0x6000000000000000000000000000000000000000" as Address;
const zero = "0x0000000000000000000000000000000000000000" as Address;

const catalogEntry: ProductBoardroomCatalogEntry = {
  address: boardroom,
  buyerCount: 4,
  cashRaised: 6_000_000n,
  cashToken: paymentToken,
  cashTokenDecimals: 6,
  cashTokenSymbol: "USDC",
  distribution: sale,
  distributionKind: "fixed-price-sale",
  name: "Atlas Cooperative",
  path: "Fixed-price launch",
  shareToken,
  shareTokenDecimals: 18,
  soldShares: 2_000_000_000_000_000_000n,
  status: "Active",
  symbol: "ATLAS",
};

const dashboard: ProductBoardroomDashboardState = {
  address: boardroom,
  catalog: [catalogEntry],
  nativeBalance: 1_000_000_000_000_000_000n,
  snapshot: {
    address: boardroom,
    owner,
    policyRegistry: "0x7000000000000000000000000000000000000000" as Address,
    wrappedNative: "0x8000000000000000000000000000000000000000" as Address,
    shareToken,
    status: 0,
    launched: true,
    executor: "0x9000000000000000000000000000000000000000" as Address,
    governanceDelay: 86_400n,
    governanceEpoch: 2n,
    governanceEligibleSupply: 8_000_000_000_000_000_000n,
    governanceConfig: {
      minimumDelay: 86_400n,
      actionGracePeriod: 604_800n,
      vetoBps: 2_000n,
      windDownBps: 3_000n,
    },
    redeemableAssets: [paymentToken],
    issuedGrants: [grant],
    issuedDistributions: [sale],
    lockedLiquidityPositions: [],
    shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "ATLAS" },
    grantSummaries: [{
      address: grant,
      state: {
        address: grant,
        factory: "0xa000000000000000000000000000000000000000" as Address,
        issuer: boardroom,
        holder: owner,
        token: shareToken,
        paymentToken: zero,
        tokenId: 1n,
        tokenDecimals: 18,
        paymentTokenDecimals: 18,
        grantSize: 1_000_000_000_000_000_000n,
        claimable: 500_000_000_000_000_000n,
        price: 0n,
        vestingCliff: 0n,
        vestingEnd: 0n,
        expiry: 0n,
        settledAmount: 250_000_000_000_000_000n,
        settleable: 500_000_000_000_000_000n,
        settlementCost: 0n,
        unsettledAmount: 750_000_000_000_000_000n,
        transferable: false,
        transferUnlockTime: 0n,
        transferLocked: true,
        expired: false,
        halted: false,
        quarantined: false,
        quarantinedAmount: 0n,
        closed: false,
      },
      tokenMetadata: { address: shareToken, decimals: 18, symbol: "ATLAS" },
    }],
    distributionSummaries: [{
      address: sale,
      kind: "fixed-price-sale",
      state: {
        address: sale,
        factory: "0xb000000000000000000000000000000000000000" as Address,
        boardroom,
        shareToken,
        paymentToken,
        saleSupply: 10_000_000_000_000_000_000n,
        remainingShares: 8_000_000_000_000_000_000n,
        price: 3_000_000n,
        maxPerBuyer: 2_000_000_000_000_000_000n,
        startTime: 1n,
        endTime: 9_999_999_999n,
        saleStatus: 0,
        closed: false,
      },
      shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "ATLAS" },
      paymentTokenMetadata: { address: paymentToken, decimals: 6, symbol: "USDC" },
    }],
    lockedLiquiditySummaries: [],
  },
  treasuryAssets: [
    { address: shareToken, balance: 12_000_000_000_000_000_000n, decimals: 18, label: "Treasury shares", symbol: "ATLAS", totalSupply: 100_000_000_000_000_000_000n },
    { address: paymentToken, balance: 6_000_000n, decimals: 6, label: "Cash / quote", symbol: "USDC", totalSupply: 1_000_000_000n },
  ],
};

const holderPower: BoardroomHolderPower = {
  boardroom,
  shareToken,
  account: owner,
  blockNumber: 100n,
  snapshotBlock: 99n,
  encumbered: false,
  currentBalance: 3_000_000_000_000_000_000n,
  pastBalance: 3_000_000_000_000_000_000n,
  currentEligibleSupply: 8_000_000_000_000_000_000n,
  pastEligibleSupply: 8_000_000_000_000_000_000n,
  vetoRequired: 1_600_000_000_000_000_000n,
  windDownRequired: 2_400_000_000_000_000_000n,
  canVeto: true,
  canStartWindDown: true,
};

describe("read-first product pages", () => {
  test("filters Explore projects by participation type and search", () => {
    const other = {
      ...catalogEntry,
      address: "0xc000000000000000000000000000000000000000" as Address,
      distributionKind: "merkle-airdrop",
      name: "Beacon",
      path: "Airdrop",
      symbol: "BCN",
    };
    expect(filterProjects([catalogEntry, other], "atlas", "all")).toEqual([catalogEntry]);
    expect(filterProjects([catalogEntry, other], "", "merkle-airdrop")).toEqual([other]);

    const html = renderToString(
      <ExplorePage
        chainId={31337}
        chainName="Local Anvil"
        loading={false}
        projects={[catalogEntry]}
        onOpenProject={() => undefined}
      />,
    );
    expect(html).toContain("Project directory");
    expect(html).toContain("Atlas Cooperative");
    expect(html).toContain("Participants");
  });

  test("renders one project workspace with human-readable overview and participation", () => {
    const overview = renderToString(
      <ProjectLayout
        account={owner}
        activeSection="overview"
        chainName="Local Anvil"
        dashboard={dashboard}
        loading={false}
        onNavigateSection={() => undefined}
      >
        <ProjectOverviewPage account={owner} dashboard={dashboard} loading={false} />
      </ProjectLayout>,
    );
    expect(overview).toContain("Atlas Cooperative");
    expect(overview).toContain("What needs attention");
    expect(overview).toContain("Holder governance is live");
    expect(overview).toContain("Treasury at a glance");

    const options = participationOptions(dashboard);
    expect(options[0]?.path).toBe("fixed-price-sale");
    expect(options[0]?.available).toBe(true);
    const activeDistribution = dashboard.snapshot.distributionSummaries[0];
    if (!activeDistribution?.state || !("saleStatus" in activeDistribution.state)) throw new Error("Fixture sale missing");
    const dashboardWithOlderClosedSale: ProductBoardroomDashboardState = {
      ...dashboard,
      snapshot: {
        ...dashboard.snapshot,
        distributionSummaries: [{
          ...activeDistribution,
          address: "0xd000000000000000000000000000000000000000" as Address,
          state: { ...activeDistribution.state, closed: true, saleStatus: 1 },
        }, activeDistribution],
      },
    };
    expect(participationOptions(dashboardWithOlderClosedSale)[0]?.address).toBe(sale);
    const participate = renderToString(
      <ParticipatePage
        content={{ "fixed-price-sale": <button type="button">Review purchase</button> }}
        dashboard={dashboard}
        loading={false}
      />,
    );
    expect(participate).toContain("Choose how to participate");
    expect(participate).toContain("Review purchase");
    expect(participate).toContain("Before anything reaches your wallet");
  });

  test("explains governance thresholds and exposes transparency tables", () => {
    const governance = renderToString(<GovernancePage dashboard={dashboard} holderPower={holderPower} loading={false} />);
    expect(governance).toContain("Decision system");
    expect(governance).toContain("Holder protections");
    expect(governance).toContain("20%");
    expect(governance).toContain("This wallet can veto");

    const transparency = renderToString(<TransparencyPage dashboard={dashboard} loading={false} />);
    expect(transparency).toContain("Treasury and supply");
    expect(transparency).toContain("Open commitments");
    expect(transparency).toContain("Issued grants");
    expect(transparency).toContain("Technical details");
  });

  test("orders portfolio tasks by urgency and gives Studio lifecycle guidance", () => {
    const tasks: PortfolioTask[] = [
      { id: "done", title: "Receipt confirmed", description: "Settled", status: "complete" },
      { id: "attention", title: "Grant can settle", description: "Review payment", status: "attention" },
      { id: "ready", title: "Vote ready", description: "Review decision", status: "ready" },
    ];
    expect(orderPortfolioTasks(tasks).map((task) => task.id)).toEqual(["attention", "ready", "done"]);
    const portfolio = renderToString(<PortfolioPage account={owner} loading={false} tasks={tasks} />);
    expect(portfolio.indexOf("Grant can settle")).toBeLessThan(portfolio.indexOf("Receipt confirmed"));

    expect(studioLifecycle(dashboard)).toBe("launched");
    expect(studioGuidance("launched", dashboard).nextStep).toContain("queued action");
    const studio = renderToString(<StudioPage account={owner} dashboard={dashboard} loading={false} />);
    expect(studio).toContain("Operate through governance");
    expect(studio).toContain("Project lifecycle");
    expect(studio).toContain("Operator tools");
  });

  test("renders explicit not-found and redirect states", () => {
    expect(renderToString(<NotFoundPage />)).toContain("This page does not exist");
    expect(renderToString(<RedirectState destination="/explore" />)).toContain("Opening the canonical workspace");
  });
});
