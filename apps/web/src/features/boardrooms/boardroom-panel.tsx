import type {
  Address,
  FixedPriceSaleState,
  LockedLiquidityState,
  MigratingBondingCurveState,
  PledgeCashDeployment,
} from "@pledge.cash/sdk";
import {
  CheckCircle2,
  Coins,
  Flame,
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
  BoardroomDistributionSnapshot,
  BoardroomForm,
  BoardroomGrantForm,
  BoardroomGrantSnapshot,
  BoardroomLockedLiquiditySnapshot,
  BoardroomSnapshot,
  CurveMigrationForm,
  FixedPriceSaleForm,
  LockedLiquidityExitForm,
  LockedLiquidityForm,
  MigratingCurveForm,
  WindDownForm,
} from "../../lib/types";

type BoardroomPanelProps = {
  boardroom: BoardroomPanelState;
  fixedPriceSale: FixedPriceSalePanelState;
  grant: BoardroomGrantPanelState;
  lockedLiquidity: LockedLiquidityPanelState;
  migratingCurve: MigratingCurvePanelState;
  windDown: WindDownPanelState;
  workflow: BoardroomWorkflow;
};

type BoardroomWorkflow = {
  deployment: PledgeCashDeployment | undefined;
  pendingAction: string | undefined;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
};

type BoardroomPanelState = {
  address: string;
  form: BoardroomForm;
  mintAmount: string;
  mintTo: string;
  predicted: Address | undefined;
  snapshot: BoardroomSnapshot | undefined;
  create: () => Promise<void>;
  load: () => Promise<void>;
  mintShares: () => Promise<void>;
  predict: () => Promise<void>;
  setBoardroomAddress: (address: string) => void;
  setBoardroomForm: Dispatch<SetStateAction<BoardroomForm>>;
  setBoardroomMintAmount: Dispatch<SetStateAction<string>>;
  setBoardroomMintTo: Dispatch<SetStateAction<string>>;
  setPredictedBoardroom: Dispatch<SetStateAction<Address | undefined>>;
};

type BoardroomGrantPanelState = {
  form: BoardroomGrantForm;
  predicted: Address | undefined;
  approveFactory: () => Promise<void>;
  clearPrediction: () => void;
  create: () => Promise<void>;
  createBatch: () => Promise<void>;
  predict: () => Promise<void>;
  setForm: Dispatch<SetStateAction<BoardroomGrantForm>>;
};

type FixedPriceSalePanelState = {
  address: string;
  form: FixedPriceSaleForm;
  predicted: Address | undefined;
  snapshot: FixedPriceSaleState | undefined;
  cancel: () => Promise<void>;
  close: () => Promise<void>;
  create: () => Promise<void>;
  load: () => Promise<void>;
  predict: () => Promise<void>;
  setFixedPriceSaleAddress: (address: string) => void;
  setFixedPriceSaleForm: Dispatch<SetStateAction<FixedPriceSaleForm>>;
};

type MigratingCurvePanelState = {
  address: string;
  form: MigratingCurveForm;
  migrationForm: CurveMigrationForm;
  predicted: Address | undefined;
  snapshot: MigratingBondingCurveState | undefined;
  cancel: () => Promise<void>;
  create: () => Promise<void>;
  load: () => Promise<void>;
  migrate: () => Promise<void>;
  predict: () => Promise<void>;
  setCurveMigrationForm: Dispatch<SetStateAction<CurveMigrationForm>>;
  setMigratingCurveAddress: (address: string) => void;
  setMigratingCurveForm: Dispatch<SetStateAction<MigratingCurveForm>>;
};

type LockedLiquidityPanelState = {
  address: string;
  exitForm: LockedLiquidityExitForm;
  form: LockedLiquidityForm;
  predicted: Address | undefined;
  snapshot: LockedLiquidityState | undefined;
  claimFees: () => Promise<void>;
  create: () => Promise<void>;
  exit: () => Promise<void>;
  load: () => Promise<void>;
  predict: () => Promise<void>;
  setLockedLiquidityAddress: (address: string) => void;
  setLockedLiquidityExitForm: Dispatch<SetStateAction<LockedLiquidityExitForm>>;
  setLockedLiquidityForm: Dispatch<SetStateAction<LockedLiquidityForm>>;
};

type WindDownPanelState = {
  form: WindDownForm;
  burnTreasuryShares: () => Promise<void>;
  openRedemptions: () => Promise<void>;
  redeemShares: () => Promise<void>;
  registerRedeemableAsset: () => Promise<void>;
  setForm: Dispatch<SetStateAction<WindDownForm>>;
  start: () => Promise<void>;
};

export function BoardroomPanel({
  boardroom,
  fixedPriceSale,
  grant,
  lockedLiquidity,
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
  setLockedLiquidityAddress: (address: string) => void;
  setMigratingCurveAddress: (address: string) => void;
  loadBoardroom: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
}): React.JSX.Element {
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
        items={[
          { label: "Owner", value: boardroomSnapshot?.owner ? <AddressLink address={boardroomSnapshot.owner} /> : "Unknown" },
          {
            label: "Policy registry",
            value: boardroomSnapshot?.policyRegistry ? <AddressLink address={boardroomSnapshot.policyRegistry} /> : "Unknown",
          },
          { label: "Share token", value: boardroomSnapshot?.shareToken ? <AddressLink address={boardroomSnapshot.shareToken} /> : "Unknown" },
          { label: "Status", value: <StatusBadge label={boardroomStatusLabel(boardroomSnapshot?.status)} tone={boardroomStatusTone(boardroomSnapshot?.status)} /> },
          { label: "Redeemable assets", value: String(boardroomSnapshot?.redeemableAssets.length ?? 0) },
          {
            label: "Obligations",
            value: `${boardroomSnapshot?.issuedGrants.length ?? 0} grants / ${boardroomSnapshot?.issuedDistributions.length ?? 0} distributions / ${boardroomSnapshot?.lockedLiquidityPositions.length ?? 0} lockers`,
          },
        ]}
      />
      <ObligationLists
        boardroomSnapshot={boardroomSnapshot}
        setFixedPriceSaleAddress={setFixedPriceSaleAddress}
        setLockedLiquidityAddress={setLockedLiquidityAddress}
        setMigratingCurveAddress={setMigratingCurveAddress}
      />
    </Panel>
  );
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
          disabled={!deployment?.distributionFactory}
          pendingAction={pendingAction}
          variant="secondary"
          onClick={() => void runAction("predict-fixed-sale", predictFixedPriceSale)}
        >
          <Search className="h-4 w-4" />
          Predict
        </ActionButton>
        <ActionButton
          actionId="create-fixed-sale"
          disabled={!deployment?.distributionFactory}
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
        items={[
          { label: "Predicted sale", value: predictedFixedPriceSale ? <AddressLink address={predictedFixedPriceSale} /> : "None" },
          { label: "Status", value: fixedPriceSaleSnapshot ? <StatusBadge label={saleStatusLabel(fixedPriceSaleSnapshot.saleStatus)} tone={fixedPriceSaleSnapshot.closed ? "warning" : "default"} /> : "Not loaded" },
          { label: "Remaining shares", value: formatTokenAmount(fixedPriceSaleSnapshot?.remainingShares, distributionSummary?.shareTokenMetadata) },
          { label: "Payment token", value: fixedPriceSaleSnapshot ? <AddressLink address={fixedPriceSaleSnapshot.paymentToken} /> : "Unknown" },
          { label: "Price", value: formatTokenAmount(fixedPriceSaleSnapshot?.price, distributionSummary?.paymentTokenMetadata) },
          { label: "Window", value: fixedPriceSaleSnapshot ? `${dateString(fixedPriceSaleSnapshot.startTime)} -> ${dateString(fixedPriceSaleSnapshot.endTime)}` : "Unknown" },
        ]}
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
          disabled={!deployment?.distributionFactory}
          pendingAction={pendingAction}
          variant="secondary"
          onClick={() => void runAction("predict-migrating-curve", predictMigratingCurve)}
        >
          <Search className="h-4 w-4" />
          Predict
        </ActionButton>
        <ActionButton
          actionId="create-migrating-curve"
          disabled={!deployment?.distributionFactory}
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
        items={[
          { label: "Predicted curve", value: predictedMigratingCurve ? <AddressLink address={predictedMigratingCurve} /> : "None" },
          { label: "Status", value: migratingCurveSnapshot ? <StatusBadge label={curveStatusLabel(migratingCurveSnapshot.curveStatus)} tone={migratingCurveSnapshot.closed ? "warning" : "default"} /> : "Not loaded" },
          { label: "Can migrate", value: migratingCurveSnapshot ? String(migratingCurveSnapshot.canMigrate) : "Unknown" },
          { label: "Remaining sale shares", value: formatTokenAmount(migratingCurveSnapshot?.remainingSaleShares, distributionSummary?.shareTokenMetadata) },
          { label: "Sold shares", value: formatTokenAmount(migratingCurveSnapshot?.soldShares, distributionSummary?.shareTokenMetadata) },
          { label: "Quote reserve", value: formatTokenAmount(migratingCurveSnapshot?.quoteReserve, distributionSummary?.quoteTokenMetadata) },
          { label: "Quote token", value: migratingCurveSnapshot ? <AddressLink address={migratingCurveSnapshot.quoteToken} /> : "Unknown" },
          { label: "Locker", value: migratingCurveSnapshot?.locker ? <AddressLink address={migratingCurveSnapshot.locker} /> : "Unknown" },
          { label: "Pool", value: migratingCurveSnapshot?.pool ? <AddressLink address={migratingCurveSnapshot.pool} /> : "Unknown" },
        ]}
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
          disabled={!deployment?.lockedLiquidityFactory}
          pendingAction={pendingAction}
          variant="secondary"
          onClick={() => void runAction("predict-locked-liquidity", predictLockedLiquidity)}
        >
          <Search className="h-4 w-4" />
          Predict
        </ActionButton>
        <ActionButton
          actionId="create-locked-liquidity"
          disabled={!deployment?.lockedLiquidityFactory}
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
        items={[
          { label: "Predicted locker", value: predictedLockedLiquidity ? <AddressLink address={predictedLockedLiquidity} /> : "None" },
          { label: "Seeded", value: lockedLiquiditySnapshot ? String(lockedLiquiditySnapshot.seeded) : "Unknown" },
          { label: "Locked LP", value: formatTokenAmount(lockedLiquiditySnapshot?.lockedLiquidity, lockerSummary?.liquidityMetadata) },
          { label: "Token A", value: lockedLiquiditySnapshot ? <AddressLink address={lockedLiquiditySnapshot.tokenA} /> : "Unknown" },
          { label: "Token B", value: lockedLiquiditySnapshot ? <AddressLink address={lockedLiquiditySnapshot.tokenB} /> : "Unknown" },
          { label: "Pool", value: lockedLiquiditySnapshot?.pool ? <AddressLink address={lockedLiquiditySnapshot.pool} /> : "Unknown" },
        ]}
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
  openRedemptions: () => Promise<void>;
  redeemBoardroomShares: () => Promise<void>;
  registerRedeemableAsset: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
  startWindDown: () => Promise<void>;
}): React.JSX.Element {
  const blockers = windDownBlockers(boardroomSnapshot);

  return (
    <Panel title="Wind-Down">
      <Facts
        columns="three"
        items={[
          { label: "Status", value: <StatusBadge label={boardroomStatusLabel(boardroomSnapshot?.status)} tone={boardroomStatusTone(boardroomSnapshot?.status)} /> },
          { label: "Open blockers", value: String(blockers.length) },
          { label: "Redeemable assets", value: String(boardroomSnapshot?.redeemableAssets.length ?? 0) },
        ]}
      />
      {blockers.length === 0 ? (
        <p className="m-0 border-t border-zinc-800 p-4 text-sm text-zinc-500">No loaded blockers.</p>
      ) : (
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
            {(boardroomSnapshot?.redeemableAssets ?? []).length === 0 ? (
              <span className="text-sm text-zinc-500">None</span>
            ) : (
              boardroomSnapshot?.redeemableAssets.map((asset) => <AddressLink address={asset} key={asset} />)
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
    </Panel>
  );
}

function ObligationLists({
  boardroomSnapshot,
  setFixedPriceSaleAddress,
  setLockedLiquidityAddress,
  setMigratingCurveAddress,
}: {
  boardroomSnapshot: BoardroomSnapshot | undefined;
  setFixedPriceSaleAddress: (address: string) => void;
  setLockedLiquidityAddress: (address: string) => void;
  setMigratingCurveAddress: (address: string) => void;
}): React.JSX.Element {
  if (!boardroomSnapshot) {
    return <p className="m-0 border-t border-zinc-800 p-4 text-sm text-zinc-500">Load a Boardroom to view obligations.</p>;
  }

  return (
    <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 xl:grid-cols-3">
      <ObligationColumn title="Issued Grants" emptyLabel="No grants">
        {boardroomSnapshot.grantSummaries.map((grant) => <GrantRow grant={grant} key={grant.address} />)}
      </ObligationColumn>
      <ObligationColumn title="Distributions" emptyLabel="No distributions">
        {boardroomSnapshot.distributionSummaries.map((distribution) => (
          <DistributionRow
            distribution={distribution}
            key={distribution.address}
            setFixedPriceSaleAddress={setFixedPriceSaleAddress}
            setMigratingCurveAddress={setMigratingCurveAddress}
          />
        ))}
      </ObligationColumn>
      <ObligationColumn title="Locked Liquidity" emptyLabel="No lockers">
        {boardroomSnapshot.lockedLiquiditySummaries.map((locker) => (
          <LockerRow locker={locker} key={locker.address} setLockedLiquidityAddress={setLockedLiquidityAddress} />
        ))}
      </ObligationColumn>
    </div>
  );
}

function ObligationColumn({ children, emptyLabel, title }: { children: React.ReactNode; emptyLabel: string; title: string }): React.JSX.Element {
  const childArray = Array.isArray(children) ? children : [children];
  const visibleChildren = childArray.filter(Boolean);

  return (
    <section className="min-w-0 bg-zinc-950">
      <h3 className="m-0 border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">{title}</h3>
      {visibleChildren.length === 0 ? (
        <p className="m-0 p-4 text-sm text-zinc-500">{emptyLabel}</p>
      ) : (
        <ol className="grid gap-px bg-zinc-800">{visibleChildren.map((child, index) => <li className="bg-zinc-950 p-4" key={index}>{child}</li>)}</ol>
      )}
    </section>
  );
}

function GrantRow({ grant }: { grant: BoardroomGrantSnapshot }): React.JSX.Element {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AddressLink address={grant.address} />
        <StatusBadge label={grant.state?.closed ? "Closed" : grant.error ? "Read failed" : "Open"} tone={grant.state?.closed ? "warning" : grant.error ? "danger" : "default"} />
      </div>
      {grant.error ? <p className="m-0 text-sm text-red-200">{grant.error}</p> : null}
      <Facts
        columns="one"
        items={[
          { label: "Holder", value: grant.state ? <AddressLink address={grant.state.holder} /> : "Unknown" },
          { label: "Grant size", value: formatTokenAmount(grant.state?.grantSize, grant.tokenMetadata) },
          { label: "Claimable", value: formatTokenAmount(grant.state?.claimable, grant.tokenMetadata) },
        ]}
      />
    </div>
  );
}

function DistributionRow({
  distribution,
  setFixedPriceSaleAddress,
  setMigratingCurveAddress,
}: {
  distribution: BoardroomDistributionSnapshot;
  setFixedPriceSaleAddress: (address: string) => void;
  setMigratingCurveAddress: (address: string) => void;
}): React.JSX.Element {
  const isFixedSale = distribution.kind === "fixed-price-sale";
  const status = isFixedSale
    ? saleStatusLabel((distribution.state as FixedPriceSaleState | undefined)?.saleStatus)
    : curveStatusLabel((distribution.state as MigratingBondingCurveState | undefined)?.curveStatus);
  const closed = Boolean(distribution.state?.closed);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AddressLink address={distribution.address} />
        <StatusBadge label={distribution.error ? "Read failed" : status} tone={closed ? "warning" : distribution.error ? "danger" : "default"} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="muted">{distribution.kind}</Badge>
        {distribution.kind === "fixed-price-sale" ? (
          <Button size="sm" variant="secondary" onClick={() => setFixedPriceSaleAddress(distribution.address)}>
            Use Sale
          </Button>
        ) : distribution.kind === "migrating-bonding-curve" ? (
          <Button size="sm" variant="secondary" onClick={() => setMigratingCurveAddress(distribution.address)}>
            Use Curve
          </Button>
        ) : null}
      </div>
      {distribution.error ? <p className="m-0 text-sm text-red-200">{distribution.error}</p> : null}
      <Facts
        columns="one"
        items={distributionFacts(distribution)}
      />
    </div>
  );
}

function LockerRow({ locker, setLockedLiquidityAddress }: { locker: BoardroomLockedLiquiditySnapshot; setLockedLiquidityAddress: (address: string) => void }): React.JSX.Element {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AddressLink address={locker.address} />
        <StatusBadge label={locker.error ? "Read failed" : locker.state?.lockedLiquidity === 0n ? "Exited" : "Locked"} tone={locker.error ? "danger" : locker.state?.lockedLiquidity === 0n ? "warning" : "default"} />
      </div>
      <Button size="sm" variant="secondary" onClick={() => setLockedLiquidityAddress(locker.address)}>
        Use Locker
      </Button>
      {locker.error ? <p className="m-0 text-sm text-red-200">{locker.error}</p> : null}
      <Facts
        columns="one"
        items={[
          { label: "Pool", value: locker.state?.pool ? <AddressLink address={locker.state.pool} /> : "Unknown" },
          { label: "Locked LP", value: formatTokenAmount(locker.state?.lockedLiquidity, locker.liquidityMetadata) },
          { label: "Token pair", value: locker.state ? `${locker.state.tokenA} / ${locker.state.tokenB}` : "Unknown" },
        ]}
      />
    </div>
  );
}

function TextField<T extends object, K extends keyof T & string>({
  className,
  disabled,
  field,
  form,
  inputMode,
  label,
  setForm,
}: {
  className?: string;
  disabled?: boolean;
  field: K;
  form: T;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  label: string;
  setForm: Dispatch<SetStateAction<T>>;
}): React.JSX.Element {
  return (
    <Field label={label} {...(className ? { className } : {})}>
      <Input
        disabled={disabled}
        inputMode={inputMode}
        value={String(form[field] ?? "")}
        spellCheck={false}
        onChange={(event) => setFormField(field, event.target.value as T[K], setForm)}
      />
    </Field>
  );
}

function setFormField<T, K extends keyof T>(key: K, value: T[K], setter: Dispatch<SetStateAction<T>>): void {
  setter((current) => ({ ...current, [key]: value }));
}

function StatusBadge({ label, tone }: { label: string; tone: "default" | "muted" | "warning" | "danger" }): React.JSX.Element {
  return <Badge variant={tone}>{label}</Badge>;
}

function boardroomStatusLabel(status: number | undefined): string {
  if (status === 0) return "Active";
  if (status === 1) return "Winding down";
  if (status === 2) return "Redemptions open";
  return "Unknown";
}

function boardroomStatusTone(status: number | undefined): "default" | "muted" | "warning" | "danger" {
  if (status === 0) return "default";
  if (status === 1) return "warning";
  if (status === 2) return "muted";
  return "muted";
}

function saleStatusLabel(status: number | undefined): string {
  if (status === 0) return "Active";
  if (status === 1) return "Closed";
  if (status === 2) return "Cancelled";
  return "Unknown";
}

function curveStatusLabel(status: number | undefined): string {
  if (status === 0) return "Active";
  if (status === 1) return "Migrated";
  if (status === 2) return "Cancelled";
  return "Unknown";
}

function distributionSummaryFor(
  boardroomSnapshot: BoardroomSnapshot | undefined,
  address: string | undefined,
): BoardroomDistributionSnapshot | undefined {
  if (!boardroomSnapshot || !address) return undefined;
  return boardroomSnapshot.distributionSummaries.find((distribution) => distribution.address.toLowerCase() === address.toLowerCase());
}

function lockerSummaryFor(
  boardroomSnapshot: BoardroomSnapshot | undefined,
  address: string | undefined,
): BoardroomLockedLiquiditySnapshot | undefined {
  if (!boardroomSnapshot || !address) return undefined;
  return boardroomSnapshot.lockedLiquiditySummaries.find((locker) => locker.address.toLowerCase() === address.toLowerCase());
}

function distributionFacts(distribution: BoardroomDistributionSnapshot): { label: string; value: React.ReactNode }[] {
  if (distribution.kind === "fixed-price-sale") {
    const state = distribution.state as FixedPriceSaleState | undefined;
    return [
      { label: "Remaining shares", value: formatTokenAmount(state?.remainingShares, distribution.shareTokenMetadata) },
      { label: "Payment token", value: state ? <AddressLink address={state.paymentToken} /> : "Unknown" },
      { label: "Price", value: formatTokenAmount(state?.price, distribution.paymentTokenMetadata) },
    ];
  }
  if (distribution.kind === "migrating-bonding-curve") {
    const state = distribution.state as MigratingBondingCurveState | undefined;
    return [
      { label: "Remaining shares", value: formatTokenAmount(state?.remainingSaleShares, distribution.shareTokenMetadata) },
      { label: "Quote reserve", value: formatTokenAmount(state?.quoteReserve, distribution.quoteTokenMetadata) },
      { label: "Can migrate", value: state ? String(state.canMigrate) : "Unknown" },
    ];
  }
  return [];
}

function windDownBlockers(boardroomSnapshot: BoardroomSnapshot | undefined): { kind: string; address: Address; action: string }[] {
  if (!boardroomSnapshot) return [];

  const grantBlockers = boardroomSnapshot.grantSummaries
    .filter((grant) => grant.error || !grant.state?.closed)
    .map((grant) => ({
      kind: "Grant",
      address: grant.address,
      action: grant.error ? "Reload the grant state or inspect the address." : "Halt/withdraw or wait until the grant can close.",
    }));
  const distributionBlockers = boardroomSnapshot.distributionSummaries
    .filter((distribution) => distribution.error || !distribution.state?.closed)
    .map((distribution) => ({
      kind: distribution.kind === "fixed-price-sale" ? "Sale" : "Curve",
      address: distribution.address,
      action: distribution.error ? "Reload the distribution state." : "Close, cancel, or migrate this distribution.",
    }));
  const lockerBlockers = boardroomSnapshot.lockedLiquiditySummaries
    .filter((locker) => locker.error || (locker.state?.lockedLiquidity ?? 0n) !== 0n)
    .map((locker) => ({
      kind: "Locker",
      address: locker.address,
      action: locker.error ? "Reload the locked-liquidity state." : "Exit locked liquidity during wind-down.",
    }));

  return [...grantBlockers, ...distributionBlockers, ...lockerBlockers];
}
