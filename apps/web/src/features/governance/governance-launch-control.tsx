import type { Address } from "@pledge.cash/sdk";
import { ArrowRight, Clock3, LockKeyhole, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { getAddress, isAddress } from "viem";
import { ActionButton, AddressLink } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import {
  TransactionContextGuard,
  type TransactionActionGuard,
  type TransactionContextTicket,
} from "../../lib/transaction-identity";
import type { Capability } from "../capabilities/project-capabilities";
import type { GovernanceRunAction } from "./types";
import { formatGovernanceDuration, governanceProposerError } from "./view-model";

const MIN_DURATION = 86_400n;
const MAX_DURATION = 30n * MIN_DURATION;

export type GovernanceLaunchConfig = {
  proposer: Address;
  predictedController: Address;
  protectionStaker: Address;
  expectedRewardPool: Address;
  expectedRedemptionExcessRecipient: Address;
  controllerDelay: bigint;
  windDownDelay: bigint;
  gracePeriod: bigint;
  generation: bigint;
};

export type GovernanceLaunchControlProps = {
  account?: Address | undefined;
  boardroom: Address;
  capability: Capability;
  pendingAction: string | undefined;
  predictedController?: Address | undefined;
  redemptionExcessRecipient: Address;
  rewardPool: Address;
  runAction: GovernanceRunAction;
  stakerCanProtect?: boolean | undefined;
  submitLaunch: (config: GovernanceLaunchConfig, actionGuard: TransactionActionGuard) => Promise<void>;
};

export function GovernanceLaunchControl({
  account,
  boardroom,
  capability,
  pendingAction,
  predictedController,
  redemptionExcessRecipient,
  rewardPool,
  runAction,
  stakerCanProtect,
  submitLaunch,
}: GovernanceLaunchControlProps): React.JSX.Element {
  const [proposerInput, setProposerInput] = useState(account ?? "");
  const [protectionStakerInput, setProtectionStakerInput] = useState(account ?? "");
  const [controllerDelayInput, setControllerDelayInput] = useState("");
  const [windDownDelayInput, setWindDownDelayInput] = useState("");
  const [gracePeriodInput, setGracePeriodInput] = useState("");
  const proposerError = governanceProposerError(proposerInput);
  const protectionStakerError = addressError(protectionStakerInput, "protection staker");
  const controllerDelay = durationInput(controllerDelayInput);
  const windDownDelay = durationInput(windDownDelayInput);
  const gracePeriod = durationInput(gracePeriodInput);
  const durationError = launchDurationError(controllerDelay, windDownDelay, gracePeriod);
  const proposer = proposerError ? undefined : getAddress(proposerInput);
  const protectionStaker = protectionStakerError ? undefined : getAddress(protectionStakerInput);
  const actionId = "governance-launch-controller";
  const launchIdentity = governanceLaunchIdentity({
    boardroom,
    controllerDelayInput,
    gracePeriodInput,
    predictedController,
    proposerInput,
    protectionStakerInput,
    redemptionExcessRecipient,
    rewardPool,
    windDownDelayInput,
  });
  const launchGuardRef = useRef<TransactionContextGuard | undefined>(undefined);
  launchGuardRef.current ??= new TransactionContextGuard(launchIdentity);
  const launchGuard = launchGuardRef.current;
  launchGuard.sync(launchIdentity);
  const pending = pendingAction === actionId;
  const protectionKnownInsufficient = Boolean(
    account && protectionStaker && protectionStaker.toLowerCase() === account.toLowerCase() && stakerCanProtect === false,
  );
  const disabled = Boolean(
    capability.status !== "enabled"
    || proposerError
    || protectionStakerError
    || durationError
    || !predictedController
    || protectionKnownInsufficient
    || pending,
  );

  const launch = (): void => {
    if (
      !proposer || !protectionStaker || !predictedController
      || controllerDelay === undefined || windDownDelay === undefined || gracePeriod === undefined || disabled
    ) return;
    const ticket = launchGuard.capture();
    const actionGuard = governanceLaunchActionGuard(launchGuard, ticket);
    void runAction(actionId, async () => await submitLaunch({
      proposer,
      predictedController,
      protectionStaker,
      expectedRewardPool: rewardPool,
      expectedRedemptionExcessRecipient: redemptionExcessRecipient,
      controllerDelay,
      windDownDelay,
      gracePeriod,
      generation: 1n,
    }, actionGuard));
  };

  return (
    <form
      aria-label="Launch external Boardroom governance"
      className="border-y border-[var(--pc-border)]"
      onSubmit={(event) => {
        event.preventDefault();
        launch();
      }}
    >
      <div className="flex items-start gap-3 border-b border-[var(--pc-border)] py-4">
        <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-[var(--pc-warning)]" aria-hidden="true" />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-sm font-semibold text-[var(--pc-text)]">Launch generation-1 controller</h3>
            <Badge variant="warning">Permanent authority transfer</Badge>
          </div>
          <p className="m-0 mt-1 max-w-3xl text-sm leading-6 text-[var(--pc-text-muted)]">
            Launch atomically deploys the predicted controller, verifies every bound value, and transfers Boardroom
            ownership to it. The proposer may be an EOA or an ERC-1271 contract such as a Safe.
          </p>
        </div>
      </div>

      <dl className="m-0 grid md:grid-cols-3">
        <LaunchFact label="Predicted controller" value={predictedController ?? "Prediction unavailable"} />
        <LaunchFact label="Reward pool" value={rewardPool} />
        <LaunchFact label="Redemption excess recipient" value={redemptionExcessRecipient} />
      </dl>

      <div className="grid gap-4 border-t border-[var(--pc-border)] py-5 md:grid-cols-2">
        <LaunchField
          label="Controller proposer"
          name="proposer"
          value={proposerInput}
          disabled={pending}
          onChange={setProposerInput}
          description="Only this address can schedule operations. Ready operations remain permissionless to execute."
        />
        <LaunchField
          label="Protection staker"
          name="protectionStaker"
          value={protectionStakerInput}
          disabled={pending}
          onChange={setProtectionStakerInput}
          description="Must meet the 10% current- and previous-block active-stake checks at execution."
        />
        <LaunchField
          label="Controller delay (seconds)"
          name="controllerDelay"
          value={controllerDelayInput}
          disabled={pending}
          onChange={setControllerDelayInput}
          inputMode="numeric"
          description="Immutable generation-1 scheduling delay, from 1 to 30 days."
        />
        <LaunchField
          label="Execution grace period (seconds)"
          name="gracePeriod"
          value={gracePeriodInput}
          disabled={pending}
          onChange={setGracePeriodInput}
          inputMode="numeric"
          description="Window for permissionless execution after the delay, from 1 to 30 days."
        />
        <LaunchField
          label="Wind-down delay (seconds)"
          name="windDownDelay"
          value={windDownDelayInput}
          disabled={pending}
          onChange={setWindDownDelayInput}
          inputMode="numeric"
          description="Waiting period between wind-down start and the immutable redemption snapshot."
        />
      </div>

      {proposerInput.trim() && proposerError ? <LaunchError>{proposerError}</LaunchError> : null}
      {protectionStakerInput.trim() && protectionStakerError ? <LaunchError>{protectionStakerError}</LaunchError> : null}
      {durationError ? <LaunchError>{durationError}</LaunchError> : null}
      {protectionKnownInsufficient ? (
        <LaunchError>The connected protection staker does not currently satisfy both 10% launch checks.</LaunchError>
      ) : null}
      {!predictedController ? (
        <LaunchError>The deterministic controller prediction is unavailable. Launch stays disabled.</LaunchError>
      ) : null}
      {capability.status !== "enabled" && capability.status !== "hidden" ? (
        <LaunchError>{capability.reason ?? "This wallet cannot launch the Boardroom."}</LaunchError>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-[var(--pc-border)] py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 flex items-center gap-2 text-xs leading-5 text-[var(--pc-text-muted)]">
          <ShieldCheck className="h-4 w-4 shrink-0" /> Generation 1 is deployed only inside this launch transaction.
        </p>
        <ActionButton
          actionId={actionId}
          disabled={disabled}
          pendingAction={pendingAction}
          pendingLabel="Launching controller governance"
          type="submit"
        >
          {pending ? "Launching governance" : "Review launch"}
          <ArrowRight className="h-4 w-4" />
        </ActionButton>
      </div>
      <p className="m-0 flex items-start gap-2 border-t border-[var(--pc-border)] py-4 text-xs leading-5 text-[var(--pc-text-muted)]">
        <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
        No administrator or emergency-delay bypass is created. Controller replacement itself must be a delayed,
        generation-bound Boardroom self-call.
      </p>
    </form>
  );
}

export function governanceLaunchIdentity(input: {
  boardroom: Address;
  controllerDelayInput: string;
  gracePeriodInput: string;
  predictedController?: Address | undefined;
  proposerInput: string;
  protectionStakerInput: string;
  redemptionExcessRecipient: Address;
  rewardPool: Address;
  windDownDelayInput: string;
}): string {
  return JSON.stringify([
    input.boardroom.toLowerCase(),
    input.predictedController?.toLowerCase() ?? "unavailable",
    input.proposerInput.trim().toLowerCase(),
    input.protectionStakerInput.trim().toLowerCase(),
    input.rewardPool.toLowerCase(),
    input.redemptionExcessRecipient.toLowerCase(),
    input.controllerDelayInput.trim(),
    input.windDownDelayInput.trim(),
    input.gracePeriodInput.trim(),
    "1",
  ]);
}

export function governanceLaunchActionGuard(
  guard: TransactionContextGuard,
  ticket: TransactionContextTicket,
): TransactionActionGuard {
  return { isCurrent: () => guard.isCurrent(ticket) };
}

export function launchDurationError(
  controllerDelay: bigint | undefined,
  windDownDelay: bigint | undefined,
  gracePeriod: bigint | undefined,
): string | undefined {
  if (controllerDelay === undefined || windDownDelay === undefined || gracePeriod === undefined) {
    return "Enter each launch duration as a whole number of seconds.";
  }
  if (controllerDelay < MIN_DURATION || controllerDelay > MAX_DURATION) {
    return "Controller delay must be between 1 and 30 days.";
  }
  if (windDownDelay < MIN_DURATION || windDownDelay > MAX_DURATION) {
    return "Wind-down delay must be between 1 and 30 days.";
  }
  if (gracePeriod < MIN_DURATION || gracePeriod > MAX_DURATION) {
    return "Execution grace period must be between 1 and 30 days.";
  }
  return undefined;
}

function addressError(value: string, label: string): string | undefined {
  if (!isAddress(value, { strict: false }) || /^0x0{40}$/i.test(value)) return `Enter a valid ${label} address.`;
  return undefined;
}

function durationInput(value: string): bigint | undefined {
  return /^\d+$/.test(value.trim()) ? BigInt(value.trim()) : undefined;
}

function LaunchField({
  description,
  disabled,
  inputMode,
  label,
  name,
  onChange,
  value,
}: {
  description: string;
  disabled: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  label: string;
  name: string;
  onChange: (value: string) => void;
  value: string;
}): React.JSX.Element {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-[var(--pc-text-muted)]">
      {label}
      <Input
        autoComplete="off"
        disabled={disabled}
        inputMode={inputMode}
        name={name}
        placeholder={inputMode === "numeric" ? formatGovernanceDuration(MIN_DURATION) + " in seconds" : "0x..."}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="font-normal leading-5 text-[var(--pc-text-subtle)]">{description}</span>
    </label>
  );
}

function LaunchFact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0 border-b border-[var(--pc-border)] p-4 md:border-r md:last:border-r-0">
      <dt className="text-xs font-semibold text-[var(--pc-text-muted)]">{label}</dt>
      <dd className="m-0 mt-1 break-all text-sm text-[var(--pc-text)]">
        {value.startsWith("0x") ? <AddressLink address={value as Address} /> : value}
      </dd>
    </div>
  );
}

function LaunchError({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="m-0 border-t border-[var(--pc-border)] py-3 text-xs text-[var(--pc-danger)]" role="alert">{children}</p>;
}
