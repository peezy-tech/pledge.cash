import type {
  Address,
  DiscoveredBoardroom,
  DiscoveredDistribution,
  DiscoveredGrant,
  DiscoveredLockedLiquidity,
  DiscoveredPool,
  PledgeCashDeployment,
} from "@pledge.cash/sdk";
import { AlertTriangle, CheckCircle2, Database, FolderSearch, KeyRound, RefreshCw, RotateCcw, Search, ShieldCheck, Trash2 } from "lucide-react";
import type React from "react";
import type { Dispatch, SetStateAction } from "react";
import { ActionButton, ActionRow, AddressLink, Facts, Field, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { bigintString, dateString } from "../../lib/forms";
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
  useDistribution: (distribution: DiscoveredDistribution) => void;
  useLockedLiquidity: (locker: DiscoveredLockedLiquidity) => void;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
};

type WalletAccessPanelProps = Pick<
  DiscoveryPanelProps,
  | "account"
  | "deployment"
  | "discovery"
  | "discoveryForm"
  | "pendingAction"
  | "inspectGrant"
  | "scanDiscovery"
  | "useBoardroom"
  | "useDistribution"
  | "useLockedLiquidity"
  | "runAction"
>;

type DiscoveryView = {
  boardrooms: DiscoveredBoardroom[];
  distributions: DiscoveredDistribution[];
  grants: DiscoveredGrant[];
  heldGrants: DiscoveredGrant[];
  issuedGrants: DiscoveredGrant[];
  loadedForCurrentAccount: boolean;
  lockers: DiscoveredLockedLiquidity[];
  originalHolderGrants: DiscoveredGrant[];
  pools: DiscoveredPool[];
  status: {
    description: string;
    label: string;
    tone: "default" | "muted" | "warning";
  };
  totalLinkedItems: number;
};

export function WalletAccessPanel({
  account,
  deployment,
  discovery,
  discoveryForm,
  pendingAction,
  inspectGrant,
  scanDiscovery,
  useBoardroom,
  useDistribution,
  useLockedLiquidity,
  runAction,
}: WalletAccessPanelProps): React.JSX.Element {
  const view = discoveryView(account, deployment, discovery, discoveryForm.includeClosedGrants, pendingAction);

  return (
    <div className="grid gap-4">
      <Panel
        title="Your Access"
        description="Wallet-linked Boardrooms, grants, treasury actions, and liquidity refresh in the background when you connect."
        action={
          <ActionButton
            actionId="scan-discovery"
            disabled={!account || !deployment}
            pendingAction={pendingAction}
            variant="secondary"
            onClick={() => void runAction("scan-discovery", scanDiscovery)}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh access
          </ActionButton>
        }
      >
        <Facts
          columns="three"
          items={[
            { label: "Wallet", value: account ? <AddressLink address={account} /> : "Connect wallet" },
            { label: "Status", value: <Badge variant={view.status.tone}>{view.status.label}</Badge> },
            { label: "Last updated", value: view.loadedForCurrentAccount ? `Block ${bigintString(discovery.lastScannedBlock)}` : "Not synced" },
            { label: "Boardrooms you manage", value: view.boardrooms.length.toString() },
            { label: "Grants you can act on", value: view.heldGrants.length.toString() },
            { label: "Treasury actions", value: `${view.distributions.length} distributions / ${view.lockers.length} lockers` },
          ]}
        />
        <AccessNotice
          account={account}
          errors={view.loadedForCurrentAccount ? discovery.errors : []}
          statusDescription={view.status.description}
          totalLinkedItems={view.totalLinkedItems}
        />
      </Panel>

      {view.loadedForCurrentAccount && view.totalLinkedItems > 0 ? (
        <>
          <BoardroomList
            actionLabel="Manage"
            boardrooms={view.boardrooms}
            emptyLabel="No Boardrooms are managed by this wallet."
            title="Boardrooms you manage"
            useBoardroom={useBoardroom}
          />
          <GrantDiscoveryLists
            actionLabel="Open grant"
            heldGrants={view.heldGrants}
            inspectGrant={inspectGrant}
            issuedGrants={view.issuedGrants}
            originalHolderGrants={view.originalHolderGrants}
            title="Grants for this wallet"
          />
          <ObligationDiscoveryList
            distributions={view.distributions}
            lockerActionLabel="Open locker"
            lockers={view.lockers}
            title="Treasury actions you can manage"
            useDistribution={useDistribution}
            useLockedLiquidity={useLockedLiquidity}
            distributionActionLabel="Open distribution"
          />
          <PoolDiscoveryList
            actionLabel="Open locker"
            lockers={view.lockers}
            pools={view.pools}
            title="Liquidity linked to your Boardrooms"
            useLockedLiquidity={useLockedLiquidity}
          />
        </>
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
  useDistribution,
  useLockedLiquidity,
  runAction,
}: DiscoveryPanelProps): React.JSX.Element {
  const view = discoveryView(account, deployment, discovery, discoveryForm.includeClosedGrants, pendingAction);

  return (
    <div className="grid gap-4">
      <Panel
        title="Discovery Diagnostics"
        description="Manual log range controls for troubleshooting wallet sync. Normal wallet access refreshes automatically."
        action={
          <ActionButton
            actionId="scan-discovery"
            disabled={!account || !deployment}
            pendingAction={pendingAction}
            onClick={() => void runAction("scan-discovery", scanDiscovery)}
          >
            <Search className="h-4 w-4" />
            Scan
          </ActionButton>
        }
      >
        <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2 xl:grid-cols-4">
          <TextField form={discoveryForm} field="fromBlock" inputMode="numeric" label="From block" setForm={setDiscoveryForm} />
          <TextField form={discoveryForm} field="toBlock" inputMode="numeric" label="To block" setForm={setDiscoveryForm} />
          <TextField form={discoveryForm} field="chunkSize" inputMode="numeric" label="Chunk size" setForm={setDiscoveryForm} />
          <Field label="Include closed grants">
            <label className="flex h-10 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200">
              <input
                checked={discoveryForm.includeClosedGrants}
                className="h-4 w-4 accent-lime-300"
                type="checkbox"
                onChange={(event) => setDiscoveryForm((current) => ({ ...current, includeClosedGrants: event.target.checked }))}
              />
              Enabled
            </label>
          </Field>
        </div>
        <ActionRow>
          <ActionButton
            actionId="resume-discovery"
            disabled={!account || !discovery.lastScannedBlock}
            pendingAction={pendingAction}
            variant="secondary"
            onClick={() => void runAction("resume-discovery", resumeDiscovery)}
          >
            <RotateCcw className="h-4 w-4" />
            Resume
          </ActionButton>
          <Button variant="secondary" onClick={clearDiscovery}>
            <Trash2 className="h-4 w-4" />
            Clear Cache
          </Button>
        </ActionRow>
        <Facts
          columns="three"
          items={[
            { label: "Wallet", value: account ? <AddressLink address={account} /> : "Connect wallet" },
            { label: "Loaded range", value: view.loadedForCurrentAccount ? `${bigintString(discovery.fromBlock)} -> ${toBlockText(discovery.toBlock)}` : "None" },
            { label: "Last scanned block", value: bigintString(discovery.lastScannedBlock) },
            { label: "Status", value: <StatusBadge complete={view.loadedForCurrentAccount ? discovery.complete : true} errors={view.loadedForCurrentAccount ? discovery.errors.length : 0} /> },
            { label: "Boardrooms", value: String(view.boardrooms.length) },
            { label: "Cached objects", value: `${view.grants.length} grants / ${view.distributions.length} distributions / ${view.lockers.length} lockers / ${view.pools.length} pools` },
          ]}
        />
        {view.loadedForCurrentAccount && discovery.errors.length > 0 ? (
          <ol className="grid gap-px border-t border-zinc-800 bg-zinc-800">
            {discovery.errors.map((error) => (
              <li className="bg-zinc-950 p-4 text-sm text-red-200" key={error}>{error}</li>
            ))}
          </ol>
        ) : null}
      </Panel>

      <BoardroomList boardrooms={view.boardrooms} useBoardroom={useBoardroom} />
      <GrantDiscoveryLists
        heldGrants={view.heldGrants}
        inspectGrant={inspectGrant}
        issuedGrants={view.issuedGrants}
        originalHolderGrants={view.originalHolderGrants}
      />
      <ObligationDiscoveryList distributions={view.distributions} lockers={view.lockers} useDistribution={useDistribution} useLockedLiquidity={useLockedLiquidity} />
      <PoolDiscoveryList lockers={view.lockers} pools={view.pools} useLockedLiquidity={useLockedLiquidity} />
    </div>
  );
}

function BoardroomList({
  actionLabel = "Use Boardroom",
  boardrooms,
  emptyLabel = "No boardrooms",
  title = "My Boardrooms",
  useBoardroom,
}: {
  actionLabel?: string;
  boardrooms: DiscoveredBoardroom[];
  emptyLabel?: string;
  title?: string;
  useBoardroom: (boardroom: Address) => void;
}): React.JSX.Element {
  return (
    <Panel title={title}>
      {boardrooms.length === 0 ? (
        <EmptyList label={emptyLabel} />
      ) : (
        <ol className="grid gap-px border-t border-zinc-800 bg-zinc-800">
          {boardrooms.map((boardroom) => (
            <li className="min-w-0 bg-zinc-950 p-4" key={boardroom.boardroom}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-100">{boardroom.name || "Unnamed Boardroom"}</div>
                  <AddressLink address={boardroom.boardroom} />
                </div>
                <Button size="sm" variant="secondary" onClick={() => useBoardroom(boardroom.boardroom)}>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {actionLabel}
                </Button>
              </div>
              <Facts
                columns="three"
                items={[
                  { label: "Owner", value: <AddressLink address={boardroom.owner} /> },
                  { label: "Share token", value: <AddressLink address={boardroom.shareToken} /> },
                  { label: "Created block", value: boardroom.createdAtBlock.toString() },
                  { label: "Symbol", value: boardroom.symbol || "Unknown" },
                  { label: "Policy registry", value: <AddressLink address={boardroom.policyRegistry} /> },
                  { label: "Transaction", value: boardroom.transactionHash },
                ]}
              />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function GrantDiscoveryLists({
  actionLabel = "Inspect",
  heldGrants,
  inspectGrant,
  issuedGrants,
  originalHolderGrants,
  title = "My Grants",
}: {
  actionLabel?: string;
  heldGrants: DiscoveredGrant[];
  inspectGrant: (grant: Address) => void;
  issuedGrants: DiscoveredGrant[];
  originalHolderGrants: DiscoveredGrant[];
  title?: string;
}): React.JSX.Element {
  return (
    <Panel title={title}>
      <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 xl:grid-cols-3">
        <GrantColumn actionLabel={actionLabel} grants={heldGrants} inspectGrant={inspectGrant} title="Can settle" />
        <GrantColumn actionLabel={actionLabel} grants={issuedGrants} inspectGrant={inspectGrant} title="Issued by this wallet" />
        <GrantColumn actionLabel={actionLabel} grants={originalHolderGrants} inspectGrant={inspectGrant} title="Original holder" />
      </div>
    </Panel>
  );
}

function GrantColumn({
  actionLabel,
  grants,
  inspectGrant,
  title,
}: {
  actionLabel: string;
  grants: DiscoveredGrant[];
  inspectGrant: (grant: Address) => void;
  title: string;
}): React.JSX.Element {
  return (
    <section className="min-w-0 bg-zinc-950">
      <h3 className="m-0 border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">{title}</h3>
      {grants.length === 0 ? (
        <p className="m-0 p-4 text-sm text-zinc-500">No grants</p>
      ) : (
        <ol className="grid gap-px bg-zinc-800">
          {grants.map((grant) => (
            <li className="grid gap-3 bg-zinc-950 p-4" key={`${grant.grantAddress}-${grant.tokenId.toString()}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <AddressLink address={grant.grantAddress} />
                <Badge variant={grant.closed ? "warning" : "default"}>{grant.closed ? "Closed" : "Open"}</Badge>
              </div>
              <Facts
                columns="one"
                items={[
                  { label: "Issuer", value: <AddressLink address={grant.issuer} /> },
                  { label: "Holder", value: <AddressLink address={grant.closed && grant.lastHolder ? grant.lastHolder : grant.currentHolder} /> },
                  { label: "Amount", value: grant.amount.toString() },
                  { label: "Expiry", value: dateString(grant.expiry) },
                ]}
              />
              <Button size="sm" variant="secondary" onClick={() => inspectGrant(grant.grantAddress)}>
                <KeyRound className="h-3.5 w-3.5" />
                {actionLabel}
              </Button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ObligationDiscoveryList({
  distributions,
  distributionActionLabel = "Use Distribution",
  lockerActionLabel = "Use Locker",
  lockers,
  title = "Boardroom Obligations",
  useDistribution,
  useLockedLiquidity,
}: {
  distributions: DiscoveredDistribution[];
  distributionActionLabel?: string;
  lockerActionLabel?: string;
  lockers: DiscoveredLockedLiquidity[];
  title?: string;
  useDistribution: (distribution: DiscoveredDistribution) => void;
  useLockedLiquidity: (locker: DiscoveredLockedLiquidity) => void;
}): React.JSX.Element {
  return (
    <Panel title={title}>
      {distributions.length === 0 && lockers.length === 0 ? (
        <EmptyList label="No obligations" />
      ) : (
        <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 xl:grid-cols-2">
          <section className="min-w-0 bg-zinc-950">
            <h3 className="m-0 border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">Distributions</h3>
            {distributions.length === 0 ? <p className="m-0 p-4 text-sm text-zinc-500">No distributions</p> : null}
            <ol className="grid gap-px bg-zinc-800">
              {distributions.map((distribution) => (
                <li className="grid gap-3 bg-zinc-950 p-4" key={distribution.distribution}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <AddressLink address={distribution.distribution} />
                    <Badge variant="muted">{distribution.kind}</Badge>
                  </div>
                  <Facts
                    columns="one"
                    items={[
                      { label: "Boardroom", value: <AddressLink address={distribution.boardroom} /> },
                      { label: "Payment token", value: <AddressLink address={distribution.paymentToken} /> },
                      { label: "Share amount", value: distribution.shareAmount.toString() },
                    ]}
                  />
                  <Button size="sm" variant="secondary" onClick={() => useDistribution(distribution)}>
                    <Database className="h-3.5 w-3.5" />
                    {distributionActionLabel}
                  </Button>
                </li>
              ))}
            </ol>
          </section>
          <section className="min-w-0 bg-zinc-950">
            <h3 className="m-0 border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">Locked Liquidity</h3>
            {lockers.length === 0 ? <p className="m-0 p-4 text-sm text-zinc-500">No lockers</p> : null}
            <ol className="grid gap-px bg-zinc-800">
              {lockers.map((locker) => (
                <li className="grid gap-3 bg-zinc-950 p-4" key={locker.locker}>
                  <AddressLink address={locker.locker} />
                  <Facts
                    columns="one"
                    items={[
                      { label: "Boardroom", value: <AddressLink address={locker.boardroom} /> },
                      { label: "Pool", value: <AddressLink address={locker.pool} /> },
                      { label: "Liquidity", value: locker.liquidity.toString() },
                    ]}
                  />
                  <Button size="sm" variant="secondary" onClick={() => useLockedLiquidity(locker)}>
                    <Database className="h-3.5 w-3.5" />
                    {lockerActionLabel}
                  </Button>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Panel>
  );
}

function PoolDiscoveryList({
  actionLabel = "Use Locker",
  lockers,
  pools,
  title = "Pools And Liquidity",
  useLockedLiquidity,
}: {
  actionLabel?: string;
  lockers: DiscoveredLockedLiquidity[];
  pools: DiscoveredPool[];
  title?: string;
  useLockedLiquidity: (locker: DiscoveredLockedLiquidity) => void;
}): React.JSX.Element {
  return (
    <Panel title={title}>
      {pools.length === 0 && lockers.length === 0 ? (
        <EmptyList label="No pools" />
      ) : (
        <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 xl:grid-cols-2">
          {pools.map((pool) => (
            <div className="grid gap-3 bg-zinc-950 p-4" key={pool.pool}>
              <AddressLink address={pool.pool} />
              <Facts
                columns="one"
                items={[
                  { label: "Token 0", value: <AddressLink address={pool.token0} /> },
                  { label: "Token 1", value: <AddressLink address={pool.token1} /> },
                  { label: "Created block", value: pool.createdAtBlock.toString() },
                ]}
              />
            </div>
          ))}
          {lockers.map((locker) => (
            <div className="grid gap-3 bg-zinc-950 p-4" key={`${locker.locker}-pool`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <AddressLink address={locker.pool} />
                <Badge variant="default">Locked LP</Badge>
              </div>
              <Facts
                columns="one"
                items={[
                  { label: "Locker", value: <AddressLink address={locker.locker} /> },
                  { label: "Pair", value: `${locker.tokenA} / ${locker.tokenB}` },
                  { label: "Liquidity", value: locker.liquidity.toString() },
                ]}
              />
              <Button size="sm" variant="secondary" onClick={() => useLockedLiquidity(locker)}>
                <Database className="h-3.5 w-3.5" />
                {actionLabel}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function EmptyList({ label }: { label: string }): React.JSX.Element {
  return <div className="border-t border-zinc-800 p-4 text-sm text-zinc-500">{label}</div>;
}

function AccessNotice({
  account,
  errors,
  statusDescription,
  totalLinkedItems,
}: {
  account: Address | undefined;
  errors: string[];
  statusDescription: string;
  totalLinkedItems: number;
}): React.JSX.Element {
  if (errors.length > 0) {
    return (
      <div className="grid gap-2 border-t border-zinc-800 p-4">
        <div className="flex items-start gap-2 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{statusDescription}</span>
        </div>
        <ol className="grid gap-1">
          {errors.map((error) => (
            <li className="text-sm text-red-200" key={error}>{error}</li>
          ))}
        </ol>
      </div>
    );
  }

  if (!account || totalLinkedItems === 0) {
    return (
      <div className="flex items-start gap-2 border-t border-zinc-800 p-4 text-sm text-zinc-400">
        <FolderSearch className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
        <span>{statusDescription}</span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 border-t border-zinc-800 p-4 text-sm text-zinc-400">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-lime-300" />
      <span>{statusDescription}</span>
    </div>
  );
}

function StatusBadge({ complete, errors }: { complete: boolean; errors: number }): React.JSX.Element {
  if (!complete || errors > 0) return <Badge variant="warning">Partial</Badge>;
  return <Badge variant="default">Complete</Badge>;
}

function discoveryView(
  account: Address | undefined,
  deployment: PledgeCashDeployment | undefined,
  discovery: DiscoverySnapshot,
  includeClosedGrants: boolean,
  pendingAction: string | undefined,
): DiscoveryView {
  const loading = pendingAction === "scan-discovery" || pendingAction === "resume-discovery";
  const loadedForCurrentAccount = Boolean(
    account
      && discovery.loadedFor
      && discovery.loadedFor.toLowerCase() === account.toLowerCase()
      && discovery.chainId === deployment?.chainId,
  );
  const boardrooms = loadedForCurrentAccount ? Object.values(discovery.boardroomsByAddress) : [];
  const grants = loadedForCurrentAccount ? Object.values(discovery.grantsByAddress) : [];
  const distributions = loadedForCurrentAccount ? Object.values(discovery.distributionsByAddress) : [];
  const lockers = loadedForCurrentAccount ? Object.values(discovery.lockersByAddress) : [];
  const pools = loadedForCurrentAccount ? Object.values(discovery.poolsByAddress) : [];
  const heldGrants = account ? grants.filter((grant) => grantHeldBy(grant, account, includeClosedGrants)) : [];
  const issuedGrants = account ? grants.filter((grant) => grantIssuedBy(grant, account, includeClosedGrants)) : [];
  const originalHolderGrants = account ? grants.filter((grant) => grantOriginalHolder(grant, account, includeClosedGrants)) : [];
  const totalLinkedItems = boardrooms.length + heldGrants.length + issuedGrants.length + originalHolderGrants.length + distributions.length + lockers.length + pools.length;

  return {
    boardrooms,
    distributions,
    grants,
    heldGrants,
    issuedGrants,
    loadedForCurrentAccount,
    lockers,
    originalHolderGrants,
    pools,
    status: discoveryStatus(account, deployment, discovery, loadedForCurrentAccount, loading, totalLinkedItems),
    totalLinkedItems,
  };
}

function discoveryStatus(
  account: Address | undefined,
  deployment: PledgeCashDeployment | undefined,
  discovery: DiscoverySnapshot,
  loadedForCurrentAccount: boolean,
  loading: boolean,
  totalLinkedItems: number,
): DiscoveryView["status"] {
  if (!account) {
    return {
      label: "Connect wallet",
      tone: "muted",
      description: "Connect a wallet to see the grants, Boardrooms, treasury actions, and liquidity tied to it.",
    };
  }
  if (!deployment) {
    return {
      label: "Waiting for network",
      tone: "muted",
      description: "The app is loading this network before it can read wallet-linked protocol activity.",
    };
  }
  if (loading) {
    return {
      label: "Checking access",
      tone: "muted",
      description: "Looking up protocol activity for this wallet. You can keep using the app while this updates.",
    };
  }
  if (!loadedForCurrentAccount) {
    return {
      label: "Syncing soon",
      tone: "muted",
      description: "Wallet activity will refresh automatically. Use Refresh access if you want to retry now.",
    };
  }
  if (isLimitedDiscoveryRange(discovery)) {
    return {
      label: "Limited range",
      tone: "warning",
      description: "Tools loaded a limited block range for this wallet. Refresh access to sync the full wallet history.",
    };
  }
  if (discovery.errors.length > 0 || !discovery.complete) {
    return {
      label: "Needs attention",
      tone: "warning",
      description: "Some wallet activity was loaded, but the scan did not finish cleanly. Details are available in Tools.",
    };
  }
  if (totalLinkedItems === 0) {
    return {
      label: "Nothing linked",
      tone: "muted",
      description: "No grants, Boardrooms, treasury actions, or liquidity were found for this wallet on the active network.",
    };
  }
  return {
    label: "Ready",
    tone: "default",
    description: "Wallet-linked access is up to date for the active network.",
  };
}

function isLimitedDiscoveryRange(discovery: DiscoverySnapshot): boolean {
  return Boolean((discovery.fromBlock !== undefined && discovery.fromBlock > 0n) || (discovery.toBlock !== undefined && discovery.toBlock !== "latest"));
}

function TextField<T extends object, K extends keyof T & string>({
  field,
  form,
  inputMode,
  label,
  setForm,
}: {
  field: K;
  form: T;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  label: string;
  setForm: Dispatch<SetStateAction<T>>;
}): React.JSX.Element {
  return (
    <Field label={label}>
      <Input
        value={String(form[field])}
        inputMode={inputMode}
        onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
      />
    </Field>
  );
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function grantHeldBy(grant: DiscoveredGrant, account: Address, includeClosed: boolean): boolean {
  if (!grant.closed && sameAddress(grant.currentHolder, account)) return true;
  return Boolean(includeClosed && grant.lastHolder && sameAddress(grant.lastHolder, account));
}

function grantIssuedBy(grant: DiscoveredGrant, account: Address, includeClosed: boolean): boolean {
  return sameAddress(grant.issuer, account) && (includeClosed || !grant.closed);
}

function grantOriginalHolder(grant: DiscoveredGrant, account: Address, includeClosed: boolean): boolean {
  return sameAddress(grant.initialHolder, account) && (includeClosed || !grant.closed);
}

function toBlockText(toBlock: bigint | "latest" | undefined): string {
  if (toBlock === undefined) return "latest";
  return toBlock.toString();
}
