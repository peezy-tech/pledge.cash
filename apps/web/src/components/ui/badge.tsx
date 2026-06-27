import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../../lib/utils";

const badgeVariants = cva("inline-flex min-h-7 items-center rounded-md border px-2 text-xs font-semibold", {
  variants: {
    variant: {
      default: "border-lime-300/30 bg-lime-300/10 text-lime-200",
      muted: "border-zinc-800 bg-zinc-900 text-zinc-300",
      warning: "border-amber-300/30 bg-amber-300/10 text-amber-200",
      danger: "border-red-300/30 bg-red-400/10 text-red-200",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
