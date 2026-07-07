import type { Address } from "@pledge.cash/sdk";
import { ArrowDownUp, ArrowRight, ClipboardList, KeyRound, RefreshCw, Settings2 } from "lucide-react";
import { ActionButton, ActionRow, AddressLink, Facts, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { GrantVestingChart } from "../grants/grant-vesting-chart";
import { dateString } from "../../lib/forms";
import {
  formatNativeBalance,
  formatTokenBalance,
  type ProductBoardroomCatalogEntry,
  type ProductBoardroomDashboardState,
  type ProductBoardroomHistory,
  type ProductTreasuryAsset,
} from "../../lib/product-boardroom";
import { formatTokenAmount } from "../../lib/token-amounts";
import type { BoardroomDistributionSnapshot, BoardroomGrantSnapshot, BoardroomLockedLiquiditySnapshot } from "../../lib/types";

type ProductBoardroomDashboardProps = {
  account: Address | undefined;
  dashboard: ProductBoardroomDashboardState | undefined;
  error: string | undefined;
  loading: boolean;
  pendingAction: string | undefined;
  inspectGrant: (grant: Address) => void;
  openAdvanced: () => void;
  openGrants: () => void;
  openManage: (boardroom: Address) => void;
  openMarket: () => void;
  openTools: (boardroom: Address) => void;
  refresh: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
};

export function ProductBoardroomDashboard({
  account,
  dashboard,
  error,
  loading,
  pendingAction,
  inspectGrant,
  openAdvanced,
  openGrants,
  openManage,
  openMarket,
  openTools,
  refresh,
  runAction,
}: ProductBoardroomDashboardProps): React.JSX.Element {
  const snapshot = dashboard?.snapshot;
  const revenueAssets = dashboard?.treasuryAssets.filter((asset) => isRevenueAsset(asset, dashboard.snapshot.shareToken)) ?? [];
  const grantStats = grantSummary(dashboard?.snapshot.grantSummaries ?? []);
  const activeCatalogEntry = dashboard?.catalog.find((entry) => sameAddress(entry.address, dashboard.address));
  const projectName = activeCatalogEntry?.name ?? activeCatalogEntry?.symbol ?? "Boardroom Project";
  const accountRoles = projectRoles(account, dashboard);

  return (
    <div className="grid gap-4">
      <Panel
        title="Project Overview"
        description="Read the Boardroom as a project account: who controls it, what it owns, what it has promised, and which actions fit your wallet."
        action={
          <ActionButton
            actionId="refresh-product-boardroom"
            pendingAction={pendingAction}
            variant="secondary"
            onClick={() => void runAction("refresh-product-boardroom", refresh)}
          >
            <RefreshCw className="h-4 w-4" />
            {loading ? "Loading" : "Refresh"}
          </ActionButton>
        }
      >
        <div className="border-t border-zinc-800 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant={snapshot ? boardroomStatusTone(snapshot.status) : error ? "danger" : "muted"}>
                  {snapshot ? boardroomStatusLabel(snapshot.status) : error ? "Unavailable" : loading ? "Loading" : "Not loaded"}
                </Badge>
                {accountRoles.map((role) => (
                  <Badge key={role.label} variant={role.tone}>{role.label}</Badge>
                ))}
              </div>
              <h1 className="m-0 text-2xl font-semibold tracking-normal text-zinc-50 sm:text-3xl">{projectName}</h1>
              <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                Project-level state for buyers, holders, grant recipients, and operators. The chain is the source of truth; service context can add attribution without changing settlement.
              </p>
            </div>
            {dashboard ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button className="self-start" variant="secondary" onClick={openMarket}>
                  <ArrowDownUp className="h-4 w-4" />
                  Market
                </Button>
                <Button className="self-start" variant="secondary" onClick={openGrants}>
                  <KeyRound className="h-4 w-4" />
                  Grants
                </Button>
                <Button className="self-start" variant={isBoardroomOwner(account, dashboard) ? "default" : "secondary"} onClick={() => openManage(dashboard.address)}>
                  <Settings2 className="h-4 w-4" />
                  Manage
                </Button>
              </div>
            ) : null}
          </div>
          {error ? <p className="m-0 mt-4 rounded-md border border-red-950 bg-red-950/35 p-3 text-sm text-red-200">{error}</p> : null}
        </div>
        <Facts
          columns="three"
          items={[
            { label: "Boardroom", value: dashboard ? <AddressLink address={dashboard.address} /> : "No configured Boardroom" },
            { label: "Owner", value: snapshot?.owner ? <AddressLink address={snapshot.owner} /> : "Unknown" },
            { label: "Share token", value: snapshot?.shareToken ? <AddressLink address={snapshot.shareToken} /> : "Unknown" },
            { label: "Connected wallet", value: account ? <AddressLink address={account} /> : "Read-only visitor" },
            { label: "Native balance", value: dashboard ? formatNativeBalance(dashboard.nativeBalance) : "Unknown" },
            { label: "Revenue assets", value: String(revenueAssets.filter((asset) => (asset.balance ?? 0n) > 0n).length) },
            { label: "Obligations", value: snapshot ? `${snapshot.issuedGrants.length} grants / ${snapshot.issuedDistributions.length} distributions / ${snapshot.lockedLiquidityPositions.length} lockers` : "Unknown" },
          ]}
        />
        <ActionRow>
          <Button variant="secondary" onClick={openMarket}>
            <ArrowDownUp className="h-4 w-4" />
            Buy or trade
          </Button>
          <Button variant="secondary" onClick={openGrants}>
            <KeyRound className="h-4 w-4" />
            Settle a grant
          </Button>
          {dashboard ? (
            <Button variant={isBoardroomOwner(account, dashboard) ? "default" : "secondary"} onClick={() => openManage(dashboard.address)}>
              <Settings2 className="h-4 w-4" />
              Owner actions
            </Button>
          ) : null}
          <Button variant="secondary" onClick={openAdvanced}>
            <ClipboardList className="h-4 w-4" />
            Discovery
          </Button>
          {dashboard ? (
            <Button variant="ghost" onClick={() => openTools(dashboard.address)}>
              <ArrowRight className="h-4 w-4" />
              Raw tools
            </Button>
          ) : null}
        </ActionRow>
      </Panel>

      <LocalNetworkPanel
        activeBoardroom={dashboard?.address}
        cashAsset={dashboard?.treasuryAssets.find((asset) => sameAddress(asset.address, activeCatalogEntry?.cashToken))}
        entries={dashboard?.catalog ?? []}
        openTools={openTools}
        shareAsset={dashboard?.treasuryAssets.find((asset) => sameAddress(asset.address, dashboard?.snapshot.shareToken))}
      />

      <LaunchPanel dashboard={dashboard} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <TreasuryPanel assets={dashboard?.treasuryAssets ?? []} nativeBalance={dashboard?.nativeBalance} shareToken={snapshot?.shareToken} />
        <GrantHealthPanel
          grants={snapshot?.grantSummaries ?? []}
          history={dashboard?.history}
          inspectGrant={inspectGrant}
          stats={grantStats}
        />
      </div>

      <ObligationPanel
        distributions={snapshot?.distributionSummaries ?? []}
        lockers={snapshot?.lockedLiquiditySummaries ?? []}
      />
    </div>
  );
}

function LocalNetworkPanel({
  activeBoardroom,
  cashAsset,
  entries,
  openTools,
  shareAsset,
}: {
  activeBoardroom: Address | undefined;
  cashAsset: ProductTreasuryAsset | undefined;
  entries: ProductBoardroomCatalogEntry[];
  openTools: (boardroom: Address) => void;
  shareAsset: ProductTreasuryAsset | undefined;
}): React.JSX.Element | null {
  if (entries.length === 0) return null;

  return (
    <Panel title="Local Network">
      <ol className="m-0 grid list-none gap-px border-t border-zinc-800 bg-zinc-800 p-0 lg:grid-cols-2 xl:grid-cols-4">
        {entries.map((entry) => (
          <li className="min-w-0 bg-zinc-950 p-4" key={entry.address}>
            <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-100">{entry.name ?? entry.symbol ?? "Boardroom"}</div>
                <div className="mt-1 truncate text-xs text-zinc-500">{entry.path ?? entry.distributionKind ?? "Boardroom"}</div>
              </div>
              <Badge variant={sameAddress(entry.address, activeBoardroom) ? "default" : "muted"}>{entry.status ?? "Discovered"}</Badge>
            </div>
            <Facts
              columns="one"
              items={[
                { label: "Boardroom", value: <AddressLink address={entry.address} /> },
                { label: "Distribution", value: entry.distribution ? <AddressLink address={entry.distribution} /> : "None" },
                { label: "Sold", value: formatTokenAmount(entry.soldShares, catalogShareAsset(entry, shareAsset)) },
                { label: "Raised", value: formatTokenAmount(entry.cashRaised, catalogCashAsset(entry, cashAsset)) },
                { label: "Treasury cash", value: formatTokenAmount(entry.treasuryCash, catalogCashAsset(entry, cashAsset)) },
                { label: "Buyers", value: entry.buyerCount === undefined ? "Unknown" : String(entry.buyerCount) },
              ]}
            />
            <ActionRow>
              <Button size="sm" variant="secondary" onClick={() => openTools(entry.address)}>
                Open Tools
              </Button>
            </ActionRow>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function LaunchPanel({ dashboard }: { dashboard: ProductBoardroomDashboardState | undefined }): React.JSX.Element {
  const history = dashboard?.history;
  const migration = history?.curve?.migration;
  const curve = findLaunchDistribution(dashboard?.snapshot.distributionSummaries ?? [], history?.distribution);
  const locker = findLaunchLocker(dashboard?.snapshot.lockedLiquiditySummaries ?? [], migration?.locker, history?.pool);
  const shareAsset = findAsset(dashboard?.treasuryAssets ?? [], dashboard?.snapshot.shareToken);
  const cashAsset = findAsset(dashboard?.treasuryAssets ?? [], distributionPaymentTokenAddress(curve));
  const purchasedShares =
    history?.soldShares ?? (curve?.state && "soldShares" in curve.state ? curve.state.soldShares : undefined);
  const quoteRaised = history?.cashRaised ?? (curve?.state && "quoteReserve" in curve.state ? curve.state.quoteReserve : undefined);
  const optionStrike = impliedUnitPrice(migration?.quoteToLiquidity, migration?.sharesToLiquidity, shareAsset?.decimals);
  const migrationValuation = impliedQuoteValue(shareAsset?.totalSupply, optionStrike, shareAsset?.decimals);
  const claimableFees = formatClaimableLockerFees(locker);

  return (
    <Panel title="Launch Path">
      <Facts
        columns="three"
        items={[
          { label: "Curve", value: curve?.address ? <AddressLink address={curve.address} /> : "Unknown" },
          { label: "Curve status", value: curve ? curveStatusLabel(curve.state && "curveStatus" in curve.state ? curve.state.curveStatus : undefined) : "Unknown" },
          { label: "Curve purchases", value: formatTokenAmount(purchasedShares, shareAsset) },
          { label: "Quote raised", value: formatTokenAmount(quoteRaised, cashAsset) },
          { label: "Graduation target", value: formatTokenAmount(curve?.state && "graduationQuoteTarget" in curve.state ? curve.state.graduationQuoteTarget : undefined, cashAsset) },
          { label: "Quote to LP", value: formatTokenAmount(migration?.quoteToLiquidity, cashAsset) },
          { label: "Employee option strike", value: formatTokenAmount(optionStrike, cashAsset) },
          { label: "Implied FDV", value: formatTokenAmount(migrationValuation, cashAsset) },
          { label: "Locked LP", value: formatTokenAmount(locker?.state?.lockedLiquidity ?? migration?.liquidity, locker?.liquidityMetadata) },
          { label: "LP fees to claim", value: claimableFees },
        ]}
      />
      <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 lg:grid-cols-3">
        <LaunchSlice
          title="Curve Buyers"
          items={[
            {
              label: "Unique buyers",
              value: history?.buyerCount === undefined ? "Unknown" : String(history.buyerCount),
              detail: `${history?.curve?.buyCount ?? 0} buys / ${history?.curve?.sellCount ?? 0} sells`,
            },
            {
              label: "Net flow",
              value: formatTokenAmount(quoteRaised, cashAsset),
              detail: `${formatTokenAmount(purchasedShares, shareAsset)} shares`,
            },
          ]}
        />
        <LaunchSlice
          title="Migration"
          items={[
            {
              label: "Pool",
              value: migration?.pool ? <AddressLink address={migration.pool} /> : curve?.state && "pool" in curve.state ? <AddressLink address={curve.state.pool} /> : "Unknown",
              detail: `${formatTokenAmount(migration?.sharesToLiquidity, shareAsset)} paired`,
            },
            {
              label: "Locker",
              value: migration?.locker ? <AddressLink address={migration.locker} /> : locker?.address ? <AddressLink address={locker.address} /> : "Unknown",
              detail: `${formatTokenAmount(migration?.quoteToBoardroom, cashAsset)} retained`,
            },
          ]}
        />
        <LaunchSlice
          title="AMM Activity"
          items={[
            {
              label: "Swaps",
              value: history?.amm?.swapCount === undefined ? "Unknown" : String(history.amm.swapCount),
              detail: history?.amm?.traderCount === undefined ? "Unknown traders" : `${history.amm.traderCount} traders`,
            },
            {
              label: "Locker fees",
              value: claimableFees,
              detail: "Claimable by the locked LP position.",
            },
            {
              label: "Option valuation",
              value: formatTokenAmount(optionStrike, cashAsset),
              detail: "Grant strike set from migrated LP quote/share.",
            },
          ]}
        />
      </div>
    </Panel>
  );
}

function LaunchSlice({
  items,
  title,
}: {
  items: { detail: string; label: string; value: React.ReactNode }[];
  title: string;
}): React.JSX.Element {
  return (
    <section className="min-w-0 bg-zinc-950 p-4">
      <h3 className="m-0 mb-3 text-sm font-semibold text-zinc-100">{title}</h3>
      <dl className="grid gap-3">
        {items.map((item) => (
          <div className="min-w-0" key={item.label}>
            <dt className="text-xs font-medium uppercase tracking-normal text-zinc-500">{item.label}</dt>
            <dd className="m-0 mt-1 min-w-0 text-sm font-medium text-zinc-100">{item.value}</dd>
            <dd className="m-0 mt-1 text-xs leading-5 text-zinc-500">{item.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function TreasuryPanel({
  assets,
  nativeBalance,
  shareToken,
}: {
  assets: ProductTreasuryAsset[];
  nativeBalance: bigint | undefined;
  shareToken: Address | undefined;
}): React.JSX.Element {
  const shareAsset = shareToken ? assets.find((asset) => asset.address.toLowerCase() === shareToken.toLowerCase()) : undefined;
  const nonShareAssets = assets.filter((asset) => !shareToken || asset.address.toLowerCase() !== shareToken.toLowerCase());

  return (
    <Panel title="Treasury">
      <Facts
        columns="three"
        items={[
          { label: "Native", value: nativeBalance === undefined ? "Unknown" : formatNativeBalance(nativeBalance) },
          { label: "Treasury shares", value: shareAsset ? formatTokenBalance(shareAsset) : "Unknown" },
          { label: "Share supply", value: shareAsset?.totalSupply !== undefined ? formatTokenBalance({ ...shareAsset, balance: shareAsset.totalSupply }) : "Unknown" },
        ]}
      />
      {nonShareAssets.length === 0 ? (
        <p className="m-0 border-t border-zinc-800 p-4 text-sm text-zinc-500">No tracked treasury assets.</p>
      ) : (
        <ol className="grid gap-px border-t border-zinc-800 bg-zinc-800">
          {nonShareAssets.map((asset) => (
            <li className="grid gap-3 bg-zinc-950 p-4 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.45fr)] md:items-center" key={asset.address}>
              <div className="min-w-0">
                <div className="mb-1 text-sm font-semibold text-zinc-100">{asset.label}</div>
                <AddressLink address={asset.address} />
                {asset.error ? <p className="m-0 mt-2 text-sm text-red-200">{asset.error}</p> : null}
              </div>
              <div className="min-w-0 text-left md:text-right">
                <div className="text-base font-semibold text-zinc-50">{formatTokenBalance(asset)}</div>
                <div className="mt-1 text-xs text-zinc-500">{asset.symbol ?? "token"}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function GrantHealthPanel({
  grants,
  history,
  stats,
  inspectGrant,
}: {
  grants: BoardroomGrantSnapshot[];
  history: ProductBoardroomHistory | undefined;
  stats: ReturnType<typeof grantSummary>;
  inspectGrant: (grant: Address) => void;
}): React.JSX.Element {
  const summaryTokenMetadata = commonGrantTokenMetadata(grants);
  const cashAsset = commonGrantPaymentTokenMetadata(grants);
  const migrationStrike = impliedUnitPrice(history?.curve?.migration?.quoteToLiquidity, history?.curve?.migration?.sharesToLiquidity, summaryTokenMetadata?.decimals);

  return (
    <Panel title="Employee Options">
      <Facts
        columns="two"
        items={[
          { label: "Open", value: String(stats.open) },
          { label: "Closed", value: String(stats.closed) },
          { label: "Halted", value: String(stats.halted) },
          { label: "Read failures", value: String(stats.failed) },
          { label: "Grant size", value: formatTokenAmount(stats.grantSize, summaryTokenMetadata) },
          { label: "Settled", value: formatTokenAmount(stats.settled, summaryTokenMetadata) },
          { label: "Migration strike", value: formatTokenAmount(migrationStrike, cashAsset) },
        ]}
      />
      {grants.length === 0 ? (
        <p className="m-0 border-t border-zinc-800 p-4 text-sm text-zinc-500">No Boardroom-issued grants.</p>
      ) : (
        <ol className="grid gap-px border-t border-zinc-800 bg-zinc-800">
          {grants.map((grant) => (
            <li className="bg-zinc-950 p-4" key={grant.address}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <AddressLink address={grant.address} />
                </div>
                <Badge variant={grant.error ? "danger" : grant.state?.closed ? "warning" : "default"}>
                  {grant.error ? "Read failed" : grant.state?.closed ? "Closed" : "Open"}
                </Badge>
              </div>
              {grant.error ? <p className="m-0 text-sm text-red-200">{grant.error}</p> : null}
              <Facts
                columns="three"
                items={[
                  { label: "Holder", value: grant.state ? <AddressLink address={grant.state.holder} /> : "Unknown" },
                  { label: "Grant size", value: formatTokenAmount(grant.state?.grantSize, grant.tokenMetadata) },
                  { label: "Claimable", value: formatTokenAmount(grant.state?.claimable, grant.tokenMetadata) },
                  { label: "Settled", value: formatTokenAmount(grant.state?.settledAmount, grant.tokenMetadata) },
                  { label: "Settleable now", value: formatTokenAmount(grant.state?.settleable, grant.tokenMetadata) },
                  { label: "Strike", value: formatTokenAmount(grant.state?.price, grant.paymentTokenMetadata) },
                  { label: "Payment", value: grant.state && !isZeroGrantPayment(grant.state.paymentToken) ? <AddressLink address={grant.state.paymentToken} /> : "None" },
                  { label: "Vesting cliff", value: dateString(grant.state?.vestingCliff) },
                  { label: "Vesting end", value: dateString(grant.state?.vestingEnd) },
                  { label: "Expiry", value: dateString(grant.state?.expiry) },
                ]}
              />
              <GrantVestingChart state={grant.state} tokenMetadata={grant.tokenMetadata} />
              <ActionRow>
                <Button size="sm" variant="secondary" onClick={() => inspectGrant(grant.address)}>
                  Inspect Grant
                </Button>
              </ActionRow>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function ObligationPanel({
  distributions,
  lockers,
}: {
  distributions: BoardroomDistributionSnapshot[];
  lockers: BoardroomLockedLiquiditySnapshot[];
}): React.JSX.Element {
  return (
    <Panel title="Protocol Obligations">
      <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 lg:grid-cols-2">
        <ObligationColumn title="Distributions" emptyLabel="No distributions">
          {distributions.map((distribution) => (
            <li className="bg-zinc-950 p-4" key={distribution.address}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <AddressLink address={distribution.address} />
                <Badge variant={distribution.error ? "danger" : distribution.state?.closed ? "warning" : "default"}>
                  {distribution.error ? "Read failed" : distribution.kind}
                </Badge>
              </div>
              <Facts
                columns="one"
                items={[
                  { label: "Kind", value: distribution.kind },
                  { label: "Remaining shares", value: formatTokenAmount(remainingDistributionShares(distribution), distribution.shareTokenMetadata) },
                  { label: "Payment token", value: distributionPaymentToken(distribution) },
                ]}
              />
            </li>
          ))}
        </ObligationColumn>
        <ObligationColumn title="Locked Liquidity" emptyLabel="No lockers">
          {lockers.map((locker) => (
            <li className="bg-zinc-950 p-4" key={locker.address}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <AddressLink address={locker.address} />
                <Badge variant={locker.error ? "danger" : locker.state?.lockedLiquidity === 0n ? "warning" : "default"}>
                  {locker.error ? "Read failed" : locker.state?.lockedLiquidity === 0n ? "Exited" : "Locked"}
                </Badge>
              </div>
              <Facts
                columns="one"
                items={[
                  { label: "Pool", value: locker.state?.pool ? <AddressLink address={locker.state.pool} /> : "Unknown" },
                  { label: "Locked LP", value: formatTokenAmount(locker.state?.lockedLiquidity, locker.liquidityMetadata) },
                  { label: "Claimable A", value: formatTokenAmount(locker.claimableA, locker.tokenAMetadata) },
                  { label: "Claimable B", value: formatTokenAmount(locker.claimableB, locker.tokenBMetadata) },
                  { label: "Pair", value: locker.state ? `${locker.state.tokenA} / ${locker.state.tokenB}` : "Unknown" },
                ]}
              />
            </li>
          ))}
        </ObligationColumn>
      </div>
    </Panel>
  );
}

function ObligationColumn({
  children,
  emptyLabel,
  title,
}: {
  children: React.ReactNode[];
  emptyLabel: string;
  title: string;
}): React.JSX.Element {
  return (
    <section className="min-w-0 bg-zinc-950">
      <h3 className="m-0 border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">{title}</h3>
      {children.length === 0 ? <p className="m-0 p-4 text-sm text-zinc-500">{emptyLabel}</p> : <ol className="grid gap-px bg-zinc-800">{children}</ol>}
    </section>
  );
}

function grantSummary(grants: BoardroomGrantSnapshot[]): {
  closed: number;
  failed: number;
  grantSize: bigint;
  halted: number;
  open: number;
  settled: bigint;
} {
  return grants.reduce(
    (summary, grant) => {
      if (grant.error || !grant.state) return { ...summary, failed: summary.failed + 1 };
      return {
        closed: summary.closed + (grant.state.closed ? 1 : 0),
        failed: summary.failed,
        grantSize: summary.grantSize + grant.state.grantSize,
        halted: summary.halted + (grant.state.halted ? 1 : 0),
        open: summary.open + (grant.state.closed ? 0 : 1),
        settled: summary.settled + grant.state.settledAmount,
      };
    },
    { closed: 0, failed: 0, grantSize: 0n, halted: 0, open: 0, settled: 0n },
  );
}

function commonGrantTokenMetadata(grants: BoardroomGrantSnapshot[]): BoardroomGrantSnapshot["tokenMetadata"] | undefined {
  const withState = grants.filter((grant) => grant.state);
  const first = withState[0];
  if (!first?.state) return undefined;
  const token = first.state.token.toLowerCase();
  if (!withState.every((grant) => grant.state?.token.toLowerCase() === token)) return undefined;
  return first.tokenMetadata;
}

function commonGrantPaymentTokenMetadata(grants: BoardroomGrantSnapshot[]): BoardroomGrantSnapshot["paymentTokenMetadata"] | undefined {
  const withPayment = grants.filter((grant) => grant.state && !isZeroGrantPayment(grant.state.paymentToken));
  const first = withPayment[0];
  if (!first?.state) return undefined;
  const token = first.state.paymentToken.toLowerCase();
  if (!withPayment.every((grant) => grant.state?.paymentToken.toLowerCase() === token)) return undefined;
  return first.paymentTokenMetadata;
}

function isRevenueAsset(asset: ProductTreasuryAsset, shareToken: Address): boolean {
  return asset.address.toLowerCase() !== shareToken.toLowerCase() && (asset.balance ?? 0n) > 0n;
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

function isZeroGrantPayment(address: Address): boolean {
  return address.toLowerCase() === "0x0000000000000000000000000000000000000000";
}

function remainingDistributionShares(distribution: BoardroomDistributionSnapshot): bigint | undefined {
  if (!distribution.state) return undefined;
  if ("remainingShares" in distribution.state) return distribution.state.remainingShares;
  if ("remainingSaleShares" in distribution.state) return distribution.state.remainingSaleShares;
  return undefined;
}

function distributionPaymentToken(distribution: BoardroomDistributionSnapshot): React.ReactNode {
  if (!distribution.state) return "Unknown";
  if ("paymentToken" in distribution.state) return <AddressLink address={distribution.state.paymentToken} />;
  if ("quoteToken" in distribution.state) return <AddressLink address={distribution.state.quoteToken} />;
  return "Unknown";
}

function findAsset(assets: ProductTreasuryAsset[], address: Address | undefined): ProductTreasuryAsset | undefined {
  if (!address) return undefined;
  return assets.find((asset) => asset.address.toLowerCase() === address.toLowerCase());
}

function findLaunchDistribution(
  distributions: BoardroomDistributionSnapshot[],
  address: Address | undefined,
): BoardroomDistributionSnapshot | undefined {
  if (address) {
    const selected = distributions.find((distribution) => distribution.address.toLowerCase() === address.toLowerCase());
    if (selected) return selected;
  }
  return distributions.find((distribution) => distribution.kind === "migrating-bonding-curve");
}

function findLaunchLocker(
  lockers: BoardroomLockedLiquiditySnapshot[],
  address: Address | undefined,
  pool: Address | undefined,
): BoardroomLockedLiquiditySnapshot | undefined {
  if (address) {
    const selected = lockers.find((locker) => locker.address.toLowerCase() === address.toLowerCase());
    if (selected) return selected;
  }
  if (pool) {
    const matchingPool = lockers.find((locker) => sameAddress(locker.state?.pool, pool));
    if (matchingPool) return matchingPool;
  }
  return lockers[0];
}

function formatClaimableLockerFees(locker: BoardroomLockedLiquiditySnapshot | undefined): string {
  if (!locker) return "Unknown";
  return `${formatTokenAmount(locker.claimableA, locker.tokenAMetadata)} / ${formatTokenAmount(locker.claimableB, locker.tokenBMetadata)}`;
}

function impliedQuoteValue(
  amount: bigint | undefined,
  price: bigint | undefined,
  decimals: number | undefined,
): bigint | undefined {
  if (amount === undefined || price === undefined || decimals === undefined) return undefined;
  return (amount * price) / 10n ** BigInt(decimals);
}

function impliedUnitPrice(
  quoteAmount: bigint | undefined,
  shareAmount: bigint | undefined,
  shareDecimals: number | undefined,
): bigint | undefined {
  if (quoteAmount === undefined || shareAmount === undefined || shareAmount === 0n || shareDecimals === undefined) return undefined;
  return (quoteAmount * 10n ** BigInt(shareDecimals)) / shareAmount;
}

function curveStatusLabel(status: number | undefined): string {
  if (status === 0) return "Active";
  if (status === 1) return "Migrated";
  if (status === 2) return "Cancelled";
  return "Unknown";
}

function catalogShareAsset(
  entry: ProductBoardroomCatalogEntry,
  primaryShareAsset: ProductTreasuryAsset | undefined,
): ProductTreasuryAsset | undefined {
  if (!entry.shareToken) return undefined;
  if (sameAddress(entry.shareToken, primaryShareAsset?.address)) return primaryShareAsset;
  const asset: ProductTreasuryAsset = {
    address: entry.shareToken,
    decimals: entry.shareTokenDecimals ?? 18,
    label: "Treasury shares",
  };
  if (entry.symbol) asset.symbol = entry.symbol;
  return asset;
}

function catalogCashAsset(
  entry: ProductBoardroomCatalogEntry,
  primaryCashAsset: ProductTreasuryAsset | undefined,
): ProductTreasuryAsset | undefined {
  if (!entry.cashToken) return primaryCashAsset;
  if (sameAddress(entry.cashToken, primaryCashAsset?.address)) return primaryCashAsset;
  const asset: ProductTreasuryAsset = {
    address: entry.cashToken,
    label: "Cash / quote",
  };
  if (entry.cashTokenDecimals !== undefined) asset.decimals = entry.cashTokenDecimals;
  if (entry.cashTokenSymbol) asset.symbol = entry.cashTokenSymbol;
  return asset;
}

function distributionPaymentTokenAddress(distribution: BoardroomDistributionSnapshot | undefined): Address | undefined {
  if (!distribution?.state) return undefined;
  if ("paymentToken" in distribution.state) return distribution.state.paymentToken;
  if ("quoteToken" in distribution.state) return distribution.state.quoteToken;
  return undefined;
}

function projectRoles(
  account: Address | undefined,
  dashboard: ProductBoardroomDashboardState | undefined,
): { label: string; tone: "default" | "muted" | "warning" }[] {
  if (!account) return [{ label: "Read-only", tone: "muted" }];
  if (!dashboard?.snapshot) return [{ label: "Wallet connected", tone: "muted" }];

  const roles: { label: string; tone: "default" | "muted" | "warning" }[] = [];
  if (isBoardroomOwner(account, dashboard)) roles.push({ label: "Boardroom owner", tone: "default" });
  if (dashboard.snapshot.grantSummaries.some((grant) => sameAddress(grant.state?.holder, account))) {
    roles.push({ label: "Grant holder", tone: "default" });
  }
  if (dashboard.snapshot.grantSummaries.some((grant) => sameAddress(grant.state?.issuer, account))) {
    roles.push({ label: "Grant issuer", tone: "warning" });
  }
  if (roles.length === 0) roles.push({ label: "Buyer / holder view", tone: "muted" });
  return roles;
}

function isBoardroomOwner(
  account: Address | undefined,
  dashboard: ProductBoardroomDashboardState | undefined,
): boolean {
  return sameAddress(account, dashboard?.snapshot.owner);
}

function sameAddress(first: Address | undefined, second: Address | undefined): boolean {
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase());
}
