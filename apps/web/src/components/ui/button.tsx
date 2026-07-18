import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-[var(--pc-control-min-size)] shrink-0 items-center justify-center gap-2 rounded-[var(--pc-control-radius)] border px-3 text-sm font-semibold tracking-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pc-focus)] disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "border-[var(--pc-accent)] bg-[var(--pc-accent)] text-[var(--pc-accent-ink)] hover:bg-lime-200",
        secondary: "border-[var(--pc-control-border)] bg-[var(--pc-surface-raised)] text-[var(--pc-text)] hover:border-[var(--pc-control-border-hover)] hover:bg-zinc-800",
        ghost: "border-transparent bg-transparent text-[var(--pc-text-muted)] hover:bg-[var(--pc-surface-raised)] hover:text-[var(--pc-text)]",
        danger: "border-[var(--pc-danger)] bg-red-500/15 text-red-100 hover:bg-red-500/25",
      },
      size: {
        default: "px-3",
        sm: "px-2.5 text-xs sm:min-h-9",
        icon: "h-[var(--pc-control-min-size)] w-[var(--pc-control-min-size)] px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;
export type ButtonLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps): React.JSX.Element {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function ButtonLink({ className, variant, size, ...props }: ButtonLinkProps): React.JSX.Element {
  return <a className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
