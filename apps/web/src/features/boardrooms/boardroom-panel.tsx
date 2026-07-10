import type {
  Address,
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
import type { Dispatch, SetStateAction } from "react";
import { ActionButton, ActionRow, AddressLink, Facts, Field, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { dateString, randomSalt } from "../../lib/forms";
import { formatTokenAmount } from "../../lib/token-amounts";
import type {
  BoardroomForm,
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
  boardroom,
  fixedPriceSale,
  grant,
  lockedLiquidity,
  merkleAirdrop,
  migratingCurve,
  windDown,
  workflow,
}: BoardroomPanelProps): React.JSX.Element {
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

  return (
    <div className="grid gap-4">
      <Panel
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
            disabled={!deployment?.boardroomFactory}
            pendingAction={pendingAction}
            onClick={() => void runAction("create-boardroom", createBoardroom)}
          >
            <Plus className="h-4 w-4" />
            Create
          </ActionButton>
        </ActionRow>
        <Facts
          columns="one"
          items={[
            { label: "Predicted Boardroom", value: predictedBoardroom ? <AddressLink address={predictedBoardroom} /> : "None" },
            { label: "Factory", value: deployment?.boardroomFactory ? <AddressLink address={deployment.boardroomFactory} /> : deployment?.boardroomReason ?? "Not in artifact" },
          ]}
        />
      </Panel>

      <BoardroomOverview
        boardroomAddress={boardroomAddress}
        boardroomSnapshot={boardroomSnapshot}
        pendingAction={pendingAction}
        setBoardroomAddress={setBoardroomAddress}
        setFixedPriceSaleAddress={setFixedPriceSaleAddress}
        setMerkleAirdropAddress={setMerkleAirdropAddress}
        setLockedLiquidityAddress={setLockedLiquidityAddress}
        setMigratingCurveAddress={setMigratingCurveAddress}
        loadBoardroom={loadBoardroom}
        runAction={runAction}
      />

      <Panel title="Boardroom Shares">
        <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
          <Field label="Mint recipient">
            <Input value={boardroomMintTo} onChange={(event) => setBoardroomMintTo(event.target.value)} spellCheck={false} />
          </Field>
          <Field label="Mint amount">
            <Input value={boardroomMintAmount} inputMode="decimal" onChange={(event) => setBoardroomMintAmount(event.target.value)} />
          </Field>
        </div>
        <ActionRow>
          <ActionButton actionId="mint-boardroom-shares" pendingAction={pendingAction} onClick={() => void runAction("mint-boardroom-shares", mintBoardroomShares)}>
            <Plus className="h-4 w-4" />
            Mint Shares
          </ActionButton>
        </ActionRow>
      </Panel>

      <BoardroomGrantPanel
        boardroomGrantForm={boardroomGrantForm}
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
      />

      <FixedPriceSalePanel
        boardroomSnapshot={boardroomSnapshot}
        deployment={deployment}
        fixedPriceSaleAddress={fixedPriceSaleAddress}
        fixedPriceSaleForm={fixedPriceSaleForm}
        fixedPriceSaleSnapshot={fixedPriceSaleSnapshot}
        pendingAction={pendingAction}
        predictedFixedPriceSale={predictedFixedPriceSale}
        setFixedPriceSaleAddress={setFixedPriceSaleAddress}
        setFixedPriceSaleForm={setFixedPriceSaleForm}
        cancelFixedPriceSale={cancelFixedPriceSale}
        closeFixedPriceSale={closeFixedPriceSale}
        createFixedPriceSale={createFixedPriceSale}
        loadFixedPriceSale={loadFixedPriceSale}
        predictFixedPriceSale={predictFixedPriceSale}
        runAction={runAction}
      />

      <MerkleAirdropPanel
        boardroomSnapshot={boardroomSnapshot}
        deployment={deployment}
        merkleAirdropAddress={merkleAirdropAddress}
        merkleAirdropForm={merkleAirdropForm}
        merkleAirdropSnapshot={merkleAirdropSnapshot}
        pendingAction={pendingAction}
        predictedMerkleAirdrop={predictedMerkleAirdrop}
        setMerkleAirdropAddress={setMerkleAirdropAddress}
        setMerkleAirdropForm={setMerkleAirdropForm}
        cancelMerkleAirdrop={cancelMerkleAirdrop}
        closeMerkleAirdrop={closeMerkleAirdrop}
        createMerkleAirdrop={createMerkleAirdrop}
        loadMerkleAirdrop={loadMerkleAirdrop}
        predictMerkleAirdrop={predictMerkleAirdrop}
        runAction={runAction}
      />

      <MigratingCurvePanel
        boardroomSnapshot={boardroomSnapshot}
        curveMigrationForm={curveMigrationForm}
        deployment={deployment}
        migratingCurveAddress={migratingCurveAddress}
        migratingCurveForm={migratingCurveForm}
        migratingCurveSnapshot={migratingCurveSnapshot}
        pendingAction={pendingAction}
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
      />

      <LockedLiquidityPanel
        boardroomSnapshot={boardroomSnapshot}
        deployment={deployment}
        lockedLiquidityAddress={lockedLiquidityAddress}
        lockedLiquidityExitForm={lockedLiquidityExitForm}
        lockedLiquidityForm={lockedLiquidityForm}
        lockedLiquiditySnapshot={lockedLiquiditySnapshot}
        pendingAction={pendingAction}
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
      />

      <WindDownPanel
        boardroomSnapshot={boardroomSnapshot}
        pendingAction={pendingAction}
        setWindDownForm={setWindDownForm}
        windDownForm={windDownForm}
        burnTreasuryShares={burnTreasuryShares}
        claimRedemptionAsset={claimRedemptionAsset}
        openRedemptions={openRedemptions}
        redeemBoardroomShares={redeemBoardroomShares}
        registerRedeemableAsset={registerRedeemableAsset}
        runAction={runAction}
        startWindDown={startWindDown}
      />
    </div>
  );
}

function BoardroomOverview({
  boardroomAddress,
  boardroomSnapshot,
  pendingAction,
  setBoardroomAddress,
  setFixedPriceSaleAddress,
  setMerkleAirdropAddress,
  setLockedLiquidityAddress,
  setMigratingCurveAddress,
  loadBoardroom,
  runAction,
}: {
  boardroomAddress: string;
  boardroomSnapshot: BoardroomSnapshot | undefined;
  pendingAction: string | undefined;
  setBoardroomAddress: (address: string) => void;
  setFixedPriceSaleAddress: (address: string) => void;
  setMerkleAirdropAddress: (address: string) => void;
  setLockedLiquidityAddress: (address: string) => void;
  setMigratingCurveAddress: (address: string) => void;
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
          Load
        </ActionButton>
      }
    >
      <div className="border-t border-zinc-800">
        <Field label="Boardroom address">
          <Input value={boardroomAddress} onChange={(event) => setBoardroomAddress(event.target.value)} spellCheck={false} />
        </Field>
      </div>
      <Facts
        columns="three"
        items={accountFacts}
      />
      <ObligationLists
        boardroomSnapshot={boardroomSnapshot}
        setFixedPriceSaleAddress={setFixedPriceSaleAddress}
        setMerkleAirdropAddress={setMerkleAirdropAddress}
        setLockedLiquidityAddress={setLockedLiquidityAddress}
        setMigratingCurveAddress={setMigratingCurveAddress}
      />
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
      title="Boardroom Share Grant"
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
        <TextField form={boardroomGrantForm} field="vestingCliff" inputMode="numeric" label="Vesting cliff timestamp" setForm={setBoardroomGrantForm} />
        <TextField form={boardroomGrantForm} field="vestingEnd" inputMode="numeric" label="Vesting end timestamp" setForm={setBoardroomGrantForm} />
        <TextField form={boardroomGrantForm} field="expiry" inputMode="numeric" label="Expiry timestamp" setForm={setBoardroomGrantForm} />
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
          form={boardroomGrantForm}
          field="transferUnlockTime"
          inputMode="numeric"
          label="Transfer unlock timestamp"
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
          Predict
        </ActionButton>
        <ActionButton
          actionId="boardroom-approve-factory"
          pendingAction={pendingAction}
          variant="secondary"
          onClick={() => void runAction("boardroom-approve-factory", boardroomApproveFactory)}
        >
          <CheckCircle2 className="h-4 w-4" />
          Approve Only
        </ActionButton>
        <ActionButton
          actionId="boardroom-create-grant-batch"
          pendingAction={pendingAction}
          onClick={() => void runAction("boardroom-create-grant-batch", boardroomCreateGrantBatch)}
        >
          <Send className="h-4 w-4" />
          Create Grant
        </ActionButton>
        <ActionButton
          actionId="boardroom-create-grant"
          pendingAction={pendingAction}
          variant="secondary"
          onClick={() => void runAction("boardroom-create-grant", boardroomCreateGrant)}
        >
          <Send className="h-4 w-4" />
          Create Only
        </ActionButton>
      </ActionRow>
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

function FixedPriceSalePanel({
  boardroomSnapshot,
  deployment,
  fixedPriceSaleAddress,
  fixedPriceSaleForm,
  fixedPriceSaleSnapshot,
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
  deployment: PledgeCashDeployment | undefined;
  fixedPriceSaleAddress: string;
  fixedPriceSaleForm: FixedPriceSaleForm;
  fixedPriceSaleSnapshot: FixedPriceSaleState | undefined;
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
        <TextField form={fixedPriceSaleForm} field="startTime" inputMode="numeric" label="Start timestamp" setForm={setFixedPriceSaleForm} />
        <TextField form={fixedPriceSaleForm} field="endTime" inputMode="numeric" label="End timestamp" setForm={setFixedPriceSaleForm} />
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
          disabled={!canUseDistributionFactory}
          pendingAction={pendingAction}
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
          <ActionButton actionId="close-fixed-sale" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("close-fixed-sale", closeFixedPriceSale)}>
            <ShieldCheck className="h-4 w-4" />
            Close
          </ActionButton>
          <ActionButton actionId="cancel-fixed-sale" pendingAction={pendingAction} variant="danger" onClick={() => void runAction("cancel-fixed-sale", cancelFixedPriceSale)}>
            <XCircle className="h-4 w-4" />
            Cancel
          </ActionButton>
        </div>
      </div>
      <Facts
        columns="three"
        items={saleFacts}
      />
    </Panel>
  );
}

function MerkleAirdropPanel({
  boardroomSnapshot,
  deployment,
  merkleAirdropAddress,
  merkleAirdropForm,
  merkleAirdropSnapshot,
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
  deployment: PledgeCashDeployment | undefined;
  merkleAirdropAddress: string;
  merkleAirdropForm: MerkleAirdropForm;
  merkleAirdropSnapshot: MerkleAirdropState | undefined;
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
        <TextField form={merkleAirdropForm} field="startTime" inputMode="numeric" label="Start timestamp" setForm={setMerkleAirdropForm} />
        <TextField form={merkleAirdropForm} field="endTime" inputMode="numeric" label="End timestamp" setForm={setMerkleAirdropForm} />
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
          disabled={!canUseDistributionFactory}
          pendingAction={pendingAction}
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
          <ActionButton actionId="close-merkle-airdrop" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("close-merkle-airdrop", closeMerkleAirdrop)}>
            <ShieldCheck className="h-4 w-4" />
            Close
          </ActionButton>
          <ActionButton actionId="cancel-merkle-airdrop" pendingAction={pendingAction} variant="danger" onClick={() => void runAction("cancel-merkle-airdrop", cancelMerkleAirdrop)}>
            <XCircle className="h-4 w-4" />
            Cancel
          </ActionButton>
        </div>
      </div>
      <Facts
        columns="three"
        items={airdropFacts}
      />
    </Panel>
  );
}

function MigratingCurvePanel({
  boardroomSnapshot,
  curveMigrationForm,
  deployment,
  migratingCurveAddress,
  migratingCurveForm,
  migratingCurveSnapshot,
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
  curveMigrationForm: CurveMigrationForm;
  deployment: PledgeCashDeployment | undefined;
  migratingCurveAddress: string;
  migratingCurveForm: MigratingCurveForm;
  migratingCurveSnapshot: MigratingBondingCurveState | undefined;
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
        <TextField form={migratingCurveForm} field="startTime" inputMode="numeric" label="Start timestamp" setForm={setMigratingCurveForm} />
        <TextField form={migratingCurveForm} field="endTime" inputMode="numeric" label="End timestamp" setForm={setMigratingCurveForm} />
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
          disabled={!canUseDistributionFactory}
          pendingAction={pendingAction}
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
          <ActionButton actionId="cancel-migrating-curve" pendingAction={pendingAction} variant="danger" onClick={() => void runAction("cancel-migrating-curve", cancelMigratingCurve)}>
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
        <TextField form={curveMigrationForm} field="deadline" inputMode="numeric" label="Migration deadline" setForm={setCurveMigrationForm} />
      </div>
      <ActionRow>
        <ActionButton actionId="migrate-curve" pendingAction={pendingAction} onClick={() => void runAction("migrate-curve", migrateCurve)}>
          <ShieldCheck className="h-4 w-4" />
          Migrate To Locked LP
        </ActionButton>
      </ActionRow>
    </Panel>
  );
}

function LockedLiquidityPanel({
  boardroomSnapshot,
  deployment,
  lockedLiquidityAddress,
  lockedLiquidityExitForm,
  lockedLiquidityForm,
  lockedLiquiditySnapshot,
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
  deployment: PledgeCashDeployment | undefined;
  lockedLiquidityAddress: string;
  lockedLiquidityExitForm: LockedLiquidityExitForm;
  lockedLiquidityForm: LockedLiquidityForm;
  lockedLiquiditySnapshot: LockedLiquidityState | undefined;
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
        <TextField form={lockedLiquidityForm} field="deadline" inputMode="numeric" label="Deadline" setForm={setLockedLiquidityForm} />
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
          disabled={!canUseLockedLiquidityFactory}
          pendingAction={pendingAction}
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
          <ActionButton actionId="claim-locked-liquidity-fees" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("claim-locked-liquidity-fees", claimLockedLiquidityFees)}>
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
        <TextField form={lockedLiquidityExitForm} field="deadline" inputMode="numeric" label="Exit deadline" setForm={setLockedLiquidityExitForm} />
      </div>
      <ActionRow>
        <ActionButton actionId="exit-locked-liquidity" pendingAction={pendingAction} variant="danger" onClick={() => void runAction("exit-locked-liquidity", exitLockedLiquidity)}>
          <Flame className="h-4 w-4" />
          Exit During Wind-Down
        </ActionButton>
      </ActionRow>
    </Panel>
  );
}

function WindDownPanel({
  boardroomSnapshot,
  pendingAction,
  setWindDownForm,
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
  pendingAction: string | undefined;
  setWindDownForm: Dispatch<SetStateAction<WindDownForm>>;
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
        <ActionButton actionId="start-wind-down" pendingAction={pendingAction} variant="danger" onClick={() => void runAction("start-wind-down", startWindDown)}>
          <Flame className="h-4 w-4" />
          Start Wind-Down
        </ActionButton>
        <ActionButton actionId="burn-treasury-shares" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("burn-treasury-shares", burnTreasuryShares)}>
          <Flame className="h-4 w-4" />
          Burn Treasury Shares
        </ActionButton>
        <ActionButton actionId="open-redemptions" pendingAction={pendingAction} onClick={() => void runAction("open-redemptions", openRedemptions)}>
          <ShieldCheck className="h-4 w-4" />
          Open Redemptions
        </ActionButton>
      </ActionRow>
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
        <ActionButton actionId="register-redeemable-asset" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("register-redeemable-asset", registerRedeemableAsset)}>
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
        <ActionButton actionId="redeem-boardroom-shares" pendingAction={pendingAction} onClick={() => void runAction("redeem-boardroom-shares", redeemBoardroomShares)}>
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
        <ActionButton actionId="claim-redemption-asset" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("claim-redemption-asset", claimRedemptionAsset)}>
          <Send className="h-4 w-4" />
          Retry Asset Claim
        </ActionButton>
      </ActionRow>
    </Panel>
  );
}
