import type { Address } from "@pledge.cash/sdk";
import { ArrowRight, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { AddressLink } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button, ButtonLink } from "../../components/ui/button";
import { shortAddress } from "../../lib/forms";
import {
  formatNativeBalance,
  formatTokenBalance,
  type ProductBoardroomChildCoverage,
  type ProductBoardroomCatalogEntry,
  type ProductBoardroomDashboardState,
} from "../../lib/product-boardroom";
import { formatTokenAmount } from "../../lib/token-amounts";
import { cn } from "../../lib/utils";
import { KeyValueList, PageNotice, RuledSection, SectionHeading } from "./page-primitives";

export type ProjectSection = "overview" | "participate" | "governance" | "transparency";

export type ProjectLayoutProps = {
  account?: Address | undefined;
  activeSection: ProjectSection;
  children: ReactNode;
  chainName: string;
  dashboard?: ProductBoardroomDashboardState | undefined;
  error?: string | undefined;
  loading: boolean;
  mastheadAction?: ReactNode;
  onNavigateSection: (section: ProjectSection) => void;
  onRetry?: (() => void) | undefined;
  projectName?: string | undefined;
  sectionHref?: ((section: ProjectSection) => string) | undefined;
};

const projectSections: readonly { label: string; mobileLabel: string; value: ProjectSection }[] = [
  { label: "Overview", mobileLabel: "Overview", value: "overview" },
  { label: "Participate", mobileLabel: "Join", value: "participate" },
  { label: "Governance", mobileLabel: "Govern", value: "governance" },
  { label: "Transparency", mobileLabel: "Details", value: "transparency" },
];

export function ProjectLayout({
  account,
  activeSection,
  chainName,
  children,
  dashboard,
  error,
  loading,
  mastheadAction,
  onNavigateSection,
  onRetry,
  projectName,
  sectionHref,
}: ProjectLayoutProps): React.JSX.Element {
  const snapshot = dashboard?.snapshot;
  const catalogEntry = selectedCatalogEntry(dashboard);
  const name = projectName ?? catalogEntry?.name ?? catalogEntry?.symbol ?? (loading ? "Loading project" : "Project");
  const lifecycle = boardroomLifecycle(snapshot?.status);
  const role = projectRole(account, dashboard);
  const incompleteCoverage = currentStateCoverageRows(dashboard)
    .filter((entry) => !entry.coverage.complete);

  return (
    <div>
      <header className="border-b border-zinc-800 pb-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant={lifecycle.tone}>{lifecycle.label}</Badge>
              <Badge variant={role.tone}>{role.label}</Badge>
              <span className="text-xs text-zinc-600">{chainName}</span>
            </div>
            <h1 className="m-0 truncate text-3xl font-semibold tracking-[-0.03em] text-zinc-50 sm:text-5xl">{name}</h1>
            <p className="m-0 mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
              {snapshot
                ? `${snapshot.launched ? "Holder governance is live." : "Holder governance has not launched; the owner still manages project changes directly."} Participation can be live independently. Current state is read from the Boardroom and the contracts it coordinates; lifetime activity is reconstructed from their onchain event history.`
                : "Read a project’s state, participation paths, governance, and treasury evidence in one place."}
            </p>
            {dashboard ? <p className="m-0 mt-2 font-mono text-xs text-zinc-600">{shortAddress(dashboard.address)}</p> : null}
          </div>
          {mastheadAction ? <div className="flex shrink-0 flex-wrap gap-2">{mastheadAction}</div> : null}
        </div>
      </header>

      <nav aria-label="Project" className="grid grid-cols-4 border-b border-zinc-800 md:flex md:gap-1">
        {projectSections.map((section) => {
          const className = cn(
            "relative min-h-12 min-w-0 px-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime-300/70 md:shrink-0 md:px-3 md:text-sm",
            activeSection === section.value
              ? "text-zinc-50 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-lime-300"
              : "text-zinc-500 hover:text-zinc-200",
          );
          const href = sectionHref?.(section.value);
          return href ? (
            <a
              aria-current={activeSection === section.value ? "page" : undefined}
              className={className}
              href={href}
              key={section.value}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onNavigateSection(section.value);
              }}
            >
              <span className="md:hidden">{section.mobileLabel}</span><span className="hidden md:inline">{section.label}</span>
            </a>
          ) : (
            <button
              aria-current={activeSection === section.value ? "page" : undefined}
              className={className}
              key={section.value}
              type="button"
              onClick={() => onNavigateSection(section.value)}
            >
              <span className="md:hidden">{section.mobileLabel}</span><span className="hidden md:inline">{section.label}</span>
            </button>
          );
        })}
      </nav>

      {error ? (
        <div className="pt-5">
          <PageNotice title="Some project data could not be read" tone="danger">
            <p className="m-0">{error}</p>
            {onRetry ? <Button className="mt-3" size="sm" variant="secondary" onClick={onRetry}>Try again</Button> : null}
          </PageNotice>
        </div>
      ) : null}
      {!error && incompleteCoverage.length > 0 ? (
        <div className="pt-5">
          <PageNotice title="Current contract-state detail is incomplete" tone="warning">
            <p className="m-0">Counts remain onchain facts, but some child records could not be hydrated in this bounded browser read.</p>
            <ul className="m-0 mt-2 list-none space-y-1 p-0">
              {incompleteCoverage.map(({ coverage, label }) => (
                <li key={label}>{`${label}: ${coverage.shown.toString()} of ${coverage.total.toString()} records read.`}</li>
              ))}
            </ul>
            {onRetry ? <Button className="mt-3" size="sm" variant="secondary" onClick={onRetry}>Retry current state</Button> : null}
          </PageNotice>
        </div>
      ) : null}
      {!error && dashboard?.historyErrors?.length ? (
        <div className="pt-5">
          <PageNotice title="Historical activity is incomplete" tone="warning">
            <p className="m-0">Current balances and contract state are available, but some event-derived totals may be partial.</p>
            {onRetry ? <Button className="mt-3" size="sm" variant="secondary" onClick={onRetry}>Retry history</Button> : null}
          </PageNotice>
        </div>
      ) : null}
      <div aria-busy={loading}>{children}</div>
    </div>
  );
}

export type ProjectOverviewPageProps = {
  account?: Address | undefined;
  activity?: ReactNode;
  dashboard?: ProductBoardroomDashboardState | undefined;
  loading: boolean;
  nextAction?: ReactNode;
  onOpenParticipation?: (() => void) | undefined;
  participationHref?: string | undefined;
  onRefresh?: (() => void) | undefined;
};

export function ProjectOverviewPage({
  account,
  activity,
  dashboard,
  loading,
  nextAction,
  onOpenParticipation,
  participationHref,
  onRefresh,
}: ProjectOverviewPageProps): React.JSX.Element {
  const snapshot = dashboard?.snapshot;
  const shareAsset = dashboard?.treasuryAssets.find((asset) => sameAddress(asset.address, snapshot?.shareToken));
  const cashAssets = dashboard?.treasuryAssets.filter((asset) => !sameAddress(asset.address, snapshot?.shareToken)) ?? [];
  const commitments = commitmentSummary(dashboard);
  const hasParticipation = (commitments.openDistributions ?? 0) > 0;

  if (loading && !dashboard) {
    return <OverviewLoading />;
  }

  if (!dashboard || !snapshot) {
    return (
      <RuledSection>
        <PageNotice title="No project loaded">
          Choose a project from Explore or enter a Boardroom address in Studio.
        </PageNotice>
      </RuledSection>
    );
  }

  return (
    <>
      <RuledSection>
        <SectionHeading
          title="What needs attention"
          description="The most useful next step for this wallet and this project."
          action={onRefresh ? (
            <Button size="sm" variant="ghost" onClick={onRefresh}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          ) : undefined}
        />
        <div className="mt-4 grid gap-4 border-l-2 border-lime-300 bg-zinc-900/35 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className="m-0 text-base font-semibold text-zinc-50">{nextActionLabel(account, dashboard, hasParticipation)}</p>
            <p className="m-0 mt-1 max-w-2xl text-sm leading-6 text-zinc-400">{nextActionDescription(account, dashboard, hasParticipation)}</p>
          </div>
          {nextAction ?? (hasParticipation && onOpenParticipation ? (
            participationHref ? (
              <ButtonLink
                href={participationHref}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onOpenParticipation();
                }}
              >
                View participation
                <ArrowRight className="h-4 w-4" />
              </ButtonLink>
            ) : <Button onClick={onOpenParticipation}>
                View participation
                <ArrowRight className="h-4 w-4" />
              </Button>
          ) : null)}
        </div>
      </RuledSection>

      <RuledSection>
        <SectionHeading title="Project state" description="A compact read of authority, supply, treasury, and open obligations." />
        <KeyValueList
          columns={4}
          items={[
            { label: "Boardroom", value: <AddressLink address={dashboard.address} /> },
            { label: "Owner", value: <AddressLink address={snapshot.owner} /> },
            { label: "Project token", value: <AddressLink address={snapshot.shareToken} /> },
            { label: "Lifecycle", value: boardroomLifecycle(snapshot.status).label },
            { label: "Native treasury", value: formatNativeBalance(dashboard.nativeBalance) },
            {
              label: "Token supply",
              value: shareAsset?.totalSupply === undefined
                ? "Unknown"
                : formatTokenBalance({ ...shareAsset, balance: shareAsset.totalSupply }),
            },
            {
              label: "Open grants",
              value: commitments.openGrants === undefined ? "Unknown" : String(commitments.openGrants),
              detail: commitments.unsettledGrants === undefined
                ? coverageDetail(dashboard.currentStateCoverage?.grants)
                : `${commitments.unsettledGrants} unsettled project tokens`,
            },
            {
              label: "Participation routes",
              value: commitments.openDistributions === undefined ? "Unknown" : String(commitments.openDistributions),
              detail: commitments.openDistributions === undefined
                ? coverageDetail(dashboard.currentStateCoverage?.distributions)
                : undefined,
            },
          ]}
        />
      </RuledSection>

      <RuledSection>
        <SectionHeading title="Treasury at a glance" description="Non-share assets currently held by the Boardroom." />
        {cashAssets.length === 0 ? (
          <p className="m-0 mt-4 text-sm text-zinc-500">No non-share treasury assets were read.</p>
        ) : (
          <ul className="m-0 mt-4 list-none border-t border-zinc-800 p-0">
            {cashAssets.map((asset) => (
              <li className="grid gap-2 border-b border-zinc-800 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={asset.address}>
                <div className="min-w-0">
                  <p className="m-0 text-sm font-semibold text-zinc-200">{asset.label}</p>
                  <div className="mt-1 text-xs"><AddressLink address={asset.address} /></div>
                </div>
                <p className="m-0 text-sm font-semibold text-zinc-50">{formatTokenBalance(asset)}</p>
              </li>
            ))}
          </ul>
        )}
      </RuledSection>

      {activity ? (
        <RuledSection>
          <SectionHeading title="Recent activity" description="Protocol events and wallet actions relevant to this project." />
          <div className="mt-4">{activity}</div>
        </RuledSection>
      ) : null}
    </>
  );
}

export function selectedCatalogEntry(
  dashboard: ProductBoardroomDashboardState | undefined,
): ProductBoardroomCatalogEntry | undefined {
  return dashboard?.catalog.find((entry) => sameAddress(entry.address, dashboard.address));
}

export function boardroomLifecycle(status: number | undefined): {
  label: string;
  tone: "default" | "muted" | "warning";
} {
  if (status === 0) return { label: "Active", tone: "default" };
  if (status === 1) return { label: "Winding down", tone: "warning" };
  if (status === 2) return { label: "Redemptions open", tone: "muted" };
  return { label: "Status unknown", tone: "muted" };
}

function OverviewLoading(): React.JSX.Element {
  return (
    <div aria-live="polite" className="grid animate-pulse gap-6 py-6" role="status">
      <span className="h-24 rounded bg-zinc-900" />
      <span className="h-40 rounded bg-zinc-900" />
      <span className="h-28 rounded bg-zinc-900" />
      <span className="sr-only">Loading project overview</span>
    </div>
  );
}

function projectRole(
  account: Address | undefined,
  dashboard: ProductBoardroomDashboardState | undefined,
): { label: string; tone: "default" | "muted" | "warning" } {
  if (!account) return { label: "Read-only", tone: "muted" };
  if (!dashboard) return { label: "Wallet connected", tone: "muted" };
  if (sameAddress(account, dashboard.snapshot.owner)) return { label: "Owner", tone: "warning" };
  if (dashboard.snapshot.grantSummaries.some((grant) => sameAddress(account, grant.state?.holder))) {
    return { label: "Grant holder", tone: "default" };
  }
  return { label: "Holder view", tone: "muted" };
}

function commitmentSummary(dashboard: ProductBoardroomDashboardState | undefined): {
  openDistributions?: number | undefined;
  openGrants?: number | undefined;
  unsettledGrants?: string | undefined;
} {
  const grantAddresses = new Set(dashboard?.snapshot.issuedGrants.map((address) => address.toLowerCase()) ?? []);
  const distributionAddresses = new Set(
    dashboard?.snapshot.issuedDistributions.map((address) => address.toLowerCase()) ?? [],
  );
  const grants = dashboard?.snapshot.grantSummaries.filter((grant) =>
    grantAddresses.has(grant.address.toLowerCase())) ?? [];
  const distributions = dashboard?.snapshot.distributionSummaries.filter((distribution) =>
    distributionAddresses.has(distribution.address.toLowerCase())) ?? [];
  const unsettled = grants.reduce((total, grant) =>
    total + (sameAddress(grant.state?.token, dashboard?.snapshot.shareToken) ? grant.state?.unsettledAmount ?? 0n : 0n), 0n);
  const hasAmm = Boolean(
    dashboard?.histories?.find((history) => history.pool)?.pool
    ?? dashboard?.history?.pool
    ?? selectedCatalogEntry(dashboard)?.pool,
  );
  const grantsComplete = Boolean(dashboard)
    && dashboard?.currentStateCoverage?.grants.complete !== false
    && grants.every((grant) => Boolean(grant.state) && !grant.error);
  const distributionsComplete = Boolean(dashboard)
    && dashboard?.currentStateCoverage?.distributions.complete !== false
    && distributions.every((distribution) => Boolean(distribution.state) && !distribution.error);
  return {
    ...(distributionsComplete
      ? { openDistributions: distributions.filter(distributionIsActive).length + (hasAmm ? 1 : 0) }
      : {}),
    ...(grantsComplete ? {
      openGrants: grants.filter((grant) => grant.state && !grant.state.closed).length,
      unsettledGrants: formatTokenAmount(unsettled, dashboard?.snapshot.shareTokenMetadata),
    } : {}),
  };
}

function currentStateCoverageRows(
  dashboard: ProductBoardroomDashboardState | undefined,
): Array<{ coverage: ProductBoardroomChildCoverage; label: string }> {
  const coverage = dashboard?.currentStateCoverage;
  if (!coverage) return [];
  return [
    { coverage: coverage.grants, label: "Grants" },
    { coverage: coverage.distributions, label: "Distributions" },
    { coverage: coverage.lockedLiquidity, label: "Locked liquidity" },
    { coverage: coverage.redeemableAssets, label: "Redeemable assets" },
  ];
}

function coverageDetail(coverage: ProductBoardroomChildCoverage | undefined): string | undefined {
  if (!coverage || coverage.complete) return undefined;
  return `${coverage.shown.toString()} of ${coverage.total.toString()} records read`;
}

function distributionIsActive(distribution: ProductBoardroomDashboardState["snapshot"]["distributionSummaries"][number]): boolean {
  if (!distribution.state || distribution.state.closed) return false;
  if ("saleStatus" in distribution.state) return distribution.state.saleStatus === 0 && distribution.state.remainingShares > 0n;
  if ("curveStatus" in distribution.state) return distribution.state.curveStatus === 0 && distribution.state.remainingSaleShares > 0n;
  if ("airdropStatus" in distribution.state) return distribution.state.airdropStatus === 0 && distribution.state.remainingShares > 0n;
  return false;
}

function nextActionLabel(account: Address | undefined, dashboard: ProductBoardroomDashboardState, hasOffering: boolean): string {
  if (!account) return hasOffering ? "Connect a wallet when you are ready to participate" : "Browse the project in read-only mode";
  if (dashboard.snapshot.grantSummaries.some((grant) => sameAddress(grant.state?.holder, account) && (grant.state?.settleable ?? 0n) > 0n)) {
    return "A grant can be settled now";
  }
  if (hasOffering) return "An active participation path is available";
  if (sameAddress(account, dashboard.snapshot.owner)) return "Review project operations";
  return "No wallet action is required";
}

function nextActionDescription(account: Address | undefined, dashboard: ProductBoardroomDashboardState, hasOffering: boolean): string {
  if (!account) return "Everything on this page is public. Connecting only becomes necessary when an action reaches your wallet.";
  if (dashboard.snapshot.grantSummaries.some((grant) => sameAddress(grant.state?.holder, account) && (grant.state?.settleable ?? 0n) > 0n)) {
    return "Open Portfolio to review the amount, payment, and wallet confirmation before settling.";
  }
  if (hasOffering) return "Compare the available route, quote, and limits before sending anything to your wallet.";
  if (sameAddress(account, dashboard.snapshot.owner)) return "Studio keeps creation and lifecycle controls separate from this public project view.";
  return "Return later or inspect the project’s transparency record; there is nothing to sign now.";
}

function sameAddress(first: Address | undefined, second: Address | undefined): boolean {
  return first !== undefined && second !== undefined && first.toLowerCase() === second.toLowerCase();
}
