import { ArrowRight, RefreshCw, Search, Star } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Address } from "@pledge.cash/sdk";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ExploreMarketMetrics, ExploreNetworkSummary } from "../../features/market";
import { shortAddress } from "../../lib/forms";
import type { ProductBoardroomCatalogEntry } from "../../lib/product-boardroom";
import { cn } from "../../lib/utils";
import { PageHeading, PageNotice, RuledSection, SectionHeading } from "./page-primitives";

export type ExploreFilter = "all" | "saved" | "bond-market" | "fixed-price-sale" | "migrating-bonding-curve" | "merkle-airdrop" | "amm";
export type ExploreSearchState = { filter: ExploreFilter; query: string };

export type ExplorePageProps = {
  chainId: number;
  chainName: string;
  canLoadMore?: boolean | undefined;
  emptyAction?: ReactNode;
  error?: string | undefined;
  loadMoreError?: string | undefined;
  loading: boolean;
  loadingMore?: boolean | undefined;
  onLoadMore?: (() => void) | undefined;
  onOpenProject: (project: ProductBoardroomCatalogEntry) => void;
  onRetry?: (() => void) | undefined;
  onToggleSaved?: ((project: ProductBoardroomCatalogEntry) => void) | undefined;
  projectHref?: ((project: ProductBoardroomCatalogEntry) => string) | undefined;
  projects: readonly ProductBoardroomCatalogEntry[];
  savedProjectAddresses?: ReadonlySet<string> | undefined;
  savedProjectCount?: number | undefined;
  savedProjectsWarning?: string | undefined;
  selectedAddress?: Address | undefined;
  totalProjects?: number | undefined;
};

const filters: readonly { label: string; value: ExploreFilter }[] = [
  { label: "All", value: "all" },
  { label: "Saved", value: "saved" },
  { label: "Fixed price", value: "fixed-price-sale" },
  { label: "Bonds", value: "bond-market" },
  { label: "Curve", value: "migrating-bonding-curve" },
  { label: "Airdrop", value: "merkle-airdrop" },
  { label: "AMM", value: "amm" },
];
const filterValues = new Set<ExploreFilter>(filters.map((filter) => filter.value));

export function ExplorePage({
  chainId,
  chainName,
  canLoadMore = false,
  emptyAction,
  error,
  loadMoreError,
  loading,
  loadingMore = false,
  onLoadMore,
  onOpenProject,
  onRetry,
  onToggleSaved,
  projectHref,
  projects,
  savedProjectAddresses = new Set<string>(),
  savedProjectCount = 0,
  savedProjectsWarning,
  selectedAddress,
  totalProjects,
}: ExplorePageProps): React.JSX.Element {
  const [filter, setFilter] = useState<ExploreFilter>(() => initialExploreSearchState().filter);
  const [query, setQuery] = useState(() => initialExploreSearchState().query);
  const visibleProjects = useMemo(
    () => filterProjects(projects, query, filter, savedProjectAddresses),
    [filter, projects, query, savedProjectAddresses],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const restoreSearch = (): void => {
      const restored = exploreSearchState(window.location.search);
      setFilter(restored.filter);
      setQuery(restored.query);
    };
    window.addEventListener("popstate", restoreSearch);
    return () => window.removeEventListener("popstate", restoreSearch);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const pathname = window.location.pathname;
    queueMicrotask(() => {
      if (window.location.pathname !== pathname) return;
      replaceExploreSearchState({ filter, query });
    });
  }, [chainId, filter, query]);

  return (
    <div className="grid gap-0">
      <PageHeading
        eyebrow="Explore"
        title="Project directory: markets and live routes"
        description={`Browse ${chainName} without a wallet. Inspect current participation status, quote-token prices, liquidity, project contracts, treasury evidence, and governance before deciding whether to connect.`}
      />
      <ExploreNetworkSummary projects={projects} totalProjects={totalProjects} />

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
            Chain {chainId} · {directoryCountLabel(projects.length, totalProjects)}
          </p>
        </div>
        <div aria-label="Project filters" className="mt-4 flex flex-wrap gap-2" role="group">
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
        {savedProjectsWarning ? (
          <div className="mt-4">
            <PageNotice title="Saved projects could not be restored" tone="warning">
              {savedProjectsWarning}
            </PageNotice>
          </div>
        ) : null}
      </RuledSection>

      <RuledSection>
        <SectionHeading
          title="Compare projects"
          description="Rows lead with route liveness and quote-token-denominated market facts. Unknown values show why they are unknown; the star only saves a browser shortcut."
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
              {emptyDirectoryTitle(filter, projects.length, savedProjectCount)}
            </h3>
            <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
              {emptyDirectoryDescription(filter, projects.length, savedProjectCount, canLoadMore)}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {projects.length > 0 || filter === "saved" ? (
                <Button variant="secondary" onClick={() => { setFilter("all"); setQuery(""); }}>
                  {filter === "saved" ? "Show all projects" : "Clear filters"}
                </Button>
              ) : emptyAction}
              {canLoadMore && onLoadMore ? (
                <Button disabled={loadingMore} variant="secondary" onClick={onLoadMore}>
                  {loadingMore ? "Loading projects…" : "Load more projects"}
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <ol className="m-0 mt-4 list-none border-t border-zinc-800 p-0">
              {visibleProjects.map((project) => (
                <ProjectDirectoryRow
                  active={sameAddress(project.address, selectedAddress)}
                  key={project.address}
                  project={project}
                  saved={savedProjectAddresses.has(project.address.toLowerCase())}
                  onOpen={() => onOpenProject(project)}
                  onToggleSaved={onToggleSaved ? () => onToggleSaved(project) : undefined}
                  {...(projectHref ? { href: projectHref(project) } : {})}
                />
              ))}
            </ol>
            {canLoadMore && onLoadMore ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 py-4">
                <p className="m-0 text-xs text-zinc-500">
                  Showing {projects.length.toLocaleString()} of {(totalProjects ?? projects.length).toLocaleString()} projects
                </p>
                <Button disabled={loadingMore} size="sm" variant="secondary" onClick={onLoadMore}>
                  {loadingMore ? "Loading projects…" : "Load more projects"}
                </Button>
              </div>
            ) : null}
          </>
        )}
        {loadMoreError ? (
          <div className="mt-4">
            <PageNotice title="More projects could not be loaded" tone="danger">
              <p className="m-0">{loadMoreError}</p>
              {canLoadMore && onLoadMore ? (
                <Button className="mt-3" disabled={loadingMore} size="sm" variant="secondary" onClick={onLoadMore}>
                  <RefreshCw className="h-4 w-4" />
                  Try loading more again
                </Button>
              ) : null}
            </PageNotice>
          </div>
        ) : null}
      </RuledSection>
    </div>
  );
}

export function exploreSearchState(search: string): ExploreSearchState {
  try {
    const parameters = new URLSearchParams(search);
    const requestedFilter = parameters.get("type") as ExploreFilter | null;
    return {
      filter: requestedFilter && filterValues.has(requestedFilter) ? requestedFilter : "all",
      query: parameters.get("q") ?? "",
    };
  } catch {
    return { filter: "all", query: "" };
  }
}

export function exploreSearchHref(
  pathname: string,
  search: string,
  state: ExploreSearchState,
  hash = "",
): string {
  const parameters = new URLSearchParams(search);
  if (state.query) parameters.set("q", state.query);
  else parameters.delete("q");
  if (state.filter === "all") parameters.delete("type");
  else parameters.set("type", state.filter);
  const nextSearch = parameters.toString();
  return `${pathname}${nextSearch ? `?${nextSearch}` : ""}${hash}`;
}

export function replaceExploreSearchState(
  state: ExploreSearchState,
  navigation: {
    history: Pick<History, "replaceState" | "state">;
    location: Pick<Location, "hash" | "pathname" | "search">;
  } | undefined = typeof window === "undefined"
    ? undefined
    : { history: window.history, location: window.location },
): string | undefined {
  if (!navigation) return undefined;
  const href = exploreSearchHref(
    navigation.location.pathname,
    navigation.location.search,
    state,
    navigation.location.hash,
  );
  const current = `${navigation.location.pathname}${navigation.location.search}${navigation.location.hash}`;
  if (href !== current) navigation.history.replaceState(navigation.history.state, "", href);
  return href;
}

function initialExploreSearchState(): ExploreSearchState {
  return typeof window === "undefined" ? { filter: "all", query: "" } : exploreSearchState(window.location.search);
}

function directoryCountLabel(loaded: number, total: number | undefined): string {
  if (total !== undefined && total > loaded) {
    return `${loaded.toLocaleString()} of ${total.toLocaleString()} projects loaded`;
  }
  return `${loaded.toLocaleString()} ${loaded === 1 ? "project" : "projects"}`;
}

export function filterProjects(
  projects: readonly ProductBoardroomCatalogEntry[],
  query: string,
  filter: ExploreFilter,
  savedProjectAddresses: ReadonlySet<string> = new Set<string>(),
): ProductBoardroomCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  return projects.filter((project) => {
    const matchesQuery = needle.length === 0 || [project.name, project.symbol, project.address, project.path]
      .some((value) => value?.toLowerCase().includes(needle));
    return matchesQuery && matchesExploreFilter(project, filter, savedProjectAddresses);
  });
}

function ProjectDirectoryRow({
  active,
  href,
  onOpen,
  onToggleSaved,
  project,
  saved,
}: {
  active: boolean;
  href?: string;
  onOpen: () => void;
  onToggleSaved?: (() => void) | undefined;
  project: ProductBoardroomCatalogEntry;
  saved: boolean;
}): React.JSX.Element {
  const content = (
    <>
      <div className="min-w-0 pr-14 sm:pr-12">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="whitespace-normal [overflow-wrap:anywhere] text-base font-semibold text-[var(--pc-text)]">
            {project.name ?? project.symbol ?? "Untitled project"}
          </span>
          <Badge variant={active ? "default" : project.error ? "danger" : "muted"}>
            {active ? "Open" : project.error ? "Read issue" : project.status ?? "Discovered"}
          </Badge>
          {saved ? <Badge variant="muted">Saved</Badge> : null}
          {project.historyError ? <Badge variant="danger">Partial history</Badge> : null}
        </div>
        <p className="m-0 mt-1 text-xs leading-5 text-[var(--pc-text-subtle)]">
          {project.symbol ? `${project.symbol} · ` : ""}{shortAddress(project.address)} · {participationLabel(project)}
          {project.buyerCount === undefined ? "" : ` · Buyers: ${project.buyerCount.toLocaleString()}`}
        </p>
      </div>
      <ExploreMarketMetrics project={project} />
      <span className="mt-3 flex items-center gap-2 text-xs font-semibold text-[var(--pc-text-muted)]">
        Open exact project workspace
        <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--pc-accent)]" />
      </span>
    </>
  );
  const className = cn(
    "group block w-full min-w-0 space-y-4 py-4 text-left transition-colors hover:bg-[var(--pc-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--pc-accent)] sm:px-3",
    active ? "bg-[var(--pc-surface-subtle)]" : null,
  );

  return (
    <li className="relative border-b border-[var(--pc-border)]" data-mobile-layout="stacked-market-row">
      {href ? (
        <a
          className={className}
          href={href}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onOpen();
          }}
        >
          {content}
        </a>
      ) : (
        <button className={className} type="button" onClick={onOpen}>{content}</button>
      )}
      {onToggleSaved ? (
        <button
          aria-label={saved ? `Remove ${project.name ?? project.symbol ?? "project"} from saved projects` : `Save ${project.name ?? project.symbol ?? "project"}`}
          aria-pressed={saved}
          className={cn(
            "absolute right-0 top-2 grid h-11 w-11 place-items-center rounded-md text-[var(--pc-text-subtle)] transition-colors hover:bg-[var(--pc-surface-raised)] hover:text-[var(--pc-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pc-accent)] sm:right-2",
            saved ? "text-[var(--pc-accent)]" : null,
          )}
          title={saved ? "Remove from saved projects" : "Save project"}
          type="button"
          onClick={onToggleSaved}
        >
          <Star className={cn("h-4 w-4", saved ? "fill-current" : null)} />
        </button>
      ) : null}
    </li>
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

function matchesExploreFilter(
  project: ProductBoardroomCatalogEntry,
  filter: ExploreFilter,
  savedProjectAddresses: ReadonlySet<string>,
): boolean {
  if (filter === "all") return true;
  if (filter === "saved") return savedProjectAddresses.has(project.address.toLowerCase());
  if (filter === "amm") return Boolean(project.pool) || (project.swapCount ?? 0) > 0;
  return project.distributionKind === filter;
}

function emptyDirectoryTitle(filter: ExploreFilter, loadedProjectCount: number, savedProjectCount: number): string {
  if (filter === "saved") {
    return savedProjectCount === 0 ? "No saved projects on this network" : "No saved projects are in the loaded directory";
  }
  return loadedProjectCount === 0 ? "No projects discovered" : "No projects match these filters";
}

function emptyDirectoryDescription(
  filter: ExploreFilter,
  loadedProjectCount: number,
  savedProjectCount: number,
  canLoadMore: boolean,
): string {
  if (filter === "saved") {
    if (savedProjectCount === 0) return "Save a project from its directory row or project header to keep it available across browser sessions.";
    return canLoadMore
      ? "Saved projects can sit outside the loaded directory page. Load more projects or open the saved list in Portfolio."
      : "The saved identities are still available in Portfolio, but none match the current loaded directory and search.";
  }
  if (loadedProjectCount === 0) {
    return "This network has not returned a Boardroom yet. You can still open Studio to create or inspect one by address.";
  }
  return canLoadMore
    ? "No loaded projects match yet. Clear the filters or load more of the directory."
    : "Clear the search or choose All to see the full directory.";
}

function participationLabel(project: ProductBoardroomCatalogEntry): string {
  if (project.pool) return "AMM market";
  if (project.distributionKind === "bond-market") return "Bond market";
  if (project.distributionKind === "fixed-price-sale") return "Fixed-price sale";
  if (project.distributionKind === "migrating-bonding-curve") return "Bonding curve";
  if (project.distributionKind === "merkle-airdrop") return "Airdrop";
  return project.path ?? "Boardroom";
}

function sameAddress(first: Address, second: Address | undefined): boolean {
  return second !== undefined && first.toLowerCase() === second.toLowerCase();
}
