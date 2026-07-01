import {
  boardroomAbi,
  boardroomFactoryAbi,
  buildBoardroomExecuteTransaction,
  buildBoardroomGrantApprovalCall,
  buildBoardroomGrantCreationCall,
  buildBoardroomShareGrantIssuanceBatch,
  buildDirectGrantCreationTransaction,
  buildErc20Approval,
  buildGrantIssuerBoardroomAction,
  getPledgeCashDeployment,
  isZeroAddress,
  predictBoardroomAddress as sdkPredictBoardroomAddress,
  predictBoardroomGrantAddress as sdkPredictBoardroomGrantAddress,
  predictDirectGrantAddress as sdkPredictDirectGrantAddress,
  queryGrantsHeldByAddress,
  queryGrantsIssuedByAddress,
  readBoardroomState,
  readFactoryState,
  readGrantState,
  tokenGrantAbi,
  type Address,
  type BoardroomShareGrantTerms,
  type GrantCreationTerms,
  type PledgeCashDeployment,
} from "@pledge.cash/sdk";
import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, getAddress, isAddress, type EIP1193Provider, type Hex } from "viem";
import { TabButton } from "./components/shell";
import { BoardroomPanel } from "./features/boardrooms/boardroom-panel";
import { ArtifactPanel, DeploymentPanel } from "./features/deployment/deployment-panel";
import { DirectGrantPanel } from "./features/grants/direct-grant-panel";
import { GrantInspector } from "./features/grants/grant-inspector";
import { MyGrantsPanel } from "./features/grants/my-grants-panel";
import { LogPanel } from "./features/logs/log-panel";
import { AppHeader } from "./features/wallet/app-header";
import { WalletPanel } from "./features/wallet/wallet-panel";
import { ACTIVE_CHAIN_ID, ACTIVE_CHAIN_NAME, chain, EXPLORER_URL, publicClient, WALLET_RPC_URL } from "./lib/contracts";
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
  MyGrantsSnapshot,
  Tab,
  WalletState,
} from "./lib/types";

type GrantIssuerAction = "stopVestingAndWithdrawUnvested" | "withdrawExpiredTokens";

function sameOptionalAddress(left: Address | undefined, right: Address | undefined): boolean {
  return (left ?? "").toLowerCase() === (right ?? "").toLowerCase();
}

function propertyToken(raw: string, key: string): string | undefined {
  const match = raw.match(new RegExp(`"${key}"\\s*:\\s*("([^"\\\\]|\\\\.)*"|-?\\d+|true|false|null)`));
  return match?.[1];
}

function bigintField(raw: string, key: string): bigint | undefined {
  const token = propertyToken(raw, key);
  if (!token || token === "null") return undefined;
  if (token.startsWith('"')) return BigInt(JSON.parse(token) as string);
  return BigInt(token);
}

export function parseDeployment(raw: string): PledgeCashDeployment {
  const json = JSON.parse(raw) as Record<string, unknown>;
  const deployment: PledgeCashDeployment = {
    chainId: Number(json.chainId),
  };

  for (const field of [
    "status",
    "reason",
    "boardroomStatus",
    "boardroomReason",
  ] as const) {
    if (typeof json[field] === "string") {
      deployment[field] = json[field];
    }
  }

  for (const field of [
    "boardroomFactory",
    "boardroomPolicyRegistry",
    "distributionFactory",
    "ammFactory",
    "ammRouter",
    "lockedLiquidityFactory",
    "tokenGrantFactory",
    "tokenGrantLogic",
    "wrappedNative",
    "deployer",
    "factoryOwner",
    "policyRegistryOwner",
  ] as const) {
    if (typeof json[field] === "string") {
      deployment[field] = json[field] as Address;
    }
  }

  if (typeof json.tokenGrantPolicyAllowed === "boolean") {
    deployment.tokenGrantPolicyAllowed = json.tokenGrantPolicyAllowed;
  }
  if (typeof json.distributionPolicyAllowed === "boolean") {
    deployment.distributionPolicyAllowed = json.distributionPolicyAllowed;
  }
  if (typeof json.lockedLiquidityPolicyAllowed === "boolean") {
    deployment.lockedLiquidityPolicyAllowed = json.lockedLiquidityPolicyAllowed;
  }
  const creationFee = bigintField(raw, "creationFee");
  if (creationFee !== undefined) {
    deployment.creationFee = creationFee;
  }
  const deploymentTimestamp = bigintField(raw, "deploymentTimestamp");
  if (deploymentTimestamp !== undefined) {
    deployment.deploymentTimestamp = deploymentTimestamp;
  }

  return deployment;
}

export function App(): React.JSX.Element {
  const generatedDeployment = getPledgeCashDeployment(ACTIVE_CHAIN_ID);
  const [runtimeDeployment, setRuntimeDeployment] = useState<PledgeCashDeployment | undefined>(generatedDeployment);
  const deployment = runtimeDeployment;
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
  const [myGrantsFromBlock, setMyGrantsFromBlock] = useState("0");
  const [includeClosedGrants, setIncludeClosedGrants] = useState(false);
  const [myGrants, setMyGrants] = useState<MyGrantsSnapshot>(() => ({
    held: [],
    issued: [],
    includeClosed: false,
  }));
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pendingAction, setPendingAction] = useState<string>();

  const creationFee = factorySnapshot.creationFee ?? deployment?.creationFee ?? 0n;

  useEffect(() => {
    let cancelled = false;

    async function loadRuntimeDeployment(): Promise<void> {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}deployments/${ACTIVE_CHAIN_ID}.json`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const raw = await response.text();
        if (!cancelled) {
          setRuntimeDeployment(parseDeployment(raw));
        }
      } catch {
        // The generated SDK deployment remains the fallback for SSR and package consumers.
      }
    }

    void loadRuntimeDeployment();
    return () => {
      cancelled = true;
    };
  }, []);

  const pushLog = useCallback((message: string, level: LogEntry["level"] = "info", txHash?: Hex) => {
    const entry = {
      id: `${Date.now()}-${Math.random()}`,
      level,
      message,
      time: new Date().toISOString().replace(".000Z", "Z"),
      ...(txHash ? { txHash } : {}),
    };
    setLogs((current) => [
      entry,
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
        const snapshot = await readFactoryState(publicClient, deployment.tokenGrantFactory);

        if (!cancelled) {
          setFactorySnapshot({
            owner: snapshot.owner,
            tokenGrantLogic: snapshot.tokenGrantLogic,
            creationFee: snapshot.creationFee,
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
    if (wallet.chainId !== ACTIVE_CHAIN_ID) throw new Error(`Switch wallet to ${ACTIVE_CHAIN_NAME} first.`);

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

  const submitContractTransaction = async (label: string, request: Record<string, unknown>): Promise<Hex> => {
    const client = walletClient();
    const hash = (await client.writeContract({
      account: activeAccount(),
      chain,
      ...request,
    } as unknown as Parameters<typeof client.writeContract>[0])) as Hex;

    pushLog(`${label} submitted`, "info", hash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      pushLog(`${label} failed`, "error", hash);
      throw new Error(`${label} failed after submission.`);
    }

    pushLog(`${label} confirmed`, "success", hash);
    return hash;
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

    const chainId = `0x${ACTIVE_CHAIN_ID.toString(16)}`;
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
            chainName: ACTIVE_CHAIN_NAME,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [WALLET_RPC_URL],
            ...(EXPLORER_URL ? { blockExplorerUrls: [EXPLORER_URL] } : {}),
          },
        ],
      });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    }

    const activeChainId = (await provider.request({ method: "eth_chainId" })) as string;
    const parsedChainId = Number.parseInt(activeChainId, 16);
    setWallet((current) => walletState(current.account, Number.isNaN(parsedChainId) ? undefined : parsedChainId));
    if (parsedChainId !== ACTIVE_CHAIN_ID) {
      throw new Error(`Wallet is still on chain ${Number.isNaN(parsedChainId) ? activeChainId : parsedChainId}.`);
    }
    pushLog(`Wallet switched to ${ACTIVE_CHAIN_NAME}.`, "success");
  };

  const directGrantTerms = (): GrantCreationTerms => {
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

    return {
      holder,
      token,
      paymentToken,
      amount,
      price,
      expiry,
      vestingCliff,
      vestingEnd,
      transferable: grantForm.transferable,
      transferUnlockTime,
      salt,
    };
  };

  const predictDirectGrantAddress = async (): Promise<Address> => {
    if (!wallet.account) throw new Error("Connect wallet to predict a direct grant.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { salt } = directGrantTerms();

    return await sdkPredictDirectGrantAddress(publicClient, { factory, issuer: wallet.account, salt });
  };

  const predictGrant = async (): Promise<void> => {
    const predicted = await predictDirectGrantAddress();
    setPredictedGrant(predicted);
    updateGrantAddress(predicted);
    pushLog(`Predicted grant ${predicted}`, "success");
  };

  const approveEscrow = async (): Promise<void> => {
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { token, amount } = directGrantTerms();

    await submitContractTransaction("Escrow approval", buildErc20Approval({ token, spender: factory, amount }));
  };

  const createGrant = async (): Promise<void> => {
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    await submitContractTransaction(
      "Grant creation",
      buildDirectGrantCreationTransaction({ factory, terms: directGrantTerms(), creationFee }),
    );
  };

  const loadGrant = async (): Promise<void> => {
    const grant = requireAddress(grantAddress, "Grant address");
    const now = BigInt(Math.floor(Date.now() / 1000));
    const snapshot = await readGrantState(publicClient, grant, now);

    setGrantSnapshot({
      address: grant,
      issuer: snapshot.issuer,
      holder: snapshot.holder,
      token: snapshot.token,
      paymentToken: snapshot.paymentToken,
      grantSize: snapshot.grantSize,
      claimable: snapshot.claimable,
      price: snapshot.price,
      expiry: snapshot.expiry,
      settledAmount: snapshot.settledAmount,
      halted: snapshot.halted,
      closed: snapshot.closed,
      settleable: snapshot.settleable,
    });
    pushLog(`Loaded grant ${grant}`, "success");
  };

  const approvePayment = async (): Promise<void> => {
    if (!grantSnapshot) throw new Error("Load a grant first.");
    const grant = requireAddress(grantAddress, "Grant address");
    if (grantSnapshot.address.toLowerCase() !== grant.toLowerCase()) throw new Error("Reload the grant after changing the address.");
    if (isZeroAddress(grantSnapshot.paymentToken)) throw new Error("Selected grant has no payment token.");

    const amount = uintInput(paymentApproval, "Payment approval");
    await submitContractTransaction(
      "Payment approval",
      buildErc20Approval({ token: grantSnapshot.paymentToken, spender: grantSnapshot.address, amount }),
    );
  };

  const settleGrant = async (): Promise<void> => {
    const grant = requireAddress(grantAddress, "Grant address");
    const amount = uintInput(settleAmount, "Settle amount");
    await submitContractTransaction("Grant settlement", {
      address: grant,
      abi: tokenGrantAbi,
      functionName: "settle",
      args: [amount],
    });
  };

  const isBoardroomIssuer = async (issuer: Address): Promise<boolean> => {
    try {
      const snapshot = await readBoardroomState(publicClient, issuer);
      return !isZeroAddress(snapshot.policyRegistry);
    } catch {
      return false;
    }
  };

  const runGrantIssuerAction = async (functionName: GrantIssuerAction, successMessage: string): Promise<void> => {
    const grant = requireAddress(grantAddress, "Grant address");
    const { issuer } = await readGrantState(publicClient, grant);

    if (await isBoardroomIssuer(issuer)) {
      const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
      await submitContractTransaction(
        `${successMessage} through Boardroom`,
        buildGrantIssuerBoardroomAction({ boardroom: issuer, policy: factory, grant, functionName }),
      );
      return;
    }

    await submitContractTransaction(successMessage, {
      address: grant,
      abi: tokenGrantAbi,
      functionName,
    });
  };

  const haltGrant = async (): Promise<void> => {
    await runGrantIssuerAction("stopVestingAndWithdrawUnvested", "Vesting halt");
  };

  const withdrawExpired = async (): Promise<void> => {
    await runGrantIssuerAction("withdrawExpiredTokens", "Expired withdrawal");
  };

  const predictBoardroom = async (): Promise<void> => {
    const factory = requireDeploymentAddress(deployment?.boardroomFactory, "BoardroomFactory");
    const owner = requireAddress(boardroomForm.owner, "Boardroom owner");
    const salt = requireBytes32(boardroomForm.salt, "Boardroom salt");
    const predicted = await sdkPredictBoardroomAddress(publicClient, {
      factory,
      owner,
      name: boardroomForm.name,
      symbol: boardroomForm.symbol,
      salt,
    });
    setPredictedBoardroom(predicted);
    updateBoardroomAddress(predicted);
    pushLog(`Predicted Boardroom ${predicted}`, "success");
  };

  const createBoardroom = async (): Promise<void> => {
    const factory = requireDeploymentAddress(deployment?.boardroomFactory, "BoardroomFactory");
    const owner = requireAddress(boardroomForm.owner, "Boardroom owner");
    const salt = requireBytes32(boardroomForm.salt, "Boardroom salt");
    await submitContractTransaction("Boardroom creation", {
      address: factory,
      abi: boardroomFactoryAbi,
      functionName: "createBoardroom",
      args: [owner, boardroomForm.name, boardroomForm.symbol, salt],
    });
  };

  const loadBoardroom = async (): Promise<void> => {
    const address = requireAddress(boardroomAddress, "Boardroom address");
    const snapshot = await readBoardroomState(publicClient, address);
    setBoardroomSnapshot(snapshot);
    setBoardroomMintTo(address);
    pushLog(`Loaded Boardroom ${address}`, "success");
  };

  const mintBoardroomShares = async (): Promise<void> => {
    const boardroom = boardroomSnapshot?.address ?? requireAddress(boardroomAddress, "Boardroom address");
    const to = boardroomMintTo.trim() ? requireAddress(boardroomMintTo, "Mint recipient") : boardroom;
    const amount = uintInput(boardroomMintAmount, "Mint amount");
    await submitContractTransaction("Share mint", {
      address: boardroom,
      abi: boardroomAbi,
      functionName: "mint",
      args: [to, amount],
    });
  };

  const boardroomShareGrantTerms = (): BoardroomShareGrantTerms => {
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
      holder,
      paymentToken,
      amount,
      price,
      expiry,
      vestingCliff,
      vestingEnd,
      transferable: boardroomGrantForm.transferable,
      transferUnlockTime,
      salt,
    };
  };

  const predictBoardroomGrantAddress = async (): Promise<void> => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { salt } = boardroomShareGrantTerms();
    const predicted = await sdkPredictBoardroomGrantAddress(publicClient, {
      factory,
      boardroom: boardroomSnapshot.address,
      salt,
    });
    setPredictedBoardroomGrant(predicted);
    updateGrantAddress(predicted);
    pushLog(`Predicted Boardroom grant ${predicted}`, "success");
  };

  const boardroomApproveFactory = async (): Promise<void> => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { amount } = boardroomShareGrantTerms();
    await submitContractTransaction(
      "Boardroom approval",
      buildBoardroomExecuteTransaction({
        boardroom: boardroomSnapshot.address,
        call: buildBoardroomGrantApprovalCall({
          policy: factory,
          shareToken: boardroomSnapshot.shareToken,
          factory,
          amount,
        }),
      }),
    );
  };

  const boardroomCreateGrant = async (): Promise<void> => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    await submitContractTransaction(
      "Boardroom grant creation",
      buildBoardroomExecuteTransaction({
        boardroom: boardroomSnapshot.address,
        call: buildBoardroomGrantCreationCall({
          policy: factory,
          factory,
          terms: { ...boardroomShareGrantTerms(), token: boardroomSnapshot.shareToken },
          creationFee,
        }),
        value: creationFee,
      }),
    );
  };

  const boardroomCreateGrantBatch = async (): Promise<void> => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    await submitContractTransaction(
      "Boardroom grant batch",
      buildBoardroomShareGrantIssuanceBatch({
        boardroom: boardroomSnapshot.address,
        factory,
        shareToken: boardroomSnapshot.shareToken,
        terms: boardroomShareGrantTerms(),
        creationFee,
      }),
    );
  };

  const loadMyGrants = async (): Promise<void> => {
    if (!wallet.account) throw new Error("Connect wallet first.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const fromBlock = uintInput(myGrantsFromBlock, "From block");

    const [held, issued] = await Promise.all([
      queryGrantsHeldByAddress(publicClient, {
        factory,
        holder: wallet.account,
        fromBlock,
        includeClosed: includeClosedGrants,
      }),
      queryGrantsIssuedByAddress(publicClient, {
        factory,
        issuer: wallet.account,
        fromBlock,
        includeClosed: includeClosedGrants,
      }),
    ]);

    setMyGrants({
      held,
      issued,
      loadedFor: wallet.account,
      fromBlock,
      includeClosed: includeClosedGrants,
    });
    pushLog(`Loaded ${held.length} held and ${issued.length} issued grants for ${shortAddress(wallet.account)}.`, "success");
  };

  const inspectDiscoveredGrant = useCallback(
    (grant: Address): void => {
      updateGrantAddress(grant);
      setActiveTab("grant");
    },
    [updateGrantAddress],
  );

  return (
    <div className="min-h-svh text-zinc-100">
      <AppHeader
        wallet={wallet}
        chainId={ACTIVE_CHAIN_ID}
        chainName={ACTIVE_CHAIN_NAME}
        connectWallet={connectWallet}
        runAction={runAction}
        switchChain={switchChain}
      />

      <main className="grid min-h-[calc(100svh-64px)] grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="grid content-start gap-4 border-b border-zinc-800 bg-zinc-950/35 p-4 lg:border-b-0 lg:border-r">
          <DeploymentPanel chainId={ACTIVE_CHAIN_ID} creationFee={creationFee} deployment={deployment} factorySnapshot={factorySnapshot} />
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
            <TabButton active={activeTab === "my-grants"} onClick={() => setActiveTab("my-grants")}>
              My Grants
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
              boardroomCreateGrantBatch={boardroomCreateGrantBatch}
              createBoardroom={createBoardroom}
              loadBoardroom={loadBoardroom}
              mintBoardroomShares={mintBoardroomShares}
              predictBoardroom={predictBoardroom}
              predictBoardroomGrantAddress={predictBoardroomGrantAddress}
              runAction={runAction}
            />
          ) : null}

          {activeTab === "my-grants" ? (
            <MyGrantsPanel
              account={wallet.account}
              deployment={deployment}
              fromBlock={myGrantsFromBlock}
              includeClosed={includeClosedGrants}
              myGrants={myGrants}
              pendingAction={pendingAction}
              setFromBlock={setMyGrantsFromBlock}
              setIncludeClosed={setIncludeClosedGrants}
              inspectGrant={inspectDiscoveredGrant}
              loadMyGrants={loadMyGrants}
              runAction={runAction}
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}
