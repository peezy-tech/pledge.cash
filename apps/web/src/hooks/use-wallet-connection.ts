import type { Address } from "@pledge.cash/sdk";
import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, getAddress, isAddress, type EIP1193Provider } from "viem";
import { walletRpcUrl, type PledgeCashNetwork } from "../lib/contracts";
import { shortAddress, walletState } from "../lib/forms";
import type { WalletState } from "../lib/types";
import type { PushLog } from "./use-action-runner";

type BrowserWalletClient = ReturnType<typeof createWalletClient>;

export function useWalletConnection({
  network,
  onAccountChanged,
  pushLog,
}: {
  network: PledgeCashNetwork;
  onAccountChanged: () => void;
  pushLog: PushLog;
}): {
  activeAccount: () => Address;
  connectWallet: () => Promise<void>;
  switchChain: () => Promise<void>;
  wallet: WalletState;
  walletClient: () => BrowserWalletClient;
} {
  const [wallet, setWallet] = useState<WalletState>({});

  const accountChanged = useCallback(
    (account: Address | undefined): boolean => !sameOptionalAddress(wallet.account, account),
    [wallet.account],
  );

  useEffect(() => {
    const provider = injectedProvider();
    if (!provider) return;

    const handleAccountsChanged = (accounts: unknown): void => {
      const account = Array.isArray(accounts) && isAddress(accounts[0]) ? getAddress(accounts[0]) : undefined;
      if (accountChanged(account)) {
        onAccountChanged();
      }
      setWallet((current) => walletState(account, current.chainId));
    };
    const handleChainChanged = (chainId: unknown): void => {
      const parsedChainId = typeof chainId === "string" ? Number.parseInt(chainId, 16) : undefined;
      setWallet((current) => walletState(current.account, parsedChainId));
    };

    provider.on?.("accountsChanged", handleAccountsChanged);
    provider.on?.("chainChanged", handleChainChanged);

    return () => {
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
      provider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [accountChanged, onAccountChanged]);

  const activeAccount = useCallback((): Address => {
    if (!wallet.account) throw new Error("Connect wallet first.");
    if (wallet.chainId !== network.chainId) throw new Error(`Switch wallet to ${network.name} first.`);

    return wallet.account;
  }, [network.chainId, network.name, wallet.account, wallet.chainId]);

  const walletClient = useCallback((): BrowserWalletClient => {
    const provider = injectedProvider();
    if (!provider) throw new Error("No injected wallet provider found.");

    return createWalletClient({
      account: activeAccount(),
      chain: network.chain,
      transport: custom(provider),
    });
  }, [activeAccount, network.chain]);

  const connectWallet = useCallback(async (): Promise<void> => {
    const provider = injectedProvider();
    if (!provider) throw new Error("No injected wallet provider found.");

    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    const chainId = (await provider.request({ method: "eth_chainId" })) as string;
    const account = accounts[0];
    if (!account || !isAddress(account)) throw new Error("Wallet did not return an EVM address.");

    const nextAccount = getAddress(account);
    if (accountChanged(nextAccount)) {
      onAccountChanged();
    }
    setWallet({ account: nextAccount, chainId: Number.parseInt(chainId, 16) });
    pushLog(`Connected ${shortAddress(account)}`, "success");
  }, [accountChanged, onAccountChanged, pushLog]);

  const switchChain = useCallback(async (): Promise<void> => {
    const provider = injectedProvider();
    if (!provider) throw new Error("No injected wallet provider found.");

    const chainId = `0x${network.chainId.toString(16)}`;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? Number(error.code) : undefined;
      if (code !== 4902) throw error;
      await addActiveChain(provider, network, chainId);
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    }

    const activeChainId = (await provider.request({ method: "eth_chainId" })) as string;
    const parsedChainId = Number.parseInt(activeChainId, 16);
    setWallet((current) => walletState(current.account, Number.isNaN(parsedChainId) ? undefined : parsedChainId));
    if (parsedChainId !== network.chainId) {
      throw new Error(`Wallet is still on chain ${Number.isNaN(parsedChainId) ? activeChainId : parsedChainId}.`);
    }
    pushLog(`Wallet switched to ${network.name}.`, "success");
  }, [network, pushLog]);

  return { activeAccount, connectWallet, switchChain, wallet, walletClient };
}

async function addActiveChain(provider: EIP1193Provider, network: PledgeCashNetwork, chainId: string): Promise<void> {
  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId,
        chainName: network.name,
        nativeCurrency: network.chain.nativeCurrency,
        rpcUrls: [walletRpcUrl(network)],
        ...(network.explorerUrl ? { blockExplorerUrls: [network.explorerUrl] } : {}),
      },
    ],
  });
}

function injectedProvider(): EIP1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  return window.ethereum as EIP1193Provider | undefined;
}

function sameOptionalAddress(left: Address | undefined, right: Address | undefined): boolean {
  return (left ?? "").toLowerCase() === (right ?? "").toLowerCase();
}
