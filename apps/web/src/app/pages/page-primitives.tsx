import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

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
    <header className="border-b border-zinc-800 pb-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-lime-200/80">{eyebrow}</p>
          <h1 className="m-0 mt-2 text-3xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-4xl">{title}</h1>
          <p className="m-0 mt-3 max-w-3xl text-sm leading-6 text-zinc-400">{description}</p>
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
        <h2 className="m-0 text-lg font-semibold tracking-[-0.015em] text-zinc-50">{title}</h2>
        {description ? <p className="m-0 mt-1 max-w-3xl text-sm leading-5 text-zinc-500">{description}</p> : null}
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
  return <section className={cn("border-b border-zinc-800 py-6 last:border-b-0", className)}>{children}</section>;
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
    <dl className={cn("mt-4 grid border-y border-zinc-800", gridClass)}>
      {items.map((item, index) => (
        <div
          className={cn(
            "min-w-0 border-b border-zinc-800 py-4 sm:px-4",
            index === 0 ? "sm:pl-0" : null,
            "last:border-b-0",
          )}
          key={item.label}
        >
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{item.label}</dt>
          <dd className="m-0 mt-1 break-words text-sm font-semibold text-zinc-100">{item.value}</dd>
          {item.detail ? <dd className="m-0 mt-1 text-xs leading-5 text-zinc-500">{item.detail}</dd> : null}
        </div>
      ))}
    </dl>
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
    ? "border-red-400/35 bg-red-400/5 text-red-100"
    : tone === "warning"
      ? "border-amber-300/30 bg-amber-300/5 text-amber-100"
      : "border-zinc-800 bg-zinc-900/35 text-zinc-200";

  return (
    <div className={cn("border-l-2 px-4 py-3", toneClass)} role={tone === "danger" ? "alert" : "status"}>
      <p className="m-0 text-sm font-semibold">{title}</p>
      <div className="mt-1 text-sm leading-5 text-zinc-400">{children}</div>
    </div>
  );
}

export function TableFrame({ children, label }: { children: ReactNode; label: string }): React.JSX.Element {
  return (
    <div className="mt-4 overflow-x-auto border-y border-zinc-800" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export const tableClassName = "w-full min-w-[680px] border-collapse text-left text-sm";
export const tableHeadClassName = "border-b border-zinc-800 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500";
export const tableCellClassName = "border-b border-zinc-900 px-3 py-3 align-top first:pl-0 last:pr-0";
