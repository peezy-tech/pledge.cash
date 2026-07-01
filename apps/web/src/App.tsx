import {
  boardroomFactoryAbi,
  buildBoardroomBurnTreasurySharesTransaction,
  buildBoardroomExecuteTransaction,
  buildBoardroomFixedPriceSaleBatch,
  buildBoardroomFixedPriceSaleCancelAction,
  buildBoardroomFixedPriceSaleCloseAction,
  buildBoardroomGrantApprovalCall,
  buildBoardroomGrantCreationCall,
  buildBoardroomLockedLiquidityBatch,
  buildBoardroomLockedLiquidityExitTransaction,
  buildBoardroomLockedLiquidityFeeClaimAction,
  buildBoardroomMigratingCurveBatch,
  buildBoardroomMigratingCurveCancelAction,
  buildBoardroomMigratingCurveMigrationAction,
  buildBoardroomMintTransaction,
  buildBoardroomOpenRedemptionsTransaction,
  buildBoardroomRedeemTransaction,
  buildBoardroomRegisterRedeemableAssetTransaction,
  buildBoardroomShareGrantIssuanceBatch,
  buildBoardroomStartWindDownTransaction,
  buildDirectGrantCreationTransaction,
  buildErc20Approval,
  buildGrantIssuerBoardroomAction,
  discoverBoardroomDistributions,
  discoverBoardroomLockedLiquidity,
  discoverBoardrooms,
  discoverGrantHistory,
  discoverPools,
  getPledgeCashDeployment,
  isZeroAddress,
  predictBoardroomAddress as sdkPredictBoardroomAddress,
  predictBoardroomGrantAddress as sdkPredictBoardroomGrantAddress,
  predictDirectGrantAddress as sdkPredictDirectGrantAddress,
  predictFixedPriceSaleAddress as sdkPredictFixedPriceSaleAddress,
  predictLockedLiquidityAddress as sdkPredictLockedLiquidityAddress,
  predictMigratingBondingCurveAddress as sdkPredictMigratingBondingCurveAddress,
  readBoardroomState,
  readFactoryState,
  readFixedPriceSaleState,
  readGrantState,
  readLockedLiquidityState,
  readMigratingBondingCurveState,
  tokenGrantAbi,
  type Address,
  type BoardroomFixedPriceSaleTerms,
  type BoardroomLockedLiquidityTerms,
  type BoardroomMigratingBondingCurveTerms,
  type BoardroomShareGrantTerms,
  type DiscoveredBoardroom,
  type DiscoveredDistribution,
  type DiscoveredGrant,
  type DiscoveredLockedLiquidity,
  type DiscoveredPool,
  type DiscoveryResult,
  type FixedPriceSaleState,
  type GrantCreationTerms,
  type LockedLiquidityState,
  type MigratingBondingCurveState,
  type PledgeCashDeployment,
} from "@pledge.cash/sdk";
import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, encodeFunctionData, getAddress, isAddress, type EIP1193Provider, type Hex } from "viem";
import { TabButton } from "./components/shell";
import { BoardroomPanel } from "./features/boardrooms/boardroom-panel";
import { ArtifactPanel, DeploymentPanel } from "./features/deployment/deployment-panel";
import { DiscoveryPanel } from "./features/discovery/discovery-panel";
import { DirectGrantPanel } from "./features/grants/direct-grant-panel";
import { GrantInspector } from "./features/grants/grant-inspector";
import { LogPanel } from "./features/logs/log-panel";
import { AppHeader } from "./features/wallet/app-header";
import { WalletPanel } from "./features/wallet/wallet-panel";
import { ACTIVE_CHAIN_ID, ACTIVE_CHAIN_NAME, chain, EXPLORER_URL, publicClient, WALLET_RPC_URL } from "./lib/contracts";
import {
  addressMapKey,
  clearDiscoverySnapshot,
  discoveryStorageKey,
  emptyDiscoverySnapshot,
  loadDiscoverySnapshot,
  saveDiscoverySnapshot,
} from "./lib/discovery";
import {
  defaultBoardroomGrantForm,
  defaultCurveMigrationForm,
  defaultFixedPriceSaleForm,
  defaultGrantForm,
  defaultLockedLiquidityExitForm,
  defaultLockedLiquidityForm,
  defaultMigratingCurveForm,
  defaultWindDownForm,
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
  CurveMigrationForm,
  DiscoveryForm,
  DiscoverySnapshot,
  FactorySnapshot,
  FixedPriceSaleForm,
  GrantForm,
  GrantSnapshot,
  LockedLiquidityExitForm,
  LockedLiquidityForm,
  LogEntry,
  MigratingCurveForm,
  Tab,
  WalletState,
  WindDownForm,
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

function contractCallPreview(label: string, request: Record<string, unknown>): string {
  const target = typeof request.address === "string" ? request.address : "unknown";
  const functionName = typeof request.functionName === "string" ? request.functionName : "unknown";
  const value = typeof request.value === "bigint" ? request.value : 0n;
  let data = "unavailable";

  try {
    if (request.abi && typeof request.functionName === "string") {
      const encode = encodeFunctionData as unknown as (parameters: {
        abi: readonly unknown[];
        functionName: string;
        args?: readonly unknown[];
      }) => Hex;
      data = encode({
        abi: request.abi as readonly unknown[],
        functionName: request.functionName,
        args: Array.isArray(request.args) ? request.args : [],
      });
    }
  } catch {
    data = "unavailable";
  }

  return `${label} call target=${target} function=${functionName} value=${value.toString()} data=${data}`;
}

function parseMinAmountsOut(value: string, expectedLength: number): bigint[] {
  const trimmed = value.trim();
  if (!trimmed) return Array.from({ length: expectedLength }, () => 0n);

  const values = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
  if (values.length !== expectedLength) {
    throw new Error(`Minimum amounts must include ${expectedLength} comma-separated values.`);
  }

  return values.map((part) => {
    if (!/^\d+$/.test(part)) throw new Error("Minimum amounts must be unsigned integers.");
    return BigInt(part);
  });
}

function defaultDiscoveryForm(): DiscoveryForm {
  return {
    fromBlock: "0",
    toBlock: "",
    chunkSize: "5000",
    includeClosedGrants: false,
  };
}

function parseDiscoveryToBlock(value: string): bigint | "latest" {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "latest") return "latest";
  if (!/^\d+$/.test(trimmed)) throw new Error("To block must be an unsigned integer or latest.");
  return BigInt(trimmed);
}

function mergeAddressMap<T>(
  current: Record<string, T>,
  items: readonly T[],
  key: (item: T) => Address,
): Record<string, T> {
  const next = { ...current };
  for (const item of items) {
    next[addressMapKey(key(item))] = item;
  }
  return next;
}

function discoveryItems<T>(items: Record<string, T>): T[] {
  return Object.values(items);
}

function combineDiscoveryLastScanned(results: readonly DiscoveryResult<unknown>[]): bigint | undefined {
  const scanned = results.map((result) => result.lastScannedBlock).filter((block): block is bigint => block !== undefined);
  if (scanned.length === 0) return undefined;
  return scanned.reduce((minimum, block) => (block < minimum ? block : minimum));
}

function discoveryErrors(results: readonly DiscoveryResult<unknown>[]): string[] {
  return results.flatMap((result) => result.errors.map((error) => error.message));
}

function emptyDiscoveryResult<T>(items: T[] = []): DiscoveryResult<T> {
  return {
    items,
    fromBlock: 0n,
    toBlock: undefined,
    complete: true,
    errors: [],
  };
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
    "ammProtocolFeeRecipient",
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
  const [fixedPriceSaleForm, setFixedPriceSaleForm] = useState<FixedPriceSaleForm>(() => defaultFixedPriceSaleForm());
  const [fixedPriceSaleAddress, setFixedPriceSaleAddress] = useState("");
  const [fixedPriceSaleSnapshot, setFixedPriceSaleSnapshot] = useState<FixedPriceSaleState>();
  const [predictedFixedPriceSale, setPredictedFixedPriceSale] = useState<Address>();
  const [migratingCurveForm, setMigratingCurveForm] = useState<MigratingCurveForm>(() => defaultMigratingCurveForm());
  const [migratingCurveAddress, setMigratingCurveAddress] = useState("");
  const [migratingCurveSnapshot, setMigratingCurveSnapshot] = useState<MigratingBondingCurveState>();
  const [predictedMigratingCurve, setPredictedMigratingCurve] = useState<Address>();
  const [curveMigrationForm, setCurveMigrationForm] = useState<CurveMigrationForm>(() => defaultCurveMigrationForm());
  const [lockedLiquidityForm, setLockedLiquidityForm] = useState<LockedLiquidityForm>(() => defaultLockedLiquidityForm());
  const [lockedLiquidityAddress, setLockedLiquidityAddress] = useState("");
  const [lockedLiquiditySnapshot, setLockedLiquiditySnapshot] = useState<LockedLiquidityState>();
  const [predictedLockedLiquidity, setPredictedLockedLiquidity] = useState<Address>();
  const [lockedLiquidityExitForm, setLockedLiquidityExitForm] = useState<LockedLiquidityExitForm>(() => defaultLockedLiquidityExitForm());
  const [windDownForm, setWindDownForm] = useState<WindDownForm>(() => defaultWindDownForm());
  const [discoveryForm, setDiscoveryForm] = useState<DiscoveryForm>(() => defaultDiscoveryForm());
  const [discovery, setDiscovery] = useState<DiscoverySnapshot>(() => emptyDiscoverySnapshot());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pendingAction, setPendingAction] = useState<string>();

  const creationFee = factorySnapshot.creationFee ?? deployment?.creationFee ?? 0n;
  const discoveryKey = discoveryStorageKey(ACTIVE_CHAIN_ID, wallet.account);

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

  useEffect(() => {
    setDiscovery(loadDiscoverySnapshot(discoveryKey));
  }, [discoveryKey]);

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
    setPredictedFixedPriceSale(undefined);
    setPredictedMigratingCurve(undefined);
    setPredictedLockedLiquidity(undefined);
  }, []);

  const updateFixedPriceSaleAddress = useCallback((address: string): void => {
    setFixedPriceSaleAddress(address);
    setFixedPriceSaleSnapshot(undefined);
  }, []);

  const updateMigratingCurveAddress = useCallback((address: string): void => {
    setMigratingCurveAddress(address);
    setMigratingCurveSnapshot(undefined);
  }, []);

  const updateLockedLiquidityAddress = useCallback((address: string): void => {
    setLockedLiquidityAddress(address);
    setLockedLiquiditySnapshot(undefined);
  }, []);

  const clearBoardroomGrantPrediction = useCallback((): void => {
    if (predictedBoardroomGrant && grantAddress.toLowerCase() === predictedBoardroomGrant.toLowerCase()) {
      updateGrantAddress("");
    }
    setPredictedBoardroomGrant(undefined);
  }, [grantAddress, predictedBoardroomGrant, updateGrantAddress]);

  const readBoardroomSnapshot = async (address: Address): Promise<BoardroomSnapshot> => {
    const state = await readBoardroomState(publicClient, address);
    const [grantSummaries, distributionSummaries, lockedLiquiditySummaries] = await Promise.all([
      Promise.all(
        state.issuedGrants.map(async (grant) => {
          try {
            return { address: grant, state: await readGrantState(publicClient, grant) };
          } catch (error) {
            return { address: grant, error: errorMessage(error) };
          }
        }),
      ),
      Promise.all(
        state.issuedDistributions.map(async (distribution) => {
          try {
            return {
              address: distribution,
              kind: "fixed-price-sale" as const,
              state: await readFixedPriceSaleState(publicClient, distribution),
            };
          } catch (fixedPriceError) {
            try {
              return {
                address: distribution,
                kind: "migrating-bonding-curve" as const,
                state: await readMigratingBondingCurveState(publicClient, distribution),
              };
            } catch (curveError) {
              return {
                address: distribution,
                kind: "unknown" as const,
                error: `${errorMessage(fixedPriceError)}; ${errorMessage(curveError)}`,
              };
            }
          }
        }),
      ),
      Promise.all(
        state.lockedLiquidityPositions.map(async (locker) => {
          try {
            return { address: locker, state: await readLockedLiquidityState(publicClient, locker) };
          } catch (error) {
            return { address: locker, error: errorMessage(error) };
          }
        }),
      ),
    ]);

    return {
      ...state,
      grantSummaries,
      distributionSummaries,
      lockedLiquiditySummaries,
    };
  };

  const refreshBoardroom = async (address?: Address): Promise<BoardroomSnapshot> => {
    const boardroom = address ?? boardroomSnapshot?.address ?? requireAddress(boardroomAddress, "Boardroom address");
    const snapshot = await readBoardroomSnapshot(boardroom);
    setBoardroomSnapshot(snapshot);
    setBoardroomMintTo((current) => current || snapshot.address);
    return snapshot;
  };

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
    pushLog(contractCallPreview(label, request), "info");
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
    const predicted = await sdkPredictBoardroomAddress(publicClient, {
      factory,
      owner,
      name: boardroomForm.name,
      symbol: boardroomForm.symbol,
      salt,
    });
    await submitContractTransaction("Boardroom creation", {
      address: factory,
      abi: boardroomFactoryAbi,
      functionName: "createBoardroom",
      args: [owner, boardroomForm.name, boardroomForm.symbol, salt],
    });
    setPredictedBoardroom(predicted);
    setBoardroomAddress(predicted);
    await refreshBoardroom(predicted);
  };

  const loadBoardroom = async (): Promise<void> => {
    const address = requireAddress(boardroomAddress, "Boardroom address");
    await refreshBoardroom(address);
    pushLog(`Loaded Boardroom ${address}`, "success");
  };

  const mintBoardroomShares = async (): Promise<void> => {
    const boardroom = boardroomSnapshot?.address ?? requireAddress(boardroomAddress, "Boardroom address");
    const to = boardroomMintTo.trim() ? requireAddress(boardroomMintTo, "Mint recipient") : boardroom;
    const amount = uintInput(boardroomMintAmount, "Mint amount");
    await submitContractTransaction("Share mint", buildBoardroomMintTransaction({ boardroom, to, amount }));
    await refreshBoardroom(boardroom);
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
    await refreshBoardroom(boardroomSnapshot.address);
  };

  const boardroomCreateGrant = async (): Promise<void> => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const predicted = await sdkPredictBoardroomGrantAddress(publicClient, {
      factory,
      boardroom: boardroomSnapshot.address,
      salt: boardroomShareGrantTerms().salt,
    });
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
    setPredictedBoardroomGrant(predicted);
    updateGrantAddress(predicted);
    await refreshBoardroom(boardroomSnapshot.address);
  };

  const boardroomCreateGrantBatch = async (): Promise<void> => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const terms = boardroomShareGrantTerms();
    const predicted = await sdkPredictBoardroomGrantAddress(publicClient, {
      factory,
      boardroom: boardroomSnapshot.address,
      salt: terms.salt,
    });
    await submitContractTransaction(
      "Boardroom grant batch",
      buildBoardroomShareGrantIssuanceBatch({
        boardroom: boardroomSnapshot.address,
        factory,
        shareToken: boardroomSnapshot.shareToken,
        terms,
        creationFee,
      }),
    );
    setPredictedBoardroomGrant(predicted);
    updateGrantAddress(predicted);
    await refreshBoardroom(boardroomSnapshot.address);
  };

  const requireLoadedBoardroom = (): BoardroomSnapshot => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    return boardroomSnapshot;
  };

  const fixedPriceSaleTerms = (): BoardroomFixedPriceSaleTerms => ({
    paymentToken: requireAddress(fixedPriceSaleForm.paymentToken, "Payment token"),
    shareAmount: uintInput(fixedPriceSaleForm.shareAmount, "Sale share amount"),
    price: uintInput(fixedPriceSaleForm.price, "Sale price"),
    maxPerBuyer: uintInput(fixedPriceSaleForm.maxPerBuyer, "Max per buyer"),
    startTime: uintInput(fixedPriceSaleForm.startTime, "Sale start time"),
    endTime: uintInput(fixedPriceSaleForm.endTime, "Sale end time"),
    salt: requireBytes32(fixedPriceSaleForm.salt, "Sale salt"),
  });

  const predictFixedPriceSale = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const { salt } = fixedPriceSaleTerms();
    const predicted = await sdkPredictFixedPriceSaleAddress(publicClient, { factory, boardroom: boardroom.address, salt });
    setPredictedFixedPriceSale(predicted);
    updateFixedPriceSaleAddress(predicted);
    pushLog(`Predicted fixed-price sale ${predicted}`, "success");
  };

  const loadFixedPriceSaleAddress = async (address?: Address): Promise<FixedPriceSaleState> => {
    const sale = address ?? requireAddress(fixedPriceSaleAddress, "Fixed-price sale address");
    const snapshot = await readFixedPriceSaleState(publicClient, sale);
    setFixedPriceSaleSnapshot(snapshot);
    setFixedPriceSaleAddress(sale);
    return snapshot;
  };

  const loadFixedPriceSale = async (): Promise<void> => {
    const sale = requireAddress(fixedPriceSaleAddress, "Fixed-price sale address");
    await loadFixedPriceSaleAddress(sale);
    pushLog(`Loaded fixed-price sale ${sale}`, "success");
  };

  const createFixedPriceSale = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const terms = fixedPriceSaleTerms();
    const predicted = await sdkPredictFixedPriceSaleAddress(publicClient, { factory, boardroom: boardroom.address, salt: terms.salt });
    await submitContractTransaction(
      "Fixed-price sale creation",
      buildBoardroomFixedPriceSaleBatch({
        boardroom: boardroom.address,
        factory,
        shareToken: boardroom.shareToken,
        terms,
      }),
    );
    setPredictedFixedPriceSale(predicted);
    updateFixedPriceSaleAddress(predicted);
    await Promise.all([refreshBoardroom(boardroom.address), loadFixedPriceSaleAddress(predicted)]);
  };

  const closeFixedPriceSale = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const sale = requireAddress(fixedPriceSaleAddress, "Fixed-price sale address");
    await submitContractTransaction(
      "Fixed-price sale close",
      buildBoardroomFixedPriceSaleCloseAction({ boardroom: boardroom.address, policy: factory, sale }),
    );
    await Promise.all([refreshBoardroom(boardroom.address), loadFixedPriceSaleAddress(sale)]);
  };

  const cancelFixedPriceSale = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const sale = requireAddress(fixedPriceSaleAddress, "Fixed-price sale address");
    await submitContractTransaction(
      "Fixed-price sale cancel",
      buildBoardroomFixedPriceSaleCancelAction({ boardroom: boardroom.address, policy: factory, sale }),
    );
    await Promise.all([refreshBoardroom(boardroom.address), loadFixedPriceSaleAddress(sale)]);
  };

  const migratingCurveTerms = (): BoardroomMigratingBondingCurveTerms => {
    const quoteToLpBps = uintInput(migratingCurveForm.quoteToLpBps, "Quote-to-LP bps");
    if (quoteToLpBps > 10_000n) throw new Error("Quote-to-LP bps must be at most 10000.");

    return {
      quoteToken: requireAddress(migratingCurveForm.quoteToken, "Quote token"),
      saleSupply: uintInput(migratingCurveForm.saleSupply, "Curve sale supply"),
      migrationSupply: uintInput(migratingCurveForm.migrationSupply, "Curve migration supply"),
      basePrice: uintInput(migratingCurveForm.basePrice, "Curve base price"),
      slope: uintInput(migratingCurveForm.slope, "Curve slope"),
      graduationQuoteTarget: uintInput(migratingCurveForm.graduationQuoteTarget, "Graduation quote target"),
      quoteToLpBps: Number(quoteToLpBps),
      startTime: uintInput(migratingCurveForm.startTime, "Curve start time"),
      endTime: uintInput(migratingCurveForm.endTime, "Curve end time"),
      migrationSalt: requireBytes32(migratingCurveForm.migrationSalt, "Migration salt"),
      salt: requireBytes32(migratingCurveForm.salt, "Curve salt"),
    };
  };

  const predictMigratingCurve = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const { salt } = migratingCurveTerms();
    const predicted = await sdkPredictMigratingBondingCurveAddress(publicClient, { factory, boardroom: boardroom.address, salt });
    setPredictedMigratingCurve(predicted);
    updateMigratingCurveAddress(predicted);
    pushLog(`Predicted migrating curve ${predicted}`, "success");
  };

  const loadMigratingCurveAddress = async (address?: Address): Promise<MigratingBondingCurveState> => {
    const curve = address ?? requireAddress(migratingCurveAddress, "Migrating curve address");
    const snapshot = await readMigratingBondingCurveState(publicClient, curve);
    setMigratingCurveSnapshot(snapshot);
    setMigratingCurveAddress(curve);
    return snapshot;
  };

  const loadMigratingCurve = async (): Promise<void> => {
    const curve = requireAddress(migratingCurveAddress, "Migrating curve address");
    await loadMigratingCurveAddress(curve);
    pushLog(`Loaded migrating curve ${curve}`, "success");
  };

  const createMigratingCurve = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const terms = migratingCurveTerms();
    const predicted = await sdkPredictMigratingBondingCurveAddress(publicClient, { factory, boardroom: boardroom.address, salt: terms.salt });
    await submitContractTransaction(
      "Migrating curve creation",
      buildBoardroomMigratingCurveBatch({
        boardroom: boardroom.address,
        factory,
        shareToken: boardroom.shareToken,
        terms,
      }),
    );
    setPredictedMigratingCurve(predicted);
    updateMigratingCurveAddress(predicted);
    await Promise.all([refreshBoardroom(boardroom.address), loadMigratingCurveAddress(predicted)]);
  };

  const cancelMigratingCurve = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const curve = requireAddress(migratingCurveAddress, "Migrating curve address");
    await submitContractTransaction(
      "Migrating curve cancel",
      buildBoardroomMigratingCurveCancelAction({ boardroom: boardroom.address, policy: factory, curve }),
    );
    await Promise.all([refreshBoardroom(boardroom.address), loadMigratingCurveAddress(curve)]);
  };

  const migrateCurve = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const curve = requireAddress(migratingCurveAddress, "Migrating curve address");
    await submitContractTransaction(
      "Migrating curve migration",
      buildBoardroomMigratingCurveMigrationAction({
        boardroom: boardroom.address,
        policy: factory,
        curve,
        minShareLiquidity: uintInput(curveMigrationForm.minShareLiquidity, "Minimum share liquidity"),
        minQuoteLiquidity: uintInput(curveMigrationForm.minQuoteLiquidity, "Minimum quote liquidity"),
        deadline: uintInput(curveMigrationForm.deadline, "Migration deadline"),
      }),
    );
    await Promise.all([refreshBoardroom(boardroom.address), loadMigratingCurveAddress(curve)]);
  };

  const lockedLiquidityTerms = (): BoardroomLockedLiquidityTerms => ({
    quoteToken: requireAddress(lockedLiquidityForm.quoteToken, "Quote token"),
    shareAmountDesired: uintInput(lockedLiquidityForm.shareAmountDesired, "Share amount desired"),
    quoteAmountDesired: uintInput(lockedLiquidityForm.quoteAmountDesired, "Quote amount desired"),
    shareAmountMin: uintInput(lockedLiquidityForm.shareAmountMin, "Share amount minimum"),
    quoteAmountMin: uintInput(lockedLiquidityForm.quoteAmountMin, "Quote amount minimum"),
    deadline: uintInput(lockedLiquidityForm.deadline, "Locked-liquidity deadline"),
    salt: requireBytes32(lockedLiquidityForm.salt, "Locked-liquidity salt"),
    shareTokenSide: lockedLiquidityForm.shareTokenSide,
  });

  const predictLockedLiquidity = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.lockedLiquidityFactory, "LockedLiquidityFactory");
    const { salt } = lockedLiquidityTerms();
    const predicted = await sdkPredictLockedLiquidityAddress(publicClient, { factory, boardroom: boardroom.address, salt });
    setPredictedLockedLiquidity(predicted);
    updateLockedLiquidityAddress(predicted);
    pushLog(`Predicted locked-liquidity position ${predicted}`, "success");
  };

  const loadLockedLiquidityAddress = async (address?: Address): Promise<LockedLiquidityState> => {
    const locker = address ?? requireAddress(lockedLiquidityAddress, "Locked-liquidity address");
    const snapshot = await readLockedLiquidityState(publicClient, locker);
    setLockedLiquiditySnapshot(snapshot);
    setLockedLiquidityAddress(locker);
    return snapshot;
  };

  const loadLockedLiquidity = async (): Promise<void> => {
    const locker = requireAddress(lockedLiquidityAddress, "Locked-liquidity address");
    await loadLockedLiquidityAddress(locker);
    pushLog(`Loaded locked-liquidity position ${locker}`, "success");
  };

  const createLockedLiquidity = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.lockedLiquidityFactory, "LockedLiquidityFactory");
    const terms = lockedLiquidityTerms();
    const predicted = await sdkPredictLockedLiquidityAddress(publicClient, { factory, boardroom: boardroom.address, salt: terms.salt });
    await submitContractTransaction(
      "Locked-liquidity creation",
      buildBoardroomLockedLiquidityBatch({
        boardroom: boardroom.address,
        factory,
        shareToken: boardroom.shareToken,
        terms,
      }),
    );
    setPredictedLockedLiquidity(predicted);
    updateLockedLiquidityAddress(predicted);
    await Promise.all([refreshBoardroom(boardroom.address), loadLockedLiquidityAddress(predicted)]);
  };

  const claimLockedLiquidityFees = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.lockedLiquidityFactory, "LockedLiquidityFactory");
    const locker = requireAddress(lockedLiquidityAddress, "Locked-liquidity address");
    await submitContractTransaction(
      "Locked-liquidity fee claim",
      buildBoardroomLockedLiquidityFeeClaimAction({ boardroom: boardroom.address, policy: factory, locker }),
    );
    await Promise.all([refreshBoardroom(boardroom.address), loadLockedLiquidityAddress(locker)]);
  };

  const exitLockedLiquidity = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const locker = requireAddress(lockedLiquidityAddress, "Locked-liquidity address");
    await submitContractTransaction(
      "Locked-liquidity exit",
      buildBoardroomLockedLiquidityExitTransaction({
        boardroom: boardroom.address,
        locker,
        amountAMin: uintInput(lockedLiquidityExitForm.amountAMin, "Exit amount A minimum"),
        amountBMin: uintInput(lockedLiquidityExitForm.amountBMin, "Exit amount B minimum"),
        deadline: uintInput(lockedLiquidityExitForm.deadline, "Exit deadline"),
      }),
    );
    await Promise.all([refreshBoardroom(boardroom.address), loadLockedLiquidityAddress(locker)]);
  };

  const startWindDown = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    await submitContractTransaction("Boardroom wind-down start", buildBoardroomStartWindDownTransaction({ boardroom: boardroom.address }));
    await refreshBoardroom(boardroom.address);
  };

  const burnTreasuryShares = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    await submitContractTransaction("Treasury share burn", buildBoardroomBurnTreasurySharesTransaction({ boardroom: boardroom.address }));
    await refreshBoardroom(boardroom.address);
  };

  const registerRedeemableAsset = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const asset = requireAddress(windDownForm.redeemableAsset, "Redeemable asset");
    await submitContractTransaction(
      "Redeemable asset registration",
      buildBoardroomRegisterRedeemableAssetTransaction({ boardroom: boardroom.address, asset }),
    );
    await refreshBoardroom(boardroom.address);
  };

  const openRedemptions = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    await submitContractTransaction("Boardroom redemptions open", buildBoardroomOpenRedemptionsTransaction({ boardroom: boardroom.address }));
    await refreshBoardroom(boardroom.address);
  };

  const redeemBoardroomShares = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const recipient = windDownForm.redeemRecipient.trim()
      ? requireAddress(windDownForm.redeemRecipient, "Redemption recipient")
      : activeAccount();
    const minAmountsOut = parseMinAmountsOut(windDownForm.minAmountsOut, boardroom.redeemableAssets.length);
    await submitContractTransaction(
      "Boardroom share redemption",
      buildBoardroomRedeemTransaction({
        boardroom: boardroom.address,
        shares: uintInput(windDownForm.redeemShares, "Redeem shares"),
        recipient,
        minAmountsOut,
      }),
    );
    await refreshBoardroom(boardroom.address);
  };

  const scanDiscoveryFrom = async (fromBlock: bigint): Promise<void> => {
    if (!wallet.account) throw new Error("Connect wallet first.");
    if (!deployment) throw new Error("Load a deployment artifact first.");

    const toBlock = parseDiscoveryToBlock(discoveryForm.toBlock);
    const chunkSize = uintInput(discoveryForm.chunkSize, "Chunk size");
    const range = { fromBlock, toBlock, chunkSize };
    const knownGrants = discoveryItems(discovery.grantsByAddress);

    const [boardroomResult, grantResult] = await Promise.all([
      deployment.boardroomFactory
        ? discoverBoardrooms(publicClient, {
            ...range,
            factory: deployment.boardroomFactory,
            owner: wallet.account,
          })
        : emptyDiscoveryResult<DiscoveredBoardroom>(),
      deployment.tokenGrantFactory
        ? discoverGrantHistory(publicClient, {
            ...range,
            factory: deployment.tokenGrantFactory,
            knownGrants,
          })
        : emptyDiscoveryResult<DiscoveredGrant>(knownGrants),
    ]);

    const boardroomsByAddress = mergeAddressMap(discovery.boardroomsByAddress, boardroomResult.items, (item) => item.boardroom);
    const discoveredBoardrooms = discoveryItems(boardroomsByAddress);
    const boardroomKeys = new Set(discoveredBoardrooms.map((boardroom) => addressMapKey(boardroom.boardroom)));
    const shareTokenKeys = new Set(discoveredBoardrooms.map((boardroom) => addressMapKey(boardroom.shareToken)));

    const [distributionResult, lockerResult, poolResult] = await Promise.all([
      deployment.distributionFactory
        ? discoverBoardroomDistributions(publicClient, { ...range, factory: deployment.distributionFactory })
        : emptyDiscoveryResult<DiscoveredDistribution>(),
      deployment.lockedLiquidityFactory
        ? discoverBoardroomLockedLiquidity(publicClient, { ...range, factory: deployment.lockedLiquidityFactory })
        : emptyDiscoveryResult<DiscoveredLockedLiquidity>(),
      deployment.ammFactory
        ? discoverPools(publicClient, { ...range, factory: deployment.ammFactory })
        : emptyDiscoveryResult<DiscoveredPool>(),
    ]);

    const relevantDistributions = distributionResult.items.filter((distribution) =>
      boardroomKeys.has(addressMapKey(distribution.boardroom)),
    );
    const relevantLockers = lockerResult.items.filter((locker) => boardroomKeys.has(addressMapKey(locker.boardroom)));
    const lockerPoolKeys = new Set(relevantLockers.map((locker) => addressMapKey(locker.pool)));
    const relevantPools = poolResult.items.filter(
      (pool) =>
        shareTokenKeys.has(addressMapKey(pool.token0))
        || shareTokenKeys.has(addressMapKey(pool.token1))
        || lockerPoolKeys.has(addressMapKey(pool.pool)),
    );

    const results = [boardroomResult, grantResult, distributionResult, lockerResult, poolResult] satisfies DiscoveryResult<unknown>[];
    const next: DiscoverySnapshot = {
      chainId: ACTIVE_CHAIN_ID,
      loadedFor: wallet.account,
      fromBlock: discovery.fromBlock !== undefined && discovery.fromBlock < fromBlock ? discovery.fromBlock : fromBlock,
      toBlock,
      chunkSize,
      complete: results.every((result) => result.complete),
      errors: discoveryErrors(results),
      boardroomsByAddress,
      grantsByAddress: mergeAddressMap(discovery.grantsByAddress, grantResult.items, (item) => item.grantAddress),
      distributionsByAddress: mergeAddressMap(discovery.distributionsByAddress, relevantDistributions, (item) => item.distribution),
      lockersByAddress: mergeAddressMap(discovery.lockersByAddress, relevantLockers, (item) => item.locker),
      poolsByAddress: mergeAddressMap(discovery.poolsByAddress, relevantPools, (item) => item.pool),
    };
    const lastScannedBlock = combineDiscoveryLastScanned(results);
    if (lastScannedBlock !== undefined) {
      next.lastScannedBlock = lastScannedBlock;
    }

    setDiscovery(next);
    saveDiscoverySnapshot(discoveryKey, next);
    pushLog(
      `Discovery scanned ${shortAddress(wallet.account)}: ${boardroomResult.items.length} boardrooms, ${grantResult.items.length} grants, ${relevantDistributions.length} distributions, ${relevantLockers.length} lockers.`,
      next.complete ? "success" : "error",
    );
  };

  const scanDiscovery = async (): Promise<void> => {
    await scanDiscoveryFrom(uintInput(discoveryForm.fromBlock, "From block"));
  };

  const resumeDiscovery = async (): Promise<void> => {
    if (discovery.lastScannedBlock === undefined) throw new Error("No cached discovery range to resume.");
    const nextFromBlock = discovery.lastScannedBlock + 1n;
    setDiscoveryForm((current) => ({ ...current, fromBlock: nextFromBlock.toString() }));
    await scanDiscoveryFrom(nextFromBlock);
  };

  const clearDiscovery = (): void => {
    clearDiscoverySnapshot(discoveryKey);
    setDiscovery(emptyDiscoverySnapshot());
    pushLog("Cleared discovery cache.", "success");
  };

  const inspectDiscoveredGrant = useCallback(
    (grant: Address): void => {
      updateGrantAddress(grant);
      setActiveTab("grant");
    },
    [updateGrantAddress],
  );

  const useDiscoveredBoardroom = useCallback(
    (boardroom: Address): void => {
      updateBoardroomAddress(boardroom);
      setActiveTab("boardroom");
    },
    [updateBoardroomAddress],
  );

  const useDiscoveredDistribution = useCallback(
    (distribution: DiscoveredDistribution): void => {
      updateBoardroomAddress(distribution.boardroom);
      if (distribution.kind === "migrating-bonding-curve") {
        updateMigratingCurveAddress(distribution.distribution);
      } else {
        updateFixedPriceSaleAddress(distribution.distribution);
      }
      setActiveTab("boardroom");
    },
    [updateBoardroomAddress, updateFixedPriceSaleAddress, updateMigratingCurveAddress],
  );

  const useDiscoveredLockedLiquidity = useCallback(
    (locker: DiscoveredLockedLiquidity): void => {
      updateBoardroomAddress(locker.boardroom);
      updateLockedLiquidityAddress(locker.locker);
      setActiveTab("boardroom");
    },
    [updateBoardroomAddress, updateLockedLiquidityAddress],
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
              Discovery
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
              curveMigrationForm={curveMigrationForm}
              deployment={deployment}
              fixedPriceSaleAddress={fixedPriceSaleAddress}
              fixedPriceSaleForm={fixedPriceSaleForm}
              fixedPriceSaleSnapshot={fixedPriceSaleSnapshot}
              lockedLiquidityAddress={lockedLiquidityAddress}
              lockedLiquidityExitForm={lockedLiquidityExitForm}
              lockedLiquidityForm={lockedLiquidityForm}
              lockedLiquiditySnapshot={lockedLiquiditySnapshot}
              migratingCurveAddress={migratingCurveAddress}
              migratingCurveForm={migratingCurveForm}
              migratingCurveSnapshot={migratingCurveSnapshot}
              pendingAction={pendingAction}
              predictedBoardroom={predictedBoardroom}
              predictedBoardroomGrant={predictedBoardroomGrant}
              predictedFixedPriceSale={predictedFixedPriceSale}
              predictedLockedLiquidity={predictedLockedLiquidity}
              predictedMigratingCurve={predictedMigratingCurve}
              setBoardroomAddress={updateBoardroomAddress}
              setBoardroomForm={setBoardroomForm}
              setBoardroomGrantForm={setBoardroomGrantForm}
              setBoardroomMintAmount={setBoardroomMintAmount}
              setBoardroomMintTo={setBoardroomMintTo}
              setCurveMigrationForm={setCurveMigrationForm}
              setFixedPriceSaleAddress={updateFixedPriceSaleAddress}
              setFixedPriceSaleForm={setFixedPriceSaleForm}
              setLockedLiquidityAddress={updateLockedLiquidityAddress}
              setLockedLiquidityExitForm={setLockedLiquidityExitForm}
              setLockedLiquidityForm={setLockedLiquidityForm}
              setMigratingCurveAddress={updateMigratingCurveAddress}
              setMigratingCurveForm={setMigratingCurveForm}
              setPredictedBoardroom={setPredictedBoardroom}
              setWindDownForm={setWindDownForm}
              windDownForm={windDownForm}
              boardroomApproveFactory={boardroomApproveFactory}
              boardroomCreateGrant={boardroomCreateGrant}
              boardroomCreateGrantBatch={boardroomCreateGrantBatch}
              burnTreasuryShares={burnTreasuryShares}
              cancelFixedPriceSale={cancelFixedPriceSale}
              cancelMigratingCurve={cancelMigratingCurve}
              claimLockedLiquidityFees={claimLockedLiquidityFees}
              closeFixedPriceSale={closeFixedPriceSale}
              createBoardroom={createBoardroom}
              createFixedPriceSale={createFixedPriceSale}
              createLockedLiquidity={createLockedLiquidity}
              createMigratingCurve={createMigratingCurve}
              exitLockedLiquidity={exitLockedLiquidity}
              loadFixedPriceSale={loadFixedPriceSale}
              loadLockedLiquidity={loadLockedLiquidity}
              loadMigratingCurve={loadMigratingCurve}
              loadBoardroom={loadBoardroom}
              migrateCurve={migrateCurve}
              mintBoardroomShares={mintBoardroomShares}
              openRedemptions={openRedemptions}
              predictBoardroom={predictBoardroom}
              predictBoardroomGrantAddress={predictBoardroomGrantAddress}
              predictFixedPriceSale={predictFixedPriceSale}
              predictLockedLiquidity={predictLockedLiquidity}
              predictMigratingCurve={predictMigratingCurve}
              redeemBoardroomShares={redeemBoardroomShares}
              registerRedeemableAsset={registerRedeemableAsset}
              runAction={runAction}
              startWindDown={startWindDown}
            />
          ) : null}

          {activeTab === "my-grants" ? (
            <DiscoveryPanel
              account={wallet.account}
              deployment={deployment}
              discovery={discovery}
              discoveryForm={discoveryForm}
              pendingAction={pendingAction}
              setDiscoveryForm={setDiscoveryForm}
              clearDiscovery={clearDiscovery}
              inspectGrant={inspectDiscoveredGrant}
              scanDiscovery={scanDiscovery}
              resumeDiscovery={resumeDiscovery}
              useBoardroom={useDiscoveredBoardroom}
              useDistribution={useDiscoveredDistribution}
              useLockedLiquidity={useDiscoveredLockedLiquidity}
              runAction={runAction}
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}
