import type { BoardroomHolderPower } from "@pledge.cash/sdk";
import { Clock3, ShieldCheck, Users } from "lucide-react";
import type { ReactNode } from "react";
import { AddressLink } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import type { ProductBoardroomDashboardState } from "../../lib/product-boardroom";
import { formatTokenAmount } from "../../lib/token-amounts";
import { KeyValueList, PageNotice, RuledSection, SectionHeading } from "./page-primitives";
import { boardroomLifecycle } from "./project-page";

export type GovernancePageProps = {
  activityContent?: ReactNode;
  dashboard?: ProductBoardroomDashboardState | undefined;
  error?: string | undefined;
  holderPower?: BoardroomHolderPower | undefined;
  loading: boolean;
  primaryAction?: ReactNode;
  queueContent?: ReactNode;
  warning?: string | undefined;
};

export function GovernancePage({
  activityContent,
  dashboard,
  error,
  holderPower,
  loading,
  primaryAction,
  queueContent,
  warning,
}: GovernancePageProps): React.JSX.Element {
  if (loading && !dashboard) return <GovernanceLoading />;
  if (!dashboard) {
    return (
      <RuledSection>
        <PageNotice title="Governance is not loaded">
          Open a project before reading its launch state, authority, delay, and holder thresholds.
        </PageNotice>
      </RuledSection>
    );
  }

  const snapshot = dashboard.snapshot;
  const lifecycle = boardroomLifecycle(snapshot.status);
  const mode = governanceMode(snapshot.launched, snapshot.status);

  return (
    <>
      <RuledSection>
        <SectionHeading
          title="Decision system"
          description="Who can act, how long changes wait, and which holder protections are available right now."
          action={primaryAction}
        />
        {error ? <div className="mt-4"><PageNotice title="Governance data is incomplete" tone="danger">{error}</PageNotice></div> : null}
        {warning ? <div className="mt-4"><PageNotice title="Some queued decisions were not shown" tone="warning">{warning}</PageNotice></div> : null}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Badge variant={snapshot.launched ? "default" : "warning"}>{snapshot.launched ? "Holder governance live" : "Pre-launch authority"}</Badge>
          <Badge variant={lifecycle.tone}>{lifecycle.label}</Badge>
        </div>
        <p className="m-0 mt-3 max-w-3xl text-sm leading-6 text-zinc-400">{mode.description}</p>
        <KeyValueList
          columns={3}
          items={[
            { label: "Current authority", value: mode.authority },
            { label: "Owner", value: <AddressLink address={snapshot.owner} /> },
            { label: "Executor", value: snapshot.launched ? <AddressLink address={snapshot.executor} /> : "Not active" },
            { label: "Governance delay", value: formatDuration(snapshot.governanceDelay) },
            { label: "Eligible supply", value: formatTokenAmount(snapshot.governanceEligibleSupply, snapshot.shareTokenMetadata) },
            { label: "Governance epoch", value: snapshot.governanceEpoch.toString() },
          ]}
        />
      </RuledSection>

      <RuledSection>
        <SectionHeading title="Holder protections" description="Thresholds use governance-eligible supply, not the full token supply." />
        <div className="mt-4 grid border-y border-zinc-800 lg:grid-cols-3">
          <GovernanceRule
            icon={<Clock3 className="h-4 w-4" />}
            title="Review window"
            value={formatDuration(snapshot.governanceConfig.minimumDelay)}
            detail={`Queued actions remain executable for ${formatDuration(snapshot.governanceConfig.actionGracePeriod)} after the delay.`}
          />
          <GovernanceRule
            icon={<ShieldCheck className="h-4 w-4" />}
            title="Veto threshold"
            value={formatBasisPoints(snapshot.governanceConfig.vetoBps)}
            detail={holderPower ? holderThresholdDetail(holderPower.vetoRequired, snapshot.shareTokenMetadata, holderPower.canVeto, "veto") : "Connect a holder wallet to compare its voting power."}
          />
          <GovernanceRule
            icon={<Users className="h-4 w-4" />}
            title="Wind-down threshold"
            value={formatBasisPoints(snapshot.governanceConfig.windDownBps)}
            detail={holderPower ? holderThresholdDetail(holderPower.windDownRequired, snapshot.shareTokenMetadata, holderPower.canStartWindDown, "start wind-down") : "Connect a holder wallet to compare its voting power."}
          />
        </div>
        {holderPower ? <HolderPowerSummary holderPower={holderPower} dashboard={dashboard} /> : null}
      </RuledSection>

      <RuledSection>
        <SectionHeading
          title="Queued decisions"
          description={snapshot.launched
            ? "Pending actions are decoded before execution so holders can inspect their target, value, and intent."
            : "Direct owner actions apply before launch; the queue becomes the primary decision path after launch."}
        />
        <div className="mt-4">
          {queueContent ?? (
            <PageNotice title={snapshot.launched ? (error ? "Queued decisions are unavailable" : warning ? "No verified queued decisions" : "No queue data attached") : "Queue starts after launch"}>
              {snapshot.launched
                ? error
                  ? "The current queue could not be checked. Retry before concluding that no decisions are pending."
                  : warning
                    ? "Queue coverage is incomplete. Retry before assuming no decisions are pending."
                    : "The governance state is readable, but decoded queue events have not been attached to this view."
                : "Launching is a one-way authority transition. Review the executor and governance settings before continuing."}
            </PageNotice>
          )}
        </div>
      </RuledSection>

      {activityContent ? (
        <RuledSection>
          <SectionHeading title="Decision history" description="Queued, cancelled, vetoed, and executed governance events." />
          <div className="mt-4">{activityContent}</div>
        </RuledSection>
      ) : null}
    </>
  );
}

function GovernanceRule({
  detail,
  icon,
  title,
  value,
}: {
  detail: string;
  icon: ReactNode;
  title: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="border-b border-zinc-800 py-5 sm:px-4 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <div className="flex items-center gap-2 text-zinc-500">{icon}<span className="text-xs font-semibold uppercase tracking-[0.08em]">{title}</span></div>
      <p className="m-0 mt-3 text-xl font-semibold text-zinc-50">{value}</p>
      <p className="m-0 mt-2 text-xs leading-5 text-zinc-500">{detail}</p>
    </div>
  );
}

function HolderPowerSummary({
  dashboard,
  holderPower,
}: {
  dashboard: ProductBoardroomDashboardState;
  holderPower: BoardroomHolderPower;
}): React.JSX.Element {
  const metadata = dashboard.snapshot.shareTokenMetadata;
  return (
    <div className="mt-5 border-l-2 border-zinc-700 px-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-sm font-semibold text-zinc-100">Connected holder power</h3>
        {holderPower.encumbered ? <Badge variant="warning">Encumbered</Badge> : null}
      </div>
      <KeyValueList
        columns={4}
        items={[
          { label: "Holder", value: <AddressLink address={holderPower.account} /> },
          { label: "Current balance", value: formatTokenAmount(holderPower.currentBalance, metadata) },
          { label: "Snapshot balance", value: formatTokenAmount(holderPower.pastBalance, metadata) },
          { label: "Snapshot block", value: holderPower.snapshotBlock.toString() },
        ]}
      />
    </div>
  );
}

function GovernanceLoading(): React.JSX.Element {
  return (
    <div aria-label="Loading governance" aria-live="polite" className="grid animate-pulse gap-5 py-6" role="status">
      <span className="h-32 rounded bg-zinc-900" />
      <span className="h-48 rounded bg-zinc-900" />
    </div>
  );
}

function governanceMode(launched: boolean, status: number): { authority: string; description: string } {
  if (status === 1) return { authority: launched ? "Governance wind-down" : "Wind-down operators", description: "The project is unwinding obligations. Only lifecycle-safe cleanup actions should proceed." };
  if (status === 2) return { authority: "Token holders", description: "Redemptions are open. Holders can exchange project tokens for their share of redeemable assets." };
  if (launched) return { authority: "Executor + holders", description: "The executor queues actions. The delay gives holders time to inspect or veto them before anyone executes a ready action." };
  return { authority: "Owner", description: "The owner can act directly before launch. Launching permanently switches routine project changes to delayed holder governance." };
}

function formatDuration(seconds: bigint): string {
  if (seconds === 0n) return "No delay";
  if (seconds % 86_400n === 0n) return `${seconds / 86_400n} ${(seconds / 86_400n) === 1n ? "day" : "days"}`;
  if (seconds % 3_600n === 0n) return `${seconds / 3_600n} ${(seconds / 3_600n) === 1n ? "hour" : "hours"}`;
  if (seconds % 60n === 0n) return `${seconds / 60n} ${(seconds / 60n) === 1n ? "minute" : "minutes"}`;
  return `${seconds} seconds`;
}

function formatBasisPoints(value: bigint): string {
  const whole = value / 100n;
  const fraction = value % 100n;
  return fraction === 0n ? `${whole}%` : `${whole}.${fraction.toString().padStart(2, "0").replace(/0+$/, "")}%`;
}

function holderThresholdDetail(
  required: bigint,
  metadata: ProductBoardroomDashboardState["snapshot"]["shareTokenMetadata"],
  canAct: boolean,
  action: string,
): string {
  return `${formatTokenAmount(required, metadata)} required. This wallet ${canAct ? "can" : "cannot"} ${action} at the current and snapshot supply checks.`;
}
