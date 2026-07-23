import { boardroomControllerAbi, type Address } from "@pledge.cash/sdk";
import { ArrowRight, Clock3, ShieldCheck } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { encodeFunctionData, getAddress } from "viem";
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
import {
  formatGovernanceDuration,
  formatGovernanceTimestamp,
  governanceProposerError,
} from "./view-model";

const MIN_CONTROLLER_DURATION = 86_400n;
const MAX_CONTROLLER_DURATION = 30n * MIN_CONTROLLER_DURATION;

export type GovernanceProposalComposerProps = {
  boardroom: Address;
  capability: Capability;
  configurationEpoch: bigint;
  controller: Address;
  controllerDelay: bigint;
  controllerGeneration?: bigint | undefined;
  currentProposer: Address;
  governanceEpoch: bigint;
  gracePeriod: bigint;
  pendingAction: string | undefined;
  predictedNextController?: Address | undefined;
  runAction: GovernanceRunAction;
  scheduleConfigurationChange: (
    proposer: Address,
    delay: bigint,
    gracePeriod: bigint,
    actionGuard: TransactionActionGuard,
  ) => Promise<void>;
  scheduleControllerReplacement?: (
    proposer: Address,
    delay: bigint,
    gracePeriod: bigint,
    expectedNextController: Address,
    nextGeneration: bigint,
    actionGuard: TransactionActionGuard,
  ) => Promise<void>;
  now?: bigint | undefined;
};

export function GovernanceProposalComposer({
  boardroom,
  capability,
  configurationEpoch,
  controller,
  controllerDelay,
  controllerGeneration,
  currentProposer,
  governanceEpoch,
  gracePeriod,
  pendingAction,
  predictedNextController,
  runAction,
  scheduleConfigurationChange,
  scheduleControllerReplacement,
  now = BigInt(Math.floor(Date.now() / 1_000)),
}: GovernanceProposalComposerProps): React.JSX.Element {
  const [proposerInput, setProposerInput] = useState("");
  const [delayInput, setDelayInput] = useState(controllerDelay.toString());
  const [graceInput, setGraceInput] = useState(gracePeriod.toString());
  const inputId = useId();
  const proposerError = proposerInput.trim()
    ? governanceProposerError(proposerInput, currentProposer)
    : "Enter the proposed controller proposer.";
  const delay = durationInput(delayInput);
  const grace = durationInput(graceInput);
  const durationError = controllerDurationError(delay, grace);
  const proposer = proposerError ? undefined : getAddress(proposerInput);
  const data = useMemo(() => proposer && delay !== undefined && grace !== undefined
    ? encodeFunctionData({
      abi: boardroomControllerAbi,
      functionName: "updateConfiguration",
      args: [proposer, delay, grace],
    })
    : undefined, [delay, grace, proposer]);
  const actionId = "governance-schedule-controller-configuration";
  const replacementActionId = "governance-schedule-controller-replacement";
  const eta = now + controllerDelay;
  const expiresAt = eta + gracePeriod;
  const proposalIdentity = controllerConfigurationProposalIdentity({
    boardroom,
    configurationEpoch,
    controller,
    currentProposer,
    controllerGeneration,
    delayInput,
    governanceEpoch,
    graceInput,
    proposerInput,
    predictedNextController,
  });
  const proposalGuardRef = useRef<TransactionContextGuard | undefined>(undefined);
  proposalGuardRef.current ??= new TransactionContextGuard(proposalIdentity);
  const proposalGuard = proposalGuardRef.current;
  proposalGuard.sync(proposalIdentity);
  const proposalPending = pendingAction === actionId;
  const replacementPending = pendingAction === replacementActionId;
  const disabled = Boolean(
    proposerError || durationError || !data || capability.status !== "enabled" || proposalPending,
  );

  const submitProposal = (): void => {
    if (!proposer || delay === undefined || grace === undefined || disabled) return;
    const ticket = proposalGuard.capture();
    const actionGuard = controllerConfigurationProposalActionGuard(proposalGuard, ticket);
    void runAction(
      actionId,
      async () => await scheduleConfigurationChange(proposer, delay, grace, actionGuard),
    );
  };

  const submitReplacement = (): void => {
    if (
      !proposer || delay === undefined || grace === undefined || !predictedNextController
        || controllerGeneration === undefined || !scheduleControllerReplacement || disabled
    ) return;
    const ticket = proposalGuard.capture();
    const actionGuard = controllerConfigurationProposalActionGuard(proposalGuard, ticket);
    void runAction(
      replacementActionId,
      async () => await scheduleControllerReplacement(
        proposer,
        delay,
        grace,
        predictedNextController,
        controllerGeneration + 1n,
        actionGuard,
      ),
    );
  };

  return (
    <form
      aria-label="Controller configuration proposal"
      className="border-y border-[var(--pc-border)]"
      onSubmit={(event) => {
        event.preventDefault();
        submitProposal();
      }}
    >
      <div className="grid gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted">Controller self-governance</Badge>
            <Badge variant={data ? "default" : "muted"}>{data ? "Exact calldata" : "Draft"}</Badge>
          </div>
          <h3 className="m-0 mt-3 text-base font-semibold text-[var(--pc-text)]">
            Change the proposer or controller timing
          </h3>
          <p className="m-0 mt-1 max-w-2xl text-sm leading-6 text-[var(--pc-text-muted)]">
            Only the current proposer can schedule this controller self-call. Execution is permissionless after the
            delay, and success advances the configuration epoch so older operations cannot execute.
          </p>
          <div className="mt-4 grid max-w-2xl gap-3 sm:grid-cols-3">
            <label className="grid gap-1.5 text-xs font-semibold text-[var(--pc-text-muted)]" htmlFor={inputId}>
              New proposer
              <Input
                autoComplete="off"
                disabled={proposalPending}
                id={inputId}
                name="proposer"
                placeholder="0x..."
                value={proposerInput}
                onChange={(event) => setProposerInput(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-[var(--pc-text-muted)]">
              Delay in seconds
              <Input
                disabled={proposalPending}
                inputMode="numeric"
                name="controllerDelay"
                value={delayInput}
                onChange={(event) => setDelayInput(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-[var(--pc-text-muted)]">
              Grace period in seconds
              <Input
                disabled={proposalPending}
                inputMode="numeric"
                name="controllerGracePeriod"
                value={graceInput}
                onChange={(event) => setGraceInput(event.target.value)}
              />
            </label>
          </div>
          {proposerInput.trim() && proposerError ? (
            <p className="m-0 mt-2 text-xs text-[var(--pc-danger)]" role="alert">{proposerError}</p>
          ) : null}
          {durationError ? <p className="m-0 mt-2 text-xs text-[var(--pc-danger)]" role="alert">{durationError}</p> : null}
          {capability.status !== "enabled" && capability.status !== "hidden" ? (
            <p className="m-0 mt-2 text-xs leading-5 text-[var(--pc-warning)]">
              {capability.reason ?? "Only the current proposer can schedule this operation."}
            </p>
          ) : null}
        </div>

        <dl className="m-0 grid gap-px border border-[var(--pc-border)] bg-[var(--pc-border)] text-xs">
          <ProposalFact label="Current proposer"><AddressLink address={currentProposer} /></ProposalFact>
          <ProposalFact label="Proposed proposer">{proposer ? <AddressLink address={proposer} /> : "Enter an address"}</ProposalFact>
          {predictedNextController && controllerGeneration !== undefined ? (
            <ProposalFact label={`Predicted generation ${(controllerGeneration + 1n).toString()}`}>
              <AddressLink address={predictedNextController} />
            </ProposalFact>
          ) : null}
          <ProposalFact label="Earliest execution">{formatGovernanceTimestamp(eta)}</ProposalFact>
          <ProposalFact label="Current execution window">{formatGovernanceDuration(gracePeriod)}</ProposalFact>
          <ProposalFact label="Current expiry">{formatGovernanceTimestamp(expiresAt)}</ProposalFact>
        </dl>
      </div>

      {data ? (
        <div className="border-t border-[var(--pc-border)] py-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--pc-text-muted)]">
            <ShieldCheck className="h-4 w-4" /> Exact controller self-call
          </div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <ProposalDetail label="Target" value={controller} />
            <ProposalDetail label="Function" value="updateConfiguration(address,uint64,uint64)" />
            <ProposalDetail label="Epoch binding" value={`${governanceEpoch.toString()} / ${configurationEpoch.toString()}`} />
          </div>
          <code className="mt-3 block max-h-24 overflow-auto break-all bg-[var(--pc-surface-subtle)] p-3 font-mono text-[11px] leading-5 text-[var(--pc-text-muted)]">
            {data}
          </code>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-[var(--pc-border)] py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 flex items-center gap-2 text-xs leading-5 text-[var(--pc-text-muted)]">
          <Clock3 className="h-4 w-4 shrink-0" /> Scheduling does not change authority immediately; replacement deploys the next controller atomically only when executed.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          {predictedNextController && controllerGeneration !== undefined && scheduleControllerReplacement ? (
            <ActionButton
              actionId={replacementActionId}
              disabled={disabled || replacementPending}
              pendingAction={pendingAction}
              pendingLabel="Scheduling controller replacement"
              type="button"
              variant="secondary"
              onClick={submitReplacement}
            >
              {replacementPending ? "Scheduling replacement" : `Replace with generation ${(controllerGeneration + 1n).toString()}`}
            </ActionButton>
          ) : null}
          <ActionButton
            actionId={actionId}
            disabled={disabled}
            pendingAction={pendingAction}
            pendingLabel="Scheduling controller configuration"
            type="submit"
          >
            {proposalPending ? "Scheduling operation" : "Review operation"}
            <ArrowRight className="h-4 w-4" />
          </ActionButton>
        </div>
      </div>
    </form>
  );
}

export function controllerConfigurationProposalIdentity(input: {
  boardroom: Address;
  configurationEpoch: bigint;
  controller: Address;
  currentProposer: Address;
  controllerGeneration?: bigint | undefined;
  delayInput: string;
  governanceEpoch: bigint;
  graceInput: string;
  proposerInput: string;
  predictedNextController?: Address | undefined;
}): string {
  return JSON.stringify([
    input.boardroom.toLowerCase(),
    input.controller.toLowerCase(),
    input.currentProposer.toLowerCase(),
    input.controllerGeneration?.toString() ?? "",
    input.governanceEpoch.toString(),
    input.configurationEpoch.toString(),
    input.proposerInput.trim().toLowerCase(),
    input.predictedNextController?.toLowerCase() ?? "",
    input.delayInput.trim(),
    input.graceInput.trim(),
  ]);
}

export function controllerConfigurationProposalActionGuard(
  guard: TransactionContextGuard,
  ticket: TransactionContextTicket,
): TransactionActionGuard {
  return { isCurrent: () => guard.isCurrent(ticket) };
}

export function controllerDurationError(delay: bigint | undefined, gracePeriod: bigint | undefined): string | undefined {
  if (delay === undefined || gracePeriod === undefined) return "Enter whole-second controller durations.";
  if (delay < MIN_CONTROLLER_DURATION || delay > MAX_CONTROLLER_DURATION) {
    return "Controller delay must be between 1 and 30 days.";
  }
  if (gracePeriod < MIN_CONTROLLER_DURATION || gracePeriod > MAX_CONTROLLER_DURATION) {
    return "Controller grace period must be between 1 and 30 days.";
  }
  return undefined;
}

function durationInput(value: string): bigint | undefined {
  return /^\d+$/.test(value.trim()) ? BigInt(value.trim()) : undefined;
}

function ProposalFact({ children, label }: { children: React.ReactNode; label: string }): React.JSX.Element {
  return <div className="min-w-0 bg-[var(--pc-surface-subtle)] p-3"><dt className="text-[var(--pc-text-muted)]">{label}</dt><dd className="m-0 mt-1 break-all text-sm font-medium text-[var(--pc-text)]">{children}</dd></div>;
}

function ProposalDetail({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div><span className="text-[var(--pc-text-subtle)]">{label}</span><code className="mt-1 block break-all text-[var(--pc-text)]">{value}</code></div>;
}
