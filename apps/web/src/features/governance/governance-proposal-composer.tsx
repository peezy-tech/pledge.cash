import { buildBoardroomSetExecutorCall, type Address } from "@pledge.cash/sdk";
import { ArrowRight, Clock3, ShieldCheck } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { getAddress, isAddress } from "viem";
import { AddressLink, ActionButton } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import {
  TransactionContextGuard,
  type TransactionActionGuard,
  type TransactionContextTicket,
} from "../../lib/transaction-identity";
import type { Capability } from "../capabilities/project-capabilities";
import type { GovernanceRunAction } from "./types";
import { formatGovernanceDuration, formatGovernanceTimestamp, governanceCallView } from "./view-model";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type GovernanceProposalComposerProps = {
  boardroom: Address;
  capability: Capability;
  currentExecutor: Address;
  governanceDelay: bigint;
  gracePeriod: bigint;
  pendingAction: string | undefined;
  queueExecutorChange: (executor: Address, actionGuard: TransactionActionGuard) => Promise<void>;
  runAction: GovernanceRunAction;
  now?: bigint | undefined;
};

export function GovernanceProposalComposer({
  boardroom,
  capability,
  currentExecutor,
  governanceDelay,
  gracePeriod,
  pendingAction,
  queueExecutorChange,
  runAction,
  now = BigInt(Math.floor(Date.now() / 1_000)),
}: GovernanceProposalComposerProps): React.JSX.Element {
  const [executorInput, setExecutorInput] = useState("");
  const inputId = useId();
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;
  const error = executorProposalError(executorInput, currentExecutor);
  const showError = executorInput.trim().length > 0 && Boolean(error);
  const executor = error ? undefined : getAddress(executorInput);
  const call = useMemo(() => executor
    ? buildBoardroomSetExecutorCall({ boardroom, executor })
    : undefined, [boardroom, executor]);
  const view = call ? governanceCallView(call, boardroom) : undefined;
  const actionId = "governance-queue-executor-change";
  const eta = now + governanceDelay;
  const expiresAt = eta + gracePeriod;
  const proposalIdentity = executorProposalIdentity({ boardroom, currentExecutor, executorInput });
  const proposalGuardRef = useRef<TransactionContextGuard | undefined>(undefined);
  proposalGuardRef.current ??= new TransactionContextGuard(proposalIdentity);
  const proposalGuard = proposalGuardRef.current;
  proposalGuard.sync(proposalIdentity);
  const proposalPending = pendingAction === actionId;
  const disabled = Boolean(error || !view || view.verification !== "verified" || capability.status !== "enabled" || proposalPending);

  const submitProposal = (): void => {
    if (!executor || disabled) return;
    const ticket = proposalGuard.capture();
    const actionGuard = executorProposalActionGuard(proposalGuard, ticket);
    void runAction(actionId, async () => await queueExecutorChange(executor, actionGuard));
  };

  return (
    <form
      aria-label="Executor rotation proposal"
      className="border-y border-[var(--pc-border)]"
      onSubmit={(event) => {
        event.preventDefault();
        submitProposal();
      }}
    >
      <div className="grid gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted">Executor rotation</Badge>
            <Badge variant={view?.verification === "verified" ? "default" : "muted"}>
              {view?.verification === "verified" ? "Verified decode" : "Draft"}
            </Badge>
          </div>
          <h3 className="m-0 mt-3 text-base font-semibold text-[var(--pc-text)]">Change who can queue project decisions</h3>
          <p className="m-0 mt-1 max-w-2xl text-sm leading-6 text-[var(--pc-text-muted)]">
            The current executor queues this self-call. It changes authority only after the holder review window and permissionless execution.
          </p>
          <div className="mt-4 grid max-w-xl gap-1.5">
            <label className="text-xs font-semibold text-[var(--pc-text-muted)]" htmlFor={inputId}>New executor</label>
            <p className="m-0 text-xs leading-5 text-[var(--pc-text-subtle)]" id={descriptionId}>
              Enter the address that should queue decisions after this proposal is executed.
            </p>
            <Input
              aria-describedby={`${descriptionId}${showError ? ` ${errorId}` : ""}`}
              aria-errormessage={showError ? errorId : undefined}
              aria-invalid={showError || undefined}
              autoComplete="off"
              disabled={proposalPending}
              id={inputId}
              name="executor"
              placeholder="0x..."
              value={executorInput}
              onChange={(event) => setExecutorInput(event.target.value)}
            />
          </div>
          {showError ? <p className="m-0 mt-2 text-xs text-[var(--pc-danger)]" id={errorId} role="alert">{error}</p> : null}
          {capability.status !== "enabled" && capability.status !== "hidden" ? (
            <p className="m-0 mt-2 text-xs leading-5 text-[var(--pc-warning)]">{capability.reason ?? "Only the current executor can queue this proposal."}</p>
          ) : null}
        </div>

        <dl className="m-0 grid gap-px border border-[var(--pc-border)] bg-[var(--pc-border)] text-xs">
          <ProposalFact label="Current executor"><AddressLink address={currentExecutor} /></ProposalFact>
          <ProposalFact label="Proposed executor">{executor ? <AddressLink address={executor} /> : "Enter an address"}</ProposalFact>
          <ProposalFact label="Earliest execution">{formatGovernanceTimestamp(eta)}</ProposalFact>
          <ProposalFact label="Proposal expires">{formatGovernanceTimestamp(expiresAt)}</ProposalFact>
          <ProposalFact label="Execution window">{formatGovernanceDuration(gracePeriod)}</ProposalFact>
        </dl>
      </div>

      {view ? (
        <div className="border-t border-[var(--pc-border)] py-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--pc-text-muted)]">
            <ShieldCheck className="h-4 w-4" /> Exact decoded call
          </div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <ProposalDetail label="Target" value={view.target} />
            <ProposalDetail label="Function" value={view.signature ?? view.selector} />
            <ProposalDetail label="Native value" value={view.valueLabel} />
          </div>
          <code className="mt-3 block max-h-24 overflow-auto break-all bg-[var(--pc-surface-subtle)] p-3 font-mono text-[11px] leading-5 text-[var(--pc-text-muted)]">
            {view.data}
          </code>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-[var(--pc-border)] py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 flex items-center gap-2 text-xs leading-5 text-[var(--pc-text-muted)]">
          <Clock3 className="h-4 w-4 shrink-0" /> Queueing does not change authority immediately.
        </p>
        <ActionButton
          actionId={actionId}
          disabled={disabled}
          pendingAction={pendingAction}
          pendingLabel="Queueing executor proposal"
          type="submit"
        >
          {proposalPending ? "Queueing proposal" : "Review proposal"}
          <ArrowRight className="h-4 w-4" />
        </ActionButton>
      </div>
    </form>
  );
}

export function executorProposalIdentity(input: {
  boardroom: Address;
  currentExecutor: Address;
  executorInput: string;
}): string {
  return JSON.stringify([
    input.boardroom.toLowerCase(),
    input.currentExecutor.toLowerCase(),
    input.executorInput.trim().toLowerCase(),
  ]);
}

export function executorProposalActionGuard(
  guard: TransactionContextGuard,
  ticket: TransactionContextTicket,
): TransactionActionGuard {
  return { isCurrent: () => guard.isCurrent(ticket) };
}

export function executorProposalError(value: string, currentExecutor: Address): string | undefined {
  if (!value.trim()) return "Enter the proposed executor.";
  if (!isAddress(value, { strict: false })) return "Enter a valid executor address.";
  if (value.toLowerCase() === ZERO_ADDRESS) return "The executor cannot be the zero address.";
  if (value.toLowerCase() === currentExecutor.toLowerCase()) return "Choose an address other than the current executor.";
  return undefined;
}

function ProposalFact({ children, label }: { children: React.ReactNode; label: string }): React.JSX.Element {
  return <div className="min-w-0 bg-[var(--pc-surface-subtle)] p-3"><dt className="text-[var(--pc-text-muted)]">{label}</dt><dd className="m-0 mt-1 break-all text-sm font-medium text-[var(--pc-text)]">{children}</dd></div>;
}

function ProposalDetail({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div><span className="text-[var(--pc-text-subtle)]">{label}</span><code className="mt-1 block break-all text-[var(--pc-text)]">{value}</code></div>;
}
