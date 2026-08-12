import type { Address } from "@pledge.cash/sdk";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { getAddress, type WalletClient } from "viem";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { walletRpcUrl, type PledgeCashNetwork } from "../lib/contracts";
import { shortAddress, walletState } from "../lib/forms";
import type { WalletState } from "../lib/types";
import type { PushLog } from "./use-action-runner";

export function useWagmiWallet({
  network,
  onAccountChanged,
  pushLog,
}: {
  network: PledgeCashNetwork;
  onAccountChanged: () => void;
  pushLog: PushLog;
}): {
  activeAccount: () => Address;
  switchChain: () => Promise<void>;
  wallet: WalletState;
  walletClient: () => WalletClient;
} {
  const { address, chainId } = useAccount();
  const account = useMemo(() => (address ? getAddress(address) : undefined), [address]);
  const { data: client } = useWalletClient({ chainId: network.chainId });
  const { switchChainAsync } = useSwitchChain();
  const previousAccount = useRef<Address | undefined>(undefined);
  const wallet = useMemo(() => walletState(account, chainId), [account, chainId]);

  useEffect(() => {
    const priorAccount = previousAccount.current;
    if (!hasAccountChanged(priorAccount, account)) return;

    if (shouldNotifyAccountChanged(priorAccount, account)) {
      onAccountChanged();
    }

    if (account) {
      pushLog(`Connected ${shortAddress(account)}`, "success");
    }

    previousAccount.current = account;
  }, [account, onAccountChanged, pushLog]);

  const activeAccount = useCallback((): Address => {
    requireConnectedAccount(account);
    requireExpectedChain(chainId, network);

    return account;
  }, [account, chainId, network.chainId, network.name]);

  const walletClient = useCallback((): WalletClient => {
    activeAccount();
    if (!client) throw new Error("Wallet client is not ready yet.");

    return client;
  }, [activeAccount, client]);

  const switchChain = useCallback(async (): Promise<void> => {
    await switchChainAsync({
      chainId: network.chainId,
      addEthereumChainParameter: {
        chainName: network.name,
        nativeCurrency: network.chain.nativeCurrency,
        rpcUrls: [walletRpcUrl(network)],
        ...(network.explorerUrl ? { blockExplorerUrls: [network.explorerUrl] } : {}),
      },
    });
    pushLog(`Wallet switched to ${network.name}.`, "success");
  }, [network, pushLog, switchChainAsync]);

  return { activeAccount, switchChain, wallet, walletClient };
}

function hasAccountChanged(previousAccount: Address | undefined, account: Address | undefined): boolean {
  return normalizedAddress(previousAccount) !== normalizedAddress(account);
}

function shouldNotifyAccountChanged(previousAccount: Address | undefined, account: Address | undefined): boolean {
  return previousAccount !== undefined || account !== undefined;
}

function normalizedAddress(address: Address | undefined): string {
  return (address ?? "").toLowerCase();
}

function requireConnectedAccount(account: Address | undefined): asserts account is Address {
  if (!account) throw new Error("Connect wallet first.");
}

function requireExpectedChain(chainId: number | undefined, network: PledgeCashNetwork): void {
  if (chainId !== network.chainId) throw new Error(`Switch wallet to ${network.name} first.`);
}
