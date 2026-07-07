import type { Address } from "@pledge.cash/sdk";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { getAddress, type WalletClient } from "viem";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import type { PledgeCashNetwork } from "../lib/contracts";
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
  const { data: client } = useWalletClient({ chainId: network.chainId });
  const { switchChainAsync } = useSwitchChain();
  const previousAccount = useRef<Address | undefined>(undefined);
  const account = useMemo(() => (address ? getAddress(address) : undefined), [address]);
  const wallet = useMemo(() => walletState(account, chainId), [account, chainId]);

  useEffect(() => {
    if (sameOptionalAddress(previousAccount.current, account)) return;

    if (previousAccount.current !== undefined || account !== undefined) {
      onAccountChanged();
    }
    if (account) {
      pushLog(`Connected ${shortAddress(account)}`, "success");
    }
    previousAccount.current = account;
  }, [account, onAccountChanged, pushLog]);

  const activeAccount = useCallback((): Address => {
    if (!account) throw new Error("Connect wallet first.");
    if (chainId !== network.chainId) throw new Error(`Switch wallet to ${network.name} first.`);

    return account;
  }, [account, chainId, network.chainId, network.name]);

  const walletClient = useCallback((): WalletClient => {
    activeAccount();
    if (!client) throw new Error("Wallet client is not ready yet.");

    return client;
  }, [activeAccount, client]);

  const switchChain = useCallback(async (): Promise<void> => {
    await switchChainAsync({ chainId: network.chainId });
    pushLog(`Wallet switched to ${network.name}.`, "success");
  }, [network.chainId, network.name, pushLog, switchChainAsync]);

  return { activeAccount, switchChain, wallet, walletClient };
}

function sameOptionalAddress(left: Address | undefined, right: Address | undefined): boolean {
  return (left ?? "").toLowerCase() === (right ?? "").toLowerCase();
}
