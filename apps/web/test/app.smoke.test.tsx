import { describe, expect, test } from "bun:test";
import type { Address, DiscoveredGrant } from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import { App, parseDeployment } from "../src/App";
import { BoardroomPanel } from "../src/features/boardrooms/boardroom-panel";
import { MyGrantsPanel } from "../src/features/grants/my-grants-panel";
import {
  defaultBoardroomGrantForm,
  defaultCurveMigrationForm,
  defaultFixedPriceSaleForm,
  defaultLockedLiquidityExitForm,
  defaultLockedLiquidityForm,
  defaultMigratingCurveForm,
  defaultWindDownForm,
} from "../src/lib/forms";
import type { BoardroomSnapshot } from "../src/lib/types";

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

describe("web app shell", () => {
  test("renders core protocol sections without a browser", () => {
    const html = renderToString(<App />);

    expect(html).toContain("pledge.cash");
    expect(html).toContain("Deployment");
    expect(html).toContain("TokenGrantFactory");
    expect(html).toContain("Ready");
    expect(html).toContain("Direct Grant");
    expect(html).toContain("Inspect Grant");
    expect(html).toContain("Boardroom");
    expect(html).toContain("My Grants");
  });

  test("renders Boardroom workflow sections and wind-down blockers", () => {
    const noop = async () => undefined;
    const noopSetter = () => undefined;
    const html = renderToString(
      <BoardroomPanel
        boardroomAddress={boardroom}
        boardroomForm={{ owner: oldGrant.issuer, name: "Pledge Common", symbol: "PLDG", salt: oldGrant.salt }}
        boardroomGrantForm={defaultBoardroomGrantForm()}
        boardroomMintAmount="1000"
        boardroomMintTo={boardroom}
        boardroomSnapshot={boardroomSnapshot}
        clearBoardroomGrantPrediction={noopSetter}
        curveMigrationForm={defaultCurveMigrationForm()}
        deployment={{
          chainId: 31337,
          boardroomFactory: "0x7900000000000000000000000000000000000000",
          distributionFactory: "0x7600000000000000000000000000000000000000",
          lockedLiquidityFactory: "0x7700000000000000000000000000000000000000",
        }}
        fixedPriceSaleAddress={sale}
        fixedPriceSaleForm={defaultFixedPriceSaleForm()}
        fixedPriceSaleSnapshot={boardroomSnapshot.distributionSummaries[0].state}
        lockedLiquidityAddress={locker}
        lockedLiquidityExitForm={defaultLockedLiquidityExitForm()}
        lockedLiquidityForm={defaultLockedLiquidityForm()}
        lockedLiquiditySnapshot={boardroomSnapshot.lockedLiquiditySummaries[0].state}
        migratingCurveAddress=""
        migratingCurveForm={defaultMigratingCurveForm()}
        migratingCurveSnapshot={undefined}
        pendingAction={undefined}
        predictedBoardroom={boardroom}
        predictedBoardroomGrant={oldGrant.grantAddress}
        predictedFixedPriceSale={sale}
        predictedLockedLiquidity={locker}
        predictedMigratingCurve={undefined}
        setBoardroomAddress={noopSetter}
        setBoardroomForm={noopSetter}
        setBoardroomGrantForm={noopSetter}
        setBoardroomMintAmount={noopSetter}
        setBoardroomMintTo={noopSetter}
        setCurveMigrationForm={noopSetter}
        setFixedPriceSaleAddress={noopSetter}
        setFixedPriceSaleForm={noopSetter}
        setLockedLiquidityAddress={noopSetter}
        setLockedLiquidityExitForm={noopSetter}
        setLockedLiquidityForm={noopSetter}
        setMigratingCurveAddress={noopSetter}
        setMigratingCurveForm={noopSetter}
        setPredictedBoardroom={noopSetter}
        setWindDownForm={noopSetter}
        windDownForm={defaultWindDownForm()}
        boardroomApproveFactory={noop}
        boardroomCreateGrant={noop}
        boardroomCreateGrantBatch={noop}
        burnTreasuryShares={noop}
        cancelFixedPriceSale={noop}
        cancelMigratingCurve={noop}
        claimLockedLiquidityFees={noop}
        closeFixedPriceSale={noop}
        createBoardroom={noop}
        createFixedPriceSale={noop}
        createLockedLiquidity={noop}
        createMigratingCurve={noop}
        exitLockedLiquidity={noop}
        loadBoardroom={noop}
        loadFixedPriceSale={noop}
        loadLockedLiquidity={noop}
        loadMigratingCurve={noop}
        migrateCurve={noop}
        mintBoardroomShares={noop}
        openRedemptions={noop}
        predictBoardroom={noop}
        predictBoardroomGrantAddress={noop}
        predictFixedPriceSale={noop}
        predictLockedLiquidity={noop}
        predictMigratingCurve={noop}
        redeemBoardroomShares={noop}
        registerRedeemableAsset={noop}
        runAction={async (_label, action) => action()}
        startWindDown={noop}
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

  test("hides previously loaded grants after the wallet changes", () => {
    const html = renderToString(
      <MyGrantsPanel
        account="0x5000000000000000000000000000000000000000"
        deployment={{ chainId: 31337, tokenGrantFactory: "0x6000000000000000000000000000000000000000" }}
        fromBlock="0"
        includeClosed={false}
        inspectGrant={() => undefined}
        loadMyGrants={async () => undefined}
        myGrants={{
          held: [oldGrant],
          issued: [],
          loadedFor: "0x3000000000000000000000000000000000000000",
          fromBlock: 0n,
          includeClosed: false,
        }}
        pendingAction={undefined}
        runAction={async () => undefined}
        setFromBlock={() => undefined}
        setIncludeClosed={() => undefined}
      />,
    );

    expect(html).toContain("Held Grants");
    expect(html).not.toContain("0x1000...0000");
  });

  test("hides loaded grants after the query filters change", () => {
    const html = renderToString(
      <MyGrantsPanel
        account="0x3000000000000000000000000000000000000000"
        deployment={{ chainId: 31337, tokenGrantFactory: "0x6000000000000000000000000000000000000000" }}
        fromBlock="1"
        includeClosed={false}
        inspectGrant={() => undefined}
        loadMyGrants={async () => undefined}
        myGrants={{
          held: [oldGrant],
          issued: [],
          loadedFor: "0x3000000000000000000000000000000000000000",
          fromBlock: 0n,
          includeClosed: true,
        }}
        pendingAction={undefined}
        runAction={async () => undefined}
        setFromBlock={() => undefined}
        setIncludeClosed={() => undefined}
      />,
    );

    expect(html).toContain("Held Grants");
    expect(html).not.toContain("0x1000...0000");
  });
});
