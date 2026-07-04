import { describe, expect, test } from "bun:test";
import type { Address, DiscoveredBoardroom, DiscoveredDistribution, DiscoveredGrant, DiscoveredLockedLiquidity, DiscoveredPool } from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import { App, parseDeployment } from "../src/App";
import { BoardroomPanel } from "../src/features/boardrooms/boardroom-panel";
import { DiscoveryPanel } from "../src/features/discovery/discovery-panel";
import { AppHeader } from "../src/features/wallet/app-header";
import { PLEDGE_CASH_NETWORKS } from "../src/lib/contracts";
import {
  defaultBoardroomGrantForm,
  defaultCurveMigrationForm,
  defaultFixedPriceSaleForm,
  defaultLockedLiquidityExitForm,
  defaultLockedLiquidityForm,
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
  issuedDistributions: [sale],
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
  toBlock: 20n,
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
  test("renders core protocol sections without a browser", () => {
    const html = renderToString(<App />);

    expect(html).toContain("pledge.cash");
    expect(html).toContain("Deployment");
    expect(html).toContain("Local Anvil");
    expect(html).toContain("TokenGrantFactory");
    expect(html).toContain("Ready");
    expect(html).toContain("Direct Grant");
    expect(html).toContain("Inspect Grant");
    expect(html).toContain("Boardroom");
    expect(html).toContain("Discovery");
  });

  test("disables header network and wallet actions while an action is pending", () => {
    const noop = async () => undefined;
    const html = renderToString(
      <AppHeader
        chainId={31337}
        chainName="Local Anvil"
        connectWallet={noop}
        networks={PLEDGE_CASH_NETWORKS}
        onNetworkChange={() => undefined}
        pendingAction="scan-discovery"
        runAction={async (_label, action) => action()}
        switchChain={noop}
        wallet={{}}
      />,
    );

    expect(html).toContain('aria-label="Network"');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
  });

  test("renders discovery lists and cached scan status", () => {
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

    expect(html).toContain("Discovery Scan");
    expect(html).toContain("My Boardrooms");
    expect(html).toContain("My Grants");
    expect(html).toContain("Boardroom Obligations");
    expect(html).toContain("Pools And Liquidity");
    expect(html).toContain("Pledge Common");
    expect(html).toContain("Use Distribution");
    expect(html).toContain("Use Locker");
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
          snapshot: boardroomSnapshot.distributionSummaries[0].state,
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
    expect(html).toContain("Migrating Bonding Curve");
    expect(html).toContain("Locked Liquidity");
    expect(html).toContain("Wind-Down");
    expect(html).toContain("Winding down");
    expect(html).toContain("Open blockers");
    expect(html).toContain("Use Sale");
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

});
