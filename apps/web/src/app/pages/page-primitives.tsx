import type { ReactNode } from "react";

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
