import type { Address } from "@pledge.cash/sdk";
import { ChevronDown, Download } from "lucide-react";
import type { ReactNode } from "react";
import { AddressLink } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  formatNativeBalance,
  formatTokenBalance,
  type ProductBoardroomChildCoverage,
  type ProductBoardroomDashboardState,
  type ProductBoardroomHistory,
  type ProductTreasuryAsset,
} from "../../lib/product-boardroom";
import { formatTokenAmount } from "../../lib/token-amounts";
import { createProjectEvidenceBundle, downloadProjectEvidenceBundle } from "../../lib/project-evidence";
import type {
  BoardroomDistributionSnapshot,
  BoardroomGrantSnapshot,
  BoardroomLockedLiquiditySnapshot,
} from "../../lib/types";
import {
  KeyValueList,
  PageNotice,
  RuledSection,
  SectionHeading,
  TableFrame,
  tableCellClassName,
  tableClassName,
  tableHeadClassName,
} from "./page-primitives";

export type TransparencyPageProps = {
  activityContent?: ReactNode;
  chainId: number;
  dashboard?: ProductBoardroomDashboardState | undefined;
  error?: string | undefined;
  grantHref?: ((grant: Address) => string) | undefined;
  loading: boolean;
  onOpenGrant?: ((grant: Address) => void) | undefined;
  technicalContent?: ReactNode;
};

export function TransparencyPage({
  activityContent,
  chainId,
  dashboard,
  error,
  grantHref,
  loading,
  onOpenGrant,
  technicalContent,
}: TransparencyPageProps): React.JSX.Element {
  if (loading && !dashboard) return <TransparencyLoading />;
  if (!dashboard) {
    return (
      <RuledSection>
        <PageNotice title="Transparency data is not loaded">
          Open a project to inspect its treasury, token supply, commitments, and protocol addresses.
        </PageNotice>
      </RuledSection>
    );
  }

  const snapshot = dashboard.snapshot;
  const shareAsset = dashboard.treasuryAssets.find((asset) => sameAddress(asset.address, snapshot.shareToken));
  const catalogEntry = dashboard.catalog.find((entry) => sameAddress(entry.address, dashboard.address));
  const histories = (dashboard.histories?.length ?? 0) > 0
    ? dashboard.histories ?? []
    : dashboard.history ? [dashboard.history] : [];
  const totals = transparencyTotals(dashboard);
  const treasuryAssetTypesKnown = dashboard.currentStateCoverage?.redeemableAssets.complete !== false
    && dashboard.treasuryAssets.every((asset) => !asset.error);
  const coverage = currentStateCoverageSummary(dashboard);

  return (
    <>
      <RuledSection>
        <SectionHeading
          title="Current state"
          description="A concise snapshot of treasury, supply, open commitments, liquidity, and evidence coverage. Lifetime activity is reported separately below."
          action={(
            <Button
              size="sm"
              type="button"
              variant="secondary"
              onClick={() => downloadProjectEvidenceBundle(createProjectEvidenceBundle(dashboard, chainId))}
            >
              <Download className="h-4 w-4" />
              Export evidence
            </Button>
          )}
        />
        {error ? <div className="mt-4"><PageNotice title="Some evidence could not be read" tone="danger">{error}</PageNotice></div> : null}
        <CurrentStateSummary
          items={[
            {
              label: "Treasury",
              value: formatNativeBalance(dashboard.nativeBalance),
              detail: treasuryAssetTypesKnown
                ? `${dashboard.treasuryAssets.length.toString()} ERC-20 asset ${dashboard.treasuryAssets.length === 1 ? "type" : "types"}`
                : "ERC-20 asset coverage is incomplete",
            },
            {
              label: "Project token supply",
              value: shareAsset?.totalSupply === undefined
                ? "Unknown"
                : formatTokenAmount(shareAsset.totalSupply, shareAsset),
            },
            {
              label: "Open commitments",
              value: formatTokenAmount(totals.unsettledShareGrantShares, snapshot.shareTokenMetadata),
              detail: totals.openGrantCount === undefined
                ? "Grant coverage is incomplete"
                : `${totals.openGrantCount.toString()} open ${totals.openGrantCount === 1 ? "grant" : "grants"}; ${formatTokenAmount(totals.distributionShares, snapshot.shareTokenMetadata)} in distribution reserves`,
            },
            {
              label: "Locked liquidity",
              value: coverageValue(dashboard.currentStateCoverage?.lockedLiquidity, snapshot.lockedLiquiditySummaries.length),
              detail: "Current Boardroom positions",
            },
            { label: "Evidence coverage", value: coverage.value, detail: coverage.detail },
          ]}
        />
      </RuledSection>

      <RuledSection>
        <SectionHeading
          title="Treasury and supply evidence"
          description="Current balances held by the Boardroom. Token supply is shown separately from treasury inventory."
        />
        <KeyValueList
          columns={4}
          items={[
            { label: "Native treasury", value: formatNativeBalance(dashboard.nativeBalance) },
            {
              label: "Project token supply",
              value: shareAsset?.totalSupply === undefined
                ? "Unknown"
                : formatTokenAmount(shareAsset.totalSupply, shareAsset),
            },
            {
              label: "Treasury asset types",
              value: treasuryAssetTypesKnown ? String(dashboard.treasuryAssets.length) : "Unknown",
              detail: treasuryAssetTypesKnown ? undefined : "Redeemable-asset coverage or an asset read is incomplete",
            },
            {
              label: "Redeemable assets",
              value: coverageValue(dashboard.currentStateCoverage?.redeemableAssets, snapshot.redeemableAssets.length),
              detail: coverageDetail(dashboard.currentStateCoverage?.redeemableAssets),
            },
          ]}
        />
        <TreasuryTable assets={dashboard.treasuryAssets} />
      </RuledSection>

      <RuledSection>
        <SectionHeading
          title="Open commitments"
          description="Tokens still owed through grants or reserved inside active distribution and liquidity contracts."
        />
        <KeyValueList
          columns={4}
          items={[
            { label: "Unsettled project-token grants", value: formatTokenAmount(totals.unsettledShareGrantShares, snapshot.shareTokenMetadata) },
            {
              label: "Open grants",
              value: totals.openGrantCount === undefined ? "Unknown" : String(totals.openGrantCount),
              detail: coverageDetail(dashboard.currentStateCoverage?.grants),
            },
            {
              label: "Distribution reserves",
              value: formatTokenAmount(totals.distributionShares, snapshot.shareTokenMetadata),
              detail: coverageDetail(dashboard.currentStateCoverage?.distributions),
            },
            {
              label: "Locked liquidity positions",
              value: coverageValue(dashboard.currentStateCoverage?.lockedLiquidity, snapshot.lockedLiquiditySummaries.length),
              detail: coverageDetail(dashboard.currentStateCoverage?.lockedLiquidity),
            },
          ]}
        />
      </RuledSection>

      <RuledSection>
        <SectionHeading title="Grants" description="Issued token commitments, their holders, and settlement progress." />
        <CoverageStatement coverage={dashboard.currentStateCoverage?.grants} label="grant" />
        <GrantTable grants={snapshot.grantSummaries} grantHref={grantHref} onOpenGrant={onOpenGrant} />
      </RuledSection>

      <RuledSection>
        <SectionHeading title="Distributions" description="Sale, curve, and airdrop contracts still tracked by the Boardroom. Closed or migrated routes remain visible through onchain history." />
        <CoverageStatement coverage={dashboard.currentStateCoverage?.distributions} label="distribution" />
        <DistributionTable distributions={snapshot.distributionSummaries} />
      </RuledSection>

      {histories.length > 0 || catalogEntry?.distribution ? (
        <RuledSection>
          <SectionHeading title="Lifetime participation history" description="Cumulative onchain activity is separate from the current-state snapshot. Each bond, sale, curve, airdrop, and migrated market stays separate so incompatible quote and payment tokens are never added together." />
          <div className="mt-4 divide-y divide-zinc-800 border-y border-zinc-800">
            {(histories.length > 0 ? histories : [{
              buyerCount: catalogEntry?.buyerCount,
              cashRaised: catalogEntry?.cashRaised,
              distribution: catalogEntry?.distribution,
              soldShares: catalogEntry?.soldShares,
            }]).map((history, index) => (
              <ParticipationHistoryRow
                dashboard={dashboard}
                history={history}
                key={history.distribution ?? `history-${index.toString()}`}
              />
            ))}
          </div>
        </RuledSection>
      ) : null}

      <RuledSection>
        <SectionHeading title="Current liquidity positions" description="Positions the Boardroom currently has locked for project market liquidity." />
        <CoverageStatement coverage={dashboard.currentStateCoverage?.lockedLiquidity} label="locked-liquidity position" />
        <LiquidityTable lockers={snapshot.lockedLiquiditySummaries} />
      </RuledSection>

      {activityContent ? (
        <RuledSection>
          <SectionHeading title="Onchain activity" description="Observed project events, presented separately from current balances." />
          <div className="mt-4">{activityContent}</div>
        </RuledSection>
      ) : null}

      <RuledSection>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-1 text-sm font-semibold text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300/70">
            Technical details
            <ChevronDown className="h-4 w-4 text-zinc-500 transition-transform group-open:rotate-180" />
          </summary>
          <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
            Contract addresses and raw counts for independent verification. These details do not change who has authority.
          </p>
          <KeyValueList
            columns={3}
            items={[
              { label: "Boardroom", value: <AddressLink address={dashboard.address} /> },
              { label: "Policy registry", value: <AddressLink address={snapshot.policyRegistry} /> },
              { label: "Wrapped native", value: <AddressLink address={snapshot.wrappedNative} /> },
              { label: "Share token", value: <AddressLink address={snapshot.shareToken} /> },
              {
                label: "Grant provenance records",
                value: snapshot.grantRecordCount === undefined ? "Unavailable" : String(snapshot.grantRecordCount),
              },
              {
                label: "Distribution provenance records",
                value: String(snapshot.distributionRecordCount),
                detail: "Closed, removed, or migrated distribution records shown above remain separate historical evidence.",
              },
            ]}
          />
          {technicalContent ? <div className="mt-5 border-t border-zinc-800 pt-5">{technicalContent}</div> : null}
        </details>
      </RuledSection>
    </>
  );
}

function CurrentStateSummary({
  items,
}: {
  items: readonly { detail?: ReactNode; label: string; value: ReactNode }[];
}): React.JSX.Element {
  return (
    <dl
      aria-label="Current treasury, supply, commitments, liquidity, and coverage summary"
      className="mt-5 grid border-y border-zinc-800 sm:grid-cols-2 xl:grid-cols-5"
    >
      {items.map((item) => (
        <div className="min-w-0 border-b border-zinc-800 py-4 sm:px-4 xl:border-b-0 xl:border-r xl:last:border-r-0" key={item.label}>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{item.label}</dt>
          <dd className="m-0 mt-1 break-words text-base font-semibold text-zinc-100">{item.value}</dd>
          {item.detail ? <dd className="m-0 mt-1 text-xs leading-5 text-zinc-500">{item.detail}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

function currentStateCoverageSummary(dashboard: ProductBoardroomDashboardState): { detail: string; value: string } {
  const coverage = dashboard.currentStateCoverage;
  const failedAssetReads = dashboard.treasuryAssets.filter((asset) => Boolean(asset.error)).length;
  if (!coverage) {
    return {
      detail: failedAssetReads > 0
        ? `${failedAssetReads.toString()} treasury asset ${failedAssetReads === 1 ? "read is" : "reads are"} unknown.`
        : "Coverage bounds were not attached; evidence tables remain available below.",
      value: failedAssetReads > 0 ? "Partial" : "Not reported",
    };
  }

  const coverageEntries: readonly [string, ProductBoardroomChildCoverage][] = [
    ["redeemable assets", coverage.redeemableAssets],
    ["grants", coverage.grants],
    ["distributions", coverage.distributions],
    ["liquidity", coverage.lockedLiquidity],
  ];
  const incomplete = coverageEntries.filter(([, item]) => !item.complete);
  if (incomplete.length === 0 && failedAssetReads === 0) {
    return { detail: "All bounded current-state records were read.", value: "Complete" };
  }

  const missingLabels = incomplete.map(([label, item]) => `${label} ${item.shown.toString()} of ${item.total.toString()}`);
  if (failedAssetReads > 0) missingLabels.push(`${failedAssetReads.toString()} treasury ${failedAssetReads === 1 ? "read" : "reads"} failed`);
  return { detail: `${missingLabels.join("; ")}. Missing records remain unknown.`, value: "Partial" };
}

function ParticipationHistoryRow({
  dashboard,
  history,
}: {
  dashboard: ProductBoardroomDashboardState;
  history: ProductBoardroomHistory;
}): React.JSX.Element {
  const distribution = dashboard.snapshot.distributionSummaries.find((entry) =>
    sameAddress(entry.address, history.distribution));
  const cashMetadata = distribution?.state && "paymentToken" in distribution.state
    ? distribution.paymentTokenMetadata
    : distribution?.state && "quoteToken" in distribution.state
      ? distribution.quoteTokenMetadata
      : undefined;
  const route = distribution ? distributionKindLabel(distribution.kind) : "Onchain distribution";

  return (
    <div className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="m-0 text-sm font-semibold text-zinc-100">{route}</h3>
        {history.completeness === "partial" || history.scanError
          ? <Badge variant="danger">Partial history</Badge>
          : history.completeness === "state-derived"
            ? <Badge variant="muted">State-derived totals</Badge>
            : history.completeness === "complete"
              ? <Badge variant="muted">Complete event history</Badge>
              : <Badge variant="warning">Completeness unknown</Badge>}
      </div>
      {history.amm || history.pool || history.curve?.migration ? (
        <p className="m-0 mt-3 border-l-2 border-zinc-700 pl-3 text-xs leading-5 text-zinc-400">
          Lifetime AMM activity is event-derived. 24h market data is not indexed, so 24h volume and price change are not shown.
        </p>
      ) : null}
      <KeyValueList
        columns={4}
        items={[
          { label: "Tokens allocated", value: formatTokenAmount(history.soldShares, dashboard.snapshot.shareTokenMetadata) },
          {
            label: "Capital raised",
            value: history.cashRaised === undefined
              ? definitiveNotApplicable(history, distribution?.kind === "merkle-airdrop")
              : formatTokenAmount(history.cashRaised, cashMetadata),
          },
          { label: "Buyers", value: history.buyerCount === undefined ? "Unknown" : String(history.buyerCount) },
          {
            label: "Purchases",
            value: historyCount(
              history,
              history.fixedPriceSale?.purchaseCount ?? history.curve?.buyCount,
              distribution?.kind === "merkle-airdrop",
            ),
          },
          {
            label: "Curve sells",
            value: historyCount(
              history,
              history.curve?.sellCount,
              distribution !== undefined && distribution.kind !== "migrating-bonding-curve",
            ),
          },
          { label: "AMM swaps", value: historyCount(history, history.amm?.swapCount, !history.pool && !history.curve?.migration) },
          { label: "Unique pool callers", value: historyCount(history, history.amm?.traderCount, !history.pool && !history.curve?.migration) },
          { label: "Distribution", value: history.distribution ? <AddressLink address={history.distribution} /> : "Unknown" },
        ]}
      />
      {history.scanError ? (
        <p className="m-0 mt-3 text-xs leading-5 text-red-300">
          {history.scanError} Unknown fields are not treated as zero.
        </p>
      ) : null}
    </div>
  );
}

function historyCount(
  history: ProductBoardroomHistory,
  value: number | undefined,
  notApplicable: boolean,
): string {
  if (value !== undefined) return value.toString();
  if (history.completeness === "partial" || history.scanError) return "Unknown";
  return notApplicable ? "Not applicable" : "Unknown";
}

function definitiveNotApplicable(history: ProductBoardroomHistory, notApplicable: boolean): string {
  if (history.completeness === "partial" || history.scanError) return "Unknown";
  return notApplicable ? "Not applicable" : "Unknown";
}

function TreasuryTable({ assets }: { assets: readonly ProductTreasuryAsset[] }): React.JSX.Element {
  if (assets.length === 0) return <EmptyTable label="No ERC-20 treasury assets were read." />;
  return (
    <TableFrame label="Treasury assets">
      <table className={tableClassName}>
        <thead className={tableHeadClassName}>
          <tr><th className={tableCellClassName} scope="col">Asset</th><th className={tableCellClassName} scope="col">Contract</th><th className={tableCellClassName} scope="col">Treasury balance</th><th className={tableCellClassName} scope="col">Total supply</th></tr>
        </thead>
        <tbody>
          {assets.map((asset) => (
            <tr key={asset.address}>
              <th className={tableCellClassName} scope="row"><span className="font-semibold text-zinc-100">{asset.symbol ?? asset.label}</span><span className="mt-1 block text-xs font-normal text-zinc-500">{asset.label}</span></th>
              <td className={tableCellClassName}><AddressLink address={asset.address} /></td>
              <td className={tableCellClassName}>{asset.error ? <span className="text-red-200">Read failed</span> : formatTokenBalance(asset)}</td>
              <td className={tableCellClassName}>{asset.totalSupply === undefined ? "Unknown" : formatTokenAmount(asset.totalSupply, asset)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

function GrantTable({
  grants,
  grantHref,
  onOpenGrant,
}: {
  grants: readonly BoardroomGrantSnapshot[];
  grantHref?: ((grant: Address) => string) | undefined;
  onOpenGrant?: ((grant: Address) => void) | undefined;
}): React.JSX.Element {
  if (grants.length === 0) return <EmptyTable label="No grants have been issued by this Boardroom." />;
  return (
    <TableFrame label="Issued grants">
      <table className={tableClassName}>
        <thead className={tableHeadClassName}>
          <tr><th className={tableCellClassName} scope="col">Grant</th><th className={tableCellClassName} scope="col">Holder</th><th className={tableCellClassName} scope="col">Committed</th><th className={tableCellClassName} scope="col">Settled</th><th className={tableCellClassName} scope="col">Status</th></tr>
        </thead>
        <tbody>
          {grants.map((grant) => (
            <tr key={grant.address}>
              <th className={tableCellClassName} scope="row">
                <div className="flex flex-wrap items-center gap-2">
                  <AddressLink address={grant.address} />
                  {grantHref ? (
                    <a
                      className="inline-flex min-h-10 items-center rounded-md px-2 text-xs font-semibold text-lime-300 transition-colors hover:bg-zinc-900 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300/70"
                      href={grantHref(grant.address)}
                      onClick={(event) => {
                        if (!onOpenGrant || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                        event.preventDefault();
                        onOpenGrant(grant.address);
                      }}
                    >
                      View grant
                    </a>
                  ) : null}
                </div>
                {grant.error ? <span className="mt-1 block text-xs font-normal text-red-200">Read failed</span> : null}
              </th>
              <td className={tableCellClassName}>{grant.state ? <AddressLink address={grant.state.holder} /> : "Unknown"}</td>
              <td className={tableCellClassName}>{formatTokenAmount(grant.state?.grantSize, grant.tokenMetadata)}</td>
              <td className={tableCellClassName}>{formatTokenAmount(grant.state?.settledAmount, grant.tokenMetadata)}</td>
              <td className={tableCellClassName}><GrantStatus grant={grant} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

function DistributionTable({ distributions }: { distributions: readonly BoardroomDistributionSnapshot[] }): React.JSX.Element {
  if (distributions.length === 0) return <EmptyTable label="No active distribution contracts are currently tracked. Closed or migrated routes may still appear in onchain history." />;
  return (
    <TableFrame label="Token distributions">
      <table className={tableClassName}>
        <thead className={tableHeadClassName}>
          <tr><th className={tableCellClassName} scope="col">Type</th><th className={tableCellClassName} scope="col">Contract</th><th className={tableCellClassName} scope="col">Originally allocated</th><th className={tableCellClassName} scope="col">Remaining</th><th className={tableCellClassName} scope="col">Status</th></tr>
        </thead>
        <tbody>
          {distributions.map((distribution) => (
            <tr key={distribution.address}>
              <th className={tableCellClassName} scope="row"><span className="font-semibold text-zinc-100">{distributionKindLabel(distribution.kind)}</span></th>
              <td className={tableCellClassName}><AddressLink address={distribution.address} />{distribution.error ? <span className="mt-1 block text-xs text-red-200">Read failed</span> : null}</td>
              <td className={tableCellClassName}>{formatTokenAmount(distributionAllocated(distribution), distribution.shareTokenMetadata)}</td>
              <td className={tableCellClassName}>{formatTokenAmount(distributionRemaining(distribution), distribution.shareTokenMetadata)}</td>
              <td className={tableCellClassName}><DistributionStatus distribution={distribution} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

function LiquidityTable({ lockers }: { lockers: readonly BoardroomLockedLiquiditySnapshot[] }): React.JSX.Element {
  if (lockers.length === 0) return <EmptyTable label="No locked liquidity positions were read." />;
  return (
    <TableFrame label="Locked liquidity positions">
      <table className={tableClassName}>
        <thead className={tableHeadClassName}>
          <tr><th className={tableCellClassName} scope="col">Locker</th><th className={tableCellClassName} scope="col">Pool</th><th className={tableCellClassName} scope="col">Locked LP</th><th className={tableCellClassName} scope="col">Claimable token A</th><th className={tableCellClassName} scope="col">Claimable token B</th></tr>
        </thead>
        <tbody>
          {lockers.map((locker) => (
            <tr key={locker.address}>
              <th className={tableCellClassName} scope="row"><AddressLink address={locker.address} />{locker.error ? <span className="mt-1 block text-xs font-normal text-red-200">Read failed</span> : null}</th>
              <td className={tableCellClassName}>{locker.state?.pool ? <AddressLink address={locker.state.pool} /> : "Unknown"}</td>
              <td className={tableCellClassName}>{formatTokenAmount(locker.state?.lockedLiquidity, locker.liquidityMetadata)}</td>
              <td className={tableCellClassName}>{formatTokenAmount(locker.claimableA, locker.tokenAMetadata)}</td>
              <td className={tableCellClassName}>{formatTokenAmount(locker.claimableB, locker.tokenBMetadata)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

function EmptyTable({ label }: { label: string }): React.JSX.Element {
  return <p className="m-0 mt-4 border-y border-zinc-800 py-5 text-sm text-zinc-500">{label}</p>;
}

function CoverageStatement({
  coverage,
  label,
}: {
  coverage: ProductBoardroomChildCoverage | undefined;
  label: string;
}): React.JSX.Element | null {
  if (!coverage || coverage.complete) return null;
  const recordLabel = `${label}${coverage.total === 1 ? " record" : " records"}`;
  return (
    <p className="m-0 mt-3 text-xs leading-5 text-amber-200">
      {`Current-state coverage: ${coverage.shown.toString()} of ${coverage.total.toString()} ${recordLabel} read. Missing records remain unknown.`}
    </p>
  );
}

function GrantStatus({ grant }: { grant: BoardroomGrantSnapshot }): React.JSX.Element {
  if (grant.error || !grant.state) return <Badge variant="danger">Read issue</Badge>;
  if (grant.state.quarantined) return <Badge variant="danger">Quarantined</Badge>;
  if (grant.state.halted) return <Badge variant="warning">Halted</Badge>;
  if (grant.state.closed) return <Badge variant="muted">Closed</Badge>;
  if (grant.state.expired) return <Badge variant="warning">Expired</Badge>;
  return <Badge variant="default">Open</Badge>;
}

function DistributionStatus({ distribution }: { distribution: BoardroomDistributionSnapshot }): React.JSX.Element {
  if (distribution.error || !distribution.state) return <Badge variant="danger">Read issue</Badge>;
  if ("live" in distribution.state) {
    if (distribution.state.closed) return <Badge variant="muted">Settled</Badge>;
    if (distribution.state.live) return <Badge variant="default">Live</Badge>;
    return <Badge variant={distribution.state.status === 0 ? "warning" : "muted"}>{distribution.state.status === 0 ? "Scheduled / concluded" : "Claims pending"}</Badge>;
  }
  const status = "saleStatus" in distribution.state
    ? distribution.state.saleStatus
    : "curveStatus" in distribution.state
      ? distribution.state.curveStatus
      : distribution.state.airdropStatus;
  if (status === 0 && !distribution.state.closed) return <Badge variant="default">Active</Badge>;
  if (status === 2) return <Badge variant="warning">Cancelled</Badge>;
  return <Badge variant="muted">Closed</Badge>;
}

function transparencyTotals(dashboard: ProductBoardroomDashboardState): {
  distributionShares?: bigint | undefined;
  openGrantCount?: number | undefined;
  unsettledShareGrantShares?: bigint | undefined;
} {
  const snapshot = dashboard.snapshot;
  const grants = snapshot.grantSummaries;
  const distributions = snapshot.distributionSummaries;
  const grantsComplete = dashboard.currentStateCoverage?.grants.complete !== false
    && grants.every((grant) => Boolean(grant.state) && !grant.error);
  const distributionsComplete = dashboard.currentStateCoverage?.distributions.complete !== false
    && distributions.every((distribution) => Boolean(distribution.state) && !distribution.error);

  return {
    ...(distributionsComplete ? { distributionShares: distributions.reduce(
      (total, distribution) => total + (distributionIsOpen(distribution) ? distributionRemaining(distribution) ?? 0n : 0n),
      0n,
    ) } : {}),
    ...(grantsComplete ? {
      openGrantCount: grants.filter((grant) => grant.state && !grant.state.closed).length,
      unsettledShareGrantShares: grants.reduce((total, grant) =>
        total + (sameAddress(grant.state?.token, snapshot.shareToken) ? grant.state?.unsettledAmount ?? 0n : 0n), 0n),
    } : {}),
  };
}

function coverageValue(coverage: ProductBoardroomChildCoverage | undefined, fallback: number): string {
  if (!coverage) return fallback.toString();
  return coverage.complete ? coverage.total.toString() : "Unknown";
}

function coverageDetail(coverage: ProductBoardroomChildCoverage | undefined): string | undefined {
  if (!coverage || coverage.complete) return undefined;
  return `${coverage.shown.toString()} of ${coverage.total.toString()} records read`;
}

function distributionIsOpen(distribution: BoardroomDistributionSnapshot): boolean {
  if (!distribution.state || distribution.state.closed) return false;
  if ("saleStatus" in distribution.state) return distribution.state.saleStatus === 0;
  if ("curveStatus" in distribution.state) return distribution.state.curveStatus === 0;
  if ("currentPrice" in distribution.state) return distribution.state.live;
  return distribution.state.airdropStatus === 0;
}

function distributionAllocated(distribution: BoardroomDistributionSnapshot): bigint | undefined {
  if (!distribution.state) return undefined;
  if ("saleSupply" in distribution.state) return distribution.state.saleSupply;
  if ("airdropSupply" in distribution.state) return distribution.state.airdropSupply;
  if ("currentPrice" in distribution.state) return distribution.state.initialCapacity;
  return undefined;
}

function distributionRemaining(distribution: BoardroomDistributionSnapshot): bigint | undefined {
  if (!distribution.state) return undefined;
  if ("remainingSaleShares" in distribution.state) return distribution.state.remainingSaleShares;
  if ("remainingShares" in distribution.state) return distribution.state.remainingShares;
  if ("currentPrice" in distribution.state) return distribution.state.capacity;
  return undefined;
}

function distributionKindLabel(kind: BoardroomDistributionSnapshot["kind"]): string {
  if (kind === "bond-market") return "Bond market";
  if (kind === "dutch-auction") return "Dutch auction";
  if (kind === "fixed-price-sale") return "Fixed-price sale";
  if (kind === "migrating-bonding-curve") return "Bonding curve";
  if (kind === "merkle-airdrop") return "Airdrop";
  return "Unknown distribution";
}

function TransparencyLoading(): React.JSX.Element {
  return (
    <div aria-label="Loading transparency data" aria-live="polite" className="grid animate-pulse gap-5 py-6" role="status">
      <span className="h-40 rounded bg-zinc-900" />
      <span className="h-56 rounded bg-zinc-900" />
      <span className="h-56 rounded bg-zinc-900" />
    </div>
  );
}

function sameAddress(first: Address | undefined, second: Address | undefined): boolean {
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase());
}
