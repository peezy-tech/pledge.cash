import { BookOpen, RefreshCw } from "lucide-react";
import type React from "react";
import { ConnectWalletButton } from "../../components/simplekit";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { appRouteHref } from "../../app/routing";
import type { RuntimeDeploymentAvailabilityStatus } from "../../hooks/use-runtime-deployment";
import {
  networkEnvironmentIdentity,
  type PledgeCashEnvironmentIdentity,
  type PledgeCashNetwork,
} from "../../lib/contracts";
import type { WalletState } from "../../lib/types";

export type NetworkDeploymentAvailability = Readonly<Partial<Record<number, RuntimeDeploymentAvailabilityStatus>>>;

type AppHeaderProps = {
  wallet: WalletState;
  chainId: number;
  chainName: string;
  networks: PledgeCashNetwork[];
  onNetworkChange: (chainId: number) => void;
  pendingAction: string | undefined;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
  switchChain: () => Promise<void>;
  environment?: PledgeCashEnvironmentIdentity | undefined;
  networkAvailability?: NetworkDeploymentAvailability | undefined;
};

const NETWORK_PENDING_TITLE = "Network changes are disabled while an action is running";
const WALLET_PENDING_TITLE = "Wallet actions are disabled while an action is running";

export function AppHeader({
  wallet,
  chainId,
  chainName,
  networks,
  onNetworkChange,
  pendingAction,
  runAction,
  switchChain,
  environment,
  networkAvailability,
}: AppHeaderProps): React.JSX.Element {
  const actionPending = pendingAction !== undefined;
  const walletConnected = wallet.account !== undefined;
  const walletOnActiveChain = wallet.chainId === chainId;
  const walletReady = walletConnected && walletOnActiveChain;
  const baseHref = import.meta.env.BASE_URL || "/";
  const homeHref = appRouteHref({ kind: "explore" }, baseHref);
  const docsHref = `${baseHref}docs/`;
  const activeNetwork = networks.find((network) => network.chainId === chainId);
  const activeEnvironment = environment ?? (activeNetwork ? networkEnvironmentIdentity(activeNetwork) : undefined);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--pc-border)] bg-[color:var(--pc-canvas-translucent)] backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between gap-2 px-3 sm:px-5">
        <HeaderHomeLink href={homeHref} />
        <HeaderActions
          actionPending={actionPending}
          chainId={chainId}
          chainName={chainName}
          docsHref={docsHref}
          environment={activeEnvironment}
          networkAvailability={networkAvailability}
          networks={networks}
          onNetworkChange={onNetworkChange}
          runAction={runAction}
          switchChain={switchChain}
          walletConnected={walletConnected}
          walletReady={walletReady}
        />
      </div>
    </header>
  );
}

function HeaderHomeLink({ href }: { href: string }): React.JSX.Element {
  return (
    <a className="flex shrink-0 items-center gap-2.5 font-bold tracking-tight text-[var(--pc-text)]" href={href} aria-label="pledge.cash Explore">
      <span className="grid h-7 w-7 place-items-center rounded-md border border-[color:rgb(201_255_87_/_0.36)] bg-[color:rgb(201_255_87_/_0.08)] text-sm text-[var(--pc-accent)]">
        p
      </span>
      <span className="hidden min-[420px]:inline">pledge.cash</span>
    </a>
  );
}

type HeaderActionsProps = Pick<
  AppHeaderProps,
  "chainId" | "chainName" | "environment" | "networkAvailability" | "networks" | "onNetworkChange" | "runAction" | "switchChain"
> & {
  actionPending: boolean;
  docsHref: string;
  walletConnected: boolean;
  walletReady: boolean;
};

function HeaderActions({
  actionPending,
  chainId,
  chainName,
  docsHref,
  environment,
  networkAvailability,
  networks,
  onNetworkChange,
  runAction,
  switchChain,
  walletConnected,
  walletReady,
}: HeaderActionsProps): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
      <NetworkSelect
        actionPending={actionPending}
        chainId={chainId}
        networkAvailability={networkAvailability}
        networks={networks}
        onNetworkChange={onNetworkChange}
      />
      <DocsLink href={docsHref} />
      {environment ? <EnvironmentBadge environment={environment} /> : null}
      <Badge className="hidden xl:inline-flex" variant={walletReady ? "default" : "warning"}>{chainName}</Badge>
      {walletConnected && !walletReady ? <SwitchChainButton actionPending={actionPending} runAction={runAction} switchChain={switchChain} /> : null}
      <ConnectWalletButton
        className="min-w-28 max-w-28 px-2 min-[420px]:min-w-[9.5rem] min-[420px]:max-w-[9.5rem] sm:max-w-none sm:px-3"
        compactOnMobile
        disabled={actionPending}
      />
    </div>
  );
}

function NetworkSelect({
  actionPending,
  chainId,
  networkAvailability,
  networks,
  onNetworkChange,
}: Pick<AppHeaderProps, "chainId" | "networkAvailability" | "networks" | "onNetworkChange"> & {
  actionPending: boolean;
}): React.JSX.Element {
  const handleNetworkChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    onNetworkChange(Number(event.target.value));
  };
  const activeNetwork = networks.find((network) => network.chainId === chainId);
  const activeStatus = networkAvailability?.[chainId];

  return (
    <select
      aria-label="Network"
      className="block h-9 max-w-24 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface)] px-2 text-xs font-medium text-[var(--pc-text)] outline-none transition-colors hover:border-[var(--pc-border-strong)] focus:border-[var(--pc-focus)] disabled:cursor-not-allowed disabled:opacity-60 min-[360px]:max-w-32 sm:max-w-36 md:max-w-44 md:px-3 md:text-sm"
      disabled={actionPending}
      title={actionPending ? NETWORK_PENDING_TITLE : activeNetwork ? networkOptionLabel(activeNetwork, activeStatus) : undefined}
      value={chainId}
      onChange={handleNetworkChange}
    >
      {networks.map((network) => {
        const availability = networkAvailability?.[network.chainId];
        return (
          <option
            disabled={networkOptionDisabled(availability)}
            key={network.chainId}
            value={network.chainId}
          >
            {networkOptionLabel(network, availability)}
          </option>
        );
      })}
    </select>
  );
}

export function EnvironmentBadge({
  environment,
}: {
  environment: PledgeCashEnvironmentIdentity;
}): React.JSX.Element {
  return (
    <Badge
      aria-label={`${environment.label} environment: ${environment.description}`}
      className="hidden sm:inline-flex"
      title={environment.description}
      variant={environment.kind === "custom" ? "warning" : environment.kind === "local" ? "muted" : "default"}
    >
      {environment.label}
    </Badge>
  );
}

export function networkOptionDisabled(
  availability: RuntimeDeploymentAvailabilityStatus | undefined,
): boolean {
  return availability !== undefined && availability !== "ready";
}

export function networkOptionLabel(
  network: PledgeCashNetwork,
  availability: RuntimeDeploymentAvailabilityStatus | undefined = "ready",
): string {
  const environment = networkEnvironmentIdentity(network);
  const environmentLabel = environment.kind === "local"
    ? "Local (resettable, no real value)"
    : environment.label;
  const baseLabel = environment.kind === "testnet" && /\btestnet\b/i.test(network.name)
    ? network.name
    : `${network.name} — ${environmentLabel}`;
  const availabilityLabel = networkAvailabilityLabel(availability);
  return availabilityLabel ? `${baseLabel} — ${availabilityLabel}` : baseLabel;
}

export function networkAvailabilityLabel(
  availability: RuntimeDeploymentAvailabilityStatus | undefined,
): string | undefined {
  switch (availability) {
    case "loading":
      return "checking deployment";
    case "pending":
      return "deployment pending";
    case "missing":
      return "not deployed";
    case "error":
      return "deployment unavailable";
    case "ready":
    case undefined:
      return undefined;
  }
}

function DocsLink({ href }: { href: string }): React.JSX.Element {
  return (
    <a
      className="hidden h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium text-[var(--pc-text-muted)] transition-colors hover:bg-[var(--pc-surface)] hover:text-[var(--pc-text)] lg:inline-flex"
      href={href}
    >
      <BookOpen className="h-4 w-4" />
      Docs
    </a>
  );
}

function SwitchChainButton({
  actionPending,
  runAction,
  switchChain,
}: Pick<AppHeaderProps, "runAction" | "switchChain"> & {
  actionPending: boolean;
}): React.JSX.Element {
  return (
    <Button
      aria-label="Switch wallet network"
      className="h-9 w-9 px-0 sm:w-auto sm:px-3"
      disabled={actionPending}
      title={actionPending ? WALLET_PENDING_TITLE : undefined}
      variant="secondary"
      onClick={() => void runAction("switch-chain", switchChain)}
    >
      <RefreshCw className="h-4 w-4" />
      <span className="hidden sm:inline">Switch</span>
    </Button>
  );
}
