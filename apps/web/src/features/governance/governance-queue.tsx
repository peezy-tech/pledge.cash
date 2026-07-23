import type { ScheduledBoardroomOperation } from "@pledge.cash/sdk";
import { CheckCircle2, ChevronDown, Clock3, ShieldX } from "lucide-react";
import { AddressLink, ActionButton, TechnicalDetails } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import type { Capability } from "../capabilities/project-capabilities";
import type {
  GovernanceControlContext,
  GovernanceOperationCapabilities,
} from "./types";
import {
  buildGovernanceExecutionRequest,
  buildGovernanceVetoRequest,
  canExecuteScheduledOperation,
  canVetoScheduledOperation,
  effectiveGovernanceOperationStatus,
  formatGovernanceTimestamp,
  governanceOperationView,
} from "./view-model";

export type GovernanceOperationsProps = GovernanceControlContext & {
  operations: readonly ScheduledBoardroomOperation[];
  capabilities: GovernanceOperationCapabilities;
  now?: bigint | undefined;
};

export function GovernanceOperations({
  account,
  operations,
  capabilities,
  now,
  pendingAction,
  runAction,
  submitTransaction,
}: GovernanceOperationsProps): React.JSX.Element {
  if (operations.length === 0) {
    return (
      <div className="border-y border-[var(--pc-border)] py-5" role="status">
        <p className="m-0 text-sm font-semibold text-[var(--pc-text)]">No scheduled operations</p>
        <p className="m-0 mt-1 text-sm leading-5 text-[var(--pc-text-muted)]">
          New controller operations will appear here with their review and execution windows.
        </p>
      </div>
    );
  }

  return (
    <ol className="m-0 list-none border-t border-[var(--pc-border)] p-0" aria-label="Scheduled governance operations">
      {operations.map((operation) => (
        <GovernanceOperationRow
          account={account}
          operation={operation}
          capabilities={capabilities}
          key={`${operation.operationId}:${operation.scheduleBlockNumber.toString()}`}
          now={now}
          pendingAction={pendingAction}
          runAction={runAction}
          submitTransaction={submitTransaction}
        />
      ))}
    </ol>
  );
}

function GovernanceOperationRow({
  account,
  operation,
  capabilities,
  now,
  pendingAction,
  runAction,
  submitTransaction,
}: Omit<GovernanceOperationsProps, "operations"> & { operation: ScheduledBoardroomOperation }): React.JSX.Element {
  const renderNow = now ?? BigInt(Math.floor(Date.now() / 1_000));
  const effectiveStatus = effectiveGovernanceOperationStatus(operation, renderNow);
  const effectiveOperation = effectiveStatus === operation.status ? operation : { ...operation, status: effectiveStatus };
  const view = governanceOperationView(effectiveOperation, renderNow);
  const vetoActionId = `governance-veto-${operation.operationId}`;
  const executeActionId = `governance-execute-${operation.operationId}`;
  const vetoAvailable = canVetoScheduledOperation(effectiveOperation, renderNow);
  const executionVerified = canExecuteScheduledOperation(effectiveOperation, renderNow)
    && (operation.kind === "controllerOperation"
      || (view.calls.length > 0 && view.calls.every((call) => call.verification === "verified")));
  const showActions = vetoAvailable || effectiveStatus === "ready";

  const actionTime = (): bigint => now ?? BigInt(Math.floor(Date.now() / 1_000));

  const veto = async (): Promise<void> => {
    await submitTransaction("Veto scheduled governance operation", buildGovernanceVetoRequest(effectiveOperation, actionTime()));
  };

  const execute = async (): Promise<void> => {
    await submitTransaction("Execute scheduled governance operation", buildGovernanceExecutionRequest(effectiveOperation, actionTime()));
  };

  return (
    <li className="border-b border-[var(--pc-border)] py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={view.statusTone}>{view.statusLabel}</Badge>
            <span className="text-xs text-[var(--pc-text-muted)]">
              {operation.kind === "controllerOperation"
                ? "Controller configuration"
                : view.calls.length > 1 ? `${view.calls.length.toString()} calls` : "Boardroom operation"}
            </span>
          </div>
          <h3 className="m-0 mt-3 text-base font-semibold text-[var(--pc-text)]">{view.title}</h3>
          <p className="m-0 mt-1 text-sm leading-5 text-[var(--pc-text-muted)]">{view.statusDescription}</p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <p className="m-0 text-xs font-medium uppercase tracking-[0.08em] text-[var(--pc-text-muted)]">Expires</p>
          <time className="mt-1 block text-sm font-medium text-[var(--pc-text)]" dateTime={unixDateTime(operation.expiresAt)}>
            {view.expiryLabel}
          </time>
        </div>
      </div>

      <dl className="mt-4 grid gap-px border-y border-[var(--pc-border)] bg-[var(--pc-border)] sm:grid-cols-3">
        <QueueFact label="Scheduled by"><AddressLink address={operation.proposer} /></QueueFact>
        <QueueFact label="Review ends">
          <time dateTime={unixDateTime(operation.eta)}>{formatGovernanceTimestamp(operation.eta)}</time>
        </QueueFact>
        <QueueFact label="Controller generation">{operation.controllerGeneration.toString()}</QueueFact>
      </dl>

      <TechnicalDetails summary="Inspect targets and calldata">
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <TechnicalFact label="Operation ID"><code className="break-all text-[var(--pc-text)]">{operation.operationId}</code></TechnicalFact>
          <TechnicalFact label="Schedule transaction"><code className="break-all text-[var(--pc-text)]">{operation.scheduleTransactionHash}</code></TechnicalFact>
          <TechnicalFact label="Execution salt"><code className="break-all text-[var(--pc-text)]">{operation.salt}</code></TechnicalFact>
          <TechnicalFact label="Boardroom epoch">Scheduled {operation.boardroomEpoch.toString()} · Current {operation.currentBoardroomEpoch.toString()}</TechnicalFact>
          <TechnicalFact label="Configuration epoch">Scheduled {operation.configurationEpoch.toString()} · Current {operation.currentConfigurationEpoch.toString()}</TechnicalFact>
          <TechnicalFact label="Controller"><AddressLink address={operation.controller} /></TechnicalFact>
        </dl>
        {view.payloadError ? (
          <p className="mt-3 border-l-2 border-[var(--pc-danger)] pl-3 text-sm text-[var(--pc-text-muted)]">
            Scheduled calldata verification failed: {view.payloadError}
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
                {pendingAction === vetoActionId ? "Vetoing" : "Veto operation"}
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
    !executionVerified && executeCapability ? "Execution is disabled until the original scheduled calldata is verified and every inner call is decoded." : undefined,
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
