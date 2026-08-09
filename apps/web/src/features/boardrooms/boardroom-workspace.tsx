import type { Address, BoardroomState, LiquidityLockerState } from "@pledge.cash/sdk";
import { ArchiveRestore, Coins, Droplets, Landmark, RefreshCw, Send, ShieldCheck } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { ProjectSection, StudioSection } from "../../app/routing";
import { ProjectSectionNav, StudioSectionNav } from "../../app/product-navigation";
import { ActionButton, ActionRow, AddressLink, Facts, Field, Panel, WorkspaceHeader } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { bigintString, randomSalt } from "../../lib/forms";
import type {
  BoardroomForm,
  BoardroomGrantForm,
  LiquidityExitForm,
  LiquidityLockerForm,
  LiquidityPositionForm,
  WindDownForm,
} from "../../lib/types";

export type BoardroomAction =
  | "refresh"
  | "mint"
  | "create-grant"
  | "create-locker"
  | "register-position"
  | "collect-fees"
  | "cancel-locker"
  | "exit-locker"
  | "register-asset"
  | "start-wind-down"
  | "begin-snapshot"
  | "snapshot-assets"
  | "wrap-native"
  | "open-redemptions"
  | "redeem"
  | "claim-asset";

export type BoardroomWorkspaceForm = {
  mintTo: string;
  mintAmount: string;
  snapshotMaximum: string;
  grant: BoardroomGrantForm;
  locker: LiquidityLockerForm;
  position: LiquidityPositionForm;
  exit: LiquidityExitForm;
  windDown: WindDownForm;
};

export function BoardroomCreatePanel({
  form,
  pendingAction,
  predicted,
  setForm,
  create,
  predict,
  runAction,
}: {
  form: BoardroomForm;
  pendingAction: string | undefined;
  predicted: Address | undefined;
  setForm: Dispatch<SetStateAction<BoardroomForm>>;
  create: () => Promise<void>;
  predict: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
}): React.JSX.Element {
  const set = (field: keyof BoardroomForm, value: string): void => setForm((current) => ({ ...current, [field]: value }));
  return (
    <Panel
      title="Create Boardroom"
      description="Create the project custody boundary and its share token. The connected wallet remains the flat owner authority."
      action={<Button variant="secondary" onClick={() => set("salt", randomSalt())}>New salt</Button>}
    >
      <div className="grid gap-px border-t border-[var(--pc-border)] bg-[var(--pc-border)] md:grid-cols-2">
        <TextField label="Owner" value={form.owner} onChange={(value) => set("owner", value)} />
        <TextField label="Project name" value={form.name} onChange={(value) => set("name", value)} />
        <TextField label="Share symbol" value={form.symbol} onChange={(value) => set("symbol", value)} />
        <TextField label="Salt" value={form.salt} onChange={(value) => set("salt", value)} />
      </div>
      <ActionRow>
        <ActionButton actionId="predict-boardroom" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("predict-boardroom", predict)}>
          <ShieldCheck className="h-4 w-4" />Predict
        </ActionButton>
        <ActionButton actionId="create-boardroom" pendingAction={pendingAction} onClick={() => void runAction("create-boardroom", create)}>
          <Landmark className="h-4 w-4" />Create Boardroom
        </ActionButton>
      </ActionRow>
      <Facts columns="one" items={[{ label: "Predicted Boardroom", value: predicted ? <AddressLink address={predicted} /> : "Not predicted" }]} />
    </Panel>
  );
}

export function BoardroomWorkspace({
  account,
  boardroom,
  canManage,
  canWrite,
  chainId,
  form,
  locker,
  mode,
  pendingAction,
  projectSection,
  setForm,
  studioSection,
  swap,
  onAction,
}: {
  account: Address | undefined;
  boardroom: BoardroomState;
  canManage: boolean;
  canWrite: boolean;
  chainId: number;
  form: BoardroomWorkspaceForm;
  locker: LiquidityLockerState | undefined;
  mode: "project" | "studio";
  pendingAction: string | undefined;
  projectSection?: ProjectSection | undefined;
  setForm: Dispatch<SetStateAction<BoardroomWorkspaceForm>>;
  studioSection?: StudioSection | undefined;
  swap?: ReactNode;
  onAction: (action: BoardroomAction) => Promise<void>;
}): React.JSX.Element {
  const refresh = (
    <ActionButton actionId="refresh-boardroom" pendingAction={pendingAction} variant="secondary" onClick={() => void onAction("refresh")}>
      <RefreshCw className="h-4 w-4" />Refresh
    </ActionButton>
  );
  return (
    <>
      <WorkspaceHeader
        eyebrow={mode === "studio" ? "Project studio" : "Project"}
        title={mode === "studio" ? "Boardroom workspace" : "Boardroom overview"}
        description="One custody boundary for shares, grant escrows, a canonical locked Uniswap v4 position, wind-down, and pro-rata redemption."
        action={refresh}
      >
        {mode === "project" && projectSection ? (
          <ProjectSectionNav active={projectSection} boardroom={boardroom.address} chainId={chainId} />
        ) : null}
      </WorkspaceHeader>
      {mode === "project" ? (
        <ProjectBody boardroom={boardroom} locker={locker} section={projectSection ?? "overview"} swap={swap} />
      ) : (
        <StudioBody
          account={account}
          boardroom={boardroom}
          canManage={canManage}
          canWrite={canWrite}
          chainId={chainId}
          form={form}
          locker={locker}
          pendingAction={pendingAction}
          section={studioSection ?? "setup"}
          setForm={setForm}
          onAction={onAction}
        />
      )}
    </>
  );
}

function ProjectBody({
  boardroom,
  locker,
  section,
  swap,
}: {
  boardroom: BoardroomState;
  locker: LiquidityLockerState | undefined;
  section: ProjectSection;
  swap: ReactNode;
}): React.JSX.Element {
  if (section === "swap") return <>{swap}</>;
  if (section === "transparency") {
    return (
      <div className="grid gap-4">
        <LifecyclePanel boardroom={boardroom} />
        <LockerFacts locker={locker} />
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      <Panel title="Project state" description="Canonical state read directly from the Boardroom and its share token.">
        <BoardroomFacts boardroom={boardroom} />
      </Panel>
      <LockerFacts locker={locker} />
    </div>
  );
}

function StudioBody({
  account,
  boardroom,
  canManage,
  canWrite,
  chainId,
  form,
  locker,
  pendingAction,
  section,
  setForm,
  onAction,
}: {
  account: Address | undefined;
  boardroom: BoardroomState;
  canManage: boolean;
  canWrite: boolean;
  chainId: number;
  form: BoardroomWorkspaceForm;
  locker: LiquidityLockerState | undefined;
  pendingAction: string | undefined;
  section: StudioSection;
  setForm: Dispatch<SetStateAction<BoardroomWorkspaceForm>>;
  onAction: (action: BoardroomAction) => Promise<void>;
}): React.JSX.Element {
  const update = <K extends keyof BoardroomWorkspaceForm>(field: K, value: BoardroomWorkspaceForm[K]): void => {
    setForm((current) => ({ ...current, [field]: value }));
  };
  return (
    <div className="grid gap-4">
      <StudioSectionNav active={section} boardroom={boardroom.address} chainId={chainId} />
      {!account ? <p className="m-0 border-l-2 border-amber-400 px-4 py-3 text-sm text-[var(--pc-text-muted)]">Connect a wallet to submit transactions.</p> : null}
      {account && !canManage ? <p className="m-0 border-l-2 border-amber-400 px-4 py-3 text-sm text-[var(--pc-text-muted)]">The connected wallet can read this workspace but only the Boardroom owner can manage it.</p> : null}
      {section === "setup" ? <SetupPanel boardroom={boardroom} locker={locker} /> : null}
      {section === "token" ? (
        <TokenPanel boardroom={boardroom} canManage={canManage} form={form} pendingAction={pendingAction} setForm={setForm} onAction={onAction} />
      ) : null}
      {section === "grants" ? (
        <GrantPanel active={boardroom.status === 0} canManage={canManage} form={form.grant} pendingAction={pendingAction} setForm={(value) => update("grant", value)} onAction={onAction} />
      ) : null}
      {section === "liquidity" ? (
        <LiquidityPanel boardroom={boardroom} canManage={canManage} canWrite={canWrite} form={form} locker={locker} pendingAction={pendingAction} setForm={setForm} onAction={onAction} />
      ) : null}
      {section === "close" ? (
        <ClosePanel boardroom={boardroom} canManage={canManage} canWrite={canWrite} form={form} locker={locker} pendingAction={pendingAction} setForm={setForm} onAction={onAction} />
      ) : null}
    </div>
  );
}

function SetupPanel({ boardroom, locker }: { boardroom: BoardroomState; locker: LiquidityLockerState | undefined }): React.JSX.Element {
  return (
    <div className="grid gap-4">
      <Panel title="Authority and custody" description="The Boardroom owner is the only administrative authority; assets stay in the Boardroom or registered escrows.">
        <BoardroomFacts boardroom={boardroom} />
      </Panel>
      <LockerFacts locker={locker} />
    </div>
  );
}

function TokenPanel({
  boardroom,
  canManage,
  form,
  pendingAction,
  setForm,
  onAction,
}: {
  boardroom: BoardroomState;
  canManage: boolean;
  form: BoardroomWorkspaceForm;
  pendingAction: string | undefined;
  setForm: Dispatch<SetStateAction<BoardroomWorkspaceForm>>;
  onAction: (action: BoardroomAction) => Promise<void>;
}): React.JSX.Element {
  return (
    <Panel title="Share token" description="Mint the intended share allocations while the Boardroom is Active. Starting wind-down permanently closes minting.">
      <Facts columns="three" items={[
        { label: "Share token", value: <AddressLink address={boardroom.shareToken} /> },
        { label: "Total supply", value: boardroom.totalShareSupply.toString() },
        { label: "Minting", value: boardroom.status === 0 ? "Open" : "Closed" },
      ]} />
      <div className="grid gap-px border-t border-[var(--pc-border)] bg-[var(--pc-border)] md:grid-cols-2">
        <TextField label="Mint recipient" value={form.mintTo} onChange={(mintTo) => setForm((current) => ({ ...current, mintTo }))} />
        <TextField label="Mint amount (raw units)" value={form.mintAmount} onChange={(mintAmount) => setForm((current) => ({ ...current, mintAmount }))} />
      </div>
      <ActionRow>
        <StudioAction action="mint" disabled={!canManage || boardroom.status !== 0} label="Mint shares" pendingAction={pendingAction} onAction={onAction}><Coins className="h-4 w-4" /></StudioAction>
      </ActionRow>
    </Panel>
  );
}

function GrantPanel({
  active,
  canManage,
  form,
  pendingAction,
  setForm,
  onAction,
}: {
  active: boolean;
  canManage: boolean;
  form: BoardroomGrantForm;
  pendingAction: string | undefined;
  setForm: (form: BoardroomGrantForm) => void;
  onAction: (action: BoardroomAction) => Promise<void>;
}): React.JSX.Element {
  const set = (field: keyof BoardroomGrantForm, value: string | boolean): void => setForm({ ...form, [field]: value });
  return (
    <Panel title="Treasury-funded grant" description="Create a grant funded with an external ERC20 held by the Boardroom. Boardroom share tokens are intentionally rejected as grant assets.">
      <div className="grid gap-px border-t border-[var(--pc-border)] bg-[var(--pc-border)] md:grid-cols-2">
        <TextField label="Grant asset" value={form.token} onChange={(value) => set("token", value)} />
        <TextField label="Holder" value={form.holder} onChange={(value) => set("holder", value)} />
        <TextField label="Payment token" value={form.paymentToken} onChange={(value) => set("paymentToken", value)} />
        <TextField label="Amount (raw units)" value={form.amount} onChange={(value) => set("amount", value)} />
        <TextField label="Price (raw units)" value={form.price} onChange={(value) => set("price", value)} />
        <TextField label="Vesting cliff" value={form.vestingCliff} onChange={(value) => set("vestingCliff", value)} />
        <TextField label="Vesting end" value={form.vestingEnd} onChange={(value) => set("vestingEnd", value)} />
        <TextField label="Expiry" value={form.expiry} onChange={(value) => set("expiry", value)} />
        <TextField label="Transfer unlock" value={form.transferUnlockTime} onChange={(value) => set("transferUnlockTime", value)} />
        <TextField label="Salt" value={form.salt} onChange={(value) => set("salt", value)} />
      </div>
      <label className="flex gap-2 border-t border-[var(--pc-border)] p-4 text-sm text-[var(--pc-text-muted)]">
        <input checked={form.transferable} type="checkbox" onChange={(event) => set("transferable", event.target.checked)} />Transferable grant right
      </label>
      <ActionRow>
        <Button disabled={pendingAction !== undefined} variant="secondary" onClick={() => set("salt", randomSalt())}>New salt</Button>
        <StudioAction action="create-grant" disabled={!canManage || !active} label="Approve and create grant" pendingAction={pendingAction} onAction={onAction}><Send className="h-4 w-4" /></StudioAction>
      </ActionRow>
    </Panel>
  );
}

function LiquidityPanel({
  boardroom,
  canManage,
  canWrite,
  form,
  locker,
  pendingAction,
  setForm,
  onAction,
}: {
  boardroom: BoardroomState;
  canManage: boolean;
  canWrite: boolean;
  form: BoardroomWorkspaceForm;
  locker: LiquidityLockerState | undefined;
  pendingAction: string | undefined;
  setForm: Dispatch<SetStateAction<BoardroomWorkspaceForm>>;
  onAction: (action: BoardroomAction) => Promise<void>;
}): React.JSX.Element {
  const setLocker = (field: keyof LiquidityLockerForm, value: string): void => setForm((current) => ({ ...current, locker: { ...current.locker, [field]: value } }));
  const setPosition = (tokenId: string): void => setForm((current) => ({ ...current, position: { tokenId } }));
  return (
    <div className="grid gap-4">
      <LockerFacts locker={locker} />
      {!locker ? (
        <Panel title="Create liquidity locker" description="Create the one canonical locker for this Boardroom before minting a PositionManager NFT directly to it.">
          <div className="grid gap-px border-t border-[var(--pc-border)] bg-[var(--pc-border)] md:grid-cols-2">
            <TextField label="Quote asset" value={form.locker.quoteAsset} onChange={(value) => setLocker("quoteAsset", value)} />
            <TextField label="Pool fee" value={form.locker.poolFee} onChange={(value) => setLocker("poolFee", value)} />
            <TextField label="Tick spacing" value={form.locker.tickSpacing} onChange={(value) => setLocker("tickSpacing", value)} />
            <TextField label="Salt" value={form.locker.salt} onChange={(value) => setLocker("salt", value)} />
          </div>
          <ActionRow>
            <Button disabled={pendingAction !== undefined} variant="secondary" onClick={() => setLocker("salt", randomSalt())}>New salt</Button>
            <StudioAction action="create-locker" disabled={!canManage || boardroom.status !== 0} label="Create locker" pendingAction={pendingAction} onAction={onAction}><Droplets className="h-4 w-4" /></StudioAction>
          </ActionRow>
        </Panel>
      ) : (
        <Panel title="Position custody" description="After a launch mints directly to this locker, register the position so its PoolKey and liquidity can be verified.">
          <div className="border-t border-[var(--pc-border)]">
            <TextField label="Position token ID" value={form.position.tokenId} onChange={setPosition} />
          </div>
          <ActionRow>
            <StudioAction action="register-position" disabled={!canManage || boardroom.status !== 0 || locker.positionRegistered} label="Register direct mint" pendingAction={pendingAction} onAction={onAction} />
            <StudioAction action="collect-fees" disabled={!canWrite || boardroom.status > 1 || !locker.positionRegistered || locker.closed} label="Collect fees" pendingAction={pendingAction} onAction={onAction} />
            <StudioAction action="cancel-locker" disabled={!canManage || locker.closed} label="Cancel empty locker" pendingAction={pendingAction} onAction={onAction} />
          </ActionRow>
        </Panel>
      )}
    </div>
  );
}

function ClosePanel({
  boardroom,
  canManage,
  canWrite,
  form,
  locker,
  pendingAction,
  setForm,
  onAction,
}: {
  boardroom: BoardroomState;
  canManage: boolean;
  canWrite: boolean;
  form: BoardroomWorkspaceForm;
  locker: LiquidityLockerState | undefined;
  pendingAction: string | undefined;
  setForm: Dispatch<SetStateAction<BoardroomWorkspaceForm>>;
  onAction: (action: BoardroomAction) => Promise<void>;
}): React.JSX.Element {
  const setWindDown = (field: keyof WindDownForm, value: string): void => setForm((current) => ({ ...current, windDown: { ...current.windDown, [field]: value } }));
  const setExit = (field: keyof LiquidityExitForm, value: string): void => setForm((current) => ({ ...current, exit: { ...current.exit, [field]: value } }));
  return (
    <div className="grid gap-4">
      <LifecyclePanel boardroom={boardroom} />
      <Panel title="Wind down and redeem" description="Close escrows, snapshot all registered assets, freeze the redemption supply, then burn shares for pro-rata claims.">
        <div className="grid gap-px border-t border-[var(--pc-border)] bg-[var(--pc-border)] md:grid-cols-2">
          <TextField label="Redemption asset" value={form.windDown.asset} onChange={(value) => setWindDown("asset", value)} />
          <TextField label="Shares to redeem" value={form.windDown.shares} onChange={(value) => setWindDown("shares", value)} />
          <TextField label="Claim recipient" value={form.windDown.recipient} onChange={(value) => setWindDown("recipient", value)} />
          <TextField label="Minimum claim amount" value={form.windDown.minAmount} onChange={(value) => setWindDown("minAmount", value)} />
          <TextField label="Snapshot page (1–32)" value={form.snapshotMaximum} onChange={(snapshotMaximum) => setForm((current) => ({ ...current, snapshotMaximum }))} />
          <TextField label="Exit amount0 minimum" value={form.exit.amount0Min} onChange={(value) => setExit("amount0Min", value)} />
          <TextField label="Exit amount1 minimum" value={form.exit.amount1Min} onChange={(value) => setExit("amount1Min", value)} />
          <TextField label="Exit deadline" value={form.exit.deadline} onChange={(value) => setExit("deadline", value)} />
        </div>
        <ActionRow>
          <StudioAction action="register-asset" disabled={!canManage || boardroom.status > 1} label="Register asset" pendingAction={pendingAction} onAction={onAction} />
          <StudioAction action="start-wind-down" disabled={!canManage || boardroom.status !== 0} label="Start wind-down" pendingAction={pendingAction} onAction={onAction}><ArchiveRestore className="h-4 w-4" /></StudioAction>
          <StudioAction action="exit-locker" disabled={!canManage || boardroom.status !== 1 || !locker || locker.closed} label="Exit liquidity" pendingAction={pendingAction} onAction={onAction} />
          <StudioAction action="begin-snapshot" disabled={!canWrite || boardroom.status !== 1 || boardroom.openEscrowCount !== 0n} label="Begin snapshot" pendingAction={pendingAction} onAction={onAction} />
          <StudioAction action="snapshot-assets" disabled={!canWrite || boardroom.status !== 2 || boardroom.snapshotCursor >= boardroom.snapshotAssetCount} label="Snapshot assets" pendingAction={pendingAction} onAction={onAction} />
          <StudioAction action="wrap-native" disabled={!canWrite || boardroom.status !== 2} label="Wrap native" pendingAction={pendingAction} onAction={onAction} />
          <StudioAction action="open-redemptions" disabled={!canWrite || boardroom.status !== 2 || boardroom.snapshotCursor !== boardroom.snapshotAssetCount} label="Open redemptions" pendingAction={pendingAction} onAction={onAction} />
          <StudioAction action="redeem" disabled={!canWrite || boardroom.status !== 3} label="Redeem shares" pendingAction={pendingAction} onAction={onAction} />
          <StudioAction action="claim-asset" disabled={!canWrite || boardroom.status !== 3} label="Claim asset" pendingAction={pendingAction} onAction={onAction} />
        </ActionRow>
      </Panel>
    </div>
  );
}

function LifecyclePanel({ boardroom }: { boardroom: BoardroomState }): React.JSX.Element {
  return (
    <Panel title="Lifecycle" description="The onchain state machine, snapshot progress, and open escrows.">
      <Facts columns="three" items={[
        { label: "Status", value: statusLabel(boardroom.status) },
        { label: "Open escrows", value: boardroom.openEscrowCount.toString() },
        { label: "Snapshot", value: `${boardroom.snapshotCursor.toString()} / ${boardroom.snapshotAssetCount.toString()}` },
        { label: "Snapshot frozen", value: boardroom.snapshotFrozen ? "Yes" : "No" },
        { label: "Redemption supply", value: boardroom.redemptionSupply.toString() },
        { label: "Redemption supply frozen", value: boardroom.redemptionSupplyFrozen ? "Yes" : "No" },
      ]} />
    </Panel>
  );
}

function LockerFacts({ locker }: { locker: LiquidityLockerState | undefined }): React.JSX.Element {
  return (
    <Panel title="Locked Uniswap v4 position" description="A plain PositionManager NFT; the locker holder can collect fees while principal stays locked until wind-down.">
      {locker ? (
        <Facts columns="three" items={[
          { label: "Locker", value: <AddressLink address={locker.address} /> },
          { label: "Quote asset", value: <AddressLink address={locker.quoteAsset} /> },
          { label: "PositionManager", value: <AddressLink address={locker.positionManager} /> },
          { label: "Position token ID", value: locker.positionRegistered ? locker.tokenId.toString() : "Not registered" },
          { label: "Position liquidity", value: bigintString(locker.positionLiquidity) },
          { label: "State", value: locker.closed ? <Badge variant="warning">Closed</Badge> : <Badge>Locked</Badge> },
        ]} />
      ) : <p className="m-0 border-t border-[var(--pc-border)] p-4 text-sm text-[var(--pc-text-muted)]">No canonical locker has been created for this Boardroom.</p>}
    </Panel>
  );
}

function BoardroomFacts({ boardroom }: { boardroom: BoardroomState }): React.JSX.Element {
  return (
    <Facts columns="three" items={[
      { label: "Boardroom", value: <AddressLink address={boardroom.address} /> },
      { label: "Owner", value: <AddressLink address={boardroom.owner} /> },
      { label: "Share token", value: <AddressLink address={boardroom.shareToken} /> },
      { label: "Status", value: statusLabel(boardroom.status) },
      { label: "Total share supply", value: boardroom.totalShareSupply.toString() },
      { label: "Treasury shares", value: boardroom.treasuryShareBalance.toString() },
      { label: "Redeemable assets", value: boardroom.redeemableAssetCount.toString() },
      { label: "Read block", value: boardroom.blockNumber.toString() },
    ]} />
  );
}

function StudioAction({
  action,
  children,
  disabled,
  label,
  pendingAction,
  onAction,
}: {
  action: BoardroomAction;
  children?: ReactNode;
  disabled: boolean;
  label: string;
  pendingAction: string | undefined;
  onAction: (action: BoardroomAction) => Promise<void>;
}): React.JSX.Element {
  return (
    <ActionButton actionId={action} disabled={disabled} pendingAction={pendingAction} variant="secondary" onClick={() => void onAction(action)}>
      {children}{label}
    </ActionButton>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): React.JSX.Element {
  return <Field label={label}><Input spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} /></Field>;
}

function statusLabel(status: BoardroomState["status"]): string {
  return ["Active", "Winding down", "Snapshotting", "Redemptions open"][status] ?? `Unknown (${status.toString()})`;
}
