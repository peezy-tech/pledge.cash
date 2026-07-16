import type { Address } from "@pledge.cash/sdk";
import { Compass, Landmark, WalletCards } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { cn } from "../lib/utils";
import {
  appRouteHref,
  projectRouteHref,
  studioRouteHref,
  type PrimaryDestination,
  type ProjectSection,
  type StudioSection,
} from "./routing";

type PrimaryNavigationProps = {
  active: PrimaryDestination | undefined;
  chainId?: number | undefined;
  className?: string | undefined;
  onNavigate?: ((destination: PrimaryDestination) => void) | undefined;
};

type ProjectSectionNavProps = {
  active: ProjectSection;
  boardroom: Address;
  chainId: number;
  className?: string | undefined;
};

type PrimaryNavigationItem = {
  destination: PrimaryDestination;
  icon: ReactNode;
  label: string;
};

const PRIMARY_NAVIGATION_ITEMS: PrimaryNavigationItem[] = [
  { destination: "explore", icon: <Compass className="h-4 w-4" />, label: "Explore" },
  { destination: "portfolio", icon: <WalletCards className="h-4 w-4" />, label: "Portfolio" },
  { destination: "studio", icon: <Landmark className="h-4 w-4" />, label: "Studio" },
];

const PROJECT_SECTIONS: { section: ProjectSection; label: string }[] = [
  { section: "overview", label: "Overview" },
  { section: "participate", label: "Participate" },
  { section: "governance", label: "Governance" },
  { section: "transparency", label: "Transparency" },
];

const STUDIO_SECTIONS: { section: StudioSection; label: string }[] = [
  { section: "setup", label: "Setup" },
  { section: "token", label: "Token" },
  { section: "grants", label: "Grants" },
  { section: "distributions", label: "Distributions" },
  { section: "liquidity", label: "Liquidity" },
  { section: "governance", label: "Governance" },
  { section: "close", label: "Close" },
];

export function DesktopPrimaryNav({ active, chainId, className, onNavigate }: PrimaryNavigationProps): React.JSX.Element {
  return (
    <nav aria-label="Primary" className={cn("hidden items-center gap-1 md:flex", className)}>
      {PRIMARY_NAVIGATION_ITEMS.map((item) => (
        <a
          aria-current={active === item.destination ? "page" : undefined}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
            active === item.destination
              ? "bg-[var(--pc-surface-raised)] text-[var(--pc-text)]"
              : "text-[var(--pc-text-muted)] hover:bg-[var(--pc-surface)] hover:text-[var(--pc-text)]",
          )}
          href={primaryHref(item.destination, chainId)}
          key={item.destination}
          onClick={(event) => {
            if (!onNavigate || !shouldHandleClientNavigation(event)) return;
            event.preventDefault();
            onNavigate(item.destination);
          }}
        >
          {item.icon}
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export function MobilePrimaryNav({ active, chainId, className, onNavigate }: PrimaryNavigationProps): React.JSX.Element {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-[var(--pc-border)] bg-[color:var(--pc-canvas-translucent)] px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl md:hidden",
        className,
      )}
    >
      {PRIMARY_NAVIGATION_ITEMS.map((item) => (
        <a
          aria-current={active === item.destination ? "page" : undefined}
          className={cn(
            "flex min-h-12 flex-col items-center justify-center gap-1 rounded-md px-2 text-[11px] font-semibold transition-colors",
            active === item.destination
              ? "text-[var(--pc-accent)]"
              : "text-[var(--pc-text-muted)] hover:bg-[var(--pc-surface)] hover:text-[var(--pc-text)]",
          )}
          href={primaryHref(item.destination, chainId)}
          key={item.destination}
          onClick={(event) => {
            if (!onNavigate || !shouldHandleClientNavigation(event)) return;
            event.preventDefault();
            onNavigate(item.destination);
          }}
        >
          {item.icon}
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export function ProjectSectionNav({
  active,
  boardroom,
  chainId,
  className,
}: ProjectSectionNavProps): React.JSX.Element {
  return (
    <nav
      aria-label="Project sections"
      className={cn(
        "grid grid-cols-2 border-b border-[var(--pc-border)] sm:grid-cols-4 md:flex md:gap-6",
        className,
      )}
    >
      {PROJECT_SECTIONS.map((item) => {
        const selected = active === item.section;
        return (
          <a
            aria-current={selected ? "page" : undefined}
            aria-label={item.label}
            className={cn(
              "relative flex min-h-12 items-center justify-center px-2 text-xs font-semibold transition-colors md:justify-start md:px-0 md:text-sm",
              selected
                ? "text-[var(--pc-text)] after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-[var(--pc-accent)] md:after:inset-x-0"
                : "text-[var(--pc-text-muted)] hover:text-[var(--pc-text)]",
            )}
            href={projectRouteHref(chainId, boardroom, item.section)}
            key={item.section}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

export function StudioSectionNav({
  active,
  boardroom,
  chainId,
  onNavigate,
}: {
  active: StudioSection;
  boardroom: Address;
  chainId: number;
  onNavigate?: ((section: StudioSection) => void) | undefined;
}): React.JSX.Element {
  return (
    <>
      <label className="grid gap-1.5 text-xs font-semibold text-[var(--pc-text-muted)] md:hidden">
        Studio section
        <select
          className="h-11 rounded-md border border-[var(--pc-border-strong)] bg-[var(--pc-surface)] px-3 text-sm text-[var(--pc-text)]"
          value={active}
          onChange={(event) => onNavigate?.(event.target.value as StudioSection)}
        >
          {STUDIO_SECTIONS.map((item) => <option key={item.section} value={item.section}>{item.label}</option>)}
        </select>
      </label>
      <nav aria-label="Studio sections" className="hidden gap-1 overflow-x-auto md:flex">
        {STUDIO_SECTIONS.map((item) => (
          <a
            aria-current={active === item.section ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-md px-3 py-2 text-sm font-semibold transition-colors",
              active === item.section
                ? "bg-[var(--pc-surface-raised)] text-[var(--pc-text)]"
                : "text-[var(--pc-text-muted)] hover:bg-[var(--pc-surface)] hover:text-[var(--pc-text)]",
            )}
            href={studioRouteHref(chainId, boardroom, item.section)}
            key={item.section}
            onClick={(event) => {
              if (!onNavigate || !shouldHandleClientNavigation(event)) return;
              event.preventDefault();
              onNavigate(item.section);
            }}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </>
  );
}

function primaryHref(destination: PrimaryDestination, chainId: number | undefined): string {
  return appRouteHref({ kind: destination, ...(chainId === undefined ? {} : { chainId }) });
}

export function shouldHandleClientNavigation(
  event: Pick<MouseEvent<HTMLAnchorElement>, "altKey" | "button" | "ctrlKey" | "metaKey" | "shiftKey">,
): boolean {
  return event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}
