import { describe, expect, test } from "bun:test";
import type {
  Address,
  DiscoveredBoardroom,
  DiscoveredDistribution,
  DiscoveredGrant,
  DiscoveredLockedLiquidity,
  DiscoveredPool,
  FixedPriceSaleState,
  MerkleAirdropState,
} from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import {
  AmmReadCoordinator,
  App,
  ammReadIdentityKey,
  appRouteTitle,
  canRunGrantIssuerActions,
  canonicalGrantReadErrorMessage,
  contextualAppRouteTitle,
  isGovernanceBackgroundRefresh,
  manageWorkspaceSummary,
  mergeCapabilityOpportunity,
  mergeProductBoardroomCatalog,
  networkSwitchDestination,
  parseDeployment,
  productReadErrorMessage,
  ProjectRouteFailureState,
  projectRouteFailure,
  raceWithGovernanceAbort,
  studioProjectSectionCapability,
  viewFromPath,
} from "../src/App";
import { Web3Provider } from "../src/components/web3-provider";
import type { BoardroomPanelCapabilities } from "../src/features/boardrooms/boardroom-panel-types";
import type { ProjectCapabilityMap } from "../src/features/capabilities/project-capabilities";
import { BoardroomPanel } from "../src/features/boardrooms/boardroom-panel";
import { DiscoveryPanel, WalletAccessPanel } from "../src/features/discovery/discovery-panel";
import { GrantInspector } from "../src/features/grants/grant-inspector";
import { AppHeader } from "../src/features/wallet/app-header";
import { PLEDGE_CASH_NETWORKS } from "../src/lib/contracts";
import { deploymentDiscoveryIdentity, discoveryStorageKey, resumeWalletAccessRange, walletAccessDiscoveryRange } from "../src/lib/discovery";
import {
  defaultBoardroomGrantForm,
  defaultCurveMigrationForm,
  defaultFixedPriceSaleForm,
  defaultLockedLiquidityExitForm,
  defaultLockedLiquidityForm,
  defaultMerkleAirdropForm,
  defaultMigratingCurveForm,
  defaultWindDownForm,
} from "../src/lib/forms";
import type { BoardroomSnapshot, DiscoverySnapshot } from "../src/lib/types";

const oldGrant: DiscoveredGrant = {
  grantAddress: "0x1000000000000000000000000000000000000000",
  tokenId: 1n,
  issuer: "0x2000000000000000000000000000000000000000",
  initialHolder: "0x3000000000000000000000000000000000000000",
  currentHolder: "0x3000000000000000000000000000000000000000",
  token: "0x4000000000000000000000000000000000000000",
  paymentToken: "0x0000000000000000000000000000000000000000",
  amount: 1n,
  price: 0n,
  expiry: 0n,
  vestingCliff: 0n,
  vestingEnd: 0n,
  transferable: false,
  transferUnlockTime: 0n,
  salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
  closed: false,
};

const boardroom = "0x7000000000000000000000000000000000000000" as Address;
const policyRegistry = "0x7100000000000000000000000000000000000000" as Address;
const shareToken = "0x7200000000000000000000000000000000000000" as Address;
const sale = "0x7300000000000000000000000000000000000000" as Address;
const airdrop = "0x7310000000000000000000000000000000000000" as Address;
const locker = "0x7400000000000000000000000000000000000000" as Address;
const pool = "0x7500000000000000000000000000000000000000" as Address;

const boardroomSnapshot: BoardroomSnapshot = {
  address: boardroom,
  owner: oldGrant.issuer,
  policyRegistry,
  shareToken,
  status: 1,
  redeemableAssets: [oldGrant.paymentToken],
  issuedGrants: [oldGrant.grantAddress],
  issuedDistributions: [sale, airdrop],
  lockedLiquidityPositions: [locker],
  grantSummaries: [
    {
      address: oldGrant.grantAddress,
      state: {
        address: oldGrant.grantAddress,
        issuer: boardroom,
        holder: oldGrant.currentHolder,
        token: shareToken,
        paymentToken: oldGrant.paymentToken,
        grantSize: 1000n,
        claimable: 100n,
        price: 0n,
        vestingCliff: 1000n,
        vestingEnd: 1800n,
        expiry: 2000n,
        settledAmount: 0n,
        settleable: 100n,
        halted: false,
        closed: false,
      },
    },
  ],
  distributionSummaries: [
    {
      address: sale,
      kind: "fixed-price-sale",
      state: {
        address: sale,
        factory: "0x7600000000000000000000000000000000000000" as Address,
        boardroom,
        shareToken,
        paymentToken: oldGrant.paymentToken,
        saleSupply: 1000n,
        remainingShares: 100n,
        price: 1n,
        maxPerBuyer: 0n,
        startTime: 1n,
        endTime: 2n,
        saleStatus: 0,
        closed: false,
      },
    },
    {
      address: airdrop,
      kind: "merkle-airdrop",
      state: {
        address: airdrop,
        factory: "0x7600000000000000000000000000000000000000" as Address,
        boardroom,
        shareToken,
        tokenGrantFactory: "0x7a000000000000000000000000000000000000000" as Address,
        airdropSupply: 500n,
        remainingShares: 250n,
        merkleRoot: oldGrant.salt,
        startTime: 1n,
        endTime: 2n,
        airdropStatus: 0,
        closed: false,
      },
    },
  ],
  lockedLiquiditySummaries: [
    {
      address: locker,
      state: {
        address: locker,
        factory: "0x7700000000000000000000000000000000000000" as Address,
        boardroom,
        router: "0x7800000000000000000000000000000000000000" as Address,
        tokenA: shareToken,
        tokenB: oldGrant.paymentToken,
        pool,
        seeded: true,
        lockedLiquidity: 10n,
      },
    },
  ],
};

const discoveredBoardroom: DiscoveredBoardroom = {
  boardroom,
  owner: oldGrant.issuer,
  policyRegistry,
  shareToken,
  name: "Pledge Common",
  symbol: "PLDG",
  salt: oldGrant.salt,
  createdAtBlock: 10n,
  transactionHash: "0x000000000000000000000000000000000000000000000000000000000000000a",
};

const discoveredDistribution: DiscoveredDistribution = {
  distribution: sale,
  boardroom,
  factory: "0x7600000000000000000000000000000000000000" as Address,
  kind: "fixed-price-sale",
  shareToken,
  paymentToken: oldGrant.paymentToken,
  shareAmount: 1000n,
  salt: oldGrant.salt,
  createdAtBlock: 11n,
  transactionHash: "0x000000000000000000000000000000000000000000000000000000000000000b",
};

const discoveredLocker: DiscoveredLockedLiquidity = {
  locker,
  boardroom,
  factory: "0x7700000000000000000000000000000000000000" as Address,
  pool,
  tokenA: shareToken,
  tokenB: oldGrant.paymentToken,
  amountA: 1000n,
  amountB: 2000n,
  liquidity: 3000n,
  salt: oldGrant.salt,
  createdAtBlock: 12n,
  transactionHash: "0x000000000000000000000000000000000000000000000000000000000000000c",
};

const discoveredPool: DiscoveredPool = {
  pool,
  factory: "0x7800000000000000000000000000000000000000" as Address,
  token0: shareToken,
  token1: oldGrant.paymentToken,
  poolCount: 1n,
  createdAtBlock: 9n,
  transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000009",
};

const discoverySnapshot: DiscoverySnapshot = {
  chainId: 31337,
  loadedFor: oldGrant.currentHolder,
  fromBlock: 0n,
  chunkSize: 5000n,
  lastScannedBlock: 20n,
  complete: true,
  errors: [],
  boardroomsByAddress: { [boardroom.toLowerCase()]: discoveredBoardroom },
  grantsByAddress: { [oldGrant.grantAddress.toLowerCase()]: oldGrant },
  distributionsByAddress: { [sale.toLowerCase()]: discoveredDistribution },
  lockersByAddress: { [locker.toLowerCase()]: discoveredLocker },
  poolsByAddress: { [pool.toLowerCase()]: discoveredPool },
};

describe("web app shell", () => {
  test("rejects deferred AMM results after account, project, or form identity changes", async () => {
    const coordinator = new AmmReadCoordinator();
    const firstKey = ammReadIdentityKey(["31337:deployment:account-a", "project-a", { amountIn: "1" }]);
    const nextKey = ammReadIdentityKey(["31337:deployment:account-b", "project-b", { amountIn: "2" }]);
    coordinator.sync("swap-quote", firstKey);
    const firstRequest = coordinator.begin("swap-quote", firstKey);
    let resolveDeferred: ((value: string) => void) | undefined;
    const deferred = new Promise<string>((resolve) => {
      resolveDeferred = resolve;
    });
    let committed: string | undefined;
    const pendingCommit = deferred.then((value) => {
      if (coordinator.isCurrent(firstRequest)) committed = value;
    });

    coordinator.sync("swap-quote", nextKey);
    coordinator.sync("swap-quote", firstKey);
    resolveDeferred?.("stale account A quote");
    await pendingCommit;

    expect(committed).toBeUndefined();
    const currentRequest = coordinator.begin("swap-quote", firstKey);
    expect(coordinator.isCurrent(currentRequest)).toBe(true);
  });

  test("classifies invalid project provenance as terminal and RPC failures as retryable", () => {
    const invalid = projectRouteFailure("This address is not a Boardroom created by the configured BoardroomFactory.");
    const transient = projectRouteFailure("Could not reach Local Anvil. Check the RPC connection and try again.");
    const throttled = projectRouteFailure("429 Too Many Requests");

    expect(invalid).toEqual({
      description: "This address is not a project created by the configured pledge.cash deployment on this network.",
      retryable: false,
      title: "Project not found",
    });
    expect(invalid.description).not.toContain("Transparency");
    expect(transient.retryable).toBe(true);
    expect(transient.title).toBe("Project temporarily unavailable");
    expect(throttled.retryable).toBe(true);
    expect(throttled.title).toBe("Project temporarily unavailable");
  });

  test("renders one canonical invalid-project state and offers retry only for transport failures", () => {
    const invalid = renderToString(
      <ProjectRouteFailureState
        failure={projectRouteFailure("This address is not a Boardroom created by the configured BoardroomFactory.")}
        onReturn={() => undefined}
        returnHref="/pledge-cash/explore?chain=31337"
      />,
    );
    const transient = renderToString(
      <ProjectRouteFailureState
        failure={projectRouteFailure("Could not reach Local Anvil. Check the RPC connection and try again.")}
        onRetry={() => undefined}
        onReturn={() => undefined}
        returnHref="/pledge-cash/explore?chain=31337"
      />,
    );

    expect(invalid.match(/Project not found/g)?.length).toBe(1);
    expect(invalid.match(/Return to Explore/g)?.length).toBe(1);
    expect(invalid).not.toContain("Retry verification");
    expect(invalid).not.toContain("Transparency");
    expect(transient.match(/Retry verification/g)?.length).toBe(1);
  });

  test("preserves the verified governance snapshot only for same-key background refreshes", () => {
    const key = "998:deployment:0xboardroom:read-only";

    expect(isGovernanceBackgroundRefresh(key, key)).toBe(true);
    expect(isGovernanceBackgroundRefresh(undefined, key)).toBe(false);
    expect(isGovernanceBackgroundRefresh("10143:other", key)).toBe(false);
  });

  test("governance deadlines reject even when route loading ignores cancellation", async () => {
    const controller = new AbortController();
    const routeLoad = new Promise<never>(() => undefined);
    const guarded = raceWithGovernanceAbort(routeLoad, controller.signal);
    const timeout = new Error("Governance loading timed out. Try again.");
    timeout.name = "TimeoutError";

    controller.abort(timeout);

    await expect(guarded).rejects.toBe(timeout);
  });

  test("renders product workspace sections without a browser", () => {
    const html = renderToString(
      <Web3Provider>
        <App />
      </Web3Provider>,
    );

    expect(html).toContain("pledge.cash");
    expect(html).toContain("Project directory");
    expect(html).toContain("Search projects");
    expect(html).toContain("Explore");
    expect(html).toContain("Portfolio");
    expect(html).toContain("Studio");
    expect(html).toContain('href="#app-main-content"');
    expect(html).toContain("Skip to main content");
    expect(html).toContain("No projects discovered");
    expect(html).not.toContain("Project workspace");
    expect(html).not.toContain("Market");
    expect(html).not.toContain("Manage");
    expect(html).not.toContain("Activity");
    expect(html).not.toContain("Sentinel");
    expect(html).not.toContain("Alerts");
    expect(html).not.toContain("Deployment");
    expect(html).not.toContain("Artifact");
    expect(html).not.toContain("TokenGrantFactory");
    expect(html).not.toContain("Positions");
    expect(html).not.toContain("Advanced");
    expect(html).not.toContain("Project Overview");
  });

  test("keeps legacy workspace routes while using product labels", () => {
    expect(viewFromPath("/wallet")).toBe("wallet");
    expect(viewFromPath("/positions")).toBe("wallet");
    expect(viewFromPath("/portfolio")).toBe("wallet");
    expect(viewFromPath("/notifications")).toBe("project");
    expect(viewFromPath("/sentinel")).toBe("project");
    expect(viewFromPath("/notifications", { VITE_SENTINEL_API_URL: "https://api.example.test" })).toBe("notifications");
    expect(viewFromPath("/tools")).toBe("advanced");
    expect(viewFromPath("/advanced")).toBe("advanced");
  });

  test("disables header network and wallet actions while an action is pending", () => {
    const noop = async () => undefined;
    const html = renderToString(
      <Web3Provider>
        <AppHeader
          chainId={31337}
          chainName="Local Anvil"
          networks={PLEDGE_CASH_NETWORKS}
          onNetworkChange={() => undefined}
          pendingAction="scan-discovery"
          runAction={async (_label, action) => action()}
          switchChain={noop}
          wallet={{}}
        />
      </Web3Provider>,
    );

    expect(html).toContain('aria-label="Network"');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("renders discovery diagnostics with manual scan controls", () => {
    const noop = async () => undefined;
    const html = renderToString(
      <DiscoveryPanel
        account={oldGrant.currentHolder}
        deployment={{ chainId: 31337 }}
        discovery={discoverySnapshot}
        discoveryForm={{ fromBlock: "0", toBlock: "20", chunkSize: "5000", includeClosedGrants: false }}
        pendingAction={undefined}
        clearDiscovery={() => undefined}
        inspectGrant={() => undefined}
        resumeDiscovery={noop}
        runAction={async (_label, action) => action()}
        scanDiscovery={noop}
        setDiscoveryForm={() => undefined}
        useBoardroom={() => undefined}
        useDistribution={() => undefined}
        useLockedLiquidity={() => undefined}
      />,
    );

    expect(html).toContain("Discovery Diagnostics");
    expect(html).toContain("Manual log range controls");
    expect(html).toContain("From block");
    expect(html).toContain("Chunk size");
    expect(html).toContain("Resume");
    expect(html).toContain("Clear Cache");
    expect(html).toContain("My Boardrooms");
    expect(html).toContain("My Grants");
    expect(html).toContain("Boardroom Obligations");
    expect(html).toContain("Pools And Liquidity");
    expect(html).toContain("Pledge Common");
    expect(html).toContain("Use Distribution");
    expect(html).toContain("Use Locker");
  });

  test("gates discovery diagnostics actions while wallet sync is pending", () => {
    const noop = async () => undefined;
    const html = renderToString(
      <DiscoveryPanel
        account={oldGrant.currentHolder}
        deployment={{ chainId: 31337 }}
        discovery={discoverySnapshot}
        discoveryForm={{ fromBlock: "0", toBlock: "20", chunkSize: "5000", includeClosedGrants: false }}
        pendingAction="scan-discovery"
        clearDiscovery={() => undefined}
        inspectGrant={() => undefined}
        resumeDiscovery={noop}
        runAction={async (_label, action) => action()}
        scanDiscovery={noop}
        setDiscoveryForm={() => undefined}
        useBoardroom={() => undefined}
        useDistribution={() => undefined}
        useLockedLiquidity={() => undefined}
      />,
    );

    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("renders wallet access without exposing manual discovery controls", () => {
    const noop = async () => undefined;
    const html = renderToString(
      <WalletAccessPanel
        account={oldGrant.currentHolder}
        deployment={{ chainId: 31337 }}
        discovery={discoverySnapshot}
        discoveryForm={{ fromBlock: "0", toBlock: "20", chunkSize: "5000", includeClosedGrants: false }}
        pendingAction={undefined}
        inspectGrant={() => undefined}
        runAction={async (_label, action) => action()}
        scanDiscovery={noop}
        useBoardroom={() => undefined}
        useDistribution={() => undefined}
        useLockedLiquidity={() => undefined}
      />,
    );

    expect(html).toContain("Your Access");
    expect(html).toContain("Wallet-linked Boardrooms");
    expect(html).toContain("Ready");
    expect(html).toContain("Boardrooms you manage");
    expect(html).toContain("Grants for this wallet");
    expect(html).toContain("Pledge Common");
    expect(html).toContain("Refresh access");
    expect(html).toContain("Open grant");
    expect(html).not.toContain("From block");
    expect(html).not.toContain("Chunk size");
    expect(html).not.toContain("Discovery Diagnostics");
    expect(html).not.toContain("Clear Cache");
  });

  test("warns when wallet access is backed by a limited diagnostics scan", () => {
    const noop = async () => undefined;
    const html = renderToString(
      <WalletAccessPanel
        account={oldGrant.currentHolder}
        deployment={{ chainId: 31337 }}
        discovery={{ ...discoverySnapshot, toBlock: 20n }}
        discoveryForm={{ fromBlock: "0", toBlock: "20", chunkSize: "5000", includeClosedGrants: false }}
        pendingAction={undefined}
        inspectGrant={() => undefined}
        runAction={async (_label, action) => action()}
        scanDiscovery={noop}
        useBoardroom={() => undefined}
        useDistribution={() => undefined}
        useLockedLiquidity={() => undefined}
      />,
    );

    expect(html).toContain("Limited range");
    expect(html).toContain("Use Discovery Diagnostics in Tools for a deeper historical scan.");
  });

  test("does not warn for deployment-bounded wallet access scans", () => {
    const noop = async () => undefined;
    const html = renderToString(
      <WalletAccessPanel
        account={oldGrant.currentHolder}
        deployment={{ chainId: 31337 }}
        discovery={{ ...discoverySnapshot, fromBlock: 10n, rangeMode: "deployment" }}
        discoveryForm={{ fromBlock: "0", toBlock: "20", chunkSize: "5000", includeClosedGrants: false }}
        pendingAction={undefined}
        inspectGrant={() => undefined}
        runAction={async (_label, action) => action()}
        scanDiscovery={noop}
        useBoardroom={() => undefined}
        useDistribution={() => undefined}
        useLockedLiquidity={() => undefined}
      />,
    );

    expect(html).toContain("Ready");
    expect(html).not.toContain("Limited range");
  });

  test("does not warn when a recent fallback scan still starts at genesis", () => {
    const noop = async () => undefined;
    const html = renderToString(
      <WalletAccessPanel
        account={oldGrant.currentHolder}
        deployment={{ chainId: 31337 }}
        discovery={{ ...discoverySnapshot, fromBlock: 0n, rangeMode: "recent" }}
        discoveryForm={{ fromBlock: "0", toBlock: "20", chunkSize: "5000", includeClosedGrants: false }}
        pendingAction={undefined}
        inspectGrant={() => undefined}
        runAction={async (_label, action) => action()}
        scanDiscovery={noop}
        useBoardroom={() => undefined}
        useDistribution={() => undefined}
        useLockedLiquidity={() => undefined}
      />,
    );

    expect(html).toContain("Ready");
    expect(html).not.toContain("Limited range");
  });

  test("derives wallet access scans from deployment timestamps", async () => {
    const calls: bigint[] = [];
    const client = {
      async getBlock(args?: { blockNumber?: bigint }): Promise<{ number: bigint | null; timestamp: bigint }> {
        const number = args?.blockNumber ?? 100n;
        calls.push(number);
        return { number, timestamp: 1_000n + number * 12n };
      },
    };

    const range = await walletAccessDiscoveryRange(client, { chainId: 31337, deploymentTimestamp: 1_700n });

    expect(range.rangeMode).toBe("deployment");
    expect(range.fromBlock).toBe(9n);
    expect(range.chunkSize).toBe(5000n);
    expect(calls.length).toBeGreaterThan(1);
  });

  test("falls back to a recent bounded wallet access scan without deployment timestamps", async () => {
    const client = {
      async getBlock(): Promise<{ number: bigint | null; timestamp: bigint }> {
        return { number: 150_000n, timestamp: 1_000n };
      },
    };

    const range = await walletAccessDiscoveryRange(client, { chainId: 31337 });

    expect(range.rangeMode).toBe("recent");
    expect(range.fromBlock).toBe(50_000n);
    expect(range.chunkSize).toBe(5000n);
  });

  test("resumes existing recent wallet access scans without jumping rolling windows", () => {
    const range = resumeWalletAccessRange(
      { fromBlock: 300_000n, chunkSize: 5000n, rangeMode: "recent" },
      { ...discoverySnapshot, rangeMode: "recent", fromBlock: 100_000n, lastScannedBlock: 200_000n },
    );

    expect(range.fromBlock).toBe(200_001n);
    expect(range.rangeMode).toBe("recent");
  });

  test("resumes cached deployment wallet access scans on reconnect", () => {
    const range = resumeWalletAccessRange(
      { fromBlock: 50n, chunkSize: 5000n, rangeMode: "deployment" },
      { ...discoverySnapshot, rangeMode: "deployment", fromBlock: 50n, lastScannedBlock: 200_000n },
    );

    expect(range.fromBlock).toBe(200_001n);
    expect(range.rangeMode).toBe("deployment");
  });

  test("does not resume manual diagnostics caches as wallet access scans", () => {
    const range = resumeWalletAccessRange(
      { fromBlock: 50n, chunkSize: 5000n, rangeMode: "deployment" },
      { ...discoverySnapshot, rangeMode: "manual", fromBlock: 10_000n, lastScannedBlock: 20_000n },
    );

    expect(range.fromBlock).toBe(50n);
    expect(range.rangeMode).toBe("deployment");
  });

  test("scopes wallet discovery cache keys by deployment identity", () => {
    const firstIdentity = deploymentDiscoveryIdentity({
      chainId: 31337,
      boardroomFactory: "0x7900000000000000000000000000000000000000",
      tokenGrantFactory: "0x7a00000000000000000000000000000000000000",
    });
    const secondIdentity = deploymentDiscoveryIdentity({
      chainId: 31337,
      boardroomFactory: "0x8900000000000000000000000000000000000000",
      tokenGrantFactory: "0x8a00000000000000000000000000000000000000",
    });

    expect(firstIdentity).not.toBe(secondIdentity);
    expect(discoveryStorageKey(31337, oldGrant.currentHolder, firstIdentity)).not.toBe(
      discoveryStorageKey(31337, oldGrant.currentHolder, secondIdentity),
    );
  });

  test("scopes deterministic wallet discovery caches by deployment timestamp", () => {
    const oldIdentity = deploymentDiscoveryIdentity({
      chainId: 31337,
      deploymentTimestamp: 1_000n,
      boardroomFactory: "0x7900000000000000000000000000000000000000",
      tokenGrantFactory: "0x7a00000000000000000000000000000000000000",
    });
    const newIdentity = deploymentDiscoveryIdentity({
      chainId: 31337,
      deploymentTimestamp: 2_000n,
      boardroomFactory: "0x7900000000000000000000000000000000000000",
      tokenGrantFactory: "0x7a00000000000000000000000000000000000000",
    });

    expect(oldIdentity).not.toBe(newIdentity);
    expect(discoveryStorageKey(31337, oldGrant.currentHolder, oldIdentity)).not.toBe(
      discoveryStorageKey(31337, oldGrant.currentHolder, newIdentity),
    );
  });

  test("keeps grant settlement scoped to the current holder wallet", () => {
    const holderHtml = renderGrantInspector(oldGrant.currentHolder, false);
    const observerHtml = renderGrantInspector("0x5000000000000000000000000000000000000000", false);

    expect(holderHtml).toContain("Grant holder");
    expect(holderHtml).not.toContain("Settlement is only available to the current grant holder wallet.");
    expect(holderHtml).not.toContain("Issuer Controls");
    expect(observerHtml).toContain("Observer");
    expect(observerHtml).toContain("Settlement is only available to the current grant holder wallet.");
    expect(observerHtml).not.toContain("Issuer Controls");
  });

  test("shows issuer controls only when issuer actions are available", () => {
    const issuerHtml = renderGrantInspector(oldGrant.issuer, true);

    expect(issuerHtml).toContain("Issuer controls");
    expect(issuerHtml).toContain("Issuer Controls");
    expect(issuerHtml).toContain("Halt Vesting");
    expect(issuerHtml).toContain("Withdraw Expired");
  });

  test("keeps grant authority visible but blocks writes on the wrong chain", () => {
    const html = renderGrantInspector(oldGrant.issuer, true, {
      status: "switch",
      reason: "Switch your wallet to chain 31337 to continue.",
    });

    expect(html).toContain("Issuer Controls");
    expect(html).toContain("Switch your wallet to chain 31337 to continue.");
    expect(html).toContain("disabled=\"\"");
  });

  test("allows Boardroom owners to operate directly loaded Boardroom grants", () => {
    const grant = boardroomSnapshot.grantSummaries[0].state;

    expect(canRunGrantIssuerActions(oldGrant.issuer, grant, {
      boardroom,
      executor: oldGrant.issuer,
      launched: false,
      owner: oldGrant.issuer,
      status: 0,
    })).toBe(true);
    expect(
      canRunGrantIssuerActions("0x5000000000000000000000000000000000000000", grant, {
        boardroom,
        executor: oldGrant.issuer,
        launched: false,
        owner: oldGrant.issuer,
        status: 0,
      }),
    ).toBe(false);
  });

  test("moves Boardroom grant issuer controls to the launched executor", () => {
    const grant = boardroomSnapshot.grantSummaries[0].state;
    const executor = "0x6000000000000000000000000000000000000000";
    const access = { boardroom, executor, launched: true, owner: oldGrant.issuer, status: 0 };

    expect(canRunGrantIssuerActions(executor, grant, access)).toBe(true);
    expect(canRunGrantIssuerActions(oldGrant.issuer, grant, access)).toBe(false);
  });

  test("gates every canonical Studio action section before mounting controls", () => {
    const hidden = { status: "hidden" as const };
    const blocked = { status: "blocked" as const, reason: "Only the project operator can continue." };
    const enabled = { status: "enabled" as const };
    const projectCapabilities = new Proxy({}, { get: () => hidden }) as ProjectCapabilityMap;
    const boardroomCapabilities = {
      claimRedemption: blocked,
      createBoardroom: hidden,
      createDistribution: blocked,
      createGrant: blocked,
      createLiquidity: blocked,
      manageDistribution: blocked,
      manageLiquidity: blocked,
      mint: blocked,
      permissionlessWindDown: blocked,
      redeem: blocked,
      registerRedeemableAsset: blocked,
      startWindDown: blocked,
    } satisfies BoardroomPanelCapabilities;
    const sections = ["setup", "token", "grants", "distributions", "liquidity", "governance", "close"] as const;

    for (const section of sections) {
      expect(studioProjectSectionCapability(
        section,
        { status: "connect", reason: "Connect a wallet to continue." },
        blocked,
        projectCapabilities,
        boardroomCapabilities,
      ).status).toBe("connect");
    }
    expect(studioProjectSectionCapability("setup", enabled, blocked, projectCapabilities, boardroomCapabilities)).toEqual(blocked);
    expect(studioProjectSectionCapability("grants", enabled, blocked, projectCapabilities, boardroomCapabilities)).toEqual(blocked);
    expect(studioProjectSectionCapability("grants", enabled, enabled, projectCapabilities, {
      ...boardroomCapabilities,
      createGrant: enabled,
    })).toEqual(enabled);
  });

  test("allows permissionless Boardroom grant cleanup during wind-down", () => {
    const grant = boardroomSnapshot.grantSummaries[0].state;
    const observer = "0x5000000000000000000000000000000000000000";
    const access = { boardroom, executor: oldGrant.issuer, launched: true, owner: oldGrant.issuer, status: 1 };

    expect(canRunGrantIssuerActions(observer, grant, access)).toBe(true);
  });

  test("bases Manage badges on the selected Boardroom state", () => {
    expect(manageWorkspaceSummary(oldGrant.issuer, boardroom, boardroomSnapshot)).toMatchObject({
      roleLabel: "Owner wallet",
      statusLabel: "Winding down",
    });
    expect(manageWorkspaceSummary(oldGrant.issuer, boardroom, undefined)).toMatchObject({
      roleLabel: "Load Boardroom",
      statusLabel: "Selected Boardroom not loaded",
      statusTone: "warning",
    });
  });

  test("hides cached discovery rows after the wallet changes", () => {
    const noop = async () => undefined;
    const html = renderToString(
      <DiscoveryPanel
        account="0x5000000000000000000000000000000000000000"
        deployment={{ chainId: 31337 }}
        discovery={discoverySnapshot}
        discoveryForm={{ fromBlock: "0", toBlock: "20", chunkSize: "5000", includeClosedGrants: false }}
        pendingAction={undefined}
        clearDiscovery={() => undefined}
        inspectGrant={() => undefined}
        resumeDiscovery={noop}
        runAction={async (_label, action) => action()}
        scanDiscovery={noop}
        setDiscoveryForm={() => undefined}
        useBoardroom={() => undefined}
        useDistribution={() => undefined}
        useLockedLiquidity={() => undefined}
      />,
    );

    expect(html).toContain("My Boardrooms");
    expect(html).not.toContain("Pledge Common");
    expect(html).not.toContain("0x1000...0000");
  });

  test("renders Boardroom workflow sections and wind-down blockers", () => {
    const noop = async () => undefined;
    const noopSetter = () => undefined;
    const html = renderToString(
      <BoardroomPanel
        boardroom={{
          address: boardroom,
          form: { owner: oldGrant.issuer, name: "Pledge Common", symbol: "PLDG", salt: oldGrant.salt },
          mintAmount: "1000",
          mintTo: boardroom,
          predicted: boardroom,
          snapshot: boardroomSnapshot,
          create: noop,
          load: noop,
          mintShares: noop,
          predict: noop,
          setBoardroomAddress: noopSetter,
          setBoardroomForm: noopSetter,
          setBoardroomMintAmount: noopSetter,
          setBoardroomMintTo: noopSetter,
          setPredictedBoardroom: noopSetter,
        }}
        fixedPriceSale={{
          address: sale,
          form: defaultFixedPriceSaleForm(),
          predicted: sale,
          snapshot: boardroomSnapshot.distributionSummaries[0].state as FixedPriceSaleState,
          cancel: noop,
          close: noop,
          create: noop,
          load: noop,
          predict: noop,
          setFixedPriceSaleAddress: noopSetter,
          setFixedPriceSaleForm: noopSetter,
        }}
        grant={{
          form: defaultBoardroomGrantForm(),
          predicted: oldGrant.grantAddress,
          approveFactory: noop,
          clearPrediction: noopSetter,
          create: noop,
          createBatch: noop,
          predict: noop,
          setForm: noopSetter,
        }}
        lockedLiquidity={{
          address: locker,
          exitForm: defaultLockedLiquidityExitForm(),
          form: defaultLockedLiquidityForm(),
          predicted: locker,
          snapshot: boardroomSnapshot.lockedLiquiditySummaries[0].state,
          claimFees: noop,
          create: noop,
          exit: noop,
          load: noop,
          predict: noop,
          setLockedLiquidityAddress: noopSetter,
          setLockedLiquidityExitForm: noopSetter,
          setLockedLiquidityForm: noopSetter,
        }}
        merkleAirdrop={{
          address: airdrop,
          form: defaultMerkleAirdropForm(),
          predicted: airdrop,
          snapshot: boardroomSnapshot.distributionSummaries[1].state as MerkleAirdropState,
          cancel: noop,
          close: noop,
          create: noop,
          load: noop,
          predict: noop,
          setMerkleAirdropAddress: noopSetter,
          setMerkleAirdropForm: noopSetter,
        }}
        migratingCurve={{
          address: "",
          form: defaultMigratingCurveForm(),
          migrationForm: defaultCurveMigrationForm(),
          predicted: undefined,
          snapshot: undefined,
          cancel: noop,
          create: noop,
          load: noop,
          migrate: noop,
          predict: noop,
          setCurveMigrationForm: noopSetter,
          setMigratingCurveAddress: noopSetter,
          setMigratingCurveForm: noopSetter,
        }}
        windDown={{
          form: defaultWindDownForm(),
          burnTreasuryShares: noop,
          claimRedemptionAsset: noop,
          openRedemptions: noop,
          redeemShares: noop,
          registerRedeemableAsset: noop,
          setForm: noopSetter,
          start: noop,
        }}
        workflow={{
          deployment: {
            chainId: 31337,
            boardroomFactory: "0x7900000000000000000000000000000000000000",
            distributionFactory: "0x7600000000000000000000000000000000000000",
            lockedLiquidityFactory: "0x7700000000000000000000000000000000000000",
          },
          pendingAction: undefined,
          runAction: async (_label, action) => action(),
        }}
      />,
    );

    expect(html).toContain("Fixed-Price Sale");
    expect(html).toContain("Merkle Airdrop");
    expect(html).toContain("Migrating Bonding Curve");
    expect(html).toContain("Locked Liquidity");
    expect(html).toContain("Wind-Down");
    expect(html).toContain("Winding down");
    expect(html).toContain("Open blockers");
    expect(html).toContain("Vesting schedule");
    expect(html).toContain("Settleable now");
    expect(html).toContain("Use Sale");
    expect(html).toContain("Use Airdrop");
    expect(html).toContain("Use Locker");
  });

  test("preserves exact bigint values from runtime deployment artifacts", () => {
    const deployment = parseDeployment(`{
      "chainId": 31337,
      "creationFee": 100000000000000001,
      "deploymentTimestamp": 178264485400000000001
    }`);

    expect(deployment.creationFee).toBe(100000000000000001n);
    expect(deployment.deploymentTimestamp).toBe(178264485400000000001n);
  });

  test("keeps participation available when a later historical distribution is closed", () => {
    expect(mergeCapabilityOpportunity(
      { available: true },
      { available: false, reason: "The historical sale is closed." },
    )).toEqual({ available: true });
  });

  test("accumulates catalog pages without duplicating refreshed projects", () => {
    const first = { address: "0x1000000000000000000000000000000000000000" as Address, name: "First" };
    const second = { address: "0x2000000000000000000000000000000000000000" as Address, name: "Second" };

    expect(mergeProductBoardroomCatalog([first], [{ ...first, name: "First refreshed" }, second])).toEqual([
      { ...first, name: "First refreshed" },
      second,
    ]);
  });

  test("turns RPC transport failures into a concise recovery message", () => {
    expect(productReadErrorMessage(new Error("HTTP request failed. Raw Call Arguments: 0x1234"), "Local RPC"))
      .toBe("Could not reach Local RPC. Check the RPC connection and try again.");
  });

  test("keeps canonical grant failures concise and distinguishes transport errors", () => {
    const raw = new Error("ContractFunctionExecutionError: Contract Call: 0x1234567890 docs.example/version/2.0.0");

    expect(canonicalGrantReadErrorMessage(raw, "Local RPC"))
      .toBe("pledge.cash could not confirm that this address is a grant from the active deployment. Check the address and network, then try again.");
    expect(canonicalGrantReadErrorMessage(new Error("HTTP request failed"), "Local RPC"))
      .toBe("Could not reach Local RPC to verify this grant. Check the RPC connection and try again.");
  });

  test("names canonical routes for browser titles and assistive announcements", () => {
    expect(appRouteTitle({ kind: "explore", chainId: 31337 })).toBe("Project directory");
    expect(appRouteTitle({ kind: "project", chainId: 31337, boardroom, section: "governance" })).toBe("Project governance");
    expect(appRouteTitle({ kind: "studio-project", chainId: 31337, boardroom, section: "grants" })).toBe("Studio grant management");
    expect(contextualAppRouteTitle({ kind: "project", chainId: 31337, boardroom, section: "overview" }, "Seed Labs Common"))
      .toBe("Seed Labs Common — Overview");
    expect(contextualAppRouteTitle({ kind: "studio-project", chainId: 31337, boardroom, section: "grants" }, "Seed Labs Common"))
      .toBe("Seed Labs Common — Studio grant management");
    expect(contextualAppRouteTitle({ kind: "grant", chainId: 31337, grant: oldGrant.grantAddress }))
      .toContain("Grant 0x1000");
  });

  test("leaves a chain-bound grant route before switching networks", () => {
    expect(networkSwitchDestination({ kind: "grant", chainId: 31337, grant: oldGrant.grantAddress }, 998))
      .toEqual({ kind: "portfolio", chainId: 998 });
  });

});

function renderGrantInspector(
  account: Address,
  issuerActionsAvailable: boolean,
  actionCapability: { status: "enabled" | "switch"; reason?: string } = { status: "enabled" },
): string {
  const noop = async () => undefined;
  const noopSetter = () => undefined;

  return renderToString(
    <GrantInspector
      account={account}
      actionCapability={actionCapability}
      approvePayment={noop}
      grantAddress={oldGrant.grantAddress}
      grantSnapshot={boardroomSnapshot.grantSummaries[0].state}
      haltGrant={noop}
      issuerActionsAvailable={issuerActionsAvailable}
      loadGrant={noop}
      paymentApproval="0"
      pendingAction={undefined}
      runAction={async (_label, action) => action()}
      setGrantAddress={noopSetter}
      setPaymentApproval={noopSetter}
      setSettleAmount={noopSetter}
      settleAmount="100"
      settleGrant={noop}
      withdrawExpired={noop}
    />,
  );
}
