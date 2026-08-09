import type { Address } from "@pledge.cash/sdk";
import { AlertCircle, CheckCircle2, Copy, ExternalLink, Loader2 } from "lucide-react";
import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
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

export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-errormessage"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
};

type FieldControlElementProps = {
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-errormessage"?: string;
  "aria-invalid"?: boolean | "false" | "grammar" | "spelling" | "true";
  "aria-required"?: boolean | "false" | "true";
};

export type FieldProps = {
  label: string;
  children: ReactNode | ((controlProps: FieldControlProps) => ReactNode);
  className?: string;
  controlId?: string;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
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

export type ActionButtonProps = React.ComponentProps<typeof Button> & {
  actionId: string;
  pendingAction: string | undefined;
  pendingLabel?: string;
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

export function Field({
  label,
  children,
  className,
  controlId,
  description,
  error,
  required = false,
}: FieldProps): React.JSX.Element {
  const generatedId = `field-${useId().replaceAll(":", "")}`;
  const directControl = isDirectFieldControl(children);
  const resolvedControlId = controlId ?? directControl?.props.id ?? generatedId;
  const descriptionId = description ? `${resolvedControlId}-description` : undefined;
  const errorId = error ? `${resolvedControlId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  const controlProps: FieldControlProps = {
    id: resolvedControlId,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(errorId ? { "aria-errormessage": errorId, "aria-invalid": true } : {}),
    ...(required ? { "aria-required": true } : {}),
  };
  const canAssociateLabel = typeof children === "function" || controlId !== undefined || directControl !== undefined;
  const control = typeof children === "function"
    ? children(controlProps)
    : directControl
      ? cloneElement(directControl, mergeFieldControlProps(directControl.props, controlProps))
      : children;

  return (
    <div className={cn("grid min-w-0 gap-2 border-b border-[var(--pc-border)] p-4 md:border-r [&:nth-child(2n)]:md:border-r-0", className)}>
      <Label htmlFor={canAssociateLabel ? resolvedControlId : undefined}>
        <span>
          {label}
          {required ? <span aria-hidden="true" className="ml-1 text-[var(--pc-danger)]">*</span> : null}
        </span>
      </Label>
      {control}
      {description ? <p className="m-0 text-xs leading-5 text-[var(--pc-text-subtle)]" id={descriptionId}>{description}</p> : null}
      {error ? (
        <p className="m-0 flex items-start gap-1.5 text-xs leading-5 text-[var(--pc-danger)]" id={errorId} role="alert">
          <AlertCircle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

function isDirectFieldControl(children: FieldProps["children"]): ReactElement<FieldControlElementProps> | undefined {
  if (!isValidElement<FieldControlElementProps>(children)) return undefined;
  if (typeof children.type === "string") {
    return ["button", "input", "select", "textarea"].includes(children.type) ? children : undefined;
  }
  return typeof children.type === "function" || typeof children.type === "object" ? children : undefined;
}

function mergeFieldControlProps(
  existing: FieldControlElementProps,
  field: FieldControlProps,
): FieldControlElementProps {
  const describedBy = [existing["aria-describedby"], field["aria-describedby"]].filter(Boolean).join(" ") || undefined;

  return {
    ...field,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(field["aria-invalid"] === undefined && existing["aria-invalid"] !== undefined
      ? { "aria-invalid": existing["aria-invalid"] }
      : {}),
    ...(field["aria-errormessage"] === undefined && existing["aria-errormessage"]
      ? { "aria-errormessage": existing["aria-errormessage"] }
      : {}),
    ...(field["aria-required"] === undefined && existing["aria-required"] !== undefined
      ? { "aria-required": existing["aria-required"] }
      : {}),
  };
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
  pendingLabel,
  children,
  disabled,
  ...props
}: ActionButtonProps): React.JSX.Element {
  const isPending = pendingAction === actionId;
  const hasPendingAction = pendingAction !== undefined;

  return (
    <>
      <Button {...props} aria-busy={isPending || undefined} disabled={disabled || hasPendingAction}>
        <span aria-hidden="true" className="grid h-4 w-4 shrink-0 place-items-center">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        </span>
        <span className="inline-flex min-w-0 items-center gap-2">{children}</span>
      </Button>
      {isPending && pendingLabel ? (
        <span aria-live="polite" className="sr-only" role="status">{pendingLabel}</span>
      ) : null}
    </>
  );
}

export function AddressLink({ address, chainId }: { address: Address; chainId?: number | undefined }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const explorerUrl = addressUrl(address, chainId);
  const label = shortAddress(address);
  const hasExplorerUrl = explorerUrl !== undefined && explorerUrl.length > 0;

  const copyAddress = async (): Promise<void> => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
      <span className="min-w-0 truncate text-lime-200" title={address}>
        {label}
      </span>
      <button
        aria-label={`Copy address ${address}`}
        className="grid h-11 w-11 shrink-0 place-items-center rounded border border-[var(--pc-control-border)] text-[var(--pc-text-muted)] hover:bg-[var(--pc-surface-raised)] hover:text-[var(--pc-text)] sm:h-9 sm:w-9"
        type="button"
        onClick={() => void copyAddress()}
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-lime-300" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {hasExplorerUrl ? (
        <a
          aria-label={`Open address ${address} in explorer`}
          className="grid h-11 w-11 shrink-0 place-items-center rounded border border-[var(--pc-control-border)] text-[var(--pc-text-muted)] hover:bg-[var(--pc-surface-raised)] hover:text-[var(--pc-text)] sm:h-9 sm:w-9"
          href={explorerUrl}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
      <span aria-live="polite" className="sr-only" role="status">
        {copied ? `Copied address ${address}` : ""}
      </span>
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
