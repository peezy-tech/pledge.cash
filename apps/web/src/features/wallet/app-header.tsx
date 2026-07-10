import { BookOpen, RefreshCw } from "lucide-react";
import type React from "react";
import { ConnectWalletButton } from "../../components/simplekit";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { appRouteHref } from "../../app/routing";
import type { PledgeCashNetwork } from "../../lib/contracts";
import type { WalletState } from "../../lib/types";

type AppHeaderProps = {
  wallet: WalletState;
  chainId: number;
  chainName: string;
  networks: PledgeCashNetwork[];
  onNetworkChange: (chainId: number) => void;
  pendingAction: string | undefined;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
  switchChain: () => Promise<void>;
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
}: AppHeaderProps): React.JSX.Element {
  const actionPending = pendingAction !== undefined;
  const walletConnected = wallet.account !== undefined;
  const walletOnActiveChain = wallet.chainId === chainId;
  const walletReady = walletConnected && walletOnActiveChain;
  const baseHref = import.meta.env.BASE_URL || "/";
  const homeHref = appRouteHref({ kind: "explore" }, baseHref);
  const docsHref = `${baseHref}docs/`;

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--pc-border)] bg-[color:var(--pc-canvas-translucent)] backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between gap-2 px-3 sm:px-5">
        <HeaderHomeLink href={homeHref} />
        <HeaderActions
          actionPending={actionPending}
          chainId={chainId}
          chainName={chainName}
          docsHref={docsHref}
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
  "chainId" | "chainName" | "networks" | "onNetworkChange" | "runAction" | "switchChain"
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
        networks={networks}
        onNetworkChange={onNetworkChange}
      />
      <DocsLink href={docsHref} />
      <Badge className="hidden xl:inline-flex" variant={walletReady ? "default" : "warning"}>{chainName}</Badge>
      {walletConnected && !walletReady ? <SwitchChainButton actionPending={actionPending} runAction={runAction} switchChain={switchChain} /> : null}
      <ConnectWalletButton className="min-w-[9.5rem] max-w-[9.5rem] px-2 sm:max-w-none sm:px-3" disabled={actionPending} />
    </div>
  );
}

function NetworkSelect({
  actionPending,
  chainId,
  networks,
  onNetworkChange,
}: Pick<AppHeaderProps, "chainId" | "networks" | "onNetworkChange"> & {
  actionPending: boolean;
}): React.JSX.Element {
  const handleNetworkChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    onNetworkChange(Number(event.target.value));
  };

  return (
    <select
      aria-label="Network"
      className="block h-9 max-w-24 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface)] px-2 text-xs font-medium text-[var(--pc-text)] outline-none transition-colors hover:border-[var(--pc-border-strong)] focus:border-[var(--pc-focus)] disabled:cursor-not-allowed disabled:opacity-60 min-[360px]:max-w-32 sm:max-w-36 md:max-w-44 md:px-3 md:text-sm"
      disabled={actionPending}
      title={actionPending ? NETWORK_PENDING_TITLE : networks.find((network) => network.chainId === chainId)?.name}
      value={chainId}
      onChange={handleNetworkChange}
    >
      {networks.map((network) => (
        <option key={network.chainId} value={network.chainId}>
          {networkOptionLabel(network)}
        </option>
      ))}
    </select>
  );
}

function networkOptionLabel(network: PledgeCashNetwork): string {
  if (network.chainId === 31337) return "Local";
  return network.name.replace(/\s+Testnet$/i, "");
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
