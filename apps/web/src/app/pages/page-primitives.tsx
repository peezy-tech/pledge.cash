import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

type MetricGridColumns = 2 | 3 | 4;

export type ProductStateProps = {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
};

export function PageHeading({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}): React.JSX.Element {
  return (
    <header className="border-b border-[var(--pc-border)] pb-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--pc-accent)]">{eyebrow}</p>
          <h1 className="m-0 mt-2 text-3xl font-semibold tracking-[-0.025em] text-[var(--pc-text)] sm:text-4xl">{title}</h1>
          <p className="m-0 mt-3 max-w-3xl text-sm leading-6 text-[var(--pc-text-muted)]">{description}</p>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function SectionHeading({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description?: string;
  title: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="m-0 text-lg font-semibold tracking-[-0.015em] text-[var(--pc-text)]">{title}</h2>
        {description ? <p className="m-0 mt-1 max-w-3xl text-sm leading-5 text-[var(--pc-text-subtle)]">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function RuledSection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return <section className={cn("border-b border-[var(--pc-border)] py-6 last:border-b-0", className)}>{children}</section>;
}

export function KeyValueList({
  columns = 3,
  items,
}: {
  columns?: 2 | 3 | 4;
  items: readonly { label: string; value: ReactNode; detail?: ReactNode }[];
}): React.JSX.Element {
  const gridClass = columns === 2
    ? "md:grid-cols-2"
    : columns === 4
      ? "sm:grid-cols-2 xl:grid-cols-4"
      : "sm:grid-cols-2 xl:grid-cols-3";

  return (
    <dl className={cn("mt-4 grid border-y border-[var(--pc-metric-border)]", gridClass)}>
      {items.map((item, index) => (
        <div
          className={cn(
            "min-w-0 border-b border-[var(--pc-metric-border)] py-4 sm:px-4",
            index === 0 ? "sm:pl-0" : null,
            "last:border-b-0",
          )}
          key={item.label}
        >
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--pc-metric-label)]">{item.label}</dt>
          <dd className="m-0 mt-1 break-words text-sm font-semibold text-[var(--pc-metric-value)]">{item.value}</dd>
          {item.detail ? <dd className="m-0 mt-1 text-xs leading-5 text-[var(--pc-text-subtle)]">{item.detail}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

export function MetricGrid({
  children,
  className,
  columns = 3,
  label,
}: {
  children: ReactNode;
  className?: string;
  columns?: MetricGridColumns;
  label?: string;
}): React.JSX.Element {
  const gridClass = columns === 2
    ? "sm:grid-cols-2"
    : columns === 4
      ? "sm:grid-cols-2 xl:grid-cols-4"
      : "sm:grid-cols-2 xl:grid-cols-3";

  return (
    <div
      aria-label={label}
      role={label ? "group" : undefined}
      className={cn(
        "grid overflow-hidden rounded-lg border border-[var(--pc-metric-border)] bg-[var(--pc-metric-border)] gap-px",
        gridClass,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Metric({
  className,
  detail,
  label,
  value,
}: {
  className?: string;
  detail?: ReactNode;
  label: string;
  value: ReactNode;
}): React.JSX.Element {
  return (
    <dl className={cn("m-0 min-w-0 bg-[var(--pc-metric-surface)] p-4", className)}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--pc-metric-label)]">{label}</dt>
      <dd className="m-0 mt-1 break-words text-xl font-semibold tracking-[-0.02em] text-[var(--pc-metric-value)]">{value}</dd>
      {detail ? <dd className="m-0 mt-1 text-xs leading-5 text-[var(--pc-text-subtle)]">{detail}</dd> : null}
    </dl>
  );
}

export function LoadingState(props: ProductStateProps): React.JSX.Element {
  return (
    <ProductState
      {...props}
      busy
      icon={<Loader2 className="h-5 w-5 animate-spin" />}
      role="status"
    />
  );
}

export function EmptyState(props: ProductStateProps): React.JSX.Element {
  return <ProductState {...props} icon={<Inbox className="h-5 w-5" />} role="status" />;
}

export function ErrorState(props: ProductStateProps): React.JSX.Element {
  return <ProductState {...props} icon={<AlertCircle className="h-5 w-5" />} role="alert" tone="danger" />;
}

function ProductState({
  action,
  busy = false,
  className,
  compact = false,
  description,
  icon,
  role,
  title,
  tone = "neutral",
}: ProductStateProps & {
  busy?: boolean;
  icon: ReactNode;
  role: "alert" | "status";
  tone?: "danger" | "neutral";
}): React.JSX.Element {
  return (
    <div
      aria-busy={busy || undefined}
      aria-live={role === "status" ? "polite" : undefined}
      className={cn(
        "grid place-items-center border-y border-[var(--pc-border)] text-center",
        compact ? "min-h-28 px-4 py-6" : "min-h-44 px-5 py-10",
        tone === "danger" && "border-[color:var(--pc-danger)]/55",
        className,
      )}
      role={role}
    >
      <div className="max-w-lg">
        <span
          aria-hidden="true"
          className={cn(
            "mx-auto grid h-10 w-10 place-items-center rounded-full border border-[var(--pc-border-strong)] text-[var(--pc-text-muted)]",
            tone === "danger" && "border-[var(--pc-danger)] text-[var(--pc-danger)]",
          )}
        >
          {icon}
        </span>
        <p className="m-0 mt-3 text-sm font-semibold text-[var(--pc-text)]">{title}</p>
        {description ? <div className="mt-1 text-sm leading-6 text-[var(--pc-text-muted)]">{description}</div> : null}
        {action ? <div className="mt-4 flex min-h-11 justify-center">{action}</div> : null}
      </div>
    </div>
  );
}

export function PageNotice({
  children,
  title,
  tone = "neutral",
}: {
  children: ReactNode;
  title: string;
  tone?: "danger" | "neutral" | "warning";
}): React.JSX.Element {
  const toneClass = tone === "danger"
    ? "border-[color:var(--pc-danger)]/55 bg-[color:var(--pc-danger)]/8 text-[var(--pc-text)]"
    : tone === "warning"
      ? "border-[color:var(--pc-warning)]/55 bg-[color:var(--pc-warning)]/8 text-[var(--pc-text)]"
      : "border-[var(--pc-border-strong)] bg-[var(--pc-surface-subtle)] text-[var(--pc-text)]";

  return (
    <div className={cn("border-l-2 px-4 py-3", toneClass)} role={tone === "danger" ? "alert" : "status"}>
      <p className="m-0 text-sm font-semibold">{title}</p>
      <div className="mt-1 text-sm leading-5 text-[var(--pc-text-muted)]">{children}</div>
    </div>
  );
}

export function TableFrame({ children, label }: { children: ReactNode; label: string }): React.JSX.Element {
  return (
    <div className="mt-4 overflow-x-auto border-y border-[var(--pc-border)]" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export const tableClassName = "w-full min-w-[680px] border-collapse text-left text-sm";
export const tableHeadClassName = "border-b border-[var(--pc-border)] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--pc-text-subtle)]";
export const tableCellClassName = "border-b border-[var(--pc-surface-raised)] px-3 py-3 align-top first:pl-0 last:pr-0";
