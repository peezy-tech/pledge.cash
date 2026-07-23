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
import type { BoardroomDistributionSnapshot, BoardroomGrantSnapshot, BoardroomLockedLiquiditySnapshot, BoardroomSnapshot } from "../../lib/types";
import {
  boardroomStatusLabel,
  boardroomStatusTone,
  curveStatusLabel,
  distributionPaymentTokenAddress,
  grantStatusLabel,
  grantStatusTone,
  lockerStatusLabel,
  lockerStatusTone,
  remainingDistributionShares,
  sameAddress,
  type BoardroomFact,
  type StatusTone,
} from "./boardroom-panel-shared";

type ProductBoardroomDashboardProps = {
  account: Address | undefined;
  dashboard: ProductBoardroomDashboardState | undefined;
  error: string | undefined;
  governanceActivity?: React.ReactNode;
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
  governanceActivity,
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
  const treasuryAssets = dashboard?.treasuryAssets ?? [];
  const revenueAssetCount = treasuryAssets.filter((asset) => isRevenueAsset(asset, snapshot?.shareToken)).length;
  const grantStats = grantSummary(dashboard?.snapshot.grantSummaries ?? []);
  const activeCatalogEntry = selectedCatalogEntry(dashboard);
  const projectName = projectDisplayName(activeCatalogEntry);
  const accountRoles = projectRoles(account, dashboard);
  const accessLabel = accountRoles.map((role) => role.label).join(" / ");
  const isOwner = isBoardroomOwner(account, dashboard);
  const overviewStatus = dashboardOverviewStatus(snapshot, error, loading);

  return (
    <div className="grid gap-4">
      <Panel
        title="Overview"
        description="Project account state, treasury posture, open commitments, and wallet-relevant actions."
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
                <Badge variant={overviewStatus.tone}>{overviewStatus.label}</Badge>
                {accountRoles.map((role) => (
                  <Badge key={role.label} variant={role.tone}>
                    {role.label}
                  </Badge>
                ))}
              </div>
              <div className="m-0 text-2xl font-semibold tracking-normal text-zinc-50 sm:text-3xl">{projectName}</div>
              <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                State for buyers, holders, grant recipients, and operators. Settlement stays onchain; service context can add attribution without changing authority.
              </p>
            </div>
            {dashboard ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button className="self-start" variant="secondary" onClick={openMarket}>
                  <ArrowDownUp className="h-4 w-4" />
                  Trade
                </Button>
                <Button className="self-start" variant="secondary" onClick={openGrants}>
                  <KeyRound className="h-4 w-4" />
                  Grants
                </Button>
                <Button className="self-start" variant={isOwner ? "default" : "secondary"} onClick={() => openManage(dashboard.address)}>
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
            { label: "Project account", value: dashboard ? <AddressLink address={dashboard.address} /> : "No configured project" },
            { label: "Owner", value: snapshot?.owner ? <AddressLink address={snapshot.owner} /> : "Unknown" },
            { label: "Project token", value: snapshot?.shareToken ? <AddressLink address={snapshot.shareToken} /> : "Unknown" },
            { label: "Connected wallet", value: account ? <AddressLink address={account} /> : "Read-only visitor" },
            { label: "Native balance", value: dashboard ? formatNativeBalance(dashboard.nativeBalance) : "Unknown" },
            { label: "Revenue assets", value: String(revenueAssetCount) },
            { label: "Open commitments", value: openCommitmentsLabel(snapshot) },
            { label: "Access", value: accessLabel },
            { label: "Settlement", value: "Onchain" },
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
            <Button variant={isOwner ? "default" : "secondary"} onClick={() => openManage(dashboard.address)}>
              <Settings2 className="h-4 w-4" />
              Owner actions
            </Button>
          ) : null}
          <Button variant="secondary" onClick={openAdvanced}>
            <ClipboardList className="h-4 w-4" />
            Tools
          </Button>
          {dashboard ? (
            <Button variant="ghost" onClick={() => openTools(dashboard.address)}>
              <ArrowRight className="h-4 w-4" />
              Boardroom tools
            </Button>
          ) : null}
        </ActionRow>
      </Panel>

      <LocalNetworkPanel
        activeBoardroom={dashboard?.address}
        cashAsset={findAsset(treasuryAssets, activeCatalogEntry?.cashToken)}
        entries={dashboard?.catalog ?? []}
        openTools={openTools}
        shareAsset={findAsset(treasuryAssets, snapshot?.shareToken)}
      />

      <LaunchPanel dashboard={dashboard} />

      {governanceActivity}

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
    <Panel title="Project Directory" description="Related Boardrooms discovered for the selected local network.">
      <ol className="m-0 grid list-none gap-px border-t border-zinc-800 bg-zinc-800 p-0">
        {entries.map((entry) => (
          <li
            className="grid min-w-0 gap-3 bg-zinc-950 p-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(120px,0.35fr)_minmax(120px,0.35fr)_minmax(92px,0.25fr)_auto] lg:items-center"
            key={entry.address}
          >
            <div className="min-w-0">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="truncate text-sm font-semibold text-zinc-100">{entry.name ?? entry.symbol ?? "Boardroom"}</div>
                  <Badge variant={sameAddress(entry.address, activeBoardroom) ? "default" : "muted"}>{entry.status ?? "Discovered"}</Badge>
                </div>
                <div className="mt-1 truncate text-xs text-zinc-500">{entry.path ?? entry.distributionKind ?? "Boardroom"}</div>
                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="min-w-0">Boardroom <AddressLink address={entry.address} /></span>
                  {entry.distribution ? <span className="min-w-0">Distribution <AddressLink address={entry.distribution} /></span> : null}
                </div>
              </div>
            </div>
            <DirectoryMetric label="Sold" value={formatTokenAmount(entry.soldShares, catalogShareAsset(entry, shareAsset))} />
            <DirectoryMetric label="Raised" value={formatTokenAmount(entry.cashRaised, catalogCashAsset(entry, cashAsset))} />
            <DirectoryMetric label="Buyers" value={entry.buyerCount === undefined ? "Unknown" : String(entry.buyerCount)} />
            <div className="flex lg:justify-end">
              <Button size="sm" variant="secondary" onClick={() => openTools(entry.address)}>
                Open tools
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function DirectoryMetric({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-normal text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-zinc-100" title={typeof value === "string" ? value : undefined}>
        {value}
      </div>
    </div>
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
  const curveStatus = curve ? curveStatusLabel(curve.state && "curveStatus" in curve.state ? curve.state.curveStatus : undefined) : "Unknown";
  const graduationTarget = curve?.state && "graduationQuoteTarget" in curve.state ? curve.state.graduationQuoteTarget : undefined;
  const migrationPool = migration?.pool ?? (curve?.state && "pool" in curve.state ? curve.state.pool : undefined);
  const migrationLocker = migration?.locker ?? locker?.address;
  const optionStrike = impliedUnitPrice(migration?.quoteToLiquidity, migration?.sharesToLiquidity, shareAsset?.decimals);
  const migrationValuation = impliedQuoteValue(shareAsset?.totalSupply, optionStrike, shareAsset?.decimals);
  const claimableFees = formatClaimableLockerFees(locker);

  return (
    <Panel title="Launch">
      <Facts
        columns="three"
        items={[
          { label: "Curve", value: curve?.address ? <AddressLink address={curve.address} /> : "Unknown" },
          { label: "Curve status", value: curveStatus },
          { label: "Curve purchases", value: formatTokenAmount(purchasedShares, shareAsset) },
          { label: "Quote raised", value: formatTokenAmount(quoteRaised, cashAsset) },
          { label: "Graduation target", value: formatTokenAmount(graduationTarget, cashAsset) },
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
              value: migrationPool ? <AddressLink address={migrationPool} /> : "Unknown",
              detail: `${formatTokenAmount(migration?.sharesToLiquidity, shareAsset)} paired`,
            },
            {
              label: "Locker",
              value: migrationLocker ? <AddressLink address={migrationLocker} /> : "Unknown",
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
              detail: history?.amm?.traderCount === undefined ? "Unknown pool callers" : `${history.amm.traderCount} unique pool callers`,
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
    <Panel title="Grant Health">
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
            <GrantHealthRow grant={grant} inspectGrant={inspectGrant} key={grant.address} />
          ))}
        </ol>
      )}
    </Panel>
  );
}

function GrantHealthRow({
  grant,
  inspectGrant,
}: {
  grant: BoardroomGrantSnapshot;
  inspectGrant: (grant: Address) => void;
}): React.JSX.Element {
  const statusLabel = grantStatusLabel(grant);
  const statusTone = grantStatusTone(grant);

  return (
    <li className="bg-zinc-950 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <AddressLink address={grant.address} />
        </div>
        <Badge variant={statusTone}>{statusLabel}</Badge>
      </div>
      {grant.error ? <p className="m-0 text-sm text-red-200">{grant.error}</p> : null}
      <Facts columns="three" items={grantHealthFacts(grant)} />
      <GrantVestingChart state={grant.state} tokenMetadata={grant.tokenMetadata} />
      <ActionRow>
        <Button size="sm" variant="secondary" onClick={() => inspectGrant(grant.address)}>
          Inspect Grant
        </Button>
      </ActionRow>
    </li>
  );
}

function grantHealthFacts(grant: BoardroomGrantSnapshot): BoardroomFact[] {
  return [
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
  ];
}

function ObligationPanel({
  distributions,
  lockers,
}: {
  distributions: BoardroomDistributionSnapshot[];
  lockers: BoardroomLockedLiquiditySnapshot[];
}): React.JSX.Element {
  return (
    <Panel title="Obligations">
      <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 lg:grid-cols-2">
        <ObligationColumn title="Distributions" emptyLabel="No distributions">
          {distributions.map((distribution) => (
            <DashboardDistributionRow distribution={distribution} key={distribution.address} />
          ))}
        </ObligationColumn>
        <ObligationColumn title="Locked Liquidity" emptyLabel="No lockers">
          {lockers.map((locker) => (
            <DashboardLockerRow locker={locker} key={locker.address} />
          ))}
        </ObligationColumn>
      </div>
    </Panel>
  );
}

function DashboardDistributionRow({ distribution }: { distribution: BoardroomDistributionSnapshot }): React.JSX.Element {
  const badge = dashboardDistributionBadge(distribution);

  return (
    <li className="bg-zinc-950 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AddressLink address={distribution.address} />
        <Badge variant={badge.tone}>{badge.label}</Badge>
      </div>
      <Facts columns="one" items={dashboardDistributionFacts(distribution)} />
    </li>
  );
}

function DashboardLockerRow({ locker }: { locker: BoardroomLockedLiquiditySnapshot }): React.JSX.Element {
  const statusLabel = lockerStatusLabel(locker);
  const statusTone = lockerStatusTone(locker);

  return (
    <li className="bg-zinc-950 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AddressLink address={locker.address} />
        <Badge variant={statusTone}>{statusLabel}</Badge>
      </div>
      <Facts columns="one" items={dashboardLockerFacts(locker)} />
    </li>
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

function selectedCatalogEntry(
  dashboard: ProductBoardroomDashboardState | undefined,
): ProductBoardroomCatalogEntry | undefined {
  return dashboard?.catalog.find((entry) => sameAddress(entry.address, dashboard.address));
}

function projectDisplayName(entry: ProductBoardroomCatalogEntry | undefined): string {
  return entry?.name ?? entry?.symbol ?? "Boardroom Project";
}

function dashboardOverviewStatus(
  snapshot: BoardroomSnapshot | undefined,
  error: string | undefined,
  loading: boolean,
): { label: string; tone: StatusTone } {
  if (snapshot) return { label: boardroomStatusLabel(snapshot.status), tone: boardroomStatusTone(snapshot.status) };
  if (error) return { label: "Unavailable", tone: "danger" };
  if (loading) return { label: "Loading", tone: "muted" };
  return { label: "Not loaded", tone: "muted" };
}

function openCommitmentsLabel(snapshot: BoardroomSnapshot | undefined): string {
  if (!snapshot) return "Unknown";
  return `${snapshot.activeGrantCount.toString()} grants / ${snapshot.activeDistributionCount.toString()} distributions / ${snapshot.activeLiquidityCount.toString()} liquidity positions`;
}

function dashboardDistributionBadge(distribution: BoardroomDistributionSnapshot): { label: string; tone: StatusTone } {
  if (distribution.error) return { label: "Read failed", tone: "danger" };
  if (distribution.state?.closed) return { label: distribution.kind, tone: "warning" };
  return { label: distribution.kind, tone: "default" };
}

function dashboardDistributionFacts(distribution: BoardroomDistributionSnapshot): BoardroomFact[] {
  return [
    { label: "Kind", value: distribution.kind },
    { label: "Remaining shares", value: formatTokenAmount(remainingDistributionShares(distribution), distribution.shareTokenMetadata) },
    { label: "Payment token", value: distributionPaymentToken(distribution) },
  ];
}

function dashboardLockerFacts(locker: BoardroomLockedLiquiditySnapshot): BoardroomFact[] {
  return [
    { label: "Pool", value: locker.state?.pool ? <AddressLink address={locker.state.pool} /> : "Unknown" },
    { label: "Locked LP", value: formatTokenAmount(locker.state?.lockedLiquidity, locker.liquidityMetadata) },
    { label: "Claimable A", value: formatTokenAmount(locker.claimableA, locker.tokenAMetadata) },
    { label: "Claimable B", value: formatTokenAmount(locker.claimableB, locker.tokenBMetadata) },
    { label: "Pair", value: locker.state ? `${locker.state.tokenA} / ${locker.state.tokenB}` : "Unknown" },
  ];
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

function isRevenueAsset(asset: ProductTreasuryAsset, shareToken: Address | undefined): boolean {
  return !sameAddress(asset.address, shareToken) && (asset.balance ?? 0n) > 0n;
}

function isZeroGrantPayment(address: Address): boolean {
  return address.toLowerCase() === "0x0000000000000000000000000000000000000000";
}

function distributionPaymentToken(distribution: BoardroomDistributionSnapshot): React.ReactNode {
  const paymentToken = distributionPaymentTokenAddress(distribution);
  return paymentToken ? <AddressLink address={paymentToken} /> : "Unknown";
}

function findAsset(assets: ProductTreasuryAsset[], address: Address | undefined): ProductTreasuryAsset | undefined {
  if (!address) return undefined;
  return assets.find((asset) => sameAddress(asset.address, address));
}

function findLaunchDistribution(
  distributions: BoardroomDistributionSnapshot[],
  address: Address | undefined,
): BoardroomDistributionSnapshot | undefined {
  if (address) {
    const selected = distributions.find((distribution) => sameAddress(distribution.address, address));
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
    const selected = lockers.find((locker) => sameAddress(locker.address, address));
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
