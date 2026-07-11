import type { QueuedBoardroomAction } from "@pledge.cash/sdk";
import { CheckCircle2, ChevronDown, Clock3, ShieldX } from "lucide-react";
import { AddressLink, ActionButton, TechnicalDetails } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import type { Capability } from "../capabilities/project-capabilities";
import type {
  GovernanceControlContext,
  GovernanceQueueCapabilities,
} from "./types";
import {
  buildGovernanceExecutionRequest,
  buildGovernanceVetoRequest,
  canExecuteQueuedAction,
  canVetoQueuedAction,
  effectiveGovernanceActionStatus,
  formatGovernanceTimestamp,
  governanceActionView,
} from "./view-model";

export type GovernanceQueueProps = GovernanceControlContext & {
  actions: readonly QueuedBoardroomAction[];
  capabilities: GovernanceQueueCapabilities;
  now?: bigint | undefined;
};

export function GovernanceQueue({
  account,
  actions,
  capabilities,
  now,
  pendingAction,
  runAction,
  submitTransaction,
}: GovernanceQueueProps): React.JSX.Element {
  if (actions.length === 0) {
    return (
      <div className="border-y border-[var(--pc-border)] py-5" role="status">
        <p className="m-0 text-sm font-semibold text-[var(--pc-text)]">No queued decisions</p>
        <p className="m-0 mt-1 text-sm leading-5 text-[var(--pc-text-muted)]">
          New governance actions will appear here with their review and execution windows.
        </p>
      </div>
    );
  }

  return (
    <ol className="m-0 list-none border-t border-[var(--pc-border)] p-0" aria-label="Governance queue">
      {actions.map((action) => (
        <GovernanceQueueRow
          account={account}
          action={action}
          capabilities={capabilities}
          key={`${action.actionHash}:${action.queueBlockNumber.toString()}`}
          now={now}
          pendingAction={pendingAction}
          runAction={runAction}
          submitTransaction={submitTransaction}
        />
      ))}
    </ol>
  );
}

function GovernanceQueueRow({
  account,
  action,
  capabilities,
  now,
  pendingAction,
  runAction,
  submitTransaction,
}: Omit<GovernanceQueueProps, "actions"> & { action: QueuedBoardroomAction }): React.JSX.Element {
  const renderNow = now ?? BigInt(Math.floor(Date.now() / 1_000));
  const effectiveStatus = effectiveGovernanceActionStatus(action, renderNow);
  const effectiveAction = effectiveStatus === action.status ? action : { ...action, status: effectiveStatus };
  const view = governanceActionView(effectiveAction, renderNow);
  const vetoActionId = `governance-veto-${action.actionHash}`;
  const executeActionId = `governance-execute-${action.actionHash}`;
  const vetoAvailable = canVetoQueuedAction(effectiveAction, renderNow);
  const executionVerified = canExecuteQueuedAction(effectiveAction, renderNow)
    && view.calls.length > 0
    && view.calls.every((call) => call.verification === "verified");
  const showActions = vetoAvailable || effectiveStatus === "ready";

  const actionTime = (): bigint => now ?? BigInt(Math.floor(Date.now() / 1_000));

  const veto = async (): Promise<void> => {
    await submitTransaction("Veto queued governance action", buildGovernanceVetoRequest(effectiveAction, actionTime()));
  };

  const execute = async (): Promise<void> => {
    await submitTransaction("Execute queued governance action", buildGovernanceExecutionRequest(effectiveAction, actionTime()));
  };

  return (
    <li className="border-b border-[var(--pc-border)] py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={view.statusTone}>{view.statusLabel}</Badge>
            <span className="text-xs text-[var(--pc-text-muted)]">
              {action.kind === "queueBatch" ? `${view.calls.length.toString()} calls` : "Single action"}
            </span>
          </div>
          <h3 className="m-0 mt-3 text-base font-semibold text-[var(--pc-text)]">{view.title}</h3>
          <p className="m-0 mt-1 text-sm leading-5 text-[var(--pc-text-muted)]">{view.statusDescription}</p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <p className="m-0 text-xs font-medium uppercase tracking-[0.08em] text-[var(--pc-text-muted)]">Expires</p>
          <time className="mt-1 block text-sm font-medium text-[var(--pc-text)]" dateTime={unixDateTime(action.expiresAt)}>
            {view.expiryLabel}
          </time>
        </div>
      </div>

      <dl className="mt-4 grid gap-px border-y border-[var(--pc-border)] bg-[var(--pc-border)] sm:grid-cols-3">
        <QueueFact label="Queued by"><AddressLink address={action.executor} /></QueueFact>
        <QueueFact label="Review ends">
          <time dateTime={unixDateTime(action.eta)}>{formatGovernanceTimestamp(action.eta)}</time>
        </QueueFact>
        <QueueFact label="Governance epoch">{action.epoch.toString()}</QueueFact>
      </dl>

      <TechnicalDetails summary="Inspect targets and calldata">
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <TechnicalFact label="Action hash"><code className="break-all text-[var(--pc-text)]">{action.actionHash}</code></TechnicalFact>
          <TechnicalFact label="Queue transaction"><code className="break-all text-[var(--pc-text)]">{action.queueTransactionHash}</code></TechnicalFact>
          <TechnicalFact label="Execution salt"><code className="break-all text-[var(--pc-text)]">{action.salt}</code></TechnicalFact>
          <TechnicalFact label="Epoch check">Queued {action.epoch.toString()} · Current {action.currentEpoch.toString()}</TechnicalFact>
        </dl>
        {view.payloadError ? (
          <p className="mt-3 border-l-2 border-[var(--pc-danger)] pl-3 text-sm text-[var(--pc-text-muted)]">
            Calldata verification failed: {view.payloadError}
          </p>
        ) : null}
        {view.calls.length > 0 ? (
          <ol className="m-0 mt-4 list-none space-y-4 p-0">
            {view.calls.map((call, index) => (
              <li className="border-l-2 border-[var(--pc-border-strong)] pl-3" key={`${call.target}:${index.toString()}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="m-0 text-sm font-semibold text-[var(--pc-text)]">
                    {view.calls.length > 1 ? `${(index + 1).toString()}. ` : ""}{call.label}
                  </p>
                  <Badge variant={call.verification === "verified" ? "muted" : "warning"}>
                    {call.verification === "verified" ? "Verified decode" : "Unverified call"}
                  </Badge>
                </div>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <TechnicalFact label="Target"><AddressLink address={call.target} /></TechnicalFact>
                  <TechnicalFact label="Policy"><AddressLink address={call.policy} /></TechnicalFact>
                  <TechnicalFact label="Function selector"><code className="text-[var(--pc-text)]">{call.selector}</code></TechnicalFact>
                  <TechnicalFact label="Native value">{call.valueLabel}</TechnicalFact>
                  {call.signature ? <TechnicalFact label="Decoded function"><code className="break-all text-[var(--pc-text)]">{call.signature}</code></TechnicalFact> : null}
                </dl>
                {call.verificationReason ? (
                  <p className="mt-3 border-l-2 border-[var(--pc-warning)] pl-3 text-xs leading-5 text-[var(--pc-text-muted)]">
                    {call.verificationReason} Review the raw calldata independently; this app will not offer execution for an unverified call.
                  </p>
                ) : null}
                {call.parameters.length > 0 ? (
                  <dl className="mt-3 grid gap-px overflow-hidden border border-[var(--pc-border)] bg-[var(--pc-border)] text-xs sm:grid-cols-2">
                    {call.parameters.map((parameter, parameterIndex) => (
                      <div className="min-w-0 bg-[var(--pc-surface)] p-3" key={`${parameter.name}:${parameterIndex.toString()}`}>
                        <dt className="break-words text-[var(--pc-text-muted)]">{parameter.name} <span className="font-mono text-[10px]">({parameter.type})</span></dt>
                        <dd className="m-0 mt-1 break-all font-mono leading-5 text-[var(--pc-text)]">{parameter.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <details className="mt-3">
                  <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-[var(--pc-text-muted)] hover:text-[var(--pc-text)]">
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> Raw calldata
                  </summary>
                  <code className="mt-2 block max-h-36 overflow-auto break-all rounded bg-[var(--pc-surface)] p-2 font-mono text-[11px] leading-5 text-[var(--pc-text-muted)]">
                    {call.data}
                  </code>
                </details>
              </li>
            ))}
          </ol>
        ) : null}
      </TechnicalDetails>

      {showActions ? (
        <div
          aria-label={`Governance actions for ${account ?? "read-only access"}`}
          className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-wrap gap-2">
            {vetoAvailable ? (
              <ActionButton
                actionId={vetoActionId}
                disabled={!capabilityEnabled(capabilities["governance.veto"])}
                pendingAction={pendingAction}
                variant="danger"
                onClick={() => void runAction(vetoActionId, veto)}
              >
                <ShieldX className="h-4 w-4" aria-hidden="true" />
                {pendingAction === vetoActionId ? "Vetoing" : "Veto action"}
              </ActionButton>
            ) : null}
            {effectiveStatus === "ready" ? (
              <ActionButton
                actionId={executeActionId}
                disabled={!executionVerified || !capabilityEnabled(capabilities["governance.executeReady"])}
                pendingAction={pendingAction}
                onClick={() => void runAction(executeActionId, execute)}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {pendingAction === executeActionId ? "Executing" : "Execute now"}
              </ActionButton>
            ) : null}
          </div>
          <ActionAvailability
            executeCapability={effectiveStatus === "ready" ? capabilities["governance.executeReady"] : undefined}
            executionVerified={executionVerified}
            vetoCapability={vetoAvailable ? capabilities["governance.veto"] : undefined}
          />
        </div>
      ) : null}
    </li>
  );
}

function QueueFact({ children, label }: { children: React.ReactNode; label: string }): React.JSX.Element {
  return (
    <div className="min-w-0 bg-[var(--pc-surface-subtle)] p-3">
      <dt className="text-xs text-[var(--pc-text-muted)]">{label}</dt>
      <dd className="m-0 mt-1 break-words text-sm font-medium text-[var(--pc-text)]">{children}</dd>
    </div>
  );
}

function TechnicalFact({ children, label }: { children: React.ReactNode; label: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[var(--pc-text-muted)]">{label}</dt>
      <dd className="m-0 mt-1 break-words">{children}</dd>
    </div>
  );
}

function ActionAvailability({
  executeCapability,
  executionVerified,
  vetoCapability,
}: {
  executeCapability?: Capability | undefined;
  executionVerified: boolean;
  vetoCapability?: Capability | undefined;
}): React.JSX.Element | null {
  const reasons = [
    !executionVerified && executeCapability ? "Execution is disabled until the original queue calldata is verified and every inner call is decoded." : undefined,
    capabilityReason(vetoCapability),
    capabilityReason(executeCapability),
  ].filter((reason, index, all): reason is string => Boolean(reason) && all.indexOf(reason) === index);
  if (reasons.length === 0) return null;
  return (
    <div className="max-w-md text-xs leading-5 text-[var(--pc-text-muted)]">
      {reasons.map((reason) => (
        <p className="m-0" key={reason}>
          <Clock3 className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
          {reason}
        </p>
      ))}
    </div>
  );
}

function capabilityEnabled(capability: Capability): boolean {
  return capability.status === "enabled";
}

function capabilityReason(capability: Capability | undefined): string | undefined {
  if (!capability || capability.status === "enabled" || capability.status === "hidden") return undefined;
  return capability.reason ?? "This action is not available to the connected wallet.";
}

function unixDateTime(seconds: bigint): string | undefined {
  const milliseconds = seconds * 1_000n;
  if (seconds <= 0n || milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return new Date(Number(milliseconds)).toISOString();
}
