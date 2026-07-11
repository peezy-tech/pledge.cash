import type { Address } from "@pledge.cash/sdk";
import { AlertTriangle, ArrowRight, LockKeyhole } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { isAddress } from "viem";
import { ActionButton } from "../../components/shell";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import type {
  GovernanceControlContext,
  GovernanceLaunchCapabilities,
  GovernanceTransactionRequest,
} from "./types";
import {
  buildGovernanceLaunchSteps,
  customGovernanceDelay,
  formatGovernanceDuration,
  governanceDelayPresets,
  governanceExecutorError,
} from "./view-model";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const LAUNCH_ACTION_ID = "governance-launch";

export type GovernanceLaunchControlProps = GovernanceControlContext & {
  boardroom: Address;
  capabilities: GovernanceLaunchCapabilities;
  currentExecutor: Address;
  minimumDelay: bigint;
  onComplete?: (() => void | Promise<void>) | undefined;
  onLaunch?: ((governanceDelay: bigint, request: GovernanceTransactionRequest) => Promise<void>) | undefined;
  onSetExecutor?: ((executor: Address, request: GovernanceTransactionRequest) => Promise<void>) | undefined;
};

export function GovernanceLaunchControl({
  account,
  boardroom,
  capabilities,
  currentExecutor,
  minimumDelay,
  onComplete,
  onLaunch,
  onSetExecutor,
  pendingAction,
  runAction,
  submitTransaction,
}: GovernanceLaunchControlProps): React.JSX.Element {
  const presets = useMemo(() => governanceDelayPresets(minimumDelay), [minimumDelay]);
  const initialPreset = presets[0]?.seconds.toString() ?? "custom";
  const [delayChoice, setDelayChoice] = useState(initialPreset);
  const [customAmount, setCustomAmount] = useState(() => minimumCustomAmount(minimumDelay));
  const [customUnit, setCustomUnit] = useState<"days" | "hours">("days");
  const [executor, setExecutor] = useState(() => preferredExecutor(currentExecutor, account));
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setExecutor((value) => value || preferredExecutor(currentExecutor, account));
  }, [account, currentExecutor]);

  useEffect(() => {
    if (delayChoice === "custom" || presets.some((preset) => preset.seconds.toString() === delayChoice)) return;
    setDelayChoice(presets[0]?.seconds.toString() ?? "custom");
  }, [delayChoice, presets]);

  const selectedDelay = delayChoice === "custom"
    ? customGovernanceDelay(customAmount, customUnit)
    : BigInt(delayChoice);
  const executorError = governanceExecutorError(executor);
  const delayError = selectedDelay === undefined
    ? "Enter a whole-number review period."
    : selectedDelay < minimumDelay
      ? `The review period must be at least ${formatGovernanceDuration(minimumDelay)}.`
      : undefined;
  const launchCapability = capabilities["governance.launch"];
  const capabilityError = launchCapability.status === "enabled"
    ? undefined
    : launchCapability.reason ?? "Governance launch is not available right now.";
  const changesExecutor = isAddress(executor, { strict: false })
    && currentExecutor.toLowerCase() !== executor.toLowerCase();
  const disabled = Boolean(executorError || delayError || capabilityError || (!changesExecutor && !confirmed) || pendingAction);

  const launch = async (): Promise<void> => {
    if (executorError || delayError || !selectedDelay || !isAddress(executor, { strict: false })) return;
    const nextExecutor = executor as Address;
    const steps = buildGovernanceLaunchSteps({
      boardroom,
      currentExecutor,
      governanceDelay: selectedDelay,
      nextExecutor,
    });

    for (const step of steps) {
      if (step.kind === "setExecutor" && onSetExecutor) {
        await onSetExecutor(nextExecutor, step.request);
      } else if (step.kind === "launch" && onLaunch) {
        await onLaunch(selectedDelay, step.request);
      } else {
        await submitTransaction(step.label, step.request);
      }
      if (step.kind === "setExecutor") {
        setConfirmed(false);
        await onComplete?.();
        return;
      }
    }
    await onComplete?.();
  };

  return (
    <form
      className="border-y border-[var(--pc-border)]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) void runAction(LAUNCH_ACTION_ID, launch);
      }}
    >
      <div className="grid md:grid-cols-2">
        <Label className="border-b border-[var(--pc-border)] p-4 text-[var(--pc-text-muted)] md:border-r">
          <span>Governance executor</span>
          <Input
            aria-describedby={executorError ? "governance-executor-error" : "governance-executor-help"}
            autoComplete="off"
            placeholder="0x…"
            spellCheck={false}
            value={executor}
            onChange={(event) => setExecutor(event.target.value)}
          />
          <span className="font-normal leading-5" id={executorError ? "governance-executor-error" : "governance-executor-help"}>
            {executorError ?? "This address prepares and queues future project changes. Safe and other contract-executor queues cannot currently be reconstructed for in-app execution; use an EOA when that workflow is required."}
          </span>
        </Label>

        <fieldset className="m-0 min-w-0 border-0 border-b border-[var(--pc-border)] p-4">
          <legend className="mb-2 text-xs font-semibold text-[var(--pc-text-muted)]">Holder review period</legend>
          <div className="grid gap-px overflow-hidden rounded-md border border-[var(--pc-border)] bg-[var(--pc-border)] sm:grid-cols-2">
            {presets.map((preset) => (
              <label className="flex min-h-10 cursor-pointer items-center gap-2 bg-[var(--pc-surface-subtle)] px-3 text-sm text-[var(--pc-text)]" key={preset.seconds.toString()}>
                <input
                  checked={delayChoice === preset.seconds.toString()}
                  className="accent-[var(--pc-accent)]"
                  name="governance-delay"
                  type="radio"
                  value={preset.seconds.toString()}
                  onChange={(event) => setDelayChoice(event.target.value)}
                />
                {preset.label}
              </label>
            ))}
            <label className="flex min-h-10 cursor-pointer items-center gap-2 bg-[var(--pc-surface-subtle)] px-3 text-sm text-[var(--pc-text)]">
              <input
                checked={delayChoice === "custom"}
                className="accent-[var(--pc-accent)]"
                name="governance-delay"
                type="radio"
                value="custom"
                onChange={(event) => setDelayChoice(event.target.value)}
              />
              Custom
            </label>
          </div>
          {delayChoice === "custom" ? (
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input
                aria-label="Custom governance delay"
                inputMode="numeric"
                min="1"
                step="1"
                type="number"
                value={customAmount}
                onChange={(event) => setCustomAmount(event.target.value)}
              />
              <select
                aria-label="Custom governance delay unit"
                className="h-10 rounded-md border border-[var(--pc-border-strong)] bg-[var(--pc-surface)] px-3 text-sm text-[var(--pc-text)]"
                value={customUnit}
                onChange={(event) => setCustomUnit(event.target.value as "days" | "hours")}
              >
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
          ) : null}
          <p className="m-0 mt-2 text-xs font-normal leading-5 text-[var(--pc-text-muted)]">
            {delayError ?? `Every queued action waits ${formatGovernanceDuration(selectedDelay ?? minimumDelay)} before execution.`}
          </p>
        </fieldset>
      </div>

      <div className="border-b border-[var(--pc-border)] p-4" id="governance-launch-warning" role="note">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--pc-warning)]" aria-hidden="true" />
          <div>
            <p className="m-0 text-sm font-semibold text-[var(--pc-text)]">Launching is permanent</p>
            <p className="m-0 mt-1 max-w-3xl text-sm leading-5 text-[var(--pc-text-muted)]">
              Direct owner execution ends after launch. The executor will queue changes, holders get the review period above, and eligible holders can veto before execution.
            </p>
            {changesExecutor ? (
              <p className="m-0 mt-2 text-xs leading-5 text-[var(--pc-text-muted)]">
                Executor setup and launch are separate checkpoints. This action only updates the executor; after it confirms, review the refreshed project state and confirm the permanent launch separately.
              </p>
            ) : null}
          </div>
        </div>
        {changesExecutor ? (
          <p className="m-0 mt-4 text-sm font-medium text-[var(--pc-text)]">
            The permanent launch confirmation appears only after this executor update is confirmed and the project is refreshed.
          </p>
        ) : (
          <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm font-medium text-[var(--pc-text)]">
            <input
              aria-describedby="governance-launch-warning"
              checked={confirmed}
              className="mt-0.5 h-4 w-4 accent-[var(--pc-accent)]"
              type="checkbox"
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I understand that owner authority cannot be restored after launch.
          </label>
        )}
      </div>

      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-xs leading-5 text-[var(--pc-text-muted)]">
          {capabilityError ? (
            <p className="m-0" role="status">{capabilityError}</p>
          ) : (
            <p className="m-0 break-all">
              {account ? `Launching from ${account}.` : "Connect the owner wallet to launch."}
            </p>
          )}
        </div>
        <ActionButton
          actionId={LAUNCH_ACTION_ID}
          aria-describedby="governance-launch-warning"
          className="w-full sm:w-auto"
          disabled={disabled}
          pendingAction={pendingAction}
          type="submit"
        >
          {pendingAction === LAUNCH_ACTION_ID ? (
            changesExecutor ? "Updating executor" : "Launching governance"
          ) : (
            <>
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              {changesExecutor ? "Update executor first" : "Launch governance"}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </>
          )}
        </ActionButton>
      </div>
    </form>
  );
}

function preferredExecutor(currentExecutor: Address, account?: Address): string {
  if (currentExecutor.toLowerCase() !== ZERO_ADDRESS.toLowerCase()) return currentExecutor;
  return account ?? "";
}

function minimumCustomAmount(minimumDelay: bigint): string {
  const day = 86_400n;
  return ((minimumDelay + day - 1n) / day || 1n).toString();
}
