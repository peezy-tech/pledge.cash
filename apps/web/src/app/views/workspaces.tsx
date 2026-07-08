import type { Address, PledgeCashDeployment } from "@pledge.cash/sdk";
import { Activity, ArrowDownUp, Compass, KeyRound, Settings2, WalletCards, Wrench } from "lucide-react";
import type React from "react";
import type { ReactNode } from "react";
import { AddressLink, Facts, Panel, TabButton, WorkspaceHeader } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { ArtifactPanel, DeploymentPanel } from "../../features/deployment/deployment-panel";
import { LogPanel } from "../../features/logs/log-panel";
import { WalletPanel } from "../../features/wallet/wallet-panel";
import type { ProductBoardroomDashboardState } from "../../lib/product-boardroom";
import type { BoardroomSnapshot, FactorySnapshot, LogEntry, WalletState } from "../../lib/types";
import type { AppView } from "../routing";
import { manageWorkspaceSummary } from "./workspace-helpers";

export function ProjectDiagnostics({
  chainId,
  creationFee,
  deployment,
  factorySnapshot,
  wallet,
}: {
  chainId: number;
  creationFee: bigint;
  deployment: PledgeCashDeployment | undefined;
  factorySnapshot: FactorySnapshot;
  wallet: WalletState;
}): React.JSX.Element {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <DeploymentPanel
          chainId={chainId}
          creationFee={creationFee}
          deployment={deployment}
          factorySnapshot={factorySnapshot}
          localAmmProtocolFeeRecipient={deployment?.ammProtocolFeeRecipient}
        />
        <WalletPanel wallet={wallet} />
      </div>
      <ArtifactPanel deployment={deployment} />
    </div>
  );
}

export function WorkspaceNav({
  activeView,
  navigateView,
}: {
  activeView: AppView;
  navigateView: (view: AppView) => void;
}): React.JSX.Element {
  const items: { view: AppView; label: string; icon: ReactNode }[] = [
    { view: "project", label: "Overview", icon: <Compass className="h-4 w-4" /> },
    { view: "market", label: "Market", icon: <ArrowDownUp className="h-4 w-4" /> },
    { view: "wallet", label: "Wallet", icon: <WalletCards className="h-4 w-4" /> },
    { view: "grants", label: "Grants", icon: <KeyRound className="h-4 w-4" /> },
    { view: "manage", label: "Manage", icon: <Settings2 className="h-4 w-4" /> },
    { view: "activity", label: "Activity", icon: <Activity className="h-4 w-4" /> },
    { view: "advanced", label: "Tools", icon: <Wrench className="h-4 w-4" /> },
  ];

  return (
    <nav aria-label="Workspace" className="mb-5 flex items-center gap-1 overflow-x-auto border-b border-zinc-800">
      {items.map((item) => (
        <TabButton active={activeView === item.view} key={item.view} onClick={() => navigateView(item.view)}>
          <span className="inline-flex items-center gap-2">
            {item.icon}
            {item.label}
          </span>
        </TabButton>
      ))}
    </nav>
  );
}

export function PositionsWorkspace({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <>
      <WorkspaceHeader
        eyebrow="Wallet"
        title="Wallet Access"
        description="See the grants, Boardrooms, treasury actions, and liquidity this wallet can read or manage."
      />
      {children}
    </>
  );
}

export function ManageWorkspace({
  account,
  boardroomAddress,
  boardroomSnapshot,
  children,
}: {
  account: Address | undefined;
  boardroomAddress: string;
  boardroomSnapshot: BoardroomSnapshot | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const summary = manageWorkspaceSummary(account, boardroomAddress, boardroomSnapshot);

  return (
    <>
      <WorkspaceHeader
        eyebrow="Operations"
        title="Manage Boardroom"
        description="Use owner-authorized workflows for grants, token issuance, sale setup, locked liquidity, and wind-down. Read-only users can still inspect loaded state."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={summary.roleTone}>{summary.roleLabel}</Badge>
          <Badge variant={summary.statusTone}>{summary.statusLabel}</Badge>
        </div>
      </WorkspaceHeader>
      {children}
    </>
  );
}

export function ActivityWorkspace({
  clearLogs,
  dashboard,
  logs,
}: {
  clearLogs: () => void;
  dashboard: ProductBoardroomDashboardState | undefined;
  logs: LogEntry[];
}): React.JSX.Element {
  const history = dashboard?.history;
  const purchaseCount = (history?.fixedPriceSale?.purchaseCount ?? 0) + (history?.curve?.buyCount ?? 0);
  const sellCount = history?.curve?.sellCount ?? 0;

  return (
    <>
      <WorkspaceHeader
        eyebrow="Activity"
        title="Project Activity"
        description="Read recent project movement from indexed protocol history and local wallet actions from this session."
      />
      <Panel title="Protocol Activity" description="These counts come from the loaded Boardroom dashboard and its distribution or AMM history.">
        <Facts columns="three" items={[
          { label: "Boardroom", value: dashboard ? <AddressLink address={dashboard.address} /> : "No project loaded" },
          { label: "Buyers", value: history?.buyerCount === undefined ? "Unknown" : history.buyerCount.toString() },
          { label: "Purchases", value: purchaseCount.toString() },
          { label: "Curve sells", value: sellCount.toString() },
          { label: "AMM swaps", value: history?.amm?.swapCount === undefined ? "Unknown" : history.amm.swapCount.toString() },
          { label: "AMM traders", value: history?.amm?.traderCount === undefined ? "Unknown" : history.amm.traderCount.toString() },
        ]} />
      </Panel>
      <div className="mt-4">
        <LogPanel logs={logs} clearLogs={clearLogs} />
      </div>
    </>
  );
}

export function AdvancedWorkspace({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <>
      <WorkspaceHeader
        eyebrow="Tools"
        title="Tools and Diagnostics"
        description="Use raw deployment details, wallet diagnostics, grant creation, and discovery tools when a workflow needs protocol-level control."
      />
      <div className="grid gap-4">{children}</div>
    </>
  );
}
