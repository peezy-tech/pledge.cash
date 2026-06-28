import type * as React from "react";
import { cn } from "../../lib/utils";

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, ...props }: LabelProps): React.JSX.Element {
  return <label className={cn("grid gap-2 text-xs font-semibold text-zinc-400", className)} {...props} />;
}
