import type { Address } from "@pledge.cash/sdk";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AddressLink } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import type { ProductBoardroomDashboardState } from "../../lib/product-boardroom";
import { formatTokenAmount } from "../../lib/token-amounts";
import { cn } from "../../lib/utils";
import { KeyValueList, PageNotice, RuledSection, SectionHeading } from "./page-primitives";

export type ParticipationPath = "fixed-price-sale" | "migrating-bonding-curve" | "merkle-airdrop" | "amm";

export type ParticipationOption = {
  address?: Address;
  available: boolean;
  description: string;
  label: string;
  path: ParticipationPath;
  remaining?: bigint;
  status: string;
  tokenSymbol?: string;
};

export type ParticipatePageProps = {
  content?: Partial<Record<ParticipationPath, ReactNode>>;
  dashboard?: ProductBoardroomDashboardState | undefined;
  error?: string | undefined;
  loading: boolean;
  onSelectPath?: ((path: ParticipationPath) => void) | undefined;
  selectedPath?: ParticipationPath | undefined;
};

export function ParticipatePage({
  content = {},
  dashboard,
  error,
  loading,
  onSelectPath,
  selectedPath,
}: ParticipatePageProps): React.JSX.Element {
  const options = useMemo(() => participationOptions(dashboard, content), [content, dashboard]);
  const [localSelection, setLocalSelection] = useState<ParticipationPath | undefined>(() => firstAvailablePath(options));
  const dashboardAddress = dashboard?.address.toLowerCase();

  useEffect(() => {
    setLocalSelection(firstAvailablePath(options));
  }, [dashboardAddress]);

  const activePath = validSelection(selectedPath, options)
    ?? validSelection(localSelection, options)
    ?? firstAvailablePath(options)
    ?? options[0]?.path;
  const activeOption = options.find((option) => option.path === activePath);

  const selectPath = (path: ParticipationPath): void => {
    setLocalSelection(path);
    onSelectPath?.(path);
  };

  if (loading && !dashboard) {
    return <ParticipationLoading />;
  }

  return (
    <>
      <RuledSection>
        <SectionHeading
          title="Choose how to participate"
          description="Compare the live routes first. A wallet request appears only after the amount, token, limit, and contract are reviewed."
        />
        {error ? (
          <div className="mt-4"><PageNotice title="Participation data is incomplete" tone="danger">{error}</PageNotice></div>
        ) : null}
        {options.length === 0 ? (
          <div className="mt-5">
            <PageNotice title="No participation route is available">
              This project has no readable sale, curve, airdrop, or AMM market. Its transparency record remains available.
            </PageNotice>
          </div>
        ) : (
          <div className="mt-5 grid border-y border-zinc-800 lg:grid-cols-[minmax(260px,0.65fr)_minmax(0,1.35fr)]">
            <div aria-label="Participation routes" className="border-b border-zinc-800 lg:border-b-0 lg:border-r" role="tablist">
              {options.map((option) => (
                <button
                  aria-controls={`participation-panel-${option.path}`}
                  aria-selected={activePath === option.path}
                  className={cn(
                    "group grid w-full gap-2 border-b border-zinc-800 px-4 py-4 text-left transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime-300/70",
                    activePath === option.path ? "bg-zinc-900/70" : "hover:bg-zinc-900/35",
                  )}
                  id={`participation-tab-${option.path}`}
                  key={option.path}
                  role="tab"
                  type="button"
                  onClick={() => selectPath(option.path)}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-zinc-100">{option.label}</span>
                    <Badge variant={option.available ? "default" : "muted"}>{option.status}</Badge>
                  </span>
                  <span className="text-xs leading-5 text-zinc-500">{option.description}</span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-500 group-hover:text-lime-200">
                    Review route <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              ))}
            </div>
            <div
              aria-labelledby={activePath ? `participation-tab-${activePath}` : undefined}
              className="min-w-0 px-4 py-5 sm:px-6"
              id={activePath ? `participation-panel-${activePath}` : undefined}
              role="tabpanel"
            >
              {activeOption ? <ParticipationSummary dashboard={dashboard} option={activeOption} /> : null}
              {activePath && content[activePath] ? <div className="mt-5 border-t border-zinc-800 pt-5">{content[activePath]}</div> : (
                <div className="mt-5 border-t border-zinc-800 pt-5">
                  <PageNotice title={activeOption?.available ? "Action controls are not loaded" : "This route is not active"}>
                    {activeOption?.available
                      ? "The project data is readable, but the transaction workflow has not been attached to this page."
                      : "You can inspect this route’s history and contract, but it is not currently accepting participation."}
                  </PageNotice>
                </div>
              )}
            </div>
          </div>
        )}
      </RuledSection>

      <RuledSection>
        <SectionHeading title="Before anything reaches your wallet" />
        <ol className="m-0 mt-4 grid list-none gap-0 border-t border-zinc-800 p-0 sm:grid-cols-3">
          {[
            ["1", "Review the quote", "Confirm the amount received, payment token, maximum spend, and deadline."],
            ["2", "Confirm the contract", "The review screen names the action and the exact contract receiving the call."],
            ["3", "Track the receipt", "The action stays visible while it is in the wallet, pending onchain, or confirmed."],
          ].map(([step, title, detail]) => (
            <li className="border-b border-zinc-800 py-4 sm:border-r sm:px-4 sm:first:pl-0 sm:last:border-r-0" key={step}>
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-700 text-xs font-semibold text-zinc-300">{step}</span>
              <h3 className="m-0 mt-3 text-sm font-semibold text-zinc-100">{title}</h3>
              <p className="m-0 mt-1 text-xs leading-5 text-zinc-500">{detail}</p>
            </li>
          ))}
        </ol>
      </RuledSection>
    </>
  );
}

export function participationOptions(
  dashboard: ProductBoardroomDashboardState | undefined,
  content: Partial<Record<ParticipationPath, ReactNode>> = {},
): ParticipationOption[] {
  if (!dashboard) return Object.keys(content).map((path) => fallbackOption(path as ParticipationPath));
  const options: ParticipationOption[] = [];

  for (const distribution of dashboard.snapshot.distributionSummaries) {
    if (distribution.kind === "fixed-price-sale" && distribution.state && "saleStatus" in distribution.state) {
      options.push({
        address: distribution.address,
        available: distribution.state.saleStatus === 0 && !distribution.state.closed && distribution.state.remainingShares > 0n,
        description: "Buy a known number of project tokens at a fixed unit price.",
        label: "Fixed-price sale",
        path: "fixed-price-sale",
        remaining: distribution.state.remainingShares,
        status: distributionStatus(distribution.state.saleStatus, "Closed"),
        ...(distribution.shareTokenMetadata?.symbol ? { tokenSymbol: distribution.shareTokenMetadata.symbol } : {}),
      });
    } else if (distribution.kind === "migrating-bonding-curve" && distribution.state && "curveStatus" in distribution.state) {
      options.push({
        address: distribution.address,
        available: distribution.state.curveStatus === 0 && !distribution.state.closed && distribution.state.remainingSaleShares > 0n,
        description: "Buy or sell against an onchain price curve before liquidity migration.",
        label: "Bonding curve",
        path: "migrating-bonding-curve",
        remaining: distribution.state.remainingSaleShares,
        status: distribution.state.curveStatus === 1 ? "Migrated" : distributionStatus(distribution.state.curveStatus, "Unavailable"),
        ...(distribution.shareTokenMetadata?.symbol ? { tokenSymbol: distribution.shareTokenMetadata.symbol } : {}),
      });
    } else if (distribution.kind === "merkle-airdrop" && distribution.state && "airdropStatus" in distribution.state) {
      options.push({
        address: distribution.address,
        available: distribution.state.airdropStatus === 0 && !distribution.state.closed && distribution.state.remainingShares > 0n,
        description: "Claim a published allocation with a proof supplied by the project.",
        label: "Airdrop",
        path: "merkle-airdrop",
        remaining: distribution.state.remainingShares,
        status: distributionStatus(distribution.state.airdropStatus, "Closed"),
        ...(distribution.shareTokenMetadata?.symbol ? { tokenSymbol: distribution.shareTokenMetadata.symbol } : {}),
      });
    }
  }

  const pool = dashboard.history?.pool ?? selectedPool(dashboard);
  if (pool || content.amm) {
    options.push({
      ...(pool ? { address: pool } : {}),
      available: Boolean(pool),
      description: "Swap against the project’s migrated liquidity pool.",
      label: "AMM market",
      path: "amm",
      status: pool ? "Live" : "Unavailable",
    });
  }

  for (const path of Object.keys(content) as ParticipationPath[]) {
    if (!options.some((option) => option.path === path)) options.push(fallbackOption(path));
  }

  return deduplicateOptions(options);
}

function ParticipationSummary({
  dashboard,
  option,
}: {
  dashboard: ProductBoardroomDashboardState | undefined;
  option: ParticipationOption;
}): React.JSX.Element {
  const remaining = option.remaining === undefined
    ? "Not applicable"
    : formatTokenAmount(option.remaining, dashboard?.snapshot.shareTokenMetadata, { symbol: option.tokenSymbol });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-xl font-semibold text-zinc-50">{option.label}</h2>
        {option.available ? <CheckCircle2 className="h-4 w-4 text-lime-300" aria-label="Available" /> : null}
      </div>
      <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{option.description}</p>
      <KeyValueList
        columns={3}
        items={[
          { label: "Status", value: option.status },
          { label: "Remaining", value: remaining },
          { label: "Contract", value: option.address ? <AddressLink address={option.address} /> : "Not loaded" },
        ]}
      />
    </div>
  );
}

function ParticipationLoading(): React.JSX.Element {
  return (
    <div aria-label="Loading participation routes" aria-live="polite" className="grid animate-pulse gap-5 py-6" role="status">
      <span className="h-8 max-w-sm rounded bg-zinc-800" />
      <span className="h-72 rounded bg-zinc-900" />
    </div>
  );
}

function firstAvailablePath(options: readonly ParticipationOption[]): ParticipationPath | undefined {
  return options.find((option) => option.available)?.path ?? options[0]?.path;
}

function validSelection(
  path: ParticipationPath | undefined,
  options: readonly ParticipationOption[],
): ParticipationPath | undefined {
  return path && options.some((option) => option.path === path) ? path : undefined;
}

function distributionStatus(status: number, closedLabel: string): string {
  if (status === 0) return "Active";
  if (status === 1) return closedLabel;
  if (status === 2) return "Cancelled";
  return "Unknown";
}

function fallbackOption(path: ParticipationPath): ParticipationOption {
  if (path === "fixed-price-sale") return { available: false, description: "Buy at a published unit price.", label: "Fixed-price sale", path, status: "Not loaded" };
  if (path === "migrating-bonding-curve") return { available: false, description: "Buy or sell against a price curve.", label: "Bonding curve", path, status: "Not loaded" };
  if (path === "merkle-airdrop") return { available: false, description: "Claim a published allocation.", label: "Airdrop", path, status: "Not loaded" };
  return { available: false, description: "Swap through the project liquidity pool.", label: "AMM market", path, status: "Not loaded" };
}

function deduplicateOptions(options: readonly ParticipationOption[]): ParticipationOption[] {
  const byPath = new Map<ParticipationPath, ParticipationOption>();
  for (const option of options) {
    const current = byPath.get(option.path);
    if (!current || (!current.available && option.available)) byPath.set(option.path, option);
  }
  return Array.from(byPath.values());
}

function selectedPool(dashboard: ProductBoardroomDashboardState): Address | undefined {
  return dashboard.catalog.find((entry) => entry.address.toLowerCase() === dashboard.address.toLowerCase())?.pool;
}
