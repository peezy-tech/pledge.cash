import type { Address } from "@pledge.cash/sdk";
import type React from "react";
import type { Dispatch, SetStateAction } from "react";
import { Field } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import type { BoardroomDistributionSnapshot, BoardroomLockedLiquiditySnapshot, BoardroomSnapshot } from "../../lib/types";

export function TextField<T extends object, K extends keyof T & string>({
  className,
  disabled,
  field,
  form,
  inputMode,
  label,
  setForm,
}: {
  className?: string;
  disabled?: boolean;
  field: K;
  form: T;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  label: string;
  setForm: Dispatch<SetStateAction<T>>;
}): React.JSX.Element {
  return (
    <Field label={label} {...(className ? { className } : {})}>
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

export function StatusBadge({ label, tone }: { label: string; tone: "default" | "muted" | "warning" | "danger" }): React.JSX.Element {
  return <Badge variant={tone}>{label}</Badge>;
}

export function boardroomStatusLabel(status: number | undefined): string {
  if (status === 0) return "Active";
  if (status === 1) return "Winding down";
  if (status === 2) return "Redemptions open";
  return "Unknown";
}

export function boardroomStatusTone(status: number | undefined): "default" | "muted" | "warning" | "danger" {
  if (status === 0) return "default";
  if (status === 1) return "warning";
  if (status === 2) return "muted";
  return "muted";
}

export function saleStatusLabel(status: number | undefined): string {
  if (status === 0) return "Active";
  if (status === 1) return "Closed";
  if (status === 2) return "Cancelled";
  return "Unknown";
}

export function curveStatusLabel(status: number | undefined): string {
  if (status === 0) return "Active";
  if (status === 1) return "Migrated";
  if (status === 2) return "Cancelled";
  return "Unknown";
}

export function distributionSummaryFor(
  boardroomSnapshot: BoardroomSnapshot | undefined,
  address: string | undefined,
): BoardroomDistributionSnapshot | undefined {
  if (!boardroomSnapshot || !address) return undefined;
  return boardroomSnapshot.distributionSummaries.find((distribution) => distribution.address.toLowerCase() === address.toLowerCase());
}

export function lockerSummaryFor(
  boardroomSnapshot: BoardroomSnapshot | undefined,
  address: string | undefined,
): BoardroomLockedLiquiditySnapshot | undefined {
  if (!boardroomSnapshot || !address) return undefined;
  return boardroomSnapshot.lockedLiquiditySummaries.find((locker) => locker.address.toLowerCase() === address.toLowerCase());
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
      kind: distribution.kind === "fixed-price-sale" ? "Sale" : "Curve",
      address: distribution.address,
      action: distribution.error ? "Reload the distribution state." : "Close, cancel, or migrate this distribution.",
    }));
  const lockerBlockers = boardroomSnapshot.lockedLiquiditySummaries
    .filter((locker) => locker.error || (locker.state?.lockedLiquidity ?? 0n) !== 0n)
    .map((locker) => ({
      kind: "Locker",
      address: locker.address,
      action: locker.error ? "Reload the locked-liquidity state." : "Exit locked liquidity during wind-down.",
    }));

  return [...grantBlockers, ...distributionBlockers, ...lockerBlockers];
}
