import { describe, expect, test } from "bun:test";
import type { Address, BoardroomHolderPower, BoardroomStakerPower } from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import {
  AlertsUnavailablePage,
  ExplorePage,
  GrantDetailPage,
  GrantVerificationFailureState,
  GrantVerificationLoadingState,
  GovernancePage,
  NotFoundPage,
  ParticipatePage,
  PortfolioPage,
  ProjectLayout,
  ProjectOverviewPage,
  RedirectState,
  StudioPage,
  TransparencyPage,
  exploreSearchHref,
  exploreSearchState,
  filterProjects,
  orderPortfolioTasks,
  participationOptions,
  replaceExploreSearchState,
  studioGuidance,
  studioLifecycle,
  type PortfolioTask,
} from "../src/app/pages";
import { AddressLink } from "../src/components/shell";
import { participationDistributionKey } from "../src/features/participation/types";
import type { ProductBoardroomCatalogEntry, ProductBoardroomDashboardState } from "../src/lib/product-boardroom";
import type { SavedProject } from "../src/lib/saved-projects";
import type { ProjectPositionAction, ProjectWalletPosition } from "../src/lib/project-position";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const owner = "0x2000000000000000000000000000000000000000" as Address;
const shareToken = "0x3000000000000000000000000000000000000000" as Address;
const paymentToken = "0x4000000000000000000000000000000000000000" as Address;
const sale = "0x5000000000000000000000000000000000000000" as Address;
const grant = "0x6000000000000000000000000000000000000000" as Address;
const viewer = "0xa000000000000000000000000000000000000000" as Address;
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
    rewardPool: "0x0000000000000000000000000000000000000fed" as Address,
    redemptionExcessRecipient: owner,
    status: 0,
    launched: true,
    controller: "0x9000000000000000000000000000000000000000" as Address,
    proposer: owner,
    controllerDelay: 86_400n,
    controllerGracePeriod: 604_800n,
    controllerGeneration: 1n,
    controllerConfigurationEpoch: 1n,
    governanceEpoch: 2n,
    windDownDelay: 86_400n,
    windDownStartedAt: 0n,
    protectionStaker: owner,
    governanceEligibleSupply: 8_000_000_000_000_000_000n,
    redeemableAssetCount: 1n,
    snapshotAssetCount: 0n,
    snapshotCursor: 0n,
    snapshotFrozen: false,
    redemptionSupply: 0n,
    redemptionSupplyFrozen: false,
    activeObligationCount: 2n,
    activeGrantCount: 1n,
    activeDistributionCount: 1n,
    activeLiquidityCount: 0n,
    activeRewardCount: 0n,
    primaryMarketMode: 2,
    bondingCurve: zero,
    primaryMarketQuoteAsset: paymentToken,
    liquidityStatus: 0,
    liquidityVault: zero,
    liquidityPoolId: `0x${"00".repeat(32)}`,
    liquidityQuoteAsset: paymentToken,
    redeemableAssets: [paymentToken],
    issuedGrants: [grant],
    issuedDistributions: [sale],
    lockedLiquidityPositions: [],
    grantRecordCount: 1,
    distributionRecordCount: 1,
    lockedLiquidityRecordCount: 0,
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

const stakerPower: BoardroomStakerPower = {
  boardroom,
  shareToken,
  rewardPool: "0x0000000000000000000000000000000000000fed" as Address,
  account: owner,
  blockNumber: 100n,
  snapshotBlock: 99n,
  encumbered: false,
  currentTokenBalance: 4_000_000_000_000_000_000n,
  currentBalance: 3_000_000_000_000_000_000n,
  pastBalance: 3_000_000_000_000_000_000n,
  currentActiveStake: 3_000_000_000_000_000_000n,
  pastActiveStake: 3_000_000_000_000_000_000n,
  currentEligibleSupply: 8_000_000_000_000_000_000n,
  pastEligibleSupply: 8_000_000_000_000_000_000n,
  vetoRequired: 1_600_000_000_000_000_000n,
  windDownRequired: 2_400_000_000_000_000_000n,
  canVeto: true,
  canStartWindDown: true,
};

const holderPower: BoardroomHolderPower = stakerPower;

const walletPosition: ProjectWalletPosition = {
  account: owner,
  boardroom,
  directBalance: 3_000_000_000_000_000_000n,
  holderPower,
  nextGrant: grant,
  nextGrantSettleableTokens: 500_000_000_000_000_000n,
  settleableGrantCount: 1,
  settleableProjectTokens: 500_000_000_000_000_000n,
  shareToken,
};

function overviewActionHref(action: ProjectPositionAction): string {
  return action.kind === "grant"
    ? `/grants/31337/${action.grant}?project=${boardroom}`
    : `/projects/31337/atlas/${action.kind}`;
}

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
    expect(filterProjects([catalogEntry, other], "", "saved", new Set([other.address]))).toEqual([other]);

    const html = renderToString(
      <ExplorePage
        canLoadMore
        chainId={31337}
        chainName="Local Anvil"
        loading={false}
        totalProjects={10_000}
        projects={[catalogEntry]}
        onLoadMore={() => undefined}
        onOpenProject={() => undefined}
      />,
    );
    expect(html).toContain("Project directory");
    expect(html).toContain("Atlas Cooperative");
    expect(html).toContain("Buyers");
    expect(html).toContain("1 of 10,000 projects loaded");
    expect(html).toContain("Load more projects");
  });

  test("stores Explore query and type in a shareable URL without adding filter history entries", () => {
    const calls: Array<{ state: unknown; href: string | URL | null | undefined }> = [];
    const href = replaceExploreSearchState(
      { filter: "fixed-price-sale", query: "Atlas treasury" },
      {
        history: {
          state: { route: "explore" },
          replaceState(state, _title, nextHref) { calls.push({ state, href: nextHref }); },
        },
        location: { hash: "", pathname: "/pledge-cash/explore", search: "?chain=31337" },
      },
    );

    expect(href).toBe("/pledge-cash/explore?chain=31337&q=Atlas+treasury&type=fixed-price-sale");
    expect(calls).toEqual([{
      state: { route: "explore" },
      href: "/pledge-cash/explore?chain=31337&q=Atlas+treasury&type=fixed-price-sale",
    }]);
    expect(exploreSearchState("?chain=31337&q=Atlas+treasury&type=fixed-price-sale")).toEqual({
      filter: "fixed-price-sale",
      query: "Atlas treasury",
    });
  });

  test("restores the exact Explore filters after opening a project and going Back", () => {
    const exploreEntry = exploreSearchHref(
      "/pledge-cash/explore",
      "?chain=31337",
      { filter: "amm", query: "Atlas" },
    );
    const historyEntries = [
      exploreEntry,
      `/pledge-cash/projects/31337/${boardroom}/overview`,
    ];
    const restored = new URL(historyEntries[0]!, "https://pledge.cash");

    expect(exploreSearchState(restored.search)).toEqual({ filter: "amm", query: "Atlas" });
    expect(historyEntries[1]).not.toContain("q=");
    expect(exploreSearchState("?chain=31337&q=Atlas&type=not-a-filter")).toEqual({ filter: "all", query: "Atlas" });
    expect(exploreSearchState("?chain=31337&type=saved")).toEqual({ filter: "saved", query: "" });
    expect(exploreSearchHref("/explore", "?chain=31337", { filter: "saved", query: "" }))
      .toBe("/explore?chain=31337&type=saved");
  });

  test("renders saved controls and a wallet-independent Portfolio list", () => {
    const explore = renderToString(
      <ExplorePage
        chainId={31337}
        chainName="Local Anvil"
        loading={false}
        projects={[catalogEntry]}
        savedProjectAddresses={new Set([boardroom])}
        savedProjectCount={1}
        onOpenProject={() => undefined}
        onToggleSaved={() => undefined}
      />,
    );
    expect(explore).toContain('aria-pressed="true"');
    expect(explore).toContain("Remove Atlas Cooperative from saved projects");
    expect(explore).toContain(">Saved<");

    const savedProject: SavedProject = {
      boardroom,
      chainId: 31337,
      name: "Atlas Cooperative",
      savedAt: 123,
      symbol: "ATLAS",
    };
    const portfolio = renderToString(
      <PortfolioPage
        loading={false}
        savedProjectHref={(project) => `/projects/${project.chainId.toString()}/${project.boardroom}/overview`}
        savedProjects={[savedProject]}
        tasks={[]}
      />,
    );
    expect(portfolio).toContain("Browser-saved project links");
    expect(portfolio).toContain('href="/projects/31337/0x1000000000000000000000000000000000000000/overview"');
    expect(portfolio).toContain("Atlas Cooperative");
    expect(portfolio).toContain("No wallet connected");
  });

  test("explains empty saved filters and storage failures truthfully", () => {
    const emptySaved = renderToString(
      <ExplorePage
        chainId={31337}
        chainName="Local Anvil"
        loading={false}
        projects={[]}
        savedProjectCount={0}
        savedProjectsWarning="Browser storage is unavailable."
        onOpenProject={() => undefined}
      />,
    );

    expect(emptySaved).toContain("Saved projects could not be restored");
    expect(emptySaved).toContain("Browser storage is unavailable");
    expect(emptySaved).toContain("No projects discovered");
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
        <ProjectOverviewPage
          account={owner}
          actionHref={overviewActionHref}
          dashboard={dashboard}
          loading={false}
          onOpenAction={() => undefined}
          position={walletPosition}
        />
      </ProjectLayout>,
    );
    expect(overview).toContain("Atlas Cooperative");
    expect(overview).toContain("Staker governance is live");
    expect(overview).toContain("Your position");
    expect(overview).toContain("3 ATLAS");
    expect(overview).toContain("0.5 ATLAS");
    expect(overview).toContain("Veto + wind-down eligible");
    expect(overview).toContain("lifetime activity is reconstructed from their onchain event history");
    expect(overview).toContain("Treasury at a glance");
    expect(overview).toContain(`href="/grants/31337/${grant}?project=${boardroom}"`);
    expect(overview).not.toContain('href="/projects/31337/atlas/participate"');

    const connectedObserver = renderToString(
      <ProjectLayout
        account={viewer}
        activeSection="overview"
        chainName="Local Anvil"
        dashboard={dashboard}
        loading={false}
        onNavigateSection={() => undefined}
      >
        Project
      </ProjectLayout>,
    );
    expect(connectedObserver).toContain("Wallet connected");
    expect(connectedObserver).not.toContain("Holder view");

    const disconnected = renderToString(
      <ProjectOverviewPage
        actionHref={overviewActionHref}
        dashboard={dashboard}
        loading={false}
        onOpenAction={() => undefined}
      />,
    );
    expect(disconnected).toContain("Public project state remains available without a wallet");
    expect(disconnected).toContain('href="/projects/31337/atlas/participate"');

    const refreshing = renderToString(
      <ProjectOverviewPage
        account={owner}
        actionHref={overviewActionHref}
        dashboard={dashboard}
        loading={false}
        position={walletPosition}
        positionLoading
      />,
    );
    expect(refreshing).toContain("Refreshing wallet position");
    expect(refreshing).toContain("Verifying the latest project-token balance");
    expect(refreshing).not.toContain("View participation");
    expect(refreshing).not.toContain("Open transparency");

    const multipleGrants = renderToString(
      <ProjectOverviewPage
        account={owner}
        actionHref={overviewActionHref}
        dashboard={dashboard}
        loading={false}
        position={{
          ...walletPosition,
          settleableGrantCount: 2,
          settleableProjectTokens: 1_200_000_000_000_000_000n,
        }}
      />,
    );
    expect(multipleGrants).toContain("first of 2 project-token grants");
    expect(multipleGrants).toContain("0.5 ATLAS can settle from the grant this recommendation opens");
    expect(multipleGrants).not.toContain("1.2 ATLAS");

    const partialHistory = renderToString(
      <ProjectLayout
        activeSection="overview"
        chainName="Local Anvil"
        dashboard={{ ...dashboard, historyErrors: ["RPC history unavailable"] }}
        loading={false}
        onNavigateSection={() => undefined}
      >
        <ProjectOverviewPage dashboard={dashboard} loading={false} />
      </ProjectLayout>,
    );
    expect(partialHistory).toContain("Historical activity is incomplete");
    expect(partialHistory).toContain("event-derived totals may be partial");

    const boundedCurrentState = {
      ...dashboard,
      currentStateCoverage: {
        distributions: { complete: false, shown: 1, total: 7 },
        grants: { complete: false, shown: 1, total: 9 },
        lockedLiquidity: { complete: true, shown: 0, total: 0 },
        redeemableAssets: { complete: true, shown: 1, total: 1 },
      },
    } satisfies ProductBoardroomDashboardState;
    const partialCurrentState = renderToString(
      <ProjectLayout
        activeSection="transparency"
        chainName="Local Anvil"
        dashboard={boundedCurrentState}
        loading={false}
        onNavigateSection={() => undefined}
      >
        <TransparencyPage dashboard={boundedCurrentState} loading={false} />
      </ProjectLayout>,
    );
    expect(partialCurrentState).toContain("Current contract-state detail is incomplete");
    expect(partialCurrentState).toContain("Grants: 1 of 9 records read");
    expect(partialCurrentState).toContain("Distributions: 1 of 7 records read");
    expect(partialCurrentState).toContain("Current-state coverage: 1 of 9 grant records read");
    expect(partialCurrentState).not.toContain("Historical activity is incomplete");
    expect(partialCurrentState).not.toContain("Redeemable-asset coverage or an asset read is incomplete");

    const failedTreasuryAsset = renderToString(
      <TransparencyPage
        dashboard={{
          ...boundedCurrentState,
          treasuryAssets: [{ ...boundedCurrentState.treasuryAssets[0]!, error: "balance read failed" }],
        }}
        loading={false}
      />,
    );
    expect(failedTreasuryAsset).toContain("Redeemable-asset coverage or an asset read is incomplete");

    const options = participationOptions(dashboard);
    expect(options[0]?.path).toBe("fixed-price-sale");
    expect(options[0]?.available).toBe(true);
    const activeDistribution = dashboard.snapshot.distributionSummaries[0];
    if (!activeDistribution?.state || !("saleStatus" in activeDistribution.state)) throw new Error("Fixture sale missing");
    const closedSale = {
      ...activeDistribution,
      address: "0xd000000000000000000000000000000000000000" as Address,
      state: { ...activeDistribution.state, closed: true, saleStatus: 1 },
    };
    const dashboardWithOlderClosedSale: ProductBoardroomDashboardState = {
      ...dashboard,
      snapshot: {
        ...dashboard.snapshot,
        distributionSummaries: [closedSale, activeDistribution],
      },
    };
    expect(participationOptions(dashboardWithOlderClosedSale)[0]?.address).toBe(sale);
    const closedRoute = participationDistributionKey("fixed-price-sale", closedSale.address);
    const closedOnlyDashboard = {
      ...dashboardWithOlderClosedSale,
      snapshot: { ...dashboardWithOlderClosedSale.snapshot, distributionSummaries: [closedSale] },
    };
    const closedParticipation = renderToString(
      <ParticipatePage
        content={{ [closedRoute]: <button type="button">Review closed purchase</button> }}
        dashboard={closedOnlyDashboard}
        loading={false}
        selectedRoute={closedRoute}
      />,
    );
    expect(closedParticipation).toContain("This sale is closed or sold out");
    expect(closedParticipation).not.toContain("Review closed purchase");
    const participate = renderToString(
      <ParticipatePage
        content={{ "fixed-price-sale": <button type="button">Review purchase</button> }}
        dashboard={dashboard}
        loading={false}
      />,
    );
    expect(participate).toContain("Choose how to participate");
    expect(participate).toContain("Review purchase");
    expect(participate).toContain("Route details");
    expect(participate.indexOf("Review purchase")).toBeLessThan(participate.indexOf("Route details"));
    expect(participate).not.toContain('role="tablist"');
    expect(participate).not.toContain("Review route");
    expect(participate).toContain("Before anything reaches your wallet");
  });

  test("renders failed wallet position reads as Unknown without hiding the public overview", () => {
    const failedPosition: ProjectWalletPosition = {
      account: owner,
      boardroom,
      directBalanceError: "balance unavailable",
      grantError: "grant coverage incomplete",
      holderPowerError: "history unavailable",
      shareToken,
    };
    const overview = renderToString(
      <ProjectOverviewPage
        account={owner}
        actionHref={overviewActionHref}
        dashboard={dashboard}
        loading={false}
        position={failedPosition}
      />,
    );

    expect(overview.match(/Unknown/g)?.length).toBeGreaterThanOrEqual(3);
    expect(overview).toContain("not treated as zero");
    expect(overview).toContain("Project state");
    expect(overview).toContain("Treasury at a glance");
  });

  test("uses semantically honest route controls when multiple participation paths exist", () => {
    const participate = renderToString(
      <ParticipatePage
        content={{
          "fixed-price-sale": <button type="button">Review purchase</button>,
          amm: <button type="button">Review swap</button>,
        }}
        dashboard={dashboard}
        loading={false}
      />,
    );

    expect(participate).toContain('aria-label="Participation routes"');
    expect(participate).toContain('role="group"');
    expect(participate).toContain('aria-pressed="true"');
    expect(participate).toContain('role="region"');
    expect(participate).not.toContain('role="tab"');
    expect(participate).not.toContain('role="tabpanel"');
  });

  test("keeps every project AMM pool as a distinct participation route", () => {
    const firstPool = "0xf100000000000000000000000000000000000000" as Address;
    const secondPool = "0xf200000000000000000000000000000000000000" as Address;
    const multiPoolDashboard: ProductBoardroomDashboardState = {
      ...dashboard,
      histories: [
        { distribution: "0xf300000000000000000000000000000000000000" as Address, pool: secondPool },
        { distribution: sale, pool: firstPool },
      ],
    };

    const options = participationOptions(multiPoolDashboard, { amm: <button type="button">Review swap</button> });
    const ammOptions = options.filter((option) => option.path === "amm");

    expect(ammOptions.map((option) => option.address)).toEqual([firstPool, secondPool]);
    expect(new Set(ammOptions.map((option) => option.id)).size).toBe(2);
  });

  test("explains governance thresholds and exposes transparency tables", () => {
    const governance = renderToString(<GovernancePage dashboard={dashboard} stakerPower={stakerPower} loading={false} />);
    expect(governance).toContain("Decision system");
    expect(governance).toContain("Staker protections");
    expect(governance).toContain("1%");
    expect(governance).toContain("This wallet can veto");

    const partialGovernance = renderToString(
      <GovernancePage
        dashboard={dashboard}
        loading={false}
        warning="1 indexed decision could not be verified and was ignored."
      />,
    );
    expect(partialGovernance).toContain("Some scheduled operations were not shown");
    expect(partialGovernance).toContain("1 indexed decision could not be verified and was ignored");
    expect(partialGovernance).toContain("No verified scheduled operations");
    expect(partialGovernance).toContain("Retry before assuming no decisions are pending");
    expect(partialGovernance).not.toContain("Governance data is incomplete");

    const unavailableGovernance = renderToString(
      <GovernancePage dashboard={dashboard} error="The governance index could not be reached." loading={false} />,
    );
    expect(unavailableGovernance).toContain("Scheduled operations are unavailable");
    expect(unavailableGovernance).toContain("Retry before concluding that no decision is pending");
    expect(unavailableGovernance).not.toContain("No scheduled operations");

    const transparency = renderToString(
      <TransparencyPage
        dashboard={dashboard}
        grantHref={(address) => `/pledge-cash/grants/31337/${address}`}
        loading={false}
        onOpenGrant={() => undefined}
      />,
    );
    expect(transparency).toContain("Treasury and supply");
    expect(transparency).toContain("Open commitments");
    expect(transparency).toContain("View grant");
    expect(transparency).toContain(`/pledge-cash/grants/31337/${grant}`);
    expect(transparency).toContain("Issued grants");
    expect(transparency).toContain("Technical details");
    expect(transparency).toContain("Grant provenance records");
    expect(transparency).toContain("Distribution provenance records");
    expect(transparency).toContain("Closed, removed, or migrated distribution records shown above remain separate historical evidence");
    expect(transparency).not.toContain("Tracked distributions");
  });

  test("renders failed history fields as unknown instead of factual zeroes", () => {
    const partialDashboard: ProductBoardroomDashboardState = {
      ...dashboard,
      histories: [{
        completeness: "partial",
        distribution: sale,
        scanError: "FixedPricePurchase history exceeded the bounded scan deadline.",
        soldShares: 2_000_000_000_000_000_000n,
      }],
    };

    const transparency = renderToString(<TransparencyPage dashboard={partialDashboard} loading={false} />);

    expect(transparency).toContain("Partial history");
    expect(transparency).toContain("Unknown fields are not treated as zero");
    expect(transparency).not.toContain("Not applicable");
    expect(transparency).toContain("Unknown");
  });

  test("never adds grants from different token contracts into one amount", () => {
    const shareGrant = dashboard.snapshot.grantSummaries[0];
    if (!shareGrant?.state) throw new Error("Fixture grant missing");
    const externalGrant = {
      ...shareGrant,
      address: "0xe000000000000000000000000000000000000000" as Address,
      state: {
        ...shareGrant.state,
        address: "0xe000000000000000000000000000000000000000" as Address,
        token: paymentToken,
        tokenDecimals: 6,
        grantSize: 2_000_000n,
        settledAmount: 500_000n,
        unsettledAmount: 1_500_000n,
      },
      tokenMetadata: { address: paymentToken, decimals: 6, symbol: "USDC" },
    };
    const mixedTokenDashboard: ProductBoardroomDashboardState = {
      ...dashboard,
      snapshot: {
        ...dashboard.snapshot,
        grantSummaries: [shareGrant, externalGrant],
      },
    };

    const overview = renderToString(<ProjectOverviewPage account={owner} dashboard={mixedTokenDashboard} loading={false} />);
    const transparency = renderToString(<TransparencyPage dashboard={mixedTokenDashboard} loading={false} />);

    expect(overview).toContain("0.75 ATLAS unsettled project tokens");
    expect(transparency).toContain("Unsettled project-token grants");
    expect(transparency).toContain("0.75 ATLAS");
    expect(transparency).toContain("2 USDC");
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
    expect(studioGuidance("launched", dashboard).nextStep).toContain("scheduled operation");
    const studio = renderToString(<StudioPage account={owner} dashboard={dashboard} loading={false} />);
    expect(studio).toContain("Operate through governance");
    expect(studio).toContain("Project lifecycle");
    expect(studio).toContain("Operator tools");
  });

  test("renders explicit not-found, alerts-unavailable, and redirect states", () => {
    const notFound = renderToString(<NotFoundPage />);
    const alertsUnavailable = renderToString(<AlertsUnavailablePage returnHref="/explore" />);
    const redirect = renderToString(<RedirectState destination="/explore" />);

    expect(notFound).toContain("This page does not exist");
    expect(alertsUnavailable).toContain("Sentinel is not configured");
    expect(alertsUnavailable).toContain("Read-only product use remains available");
    expect(alertsUnavailable).toContain("never acts as an onchain transaction wallet");
    expect(alertsUnavailable).toContain('href="/explore"');
    expect(redirect).toContain("Opening the canonical workspace");
    expect(notFound).not.toContain("<main");
    expect(alertsUnavailable).not.toContain("<main");
    expect(redirect).not.toContain("<main");
  });

  test("uses a canonical anchor for grant-to-portfolio navigation", () => {
    const html = renderToString(
      <GrantDetailPage
        account={undefined}
        backHref="/pledge-cash/portfolio?chain=31337"
        grant={grant}
        onBack={() => undefined}
      >
        Grant settlement
      </GrantDetailPage>,
    );

    expect(html).toContain('href="/pledge-cash/portfolio?chain=31337"');
    expect(html).toContain("Return to Portfolio");
    expect(html).not.toContain(">Portfolio</button>");

    const projectReturn = renderToString(
      <GrantDetailPage
        account={undefined}
        backHref={`/pledge-cash/projects/31337/${boardroom}/overview`}
        backLabel="Return to Project"
        grant={grant}
        onBack={() => undefined}
      >
        Grant settlement
      </GrantDetailPage>,
    );
    expect(projectReturn).toContain(`href="/pledge-cash/projects/31337/${boardroom}/overview"`);
    expect(projectReturn).toContain("Return to Project");
  });

  test("renders one honest terminal grant-verification state with transient-only retry", () => {
    const invalid = renderToString(
      <GrantVerificationFailureState
        backHref="/pledge-cash/portfolio?chain=31337"
        grant={grant}
        kind="invalid"
        message="This address is not a grant created by the active deployment."
        onBack={() => undefined}
      />,
    );
    const transient = renderToString(
      <GrantVerificationFailureState
        backHref="/pledge-cash/explore?chain=31337"
        grant={grant}
        kind="transient"
        message="Could not reach Local Anvil to verify this grant."
        onBack={() => undefined}
        onRetry={() => undefined}
        returnLabel="Return to Explore"
      />,
    );
    const loading = renderToString(<GrantVerificationLoadingState grant={grant} />);

    expect(invalid).toContain("Grant not found");
    expect(invalid).toContain("Return to Portfolio");
    expect(invalid).toContain('href="/pledge-cash/portfolio?chain=31337"');
    expect(invalid).not.toContain("Retry verification");
    expect(invalid).not.toContain("source of truth");
    expect(invalid).not.toContain("Connect");
    expect(invalid).not.toContain("Settlement");
    expect(transient).toContain("Grant temporarily unavailable");
    expect(transient).toContain("Retry verification");
    expect(transient).toContain("Return to Explore");
    expect(loading).toContain("Verifying grant");
    expect(loading).toContain("factory provenance");
    expect(loading).not.toContain("source of truth");
    expect(loading).not.toContain("Connect");
  });

  test("uses loading-aware Studio copy for a selected project route", () => {
    const html = renderToString(
      <StudioPage
        loading
        operatorTools={<div>Loading the exact project state</div>}
        sectionNavigation={<nav aria-label="Studio sections">Setup</nav>}
      />,
    );

    expect(html).toContain("Loading selected project");
    expect(html).toContain("Verifying the selected project");
    expect(html).toContain("Wait for verified state");
    expect(html).not.toContain("No project selected");
    expect(html).not.toContain("Start with a project");
    expect(html).not.toContain("Create and operate projects");
    expect(html).not.toContain("Project lifecycle");
  });

  test("renders one page-level Studio primary action", () => {
    const html = renderToString(
      <StudioPage
        createAction={<button type="button">Connect test wallet</button>}
        loading={false}
        operatorTools={<div>Connect the operator wallet</div>}
        projectDirectoryContent={<div>Project directory</div>}
      />,
    );

    expect(html.match(/Connect test wallet/g)?.length).toBe(1);
    expect(html).toContain("Next safe action");
    expect(html).toContain("Projects");
  });

  test("gives address actions mobile-safe touch targets", () => {
    const html = renderToString(<AddressLink address={boardroom} />);

    expect(html).toContain(`aria-label="Copy address ${boardroom}"`);
    expect(html).toContain("h-11 w-11");
    expect(html).toContain("sm:h-9 sm:w-9");
  });
});
