import type { Address } from "@pledge.cash/sdk";
import { CheckCircle2, Circle, LockKeyhole, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { AddressLink } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import type { ProductBoardroomDashboardState } from "../../lib/product-boardroom";
import { PageHeading, PageNotice, RuledSection, SectionHeading } from "./page-primitives";
import { selectedCatalogEntry } from "./project-page";

export type StudioLifecycle = "empty" | "draft" | "pre-launch" | "launched" | "winding-down" | "redemptions-open";

export type StudioPageProps = {
  account?: Address | undefined;
  createAction?: ReactNode;
  dashboard?: ProductBoardroomDashboardState | undefined;
  error?: string | undefined;
  lifecycle?: StudioLifecycle | undefined;
  loading: boolean;
  nextAction?: ReactNode;
  onRetry?: (() => void) | undefined;
  operatorTools?: ReactNode;
  projectDirectoryContent?: ReactNode;
  sectionNavigation?: ReactNode;
  showLifecycleOverview?: boolean;
};

export function StudioPage({
  account,
  createAction,
  dashboard,
  error,
  lifecycle,
  loading,
  nextAction,
  onRetry,
  operatorTools,
  projectDirectoryContent,
  sectionNavigation,
  showLifecycleOverview = true,
}: StudioPageProps): React.JSX.Element {
  const resolvedLifecycle = lifecycle ?? studioLifecycle(dashboard);
  const loadingSelectedProject = loading && !dashboard && Boolean(sectionNavigation);
  const guidance = loadingSelectedProject ? selectedProjectLoadingGuidance() : studioGuidance(resolvedLifecycle, dashboard);
  const project = selectedCatalogEntry(dashboard);
  const isOwner = Boolean(account && dashboard && sameAddress(account, dashboard.snapshot.owner));

  return (
    <div>
      <PageHeading
        actions={loadingSelectedProject ? undefined : resolvedLifecycle === "empty" ? createAction : nextAction}
        eyebrow="Studio"
        title={loadingSelectedProject
          ? "Loading selected project"
          : dashboard ? project?.name ?? project?.symbol ?? "Project workspace" : "Create and operate projects"}
        description="A guided workspace for project setup and lifecycle changes. Public project pages stay separate from operator controls."
      />

      {sectionNavigation ? <div className="border-b border-zinc-800 py-3">{sectionNavigation}</div> : null}

      {error ? (
        <div className="pt-5">
          <PageNotice title="Studio data is incomplete" tone="danger">
            <p className="m-0">{error}</p>
            {onRetry ? <Button className="mt-3" size="sm" variant="secondary" onClick={onRetry}>Try again</Button> : null}
          </PageNotice>
        </div>
      ) : null}

      {showLifecycleOverview ? <>
      <RuledSection>
        <SectionHeading title="Current stage" description="The lifecycle determines which actions are safe and who can authorize them." />
        <div className="mt-5 grid gap-5 border-y border-zinc-800 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.45fr)] lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={guidance.tone}>{guidance.label}</Badge>
              {dashboard ? <Badge variant={isOwner ? "default" : "muted"}>{isOwner ? "Owner wallet" : account ? "Read-only operator view" : "Wallet not connected"}</Badge> : null}
            </div>
            <h2 className="m-0 mt-4 text-2xl font-semibold tracking-[-0.02em] text-zinc-50">{guidance.title}</h2>
            <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{guidance.description}</p>
            {dashboard ? (
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-500">
                <span>Boardroom <AddressLink address={dashboard.address} /></span>
                <span>Owner <AddressLink address={dashboard.snapshot.owner} /></span>
              </div>
            ) : null}
          </div>
          <div className="border-l-2 border-lime-300 px-4 py-1">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-lime-200">Next safe action</p>
            <p className="m-0 mt-2 text-sm font-semibold text-zinc-100">{guidance.nextStep}</p>
            <p className="m-0 mt-1 text-xs leading-5 text-zinc-500">{guidance.nextStepDetail}</p>
          </div>
        </div>
      </RuledSection>

      {!loadingSelectedProject ? <RuledSection>
        <SectionHeading title="Project lifecycle" description="Completed stages stay visible so the next authority transition is never ambiguous." />
        <ol className="m-0 mt-5 list-none border-l border-zinc-800 p-0">
          {studioSteps(resolvedLifecycle).map((step) => (
            <li className="relative grid gap-1 pb-5 pl-7 last:pb-0" key={step.title}>
              <span className={`absolute -left-2 top-0 grid h-4 w-4 place-items-center rounded-full bg-zinc-950 ${step.complete ? "text-lime-300" : step.current ? "text-amber-200" : "text-zinc-700"}`}>
                {step.complete ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-3.5 w-3.5" />}
              </span>
              <span className={step.current ? "text-sm font-semibold text-zinc-50" : "text-sm font-semibold text-zinc-300"}>{step.title}</span>
              <span className="text-xs leading-5 text-zinc-500">{step.detail}</span>
            </li>
          ))}
        </ol>
      </RuledSection> : null}
      </> : null}

      {!loadingSelectedProject && (resolvedLifecycle === "empty" || projectDirectoryContent) ? <RuledSection>
        <SectionHeading title="Projects" description="Choose an existing Boardroom or start a new setup workflow." />
        <div className="mt-4">
          {loading ? <StudioLoading /> : projectDirectoryContent ?? (
            <PageNotice title="No project directory attached">
              Project creation and address-based loading controls can be supplied here without exposing them on public project pages.
            </PageNotice>
          )}
        </div>
      </RuledSection> : null}

      <RuledSection>
        <SectionHeading
          title="Operator tools"
          description="Creation, issuance, liquidity, and wind-down controls appear here only when the lifecycle and connected wallet allow them."
        />
        <div className="mt-4" id="studio-operator-tools">
          {operatorTools ?? (
            <div className="border-y border-zinc-800 py-6">
              <div className="flex items-center gap-2 text-zinc-300"><Wrench className="h-4 w-4" /><span className="text-sm font-semibold">Tools are not attached</span></div>
              <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-zinc-500">The Studio shell is ready, but no operator workflow has been supplied to this view.</p>
            </div>
          )}
        </div>
      </RuledSection>

      <footer className="flex items-center gap-2 py-5 text-xs text-zinc-600">
        <LockKeyhole className="h-3.5 w-3.5" />
        Every write remains subject to contract authority and wallet confirmation.
      </footer>
    </div>
  );
}

export function studioLifecycle(dashboard: ProductBoardroomDashboardState | undefined): StudioLifecycle {
  if (!dashboard) return "empty";
  if (dashboard.snapshot.status === 1) return "winding-down";
  if (dashboard.snapshot.status === 2) return "redemptions-open";
  return dashboard.snapshot.launched ? "launched" : "pre-launch";
}

export function studioGuidance(
  lifecycle: StudioLifecycle,
  dashboard: ProductBoardroomDashboardState | undefined,
): {
  description: string;
  label: string;
  nextStep: string;
  nextStepDetail: string;
  title: string;
  tone: "default" | "muted" | "warning";
} {
  if (lifecycle === "empty") return {
    description: "Create a Boardroom or load an existing address. Nothing is deployed from this page until the final transaction is reviewed in the wallet.",
    label: "No project selected",
    nextStep: "Choose create or load",
    nextStepDetail: "Creating starts with identity and ownership; loading is read-only until an authorized action is chosen.",
    title: "Start with a project",
    tone: "muted",
  };
  if (lifecycle === "draft") return {
    description: "Review the project name, owner, token identity, and deterministic deployment inputs before creating the Boardroom.",
    label: "Draft",
    nextStep: "Review deployment details",
    nextStepDetail: "Confirm addresses and salts before the transaction reaches the wallet.",
    title: "Project setup is not onchain yet",
    tone: "warning",
  };
  if (lifecycle === "pre-launch") return {
    description: "The Boardroom is active under direct owner authority. Configure grants, distributions, and liquidity before handing routine decisions to governance.",
    label: "Pre-launch",
    nextStep: dashboard?.snapshot.issuedDistributions.length ? "Review before launching governance" : "Choose a distribution path",
    nextStepDetail: "Launch is a one-way authority transition. Confirm the executor, delay, and holder thresholds first.",
    title: "Build the project’s operating system",
    tone: "warning",
  };
  if (lifecycle === "launched") return {
    description: "Holder governance is live. Project changes should be prepared as decoded queued actions, then reviewed during the configured delay.",
    label: "Launched",
    nextStep: "Prepare or review a queued action",
    nextStepDetail: "State the intent, target, value, and calldata before asking the executor to queue it.",
    title: "Operate through governance",
    tone: "default",
  };
  if (lifecycle === "winding-down") return {
    description: "The Boardroom is unwinding grants, distributions, and liquidity. Creation actions are no longer the priority.",
    label: "Winding down",
    nextStep: "Clear remaining obligations",
    nextStepDetail: "Use only lifecycle-safe cleanup actions, then verify every tracked obligation before opening redemptions.",
    title: "Prepare assets for redemption",
    tone: "warning",
  };
  return {
    description: "Project token holders can redeem against the Boardroom’s declared redeemable assets.",
    label: "Redemptions open",
    nextStep: "Monitor redemptions and residual assets",
    nextStepDetail: "Creation and routine governance are over; keep the public transparency record current.",
    title: "The project is in redemption mode",
    tone: "muted",
  };
}

function selectedProjectLoadingGuidance(): ReturnType<typeof studioGuidance> {
  return {
    description: "Reading the canonical Boardroom state before showing lifecycle or operator controls.",
    label: "Loading project",
    nextStep: "Wait for verified state",
    nextStepDetail: "Transaction controls stay hidden until the selected project’s identity and authority are confirmed.",
    title: "Verifying the selected project",
    tone: "muted",
  };
}

function studioSteps(lifecycle: StudioLifecycle): { complete: boolean; current: boolean; detail: string; title: string }[] {
  const order: StudioLifecycle[] = ["draft", "pre-launch", "launched", "winding-down", "redemptions-open"];
  const index = lifecycle === "empty" ? -1 : order.indexOf(lifecycle);
  return [
    { title: "Define", detail: "Name the project, choose the owner, and create the Boardroom.", current: lifecycle === "empty" || lifecycle === "draft", complete: index > 0 },
    { title: "Configure", detail: "Issue grants and choose distribution and liquidity paths.", current: lifecycle === "pre-launch", complete: index > 1 },
    { title: "Govern", detail: "Queue delayed, inspectable actions after launch.", current: lifecycle === "launched", complete: index > 2 },
    { title: "Wind down", detail: "Resolve obligations and declare redeemable assets.", current: lifecycle === "winding-down", complete: index > 3 },
    { title: "Redeem", detail: "Let holders redeem against final project assets.", current: lifecycle === "redemptions-open", complete: false },
  ];
}

function StudioLoading(): React.JSX.Element {
  return (
    <div aria-label="Loading Studio projects" aria-live="polite" className="grid animate-pulse gap-2" role="status">
      <span className="h-16 rounded bg-zinc-900" />
      <span className="h-16 rounded bg-zinc-900" />
    </div>
  );
}

function sameAddress(first: Address, second: Address): boolean {
  return first.toLowerCase() === second.toLowerCase();
}
