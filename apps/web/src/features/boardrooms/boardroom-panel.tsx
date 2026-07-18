import type {
  Address,
  BondMarketState,
  FixedPriceSaleState,
  LockedLiquidityState,
  MerkleAirdropState,
  MigratingBondingCurveState,
  PledgeCashDeployment,
} from "@pledge.cash/sdk";
import {
  CheckCircle2,
  Coins,
  Flame,
  Gift,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Wand2,
  XCircle,
} from "lucide-react";
import type React from "react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { ActionButton, ActionRow, AddressLink, Facts, Field, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { dateString, randomSalt } from "../../lib/forms";
import { formatTokenAmount } from "../../lib/token-amounts";
import type { Capability } from "../capabilities/project-capabilities";
import type {
  BoardroomForm,
  BondMarketForm,
  BoardroomDistributionSnapshot,
  BoardroomGrantForm,
  BoardroomLockedLiquiditySnapshot,
  BoardroomSnapshot,
  CurveMigrationForm,
  FixedPriceSaleForm,
  LockedLiquidityExitForm,
  LockedLiquidityForm,
  MerkleAirdropForm,
  MigratingCurveForm,
  WindDownForm,
} from "../../lib/types";
import { ObligationLists } from "./boardroom-obligations";
import {
  airdropStatusLabel,
  boardroomStatusLabel,
  boardroomStatusTone,
  curveStatusLabel,
  distributionSummaryFor,
  lockerSummaryFor,
  saleStatusLabel,
  setFormField,
  StatusBadge,
  TextField,
  windDownBlockers,
  type BoardroomFact,
} from "./boardroom-panel-shared";
import type { BoardroomPanelProps } from "./boardroom-panel-types";

export function BoardroomPanel({
  section = "all",
  boardroomIdentityLocked = false,
  capabilities,
  boardroom,
  bondMarket,
  fixedPriceSale,
  grant,
  lockedLiquidity,
  merkleAirdrop,
  migratingCurve,
  windDown,
  workflow,
}: BoardroomPanelProps): React.JSX.Element {
  const [distributionTool, setDistributionTool] = useState<"airdrop" | "bond" | "curve" | "fixed-price">("fixed-price");
  const { deployment, pendingAction, runAction } = workflow;
  const {
    address: boardroomAddress,
    form: boardroomForm,
    mintAmount: boardroomMintAmount,
    mintTo: boardroomMintTo,
    predicted: predictedBoardroom,
    snapshot: boardroomSnapshot,
    create: createBoardroom,
    load: loadBoardroom,
    mintShares: mintBoardroomShares,
    predict: predictBoardroom,
    setBoardroomAddress,
    setBoardroomForm,
    setBoardroomMintAmount,
    setBoardroomMintTo,
    setPredictedBoardroom,
  } = boardroom;
  const {
    address: bondMarketAddress,
    form: bondMarketForm,
    predicted: predictedBondMarket,
    snapshot: bondMarketSnapshot,
    close: closeBondMarket,
    create: createBondMarket,
    load: loadBondMarket,
    predict: predictBondMarket,
    setAddress: setBondMarketAddress,
    setForm: setBondMarketForm,
  } = bondMarket;
  const {
    form: boardroomGrantForm,
    predicted: predictedBoardroomGrant,
    approveFactory: boardroomApproveFactory,
    clearPrediction: clearBoardroomGrantPrediction,
    create: boardroomCreateGrant,
    createBatch: boardroomCreateGrantBatch,
    predict: predictBoardroomGrantAddress,
    setForm: setBoardroomGrantForm,
  } = grant;
  const {
    address: fixedPriceSaleAddress,
    form: fixedPriceSaleForm,
    predicted: predictedFixedPriceSale,
    snapshot: fixedPriceSaleSnapshot,
    cancel: cancelFixedPriceSale,
    close: closeFixedPriceSale,
    create: createFixedPriceSale,
    load: loadFixedPriceSale,
    predict: predictFixedPriceSale,
    setFixedPriceSaleAddress,
    setFixedPriceSaleForm,
  } = fixedPriceSale;
  const {
    address: merkleAirdropAddress,
    form: merkleAirdropForm,
    predicted: predictedMerkleAirdrop,
    snapshot: merkleAirdropSnapshot,
    cancel: cancelMerkleAirdrop,
    close: closeMerkleAirdrop,
    create: createMerkleAirdrop,
    load: loadMerkleAirdrop,
    predict: predictMerkleAirdrop,
    setMerkleAirdropAddress,
    setMerkleAirdropForm,
  } = merkleAirdrop;
  const {
    address: migratingCurveAddress,
    form: migratingCurveForm,
    migrationForm: curveMigrationForm,
    predicted: predictedMigratingCurve,
    snapshot: migratingCurveSnapshot,
    cancel: cancelMigratingCurve,
    create: createMigratingCurve,
    load: loadMigratingCurve,
    migrate: migrateCurve,
    predict: predictMigratingCurve,
    setCurveMigrationForm,
    setMigratingCurveAddress,
    setMigratingCurveForm,
  } = migratingCurve;
  const {
    address: lockedLiquidityAddress,
    exitForm: lockedLiquidityExitForm,
    form: lockedLiquidityForm,
    predicted: predictedLockedLiquidity,
    snapshot: lockedLiquiditySnapshot,
    claimFees: claimLockedLiquidityFees,
    create: createLockedLiquidity,
    exit: exitLockedLiquidity,
    load: loadLockedLiquidity,
    predict: predictLockedLiquidity,
    setLockedLiquidityAddress,
    setLockedLiquidityExitForm,
    setLockedLiquidityForm,
  } = lockedLiquidity;
  const {
    form: windDownForm,
    burnTreasuryShares,
    claimRedemptionAsset,
    openRedemptions,
    redeemShares: redeemBoardroomShares,
    registerRedeemableAsset,
    setForm: setWindDownForm,
    start: startWindDown,
  } = windDown;

  const clearBoardroomPrediction = (): void => {
    setPredictedBoardroom(undefined);
    setBoardroomAddress("");
  };

  const setBoardroomPredictionField = <K extends keyof BoardroomForm>(key: K, value: BoardroomForm[K]): void => {
    setBoardroomForm((current) => ({ ...current, [key]: value }));
    clearBoardroomPrediction();
  };

  const setBoardroomGrantSalt = (salt: string): void => {
    setBoardroomGrantForm((current) => ({ ...current, salt }));
    clearBoardroomGrantPrediction();
  };

  const obligationList = (scope: "distributions" | "grants" | "liquidity"): React.JSX.Element => {
    const count = scope === "grants"
      ? boardroomSnapshot?.grantSummaries.length ?? 0
      : scope === "distributions"
        ? boardroomSnapshot?.distributionSummaries.length ?? 0
        : boardroomSnapshot?.lockedLiquiditySummaries.length ?? 0;
    const label = scope === "grants" ? "grants" : scope === "distributions" ? "distributions" : "liquidity positions";

    return (
      <details className="border-y border-zinc-800 bg-zinc-950/40">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-200">Existing {label} ({count.toString()})</summary>
        <ObligationLists
          boardroomSnapshot={boardroomSnapshot}
          scope={scope}
          setBondMarketAddress={setBondMarketAddress}
          setFixedPriceSaleAddress={setFixedPriceSaleAddress}
          setMerkleAirdropAddress={setMerkleAirdropAddress}
          setLockedLiquidityAddress={setLockedLiquidityAddress}
          setMigratingCurveAddress={setMigratingCurveAddress}
        />
      </details>
    );
  };

  return (
    <div className="grid gap-4">
      {section === "all" || (section === "setup" && !boardroomSnapshot) ? <Panel
        title="Create Boardroom"
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setBoardroomForm((current) => ({ ...current, salt: randomSalt() }));
              clearBoardroomPrediction();
            }}
          >
            <Wand2 className="h-4 w-4" />
            Salt
          </Button>
        }
      >
        <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
          <Field label="Owner">
            <Input value={boardroomForm.owner} onChange={(event) => setBoardroomPredictionField("owner", event.target.value)} spellCheck={false} />
          </Field>
          <Field label="Name">
            <Input value={boardroomForm.name} onChange={(event) => setBoardroomPredictionField("name", event.target.value)} />
          </Field>
          <Field label="Symbol">
            <Input value={boardroomForm.symbol} onChange={(event) => setBoardroomPredictionField("symbol", event.target.value)} />
          </Field>
          <Field label="Salt">
            <Input value={boardroomForm.salt} onChange={(event) => setBoardroomPredictionField("salt", event.target.value)} spellCheck={false} />
          </Field>
        </div>
        <ActionRow>
          <ActionButton
            actionId="predict-boardroom"
            disabled={!deployment?.boardroomFactory}
            pendingAction={pendingAction}
            variant="secondary"
            onClick={() => void runAction("predict-boardroom", predictBoardroom)}
          >
            <Search className="h-4 w-4" />
            Predict
          </ActionButton>
          <ActionButton
            actionId="create-boardroom"
            disabled={!deployment?.boardroomFactory || !capabilityEnabled(capabilities?.createBoardroom)}
            pendingAction={pendingAction}
            title={capabilityReason(capabilities?.createBoardroom)}
            onClick={() => void runAction("create-boardroom", createBoardroom)}
          >
            <Plus className="h-4 w-4" />
            Create
          </ActionButton>
        </ActionRow>
        <CapabilityNotice capability={capabilities?.createBoardroom} />
        <Facts
          columns="one"
          items={[
            { label: "Predicted Boardroom", value: predictedBoardroom ? <AddressLink address={predictedBoardroom} /> : "None" },
            { label: "Factory", value: deployment?.boardroomFactory ? <AddressLink address={deployment.boardroomFactory} /> : deployment?.boardroomReason ?? "Not in artifact" },
          ]}
        />
      </Panel> : null}

      {section === "all" || section === "setup" || section === "token" || section === "close" ? <BoardroomOverview
        addressLocked={boardroomIdentityLocked}
        boardroomAddress={boardroomAddress}
        boardroomSnapshot={boardroomSnapshot}
        pendingAction={pendingAction}
        setBoardroomAddress={setBoardroomAddress}
        setBondMarketAddress={setBondMarketAddress}
        setFixedPriceSaleAddress={setFixedPriceSaleAddress}
        setMerkleAirdropAddress={setMerkleAirdropAddress}
        setLockedLiquidityAddress={setLockedLiquidityAddress}
        setMigratingCurveAddress={setMigratingCurveAddress}
        obligationScope={section === "all" || section === "close" ? "all" : undefined}
        loadBoardroom={loadBoardroom}
        runAction={runAction}
      /> : null}

      {section === "all" || section === "token" ? <Panel title="Boardroom Shares">
        <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
          <Field label="Mint recipient">
            <Input value={boardroomMintTo} onChange={(event) => setBoardroomMintTo(event.target.value)} spellCheck={false} />
          </Field>
          <Field label="Mint amount">
            <Input value={boardroomMintAmount} inputMode="decimal" onChange={(event) => setBoardroomMintAmount(event.target.value)} />
          </Field>
        </div>
        <ActionRow>
          <ActionButton
            actionId="mint-boardroom-shares"
            disabled={!capabilityEnabled(capabilities?.mint)}
            pendingAction={pendingAction}
            title={capabilityReason(capabilities?.mint)}
            onClick={() => void runAction("mint-boardroom-shares", mintBoardroomShares)}
          >
            <Plus className="h-4 w-4" />
            Mint Shares
          </ActionButton>
        </ActionRow>
      </Panel> : null}

      {section === "all" || section === "grants" ? <BoardroomGrantPanel
        boardroomGrantForm={boardroomGrantForm}
        capability={capabilities?.createGrant}
        boardroomSnapshot={boardroomSnapshot}
        pendingAction={pendingAction}
        predictedBoardroomGrant={predictedBoardroomGrant}
        setBoardroomGrantForm={setBoardroomGrantForm}
        setBoardroomGrantSalt={setBoardroomGrantSalt}
        boardroomApproveFactory={boardroomApproveFactory}
        boardroomCreateGrant={boardroomCreateGrant}
        boardroomCreateGrantBatch={boardroomCreateGrantBatch}
        predictBoardroomGrantAddress={predictBoardroomGrantAddress}
        runAction={runAction}
      /> : null}
      {section === "grants" ? obligationList("grants") : null}
      {section === "grants" ? <CapabilityNotice capability={capabilities?.createGrant} /> : null}

      {section === "all" || section === "distributions" ? <>
      {section === "distributions" ? (
        <div aria-label="Distribution type" className="grid grid-cols-2 gap-2 border-y border-zinc-800 py-3 lg:grid-cols-4" role="group">
          {([
            ["fixed-price", "Fixed price"],
            ["bond", "Bond market"],
            ["airdrop", "Airdrop"],
            ["curve", "Bonding curve"],
          ] as const).map(([value, label]) => (
            <Button
              aria-pressed={distributionTool === value}
              key={value}
              variant={distributionTool === value ? "default" : "secondary"}
              onClick={() => setDistributionTool(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      ) : null}
      {section === "all" || distributionTool === "fixed-price" ? <FixedPriceSalePanel
        boardroomSnapshot={boardroomSnapshot}
        createCapability={capabilities?.createDistribution}
        deployment={deployment}
        fixedPriceSaleAddress={fixedPriceSaleAddress}
        fixedPriceSaleForm={fixedPriceSaleForm}
        fixedPriceSaleSnapshot={fixedPriceSaleSnapshot}
        pendingAction={pendingAction}
        manageCapability={capabilities?.manageDistribution}
        predictedFixedPriceSale={predictedFixedPriceSale}
        setFixedPriceSaleAddress={setFixedPriceSaleAddress}
        setFixedPriceSaleForm={setFixedPriceSaleForm}
        cancelFixedPriceSale={cancelFixedPriceSale}
        closeFixedPriceSale={closeFixedPriceSale}
        createFixedPriceSale={createFixedPriceSale}
        loadFixedPriceSale={loadFixedPriceSale}
        predictFixedPriceSale={predictFixedPriceSale}
        runAction={runAction}
      /> : null}

      {section === "all" || distributionTool === "bond" ? <BondMarketPanel
        boardroomSnapshot={boardroomSnapshot}
        bondMarketAddress={bondMarketAddress}
        bondMarketForm={bondMarketForm}
        bondMarketSnapshot={bondMarketSnapshot}
        createCapability={capabilities?.createDistribution}
        deployment={deployment}
        manageCapability={capabilities?.manageDistribution}
        pendingAction={pendingAction}
        predictedBondMarket={predictedBondMarket}
        setBondMarketAddress={setBondMarketAddress}
        setBondMarketForm={setBondMarketForm}
        closeBondMarket={closeBondMarket}
        createBondMarket={createBondMarket}
        loadBondMarket={loadBondMarket}
        predictBondMarket={predictBondMarket}
        runAction={runAction}
      /> : null}

      {section === "all" || distributionTool === "airdrop" ? <MerkleAirdropPanel
        boardroomSnapshot={boardroomSnapshot}
        createCapability={capabilities?.createDistribution}
        deployment={deployment}
        merkleAirdropAddress={merkleAirdropAddress}
        merkleAirdropForm={merkleAirdropForm}
        merkleAirdropSnapshot={merkleAirdropSnapshot}
        pendingAction={pendingAction}
        manageCapability={capabilities?.manageDistribution}
        predictedMerkleAirdrop={predictedMerkleAirdrop}
        setMerkleAirdropAddress={setMerkleAirdropAddress}
        setMerkleAirdropForm={setMerkleAirdropForm}
        cancelMerkleAirdrop={cancelMerkleAirdrop}
        closeMerkleAirdrop={closeMerkleAirdrop}
        createMerkleAirdrop={createMerkleAirdrop}
        loadMerkleAirdrop={loadMerkleAirdrop}
        predictMerkleAirdrop={predictMerkleAirdrop}
        runAction={runAction}
      /> : null}

      {section === "all" || distributionTool === "curve" ? <MigratingCurvePanel
        boardroomSnapshot={boardroomSnapshot}
        createCapability={capabilities?.createDistribution}
        curveMigrationForm={curveMigrationForm}
        deployment={deployment}
        migratingCurveAddress={migratingCurveAddress}
        migratingCurveForm={migratingCurveForm}
        migratingCurveSnapshot={migratingCurveSnapshot}
        pendingAction={pendingAction}
        manageCapability={capabilities?.manageDistribution}
        predictedMigratingCurve={predictedMigratingCurve}
        setCurveMigrationForm={setCurveMigrationForm}
        setMigratingCurveAddress={setMigratingCurveAddress}
        setMigratingCurveForm={setMigratingCurveForm}
        cancelMigratingCurve={cancelMigratingCurve}
        createMigratingCurve={createMigratingCurve}
        loadMigratingCurve={loadMigratingCurve}
        migrateCurve={migrateCurve}
        predictMigratingCurve={predictMigratingCurve}
        runAction={runAction}
      /> : null}
      {section === "distributions" ? obligationList("distributions") : null}
      {section === "distributions" ? <CapabilityNotice capability={capabilities?.createDistribution} fallback={capabilities?.manageDistribution} /> : null}
      </> : null}

      {section === "all" || section === "liquidity" ? <LockedLiquidityPanel
        boardroomSnapshot={boardroomSnapshot}
        createCapability={capabilities?.createLiquidity}
        deployment={deployment}
        lockedLiquidityAddress={lockedLiquidityAddress}
        lockedLiquidityExitForm={lockedLiquidityExitForm}
        lockedLiquidityForm={lockedLiquidityForm}
        lockedLiquiditySnapshot={lockedLiquiditySnapshot}
        pendingAction={pendingAction}
        manageCapability={capabilities?.manageLiquidity}
        predictedLockedLiquidity={predictedLockedLiquidity}
        setLockedLiquidityAddress={setLockedLiquidityAddress}
        setLockedLiquidityExitForm={setLockedLiquidityExitForm}
        setLockedLiquidityForm={setLockedLiquidityForm}
        claimLockedLiquidityFees={claimLockedLiquidityFees}
        createLockedLiquidity={createLockedLiquidity}
        exitLockedLiquidity={exitLockedLiquidity}
        loadLockedLiquidity={loadLockedLiquidity}
        predictLockedLiquidity={predictLockedLiquidity}
        runAction={runAction}
      /> : null}
      {section === "liquidity" ? obligationList("liquidity") : null}
      {section === "liquidity" ? <CapabilityNotice capability={capabilities?.createLiquidity} fallback={capabilities?.manageLiquidity} /> : null}

      {section === "all" || section === "close" ? <WindDownPanel
        boardroomSnapshot={boardroomSnapshot}
        claimCapability={capabilities?.claimRedemption}
        permissionlessCapability={capabilities?.permissionlessWindDown}
        pendingAction={pendingAction}
        redeemCapability={capabilities?.redeem}
        registerCapability={capabilities?.registerRedeemableAsset}
        setWindDownForm={setWindDownForm}
        windDownForm={windDownForm}
        burnTreasuryShares={burnTreasuryShares}
        claimRedemptionAsset={claimRedemptionAsset}
        openRedemptions={openRedemptions}
        redeemBoardroomShares={redeemBoardroomShares}
        registerRedeemableAsset={registerRedeemableAsset}
        runAction={runAction}
        startCapability={capabilities?.startWindDown}
        startWindDown={startWindDown}
      /> : null}
    </div>
  );
}

function BoardroomOverview({
  addressLocked,
  boardroomAddress,
  boardroomSnapshot,
  pendingAction,
  setBoardroomAddress,
  setBondMarketAddress,
  setFixedPriceSaleAddress,
  setMerkleAirdropAddress,
  setLockedLiquidityAddress,
  setMigratingCurveAddress,
  obligationScope,
  loadBoardroom,
  runAction,
}: {
  addressLocked: boolean;
  boardroomAddress: string;
  boardroomSnapshot: BoardroomSnapshot | undefined;
  pendingAction: string | undefined;
  setBoardroomAddress: (address: string) => void;
  setBondMarketAddress: (address: string) => void;
  setFixedPriceSaleAddress: (address: string) => void;
  setMerkleAirdropAddress: (address: string) => void;
  setLockedLiquidityAddress: (address: string) => void;
  setMigratingCurveAddress: (address: string) => void;
  obligationScope: "all" | "distributions" | "grants" | "liquidity" | undefined;
  loadBoardroom: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
}): React.JSX.Element {
  const accountFacts = boardroomAccountFacts(boardroomSnapshot);

  return (
    <Panel
      title="Boardroom Account"
      action={
        <ActionButton actionId="load-boardroom" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("load-boardroom", loadBoardroom)}>
          <RefreshCw className="h-4 w-4" />
          {addressLocked ? "Refresh" : "Load"}
        </ActionButton>
      }
    >
      <div className="border-t border-zinc-800">
        <Field label="Boardroom address">
          <Input
            aria-readonly={addressLocked}
            readOnly={addressLocked}
            value={boardroomAddress}
            onChange={(event) => {
              if (!addressLocked) setBoardroomAddress(event.target.value);
            }}
            spellCheck={false}
          />
        </Field>
      </div>
      <Facts
        columns="three"
        items={accountFacts}
      />
      {obligationScope ? <ObligationLists
        boardroomSnapshot={boardroomSnapshot}
        scope={obligationScope}
        setBondMarketAddress={setBondMarketAddress}
        setFixedPriceSaleAddress={setFixedPriceSaleAddress}
        setMerkleAirdropAddress={setMerkleAirdropAddress}
        setLockedLiquidityAddress={setLockedLiquidityAddress}
        setMigratingCurveAddress={setMigratingCurveAddress}
      /> : null}
    </Panel>
  );
}

function boardroomAccountFacts(boardroomSnapshot: BoardroomSnapshot | undefined): BoardroomFact[] {
  return [
    { label: "Owner", value: boardroomSnapshot?.owner ? <AddressLink address={boardroomSnapshot.owner} /> : "Unknown" },
    {
      label: "Policy registry",
      value: boardroomSnapshot?.policyRegistry ? <AddressLink address={boardroomSnapshot.policyRegistry} /> : "Unknown",
    },
    { label: "Share token", value: boardroomSnapshot?.shareToken ? <AddressLink address={boardroomSnapshot.shareToken} /> : "Unknown" },
    { label: "Status", value: <StatusBadge label={boardroomStatusLabel(boardroomSnapshot?.status)} tone={boardroomStatusTone(boardroomSnapshot?.status)} /> },
    { label: "Redeemable assets", value: String(boardroomSnapshot?.redeemableAssets.length ?? 0) },
    { label: "Obligations", value: boardroomObligationCount(boardroomSnapshot) },
  ];
}

function boardroomObligationCount(boardroomSnapshot: BoardroomSnapshot | undefined): string {
  const grantCount = boardroomSnapshot?.issuedGrants.length ?? 0;
  const distributionCount = boardroomSnapshot?.issuedDistributions.length ?? 0;
  const lockerCount = boardroomSnapshot?.lockedLiquidityPositions.length ?? 0;
  return `${grantCount} grants / ${distributionCount} distributions / ${lockerCount} lockers`;
}

function timestampPreview(value: unknown, zeroLabel = "Set a future date and time"): string {
  try {
    const timestamp = BigInt(String(value ?? ""));
    return timestamp === 0n ? zeroLabel : dateString(timestamp);
  } catch {
    return "Enter a Unix timestamp in seconds.";
  }
}

function fixedPriceSaleFacts(
  fixedPriceSaleSnapshot: FixedPriceSaleState | undefined,
  distributionSummary: BoardroomDistributionSnapshot | undefined,
  predictedFixedPriceSale: Address | undefined,
): BoardroomFact[] {
  return [
    { label: "Predicted sale", value: predictedFixedPriceSale ? <AddressLink address={predictedFixedPriceSale} /> : "None" },
    {
      label: "Status",
      value: fixedPriceSaleSnapshot ? (
        <StatusBadge label={saleStatusLabel(fixedPriceSaleSnapshot.saleStatus)} tone={fixedPriceSaleSnapshot.closed ? "warning" : "default"} />
      ) : (
        "Not loaded"
      ),
    },
    { label: "Remaining shares", value: formatTokenAmount(fixedPriceSaleSnapshot?.remainingShares, distributionSummary?.shareTokenMetadata) },
    { label: "Payment token", value: fixedPriceSaleSnapshot ? <AddressLink address={fixedPriceSaleSnapshot.paymentToken} /> : "Unknown" },
    { label: "Price", value: formatTokenAmount(fixedPriceSaleSnapshot?.price, distributionSummary?.paymentTokenMetadata) },
    { label: "Window", value: fixedPriceSaleSnapshot ? `${dateString(fixedPriceSaleSnapshot.startTime)} -> ${dateString(fixedPriceSaleSnapshot.endTime)}` : "Unknown" },
  ];
}

function merkleAirdropFacts(
  merkleAirdropSnapshot: MerkleAirdropState | undefined,
  distributionSummary: BoardroomDistributionSnapshot | undefined,
  predictedMerkleAirdrop: Address | undefined,
): BoardroomFact[] {
  return [
    { label: "Predicted airdrop", value: predictedMerkleAirdrop ? <AddressLink address={predictedMerkleAirdrop} /> : "None" },
    {
      label: "Status",
      value: merkleAirdropSnapshot ? (
        <StatusBadge label={airdropStatusLabel(merkleAirdropSnapshot.airdropStatus)} tone={merkleAirdropSnapshot.closed ? "warning" : "default"} />
      ) : (
        "Not loaded"
      ),
    },
    { label: "Remaining shares", value: formatTokenAmount(merkleAirdropSnapshot?.remainingShares, distributionSummary?.shareTokenMetadata) },
    {
      label: "Grant claims",
      value: merkleAirdropSnapshot ? `${merkleAirdropSnapshot.claimedGrantCount} / ${merkleAirdropSnapshot.maxGrantClaims}` : "Unknown",
    },
    { label: "Grant factory", value: merkleAirdropSnapshot ? <AddressLink address={merkleAirdropSnapshot.tokenGrantFactory} /> : "Unknown" },
    { label: "Merkle root", value: merkleAirdropSnapshot?.merkleRoot ?? "Unknown" },
    { label: "Window", value: merkleAirdropSnapshot ? `${dateString(merkleAirdropSnapshot.startTime)} -> ${dateString(merkleAirdropSnapshot.endTime)}` : "Unknown" },
  ];
}

function migratingCurveFacts(
  migratingCurveSnapshot: MigratingBondingCurveState | undefined,
  distributionSummary: BoardroomDistributionSnapshot | undefined,
  predictedMigratingCurve: Address | undefined,
): BoardroomFact[] {
  return [
    { label: "Predicted curve", value: predictedMigratingCurve ? <AddressLink address={predictedMigratingCurve} /> : "None" },
    {
      label: "Status",
      value: migratingCurveSnapshot ? (
        <StatusBadge label={curveStatusLabel(migratingCurveSnapshot.curveStatus)} tone={migratingCurveSnapshot.closed ? "warning" : "default"} />
      ) : (
        "Not loaded"
      ),
    },
    { label: "Can migrate", value: migratingCurveSnapshot ? String(migratingCurveSnapshot.canMigrate) : "Unknown" },
    { label: "Remaining sale shares", value: formatTokenAmount(migratingCurveSnapshot?.remainingSaleShares, distributionSummary?.shareTokenMetadata) },
    { label: "Sold shares", value: formatTokenAmount(migratingCurveSnapshot?.soldShares, distributionSummary?.shareTokenMetadata) },
    { label: "Quote reserve", value: formatTokenAmount(migratingCurveSnapshot?.quoteReserve, distributionSummary?.quoteTokenMetadata) },
    { label: "Quote token", value: migratingCurveSnapshot ? <AddressLink address={migratingCurveSnapshot.quoteToken} /> : "Unknown" },
    { label: "Locker", value: migratingCurveSnapshot?.locker ? <AddressLink address={migratingCurveSnapshot.locker} /> : "Unknown" },
    { label: "Pool", value: migratingCurveSnapshot?.pool ? <AddressLink address={migratingCurveSnapshot.pool} /> : "Unknown" },
  ];
}

function lockedLiquidityFacts(
  lockedLiquiditySnapshot: LockedLiquidityState | undefined,
  lockerSummary: BoardroomLockedLiquiditySnapshot | undefined,
  predictedLockedLiquidity: Address | undefined,
): BoardroomFact[] {
  return [
    { label: "Predicted locker", value: predictedLockedLiquidity ? <AddressLink address={predictedLockedLiquidity} /> : "None" },
    { label: "Seeded", value: lockedLiquiditySnapshot ? String(lockedLiquiditySnapshot.seeded) : "Unknown" },
    { label: "Locked LP", value: formatTokenAmount(lockedLiquiditySnapshot?.lockedLiquidity, lockerSummary?.liquidityMetadata) },
    { label: "Token A", value: lockedLiquiditySnapshot ? <AddressLink address={lockedLiquiditySnapshot.tokenA} /> : "Unknown" },
    { label: "Token B", value: lockedLiquiditySnapshot ? <AddressLink address={lockedLiquiditySnapshot.tokenB} /> : "Unknown" },
    { label: "Pool", value: lockedLiquiditySnapshot?.pool ? <AddressLink address={lockedLiquiditySnapshot.pool} /> : "Unknown" },
  ];
}

function boardroomWindDownFacts(boardroomSnapshot: BoardroomSnapshot | undefined, blockerCount: number): BoardroomFact[] {
  return [
    { label: "Status", value: <StatusBadge label={boardroomStatusLabel(boardroomSnapshot?.status)} tone={boardroomStatusTone(boardroomSnapshot?.status)} /> },
    { label: "Open blockers", value: String(blockerCount) },
    { label: "Redeemable assets", value: String(boardroomSnapshot?.redeemableAssets.length ?? 0) },
  ];
}

function BoardroomGrantPanel({
  boardroomGrantForm,
  boardroomSnapshot,
  capability,
  pendingAction,
  predictedBoardroomGrant,
  setBoardroomGrantForm,
  setBoardroomGrantSalt,
  boardroomApproveFactory,
  boardroomCreateGrant,
  boardroomCreateGrantBatch,
  predictBoardroomGrantAddress,
  runAction,
}: {
  boardroomGrantForm: BoardroomGrantForm;
  boardroomSnapshot: BoardroomSnapshot | undefined;
  capability: Capability | undefined;
  pendingAction: string | undefined;
  predictedBoardroomGrant: Address | undefined;
  setBoardroomGrantForm: Dispatch<SetStateAction<BoardroomGrantForm>>;
  setBoardroomGrantSalt: (salt: string) => void;
  boardroomApproveFactory: () => Promise<void>;
  boardroomCreateGrant: () => Promise<void>;
  boardroomCreateGrantBatch: () => Promise<void>;
  predictBoardroomGrantAddress: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
}): React.JSX.Element {
  return (
    <Panel
      title="Issue Share Grant"
      action={
        <Button variant="secondary" onClick={() => setBoardroomGrantSalt(randomSalt())}>
          <Wand2 className="h-4 w-4" />
          Salt
        </Button>
      }
    >
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
        <TextField form={boardroomGrantForm} field="holder" label="Holder" setForm={setBoardroomGrantForm} />
        <TextField form={boardroomGrantForm} field="paymentToken" label="Payment token" setForm={setBoardroomGrantForm} />
        <TextField form={boardroomGrantForm} field="amount" inputMode="decimal" label="Amount" setForm={setBoardroomGrantForm} />
        <TextField form={boardroomGrantForm} field="price" inputMode="decimal" label="Price" setForm={setBoardroomGrantForm} />
        <TextField description={timestampPreview(boardroomGrantForm.vestingCliff)} form={boardroomGrantForm} field="vestingCliff" inputMode="numeric" label="Vesting cliff" setForm={setBoardroomGrantForm} />
        <TextField description={timestampPreview(boardroomGrantForm.vestingEnd)} form={boardroomGrantForm} field="vestingEnd" inputMode="numeric" label="Vesting end" setForm={setBoardroomGrantForm} />
        <TextField description={timestampPreview(boardroomGrantForm.expiry)} form={boardroomGrantForm} field="expiry" inputMode="numeric" label="Settlement expiry" setForm={setBoardroomGrantForm} />
        <Field label="Transferable">
          <label className="flex h-10 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200">
            <input
              checked={boardroomGrantForm.transferable}
              className="h-4 w-4 accent-lime-300"
              type="checkbox"
              onChange={(event) => setFormField("transferable", event.target.checked, setBoardroomGrantForm)}
            />
            Enabled
          </label>
        </Field>
        <TextField
          disabled={!boardroomGrantForm.transferable}
          description={timestampPreview(boardroomGrantForm.transferUnlockTime, "Transfers unlock immediately")}
          form={boardroomGrantForm}
          field="transferUnlockTime"
          inputMode="numeric"
          label="Transfer unlock"
          setForm={setBoardroomGrantForm}
        />
        <TextField form={boardroomGrantForm} field="salt" label="Salt" setForm={setBoardroomGrantForm} className="md:col-span-2" />
      </div>
      <ActionRow>
        <ActionButton
          actionId="predict-boardroom-grant"
          pendingAction={pendingAction}
          variant="secondary"
          onClick={() => void runAction("predict-boardroom-grant", predictBoardroomGrantAddress)}
        >
          <Search className="h-4 w-4" />
          Predict address
        </ActionButton>
        <ActionButton
          actionId="boardroom-approve-factory"
          disabled={!capabilityEnabled(capability)}
          pendingAction={pendingAction}
          title={capabilityReason(capability)}
          variant="secondary"
          onClick={() => void runAction("boardroom-approve-factory", boardroomApproveFactory)}
        >
          <CheckCircle2 className="h-4 w-4" />
          Approve factory
        </ActionButton>
        <ActionButton
          actionId="boardroom-create-grant-batch"
          disabled={!capabilityEnabled(capability)}
          pendingAction={pendingAction}
          title={capabilityReason(capability)}
          onClick={() => void runAction("boardroom-create-grant-batch", boardroomCreateGrantBatch)}
        >
          <Send className="h-4 w-4" />
          Approve &amp; create
        </ActionButton>
        <ActionButton
          actionId="boardroom-create-grant"
          disabled={!capabilityEnabled(capability)}
          pendingAction={pendingAction}
          title={capabilityReason(capability)}
          variant="secondary"
          onClick={() => void runAction("boardroom-create-grant", boardroomCreateGrant)}
        >
          <Send className="h-4 w-4" />
          Create after approval
        </ActionButton>
      </ActionRow>
      <CapabilityNotice capability={capability} />
      <Facts
        columns="one"
        items={[
          { label: "Predicted grant", value: predictedBoardroomGrant ? <AddressLink address={predictedBoardroomGrant} /> : "None" },
          { label: "Share token", value: boardroomSnapshot?.shareToken ? <AddressLink address={boardroomSnapshot.shareToken} /> : "Load Boardroom" },
        ]}
      />
    </Panel>
  );
}

function BondMarketPanel({
  boardroomSnapshot,
  bondMarketAddress,
  bondMarketForm,
  bondMarketSnapshot,
  createCapability,
  deployment,
  manageCapability,
  pendingAction,
  predictedBondMarket,
  setBondMarketAddress,
  setBondMarketForm,
  closeBondMarket,
  createBondMarket,
  loadBondMarket,
  predictBondMarket,
  runAction,
}: {
  boardroomSnapshot: BoardroomSnapshot | undefined;
  bondMarketAddress: string;
  bondMarketForm: BondMarketForm;
  bondMarketSnapshot: BondMarketState | undefined;
  createCapability: Capability | undefined;
  deployment: PledgeCashDeployment | undefined;
  manageCapability: Capability | undefined;
  pendingAction: string | undefined;
  predictedBondMarket: Address | undefined;
  setBondMarketAddress: (address: string) => void;
  setBondMarketForm: Dispatch<SetStateAction<BondMarketForm>>;
  closeBondMarket: () => Promise<void>;
  createBondMarket: () => Promise<void>;
  loadBondMarket: () => Promise<void>;
  predictBondMarket: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
}): React.JSX.Element {
  const distributionSummary = distributionSummaryFor(boardroomSnapshot, bondMarketSnapshot?.address ?? bondMarketAddress);
  const canUseBondFactory = Boolean(deployment?.bondMarketFactory);
  const quoteMetadata = distributionSummary?.quoteTokenMetadata;
  const shareMetadata = distributionSummary?.shareTokenMetadata ?? boardroomSnapshot?.shareTokenMetadata;

  return (
    <Panel
      title="Sequential Dutch Auction Bond"
      action={
        <Button variant="secondary" onClick={() => setBondMarketForm((current) => ({ ...current, salt: randomSalt() }))}>
          <Wand2 className="h-4 w-4" />
          Salt
        </Button>
      }
    >
      <div className="border-t border-zinc-800 p-4">
        <p className="m-0 text-sm leading-6 text-zinc-400">
          Prefund a declining-price auction with project tokens. Buyers commit a reserve asset or a canonical first-party LP token and receive immutable, non-transferable positions.
        </p>
        <div className="mt-3 flex gap-2" role="group" aria-label="Bond quote asset type">
          {(["reserve", "liquidity"] as const).map((kind) => (
            <Button
              aria-pressed={bondMarketForm.kind === kind}
              key={kind}
              size="sm"
              variant={bondMarketForm.kind === kind ? "default" : "secondary"}
              onClick={() => setBondMarketForm((current) => ({ ...current, kind }))}
            >
              {kind === "reserve" ? "Reserve asset" : "First-party LP token"}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
        <TextField form={bondMarketForm} field="quoteToken" label={bondMarketForm.kind === "reserve" ? "Reserve quote token" : "AMM LP token"} setForm={setBondMarketForm} />
        <TextField form={bondMarketForm} field="capacity" inputMode="decimal" label="Project-token capacity" setForm={setBondMarketForm} />
        <TextField form={bondMarketForm} field="initialPrice" inputMode="decimal" label="Initial price per project token" setForm={setBondMarketForm} />
        <TextField form={bondMarketForm} field="minimumPrice" inputMode="decimal" label="Minimum price" setForm={setBondMarketForm} />
        <TextField description="100,000 = 100%; minimum 10,000." form={bondMarketForm} field="debtBuffer" inputMode="numeric" label="Debt circuit-breaker buffer" setForm={setBondMarketForm} />
        <TextField description="Seconds from purchase until claim." form={bondMarketForm} field="vesting" inputMode="numeric" label="Vesting term" setForm={setBondMarketForm} />
        <TextField description={timestampPreview(bondMarketForm.start, "Starts immediately")} form={bondMarketForm} field="start" inputMode="numeric" label="Auction starts" setForm={setBondMarketForm} />
        <TextField description="Minimum 86,400 seconds." form={bondMarketForm} field="duration" inputMode="numeric" label="Auction duration" setForm={setBondMarketForm} />
        <TextField description="Target cadence for maximum position size; minimum 3,600 seconds." form={bondMarketForm} field="depositInterval" inputMode="numeric" label="Deposit interval" setForm={setBondMarketForm} />
        <TextField form={bondMarketForm} field="salt" label="Salt" setForm={setBondMarketForm} />
      </div>
      <ActionRow>
        <ActionButton actionId="predict-bond-market" disabled={!canUseBondFactory} pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("predict-bond-market", predictBondMarket)}>
          <Search className="h-4 w-4" />
          Predict
        </ActionButton>
        <ActionButton actionId="create-bond-market" disabled={!canUseBondFactory || !capabilityEnabled(createCapability)} pendingAction={pendingAction} title={capabilityReason(createCapability)} onClick={() => void runAction("create-bond-market", createBondMarket)}>
          <Coins className="h-4 w-4" />
          Create Bond Market
        </ActionButton>
      </ActionRow>
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-[minmax(0,1fr)_auto]">
        <Field label="Bond market address">
          <Input value={bondMarketAddress} onChange={(event) => setBondMarketAddress(event.target.value)} spellCheck={false} />
        </Field>
        <div className="flex items-end gap-2 border-b border-zinc-800 p-4">
          <ActionButton actionId="load-bond-market" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("load-bond-market", loadBondMarket)}>
            <RefreshCw className="h-4 w-4" />
            Load
          </ActionButton>
          <ActionButton actionId="close-bond-market" disabled={!capabilityEnabled(manageCapability) || bondMarketSnapshot?.status !== 0} pendingAction={pendingAction} title={capabilityReason(manageCapability)} variant="danger" onClick={() => void runAction("close-bond-market", closeBondMarket)}>
            <XCircle className="h-4 w-4" />
            Close Market
          </ActionButton>
        </div>
      </div>
      <CapabilityNotice capability={createCapability} fallback={manageCapability} />
      <Facts columns="three" items={[
        { label: "Status", value: bondMarketSnapshot ? (bondMarketSnapshot.closed ? "Settled" : bondMarketSnapshot.live ? "Live" : bondMarketSnapshot.status === 0 ? "Scheduled / concluded" : "Claims pending") : "Not loaded" },
        { label: "Predicted market", value: predictedBondMarket ? <AddressLink address={predictedBondMarket} /> : "None" },
        { label: "Quote asset", value: bondMarketSnapshot ? <AddressLink address={bondMarketSnapshot.quoteToken} /> : "Unknown" },
        { label: "Remaining capacity", value: formatTokenAmount(bondMarketSnapshot?.capacity, shareMetadata) },
        { label: "Current price", value: formatTokenAmount(bondMarketSnapshot?.currentPrice, quoteMetadata) },
        { label: "Outstanding positions", value: formatTokenAmount(bondMarketSnapshot?.outstandingPayout, shareMetadata) },
        { label: "Vesting", value: bondMarketSnapshot ? `${bondMarketSnapshot.vestingTerm.toLocaleString()} seconds` : "Unknown" },
        { label: "Window", value: bondMarketSnapshot ? `${dateString(BigInt(bondMarketSnapshot.startTime))} -> ${dateString(BigInt(bondMarketSnapshot.conclusion))}` : "Unknown" },
        { label: "Receipt", value: "Internal and non-transferable" },
      ]} />
    </Panel>
  );
}

function FixedPriceSalePanel({
  boardroomSnapshot,
  createCapability,
  deployment,
  fixedPriceSaleAddress,
  fixedPriceSaleForm,
  fixedPriceSaleSnapshot,
  manageCapability,
  pendingAction,
  predictedFixedPriceSale,
  setFixedPriceSaleAddress,
  setFixedPriceSaleForm,
  cancelFixedPriceSale,
  closeFixedPriceSale,
  createFixedPriceSale,
  loadFixedPriceSale,
  predictFixedPriceSale,
  runAction,
}: {
  boardroomSnapshot: BoardroomSnapshot | undefined;
  createCapability: Capability | undefined;
  deployment: PledgeCashDeployment | undefined;
  fixedPriceSaleAddress: string;
  fixedPriceSaleForm: FixedPriceSaleForm;
  fixedPriceSaleSnapshot: FixedPriceSaleState | undefined;
  manageCapability: Capability | undefined;
  pendingAction: string | undefined;
  predictedFixedPriceSale: Address | undefined;
  setFixedPriceSaleAddress: (address: string) => void;
  setFixedPriceSaleForm: Dispatch<SetStateAction<FixedPriceSaleForm>>;
  cancelFixedPriceSale: () => Promise<void>;
  closeFixedPriceSale: () => Promise<void>;
  createFixedPriceSale: () => Promise<void>;
  loadFixedPriceSale: () => Promise<void>;
  predictFixedPriceSale: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
}): React.JSX.Element {
  const distributionSummary = distributionSummaryFor(boardroomSnapshot, fixedPriceSaleSnapshot?.address ?? fixedPriceSaleAddress);
  const canUseDistributionFactory = Boolean(deployment?.distributionFactory);
  const saleFacts = fixedPriceSaleFacts(fixedPriceSaleSnapshot, distributionSummary, predictedFixedPriceSale);

  return (
    <Panel
      title="Fixed-Price Sale"
      action={
        <Button variant="secondary" onClick={() => setFixedPriceSaleForm((current) => ({ ...current, salt: randomSalt() }))}>
          <Wand2 className="h-4 w-4" />
          Salt
        </Button>
      }
    >
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
        <TextField form={fixedPriceSaleForm} field="paymentToken" label="Payment token" setForm={setFixedPriceSaleForm} />
        <TextField form={fixedPriceSaleForm} field="shareAmount" inputMode="decimal" label="Share amount" setForm={setFixedPriceSaleForm} />
        <TextField form={fixedPriceSaleForm} field="price" inputMode="decimal" label="Price" setForm={setFixedPriceSaleForm} />
        <TextField form={fixedPriceSaleForm} field="maxPerBuyer" inputMode="decimal" label="Max per buyer" setForm={setFixedPriceSaleForm} />
        <TextField description={timestampPreview(fixedPriceSaleForm.startTime, "Starts immediately")} form={fixedPriceSaleForm} field="startTime" inputMode="numeric" label="Sale starts" setForm={setFixedPriceSaleForm} />
        <TextField description={timestampPreview(fixedPriceSaleForm.endTime, "No scheduled end")} form={fixedPriceSaleForm} field="endTime" inputMode="numeric" label="Sale ends" setForm={setFixedPriceSaleForm} />
        <TextField form={fixedPriceSaleForm} field="salt" label="Salt" setForm={setFixedPriceSaleForm} className="md:col-span-2" />
      </div>
      <ActionRow>
        <ActionButton
          actionId="predict-fixed-sale"
          disabled={!canUseDistributionFactory}
          pendingAction={pendingAction}
          variant="secondary"
          onClick={() => void runAction("predict-fixed-sale", predictFixedPriceSale)}
        >
          <Search className="h-4 w-4" />
          Predict
        </ActionButton>
        <ActionButton
          actionId="create-fixed-sale"
          disabled={!canUseDistributionFactory || !capabilityEnabled(createCapability)}
          pendingAction={pendingAction}
          title={capabilityReason(createCapability)}
          onClick={() => void runAction("create-fixed-sale", createFixedPriceSale)}
        >
          <Coins className="h-4 w-4" />
          Create Sale
        </ActionButton>
      </ActionRow>
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-[minmax(0,1fr)_auto]">
        <Field label="Sale address">
          <Input value={fixedPriceSaleAddress} onChange={(event) => setFixedPriceSaleAddress(event.target.value)} spellCheck={false} />
        </Field>
        <div className="flex items-end gap-2 border-b border-zinc-800 p-4">
          <ActionButton actionId="load-fixed-sale" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("load-fixed-sale", loadFixedPriceSale)}>
            <RefreshCw className="h-4 w-4" />
            Load
          </ActionButton>
          <ActionButton actionId="close-fixed-sale" disabled={!capabilityEnabled(manageCapability)} pendingAction={pendingAction} title={capabilityReason(manageCapability)} variant="secondary" onClick={() => void runAction("close-fixed-sale", closeFixedPriceSale)}>
            <ShieldCheck className="h-4 w-4" />
            Close
          </ActionButton>
          <ActionButton actionId="cancel-fixed-sale" disabled={!capabilityEnabled(manageCapability)} pendingAction={pendingAction} title={capabilityReason(manageCapability)} variant="danger" onClick={() => void runAction("cancel-fixed-sale", cancelFixedPriceSale)}>
            <XCircle className="h-4 w-4" />
            Cancel
          </ActionButton>
        </div>
      </div>
      <CapabilityNotice capability={createCapability} fallback={manageCapability} />
      <Facts
        columns="three"
        items={saleFacts}
      />
    </Panel>
  );
}

function MerkleAirdropPanel({
  boardroomSnapshot,
  createCapability,
  deployment,
  merkleAirdropAddress,
  merkleAirdropForm,
  merkleAirdropSnapshot,
  manageCapability,
  pendingAction,
  predictedMerkleAirdrop,
  setMerkleAirdropAddress,
  setMerkleAirdropForm,
  cancelMerkleAirdrop,
  closeMerkleAirdrop,
  createMerkleAirdrop,
  loadMerkleAirdrop,
  predictMerkleAirdrop,
  runAction,
}: {
  boardroomSnapshot: BoardroomSnapshot | undefined;
  createCapability: Capability | undefined;
  deployment: PledgeCashDeployment | undefined;
  merkleAirdropAddress: string;
  merkleAirdropForm: MerkleAirdropForm;
  merkleAirdropSnapshot: MerkleAirdropState | undefined;
  manageCapability: Capability | undefined;
  pendingAction: string | undefined;
  predictedMerkleAirdrop: Address | undefined;
  setMerkleAirdropAddress: (address: string) => void;
  setMerkleAirdropForm: Dispatch<SetStateAction<MerkleAirdropForm>>;
  cancelMerkleAirdrop: () => Promise<void>;
  closeMerkleAirdrop: () => Promise<void>;
  createMerkleAirdrop: () => Promise<void>;
  loadMerkleAirdrop: () => Promise<void>;
  predictMerkleAirdrop: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
}): React.JSX.Element {
  const distributionSummary = distributionSummaryFor(boardroomSnapshot, merkleAirdropSnapshot?.address ?? merkleAirdropAddress);
  const canUseDistributionFactory = Boolean(deployment?.distributionFactory);
  const airdropFacts = merkleAirdropFacts(merkleAirdropSnapshot, distributionSummary, predictedMerkleAirdrop);

  return (
    <Panel
      title="Merkle Airdrop"
      action={
        <Button variant="secondary" onClick={() => setMerkleAirdropForm((current) => ({ ...current, salt: randomSalt() }))}>
          <Wand2 className="h-4 w-4" />
          Salt
        </Button>
      }
    >
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
        <TextField form={merkleAirdropForm} field="shareAmount" inputMode="decimal" label="Share amount" setForm={setMerkleAirdropForm} />
        <TextField form={merkleAirdropForm} field="merkleRoot" label="Merkle root" setForm={setMerkleAirdropForm} />
        <TextField description={timestampPreview(merkleAirdropForm.startTime, "Claims start immediately")} form={merkleAirdropForm} field="startTime" inputMode="numeric" label="Claims start" setForm={setMerkleAirdropForm} />
        <TextField description={timestampPreview(merkleAirdropForm.endTime, "No scheduled end")} form={merkleAirdropForm} field="endTime" inputMode="numeric" label="Claims end" setForm={setMerkleAirdropForm} />
        <TextField form={merkleAirdropForm} field="maxGrantClaims" inputMode="numeric" label="Grant claim cap" setForm={setMerkleAirdropForm} />
        <TextField form={merkleAirdropForm} field="salt" label="Salt" setForm={setMerkleAirdropForm} className="md:col-span-2" />
      </div>
      <ActionRow>
        <ActionButton
          actionId="predict-merkle-airdrop"
          disabled={!canUseDistributionFactory}
          pendingAction={pendingAction}
          variant="secondary"
          onClick={() => void runAction("predict-merkle-airdrop", predictMerkleAirdrop)}
        >
          <Search className="h-4 w-4" />
          Predict
        </ActionButton>
        <ActionButton
          actionId="create-merkle-airdrop"
          disabled={!canUseDistributionFactory || !capabilityEnabled(createCapability)}
          pendingAction={pendingAction}
          title={capabilityReason(createCapability)}
          onClick={() => void runAction("create-merkle-airdrop", createMerkleAirdrop)}
        >
          <Gift className="h-4 w-4" />
          Create Airdrop
        </ActionButton>
      </ActionRow>
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-[minmax(0,1fr)_auto]">
        <Field label="Airdrop address">
          <Input value={merkleAirdropAddress} onChange={(event) => setMerkleAirdropAddress(event.target.value)} spellCheck={false} />
        </Field>
        <div className="flex items-end gap-2 border-b border-zinc-800 p-4">
          <ActionButton actionId="load-merkle-airdrop" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("load-merkle-airdrop", loadMerkleAirdrop)}>
            <RefreshCw className="h-4 w-4" />
            Load
          </ActionButton>
          <ActionButton actionId="close-merkle-airdrop" disabled={!capabilityEnabled(manageCapability)} pendingAction={pendingAction} title={capabilityReason(manageCapability)} variant="secondary" onClick={() => void runAction("close-merkle-airdrop", closeMerkleAirdrop)}>
            <ShieldCheck className="h-4 w-4" />
            Close
          </ActionButton>
          <ActionButton actionId="cancel-merkle-airdrop" disabled={!capabilityEnabled(manageCapability)} pendingAction={pendingAction} title={capabilityReason(manageCapability)} variant="danger" onClick={() => void runAction("cancel-merkle-airdrop", cancelMerkleAirdrop)}>
            <XCircle className="h-4 w-4" />
            Cancel
          </ActionButton>
        </div>
      </div>
      <CapabilityNotice capability={createCapability} fallback={manageCapability} />
      <Facts
        columns="three"
        items={airdropFacts}
      />
    </Panel>
  );
}

function MigratingCurvePanel({
  boardroomSnapshot,
  createCapability,
  curveMigrationForm,
  deployment,
  migratingCurveAddress,
  migratingCurveForm,
  migratingCurveSnapshot,
  manageCapability,
  pendingAction,
  predictedMigratingCurve,
  setCurveMigrationForm,
  setMigratingCurveAddress,
  setMigratingCurveForm,
  cancelMigratingCurve,
  createMigratingCurve,
  loadMigratingCurve,
  migrateCurve,
  predictMigratingCurve,
  runAction,
}: {
  boardroomSnapshot: BoardroomSnapshot | undefined;
  createCapability: Capability | undefined;
  curveMigrationForm: CurveMigrationForm;
  deployment: PledgeCashDeployment | undefined;
  migratingCurveAddress: string;
  migratingCurveForm: MigratingCurveForm;
  migratingCurveSnapshot: MigratingBondingCurveState | undefined;
  manageCapability: Capability | undefined;
  pendingAction: string | undefined;
  predictedMigratingCurve: Address | undefined;
  setCurveMigrationForm: Dispatch<SetStateAction<CurveMigrationForm>>;
  setMigratingCurveAddress: (address: string) => void;
  setMigratingCurveForm: Dispatch<SetStateAction<MigratingCurveForm>>;
  cancelMigratingCurve: () => Promise<void>;
  createMigratingCurve: () => Promise<void>;
  loadMigratingCurve: () => Promise<void>;
  migrateCurve: () => Promise<void>;
  predictMigratingCurve: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
}): React.JSX.Element {
  const distributionSummary = distributionSummaryFor(boardroomSnapshot, migratingCurveSnapshot?.address ?? migratingCurveAddress);
  const canUseDistributionFactory = Boolean(deployment?.distributionFactory);
  const curveFacts = migratingCurveFacts(migratingCurveSnapshot, distributionSummary, predictedMigratingCurve);

  return (
    <Panel
      title="Migrating Bonding Curve"
      action={
        <Button
          variant="secondary"
          onClick={() => setMigratingCurveForm((current) => ({ ...current, salt: randomSalt(), migrationSalt: randomSalt() }))}
        >
          <Wand2 className="h-4 w-4" />
          Salts
        </Button>
      }
    >
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2 xl:grid-cols-3">
        <TextField form={migratingCurveForm} field="quoteToken" label="Quote token" setForm={setMigratingCurveForm} />
        <TextField form={migratingCurveForm} field="saleSupply" inputMode="decimal" label="Sale supply" setForm={setMigratingCurveForm} />
        <TextField form={migratingCurveForm} field="migrationSupply" inputMode="decimal" label="Migration supply" setForm={setMigratingCurveForm} />
        <TextField form={migratingCurveForm} field="basePrice" inputMode="decimal" label="Base price" setForm={setMigratingCurveForm} />
        <TextField form={migratingCurveForm} field="slope" inputMode="decimal" label="Slope" setForm={setMigratingCurveForm} />
        <TextField form={migratingCurveForm} field="graduationQuoteTarget" inputMode="decimal" label="Graduation target" setForm={setMigratingCurveForm} />
        <TextField form={migratingCurveForm} field="quoteToLpBps" inputMode="numeric" label="Quote to LP bps" setForm={setMigratingCurveForm} />
        <TextField description={timestampPreview(migratingCurveForm.startTime, "Trading starts immediately")} form={migratingCurveForm} field="startTime" inputMode="numeric" label="Trading starts" setForm={setMigratingCurveForm} />
        <TextField description={timestampPreview(migratingCurveForm.endTime, "No scheduled end")} form={migratingCurveForm} field="endTime" inputMode="numeric" label="Trading ends" setForm={setMigratingCurveForm} />
        <TextField form={migratingCurveForm} field="migrationSalt" label="Migration salt" setForm={setMigratingCurveForm} className="xl:col-span-3" />
        <TextField form={migratingCurveForm} field="salt" label="Curve salt" setForm={setMigratingCurveForm} className="xl:col-span-3" />
      </div>
      <ActionRow>
        <ActionButton
          actionId="predict-migrating-curve"
          disabled={!canUseDistributionFactory}
          pendingAction={pendingAction}
          variant="secondary"
          onClick={() => void runAction("predict-migrating-curve", predictMigratingCurve)}
        >
          <Search className="h-4 w-4" />
          Predict
        </ActionButton>
        <ActionButton
          actionId="create-migrating-curve"
          disabled={!canUseDistributionFactory || !capabilityEnabled(createCapability)}
          pendingAction={pendingAction}
          title={capabilityReason(createCapability)}
          onClick={() => void runAction("create-migrating-curve", createMigratingCurve)}
        >
          <Coins className="h-4 w-4" />
          Create Curve
        </ActionButton>
      </ActionRow>
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-[minmax(0,1fr)_auto]">
        <Field label="Curve address">
          <Input value={migratingCurveAddress} onChange={(event) => setMigratingCurveAddress(event.target.value)} spellCheck={false} />
        </Field>
        <div className="flex items-end gap-2 border-b border-zinc-800 p-4">
          <ActionButton actionId="load-migrating-curve" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("load-migrating-curve", loadMigratingCurve)}>
            <RefreshCw className="h-4 w-4" />
            Load
          </ActionButton>
          <ActionButton actionId="cancel-migrating-curve" disabled={!capabilityEnabled(manageCapability)} pendingAction={pendingAction} title={capabilityReason(manageCapability)} variant="danger" onClick={() => void runAction("cancel-migrating-curve", cancelMigratingCurve)}>
            <XCircle className="h-4 w-4" />
            Cancel
          </ActionButton>
        </div>
      </div>
      <Facts
        columns="three"
        items={curveFacts}
      />
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-3">
        <TextField form={curveMigrationForm} field="minShareLiquidity" inputMode="decimal" label="Min share liquidity" setForm={setCurveMigrationForm} />
        <TextField form={curveMigrationForm} field="minQuoteLiquidity" inputMode="decimal" label="Min quote liquidity" setForm={setCurveMigrationForm} />
        <TextField description={timestampPreview(curveMigrationForm.deadline)} form={curveMigrationForm} field="deadline" inputMode="numeric" label="Migration deadline" setForm={setCurveMigrationForm} />
      </div>
      <ActionRow>
        <ActionButton actionId="migrate-curve" disabled={!capabilityEnabled(manageCapability)} pendingAction={pendingAction} title={capabilityReason(manageCapability)} onClick={() => void runAction("migrate-curve", migrateCurve)}>
          <ShieldCheck className="h-4 w-4" />
          Migrate To Locked LP
        </ActionButton>
      </ActionRow>
      <CapabilityNotice capability={createCapability} fallback={manageCapability} />
    </Panel>
  );
}

function LockedLiquidityPanel({
  boardroomSnapshot,
  createCapability,
  deployment,
  lockedLiquidityAddress,
  lockedLiquidityExitForm,
  lockedLiquidityForm,
  lockedLiquiditySnapshot,
  manageCapability,
  pendingAction,
  predictedLockedLiquidity,
  setLockedLiquidityAddress,
  setLockedLiquidityExitForm,
  setLockedLiquidityForm,
  claimLockedLiquidityFees,
  createLockedLiquidity,
  exitLockedLiquidity,
  loadLockedLiquidity,
  predictLockedLiquidity,
  runAction,
}: {
  boardroomSnapshot: BoardroomSnapshot | undefined;
  createCapability: Capability | undefined;
  deployment: PledgeCashDeployment | undefined;
  lockedLiquidityAddress: string;
  lockedLiquidityExitForm: LockedLiquidityExitForm;
  lockedLiquidityForm: LockedLiquidityForm;
  lockedLiquiditySnapshot: LockedLiquidityState | undefined;
  manageCapability: Capability | undefined;
  pendingAction: string | undefined;
  predictedLockedLiquidity: Address | undefined;
  setLockedLiquidityAddress: (address: string) => void;
  setLockedLiquidityExitForm: Dispatch<SetStateAction<LockedLiquidityExitForm>>;
  setLockedLiquidityForm: Dispatch<SetStateAction<LockedLiquidityForm>>;
  claimLockedLiquidityFees: () => Promise<void>;
  createLockedLiquidity: () => Promise<void>;
  exitLockedLiquidity: () => Promise<void>;
  loadLockedLiquidity: () => Promise<void>;
  predictLockedLiquidity: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
}): React.JSX.Element {
  const lockerSummary = lockerSummaryFor(boardroomSnapshot, lockedLiquiditySnapshot?.address ?? lockedLiquidityAddress);
  const canUseLockedLiquidityFactory = Boolean(deployment?.lockedLiquidityFactory);
  const lockerFacts = lockedLiquidityFacts(lockedLiquiditySnapshot, lockerSummary, predictedLockedLiquidity);

  return (
    <Panel
      title="Locked Liquidity"
      action={
        <Button variant="secondary" onClick={() => setLockedLiquidityForm((current) => ({ ...current, salt: randomSalt() }))}>
          <Wand2 className="h-4 w-4" />
          Salt
        </Button>
      }
    >
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2 xl:grid-cols-3">
        <TextField form={lockedLiquidityForm} field="quoteToken" label="Quote token" setForm={setLockedLiquidityForm} />
        <TextField form={lockedLiquidityForm} field="shareAmountDesired" inputMode="decimal" label="Share desired" setForm={setLockedLiquidityForm} />
        <TextField form={lockedLiquidityForm} field="quoteAmountDesired" inputMode="decimal" label="Quote desired" setForm={setLockedLiquidityForm} />
        <TextField form={lockedLiquidityForm} field="shareAmountMin" inputMode="decimal" label="Share minimum" setForm={setLockedLiquidityForm} />
        <TextField form={lockedLiquidityForm} field="quoteAmountMin" inputMode="decimal" label="Quote minimum" setForm={setLockedLiquidityForm} />
        <TextField description={timestampPreview(lockedLiquidityForm.deadline)} form={lockedLiquidityForm} field="deadline" inputMode="numeric" label="Creation deadline" setForm={setLockedLiquidityForm} />
        <Field label="Share token side">
          <label className="flex h-10 items-center gap-4 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200">
            <span className="flex items-center gap-2">
              <input
                checked={lockedLiquidityForm.shareTokenSide === "tokenA"}
                className="h-4 w-4 accent-lime-300"
                name="shareTokenSide"
                type="radio"
                onChange={() => setFormField("shareTokenSide", "tokenA", setLockedLiquidityForm)}
              />
              tokenA
            </span>
            <span className="flex items-center gap-2">
              <input
                checked={lockedLiquidityForm.shareTokenSide === "tokenB"}
                className="h-4 w-4 accent-lime-300"
                name="shareTokenSide"
                type="radio"
                onChange={() => setFormField("shareTokenSide", "tokenB", setLockedLiquidityForm)}
              />
              tokenB
            </span>
          </label>
        </Field>
        <TextField form={lockedLiquidityForm} field="salt" label="Salt" setForm={setLockedLiquidityForm} className="xl:col-span-2" />
      </div>
      <ActionRow>
        <ActionButton
          actionId="predict-locked-liquidity"
          disabled={!canUseLockedLiquidityFactory}
          pendingAction={pendingAction}
          variant="secondary"
          onClick={() => void runAction("predict-locked-liquidity", predictLockedLiquidity)}
        >
          <Search className="h-4 w-4" />
          Predict
        </ActionButton>
        <ActionButton
          actionId="create-locked-liquidity"
          disabled={!canUseLockedLiquidityFactory || !capabilityEnabled(createCapability)}
          pendingAction={pendingAction}
          title={capabilityReason(createCapability)}
          onClick={() => void runAction("create-locked-liquidity", createLockedLiquidity)}
        >
          <Lock className="h-4 w-4" />
          Create Lock
        </ActionButton>
      </ActionRow>
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-[minmax(0,1fr)_auto]">
        <Field label="Locker address">
          <Input value={lockedLiquidityAddress} onChange={(event) => setLockedLiquidityAddress(event.target.value)} spellCheck={false} />
        </Field>
        <div className="flex items-end gap-2 border-b border-zinc-800 p-4">
          <ActionButton actionId="load-locked-liquidity" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("load-locked-liquidity", loadLockedLiquidity)}>
            <RefreshCw className="h-4 w-4" />
            Load
          </ActionButton>
          <ActionButton actionId="claim-locked-liquidity-fees" disabled={!capabilityEnabled(manageCapability)} pendingAction={pendingAction} title={capabilityReason(manageCapability)} variant="secondary" onClick={() => void runAction("claim-locked-liquidity-fees", claimLockedLiquidityFees)}>
            <Coins className="h-4 w-4" />
            Claim Fees
          </ActionButton>
        </div>
      </div>
      <Facts
        columns="three"
        items={lockerFacts}
      />
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-3">
        <TextField form={lockedLiquidityExitForm} field="amountAMin" inputMode="decimal" label="Exit amount A min" setForm={setLockedLiquidityExitForm} />
        <TextField form={lockedLiquidityExitForm} field="amountBMin" inputMode="decimal" label="Exit amount B min" setForm={setLockedLiquidityExitForm} />
        <TextField description={timestampPreview(lockedLiquidityExitForm.deadline)} form={lockedLiquidityExitForm} field="deadline" inputMode="numeric" label="Exit deadline" setForm={setLockedLiquidityExitForm} />
      </div>
      <ActionRow>
        <ActionButton actionId="exit-locked-liquidity" disabled={!capabilityEnabled(manageCapability)} pendingAction={pendingAction} title={capabilityReason(manageCapability)} variant="danger" onClick={() => void runAction("exit-locked-liquidity", exitLockedLiquidity)}>
          <Flame className="h-4 w-4" />
          Exit During Wind-Down
        </ActionButton>
      </ActionRow>
      <CapabilityNotice capability={createCapability} fallback={manageCapability} />
    </Panel>
  );
}

function WindDownPanel({
  boardroomSnapshot,
  claimCapability,
  pendingAction,
  permissionlessCapability,
  redeemCapability,
  registerCapability,
  setWindDownForm,
  startCapability,
  windDownForm,
  burnTreasuryShares,
  claimRedemptionAsset,
  openRedemptions,
  redeemBoardroomShares,
  registerRedeemableAsset,
  runAction,
  startWindDown,
}: {
  boardroomSnapshot: BoardroomSnapshot | undefined;
  claimCapability: Capability | undefined;
  pendingAction: string | undefined;
  permissionlessCapability: Capability | undefined;
  redeemCapability: Capability | undefined;
  registerCapability: Capability | undefined;
  setWindDownForm: Dispatch<SetStateAction<WindDownForm>>;
  startCapability: Capability | undefined;
  windDownForm: WindDownForm;
  burnTreasuryShares: () => Promise<void>;
  claimRedemptionAsset: () => Promise<void>;
  openRedemptions: () => Promise<void>;
  redeemBoardroomShares: () => Promise<void>;
  registerRedeemableAsset: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
  startWindDown: () => Promise<void>;
}): React.JSX.Element {
  const blockers = windDownBlockers(boardroomSnapshot);
  const hasBlockers = blockers.length > 0;
  const redeemableAssets = boardroomSnapshot?.redeemableAssets ?? [];
  const windDownFacts = boardroomWindDownFacts(boardroomSnapshot, blockers.length);

  return (
    <Panel title="Wind-Down">
      <Facts
        columns="three"
        items={windDownFacts}
      />
      {hasBlockers ? (
        <ol className="grid gap-px border-t border-zinc-800 bg-zinc-800">
          {blockers.map((blocker) => (
            <li className="grid gap-2 bg-zinc-950 p-4 text-sm" key={`${blocker.kind}-${blocker.address}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="warning">{blocker.kind}</Badge>
                <AddressLink address={blocker.address} />
              </div>
              <p className="m-0 text-zinc-400">{blocker.action}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="m-0 border-t border-zinc-800 p-4 text-sm text-zinc-500">No loaded blockers.</p>
      )}
      <ActionRow>
        <ActionButton actionId="start-wind-down" disabled={boardroomSnapshot?.status !== 0 || !capabilityEnabled(startCapability)} pendingAction={pendingAction} title={capabilityReason(startCapability)} variant="danger" onClick={() => void runAction("start-wind-down", startWindDown)}>
          <Flame className="h-4 w-4" />
          Start Wind-Down
        </ActionButton>
        <ActionButton actionId="burn-treasury-shares" disabled={boardroomSnapshot?.status !== 1 || !capabilityEnabled(permissionlessCapability)} pendingAction={pendingAction} title={capabilityReason(permissionlessCapability)} variant="secondary" onClick={() => void runAction("burn-treasury-shares", burnTreasuryShares)}>
          <Flame className="h-4 w-4" />
          Burn Treasury Shares
        </ActionButton>
        <ActionButton actionId="open-redemptions" disabled={hasBlockers || boardroomSnapshot?.status !== 1 || !capabilityEnabled(permissionlessCapability)} pendingAction={pendingAction} title={capabilityReason(permissionlessCapability)} onClick={() => void runAction("open-redemptions", openRedemptions)}>
          <ShieldCheck className="h-4 w-4" />
          Open Redemptions
        </ActionButton>
      </ActionRow>
      {boardroomSnapshot?.status === 0 && hasBlockers ? (
        <p className="m-0 border-t border-amber-400/25 bg-amber-400/8 p-4 text-sm leading-6 text-amber-100">
          Starting wind-down is allowed now. The obligations above become the permissionless cleanup plan and must be closed before redemptions can open.
        </p>
      ) : null}
      <CapabilityNotice capability={startCapability} fallback={permissionlessCapability} />
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
        <TextField form={windDownForm} field="redeemableAsset" label="Redeemable asset" setForm={setWindDownForm} />
        <Field label="Registered assets">
          <div className="flex min-h-10 flex-wrap items-center gap-2">
            {redeemableAssets.length === 0 ? (
              <span className="text-sm text-zinc-500">None</span>
            ) : (
              redeemableAssets.map((asset) => <AddressLink address={asset} key={asset} />)
            )}
          </div>
        </Field>
      </div>
      <ActionRow>
        <ActionButton actionId="register-redeemable-asset" disabled={!boardroomSnapshot || boardroomSnapshot.status === 2 || !capabilityEnabled(registerCapability)} pendingAction={pendingAction} title={capabilityReason(registerCapability)} variant="secondary" onClick={() => void runAction("register-redeemable-asset", registerRedeemableAsset)}>
          <Plus className="h-4 w-4" />
          Register Asset
        </ActionButton>
      </ActionRow>
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-3">
        <TextField form={windDownForm} field="redeemShares" inputMode="decimal" label="Redeem shares" setForm={setWindDownForm} />
        <TextField form={windDownForm} field="redeemRecipient" label="Recipient" setForm={setWindDownForm} />
        <TextField form={windDownForm} field="minAmountsOut" label="Min amounts out" setForm={setWindDownForm} />
      </div>
      <ActionRow>
        <ActionButton actionId="redeem-boardroom-shares" disabled={boardroomSnapshot?.status !== 2 || !capabilityEnabled(redeemCapability)} pendingAction={pendingAction} title={capabilityReason(redeemCapability)} onClick={() => void runAction("redeem-boardroom-shares", redeemBoardroomShares)}>
          <Send className="h-4 w-4" />
          Redeem Shares
        </ActionButton>
      </ActionRow>
      <p className="m-0 border-t border-zinc-800 p-4 text-sm text-zinc-500">
        Assets settle independently. A failed or below-minimum asset remains credited to the connected holder and can
        be retried below without burning shares again.
      </p>
      <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-3">
        <TextField form={windDownForm} field="claimAsset" label="Retry asset" setForm={setWindDownForm} />
        <TextField form={windDownForm} field="claimRecipient" label="Retry recipient" setForm={setWindDownForm} />
        <TextField form={windDownForm} field="claimMinAmount" inputMode="decimal" label="Retry minimum" setForm={setWindDownForm} />
      </div>
      <ActionRow>
        <ActionButton actionId="claim-redemption-asset" disabled={boardroomSnapshot?.status !== 2 || !capabilityEnabled(claimCapability)} pendingAction={pendingAction} title={capabilityReason(claimCapability)} variant="secondary" onClick={() => void runAction("claim-redemption-asset", claimRedemptionAsset)}>
          <Send className="h-4 w-4" />
          Retry Asset Claim
        </ActionButton>
      </ActionRow>
      <CapabilityNotice capability={redeemCapability} fallback={claimCapability} />
    </Panel>
  );
}

function capabilityEnabled(capability: Capability | undefined): boolean {
  return capability === undefined || capability.status === "enabled";
}

function capabilityReason(capability: Capability | undefined): string | undefined {
  if (!capability || capability.status === "enabled") return undefined;
  return capability.reason ?? "This action is not available in the project’s current lifecycle state.";
}

function CapabilityNotice({
  capability,
  fallback,
}: {
  capability: Capability | undefined;
  fallback?: Capability | undefined;
}): React.JSX.Element | null {
  const blockedCapability = [capability, fallback].find((candidate) =>
    candidate && candidate.status !== "enabled" && candidate.status !== "hidden" && candidate.reason
  );
  if (!blockedCapability?.reason) return null;
  return (
    <p aria-live="polite" className="m-0 border-t border-zinc-800 px-4 py-3 text-sm text-amber-200">
      {blockedCapability.reason}
    </p>
  );
}
