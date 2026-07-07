import { BookOpen, RefreshCw } from "lucide-react";
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
  const walletReady = wallet.account !== undefined && wallet.chainId === chainId;
  const actionPending = pendingAction !== undefined;
  const baseHref = import.meta.env.BASE_URL || "/";

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/88 backdrop-blur">
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <a className="flex items-center gap-3 font-bold tracking-normal text-zinc-50" href={baseHref} aria-label="pledge.cash">
          <span className="grid h-8 w-8 place-items-center rounded-md border border-lime-300/40 bg-lime-300/10 text-lime-200">
            p
          </span>
          <span>pledge.cash</span>
        </a>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Network"
            className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm font-medium text-zinc-100 outline-none transition-colors hover:bg-zinc-900 focus:border-lime-300/70 focus:ring-2 focus:ring-lime-300/10 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={actionPending}
            title={actionPending ? "Network changes are disabled while an action is running" : undefined}
            value={chainId}
            onChange={(event) => onNetworkChange(Number(event.target.value))}
          >
            {networks.map((network) => (
              <option key={network.chainId} value={network.chainId}>
                {network.name}
              </option>
            ))}
          </select>
          <a
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-900 hover:text-zinc-50"
            href={`${baseHref}docs/`}
          >
            <BookOpen className="h-4 w-4" />
            Docs
          </a>
          <Badge variant={walletReady ? "default" : "warning"}>{chainName}</Badge>
          <Button
            disabled={actionPending}
            title={actionPending ? "Wallet actions are disabled while an action is running" : undefined}
            variant="secondary"
            onClick={() => void runAction("switch-chain", switchChain)}
          >
            <RefreshCw className="h-4 w-4" />
            Switch
          </Button>
          <ConnectWalletButton disabled={actionPending} />
        </div>
      </div>
    </header>
  );
}
