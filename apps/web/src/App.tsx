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
} from "@pledge.cash/sdk";
import { useCallback, useEffect, useState } from "react";
import type { Hex } from "viem";
import { TabButton } from "./components/shell";
import { BoardroomPanel } from "./features/boardrooms/boardroom-panel";
import { ProductBoardroomDashboard } from "./features/boardrooms/product-boardroom-dashboard";
import { ArtifactPanel, DeploymentPanel } from "./features/deployment/deployment-panel";
import { DiscoveryPanel } from "./features/discovery/discovery-panel";
import { DirectGrantPanel } from "./features/grants/direct-grant-panel";
import { GrantInspector } from "./features/grants/grant-inspector";
import { LogPanel } from "./features/logs/log-panel";
import { SwapPanel } from "./features/swap/swap-panel";
import { AppHeader } from "./features/wallet/app-header";
import { WalletPanel } from "./features/wallet/wallet-panel";
import { useActionRunner } from "./hooks/use-action-runner";
import { useFactorySnapshot } from "./hooks/use-factory-snapshot";
import { useRuntimeDeployment } from "./hooks/use-runtime-deployment";
import { useWalletConnection } from "./hooks/use-wallet-connection";
import { readBoardroomSnapshot } from "./lib/boardroom-snapshot";
import { ACTIVE_CHAIN_ID, ACTIVE_CHAIN_NAME, chain, publicClient } from "./lib/contracts";
import {
  addressMapKey,
  clearDiscoverySnapshot,
  combineDiscoveryLastScanned,
  discoveryErrors,
  discoveryItems,
  discoveryStorageKey,
  emptyDiscoverySnapshot,
  emptyDiscoveryResult,
  loadDiscoverySnapshot,
  mergeAddressMap,
  parseDiscoveryToBlock,
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
} from "./lib/forms";
import {
  loadProductBoardroomSeed,
  readProductBoardroomDashboard,
  resolveProductBoardroomAddress,
  type ProductBoardroomDashboardState,
  type ProductBoardroomSeed,
} from "./lib/product-boardroom";
import {
  buildSwapTransaction,
  defaultSwapForm,
  readSwapTokenList,
  readSwapQuote,
  withSwapSeedDefaults,
  type SwapForm,
  type SwapQuoteState,
  type SwapTokenListState,
} from "./lib/swap";
import { parseTokenAmountInput, readTokenMetadata, type TokenMetadata } from "./lib/token-amounts";
import { contractCallPreview } from "./lib/transaction-preview";
import type {
  BoardroomForm,
  BoardroomGrantForm,
  BoardroomSnapshot,
  CurveMigrationForm,
  DiscoveryForm,
  DiscoverySnapshot,
  FixedPriceSaleForm,
  GrantForm,
  GrantSnapshot,
  LockedLiquidityExitForm,
  LockedLiquidityForm,
  MigratingCurveForm,
  Tab,
  WindDownForm,
} from "./lib/types";

export { parseDeployment } from "./lib/deployment";

type GrantIssuerAction = "stopVestingAndWithdrawUnvested" | "withdrawExpiredTokens";
type AppView = Tab | "product-boardroom" | "swap";

async function parseMinAmountsOut(value: string, assets: readonly Address[]): Promise<bigint[]> {
  const trimmed = value.trim();
  if (!trimmed) return Array.from({ length: assets.length }, () => 0n);

  const values = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
  if (values.length !== assets.length) {
    throw new Error(`Minimum amounts must include ${assets.length} comma-separated values.`);
  }

  return await Promise.all(
    values.map(async (part, index) => {
      const asset = assets[index];
      if (!asset) throw new Error(`Missing redeemable asset for minimum amount ${index + 1}.`);
      return parseErc20Amount(part, asset, `Minimum amount ${index + 1}`);
    }),
  );
}

function defaultDiscoveryForm(): DiscoveryForm {
  return {
    fromBlock: "0",
    toBlock: "",
    chunkSize: "5000",
    includeClosedGrants: false,
  };
}

function initialView(): AppView {
  if (typeof window === "undefined") return "direct";
  return viewFromPath(window.location.pathname);
}

function viewFromPath(pathname: string): AppView {
  const base = import.meta.env.BASE_URL || "/";
  const relative = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\/+/, "");
  if (relative === "boardroom" || relative.startsWith("boardroom/")) return "product-boardroom";
  if (relative === "swap" || relative.startsWith("swap/")) return "swap";
  return "direct";
}

function viewHref(view: AppView): string {
  const base = import.meta.env.BASE_URL || "/";
  if (view === "product-boardroom") return `${base}boardroom`;
  if (view === "swap") return `${base}swap`;
  return base;
}

async function parseErc20Amount(value: string, token: Address, label: string): Promise<bigint> {
  return parseTokenAmountInput(value, await readRequiredTokenMetadata(token, label), label);
}

async function parsePaymentAmount(value: string, token: Address, label: string): Promise<bigint> {
  if (isZeroDecimalInput(value)) return 0n;
  if (isZeroAddress(token)) throw new Error(`${label} requires a payment token.`);
  return await parseErc20Amount(value, token, label);
}

async function readRequiredTokenMetadata(token: Address, label: string): Promise<TokenMetadata> {
  const metadata = await readTokenMetadata(publicClient, token);
  if (metadata.decimals === undefined) {
    const reason = metadata.error ? ` ${metadata.error}` : "";
    throw new Error(`${label} token decimals could not be read.${reason}`);
  }
  return metadata;
}

function isZeroDecimalInput(value: string): boolean {
  const normalized = value.trim().replace(/,/g, "");
  return normalized === "" || /^0+(?:\.0*)?$/.test(normalized);
}

export function App(): React.JSX.Element {
  const generatedDeployment = getPledgeCashDeployment(ACTIVE_CHAIN_ID);
  const deployment = useRuntimeDeployment(ACTIVE_CHAIN_ID, generatedDeployment);
  const { clearLogs, logs, pendingAction, pushLog, runAction } = useActionRunner();
  const [activeView, setActiveView] = useState<AppView>(() => initialView());
  const [grantForm, setGrantForm] = useState<GrantForm>(() => defaultGrantForm());
  const [predictedGrant, setPredictedGrant] = useState<Address>();
  const [grantAddress, setGrantAddress] = useState("");
  const [grantSnapshot, setGrantSnapshot] = useState<GrantSnapshot>();
  const [settleAmount, setSettleAmount] = useState("1");
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
  const [boardroomMintAmount, setBoardroomMintAmount] = useState("1");
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
  const [productBoardroom, setProductBoardroom] = useState<ProductBoardroomDashboardState>();
  const [productSeed, setProductSeed] = useState<ProductBoardroomSeed>();
  const [productBoardroomError, setProductBoardroomError] = useState<string>();
  const [productBoardroomLoading, setProductBoardroomLoading] = useState(false);
  const [swapForm, setSwapForm] = useState<SwapForm>(() => defaultSwapForm());
  const [swapQuote, setSwapQuote] = useState<SwapQuoteState>();
  const [swapTokenList, setSwapTokenList] = useState<SwapTokenListState>(() => ({ tokens: [], pools: [], loaded: false }));
  const [swapTokenListLoading, setSwapTokenListLoading] = useState(false);
  const [swapSeedLoaded, setSwapSeedLoaded] = useState(false);

  useEffect(() => {
    const syncView = (): void => setActiveView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", syncView);
    return () => window.removeEventListener("popstate", syncView);
  }, []);

  const navigateView = useCallback((view: AppView): void => {
    setActiveView(view);
    if (typeof window === "undefined") return;
    const href = viewHref(view);
    if (window.location.pathname !== href) {
      window.history.pushState({}, "", href);
    }
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

  const { activeAccount, connectWallet, switchChain, wallet, walletClient } = useWalletConnection({
    onAccountChanged: clearDirectGrantPrediction,
    pushLog,
  });
  const factorySnapshot = useFactorySnapshot(deployment, pushLog);
  const creationFee = factorySnapshot.creationFee ?? deployment?.creationFee ?? 0n;
  const discoveryKey = discoveryStorageKey(ACTIVE_CHAIN_ID, wallet.account);

  const loadProductBoardroom = useCallback(async (): Promise<void> => {
    setProductBoardroomLoading(true);
    setProductBoardroomError(undefined);
    try {
      const seed = await loadProductBoardroomSeed(ACTIVE_CHAIN_ID);
      setProductSeed(seed);
      const address = resolveProductBoardroomAddress(seed);
      if (!address) {
        throw new Error("No product Boardroom address is configured for this chain.");
      }
      const next = await readProductBoardroomDashboard(publicClient, { address, seed });
      setProductBoardroom(next);
      pushLog(`Loaded product Boardroom ${address}`, "success");
    } catch (error) {
      const message = errorMessage(error);
      setProductBoardroomError(message);
      pushLog(message, "error");
    } finally {
      setProductBoardroomLoading(false);
    }
  }, [pushLog]);

  useEffect(() => {
    setDiscovery(loadDiscoverySnapshot(discoveryKey));
  }, [discoveryKey]);

  useEffect(() => {
    if (activeView !== "product-boardroom" || productBoardroom || productBoardroomError || productBoardroomLoading) return;
    void loadProductBoardroom();
  }, [activeView, loadProductBoardroom, productBoardroom, productBoardroomError, productBoardroomLoading]);

  useEffect(() => {
    if (activeView !== "swap" || swapSeedLoaded) return;
    if (productSeed) {
      setSwapForm((current) => withSwapSeedDefaults(current, productSeed, deployment));
      setSwapSeedLoaded(true);
      return;
    }

    let cancelled = false;
    void loadProductBoardroomSeed(ACTIVE_CHAIN_ID)
      .then((seed) => {
        if (cancelled) return;
        setProductSeed(seed);
        setSwapForm((current) => withSwapSeedDefaults(current, seed, deployment));
      })
      .catch((error) => pushLog(errorMessage(error), "error"))
      .finally(() => {
        if (!cancelled) setSwapSeedLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [activeView, deployment, productSeed, pushLog, swapSeedLoaded]);

  useEffect(() => {
    setSwapQuote(undefined);
  }, [swapForm]);

  const loadSwapTokens = useCallback(async (): Promise<void> => {
    setSwapTokenListLoading(true);
    try {
      const seed = productSeed ?? await loadProductBoardroomSeed(ACTIVE_CHAIN_ID);
      if (!productSeed) setProductSeed(seed);
      const next = await readSwapTokenList(publicClient, deployment, seed, wallet.account);
      setSwapTokenList(next);
      setSwapForm((current) => withSwapSeedDefaults(current, seed, deployment));
      if (next.error) {
        pushLog(`Swap token list: ${next.error}`, next.tokens.length > 0 ? "info" : "error");
      } else {
        pushLog(`Loaded ${next.tokens.length.toString()} swap tokens across ${next.pools.length.toString()} pools`, "success");
      }
    } catch (error) {
      const message = errorMessage(error);
      setSwapTokenList({ tokens: [], pools: [], loaded: true, error: message });
      pushLog(message, "error");
    } finally {
      setSwapTokenListLoading(false);
    }
  }, [deployment, productSeed, pushLog, wallet.account]);

  useEffect(() => {
    if (activeView !== "swap" || !swapSeedLoaded) return;
    void loadSwapTokens();
  }, [activeView, loadSwapTokens, swapSeedLoaded]);

  useEffect(() => {
    if (!wallet.account || boardroomForm.owner) return;
    setBoardroomForm((current) => ({ ...current, owner: wallet.account ?? current.owner }));
  }, [boardroomForm.owner, wallet.account]);

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

  const refreshBoardroom = async (address?: Address): Promise<BoardroomSnapshot> => {
    const boardroom = address ?? boardroomSnapshot?.address ?? requireAddress(boardroomAddress, "Boardroom address");
    const snapshot = await readBoardroomSnapshot(publicClient, boardroom);
    setBoardroomSnapshot(snapshot);
    setBoardroomMintTo((current) => current || snapshot.address);
    return snapshot;
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

  const refreshSwapQuote = async (): Promise<void> => {
    const next = await readSwapQuote(publicClient, deployment, swapForm, wallet.account);
    setSwapQuote(next);
    if (next.error) {
      pushLog(next.error, next.error.startsWith("No AMM pool") ? "info" : "error");
      return;
    }
    pushLog("Loaded swap quote", "success");
  };

  const requireFreshSwapQuote = async (): Promise<SwapQuoteState> => {
    const next = await readSwapQuote(publicClient, deployment, swapForm, wallet.account);
    setSwapQuote(next);
    if (next.error) throw new Error(next.error);
    return next;
  };

  const approveSwapInput = async (): Promise<void> => {
    activeAccount();
    const router = requireDeploymentAddress(deployment?.ammRouter, "AMM router");
    const quote = await requireFreshSwapQuote();
    if (!quote.tokenIn || quote.amountIn === undefined) throw new Error("Refresh the swap quote before approving.");

    await submitContractTransaction("Swap input approval", buildErc20Approval({ token: quote.tokenIn.address, spender: router, amount: quote.amountIn }));
  };

  const executeSwap = async (): Promise<void> => {
    const account = activeAccount();
    const quote = await requireFreshSwapQuote();
    await submitContractTransaction("Swap", buildSwapTransaction({ deployment, form: swapForm, quote, account }));
    await refreshSwapQuote();
  };

  const directGrantTerms = async (): Promise<GrantCreationTerms> => {
    const holder = requireAddress(grantForm.holder, "Holder");
    const token = requireAddress(grantForm.token, "Grant token");
    const paymentToken = optionalPaymentToken(grantForm.paymentToken);
    const [amount, price] = await Promise.all([
      parseErc20Amount(grantForm.amount, token, "Amount"),
      parsePaymentAmount(grantForm.price, paymentToken, "Price"),
    ]);
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
    const { salt } = await directGrantTerms();

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
    const { token, amount } = await directGrantTerms();

    await submitContractTransaction("Escrow approval", buildErc20Approval({ token, spender: factory, amount }));
  };

  const createGrant = async (): Promise<void> => {
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const terms = await directGrantTerms();
    await submitContractTransaction(
      "Grant creation",
      buildDirectGrantCreationTransaction({ factory, terms, creationFee }),
    );
  };

  const loadGrant = async (): Promise<void> => {
    const grant = requireAddress(grantAddress, "Grant address");
    const now = BigInt(Math.floor(Date.now() / 1000));
    const snapshot = await readGrantState(publicClient, grant, now);
    const [tokenMetadata, paymentTokenMetadata] = await Promise.all([
      readTokenMetadata(publicClient, snapshot.token),
      isZeroAddress(snapshot.paymentToken) ? undefined : readTokenMetadata(publicClient, snapshot.paymentToken),
    ]);

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
      tokenMetadata,
      paymentTokenMetadata,
    });
    pushLog(`Loaded grant ${grant}`, "success");
  };

  const approvePayment = async (): Promise<void> => {
    if (!grantSnapshot) throw new Error("Load a grant first.");
    const grant = requireAddress(grantAddress, "Grant address");
    if (grantSnapshot.address.toLowerCase() !== grant.toLowerCase()) throw new Error("Reload the grant after changing the address.");
    if (isZeroAddress(grantSnapshot.paymentToken)) throw new Error("Selected grant has no payment token.");

    const amount = await parseErc20Amount(paymentApproval, grantSnapshot.paymentToken, "Payment approval");
    await submitContractTransaction(
      "Payment approval",
      buildErc20Approval({ token: grantSnapshot.paymentToken, spender: grantSnapshot.address, amount }),
    );
  };

  const settleGrant = async (): Promise<void> => {
    const grant = requireAddress(grantAddress, "Grant address");
    const snapshot =
      grantSnapshot && grantSnapshot.address.toLowerCase() === grant.toLowerCase()
        ? grantSnapshot
        : await readGrantState(publicClient, grant);
    const amount = await parseErc20Amount(settleAmount, snapshot.token, "Settle amount");
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
    const shareToken = boardroomSnapshot?.address.toLowerCase() === boardroom.toLowerCase()
      ? boardroomSnapshot.shareToken
      : (await readBoardroomState(publicClient, boardroom)).shareToken;
    const amount = await parseErc20Amount(boardroomMintAmount, shareToken, "Mint amount");
    await submitContractTransaction("Share mint", buildBoardroomMintTransaction({ boardroom, to, amount }));
    await refreshBoardroom(boardroom);
  };

  const boardroomShareGrantTerms = async (): Promise<BoardroomShareGrantTerms> => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    const holder = requireAddress(boardroomGrantForm.holder, "Grant holder");
    const paymentToken = optionalPaymentToken(boardroomGrantForm.paymentToken);
    const [amount, price] = await Promise.all([
      parseErc20Amount(boardroomGrantForm.amount, boardroomSnapshot.shareToken, "Grant amount"),
      parsePaymentAmount(boardroomGrantForm.price, paymentToken, "Grant price"),
    ]);
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
    const { salt } = await boardroomShareGrantTerms();
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
    const assetPolicy = requireDeploymentAddress(deployment?.assetPolicy, "AssetPolicy");
    const { amount } = await boardroomShareGrantTerms();
    await submitContractTransaction(
      "Boardroom approval",
      buildBoardroomExecuteTransaction({
        boardroom: boardroomSnapshot.address,
        call: buildBoardroomGrantApprovalCall({
          policy: assetPolicy,
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
    const protocolPolicy = requireDeploymentAddress(deployment?.protocolPolicy ?? factory, "ProtocolPolicy");
    const terms = await boardroomShareGrantTerms();
    const predicted = await sdkPredictBoardroomGrantAddress(publicClient, {
      factory,
      boardroom: boardroomSnapshot.address,
      salt: terms.salt,
    });
    await submitContractTransaction(
      "Boardroom grant creation",
      buildBoardroomExecuteTransaction({
        boardroom: boardroomSnapshot.address,
        call: buildBoardroomGrantCreationCall({
          policy: protocolPolicy,
          factory,
          terms: { ...terms, token: boardroomSnapshot.shareToken },
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
    const protocolPolicy = requireDeploymentAddress(deployment?.protocolPolicy ?? factory, "ProtocolPolicy");
    const assetPolicy = requireDeploymentAddress(deployment?.assetPolicy, "AssetPolicy");
    const terms = await boardroomShareGrantTerms();
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
        policy: protocolPolicy,
        assetPolicy,
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

  const fixedPriceSaleTerms = async (boardroom: BoardroomSnapshot): Promise<BoardroomFixedPriceSaleTerms> => {
    const paymentToken = requireAddress(fixedPriceSaleForm.paymentToken, "Payment token");
    const [shareAmount, price, maxPerBuyer] = await Promise.all([
      parseErc20Amount(fixedPriceSaleForm.shareAmount, boardroom.shareToken, "Sale share amount"),
      parseErc20Amount(fixedPriceSaleForm.price, paymentToken, "Sale price"),
      parseErc20Amount(fixedPriceSaleForm.maxPerBuyer, boardroom.shareToken, "Max per buyer"),
    ]);

    return {
      paymentToken,
      shareAmount,
      price,
      maxPerBuyer,
      startTime: uintInput(fixedPriceSaleForm.startTime, "Sale start time"),
      endTime: uintInput(fixedPriceSaleForm.endTime, "Sale end time"),
      salt: requireBytes32(fixedPriceSaleForm.salt, "Sale salt"),
    };
  };

  const predictFixedPriceSale = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const { salt } = await fixedPriceSaleTerms(boardroom);
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
    const protocolPolicy = requireDeploymentAddress(deployment?.protocolPolicy ?? factory, "ProtocolPolicy");
    const assetPolicy = requireDeploymentAddress(deployment?.assetPolicy, "AssetPolicy");
    const terms = await fixedPriceSaleTerms(boardroom);
    const predicted = await sdkPredictFixedPriceSaleAddress(publicClient, { factory, boardroom: boardroom.address, salt: terms.salt });
    await submitContractTransaction(
      "Fixed-price sale creation",
      buildBoardroomFixedPriceSaleBatch({
        boardroom: boardroom.address,
        factory,
        shareToken: boardroom.shareToken,
        terms,
        policy: protocolPolicy,
        assetPolicy,
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

  const migratingCurveTerms = async (boardroom: BoardroomSnapshot): Promise<BoardroomMigratingBondingCurveTerms> => {
    const quoteToken = requireAddress(migratingCurveForm.quoteToken, "Quote token");
    const quoteToLpBps = uintInput(migratingCurveForm.quoteToLpBps, "Quote-to-LP bps");
    if (quoteToLpBps > 10_000n) throw new Error("Quote-to-LP bps must be at most 10000.");
    const [saleSupply, migrationSupply, basePrice, slope, graduationQuoteTarget] = await Promise.all([
      parseErc20Amount(migratingCurveForm.saleSupply, boardroom.shareToken, "Curve sale supply"),
      parseErc20Amount(migratingCurveForm.migrationSupply, boardroom.shareToken, "Curve migration supply"),
      parseErc20Amount(migratingCurveForm.basePrice, quoteToken, "Curve base price"),
      parseErc20Amount(migratingCurveForm.slope, quoteToken, "Curve slope"),
      parseErc20Amount(migratingCurveForm.graduationQuoteTarget, quoteToken, "Graduation quote target"),
    ]);

    return {
      quoteToken,
      saleSupply,
      migrationSupply,
      basePrice,
      slope,
      graduationQuoteTarget,
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
    const { salt } = await migratingCurveTerms(boardroom);
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
    const protocolPolicy = requireDeploymentAddress(deployment?.protocolPolicy ?? factory, "ProtocolPolicy");
    const assetPolicy = requireDeploymentAddress(deployment?.assetPolicy, "AssetPolicy");
    const terms = await migratingCurveTerms(boardroom);
    const predicted = await sdkPredictMigratingBondingCurveAddress(publicClient, { factory, boardroom: boardroom.address, salt: terms.salt });
    await submitContractTransaction(
      "Migrating curve creation",
      buildBoardroomMigratingCurveBatch({
        boardroom: boardroom.address,
        factory,
        shareToken: boardroom.shareToken,
        terms,
        policy: protocolPolicy,
        assetPolicy,
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
    const curveState =
      migratingCurveSnapshot && migratingCurveSnapshot.address.toLowerCase() === curve.toLowerCase()
        ? migratingCurveSnapshot
        : await readMigratingBondingCurveState(publicClient, curve);
    const [minShareLiquidity, minQuoteLiquidity] = await Promise.all([
      parseErc20Amount(curveMigrationForm.minShareLiquidity, curveState.shareToken, "Minimum share liquidity"),
      parseErc20Amount(curveMigrationForm.minQuoteLiquidity, curveState.quoteToken, "Minimum quote liquidity"),
    ]);
    await submitContractTransaction(
      "Migrating curve migration",
      buildBoardroomMigratingCurveMigrationAction({
        boardroom: boardroom.address,
        policy: factory,
        curve,
        minShareLiquidity,
        minQuoteLiquidity,
        deadline: uintInput(curveMigrationForm.deadline, "Migration deadline"),
      }),
    );
    await Promise.all([refreshBoardroom(boardroom.address), loadMigratingCurveAddress(curve)]);
  };

  const lockedLiquidityTerms = async (boardroom: BoardroomSnapshot): Promise<BoardroomLockedLiquidityTerms> => {
    const quoteToken = requireAddress(lockedLiquidityForm.quoteToken, "Quote token");
    const [shareAmountDesired, quoteAmountDesired, shareAmountMin, quoteAmountMin] = await Promise.all([
      parseErc20Amount(lockedLiquidityForm.shareAmountDesired, boardroom.shareToken, "Share amount desired"),
      parseErc20Amount(lockedLiquidityForm.quoteAmountDesired, quoteToken, "Quote amount desired"),
      parseErc20Amount(lockedLiquidityForm.shareAmountMin, boardroom.shareToken, "Share amount minimum"),
      parseErc20Amount(lockedLiquidityForm.quoteAmountMin, quoteToken, "Quote amount minimum"),
    ]);

    return {
      quoteToken,
      shareAmountDesired,
      quoteAmountDesired,
      shareAmountMin,
      quoteAmountMin,
      deadline: uintInput(lockedLiquidityForm.deadline, "Locked-liquidity deadline"),
      salt: requireBytes32(lockedLiquidityForm.salt, "Locked-liquidity salt"),
      shareTokenSide: lockedLiquidityForm.shareTokenSide,
    };
  };

  const predictLockedLiquidity = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.lockedLiquidityFactory, "LockedLiquidityFactory");
    const { salt } = await lockedLiquidityTerms(boardroom);
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
    const protocolPolicy = requireDeploymentAddress(deployment?.protocolPolicy ?? factory, "ProtocolPolicy");
    const assetPolicy = requireDeploymentAddress(deployment?.assetPolicy, "AssetPolicy");
    const terms = await lockedLiquidityTerms(boardroom);
    const predicted = await sdkPredictLockedLiquidityAddress(publicClient, { factory, boardroom: boardroom.address, salt: terms.salt });
    await submitContractTransaction(
      "Locked-liquidity creation",
      buildBoardroomLockedLiquidityBatch({
        boardroom: boardroom.address,
        factory,
        shareToken: boardroom.shareToken,
        terms,
        policy: protocolPolicy,
        assetPolicy,
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
    const lockerState =
      lockedLiquiditySnapshot && lockedLiquiditySnapshot.address.toLowerCase() === locker.toLowerCase()
        ? lockedLiquiditySnapshot
        : await readLockedLiquidityState(publicClient, locker);
    const [amountAMin, amountBMin] = await Promise.all([
      parseErc20Amount(lockedLiquidityExitForm.amountAMin, lockerState.tokenA, "Exit amount A minimum"),
      parseErc20Amount(lockedLiquidityExitForm.amountBMin, lockerState.tokenB, "Exit amount B minimum"),
    ]);
    await submitContractTransaction(
      "Locked-liquidity exit",
      buildBoardroomLockedLiquidityExitTransaction({
        boardroom: boardroom.address,
        locker,
        amountAMin,
        amountBMin,
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
    const [shares, minAmountsOut] = await Promise.all([
      parseErc20Amount(windDownForm.redeemShares, boardroom.shareToken, "Redeem shares"),
      parseMinAmountsOut(windDownForm.minAmountsOut, boardroom.redeemableAssets),
    ]);
    await submitContractTransaction(
      "Boardroom share redemption",
      buildBoardroomRedeemTransaction({
        boardroom: boardroom.address,
        shares,
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
      navigateView("grant");
    },
    [navigateView, updateGrantAddress],
  );

  const useDiscoveredBoardroom = useCallback(
    (boardroom: Address): void => {
      updateBoardroomAddress(boardroom);
      navigateView("boardroom");
    },
    [navigateView, updateBoardroomAddress],
  );

  const useDiscoveredDistribution = useCallback(
    (distribution: DiscoveredDistribution): void => {
      updateBoardroomAddress(distribution.boardroom);
      if (distribution.kind === "migrating-bonding-curve") {
        updateMigratingCurveAddress(distribution.distribution);
      } else {
        updateFixedPriceSaleAddress(distribution.distribution);
      }
      navigateView("boardroom");
    },
    [navigateView, updateBoardroomAddress, updateFixedPriceSaleAddress, updateMigratingCurveAddress],
  );

  const useDiscoveredLockedLiquidity = useCallback(
    (locker: DiscoveredLockedLiquidity): void => {
      updateBoardroomAddress(locker.boardroom);
      updateLockedLiquidityAddress(locker.locker);
      navigateView("boardroom");
    },
    [navigateView, updateBoardroomAddress, updateLockedLiquidityAddress],
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
          <LogPanel logs={logs} clearLogs={clearLogs} />
          <ArtifactPanel deployment={deployment} />
        </aside>

        <section className="min-w-0 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <TabButton active={activeView === "product-boardroom"} onClick={() => navigateView("product-boardroom")}>
              Product Boardroom
            </TabButton>
            <TabButton active={activeView === "swap"} onClick={() => navigateView("swap")}>
              Swap
            </TabButton>
            <TabButton active={activeView === "direct"} onClick={() => navigateView("direct")}>
              Direct Grant
            </TabButton>
            <TabButton active={activeView === "grant"} onClick={() => navigateView("grant")}>
              Inspect Grant
            </TabButton>
            <TabButton active={activeView === "boardroom"} onClick={() => navigateView("boardroom")}>
              Boardroom Tools
            </TabButton>
            <TabButton active={activeView === "discovery"} onClick={() => navigateView("discovery")}>
              Discovery
            </TabButton>
          </div>

          {activeView === "product-boardroom" ? (
            <ProductBoardroomDashboard
              dashboard={productBoardroom}
              error={productBoardroomError}
              loading={productBoardroomLoading}
              pendingAction={pendingAction}
              inspectGrant={inspectDiscoveredGrant}
              openTools={(boardroom) => {
                updateBoardroomAddress(boardroom);
                void refreshBoardroom(boardroom);
                navigateView("boardroom");
              }}
              refresh={loadProductBoardroom}
              runAction={runAction}
            />
          ) : null}

          {activeView === "swap" ? (
            <SwapPanel
              account={wallet.account}
              deployment={deployment}
              form={swapForm}
              pendingAction={pendingAction}
              quote={swapQuote}
              setForm={setSwapForm}
              tokenList={swapTokenList}
              tokenListLoading={swapTokenListLoading}
              approveInput={approveSwapInput}
              executeSwap={executeSwap}
              refreshQuote={refreshSwapQuote}
              refreshTokens={loadSwapTokens}
              runAction={runAction}
            />
          ) : null}

          {activeView === "direct" ? (
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

          {activeView === "grant" ? (
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

          {activeView === "boardroom" ? (
            <BoardroomPanel
              boardroom={{
                address: boardroomAddress,
                form: boardroomForm,
                mintAmount: boardroomMintAmount,
                mintTo: boardroomMintTo,
                predicted: predictedBoardroom,
                snapshot: boardroomSnapshot,
                create: createBoardroom,
                load: loadBoardroom,
                mintShares: mintBoardroomShares,
                predict: predictBoardroom,
                setBoardroomAddress: updateBoardroomAddress,
                setBoardroomForm,
                setBoardroomMintAmount,
                setBoardroomMintTo,
                setPredictedBoardroom,
              }}
              fixedPriceSale={{
                address: fixedPriceSaleAddress,
                form: fixedPriceSaleForm,
                predicted: predictedFixedPriceSale,
                snapshot: fixedPriceSaleSnapshot,
                cancel: cancelFixedPriceSale,
                close: closeFixedPriceSale,
                create: createFixedPriceSale,
                load: loadFixedPriceSale,
                predict: predictFixedPriceSale,
                setFixedPriceSaleAddress: updateFixedPriceSaleAddress,
                setFixedPriceSaleForm,
              }}
              grant={{
                form: boardroomGrantForm,
                predicted: predictedBoardroomGrant,
                approveFactory: boardroomApproveFactory,
                clearPrediction: clearBoardroomGrantPrediction,
                create: boardroomCreateGrant,
                createBatch: boardroomCreateGrantBatch,
                predict: predictBoardroomGrantAddress,
                setForm: setBoardroomGrantForm,
              }}
              lockedLiquidity={{
                address: lockedLiquidityAddress,
                exitForm: lockedLiquidityExitForm,
                form: lockedLiquidityForm,
                predicted: predictedLockedLiquidity,
                snapshot: lockedLiquiditySnapshot,
                claimFees: claimLockedLiquidityFees,
                create: createLockedLiquidity,
                exit: exitLockedLiquidity,
                load: loadLockedLiquidity,
                predict: predictLockedLiquidity,
                setLockedLiquidityAddress: updateLockedLiquidityAddress,
                setLockedLiquidityExitForm,
                setLockedLiquidityForm,
              }}
              migratingCurve={{
                address: migratingCurveAddress,
                form: migratingCurveForm,
                migrationForm: curveMigrationForm,
                predicted: predictedMigratingCurve,
                snapshot: migratingCurveSnapshot,
                cancel: cancelMigratingCurve,
                create: createMigratingCurve,
                load: loadMigratingCurve,
                migrate: migrateCurve,
                predict: predictMigratingCurve,
                setCurveMigrationForm,
                setMigratingCurveAddress: updateMigratingCurveAddress,
                setMigratingCurveForm,
              }}
              windDown={{
                form: windDownForm,
                burnTreasuryShares,
                openRedemptions,
                redeemShares: redeemBoardroomShares,
                registerRedeemableAsset,
                setForm: setWindDownForm,
                start: startWindDown,
              }}
              workflow={{ deployment, pendingAction, runAction }}
            />
          ) : null}

          {activeView === "discovery" ? (
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
