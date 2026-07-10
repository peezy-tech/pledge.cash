import { ArrowRight, RefreshCw, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { Address } from "@pledge.cash/sdk";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { shortAddress } from "../../lib/forms";
import type { ProductBoardroomCatalogEntry } from "../../lib/product-boardroom";
import { formatTokenAmount } from "../../lib/token-amounts";
import { cn } from "../../lib/utils";
import { PageHeading, PageNotice, RuledSection, SectionHeading } from "./page-primitives";

export type ExploreFilter = "all" | "fixed-price-sale" | "migrating-bonding-curve" | "merkle-airdrop" | "amm";

export type ExplorePageProps = {
  chainId: number;
  chainName: string;
  emptyAction?: ReactNode;
  error?: string | undefined;
  loading: boolean;
  onOpenProject: (project: ProductBoardroomCatalogEntry) => void;
  onRetry?: (() => void) | undefined;
  projectHref?: ((project: ProductBoardroomCatalogEntry) => string) | undefined;
  projects: readonly ProductBoardroomCatalogEntry[];
  selectedAddress?: Address | undefined;
};

const filters: readonly { label: string; value: ExploreFilter }[] = [
  { label: "All", value: "all" },
  { label: "Fixed price", value: "fixed-price-sale" },
  { label: "Curve", value: "migrating-bonding-curve" },
  { label: "Airdrop", value: "merkle-airdrop" },
  { label: "AMM", value: "amm" },
];

export function ExplorePage({
  chainId,
  chainName,
  emptyAction,
  error,
  loading,
  onOpenProject,
  onRetry,
  projectHref,
  projects,
  selectedAddress,
}: ExplorePageProps): React.JSX.Element {
  const [filter, setFilter] = useState<ExploreFilter>("all");
  const [query, setQuery] = useState("");
  const visibleProjects = useMemo(() => filterProjects(projects, query, filter), [filter, projects, query]);

  return (
    <div className="grid gap-0">
      <PageHeading
        eyebrow="Explore"
        title="Project directory"
        description={`Boardrooms discovered on ${chainName}. Open any project to inspect its treasury, participation paths, governance, and onchain evidence.`}
      />

      <RuledSection>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="grid max-w-xl gap-1.5 text-xs font-semibold text-zinc-400">
            Search projects
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
              <Input
                className="pl-9"
                placeholder="Name, symbol, or Boardroom address"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </span>
          </label>
          <p className="m-0 text-xs text-zinc-500 lg:pb-3">
            Chain {chainId} · {projects.length} {projects.length === 1 ? "project" : "projects"}
          </p>
        </div>
        <div aria-label="Participation type" className="mt-4 flex flex-wrap gap-2" role="group">
          {filters.map((item) => (
            <button
              aria-pressed={filter === item.value}
              className={cn(
                "min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors",
                filter === item.value
                  ? "border-lime-300 bg-lime-300 text-zinc-950"
                  : "border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100",
              )}
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </RuledSection>

      <RuledSection>
        <SectionHeading
          title="Projects"
          description="Each row is a complete link. Status and amounts are read from the selected network."
        />
        {error ? (
          <div className="mt-4">
            <PageNotice title="The directory could not be loaded" tone="danger">
              <p className="m-0">{error}</p>
              {onRetry ? (
                <Button className="mt-3" size="sm" variant="secondary" onClick={onRetry}>
                  <RefreshCw className="h-4 w-4" />
                  Try again
                </Button>
              ) : null}
            </PageNotice>
          </div>
        ) : loading ? (
          <DirectoryLoading />
        ) : visibleProjects.length === 0 ? (
          <div className="mt-5 border-y border-zinc-800 py-8">
            <h3 className="m-0 text-base font-semibold text-zinc-100">
              {projects.length === 0 ? "No projects discovered" : "No projects match these filters"}
            </h3>
            <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
              {projects.length === 0
                ? "This network has not returned a Boardroom yet. You can still open Studio to create or inspect one by address."
                : "Clear the search or choose All to see the full directory."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {projects.length > 0 ? (
                <Button variant="secondary" onClick={() => { setFilter("all"); setQuery(""); }}>
                  Clear filters
                </Button>
              ) : emptyAction}
            </div>
          </div>
        ) : (
          <ol className="m-0 mt-4 list-none border-t border-zinc-800 p-0">
            {visibleProjects.map((project) => (
              <ProjectDirectoryRow
                active={sameAddress(project.address, selectedAddress)}
                key={project.address}
                project={project}
                onOpen={() => onOpenProject(project)}
                {...(projectHref ? { href: projectHref(project) } : {})}
              />
            ))}
          </ol>
        )}
      </RuledSection>
    </div>
  );
}

export function filterProjects(
  projects: readonly ProductBoardroomCatalogEntry[],
  query: string,
  filter: ExploreFilter,
): ProductBoardroomCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  return projects.filter((project) => {
    const matchesQuery = needle.length === 0 || [project.name, project.symbol, project.address, project.path]
      .some((value) => value?.toLowerCase().includes(needle));
    return matchesQuery && matchesExploreFilter(project, filter);
  });
}

function ProjectDirectoryRow({
  active,
  href,
  onOpen,
  project,
}: {
  active: boolean;
  href?: string;
  onOpen: () => void;
  project: ProductBoardroomCatalogEntry;
}): React.JSX.Element {
  const content = (
    <>
      <div className="col-span-4 min-w-0 lg:col-span-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-base font-semibold text-zinc-50">{project.name ?? project.symbol ?? "Untitled project"}</span>
          <Badge variant={active ? "default" : project.error ? "danger" : "muted"}>
            {active ? "Open" : project.error ? "Read issue" : project.status ?? "Discovered"}
          </Badge>
        </div>
        <p className="m-0 mt-1 truncate text-xs text-zinc-500">
          {project.symbol ? `${project.symbol} · ` : ""}{shortAddress(project.address)} · {participationLabel(project)}
        </p>
      </div>
      <DirectoryValue label="Sold" value={formatTokenAmount(project.soldShares, catalogShareMetadata(project))} />
      <DirectoryValue label="Raised" value={formatTokenAmount(project.cashRaised, catalogCashMetadata(project))} />
      <DirectoryValue label="Participants" value={project.buyerCount === undefined ? "Unknown" : String(project.buyerCount)} />
      <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-lime-200" />
    </>
  );
  const className = cn(
    "group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.7fr)_auto] gap-3 border-b border-zinc-800 py-4 text-left transition-colors hover:bg-zinc-900/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime-300/70 sm:px-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(110px,0.45fr)_minmax(110px,0.45fr)_minmax(90px,0.35fr)_auto] lg:items-center",
    active ? "bg-zinc-900/55" : null,
  );

  return (
    <li>
      {href ? (
        <a className={className} href={href} onClick={onOpen}>{content}</a>
      ) : (
        <button className={className} type="button" onClick={onOpen}>{content}</button>
      )}
    </li>
  );
}

function DirectoryValue({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <span className="min-w-0">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-600">{label}</span>
      <span className="mt-1 block truncate text-sm font-semibold text-zinc-200">{value}</span>
    </span>
  );
}

function DirectoryLoading(): React.JSX.Element {
  return (
    <div aria-label="Loading projects" aria-live="polite" className="mt-4 border-t border-zinc-800" role="status">
      {[0, 1, 2].map((index) => (
        <div className="grid animate-pulse gap-3 border-b border-zinc-800 py-5 sm:px-3 lg:grid-cols-[1fr_120px_120px]" key={index}>
          <span className="h-5 max-w-sm rounded bg-zinc-800" />
          <span className="h-5 rounded bg-zinc-900" />
          <span className="h-5 rounded bg-zinc-900" />
        </div>
      ))}
    </div>
  );
}

function matchesExploreFilter(project: ProductBoardroomCatalogEntry, filter: ExploreFilter): boolean {
  if (filter === "all") return true;
  if (filter === "amm") return Boolean(project.pool) || (project.swapCount ?? 0) > 0;
  return project.distributionKind === filter;
}

function participationLabel(project: ProductBoardroomCatalogEntry): string {
  if (project.pool) return "AMM market";
  if (project.distributionKind === "fixed-price-sale") return "Fixed-price sale";
  if (project.distributionKind === "migrating-bonding-curve") return "Bonding curve";
  if (project.distributionKind === "merkle-airdrop") return "Airdrop";
  return project.path ?? "Boardroom";
}

function catalogShareMetadata(project: ProductBoardroomCatalogEntry): { address: Address; decimals?: number; symbol?: string } | undefined {
  if (!project.shareToken) return undefined;
  return {
    address: project.shareToken,
    ...(project.shareTokenDecimals === undefined ? {} : { decimals: project.shareTokenDecimals }),
    ...(project.symbol === undefined ? {} : { symbol: project.symbol }),
  };
}

function catalogCashMetadata(project: ProductBoardroomCatalogEntry): { address: Address; decimals?: number; symbol?: string } | undefined {
  if (!project.cashToken) return undefined;
  return {
    address: project.cashToken,
    ...(project.cashTokenDecimals === undefined ? {} : { decimals: project.cashTokenDecimals }),
    ...(project.cashTokenSymbol === undefined ? {} : { symbol: project.cashTokenSymbol }),
  };
}

function sameAddress(first: Address, second: Address | undefined): boolean {
  return second !== undefined && first.toLowerCase() === second.toLowerCase();
}
