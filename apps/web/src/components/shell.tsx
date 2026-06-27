import type { Address } from "@pledge.cash/sdk";
import { CheckCircle2, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { addressUrl, transactionUrl } from "../lib/contracts";
import { shortAddress } from "../lib/forms";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Label } from "./ui/label";

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <section className={cn("min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/82", className)}>
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
        <h2 className="m-0 text-base font-semibold tracking-normal text-zinc-50">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <Label className={cn("min-w-0 border-b border-zinc-800 p-4 md:border-r [&:nth-child(2n)]:md:border-r-0", className)}>
      <span>{label}</span>
      {children}
    </Label>
  );
}

export function Facts({
  items,
  columns = "two",
}: {
  items: { label: string; value: ReactNode }[];
  columns?: "one" | "two" | "three";
}): React.JSX.Element {
  if (items.length === 0) {
    return <div className="border-t border-zinc-800 p-4 text-sm text-zinc-500">No data</div>;
  }

  return (
    <dl
      className={cn(
        "grid gap-px border-t border-zinc-800 bg-zinc-800",
        columns === "one" && "grid-cols-1",
        columns === "two" && "grid-cols-1 md:grid-cols-2",
        columns === "three" && "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
      )}
    >
      {items.map((item) => (
        <div className="min-w-0 bg-zinc-950 p-4" key={item.label}>
          <dt className="mb-1 text-xs font-medium text-zinc-500">{item.label}</dt>
          <dd className="m-0 break-words text-sm font-semibold text-zinc-100">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ActionRow({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="flex flex-wrap gap-2 border-t border-zinc-800 p-4">{children}</div>;
}

export function ActionButton({
  actionId,
  pendingAction,
  children,
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & {
  actionId: string;
  pendingAction: string | undefined;
}): React.JSX.Element {
  const pending = pendingAction === actionId;
  return (
    <Button disabled={disabled || pendingAction !== undefined} {...props}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </Button>
  );
}

export function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      className={cn(
        "h-9 rounded-md border px-3 text-sm font-semibold transition-colors",
        active ? "border-lime-300 bg-lime-300 text-zinc-950" : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900",
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

  const copyAddress = async (): Promise<void> => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
      <a
        className="min-w-0 truncate text-lime-200 hover:text-lime-100"
        href={addressUrl(address)}
        rel="noreferrer"
        target="_blank"
        title={address}
      >
        {shortAddress(address)}
      </a>
      <button
        aria-label="Copy address"
        className="grid h-6 w-6 shrink-0 place-items-center rounded border border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        type="button"
        onClick={() => void copyAddress()}
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-lime-300" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <a
        aria-label="Open in explorer"
        className="grid h-6 w-6 shrink-0 place-items-center rounded border border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        href={addressUrl(address)}
        rel="noreferrer"
        target="_blank"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </span>
  );
}

export function TransactionLink({ hash }: { hash: Hex }): React.JSX.Element {
  return (
    <a className="text-lime-200 hover:text-lime-100" href={transactionUrl(hash)} rel="noreferrer" target="_blank">
      {shortAddress(hash)}
    </a>
  );
}
