import type { Address } from "@pledge.cash/sdk";
import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { AddressLink } from "../../components/shell";
import { ProjectMarketOverview } from "../../features/market";
import { Badge } from "../../components/ui/badge";
import { Button, ButtonLink } from "../../components/ui/button";
import {
  formatNativeBalance,
  formatTokenBalance,
  type ProductBoardroomChildCoverage,
  type ProductBoardroomCatalogEntry,
  type ProductBoardroomDashboardState,
} from "../../lib/product-boardroom";
import {
  projectPositionAction,
  projectPositionHasUnknowns,
  type ProjectPositionAction,
  type ProjectWalletPosition,
} from "../../lib/project-position";
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
  savedProjectsWarning?: string | undefined;
  sectionHref?: ((section: ProjectSection) => string) | undefined;
};

const projectSections: readonly { label: string; value: ProjectSection }[] = [
  { label: "Overview", value: "overview" },
  { label: "Participate", value: "participate" },
  { label: "Governance", value: "governance" },
  { label: "Transparency", value: "transparency" },
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
  savedProjectsWarning,
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
      <header className="border-b border-[var(--pc-border)] pb-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant={lifecycle.tone}>{lifecycle.label}</Badge>
              <Badge variant={role.tone}>{role.label}</Badge>
              <span className="text-xs text-[var(--pc-text-subtle)]">{chainName}</span>
            </div>
            <h1 className="m-0 whitespace-normal [overflow-wrap:anywhere] text-3xl font-semibold tracking-[-0.03em] text-[var(--pc-text)] sm:text-5xl">{name}</h1>
            <p className="m-0 mt-3 max-w-3xl text-sm leading-6 text-[var(--pc-text-muted)]">
              {snapshot
                ? `${snapshot.launched ? "Holder governance is live." : "Holder governance has not launched; the owner still manages project changes directly."} See whether participation is open, what the current route costs in its quote token, how deep the market is, and what holders can do.`
                : "See whether participation is open, what the route costs, how project funds are held, and what holders can do."}
            </p>
            {dashboard ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--pc-text-subtle)]">
                <span>Canonical project contract</span>
                <AddressLink address={dashboard.address} />
              </div>
            ) : null}
          </div>
          {mastheadAction || savedProjectsWarning ? (
            <div className="max-w-md shrink-0">
              {mastheadAction ? <div className="flex flex-wrap gap-2">{mastheadAction}</div> : null}
              {savedProjectsWarning ? (
                <p className="m-0 mt-2 text-xs leading-5 text-[var(--pc-warning)]" role="status">
                  Saved-project storage warning: {savedProjectsWarning}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <ProjectMarketOverview dashboard={dashboard} loading={loading} />

      <nav aria-label="Project" className="grid grid-cols-2 border-b border-[var(--pc-border)] sm:grid-cols-4 md:flex md:gap-1" data-mobile-layout="two-column-project-navigation">
        {projectSections.map((section) => {
          const className = cn(
            "relative flex min-h-12 min-w-0 items-center justify-center px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--pc-accent)] md:shrink-0 md:px-3 md:text-sm",
            activeSection === section.value
              ? "text-[var(--pc-text)] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-[var(--pc-accent)]"
              : "text-[var(--pc-text-muted)] hover:text-[var(--pc-text)]",
          );
          const href = sectionHref?.(section.value);
          return href ? (
            <a
              aria-current={activeSection === section.value ? "page" : undefined}
              aria-label={section.label}
              className={className}
              href={href}
              key={section.value}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onNavigateSection(section.value);
              }}
            >
              {section.label}
            </a>
          ) : (
            <button
              aria-current={activeSection === section.value ? "page" : undefined}
              aria-label={section.label}
              className={className}
              key={section.value}
              type="button"
              onClick={() => onNavigateSection(section.value)}
            >
              {section.label}
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
  actionHref?: ((action: ProjectPositionAction) => string) | undefined;
  activity?: ReactNode;
  dashboard?: ProductBoardroomDashboardState | undefined;
  loading: boolean;
  onOpenAction?: ((action: ProjectPositionAction) => void) | undefined;
  onRefresh?: (() => void) | undefined;
  position?: ProjectWalletPosition | undefined;
  positionError?: string | undefined;
  positionLoading?: boolean | undefined;
  refreshing?: boolean | undefined;
  refreshPendingLabel?: string | undefined;
};

export function ProjectOverviewPage({
  account,
  actionHref,
  activity,
  dashboard,
  loading,
  onOpenAction,
  onRefresh,
  position,
  positionError,
  positionLoading = false,
  refreshing,
  refreshPendingLabel = "Refreshing project position",
}: ProjectOverviewPageProps): React.JSX.Element {
  const snapshot = dashboard?.snapshot;
  const shareAsset = dashboard?.treasuryAssets.find((asset) => sameAddress(asset.address, snapshot?.shareToken));
  const cashAssets = dashboard?.treasuryAssets.filter((asset) => !sameAddress(asset.address, snapshot?.shareToken)) ?? [];
  const commitments = commitmentSummary(dashboard);
  const hasParticipation = (commitments.openDistributions ?? 0) > 0;
  const refreshPending = refreshing ?? positionLoading;

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

  const nextAction = projectPositionAction({
    connected: account !== undefined,
    hasActiveParticipation: hasParticipation,
    launched: snapshot.launched,
    loading: refreshPending,
    position,
    status: snapshot.status,
  });

  return (
    <>
      <RuledSection>
        <SectionHeading title="Project state" description="Authority, token supply, treasury, and open obligations before any wallet-specific position." />
        <KeyValueList
          columns={4}
          items={[
            { label: "Project contract", value: <AddressLink address={dashboard.address} /> },
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
        <SectionHeading
          title="Your position"
          description={account
            ? "Wallet-specific project tokens, settleable project-token grants, and verified holder power."
            : "Public project state remains available without a wallet, including the market truth above. Connect only to read a wallet-specific position."}
          action={onRefresh ? (
            <Button
              aria-busy={refreshPending || undefined}
              disabled={refreshPending}
              size="sm"
              variant="ghost"
              onClick={onRefresh}
            >
              {refreshPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {refreshPending ? refreshPendingLabel : "Refresh position"}
            </Button>
          ) : undefined}
        />
        {account ? (
          <>
            <KeyValueList columns={3} items={positionFacts(position, snapshot, positionLoading)} />
            {!positionLoading && (positionError || projectPositionHasUnknowns(position)) ? (
              <p className="m-0 border-t border-[var(--pc-border)] py-3 text-xs leading-5 text-[var(--pc-warning)]">
                One or more wallet-specific reads could not be verified. Those values remain Unknown and are not treated as zero.
              </p>
            ) : null}
          </>
        ) : (
          <p className="m-0 mt-4 max-w-3xl text-sm leading-6 text-[var(--pc-text-muted)]">
            Connect a wallet to read its direct project-token balance, settleable project-token grants, and current plus previous-block governance power.
          </p>
        )}
        <div className="mt-4 grid gap-4 border-l-2 border-[var(--pc-accent)] bg-[var(--pc-surface-subtle)] px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className="m-0 text-base font-semibold text-[var(--pc-text)]">{positionActionLabel(nextAction)}</p>
            <p className="m-0 mt-1 max-w-2xl text-sm leading-6 text-[var(--pc-text-muted)]">
              {positionActionDescription(nextAction, account, position, snapshot.shareTokenMetadata)}
            </p>
          </div>
          <PositionAction
            action={nextAction}
            href={nextAction.kind === "loading" ? undefined : actionHref?.(nextAction)}
            onOpen={onOpenAction}
          />
        </div>
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
  return { label: "Wallet connected", tone: "muted" };
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

function positionFacts(
  position: ProjectWalletPosition | undefined,
  snapshot: ProductBoardroomDashboardState["snapshot"],
  loading: boolean,
): Array<{ detail?: string | undefined; label: string; value: ReactNode }> {
  const value = (amount: bigint | undefined): string => loading
    ? "Loading…"
    : amount === undefined ? "Unknown" : formatTokenAmount(amount, snapshot.shareTokenMetadata);
  const power = position?.holderPower;
  return [
    {
      label: "Direct project tokens",
      value: value(position?.directBalance),
      detail: "Balance held directly by this wallet on the canonical project token.",
    },
    {
      label: "Next settleable grant",
      value: value(position?.nextGrantSettleableTokens),
      detail: position?.settleableGrantCount === undefined
        ? "Unknown until every active project grant is read."
        : position.settleableGrantCount > 1
          ? `Showing the first of ${position.settleableGrantCount.toString()} project-token grants that can settle now; the recommendation opens this exact grant.`
          : `${position.settleableGrantCount.toString()} project-token grant${position.settleableGrantCount === 1 ? "" : "s"} can settle now. Other grant assets are never added to this amount.`,
    },
    {
      label: "Governance power",
      value: loading ? "Loading…" : governancePowerLabel(power),
      detail: power
        ? `Veto requires ${formatTokenAmount(power.vetoRequired, snapshot.shareTokenMetadata)}; wind-down requires ${formatTokenAmount(power.windDownRequired, snapshot.shareTokenMetadata)} at current and block ${power.snapshotBlock.toString()} balances.`
        : "Unknown until current and previous-block holder power are both verified.",
    },
  ];
}

function governancePowerLabel(power: ProjectWalletPosition["holderPower"]): string {
  if (!power) return "Unknown";
  if (power.encumbered) return "Not governance eligible";
  if (power.canStartWindDown) return "Veto + wind-down eligible";
  if (power.canVeto) return "Veto eligible";
  if (power.currentBalance > 0n) return "Holder; below action thresholds";
  return "No current holder power";
}

function PositionAction({
  action,
  href,
  onOpen,
}: {
  action: ProjectPositionAction;
  href?: string | undefined;
  onOpen?: ((action: ProjectPositionAction) => void) | undefined;
}): React.JSX.Element | null {
  if (action.kind === "loading") return null;
  if (!onOpen && !href) return null;
  const label = positionActionButtonLabel(action);
  return href ? (
    <ButtonLink
      href={href}
      onClick={(event) => {
        if (!onOpen || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpen(action);
      }}
    >
      {label}
      <ArrowRight className="h-4 w-4" />
    </ButtonLink>
  ) : (
    <Button onClick={() => onOpen?.(action)}>
      {label}
      <ArrowRight className="h-4 w-4" />
    </Button>
  );
}

function positionActionLabel(action: ProjectPositionAction): string {
  if (action.kind === "loading") return "Refreshing wallet position";
  if (action.kind === "grant") return "Project tokens are available to settle";
  if (action.kind === "governance") return "This wallet has verified holder power";
  if (action.kind === "participate") return "An active participation path is available";
  return "Continue with the project evidence";
}

function positionActionDescription(
  action: ProjectPositionAction,
  account: Address | undefined,
  position: ProjectWalletPosition | undefined,
  metadata: ProductBoardroomDashboardState["snapshot"]["shareTokenMetadata"],
): string {
  if (action.kind === "loading") {
    return "Verifying the latest project-token balance, grant availability, and holder power before recommending a next step.";
  }
  if (action.kind === "grant") {
    return `${formatTokenAmount(position?.nextGrantSettleableTokens, metadata)} can settle from the grant this recommendation opens. Review its schedule and payment before signing.`;
  }
  if (action.kind === "governance") {
    return "Inspect the verified queue, review thresholds, and the actions this wallet can take before signing anything.";
  }
  if (action.kind === "participate") {
    return account
      ? "Compare the live route, quote, and limits before sending anything to your wallet."
      : "Everything on this page is public. Connect only after you have reviewed a live route and its limits.";
  }
  return "Review balances, obligations, history coverage, and contract addresses. Unknown values remain distinct from zero.";
}

function positionActionButtonLabel(action: ProjectPositionAction): string {
  if (action.kind === "loading") return "Refreshing";
  if (action.kind === "grant") return "Review grant";
  if (action.kind === "governance") return "Review governance";
  if (action.kind === "participate") return "View participation";
  return "Open transparency";
}

function sameAddress(first: Address | undefined, second: Address | undefined): boolean {
  return first !== undefined && second !== undefined && first.toLowerCase() === second.toLowerCase();
}
