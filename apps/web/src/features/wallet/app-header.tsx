import { BookOpen, RefreshCw, Wallet } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import type { WalletState } from "../../lib/types";

type AppHeaderProps = {
  wallet: WalletState;
  connectWallet: () => Promise<void>;
  chainId: number;
  chainName: string;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
  switchChain: () => Promise<void>;
};

export function AppHeader({ wallet, connectWallet, chainId, chainName, runAction, switchChain }: AppHeaderProps): React.JSX.Element {
  const walletReady = wallet.account !== undefined && wallet.chainId === chainId;

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/88 backdrop-blur">
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <a className="flex items-center gap-3 font-bold tracking-normal text-zinc-50" href={import.meta.env.BASE_URL} aria-label="pledge.cash">
          <span className="grid h-8 w-8 place-items-center rounded-md border border-lime-300/40 bg-lime-300/10 text-lime-200">
            p
          </span>
          <span>pledge.cash</span>
        </a>
        <div className="flex flex-wrap items-center gap-2">
          <a
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-900 hover:text-zinc-50"
            href={`${import.meta.env.BASE_URL}docs/`}
          >
            <BookOpen className="h-4 w-4" />
            Docs
          </a>
          <Badge variant={walletReady ? "default" : "warning"}>{chainName}</Badge>
          <Button variant="secondary" onClick={() => void runAction("switch-chain", switchChain)}>
            <RefreshCw className="h-4 w-4" />
            Switch
          </Button>
          <Button onClick={() => void runAction("connect-wallet", connectWallet)}>
            <Wallet className="h-4 w-4" />
            {wallet.account ? "Connected" : "Connect"}
          </Button>
        </div>
      </div>
    </header>
  );
}
