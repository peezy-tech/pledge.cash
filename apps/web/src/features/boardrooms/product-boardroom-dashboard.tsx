import type { Address } from "@pledge.cash/sdk";
import { ArrowRight, RefreshCw } from "lucide-react";
import { ActionButton, ActionRow, AddressLink, Facts, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { dateString } from "../../lib/forms";
import {
  formatNativeBalance,
  formatTokenBalance,
  type ProductBoardroomDashboardState,
  type ProductTreasuryAsset,
} from "../../lib/product-boardroom";
import { formatTokenAmount } from "../../lib/token-amounts";
import type { BoardroomDistributionSnapshot, BoardroomGrantSnapshot, BoardroomLockedLiquiditySnapshot } from "../../lib/types";

type ProductBoardroomDashboardProps = {
  dashboard: ProductBoardroomDashboardState | undefined;
  error: string | undefined;
  loading: boolean;
  pendingAction: string | undefined;
  inspectGrant: (grant: Address) => void;
  openTools: (boardroom: Address) => void;
  refresh: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
};

export function ProductBoardroomDashboard({
  dashboard,
  error,
  loading,
  pendingAction,
  inspectGrant,
  openTools,
  refresh,
  runAction,
}: ProductBoardroomDashboardProps): React.JSX.Element {
  const snapshot = dashboard?.snapshot;
  const revenueAssets = dashboard?.treasuryAssets.filter((asset) => isRevenueAsset(asset, dashboard.snapshot.shareToken)) ?? [];
  const grantStats = grantSummary(dashboard?.snapshot.grantSummaries ?? []);

  return (
    <div className="grid gap-4">
      <Panel
        title="Product Boardroom"
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
                {dashboard?.seed?.seedNonce !== undefined ? <Badge variant="muted">Seed {dashboard.seed.seedNonce}</Badge> : null}
              </div>
              <h1 className="m-0 text-2xl font-semibold tracking-normal text-zinc-50 sm:text-3xl">Boardroom Console</h1>
              <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                Project-level view of treasury balances, Boardroom-issued grants, and protocol obligations.
              </p>
            </div>
            {dashboard ? (
              <Button className="self-start" variant="secondary" onClick={() => openTools(dashboard.address)}>
                <ArrowRight className="h-4 w-4" />
                Open Tools
              </Button>
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
            { label: "Native balance", value: dashboard ? formatNativeBalance(dashboard.nativeBalance) : "Unknown" },
            { label: "Revenue assets", value: String(revenueAssets.filter((asset) => (asset.balance ?? 0n) > 0n).length) },
            { label: "Obligations", value: snapshot ? `${snapshot.issuedGrants.length} grants / ${snapshot.issuedDistributions.length} distributions / ${snapshot.lockedLiquidityPositions.length} lockers` : "Unknown" },
          ]}
        />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <TreasuryPanel assets={dashboard?.treasuryAssets ?? []} nativeBalance={dashboard?.nativeBalance} shareToken={snapshot?.shareToken} />
        <GrantHealthPanel grants={snapshot?.grantSummaries ?? []} stats={grantStats} inspectGrant={inspectGrant} />
      </div>

      <ObligationPanel
        distributions={snapshot?.distributionSummaries ?? []}
        lockers={snapshot?.lockedLiquiditySummaries ?? []}
      />
    </div>
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
  stats,
  inspectGrant,
}: {
  grants: BoardroomGrantSnapshot[];
  stats: ReturnType<typeof grantSummary>;
  inspectGrant: (grant: Address) => void;
}): React.JSX.Element {
  const summaryTokenMetadata = commonGrantTokenMetadata(grants);

  return (
    <Panel title="Issued Grants">
      <Facts
        columns="two"
        items={[
          { label: "Open", value: String(stats.open) },
          { label: "Closed", value: String(stats.closed) },
          { label: "Halted", value: String(stats.halted) },
          { label: "Read failures", value: String(stats.failed) },
          { label: "Grant size", value: formatTokenAmount(stats.grantSize, summaryTokenMetadata) },
          { label: "Settled", value: formatTokenAmount(stats.settled, summaryTokenMetadata) },
        ]}
      />
      {grants.length === 0 ? (
        <p className="m-0 border-t border-zinc-800 p-4 text-sm text-zinc-500">No Boardroom-issued grants.</p>
      ) : (
        <ol className="grid gap-px border-t border-zinc-800 bg-zinc-800">
          {grants.map((grant) => (
            <li className="bg-zinc-950 p-4" key={grant.address}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <AddressLink address={grant.address} />
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
                  { label: "Payment", value: grant.state && !isZeroGrantPayment(grant.state.paymentToken) ? <AddressLink address={grant.state.paymentToken} /> : "None" },
                  { label: "Expiry", value: dateString(grant.state?.expiry) },
                ]}
              />
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
