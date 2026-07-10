import type { Address } from "@pledge.cash/sdk";
import { AlertTriangle, CheckCircle2, Circle, WalletCards } from "lucide-react";
import type { ReactNode } from "react";
import { AddressLink } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { PageHeading, PageNotice, RuledSection, SectionHeading } from "./page-primitives";

export type PortfolioTaskStatus = "attention" | "ready" | "informational" | "complete";

export type PortfolioTask = {
  action?: ReactNode;
  description: string;
  id: string;
  project?: string;
  status: PortfolioTaskStatus;
  title: string;
};

export type PortfolioPageProps = {
  account?: Address | undefined;
  connectAction?: ReactNode;
  discoveryContent?: ReactNode;
  error?: string | undefined;
  loading: boolean;
  refreshAction?: ReactNode;
  summaryContent?: ReactNode;
  tasks: readonly PortfolioTask[];
};

export function PortfolioPage({
  account,
  connectAction,
  discoveryContent,
  error,
  loading,
  refreshAction,
  summaryContent,
  tasks,
}: PortfolioPageProps): React.JSX.Element {
  const orderedTasks = orderPortfolioTasks(tasks);
  const attentionCount = tasks.filter((task) => task.status === "attention").length;

  return (
    <div>
      <PageHeading
        actions={account ? refreshAction : connectAction}
        eyebrow="Portfolio"
        title={account ? "Your onchain work" : "Wallet portfolio"}
        description={account
          ? "Grants, project roles, and liquidity actions ordered by what needs attention first."
          : "Connect a wallet to find grants and project responsibilities. Public project pages remain available without connecting."}
      />

      {error ? <div className="pt-5"><PageNotice title="Portfolio data is incomplete" tone="danger">{error}</PageNotice></div> : null}

      <RuledSection>
        <SectionHeading
          title="Needs attention"
          description={account ? `${attentionCount} ${attentionCount === 1 ? "item" : "items"} require a decision or transaction.` : "Wallet-specific actions appear here after connection."}
        />
        {!account ? (
          <div className="mt-5 border-l-2 border-zinc-700 px-4 py-2">
            <div className="flex items-center gap-2 text-zinc-300"><WalletCards className="h-4 w-4" /><span className="text-sm font-semibold">No wallet connected</span></div>
            <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Connecting is used to discover positions and authorize actions; it does not grant pledge.cash custody or project authority.</p>
            {connectAction ? <div className="mt-4">{connectAction}</div> : null}
          </div>
        ) : loading && orderedTasks.length === 0 ? (
          <PortfolioLoading />
        ) : orderedTasks.length === 0 ? (
          <PageNotice title="Nothing needs your wallet right now">
            No open grant settlement, owner operation, governance threshold, or liquidity action was discovered.
          </PageNotice>
        ) : (
          <ol className="m-0 mt-4 list-none border-t border-zinc-800 p-0">
            {orderedTasks.map((task) => <PortfolioTaskRow key={task.id} task={task} />)}
          </ol>
        )}
      </RuledSection>

      {summaryContent ? (
        <RuledSection>
          <SectionHeading title="Positions summary" description="A compact read of discovered grants, holdings, and project roles." />
          <div className="mt-4">{summaryContent}</div>
        </RuledSection>
      ) : null}

      {account ? (
      <RuledSection>
        <SectionHeading
          title="Discovery details"
          description="Review what was scanned, the network range, and any contracts that could not be read."
        />
        <div className="mt-4">
          {discoveryContent ?? (
            <PageNotice title={account ? "Discovery controls are not attached" : "Connect to discover wallet positions"}>
              {account
                ? "The wallet is connected, but the discovery workflow has not been supplied to this page."
                : "Project browsing does not need a wallet. Portfolio discovery does, because positions are indexed for a specific address."}
            </PageNotice>
          )}
        </div>
      </RuledSection>
      ) : null}

      {account ? (
        <footer className="py-5 text-xs text-zinc-600">
          Portfolio for <AddressLink address={account} />
        </footer>
      ) : null}
    </div>
  );
}

export function orderPortfolioTasks(tasks: readonly PortfolioTask[]): PortfolioTask[] {
  const weights: Record<PortfolioTaskStatus, number> = {
    attention: 0,
    ready: 1,
    informational: 2,
    complete: 3,
  };
  return tasks.map((task, index) => ({ task, index }))
    .sort((left, right) => weights[left.task.status] - weights[right.task.status] || left.index - right.index)
    .map(({ task }) => task);
}

function PortfolioTaskRow({ task }: { task: PortfolioTask }): React.JSX.Element {
  const presentation = taskPresentation(task.status);
  return (
    <li className="grid gap-3 border-b border-zinc-800 py-4 sm:px-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
      <span className={presentation.iconClass}>{presentation.icon}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 text-sm font-semibold text-zinc-100">{task.title}</h3>
          <Badge variant={presentation.tone}>{presentation.label}</Badge>
          {task.project ? <span className="text-xs text-zinc-600">{task.project}</span> : null}
        </div>
        <p className="m-0 mt-1 max-w-3xl text-xs leading-5 text-zinc-500">{task.description}</p>
      </div>
      {task.action ? <div className="flex shrink-0 flex-wrap gap-2">{task.action}</div> : null}
    </li>
  );
}

function taskPresentation(status: PortfolioTaskStatus): {
  icon: ReactNode;
  iconClass: string;
  label: string;
  tone: "danger" | "default" | "muted" | "warning";
} {
  if (status === "attention") return { icon: <AlertTriangle className="h-4 w-4" />, iconClass: "text-amber-300", label: "Needs attention", tone: "warning" };
  if (status === "ready") return { icon: <Circle className="h-4 w-4" />, iconClass: "text-lime-300", label: "Ready", tone: "default" };
  if (status === "complete") return { icon: <CheckCircle2 className="h-4 w-4" />, iconClass: "text-zinc-600", label: "Complete", tone: "muted" };
  return { icon: <Circle className="h-4 w-4" />, iconClass: "text-zinc-600", label: "For reference", tone: "muted" };
}

function PortfolioLoading(): React.JSX.Element {
  return (
    <div aria-label="Discovering portfolio" aria-live="polite" className="mt-4 grid animate-pulse gap-0 border-t border-zinc-800" role="status">
      {[0, 1, 2].map((index) => <span className="h-20 border-b border-zinc-800 bg-zinc-900/45" key={index} />)}
    </div>
  );
}
