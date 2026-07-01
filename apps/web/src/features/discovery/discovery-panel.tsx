import type {
  Address,
  DiscoveredBoardroom,
  DiscoveredDistribution,
  DiscoveredGrant,
  DiscoveredLockedLiquidity,
  DiscoveredPool,
  PledgeCashDeployment,
} from "@pledge.cash/sdk";
import { Database, RefreshCw, RotateCcw, Search, Trash2 } from "lucide-react";
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
  const heldGrants = account ? grants.filter((grant) => grantHeldBy(grant, account, discoveryForm.includeClosedGrants)) : [];
  const issuedGrants = account ? grants.filter((grant) => grantIssuedBy(grant, account, discoveryForm.includeClosedGrants)) : [];
  const originalHolderGrants = account
    ? grants.filter((grant) => grantOriginalHolder(grant, account, discoveryForm.includeClosedGrants))
    : [];

  return (
    <div className="grid gap-4">
      <Panel
        title="Discovery Scan"
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
            { label: "Loaded range", value: loadedForCurrentAccount ? `${bigintString(discovery.fromBlock)} -> ${toBlockText(discovery.toBlock)}` : "None" },
            { label: "Last scanned block", value: bigintString(discovery.lastScannedBlock) },
            { label: "Status", value: <StatusBadge complete={loadedForCurrentAccount ? discovery.complete : true} errors={loadedForCurrentAccount ? discovery.errors.length : 0} /> },
            { label: "Boardrooms", value: String(boardrooms.length) },
            { label: "Cached objects", value: `${grants.length} grants / ${distributions.length} distributions / ${lockers.length} lockers / ${pools.length} pools` },
          ]}
        />
        {loadedForCurrentAccount && discovery.errors.length > 0 ? (
          <ol className="grid gap-px border-t border-zinc-800 bg-zinc-800">
            {discovery.errors.map((error) => (
              <li className="bg-zinc-950 p-4 text-sm text-red-200" key={error}>{error}</li>
            ))}
          </ol>
        ) : null}
      </Panel>

      <BoardroomList boardrooms={boardrooms} useBoardroom={useBoardroom} />
      <GrantDiscoveryLists
        heldGrants={heldGrants}
        inspectGrant={inspectGrant}
        issuedGrants={issuedGrants}
        originalHolderGrants={originalHolderGrants}
      />
      <ObligationDiscoveryList distributions={distributions} lockers={lockers} useDistribution={useDistribution} useLockedLiquidity={useLockedLiquidity} />
      <PoolDiscoveryList lockers={lockers} pools={pools} useLockedLiquidity={useLockedLiquidity} />
    </div>
  );
}

function BoardroomList({
  boardrooms,
  useBoardroom,
}: {
  boardrooms: DiscoveredBoardroom[];
  useBoardroom: (boardroom: Address) => void;
}): React.JSX.Element {
  return (
    <Panel title="My Boardrooms">
      {boardrooms.length === 0 ? (
        <EmptyList label="No boardrooms" />
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
                  <Database className="h-3.5 w-3.5" />
                  Use Boardroom
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
  heldGrants,
  inspectGrant,
  issuedGrants,
  originalHolderGrants,
}: {
  heldGrants: DiscoveredGrant[];
  inspectGrant: (grant: Address) => void;
  issuedGrants: DiscoveredGrant[];
  originalHolderGrants: DiscoveredGrant[];
}): React.JSX.Element {
  return (
    <Panel title="My Grants">
      <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 xl:grid-cols-3">
        <GrantColumn grants={heldGrants} inspectGrant={inspectGrant} title="Current Holder" />
        <GrantColumn grants={issuedGrants} inspectGrant={inspectGrant} title="Issuer" />
        <GrantColumn grants={originalHolderGrants} inspectGrant={inspectGrant} title="Original Holder" />
      </div>
    </Panel>
  );
}

function GrantColumn({
  grants,
  inspectGrant,
  title,
}: {
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
                <RefreshCw className="h-3.5 w-3.5" />
                Inspect
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
  lockers,
  useDistribution,
  useLockedLiquidity,
}: {
  distributions: DiscoveredDistribution[];
  lockers: DiscoveredLockedLiquidity[];
  useDistribution: (distribution: DiscoveredDistribution) => void;
  useLockedLiquidity: (locker: DiscoveredLockedLiquidity) => void;
}): React.JSX.Element {
  return (
    <Panel title="Boardroom Obligations">
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
                    Use Distribution
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
                    Use Locker
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
  lockers,
  pools,
  useLockedLiquidity,
}: {
  lockers: DiscoveredLockedLiquidity[];
  pools: DiscoveredPool[];
  useLockedLiquidity: (locker: DiscoveredLockedLiquidity) => void;
}): React.JSX.Element {
  return (
    <Panel title="Pools And Liquidity">
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
                Use Locker
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

function StatusBadge({ complete, errors }: { complete: boolean; errors: number }): React.JSX.Element {
  if (!complete || errors > 0) return <Badge variant="warning">Partial</Badge>;
  return <Badge variant="default">Complete</Badge>;
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
