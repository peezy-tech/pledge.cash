import {
  boardroomAbi,
  boardroomFactoryAbi,
  boardroomTokenAbi,
  erc20Abi,
  getPledgeCashDeployment,
  HYPEREVM_TESTNET_CHAIN_ID,
  hyperEvmTestnet,
  isZeroAddress,
  legacyTokenGrantFactoryAbi,
  tokenGrantAbi,
  tokenGrantFactoryAbi,
  type Address,
} from "@pledge.cash/sdk";
import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, encodeFunctionData, getAddress, isAddress, type EIP1193Provider } from "viem";
import { TabButton } from "./components/shell";
import { BoardroomPanel } from "./features/boardrooms/boardroom-panel";
import { ArtifactPanel, DeploymentPanel } from "./features/deployment/deployment-panel";
import { DirectGrantPanel } from "./features/grants/direct-grant-panel";
import { GrantInspector } from "./features/grants/grant-inspector";
import { LogPanel } from "./features/logs/log-panel";
import { AppHeader } from "./features/wallet/app-header";
import { WalletPanel } from "./features/wallet/wallet-panel";
import { chain, EXPLORER_URL, publicClient, RPC_URL } from "./lib/contracts";
import {
  defaultBoardroomGrantForm,
  defaultGrantForm,
  errorMessage,
  optionalPaymentToken,
  randomSalt,
  requireAddress,
  requireBytes32,
  requireDeploymentAddress,
  shortAddress,
  uintInput,
  walletState,
} from "./lib/forms";
import type {
  BoardroomForm,
  BoardroomGrantForm,
  BoardroomSnapshot,
  FactorySnapshot,
  GrantForm,
  GrantSnapshot,
  LogEntry,
  Tab,
  WalletState,
} from "./lib/types";

type GrantIssuerAction = "stopVestingAndWithdrawUnvested" | "withdrawExpiredTokens";

function sameOptionalAddress(left: Address | undefined, right: Address | undefined): boolean {
  return (left ?? "").toLowerCase() === (right ?? "").toLowerCase();
}

export function App(): React.JSX.Element {
  const deployment = getPledgeCashDeployment(HYPEREVM_TESTNET_CHAIN_ID);
  const [activeTab, setActiveTab] = useState<Tab>("direct");
  const [wallet, setWallet] = useState<WalletState>({});
  const [factorySnapshot, setFactorySnapshot] = useState<FactorySnapshot>({});
  const [grantForm, setGrantForm] = useState<GrantForm>(() => defaultGrantForm());
  const [predictedGrant, setPredictedGrant] = useState<Address>();
  const [grantAddress, setGrantAddress] = useState("");
  const [grantSnapshot, setGrantSnapshot] = useState<GrantSnapshot>();
  const [settleAmount, setSettleAmount] = useState("1000000000000000000");
  const [paymentApproval, setPaymentApproval] = useState("0");
  const [boardroomForm, setBoardroomForm] = useState<BoardroomForm>(() => ({
    owner: "",
    name: "Pledge Common",
    symbol: "PLDG",
    salt: randomSalt(),
  }));
  const [predictedBoardroom, setPredictedBoardroom] = useState<Address>();
  const [boardroomAddress, setBoardroomAddress] = useState("");
  const [boardroomSnapshot, setBoardroomSnapshot] = useState<BoardroomSnapshot>();
  const [boardroomMintAmount, setBoardroomMintAmount] = useState("1000000000000000000");
  const [boardroomMintTo, setBoardroomMintTo] = useState("");
  const [boardroomGrantForm, setBoardroomGrantForm] = useState<BoardroomGrantForm>(() => defaultBoardroomGrantForm());
  const [predictedBoardroomGrant, setPredictedBoardroomGrant] = useState<Address>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pendingAction, setPendingAction] = useState<string>();

  const creationFee = factorySnapshot.creationFee ?? deployment?.creationFee ?? 0n;
  const usesLegacyTokenGrantFactory = deployment?.tokenGrantFactoryVersion === "legacy";

  const pushLog = useCallback((message: string, level: LogEntry["level"] = "info") => {
    setLogs((current) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        level,
        message,
        time: new Date().toISOString().replace(".000Z", "Z"),
      },
      ...current,
    ].slice(0, 80));
  }, []);

  const updateGrantAddress = useCallback((address: string): void => {
    setGrantAddress(address);
    setGrantSnapshot(undefined);
  }, []);

  const clearDirectGrantPrediction = useCallback((): void => {
    if (predictedGrant && grantAddress.toLowerCase() === predictedGrant.toLowerCase()) {
      updateGrantAddress("");
    }
    setPredictedGrant(undefined);
  }, [grantAddress, predictedGrant, updateGrantAddress]);

  useEffect(() => {
    if (!wallet.account || boardroomForm.owner) return;
    setBoardroomForm((current) => ({ ...current, owner: wallet.account ?? current.owner }));
  }, [boardroomForm.owner, wallet.account]);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;

    const handleAccountsChanged = (accounts: unknown) => {
      const account = Array.isArray(accounts) && isAddress(accounts[0]) ? getAddress(accounts[0]) : undefined;
      if (!sameOptionalAddress(wallet.account, account)) {
        clearDirectGrantPrediction();
      }
      setWallet((current) => walletState(account, current.chainId));
    };
    const handleChainChanged = (chainId: unknown) => {
      const parsedChainId = typeof chainId === "string" ? Number.parseInt(chainId, 16) : undefined;
      setWallet((current) => walletState(current.account, parsedChainId));
    };

    provider.on?.("accountsChanged", handleAccountsChanged);
    provider.on?.("chainChanged", handleChainChanged);

    return () => {
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
      provider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [clearDirectGrantPrediction, wallet.account]);

  useEffect(() => {
    let cancelled = false;

    async function loadFactory(): Promise<void> {
      if (!deployment?.tokenGrantFactory) return;

      try {
        const [owner, tokenGrantLogic, creationFee_] = await Promise.all([
          publicClient.readContract({
            address: deployment.tokenGrantFactory,
            abi: tokenGrantFactoryAbi,
            functionName: "owner",
          }),
          publicClient.readContract({
            address: deployment.tokenGrantFactory,
            abi: tokenGrantFactoryAbi,
            functionName: "tokenGrantLogic",
          }),
          publicClient.readContract({
            address: deployment.tokenGrantFactory,
            abi: tokenGrantFactoryAbi,
            functionName: "creationFee",
          }),
        ]);

        if (!cancelled) {
          setFactorySnapshot({
            owner,
            tokenGrantLogic,
            creationFee: creationFee_,
          });
        }
      } catch (error) {
        pushLog(`Factory reads failed: ${errorMessage(error)}`, "error");
      }
    }

    void loadFactory();
    return () => {
      cancelled = true;
    };
  }, [deployment?.tokenGrantFactory, pushLog]);

  const runAction = async (label: string, action: () => Promise<void>): Promise<void> => {
    setPendingAction(label);
    try {
      await action();
    } catch (error) {
      pushLog(errorMessage(error), "error");
    } finally {
      setPendingAction(undefined);
    }
  };

  const updateBoardroomAddress = useCallback((address: string): void => {
    setBoardroomAddress(address);
    setBoardroomSnapshot(undefined);
    setBoardroomMintTo("");
    setPredictedBoardroomGrant(undefined);
  }, []);

  const clearBoardroomGrantPrediction = useCallback((): void => {
    if (predictedBoardroomGrant && grantAddress.toLowerCase() === predictedBoardroomGrant.toLowerCase()) {
      updateGrantAddress("");
    }
    setPredictedBoardroomGrant(undefined);
  }, [grantAddress, predictedBoardroomGrant, updateGrantAddress]);

  const activeAccount = (): Address => {
    if (!wallet.account) throw new Error("Connect wallet first.");
    if (wallet.chainId !== HYPEREVM_TESTNET_CHAIN_ID) throw new Error("Switch wallet to HyperEVM testnet first.");

    return wallet.account;
  };

  const walletClient = (): ReturnType<typeof createWalletClient> => {
    const provider = window.ethereum;
    if (!provider) throw new Error("No injected wallet provider found.");
    const account = activeAccount();

    return createWalletClient({
      account,
      chain,
      transport: custom(provider as EIP1193Provider),
    });
  };

  const connectWallet = async (): Promise<void> => {
    const provider = window.ethereum;
    if (!provider) throw new Error("No injected wallet provider found.");

    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    const chainId = (await provider.request({ method: "eth_chainId" })) as string;
    const account = accounts[0];
    if (!account || !isAddress(account)) throw new Error("Wallet did not return an EVM address.");
    const nextAccount = getAddress(account);
    if (!sameOptionalAddress(wallet.account, nextAccount)) {
      clearDirectGrantPrediction();
    }
    setWallet({ account: nextAccount, chainId: Number.parseInt(chainId, 16) });
    pushLog(`Connected ${shortAddress(account)}`, "success");
  };

  const switchChain = async (): Promise<void> => {
    const provider = window.ethereum;
    if (!provider) throw new Error("No injected wallet provider found.");

    const chainId = `0x${HYPEREVM_TESTNET_CHAIN_ID.toString(16)}`;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? Number(error.code) : undefined;
      if (code !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId,
            chainName: hyperEvmTestnet.name,
            nativeCurrency: hyperEvmTestnet.nativeCurrency,
            rpcUrls: [RPC_URL],
            blockExplorerUrls: [EXPLORER_URL],
          },
        ],
      });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    }

    const activeChainId = (await provider.request({ method: "eth_chainId" })) as string;
    const parsedChainId = Number.parseInt(activeChainId, 16);
    setWallet((current) => walletState(current.account, Number.isNaN(parsedChainId) ? undefined : parsedChainId));
    if (parsedChainId !== HYPEREVM_TESTNET_CHAIN_ID) {
      throw new Error(`Wallet is still on chain ${Number.isNaN(parsedChainId) ? activeChainId : parsedChainId}.`);
    }
    pushLog("Wallet switched to HyperEVM testnet.", "success");
  };

  const grantArgs = () => {
    const holder = requireAddress(grantForm.holder, "Holder");
    const token = requireAddress(grantForm.token, "Grant token");
    const paymentToken = optionalPaymentToken(grantForm.paymentToken);
    const amount = uintInput(grantForm.amount, "Amount");
    const price = uintInput(grantForm.price, "Price");
    const expiry = uintInput(grantForm.expiry, "Expiry");
    const vestingCliff = uintInput(grantForm.vestingCliff, "Vesting cliff");
    const vestingEnd = uintInput(grantForm.vestingEnd, "Vesting end");
    const transferUnlockTime = grantForm.transferable
      ? uintInput(grantForm.transferUnlockTime, "Transfer unlock time")
      : 0n;
    const salt = requireBytes32(grantForm.salt, "Salt");

    if (usesLegacyTokenGrantFactory && grantForm.transferable) {
      throw new Error("The live legacy TokenGrantFactory does not support transferable grants.");
    }

    return {
      token,
      amount,
      salt,
      legacyTuple: [holder, token, paymentToken, amount, price, expiry, vestingCliff, vestingEnd, salt] as const,
      tuple: [
        holder,
        token,
        paymentToken,
        amount,
        price,
        expiry,
        vestingCliff,
        vestingEnd,
        grantForm.transferable,
        transferUnlockTime,
        salt,
      ] as const,
    };
  };

  const predictDirectGrantAddress = async (): Promise<Address> => {
    if (!wallet.account) throw new Error("Connect wallet to predict a direct grant.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { salt } = grantArgs();

    if (usesLegacyTokenGrantFactory) {
      return await publicClient.readContract({
        address: factory,
        abi: legacyTokenGrantFactoryAbi,
        functionName: "predictGrantAddress",
        args: [salt],
      });
    }

    return await publicClient.readContract({
      address: factory,
      abi: tokenGrantFactoryAbi,
      functionName: "predictGrantAddress",
      args: [wallet.account, salt],
    });
  };

  const predictGrant = async (): Promise<void> => {
    const predicted = await predictDirectGrantAddress();
    setPredictedGrant(predicted);
    updateGrantAddress(predicted);
    pushLog(`Predicted grant ${predicted}`, "success");
  };

  const approveEscrow = async (): Promise<void> => {
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { token, amount } = grantArgs();
    const spender = usesLegacyTokenGrantFactory ? await predictDirectGrantAddress() : factory;
    if (usesLegacyTokenGrantFactory) {
      setPredictedGrant(spender);
      updateGrantAddress(spender);
    }

    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: token,
      abi: erc20Abi,
      chain,
      functionName: "approve",
      args: [spender, amount],
    });
    pushLog(`Escrow approval submitted: ${hash}`, "success");
  };

  const createGrant = async (): Promise<void> => {
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { legacyTuple, tuple } = grantArgs();
    if (usesLegacyTokenGrantFactory) {
      const hash = await walletClient().writeContract({
        account: activeAccount(),
        address: factory,
        abi: legacyTokenGrantFactoryAbi,
        chain,
        functionName: "createGrant",
        args: legacyTuple,
        value: creationFee,
      });
      pushLog(`Grant creation submitted: ${hash}`, "success");
      return;
    }

    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: factory,
      abi: tokenGrantFactoryAbi,
      chain,
      functionName: "createGrant",
      args: tuple,
      value: creationFee,
    });
    pushLog(`Grant creation submitted: ${hash}`, "success");
  };

  const loadGrant = async (): Promise<void> => {
    const grant = requireAddress(grantAddress, "Grant address");
    const now = BigInt(Math.floor(Date.now() / 1000));
    const [issuer, holder, token, paymentToken, grantSize, claimable, price, expiry, settledAmount, halted, closed, settleable] =
      await Promise.all([
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "issuer" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "holder" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "token" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "paymentToken" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "grantSize" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "claimable" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "price" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "expiry" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "settledAmount" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "vestingIsHalted" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "isClosed" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "getSettleableAmount", args: [now] }),
      ]);

    setGrantSnapshot({
      address: grant,
      issuer,
      holder,
      token,
      paymentToken,
      grantSize,
      claimable,
      price,
      expiry,
      settledAmount,
      halted,
      closed,
      settleable,
    });
    pushLog(`Loaded grant ${grant}`, "success");
  };

  const approvePayment = async (): Promise<void> => {
    if (!grantSnapshot) throw new Error("Load a grant first.");
    const grant = requireAddress(grantAddress, "Grant address");
    if (grantSnapshot.address.toLowerCase() !== grant.toLowerCase()) throw new Error("Reload the grant after changing the address.");
    if (isZeroAddress(grantSnapshot.paymentToken)) throw new Error("Selected grant has no payment token.");

    const amount = uintInput(paymentApproval, "Payment approval");
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: grantSnapshot.paymentToken,
      abi: erc20Abi,
      chain,
      functionName: "approve",
      args: [grantSnapshot.address, amount],
    });
    pushLog(`Payment approval submitted: ${hash}`, "success");
  };

  const settleGrant = async (): Promise<void> => {
    const grant = requireAddress(grantAddress, "Grant address");
    const amount = uintInput(settleAmount, "Settle amount");
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: grant,
      abi: tokenGrantAbi,
      chain,
      functionName: "settle",
      args: [amount],
    });
    pushLog(`Settlement submitted: ${hash}`, "success");
  };

  const isBoardroomIssuer = async (issuer: Address): Promise<boolean> => {
    try {
      const policyRegistry = await publicClient.readContract({
        address: issuer,
        abi: boardroomAbi,
        functionName: "policyRegistry",
      });
      return !isZeroAddress(policyRegistry);
    } catch {
      return false;
    }
  };

  const runGrantIssuerAction = async (functionName: GrantIssuerAction, successMessage: string): Promise<void> => {
    const grant = requireAddress(grantAddress, "Grant address");
    const issuer = await publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "issuer" });
    const data = encodeFunctionData({ abi: tokenGrantAbi, functionName });

    if (await isBoardroomIssuer(issuer)) {
      if (usesLegacyTokenGrantFactory) throw new Error("Boardroom grant maintenance requires a current TokenGrantFactory deployment.");
      const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
      const hash = await walletClient().writeContract({
        account: activeAccount(),
        address: issuer,
        abi: boardroomAbi,
        chain,
        functionName: "execute",
        args: [
          {
            policy: factory,
            target: grant,
            value: 0n,
            data,
          },
        ],
      });
      pushLog(`${successMessage} through Boardroom: ${hash}`, "success");
      return;
    }

    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: grant,
      abi: tokenGrantAbi,
      chain,
      functionName,
    });
    pushLog(`${successMessage}: ${hash}`, "success");
  };

  const haltGrant = async (): Promise<void> => {
    await runGrantIssuerAction("stopVestingAndWithdrawUnvested", "Vesting halt submitted");
  };

  const withdrawExpired = async (): Promise<void> => {
    await runGrantIssuerAction("withdrawExpiredTokens", "Expired withdrawal submitted");
  };

  const predictBoardroom = async (): Promise<void> => {
    const factory = requireDeploymentAddress(deployment?.boardroomFactory, "BoardroomFactory");
    const owner = requireAddress(boardroomForm.owner, "Boardroom owner");
    const salt = requireBytes32(boardroomForm.salt, "Boardroom salt");
    const predicted = await publicClient.readContract({
      address: factory,
      abi: boardroomFactoryAbi,
      functionName: "predictBoardroomAddress",
      args: [owner, boardroomForm.name, boardroomForm.symbol, salt],
    });
    setPredictedBoardroom(predicted);
    updateBoardroomAddress(predicted);
    pushLog(`Predicted Boardroom ${predicted}`, "success");
  };

  const createBoardroom = async (): Promise<void> => {
    const factory = requireDeploymentAddress(deployment?.boardroomFactory, "BoardroomFactory");
    const owner = requireAddress(boardroomForm.owner, "Boardroom owner");
    const salt = requireBytes32(boardroomForm.salt, "Boardroom salt");
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: factory,
      abi: boardroomFactoryAbi,
      chain,
      functionName: "createBoardroom",
      args: [owner, boardroomForm.name, boardroomForm.symbol, salt],
    });
    pushLog(`Boardroom creation submitted: ${hash}`, "success");
  };

  const loadBoardroom = async (): Promise<void> => {
    const address = requireAddress(boardroomAddress, "Boardroom address");
    const [owner, policyRegistry, shareToken] = await Promise.all([
      publicClient.readContract({ address, abi: boardroomAbi, functionName: "owner" }),
      publicClient.readContract({ address, abi: boardroomAbi, functionName: "policyRegistry" }),
      publicClient.readContract({ address, abi: boardroomAbi, functionName: "shareToken" }),
    ]);
    setBoardroomSnapshot({ address, owner, policyRegistry, shareToken });
    setBoardroomMintTo(address);
    pushLog(`Loaded Boardroom ${address}`, "success");
  };

  const mintBoardroomShares = async (): Promise<void> => {
    const boardroom = boardroomSnapshot?.address ?? requireAddress(boardroomAddress, "Boardroom address");
    const to = boardroomMintTo.trim() ? requireAddress(boardroomMintTo, "Mint recipient") : boardroom;
    const amount = uintInput(boardroomMintAmount, "Mint amount");
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: boardroom,
      abi: boardroomAbi,
      chain,
      functionName: "mint",
      args: [to, amount],
    });
    pushLog(`Share mint submitted: ${hash}`, "success");
  };

  const boardroomGrantArgs = () => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    const holder = requireAddress(boardroomGrantForm.holder, "Grant holder");
    const paymentToken = optionalPaymentToken(boardroomGrantForm.paymentToken);
    const amount = uintInput(boardroomGrantForm.amount, "Grant amount");
    const price = uintInput(boardroomGrantForm.price, "Grant price");
    const expiry = uintInput(boardroomGrantForm.expiry, "Grant expiry");
    const vestingCliff = uintInput(boardroomGrantForm.vestingCliff, "Grant vesting cliff");
    const vestingEnd = uintInput(boardroomGrantForm.vestingEnd, "Grant vesting end");
    const transferUnlockTime = boardroomGrantForm.transferable
      ? uintInput(boardroomGrantForm.transferUnlockTime, "Grant transfer unlock time")
      : 0n;
    const salt = requireBytes32(boardroomGrantForm.salt, "Grant salt");

    return {
      amount,
      salt,
      tuple: [
        holder,
        boardroomSnapshot.shareToken,
        paymentToken,
        amount,
        price,
        expiry,
        vestingCliff,
        vestingEnd,
        boardroomGrantForm.transferable,
        transferUnlockTime,
        salt,
      ] as const,
    };
  };

  const predictBoardroomGrantAddress = async (): Promise<void> => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    if (usesLegacyTokenGrantFactory) throw new Error("Boardroom grants require a current TokenGrantFactory deployment.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { salt } = boardroomGrantArgs();
    const predicted = await publicClient.readContract({
      address: factory,
      abi: tokenGrantFactoryAbi,
      functionName: "predictGrantAddress",
      args: [boardroomSnapshot.address, salt],
    });
    setPredictedBoardroomGrant(predicted);
    updateGrantAddress(predicted);
    pushLog(`Predicted Boardroom grant ${predicted}`, "success");
  };

  const boardroomApproveFactory = async (): Promise<void> => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    if (usesLegacyTokenGrantFactory) throw new Error("Boardroom grants require a current TokenGrantFactory deployment.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { amount } = boardroomGrantArgs();
    const data = encodeFunctionData({
      abi: boardroomTokenAbi,
      functionName: "approve",
      args: [factory, amount],
    });
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: boardroomSnapshot.address,
      abi: boardroomAbi,
      chain,
      functionName: "execute",
      args: [
        {
          policy: factory,
          target: boardroomSnapshot.shareToken,
          value: 0n,
          data,
        },
      ],
    });
    pushLog(`Boardroom approval submitted: ${hash}`, "success");
  };

  const boardroomCreateGrant = async (): Promise<void> => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    if (usesLegacyTokenGrantFactory) throw new Error("Boardroom grants require a current TokenGrantFactory deployment.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { tuple } = boardroomGrantArgs();
    const data = encodeFunctionData({
      abi: tokenGrantFactoryAbi,
      functionName: "createGrant",
      args: tuple,
    });
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: boardroomSnapshot.address,
      abi: boardroomAbi,
      chain,
      functionName: "execute",
      args: [
        {
          policy: factory,
          target: factory,
          value: creationFee,
          data,
        },
      ],
      value: creationFee,
    });
    pushLog(`Boardroom grant creation submitted: ${hash}`, "success");
  };

  return (
    <div className="min-h-svh text-zinc-100">
      <AppHeader wallet={wallet} connectWallet={connectWallet} runAction={runAction} switchChain={switchChain} />

      <main className="grid min-h-[calc(100svh-64px)] grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="grid content-start gap-4 border-b border-zinc-800 bg-zinc-950/35 p-4 lg:border-b-0 lg:border-r">
          <DeploymentPanel creationFee={creationFee} deployment={deployment} factorySnapshot={factorySnapshot} />
          <WalletPanel wallet={wallet} />
          <LogPanel logs={logs} clearLogs={() => setLogs([])} />
          <ArtifactPanel deployment={deployment} />
        </aside>

        <section className="min-w-0 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <TabButton active={activeTab === "direct"} onClick={() => setActiveTab("direct")}>
              Direct Grant
            </TabButton>
            <TabButton active={activeTab === "grant"} onClick={() => setActiveTab("grant")}>
              Inspect Grant
            </TabButton>
            <TabButton active={activeTab === "boardroom"} onClick={() => setActiveTab("boardroom")}>
              Boardroom
            </TabButton>
          </div>

          {activeTab === "direct" ? (
            <DirectGrantPanel
              creationFee={creationFee}
              clearDirectGrantPrediction={clearDirectGrantPrediction}
              grantForm={grantForm}
              issuer={wallet.account}
              pendingAction={pendingAction}
              predictedGrant={predictedGrant}
              setGrantForm={setGrantForm}
              approveEscrow={approveEscrow}
              createGrant={createGrant}
              predictGrant={predictGrant}
              runAction={runAction}
            />
          ) : null}

          {activeTab === "grant" ? (
            <GrantInspector
              grantAddress={grantAddress}
              grantSnapshot={grantSnapshot}
              paymentApproval={paymentApproval}
              pendingAction={pendingAction}
              settleAmount={settleAmount}
              setGrantAddress={updateGrantAddress}
              setPaymentApproval={setPaymentApproval}
              setSettleAmount={setSettleAmount}
              approvePayment={approvePayment}
              haltGrant={haltGrant}
              loadGrant={loadGrant}
              runAction={runAction}
              settleGrant={settleGrant}
              withdrawExpired={withdrawExpired}
            />
          ) : null}

          {activeTab === "boardroom" ? (
            <BoardroomPanel
              boardroomAddress={boardroomAddress}
              boardroomForm={boardroomForm}
              boardroomGrantForm={boardroomGrantForm}
              boardroomMintAmount={boardroomMintAmount}
              boardroomMintTo={boardroomMintTo}
              boardroomSnapshot={boardroomSnapshot}
              clearBoardroomGrantPrediction={clearBoardroomGrantPrediction}
              deployment={deployment}
              pendingAction={pendingAction}
              predictedBoardroom={predictedBoardroom}
              predictedBoardroomGrant={predictedBoardroomGrant}
              setBoardroomAddress={updateBoardroomAddress}
              setBoardroomForm={setBoardroomForm}
              setBoardroomGrantForm={setBoardroomGrantForm}
              setBoardroomMintAmount={setBoardroomMintAmount}
              setBoardroomMintTo={setBoardroomMintTo}
              setPredictedBoardroom={setPredictedBoardroom}
              boardroomApproveFactory={boardroomApproveFactory}
              boardroomCreateGrant={boardroomCreateGrant}
              createBoardroom={createBoardroom}
              loadBoardroom={loadBoardroom}
              mintBoardroomShares={mintBoardroomShares}
              predictBoardroom={predictBoardroom}
              predictBoardroomGrantAddress={predictBoardroomGrantAddress}
              runAction={runAction}
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}
