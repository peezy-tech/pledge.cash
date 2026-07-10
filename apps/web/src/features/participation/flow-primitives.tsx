import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { ActionButton, AddressLink, StatusNotice, TechnicalDetails } from "../../components/shell";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import type { RunParticipationAction } from "./types";

export function FlowHeading({
  description,
  eyebrow,
  title,
}: {
  description: string;
  eyebrow: string;
  title: string;
}): React.JSX.Element {
  return (
    <header>
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-lime-200/80">{eyebrow}</p>
      <h3 className="m-0 mt-1 text-lg font-semibold tracking-[-0.015em] text-zinc-50">{title}</h3>
      <p className="m-0 mt-1 max-w-2xl text-sm leading-5 text-zinc-500">{description}</p>
    </header>
  );
}

export function AmountField({
  label = "Amount",
  onChange,
  symbol,
  value,
}: {
  label?: string;
  onChange: (value: string) => void;
  symbol?: string | undefined;
  value: string;
}): React.JSX.Element {
  return (
    <Label className="mt-5 max-w-xl text-zinc-400">
      <span>{label}</span>
      <div className="relative">
        <Input
          aria-label={label}
          autoComplete="off"
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {symbol ? <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-xs font-semibold text-zinc-500">{symbol}</span> : null}
      </div>
    </Label>
  );
}

export function QuoteGrid({ items }: { items: readonly { label: string; value: ReactNode; detail?: ReactNode }[] }): React.JSX.Element {
  return (
    <dl className="mt-5 grid border-y border-zinc-800 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div className="min-w-0 border-b border-zinc-800 py-3 sm:px-4 sm:first:pl-0 xl:[&:nth-child(3n+1)]:pl-0" key={item.label}>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{item.label}</dt>
          <dd className="m-0 mt-1 break-words text-sm font-semibold text-zinc-100">{item.value}</dd>
          {item.detail ? <dd className="m-0 mt-1 text-xs leading-5 text-zinc-500">{item.detail}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

export function FlowActions({
  actionId,
  actionLabel,
  disabled,
  onAction,
  onRefresh,
  pendingAction,
  refreshLabel = "Refresh quote",
  runAction,
}: {
  actionId: string;
  actionLabel: string;
  disabled: boolean;
  onAction: () => Promise<void>;
  onRefresh?: (() => Promise<void>) | undefined;
  pendingAction: string | undefined;
  refreshLabel?: string | undefined;
  runAction: RunParticipationAction;
}): React.JSX.Element {
  const refreshId = refreshLabel;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <ActionButton actionId={actionId} disabled={disabled} pendingAction={pendingAction} onClick={() => void runAction(actionId, onAction)}>
        {actionLabel}
      </ActionButton>
      {onRefresh ? (
        <ActionButton actionId={refreshId} pendingAction={pendingAction} variant="secondary" onClick={() => void runAction(refreshId, onRefresh)}>
          <RefreshCw className="h-4 w-4" />
          {refreshLabel}
        </ActionButton>
      ) : null}
    </div>
  );
}

export function FlowError({ children, title = "This action is not ready" }: { children: ReactNode; title?: string }): React.JSX.Element {
  return <StatusNotice className="mt-4" title={title} tone="warning">{children}</StatusNotice>;
}

export function ReadError({ children }: { children: ReactNode }): React.JSX.Element {
  return <StatusNotice className="mt-4" title="Onchain data could not be read" tone="danger">{children}</StatusNotice>;
}

export function AdvancedFields({ children, summary = "Advanced" }: { children: ReactNode; summary?: string }): React.JSX.Element {
  return <TechnicalDetails summary={summary}>{children}</TechnicalDetails>;
}

export function ContractFact({ address }: { address: `0x${string}` }): React.JSX.Element {
  return <AddressLink address={address} />;
}

export function InlineField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}): React.JSX.Element {
  return <Label className="text-zinc-400"><span>{label}</span>{children}</Label>;
}
