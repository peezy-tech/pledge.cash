import type * as React from "react";
import { cn } from "../../lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps): React.JSX.Element {
  return (
    <input
      className={cn(
        "min-h-[var(--pc-control-min-size)] w-full rounded-[var(--pc-control-radius)] border border-[var(--pc-control-border)] bg-[var(--pc-control-surface)] px-3 text-sm text-[var(--pc-text)] outline-none transition-colors placeholder:text-[var(--pc-text-subtle)] hover:border-[var(--pc-control-border-hover)] focus:border-[var(--pc-focus)] focus:ring-2 focus:ring-[color:var(--pc-focus)]/20 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
