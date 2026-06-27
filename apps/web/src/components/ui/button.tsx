import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold tracking-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300/70 disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "border-lime-300 bg-lime-300 text-zinc-950 hover:bg-lime-200",
        secondary: "border-zinc-800 bg-zinc-900 text-zinc-100 hover:bg-zinc-800",
        ghost: "border-transparent bg-transparent text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50",
        danger: "border-red-400/40 bg-red-500/15 text-red-200 hover:bg-red-500/25",
      },
      size: {
        default: "h-10 px-3",
        sm: "h-8 px-2.5 text-xs",
        icon: "h-9 w-9 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps): React.JSX.Element {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
