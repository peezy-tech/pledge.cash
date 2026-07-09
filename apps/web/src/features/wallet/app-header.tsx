import { BookOpen, RefreshCw } from "lucide-react";
import type React from "react";
import { ConnectWalletButton } from "../../components/simplekit";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
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
  const docsHref = `${baseHref}docs/`;

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/88 backdrop-blur">
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <HeaderHomeLink href={baseHref} />
        <HeaderActions
          actionPending={actionPending}
          chainId={chainId}
          chainName={chainName}
          docsHref={docsHref}
          networks={networks}
          onNetworkChange={onNetworkChange}
          runAction={runAction}
          switchChain={switchChain}
          walletReady={walletReady}
        />
      </div>
    </header>
  );
}

function HeaderHomeLink({ href }: { href: string }): React.JSX.Element {
  return (
    <a className="flex items-center gap-3 font-bold tracking-normal text-zinc-50" href={href} aria-label="pledge.cash">
      <span className="grid h-8 w-8 place-items-center rounded-md border border-lime-300/40 bg-lime-300/10 text-lime-200">
        p
      </span>
      <span>pledge.cash</span>
    </a>
  );
}

type HeaderActionsProps = Pick<
  AppHeaderProps,
  "chainId" | "chainName" | "networks" | "onNetworkChange" | "runAction" | "switchChain"
> & {
  actionPending: boolean;
  docsHref: string;
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
  walletReady,
}: HeaderActionsProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NetworkSelect
        actionPending={actionPending}
        chainId={chainId}
        networks={networks}
        onNetworkChange={onNetworkChange}
      />
      <DocsLink href={docsHref} />
      <Badge variant={walletReady ? "default" : "warning"}>{chainName}</Badge>
      <SwitchChainButton actionPending={actionPending} runAction={runAction} switchChain={switchChain} />
      <ConnectWalletButton disabled={actionPending} />
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
      className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm font-medium text-zinc-100 outline-none transition-colors hover:bg-zinc-900 focus:border-lime-300/70 focus:ring-2 focus:ring-lime-300/10 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={actionPending}
      title={actionPending ? NETWORK_PENDING_TITLE : undefined}
      value={chainId}
      onChange={handleNetworkChange}
    >
      {networks.map((network) => (
        <option key={network.chainId} value={network.chainId}>
          {network.name}
        </option>
      ))}
    </select>
  );
}

function DocsLink({ href }: { href: string }): React.JSX.Element {
  return (
    <a
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-900 hover:text-zinc-50"
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
      disabled={actionPending}
      title={actionPending ? WALLET_PENDING_TITLE : undefined}
      variant="secondary"
      onClick={() => void runAction("switch-chain", switchChain)}
    >
      <RefreshCw className="h-4 w-4" />
      Switch
    </Button>
  );
}
