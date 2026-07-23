import type { Address, PledgeCashDeployment } from "@pledge.cash/sdk";
import { RefreshCw, WalletCards, Wrench } from "lucide-react";
import type React from "react";
import { ActionButton } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { shortAddress } from "../../lib/forms";
import type { ProductBoardroomDashboardState } from "../../lib/product-boardroom";
import type { WalletState } from "../../lib/types";
import type { AppView } from "../routing";
import { boardroomStatusText, sameAddress } from "./workspace-helpers";

export function ProjectContextBar({
  activeView,
  chainName,
  dashboard,
  deployment,
  error,
  loading,
  pendingAction,
  wallet,
  navigateView,
  refresh,
  runAction,
}: {
  activeView: AppView;
  chainName: string;
  dashboard: ProductBoardroomDashboardState | undefined;
  deployment: PledgeCashDeployment | undefined;
  error: string | undefined;
  loading: boolean;
  pendingAction: string | undefined;
  wallet: WalletState;
  navigateView: (view: AppView) => void;
  refresh: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
}): React.JSX.Element {
  const project = projectContextSummary(wallet.account, dashboard, loading, error);
  const protocolReady = Boolean(deployment?.tokenGrantFactory);

  return (
    <section aria-label="Project context" className="mb-4 border-b border-zinc-800 pb-4 sm:pb-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(560px,0.68fr)] xl:items-end">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant={project.statusTone}>{project.statusLabel}</Badge>
            <Badge variant={project.roleTone}>{project.roleLabel}</Badge>
            <Badge variant={activeView === "advanced" ? "warning" : "muted"}>
              {activeView === "advanced" ? "Tools open" : "Project workspace"}
            </Badge>
          </div>
          <h1 className="m-0 truncate text-2xl font-semibold tracking-normal text-zinc-50 sm:text-3xl">
            {project.name}
          </h1>
          <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            See project state first. Trade, settle grants, and manage Boardrooms from job-based views; raw protocol details stay in Tools.
          </p>
        </div>

        <div className="grid gap-3">
          <dl className="grid min-w-0 grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 sm:grid-cols-3">
            <ContextMetric label="Network" value={chainName} />
            <ContextMetric label="Wallet" value={wallet.account ? shortAddress(wallet.account) : "Read-only visitor"} />
            <ContextMetric label="Protocol" value={protocolReady ? "Ready" : "Pending"} tone={protocolReady ? "strong" : "warning"} />
          </dl>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <ActionButton
              actionId="refresh-project-context"
              pendingAction={pendingAction}
              variant="secondary"
              onClick={() => void runAction("refresh-project-context", refresh)}
            >
              <RefreshCw className="h-4 w-4" />
              {loading ? "Loading" : "Refresh"}
            </ActionButton>
            <Button variant="secondary" onClick={() => navigateView("wallet")}>
              <WalletCards className="h-4 w-4" />
              Wallet
            </Button>
            <Button variant="ghost" onClick={() => navigateView("advanced")}>
              <Wrench className="h-4 w-4" />
              Tools
            </Button>
          </div>
        </div>
      </div>
      {error ? <p className="m-0 mt-3 rounded-md border border-red-950 bg-red-950/35 p-3 text-sm text-red-200">{error}</p> : null}
    </section>
  );
}

function ContextMetric({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "strong" | "warning";
  value: string;
}): React.JSX.Element {
  return (
    <div className="min-w-0 bg-zinc-950 px-3 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-normal text-zinc-500">{label}</dt>
      <dd
        className={
          tone === "warning"
            ? "m-0 mt-1 truncate text-sm font-semibold text-amber-200"
            : tone === "strong"
              ? "m-0 mt-1 truncate text-sm font-semibold text-lime-200"
              : "m-0 mt-1 truncate text-sm font-semibold text-zinc-100"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function projectContextSummary(
  account: Address | undefined,
  dashboard: ProductBoardroomDashboardState | undefined,
  loading: boolean,
  error: string | undefined,
): {
  name: string;
  roleLabel: string;
  roleTone: "default" | "muted" | "warning";
  statusLabel: string;
  statusTone: "default" | "muted" | "warning" | "danger";
} {
  const catalogEntry = dashboard?.catalog.find((entry) => sameAddress(entry.address, dashboard.address));
  const name = catalogEntry?.name ?? catalogEntry?.symbol ?? "Project workspace";
  const role = projectContextRole(account, dashboard);

  if (error) {
    return { name, ...role, statusLabel: "Needs attention", statusTone: "danger" };
  }
  if (dashboard?.snapshot) {
    return { name, ...role, statusLabel: boardroomStatusText(dashboard.snapshot.status), statusTone: dashboard.snapshot.status === 0 ? "default" : "warning" };
  }
  if (loading) {
    return { name, ...role, statusLabel: "Loading project", statusTone: "muted" };
  }
  return { name, ...role, statusLabel: "Read-only mode", statusTone: "muted" };
}

function projectContextRole(
  account: Address | undefined,
  dashboard: ProductBoardroomDashboardState | undefined,
): {
  roleLabel: string;
  roleTone: "default" | "muted" | "warning";
} {
  if (!account) return { roleLabel: "Read-only visitor", roleTone: "muted" };
  if (!dashboard?.snapshot) return { roleLabel: "Wallet connected", roleTone: "muted" };
  if (dashboard.snapshot.launched && sameAddress(account, dashboard.snapshot.proposer)) {
    return { roleLabel: "Controller proposer", roleTone: "default" };
  }
  if (!dashboard.snapshot.launched && sameAddress(account, dashboard.snapshot.owner)) {
    return { roleLabel: "Owner wallet", roleTone: "default" };
  }
  if (dashboard.snapshot.grantSummaries.some((grant) => sameAddress(grant.state?.holder, account))) {
    return { roleLabel: "Grant holder", roleTone: "default" };
  }
  if (dashboard.snapshot.grantSummaries.some((grant) => sameAddress(grant.state?.issuer, account))) {
    return { roleLabel: "Grant issuer", roleTone: "warning" };
  }
  return { roleLabel: "Buyer / holder view", roleTone: "muted" };
}
