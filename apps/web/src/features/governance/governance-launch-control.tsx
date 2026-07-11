import type { Address } from "@pledge.cash/sdk";
import { AlertTriangle, LockKeyhole } from "lucide-react";
import { formatGovernanceDuration } from "./view-model";

export type GovernanceLaunchControlProps = {
  boardroom: Address;
  currentExecutor: Address;
  minimumDelay: bigint;
};

export function GovernanceLaunchControl({
  boardroom,
  currentExecutor,
  minimumDelay,
}: GovernanceLaunchControlProps): React.JSX.Element {
  return (
    <section
      aria-labelledby="governance-launch-compatibility-title"
      className="border-y border-[var(--pc-border)]"
    >
      <div className="flex items-start gap-3 border-b border-[var(--pc-border)] p-4" role="note">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--pc-warning)]" aria-hidden="true" />
        <div>
          <h3 className="m-0 text-sm font-semibold text-[var(--pc-text)]" id="governance-launch-compatibility-title">
            Secure governance launch is unavailable for this Boardroom version
          </h3>
          <p className="m-0 mt-1 max-w-3xl text-sm leading-6 text-[var(--pc-text-muted)]">
            This deployed contract signs <code>launch(uint256)</code> without the expected executor. A pending owner transaction could change the executor before launch is mined, so pledge.cash will not submit or certify this permanent transition.
          </p>
        </div>
      </div>

      <dl className="m-0 grid md:grid-cols-3">
        <LaunchFact label="Current executor" value={currentExecutor} />
        <LaunchFact label="Minimum holder review" value={formatGovernanceDuration(minimumDelay)} />
        <LaunchFact label="Boardroom" value={boardroom} />
      </dl>

      <div className="flex items-start gap-3 p-4 text-sm leading-6 text-[var(--pc-text-muted)]">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[var(--pc-text)]" aria-hidden="true" />
        <p className="m-0 max-w-3xl">
          Launch requires a Boardroom version whose calldata includes the expected executor and reverts on a mismatch. Until that contract upgrade exists, the safe in-app action is to leave owner governance unchanged.
        </p>
      </div>
    </section>
  );
}

function LaunchFact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0 border-b border-[var(--pc-border)] p-4 md:border-r md:last:border-r-0">
      <dt className="text-xs font-semibold text-[var(--pc-text-muted)]">{label}</dt>
      <dd className="m-0 mt-1 break-all text-sm text-[var(--pc-text)]">{value}</dd>
    </div>
  );
}
