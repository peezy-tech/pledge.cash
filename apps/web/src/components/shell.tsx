import type { Address } from "@pledge.cash/sdk";
import { CheckCircle2, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { addressUrl, transactionUrl } from "../lib/contracts";
import { shortAddress } from "../lib/forms";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Label } from "./ui/label";

type PanelProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

type WorkspaceHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
  children?: ReactNode;
};

type PageHeaderProps = {
  title: string;
  description?: string | undefined;
  eyebrow?: string | undefined;
  action?: ReactNode;
  meta?: ReactNode;
  className?: string | undefined;
};

type SectionProps = {
  title?: string | undefined;
  description?: string | undefined;
  action?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
};

type StatusNoticeProps = {
  title: string;
  children?: ReactNode;
  tone?: "info" | "success" | "warning" | "danger";
  className?: string | undefined;
};

type FieldProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

type FactsColumnCount = "one" | "two" | "three";

type FactItem = {
  label: string;
  value: ReactNode;
};

type FactsProps = {
  items: FactItem[];
  columns?: FactsColumnCount;
};

type ActionButtonProps = React.ComponentProps<typeof Button> & {
  actionId: string;
  pendingAction: string | undefined;
};

type TabButtonProps = {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
};

const factGridColumns: Record<FactsColumnCount, string> = {
  one: "grid-cols-1",
  two: "grid-cols-1 md:grid-cols-2",
  three: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
};

export function Panel({
  title,
  description,
  action,
  children,
  className,
}: PanelProps): React.JSX.Element {
  const hasDescription = description !== undefined && description.length > 0;

  return (
    <section className={cn("min-w-0 rounded-lg border border-[var(--pc-border)] bg-[var(--pc-surface-subtle)]", className)}>
      <div className="flex min-h-14 flex-col items-stretch justify-between gap-3 px-4 py-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h2 className="m-0 text-base font-semibold tracking-normal text-[var(--pc-text)]">{title}</h2>
          {hasDescription ? <p className="m-0 mt-1 max-w-3xl text-sm leading-5 text-[var(--pc-text-muted)]">{description}</p> : null}
        </div>
        {action ? <div className="flex self-stretch sm:self-auto [&>*]:w-full sm:[&>*]:w-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function WorkspaceHeader({
  eyebrow,
  title,
  description,
  action,
  children,
}: WorkspaceHeaderProps): React.JSX.Element {
  const hasAction = Boolean(action);
  const hasChildren = Boolean(children);

  return (
    <section className="mb-4 border-b border-[var(--pc-border)] pb-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--pc-accent)]">{eyebrow}</p>
          <h1 className="m-0 mt-1.5 text-2xl font-semibold tracking-tight text-[var(--pc-text)] sm:text-3xl">{title}</h1>
          <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-[var(--pc-text-muted)]">{description}</p>
        </div>
        {hasAction ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {hasChildren ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

export function PageHeader({
  action,
  className,
  description,
  eyebrow,
  meta,
  title,
}: PageHeaderProps): React.JSX.Element {
  return (
    <header className={cn("border-b border-[var(--pc-border)] pb-5", className)}>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {eyebrow ? <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--pc-accent)]">{eyebrow}</p> : null}
          <h1 className={cn("m-0 text-2xl font-semibold tracking-tight text-[var(--pc-text)] sm:text-3xl", eyebrow && "mt-1.5")}>{title}</h1>
          {description ? <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-[var(--pc-text-muted)]">{description}</p> : null}
          {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
    </header>
  );
}

export function Section({ action, children, className, description, title }: SectionProps): React.JSX.Element {
  return (
    <section className={cn("min-w-0 border-b border-[var(--pc-border)] py-6 last:border-b-0", className)}>
      {title || description || action ? (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title ? <h2 className="m-0 text-base font-semibold text-[var(--pc-text)]">{title}</h2> : null}
            {description ? <p className="m-0 mt-1 max-w-2xl text-sm leading-5 text-[var(--pc-text-muted)]">{description}</p> : null}
          </div>
          {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function StatusNotice({
  children,
  className,
  title,
  tone = "info",
}: StatusNoticeProps): React.JSX.Element {
  const toneClass = {
    danger: "border-[color:var(--pc-danger)]/35 bg-[color:var(--pc-danger)]/8",
    info: "border-[color:var(--pc-info)]/35 bg-[color:var(--pc-info)]/8",
    success: "border-[color:var(--pc-success)]/35 bg-[color:var(--pc-success)]/8",
    warning: "border-[color:var(--pc-warning)]/35 bg-[color:var(--pc-warning)]/8",
  }[tone];

  return (
    <div className={cn("rounded-md border p-3", toneClass, className)} role={tone === "danger" ? "alert" : "status"}>
      <p className="m-0 text-sm font-semibold text-[var(--pc-text)]">{title}</p>
      {children ? <div className="mt-1 text-sm leading-5 text-[var(--pc-text-muted)]">{children}</div> : null}
    </div>
  );
}

export function TechnicalDetails({ children, summary = "Technical details" }: { children: ReactNode; summary?: string }): React.JSX.Element {
  return (
    <details className="group border-t border-[var(--pc-border)] py-3">
      <summary className="cursor-pointer select-none text-sm font-medium text-[var(--pc-text-muted)] transition-colors hover:text-[var(--pc-text)]">
        {summary}
      </summary>
      <div className="mt-3 text-sm text-[var(--pc-text-muted)]">{children}</div>
    </details>
  );
}

export function Field({
  label,
  children,
  className,
}: FieldProps): React.JSX.Element {
  return (
    <Label className={cn("min-w-0 border-b border-[var(--pc-border)] p-4 text-[var(--pc-text-muted)] md:border-r [&:nth-child(2n)]:md:border-r-0", className)}>
      <span>{label}</span>
      {children}
    </Label>
  );
}

export function Facts({
  items,
  columns = "two",
}: FactsProps): React.JSX.Element {
  if (items.length === 0) {
    return <div className="border-t border-[var(--pc-border)] p-4 text-sm text-[var(--pc-text-muted)]">No data</div>;
  }

  return (
    <dl className={cn("grid gap-px border-t border-[var(--pc-border)] bg-transparent", factGridColumns[columns])}>
      {items.map((item) => (
        <div className="min-w-0 bg-[var(--pc-surface-subtle)] p-4" key={item.label}>
          <dt className="mb-1 text-xs font-medium text-[var(--pc-text-muted)]">{item.label}</dt>
          <dd className="m-0 break-words text-sm font-semibold text-[var(--pc-text)]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ActionRow({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="flex flex-wrap gap-2 border-t border-[var(--pc-border)] p-4">{children}</div>;
}

export function ActionButton({
  actionId,
  pendingAction,
  children,
  disabled,
  ...props
}: ActionButtonProps): React.JSX.Element {
  const isPending = pendingAction === actionId;
  const hasPendingAction = pendingAction !== undefined;

  return (
    <Button disabled={disabled || hasPendingAction} {...props}>
      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </Button>
  );
}

export function TabButton({
  active,
  children,
  onClick,
}: TabButtonProps): React.JSX.Element {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        "h-10 shrink-0 border-b-2 px-3 text-sm font-semibold transition-colors",
        active
          ? "border-[var(--pc-accent)] text-[var(--pc-text)]"
          : "border-transparent text-[var(--pc-text-muted)] hover:border-[var(--pc-border-strong)] hover:text-[var(--pc-text)]",
      )}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function AddressLink({ address }: { address: Address }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const explorerUrl = addressUrl(address);
  const label = shortAddress(address);
  const hasExplorerUrl = explorerUrl !== undefined && explorerUrl.length > 0;

  const copyAddress = async (): Promise<void> => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
      {hasExplorerUrl ? (
        <a
          className="min-w-0 truncate text-lime-200 hover:text-lime-100"
          href={explorerUrl}
          rel="noreferrer"
          target="_blank"
          title={address}
        >
          {label}
        </a>
      ) : (
        <span className="min-w-0 truncate text-lime-200" title={address}>
          {label}
        </span>
      )}
      <button
        aria-label="Copy address"
        className="grid h-10 w-10 shrink-0 place-items-center rounded border border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 sm:h-8 sm:w-8"
        type="button"
        onClick={() => void copyAddress()}
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-lime-300" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {hasExplorerUrl ? (
        <a
          aria-label="Open in explorer"
          className="grid h-10 w-10 shrink-0 place-items-center rounded border border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 sm:h-8 sm:w-8"
          href={explorerUrl}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </span>
  );
}

export function TransactionLink({ chainId, hash }: { chainId?: number | undefined; hash: Hex }): React.JSX.Element {
  const explorerUrl = transactionUrl(hash, chainId);
  const label = shortAddress(hash);

  if (!explorerUrl) {
    return <span className="text-lime-200">{label}</span>;
  }

  return (
    <a className="text-lime-200 hover:text-lime-100" href={explorerUrl} rel="noreferrer" target="_blank">
      {label}
    </a>
  );
}
