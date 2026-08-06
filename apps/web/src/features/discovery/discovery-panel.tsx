import type {
  Address,
  DiscoveredBoardroom,
  DiscoveredGrant,
  DiscoveredLiquidityLocker,
  PledgeCashDeployment,
} from "@pledge.cash/sdk";
import { AlertTriangle, Database, FolderSearch, RefreshCw, RotateCcw, Search, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { ActionButton, ActionRow, AddressLink, Facts, Field, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { bigintString } from "../../lib/forms";
import type { DiscoveryForm, DiscoverySnapshot } from "../../lib/types";

type DiscoveryPanelProps = {
  account: Address | undefined;
  deployment: PledgeCashDeployment | undefined;
  discovery: DiscoverySnapshot;
  discoveryForm: DiscoveryForm;
  pendingAction: string | undefined;
  setDiscoveryForm: Dispatch<SetStateAction<DiscoveryForm>>;
  clearDiscovery: () => void;
  inspectGrant: (grant: Address) => void;
  scanDiscovery: () => Promise<void>;
  resumeDiscovery: () => Promise<void>;
  useBoardroom: (boardroom: Address) => void;
  useLocker: (locker: DiscoveredLiquidityLocker) => void;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
};

type WalletAccessPanelProps = Omit<DiscoveryPanelProps, "setDiscoveryForm" | "clearDiscovery" | "resumeDiscovery">;

type DiscoveryView = {
  boardrooms: DiscoveredBoardroom[];
  grants: DiscoveredGrant[];
  lockers: DiscoveredLiquidityLocker[];
  loadedForCurrentAccount: boolean;
};

const SCAN_ACTION = "scan-discovery";

export function WalletAccessPanel({
  account,
  deployment,
  discovery,
  discoveryForm,
  pendingAction,
  inspectGrant,
  scanDiscovery,
  useBoardroom,
  useLocker,
  runAction,
}: WalletAccessPanelProps): React.JSX.Element {
  const view = discoveryView(account, discovery, discoveryForm.includeClosedGrants);
  const total = view.boardrooms.length + view.grants.length + view.lockers.length;

  return (
    <div className="grid gap-4">
      <Panel
        title="Wallet access"
        description="Discover Boardrooms, grants, and locked launch positions from canonical factory logs."
        action={
          <ActionButton actionId={SCAN_ACTION} disabled={!account || !deployment} pendingAction={pendingAction} variant="secondary" onClick={() => void runAction(SCAN_ACTION, scanDiscovery)}>
            <RefreshCw className="h-4 w-4" />Refresh access
          </ActionButton>
        }
      >
        <Facts columns="three" items={[
          { label: "Wallet", value: account ? <AddressLink address={account} /> : "Connect wallet" },
          { label: "Status", value: view.loadedForCurrentAccount ? <Badge>Loaded</Badge> : <Badge variant="muted">Not synced</Badge> },
          { label: "Last scanned block", value: bigintString(discovery.lastScannedBlock) },
          { label: "Managed Boardrooms", value: view.boardrooms.length.toString() },
          { label: "Relevant grants", value: view.grants.length.toString() },
          { label: "Liquidity lockers", value: view.lockers.length.toString() },
        ]} />
        {!account ? <Notice icon={<FolderSearch />} text="Connect a wallet to scope discovery." /> : null}
        {view.loadedForCurrentAccount && total === 0 ? <Notice icon={<Database />} text="No canonical records were found for this wallet in the scanned range." /> : null}
        {discovery.errors.length > 0 ? <Notice icon={<AlertTriangle />} text={discovery.errors.join(" ")} warning /> : null}
      </Panel>
      {view.loadedForCurrentAccount ? (
        <DiscoveryResults
          boardrooms={view.boardrooms}
          grants={view.grants}
          lockers={view.lockers}
          inspectGrant={inspectGrant}
          useBoardroom={useBoardroom}
          useLocker={useLocker}
        />
      ) : null}
    </div>
  );
}

export function DiscoveryPanel({
  account,
  deployment,
  discovery,
  discoveryForm,
  pendingAction,
  setDiscoveryForm,
  clearDiscovery,
  inspectGrant,
  scanDiscovery,
  resumeDiscovery,
  useBoardroom,
  useLocker,
  runAction,
}: DiscoveryPanelProps): React.JSX.Element {
  const view = discoveryView(account, discovery, discoveryForm.includeClosedGrants);
  const canResume = discovery.complete && discovery.lastScannedBlock !== undefined;
  return (
    <div className="grid gap-4">
      <Panel
        title="Discovery diagnostics"
        description="Bounded manual range controls for factory-log troubleshooting."
        action={
          <ActionButton actionId={SCAN_ACTION} disabled={!account || !deployment} pendingAction={pendingAction} onClick={() => void runAction(SCAN_ACTION, scanDiscovery)}>
            <Search className="h-4 w-4" />Scan
          </ActionButton>
        }
      >
        <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 md:grid-cols-3">
          <DiscoveryInput field="fromBlock" label="From block" form={discoveryForm} setForm={setDiscoveryForm} />
          <DiscoveryInput field="toBlock" label="To block" form={discoveryForm} setForm={setDiscoveryForm} />
          <DiscoveryInput field="chunkSize" label="Chunk size" form={discoveryForm} setForm={setDiscoveryForm} />
        </div>
        <ActionRow>
          <Button disabled={!canResume || pendingAction !== undefined} variant="secondary" onClick={() => void runAction("resume-discovery", resumeDiscovery)}><RotateCcw className="h-4 w-4" />Resume</Button>
          <Button disabled={pendingAction !== undefined} variant="danger" onClick={clearDiscovery}><Trash2 className="h-4 w-4" />Clear cache</Button>
        </ActionRow>
        <Facts columns="three" items={[
          { label: "Range", value: `${bigintString(discovery.fromBlock)} → ${discovery.toBlock === "latest" ? "latest" : bigintString(discovery.toBlock)}` },
          { label: "Complete", value: discovery.complete ? "Yes" : "No" },
          { label: "Errors", value: discovery.errors.length.toString() },
        ]} />
      </Panel>
      <DiscoveryResults
        boardrooms={view.boardrooms}
        grants={view.grants}
        lockers={view.lockers}
        inspectGrant={inspectGrant}
        useBoardroom={useBoardroom}
        useLocker={useLocker}
      />
    </div>
  );
}

function DiscoveryResults({
  boardrooms,
  grants,
  lockers,
  inspectGrant,
  useBoardroom,
  useLocker,
}: {
  boardrooms: DiscoveredBoardroom[];
  grants: DiscoveredGrant[];
  lockers: DiscoveredLiquidityLocker[];
  inspectGrant: (grant: Address) => void;
  useBoardroom: (boardroom: Address) => void;
  useLocker: (locker: DiscoveredLiquidityLocker) => void;
}): React.JSX.Element {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ResultList title="Boardrooms" empty="No Boardrooms found">
        {boardrooms.map((item) => <ResultRow key={item.boardroom} title={`${item.name} (${item.symbol})`} address={item.boardroom} detail={`Owner ${shortAddress(item.owner)}`} action="Open" onAction={() => useBoardroom(item.boardroom)} />)}
      </ResultList>
      <ResultList title="Grants" empty="No grants found">
        {grants.map((item) => <ResultRow key={item.grantAddress} title={item.closed ? "Closed grant" : "Active grant"} address={item.grantAddress} detail={`Holder ${shortAddress(item.currentHolder)}`} action="Inspect" onAction={() => inspectGrant(item.grantAddress)} />)}
      </ResultList>
      <ResultList title="Liquidity lockers" empty="No lockers found">
        {lockers.map((item) => <ResultRow key={item.locker} title={`Fee ${item.poolFee.toString()} · spacing ${item.tickSpacing.toString()}`} address={item.locker} detail={`Boardroom ${shortAddress(item.boardroom)}`} action="Open" onAction={() => useLocker(item)} />)}
      </ResultList>
    </div>
  );
}

function ResultList({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }): React.JSX.Element {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <Panel title={title}><div className="grid gap-px border-t border-zinc-800 bg-zinc-800">{hasChildren ? children : <p className="m-0 bg-zinc-950 p-4 text-sm text-zinc-500">{empty}</p>}</div></Panel>;
}

function ResultRow({ title, address, detail, action, onAction }: { title: string; address: Address; detail: string; action: string; onAction: () => void }): React.JSX.Element {
  return (
    <div className="grid gap-3 bg-zinc-950 p-4">
      <div><p className="m-0 text-sm font-semibold text-zinc-100">{title}</p><p className="m-0 mt-1 text-xs text-zinc-500">{detail}</p><div className="mt-2"><AddressLink address={address} /></div></div>
      <Button size="sm" variant="secondary" onClick={onAction}>{action}</Button>
    </div>
  );
}

function DiscoveryInput({ field, label, form, setForm }: { field: "fromBlock" | "toBlock" | "chunkSize"; label: string; form: DiscoveryForm; setForm: Dispatch<SetStateAction<DiscoveryForm>> }): React.JSX.Element {
  return <Field label={label}><Input inputMode="numeric" value={form[field]} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} /></Field>;
}

function Notice({ icon, text, warning = false }: { icon: React.ReactNode; text: string; warning?: boolean }): React.JSX.Element {
  return <div className={`flex items-start gap-3 border-t border-zinc-800 p-4 text-sm ${warning ? "text-amber-200" : "text-zinc-500"}`}><span className="mt-0.5 h-4 w-4 shrink-0">{icon}</span><p className="m-0">{text}</p></div>;
}

function discoveryView(account: Address | undefined, discovery: DiscoverySnapshot, includeClosed: boolean): DiscoveryView {
  const loadedForCurrentAccount = Boolean(account && discovery.loadedFor?.toLowerCase() === account.toLowerCase());
  if (!loadedForCurrentAccount || !account) return { boardrooms: [], grants: [], lockers: [], loadedForCurrentAccount: false };
  const boardrooms = Object.values(discovery.boardroomsByAddress).filter((item) => sameAddress(item.owner, account));
  const managed = new Set(boardrooms.map((item) => item.boardroom.toLowerCase()));
  const grants = Object.values(discovery.grantsByAddress).filter((item) =>
    (includeClosed || !item.closed)
      && (sameAddress(item.currentHolder, account) || sameAddress(item.issuer, account) || sameAddress(item.initialHolder, account)),
  );
  const lockers = Object.values(discovery.lockersByAddress).filter((item) => managed.has(item.boardroom.toLowerCase()));
  return { boardrooms, grants, lockers, loadedForCurrentAccount };
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function shortAddress(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
