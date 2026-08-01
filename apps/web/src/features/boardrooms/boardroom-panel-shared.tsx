import type { Address } from "@pledge.cash/sdk";
import type React from "react";
import type { Dispatch, SetStateAction } from "react";
import { Field } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import type {
  BoardroomDistributionSnapshot,
  BoardroomGrantSnapshot,
  BoardroomLockedLiquiditySnapshot,
  BoardroomSnapshot,
} from "../../lib/types";

export type StatusTone = "default" | "muted" | "warning" | "danger";

export type BoardroomFact = {
  label: string;
  value: React.ReactNode;
};

export function TextField<T extends object, K extends keyof T & string>({
  className,
  disabled,
  description,
  field,
  form,
  inputMode,
  label,
  setForm,
}: {
  className?: string;
  disabled?: boolean;
  description?: string;
  field: K;
  form: T;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  label: string;
  setForm: Dispatch<SetStateAction<T>>;
}): React.JSX.Element {
  return (
    <Field description={description} label={label} {...(className ? { className } : {})}>
      <Input
        disabled={disabled}
        inputMode={inputMode}
        value={String(form[field] ?? "")}
        spellCheck={false}
        onChange={(event) => setFormField(field, event.target.value as T[K], setForm)}
      />
    </Field>
  );
}

export function setFormField<T, K extends keyof T>(key: K, value: T[K], setter: Dispatch<SetStateAction<T>>): void {
  setter((current) => ({ ...current, [key]: value }));
}

export function StatusBadge({ label, tone }: { label: string; tone: StatusTone }): React.JSX.Element {
  return <Badge variant={tone}>{label}</Badge>;
}

export function boardroomStatusLabel(status: number | undefined): string {
  if (status === 0) return "Active";
  if (status === 1) return "Winding down";
  if (status === 2) return "Snapshotting";
  if (status === 3) return "Redemptions open";
  return "Unknown";
}

export function boardroomStatusTone(status: number | undefined): "default" | "muted" | "warning" | "danger" {
  if (status === 0) return "default";
  if (status === 1) return "warning";
  if (status === 2) return "warning";
  if (status === 3) return "muted";
  return "muted";
}

export function saleStatusLabel(status: number | undefined): string {
  if (status === 0) return "Active";
  if (status === 1) return "Closed";
  if (status === 2) return "Cancelled";
  return "Unknown";
}

export function curveStatusLabel(status: number | undefined): string {
  if (status === 0) return "Selling";
  if (status === 1) return "Graduated";
  if (status === 2) return "Unwinding";
  if (status === 3) return "Migrated";
  if (status === 4) return "Settled";
  if (status === 5) return "Quarantined";
  return "Unknown";
}

export function airdropStatusLabel(status: number | undefined): string {
  if (status === 0) return "Active";
  if (status === 1) return "Closed";
  if (status === 2) return "Cancelled";
  return "Unknown";
}

export function sameAddress(first: string | undefined, second: string | undefined): boolean {
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase());
}

export function distributionKindLabel(kind: BoardroomDistributionSnapshot["kind"]): string {
  if (kind === "dutch-auction") return "Dutch auction";
  if (kind === "fixed-price-sale") return "Sale";
  if (kind === "migrating-bonding-curve") return "Curve";
  if (kind === "merkle-airdrop") return "Airdrop";
  if (kind === "bond-market") return "Bond market";
  return "Distribution";
}

export function distributionStatusLabel(distribution: BoardroomDistributionSnapshot): string {
  if (distribution.error) return "Read failed";
  if (distribution.kind === "dutch-auction" && distribution.state && "saleStatus" in distribution.state) {
    return saleStatusLabel(distribution.state.saleStatus);
  }
  if (distribution.kind === "fixed-price-sale" && distribution.state && "saleStatus" in distribution.state) {
    return saleStatusLabel(distribution.state.saleStatus);
  }
  if (distribution.kind === "migrating-bonding-curve" && distribution.state && "curveStatus" in distribution.state) {
    return curveStatusLabel(distribution.state.curveStatus);
  }
  if (distribution.kind === "merkle-airdrop" && distribution.state && "airdropStatus" in distribution.state) {
    return airdropStatusLabel(distribution.state.airdropStatus);
  }
  if (distribution.kind === "bond-market" && distribution.state && "status" in distribution.state) {
    if (distribution.state.closed) return "Settled";
    if (distribution.state.status === 1) return "Awaiting claims";
    return distribution.state.live ? "Live" : "Scheduled";
  }
  return "Unknown";
}

export function distributionStatusTone(distribution: BoardroomDistributionSnapshot): StatusTone {
  if (distribution.state?.closed) return "warning";
  if (distribution.error) return "danger";
  return "default";
}

export function grantStatusLabel(grant: BoardroomGrantSnapshot): string {
  if (grant.error) return "Read failed";
  if (grant.state?.closed) return "Closed";
  return "Open";
}

export function grantStatusTone(grant: BoardroomGrantSnapshot): StatusTone {
  if (grant.error) return "danger";
  if (grant.state?.closed) return "warning";
  return "default";
}

export function lockerStatusLabel(locker: BoardroomLockedLiquiditySnapshot): string {
  if (locker.error) return "Read failed";
  if (locker.state?.positionLiquidity === 0n) return "Exited";
  return "Funded";
}

export function lockerStatusTone(locker: BoardroomLockedLiquiditySnapshot): StatusTone {
  if (locker.error) return "danger";
  if (locker.state?.positionLiquidity === 0n) return "warning";
  return "default";
}

export function remainingDistributionShares(distribution: BoardroomDistributionSnapshot): bigint | undefined {
  if (!distribution.state) return undefined;
  if ("remainingShares" in distribution.state) return distribution.state.remainingShares;
  if ("remainingSaleShares" in distribution.state) return distribution.state.remainingSaleShares;
  if ("capacity" in distribution.state) return distribution.state.capacity;
  return undefined;
}

export function distributionPaymentTokenAddress(distribution: BoardroomDistributionSnapshot | undefined): Address | undefined {
  if (!distribution?.state) return undefined;
  if ("paymentToken" in distribution.state) return distribution.state.paymentToken;
  if ("quoteToken" in distribution.state) return distribution.state.quoteToken;
  return undefined;
}

export function distributionSummaryFor(
  boardroomSnapshot: BoardroomSnapshot | undefined,
  address: string | undefined,
): BoardroomDistributionSnapshot | undefined {
  if (!boardroomSnapshot || !address) return undefined;
  return boardroomSnapshot.distributionSummaries.find((distribution) => sameAddress(distribution.address, address));
}

export function lockerSummaryFor(
  boardroomSnapshot: BoardroomSnapshot | undefined,
  address: string | undefined,
): BoardroomLockedLiquiditySnapshot | undefined {
  if (!boardroomSnapshot || !address) return undefined;
  return boardroomSnapshot.lockedLiquiditySummaries.find((locker) => sameAddress(locker.address, address));
}

export type WindDownCoverage = {
  complete: boolean;
  issues: string[];
};

export function windDownCoverage(boardroomSnapshot: BoardroomSnapshot | undefined): WindDownCoverage {
  if (!boardroomSnapshot) {
    return {
      complete: false,
      issues: ["Boardroom state has not been loaded."],
    };
  }

  const issues = [
    coverageIssue("Grant", boardroomSnapshot.grantRecordCount ?? boardroomSnapshot.activeGrantCount, boardroomSnapshot.grantSummaries.length),
    coverageIssue("Distribution", boardroomSnapshot.distributionRecordCount, boardroomSnapshot.distributionSummaries.length),
    coverageIssue("Locked-liquidity", boardroomSnapshot.lockedLiquidityRecordCount, boardroomSnapshot.lockedLiquiditySummaries.length),
    coverageIssue(
      "Redeemable-asset",
      boardroomSnapshot.redeemableAssetCount,
      boardroomSnapshot.redeemableAssets.length,
    ),
  ].filter((issue): issue is string => issue !== undefined);

  return {
    complete: issues.length === 0,
    issues,
  };
}

function coverageIssue(label: string, total: number | bigint | undefined, loaded: number): string | undefined {
  if (total === undefined) return `${label} canonical record count is unavailable.`;
  if (BigInt(loaded) >= BigInt(total)) return undefined;
  return `${label} coverage is incomplete: ${loaded.toString()} of ${total.toString()} records were loaded.`;
}

export function windDownBlockers(boardroomSnapshot: BoardroomSnapshot | undefined): { kind: string; address: Address; action: string }[] {
  if (!boardroomSnapshot) return [];

  const grantBlockers = boardroomSnapshot.grantSummaries
    .filter((grant) => grant.error || !grant.state?.closed)
    .map((grant) => ({
      kind: "Grant",
      address: grant.address,
      action: grant.error ? "Reload the grant state or inspect the address." : "Halt/withdraw or wait until the grant can close.",
    }));
  const distributionBlockers = boardroomSnapshot.distributionSummaries
    .filter((distribution) => distribution.error || !distribution.state?.closed)
    .map((distribution) => ({
      kind: distributionKindLabel(distribution.kind),
      address: distribution.address,
      action:
        distribution.error
          ? "Reload the distribution state."
          : distribution.kind === "migrating-bonding-curve"
            ? "Cancel or migrate this distribution."
            : "Close or cancel this distribution.",
    }));
  const lockerBlockers = boardroomSnapshot.lockedLiquiditySummaries
    .filter((locker) => locker.error || (locker.state?.positionLiquidity ?? 0n) !== 0n)
    .map((locker) => ({
      kind: "Protocol liquidity",
      address: locker.address,
      action: locker.error ? "Reload the protocol-liquidity vault state." : "Exit protocol liquidity or release P4LP claims during wind-down.",
    }));

  return [...grantBlockers, ...distributionBlockers, ...lockerBlockers];
}
