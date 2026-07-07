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
  type PledgeCashDeployment,
} from "@pledge.cash/sdk";
import {
  Activity,
  ArrowDownUp,
  Compass,
  KeyRound,
  RefreshCw,
  Settings2,
  Wrench,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Hex, PublicClient } from "viem";
import { ActionButton, AddressLink, Facts, Panel, TabButton, WorkspaceHeader } from "./components/shell";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { BoardroomPanel } from "./features/boardrooms/boardroom-panel";
import { ProductBoardroomDashboard } from "./features/boardrooms/product-boardroom-dashboard";
import { ArtifactPanel, DeploymentPanel } from "./features/deployment/deployment-panel";
import { DiscoveryPanel, WalletAccessPanel } from "./features/discovery/discovery-panel";
import { DirectGrantPanel } from "./features/grants/direct-grant-panel";
import { GrantInspector } from "./features/grants/grant-inspector";
import { LogPanel } from "./features/logs/log-panel";
import { SwapPanel } from "./features/swap/swap-panel";
import { AppHeader } from "./features/wallet/app-header";
import { WalletPanel } from "./features/wallet/wallet-panel";
import { useActionRunner } from "./hooks/use-action-runner";
import { useFactorySnapshot } from "./hooks/use-factory-snapshot";
import { useRuntimeDeployment } from "./hooks/use-runtime-deployment";
import { useWagmiWallet } from "./hooks/use-wagmi-wallet";
import { readBoardroomSnapshot } from "./lib/boardroom-snapshot";
import {
  PLEDGE_CASH_NETWORKS,
  createPledgeCashPublicClient,
  initialSelectedNetwork,
  networkForChainId,
  persistSelectedNetwork,
  syncSelectedNetworkSearch,
} from "./lib/contracts";
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
  readProductBoardroomCatalog,
  readProductBoardroomDashboard,
  resolveProductBoardroomAddress,
  type ProductBoardroomDashboardState,
} from "./lib/product-boardroom";
import {
  buildAddLiquidityTransaction,
  buildClaimAmmFeesTransaction,
  buildRemoveLiquidityTransaction,
  buildSwapTransaction,
  defaultLiquidityForm,
  defaultRemoveLiquidityForm,
  defaultSwapForm,
  pairHasWrappedNative,
  readAmmPosition,
  readLiquidityQuote,
  readRemoveLiquidityQuote,
  readSwapTokenList,
  readSwapQuote,
  swapNativeMode,
  withLiquidityTokenListDefaults,
  withSwapTokenListDefaults,
  type AmmPositionState,
  type LiquidityForm,
  type LiquidityQuoteState,
  type RemoveLiquidityForm,
  type RemoveLiquidityQuoteState,
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
  FactorySnapshot,
  FixedPriceSaleForm,
  GrantForm,
  GrantSnapshot,
  LogEntry,
  LockedLiquidityExitForm,
  LockedLiquidityForm,
  MigratingCurveForm,
  WindDownForm,
  WalletState,
} from "./lib/types";

export { parseDeployment } from "./lib/deployment";

type GrantIssuerAction = "stopVestingAndWithdrawUnvested" | "withdrawExpiredTokens";
type AppView = "project" | "market" | "wallet" | "grants" | "manage" | "activity" | "advanced";
export type GrantIssuerBoardroomAccess = { boardroom: Address; owner: Address };

async function parseMinAmountsOut(client: PublicClient, value: string, assets: readonly Address[]): Promise<bigint[]> {
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
      return parseErc20Amount(client, part, asset, `Minimum amount ${index + 1}`);
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
  if (typeof window === "undefined") return "project";
  return viewFromPath(window.location.pathname);
}

export function viewFromPath(pathname: string): AppView {
  const base = import.meta.env.BASE_URL || "/";
  const relative = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\/+/, "");
  const segment = relative.split("/")[0] || "project";
  if (segment === "boardroom" || segment === "project") return "project";
  if (segment === "swap" || segment === "market") return "market";
  if (segment === "positions" || segment === "wallet" || segment === "portfolio") return "wallet";
  if (segment === "grant" || segment === "grants") return "grants";
  if (segment === "manage" || segment === "boardroom-tools") return "manage";
  if (segment === "activity") return "activity";
  if (segment === "advanced" || segment === "tools" || segment === "direct" || segment === "discovery") return "advanced";
  return "project";
}

function viewHref(view: AppView): string {
  const base = import.meta.env.BASE_URL || "/";
  const search = typeof window === "undefined" ? "" : window.location.search;
  const path = view === "project" ? "project" : view === "advanced" ? "tools" : view;
  return `${base}${path}${search}`;
}

function viewUsesProjectDashboard(view: AppView): boolean {
  return view === "project" || view === "manage" || view === "activity";
}

async function parseErc20Amount(client: PublicClient, value: string, token: Address, label: string): Promise<bigint> {
  return parseTokenAmountInput(value, await readRequiredTokenMetadata(client, token, label), label);
}

async function parsePaymentAmount(client: PublicClient, value: string, token: Address, label: string): Promise<bigint> {
  if (isZeroDecimalInput(value)) return 0n;
  if (isZeroAddress(token)) throw new Error(`${label} requires a payment token.`);
  return await parseErc20Amount(client, value, token, label);
}

async function readRequiredTokenMetadata(client: PublicClient, token: Address, label: string): Promise<TokenMetadata> {
  const metadata = await readTokenMetadata(client, token);
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
  const { clearLogs, logs, pendingAction, pushLog, runAction } = useActionRunner();
  const [selectedChainId, setSelectedChainId] = useState(() => initialSelectedNetwork().chainId);
  const activeNetwork = useMemo(() => networkForChainId(selectedChainId), [selectedChainId]);
  const networkRequestVersion = useRef(0);
  const activeChainIdRef = useRef(activeNetwork.chainId);
  activeChainIdRef.current = activeNetwork.chainId;
  const publicClient = useMemo(() => createPledgeCashPublicClient(activeNetwork), [activeNetwork]);
  const chain = activeNetwork.chain;
  const generatedDeployment = getPledgeCashDeployment(activeNetwork.chainId);
  const deployment = useRuntimeDeployment(activeNetwork.chainId, generatedDeployment);
  const [activeView, setActiveView] = useState<AppView>(() => initialView());
  const [grantForm, setGrantForm] = useState<GrantForm>(() => defaultGrantForm());
  const [predictedGrant, setPredictedGrant] = useState<Address>();
  const [grantAddress, setGrantAddress] = useState("");
  const [grantSnapshot, setGrantSnapshot] = useState<GrantSnapshot>();
  const [grantIssuerBoardroom, setGrantIssuerBoardroom] = useState<GrantIssuerBoardroomAccess>();
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
  const [loadedDiscoveryKey, setLoadedDiscoveryKey] = useState<string | undefined>();
  const autoDiscoveryKeyRef = useRef<string | undefined>(undefined);
  const [productBoardroom, setProductBoardroom] = useState<ProductBoardroomDashboardState>();
  const [productBoardroomError, setProductBoardroomError] = useState<string>();
  const [productBoardroomLoading, setProductBoardroomLoading] = useState(false);
  const [swapForm, setSwapForm] = useState<SwapForm>(() => defaultSwapForm());
  const [swapQuote, setSwapQuote] = useState<SwapQuoteState>();
  const [liquidityForm, setLiquidityForm] = useState<LiquidityForm>(() => defaultLiquidityForm());
  const [liquidityQuote, setLiquidityQuote] = useState<LiquidityQuoteState>();
  const [removeLiquidityForm, setRemoveLiquidityForm] = useState<RemoveLiquidityForm>(() => defaultRemoveLiquidityForm());
  const [removeLiquidityQuote, setRemoveLiquidityQuote] = useState<RemoveLiquidityQuoteState>();
  const [ammPosition, setAmmPosition] = useState<AmmPositionState>();
  const [swapTokenList, setSwapTokenList] = useState<SwapTokenListState>(() => ({ tokens: [], pools: [], loaded: false }));
  const [swapTokenListLoading, setSwapTokenListLoading] = useState(false);

  const syncSelectedChainFromLocation = useCallback((): void => {
    const nextChainId = initialSelectedNetwork().chainId;
    setSelectedChainId((currentChainId) => (currentChainId === nextChainId ? currentChainId : nextChainId));
  }, []);

  useEffect(() => {
    if (pendingAction) return;
    syncSelectedChainFromLocation();
  }, [pendingAction, syncSelectedChainFromLocation]);

  useEffect(() => {
    const syncView = (): void => {
      setActiveView(viewFromPath(window.location.pathname));
      if (!pendingAction) syncSelectedChainFromLocation();
    };
    window.addEventListener("popstate", syncView);
    return () => window.removeEventListener("popstate", syncView);
  }, [pendingAction, syncSelectedChainFromLocation]);

  const navigateView = useCallback((view: AppView): void => {
    setActiveView(view);
    if (typeof window === "undefined") return;
    const href = viewHref(view);
    if (`${window.location.pathname}${window.location.search}` !== href) {
      window.history.pushState({}, "", href);
    }
  }, []);

  const updateGrantAddress = useCallback((address: string): void => {
    setGrantAddress(address);
    setGrantSnapshot(undefined);
    setGrantIssuerBoardroom(undefined);
  }, []);

  const clearDirectGrantPrediction = useCallback((): void => {
    if (predictedGrant && grantAddress.toLowerCase() === predictedGrant.toLowerCase()) {
      updateGrantAddress("");
    }
    setPredictedGrant(undefined);
  }, [grantAddress, predictedGrant, updateGrantAddress]);

  const selectNetwork = useCallback(
    (chainId: number): void => {
      const nextNetwork = networkForChainId(chainId);
      setSelectedChainId(nextNetwork.chainId);
      persistSelectedNetwork(nextNetwork.chainId);
      syncSelectedNetworkSearch(nextNetwork.chainId);
      pushLog(`Selected ${nextNetwork.name}`, "info");
    },
    [pushLog],
  );

  const { activeAccount, switchChain, wallet, walletClient } = useWagmiWallet({
    network: activeNetwork,
    onAccountChanged: clearDirectGrantPrediction,
    pushLog,
  });
  const factorySnapshot = useFactorySnapshot(publicClient, deployment, pushLog);
  const creationFee = factorySnapshot.creationFee ?? deployment?.creationFee ?? 0n;
  const discoveryKey = discoveryStorageKey(activeNetwork.chainId, wallet.account);

  useEffect(() => {
    networkRequestVersion.current += 1;
  }, [activeNetwork.chainId]);

  const isCurrentNetworkRequest = useCallback(
    (version: number, chainId: number): boolean =>
      networkRequestVersion.current === version && activeChainIdRef.current === chainId,
    [],
  );

  useEffect(() => {
    persistSelectedNetwork(activeNetwork.chainId);
  }, [activeNetwork.chainId]);

  useEffect(() => {
    setPredictedGrant(undefined);
    setGrantAddress("");
    setGrantSnapshot(undefined);
    setGrantIssuerBoardroom(undefined);
    setPaymentApproval("0");
    setPredictedBoardroom(undefined);
    setBoardroomAddress("");
    setBoardroomSnapshot(undefined);
    setBoardroomMintTo("");
    setPredictedBoardroomGrant(undefined);
    setFixedPriceSaleAddress("");
    setFixedPriceSaleSnapshot(undefined);
    setPredictedFixedPriceSale(undefined);
    setMigratingCurveAddress("");
    setMigratingCurveSnapshot(undefined);
    setPredictedMigratingCurve(undefined);
    setLockedLiquidityAddress("");
    setLockedLiquiditySnapshot(undefined);
    setPredictedLockedLiquidity(undefined);
    setDiscovery(emptyDiscoverySnapshot());
    setProductBoardroom(undefined);
    setProductBoardroomError(undefined);
    setProductBoardroomLoading(false);
    setSwapForm(defaultSwapForm());
    setSwapQuote(undefined);
    setLiquidityForm(defaultLiquidityForm());
    setLiquidityQuote(undefined);
    setRemoveLiquidityForm(defaultRemoveLiquidityForm());
    setRemoveLiquidityQuote(undefined);
    setAmmPosition(undefined);
    setSwapTokenList({ tokens: [], pools: [], loaded: false });
    setSwapTokenListLoading(false);
  }, [activeNetwork.chainId]);

  const loadProductBoardroom = useCallback(async (): Promise<void> => {
    const requestVersion = networkRequestVersion.current;
    const requestChainId = activeNetwork.chainId;
    setProductBoardroomLoading(true);
    setProductBoardroomError(undefined);
    try {
      if (!deployment?.boardroomFactory) {
        throw new Error("Runtime deployment is still loading for this chain.");
      }
      const catalog = await readProductBoardroomCatalog(publicClient, deployment);
      if (!isCurrentNetworkRequest(requestVersion, requestChainId)) return;
      const address = resolveProductBoardroomAddress(catalog);
      if (!address) {
        throw new Error("No product Boardroom address is configured for this chain.");
      }
      const next = await readProductBoardroomDashboard(publicClient, { address, catalog, deployment });
      if (!isCurrentNetworkRequest(requestVersion, requestChainId)) return;
      setProductBoardroom(next);
      pushLog(`Loaded product Boardroom ${address}`, "success");
    } catch (error) {
      if (!isCurrentNetworkRequest(requestVersion, requestChainId)) return;
      const message = errorMessage(error);
      setProductBoardroomError(message);
      pushLog(message, "error");
    } finally {
      if (isCurrentNetworkRequest(requestVersion, requestChainId)) setProductBoardroomLoading(false);
    }
  }, [activeNetwork.chainId, deployment, isCurrentNetworkRequest, publicClient, pushLog]);

  useEffect(() => {
    setDiscovery(loadDiscoverySnapshot(discoveryKey));
    setLoadedDiscoveryKey(discoveryKey);
  }, [discoveryKey]);

  useEffect(() => {
    if (!viewUsesProjectDashboard(activeView) || !deployment?.boardroomFactory || productBoardroom || productBoardroomError || productBoardroomLoading) return;
    void loadProductBoardroom();
  }, [activeView, deployment?.boardroomFactory, loadProductBoardroom, productBoardroom, productBoardroomError, productBoardroomLoading]);

  useEffect(() => {
    setSwapQuote(undefined);
  }, [swapForm]);

  useEffect(() => {
    setLiquidityQuote(undefined);
    setRemoveLiquidityQuote(undefined);
  }, [liquidityForm]);

  useEffect(() => {
    setRemoveLiquidityQuote(undefined);
  }, [removeLiquidityForm]);

  useEffect(() => {
    if (!pairHasWrappedNative(deployment, swapForm.tokenIn, swapForm.tokenOut) && swapForm.useNative) {
      setSwapForm((current) => ({ ...current, useNative: false }));
    }
    if (pairHasWrappedNative(deployment, liquidityForm.tokenA, liquidityForm.tokenB)) return;
    if (liquidityForm.useNative) {
      setLiquidityForm((current) => ({ ...current, useNative: false }));
    }
    if (removeLiquidityForm.useNative) {
      setRemoveLiquidityForm((current) => ({ ...current, useNative: false }));
    }
  }, [deployment, liquidityForm.tokenA, liquidityForm.tokenB, liquidityForm.useNative, removeLiquidityForm.useNative, swapForm.tokenIn, swapForm.tokenOut, swapForm.useNative]);

  const loadSwapTokens = useCallback(async (): Promise<void> => {
    const requestVersion = networkRequestVersion.current;
    const requestChainId = activeNetwork.chainId;
    setSwapTokenListLoading(true);
    try {
      if (!deployment?.ammFactory) {
        throw new Error("Runtime deployment is still loading for this chain.");
      }
      const next = await readSwapTokenList(publicClient, deployment, wallet.account, { wrappedNativeLabel: activeNetwork.wrappedNativeSymbol });
      if (!isCurrentNetworkRequest(requestVersion, requestChainId)) return;
      setSwapTokenList(next);
      setSwapForm((current) => withSwapTokenListDefaults(current, next, deployment));
      setLiquidityForm((current) => withLiquidityTokenListDefaults(current, next, deployment));
      if (next.error) {
        pushLog(`Swap token list: ${next.error}`, next.tokens.length > 0 ? "info" : "error");
      } else {
        pushLog(`Loaded ${next.tokens.length.toString()} swap tokens across ${next.pools.length.toString()} pools`, "success");
      }
    } catch (error) {
      const message = errorMessage(error);
      if (!isCurrentNetworkRequest(requestVersion, requestChainId)) return;
      setSwapTokenList({ tokens: [], pools: [], loaded: true, error: message });
      pushLog(message, "error");
    } finally {
      if (isCurrentNetworkRequest(requestVersion, requestChainId)) setSwapTokenListLoading(false);
    }
  }, [activeNetwork.chainId, activeNetwork.wrappedNativeSymbol, deployment, isCurrentNetworkRequest, publicClient, pushLog, wallet.account]);

  useEffect(() => {
    if (activeView !== "market" || !deployment?.ammFactory || swapTokenList.loaded || swapTokenListLoading) return;
    void loadSwapTokens();
  }, [activeView, deployment?.ammFactory, loadSwapTokens, swapTokenList.loaded, swapTokenListLoading]);

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
    const txChainId = activeNetwork.chainId;
    pushLog(contractCallPreview(label, request), "info");
    const hash = (await client.writeContract({
      account: activeAccount(),
      chain,
      ...request,
    } as unknown as Parameters<typeof client.writeContract>[0])) as Hex;

    pushLog(`${label} submitted`, "info", hash, txChainId);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      pushLog(`${label} failed`, "error", hash, txChainId);
      throw new Error(`${label} failed after submission.`);
    }

    pushLog(`${label} confirmed`, "success", hash, txChainId);
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

  const requireFreshAllowance = (label: string, allowance: bigint | undefined, amount: bigint | undefined): void => {
    if (amount === undefined) throw new Error(`Refresh the ${label} quote before submitting.`);
    if (allowance === undefined || allowance < amount) {
      throw new Error(`${label} approval is below the latest quote. Approve again before submitting.`);
    }
  };

  const liquidityTokenUsesNative = (token: Address | undefined): boolean =>
    Boolean(liquidityForm.useNative && deployment?.wrappedNative && token && token.toLowerCase() === deployment.wrappedNative.toLowerCase());

  const approveSwapInput = async (): Promise<void> => {
    activeAccount();
    const router = requireDeploymentAddress(deployment?.ammRouter, "AMM router");
    const quote = await requireFreshSwapQuote();
    if (!quote.tokenIn || quote.amountIn === undefined) throw new Error("Refresh the swap quote before approving.");
    if (swapNativeMode(deployment, swapForm) === "input") throw new Error("Native swap input does not need ERC20 approval.");

    await submitContractTransaction("Swap input approval", buildErc20Approval({ token: quote.tokenIn.address, spender: router, amount: quote.amountIn }));
  };

  const executeSwap = async (): Promise<void> => {
    const account = activeAccount();
    const quote = await requireFreshSwapQuote();
    if (swapNativeMode(deployment, swapForm) !== "input") {
      requireFreshAllowance("Swap input", quote.tokenIn?.allowance, quote.amountIn);
    }
    await submitContractTransaction("Swap", buildSwapTransaction({ deployment, form: swapForm, quote, account }));
    await refreshSwapQuote();
  };

  const refreshLiquidityQuote = async (): Promise<void> => {
    const next = await readLiquidityQuote(publicClient, deployment, liquidityForm, wallet.account);
    setLiquidityQuote(next);
    const position = await readAmmPosition(publicClient, deployment, liquidityForm.tokenA, liquidityForm.tokenB, wallet.account);
    setAmmPosition(position);
    if (next.error) {
      pushLog(next.error, next.error.includes("No AMM pool") ? "info" : "error");
      return;
    }
    pushLog("Loaded liquidity quote", "success");
  };

  const requireFreshLiquidityQuote = async (): Promise<LiquidityQuoteState> => {
    const next = await readLiquidityQuote(publicClient, deployment, liquidityForm, wallet.account);
    setLiquidityQuote(next);
    if (next.error) throw new Error(next.error);
    return next;
  };

  const approveLiquidityTokenA = async (): Promise<void> => {
    activeAccount();
    const router = requireDeploymentAddress(deployment?.ammRouter, "AMM router");
    const quote = await requireFreshLiquidityQuote();
    if (!quote.tokenA || quote.amountA === undefined) throw new Error("Refresh the liquidity quote before approving token A.");
    await submitContractTransaction("Liquidity token A approval", buildErc20Approval({ token: quote.tokenA.address, spender: router, amount: quote.amountA }));
  };

  const approveLiquidityTokenB = async (): Promise<void> => {
    activeAccount();
    const router = requireDeploymentAddress(deployment?.ammRouter, "AMM router");
    const quote = await requireFreshLiquidityQuote();
    if (!quote.tokenB || quote.amountB === undefined) throw new Error("Refresh the liquidity quote before approving token B.");
    await submitContractTransaction("Liquidity token B approval", buildErc20Approval({ token: quote.tokenB.address, spender: router, amount: quote.amountB }));
  };

  const addLiquidity = async (): Promise<void> => {
    const account = activeAccount();
    const quote = await requireFreshLiquidityQuote();
    if (!liquidityTokenUsesNative(quote.tokenA?.address)) {
      requireFreshAllowance("Liquidity token A", quote.tokenA?.allowance, quote.amountA);
    }
    if (!liquidityTokenUsesNative(quote.tokenB?.address)) {
      requireFreshAllowance("Liquidity token B", quote.tokenB?.allowance, quote.amountB);
    }
    await submitContractTransaction("Add liquidity", buildAddLiquidityTransaction({ deployment, form: liquidityForm, quote, account }));
    await Promise.all([refreshLiquidityQuote(), loadSwapTokens()]);
  };

  const refreshAmmPosition = async (): Promise<void> => {
    const next = await readAmmPosition(publicClient, deployment, liquidityForm.tokenA, liquidityForm.tokenB, wallet.account);
    setAmmPosition(next);
    if (next?.error) {
      pushLog(next.error, "error");
      return;
    }
    pushLog("Loaded AMM LP position", "success");
  };

  const refreshRemoveLiquidityQuote = async (): Promise<void> => {
    const next = await readRemoveLiquidityQuote(publicClient, deployment, liquidityForm, removeLiquidityForm, wallet.account);
    setRemoveLiquidityQuote(next);
    if (next.position) setAmmPosition(next.position);
    if (next.error) {
      pushLog(next.error, next.error.includes("No AMM pool") ? "info" : "error");
      return;
    }
    pushLog("Loaded remove-liquidity quote", "success");
  };

  const requireFreshRemoveLiquidityQuote = async (): Promise<RemoveLiquidityQuoteState> => {
    const next = await readRemoveLiquidityQuote(publicClient, deployment, liquidityForm, removeLiquidityForm, wallet.account);
    setRemoveLiquidityQuote(next);
    if (next.position) setAmmPosition(next.position);
    if (next.error) throw new Error(next.error);
    return next;
  };

  const approveLpToken = async (): Promise<void> => {
    activeAccount();
    const router = requireDeploymentAddress(deployment?.ammRouter, "AMM router");
    const quote = await requireFreshRemoveLiquidityQuote();
    if (!quote.position?.pool || quote.liquidity === undefined) throw new Error("Refresh the remove-liquidity quote before approving LP.");
    await submitContractTransaction("LP token approval", buildErc20Approval({ token: quote.position.pool.address, spender: router, amount: quote.liquidity }));
  };

  const removeLiquidity = async (): Promise<void> => {
    const account = activeAccount();
    const quote = await requireFreshRemoveLiquidityQuote();
    requireFreshAllowance("LP token", quote.position?.lpAllowance, quote.liquidity);
    await submitContractTransaction("Remove liquidity", buildRemoveLiquidityTransaction({ deployment, form: removeLiquidityForm, quote, account }));
    await Promise.all([refreshAmmPosition(), refreshLiquidityQuote()]);
  };

  const claimAmmFees = async (): Promise<void> => {
    activeAccount();
    const position = await readAmmPosition(publicClient, deployment, liquidityForm.tokenA, liquidityForm.tokenB, wallet.account);
    if (!position) throw new Error("Select a pool before claiming fees.");
    await submitContractTransaction("AMM fee claim", buildClaimAmmFeesTransaction(position));
    await refreshAmmPosition();
  };

  const directGrantTerms = async (): Promise<GrantCreationTerms> => {
    const holder = requireAddress(grantForm.holder, "Holder");
    const token = requireAddress(grantForm.token, "Grant token");
    const paymentToken = optionalPaymentToken(grantForm.paymentToken);
    const [amount, price] = await Promise.all([
      parseErc20Amount(publicClient, grantForm.amount, token, "Amount"),
      parsePaymentAmount(publicClient, grantForm.price, paymentToken, "Price"),
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
    const [tokenMetadata, paymentTokenMetadata, issuerBoardroom] = await Promise.all([
      readTokenMetadata(publicClient, snapshot.token),
      isZeroAddress(snapshot.paymentToken) ? undefined : readTokenMetadata(publicClient, snapshot.paymentToken),
      readGrantIssuerBoardroomAccess(snapshot.issuer),
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
      vestingCliff: snapshot.vestingCliff,
      vestingEnd: snapshot.vestingEnd,
      expiry: snapshot.expiry,
      settledAmount: snapshot.settledAmount,
      halted: snapshot.halted,
      closed: snapshot.closed,
      settleable: snapshot.settleable,
      tokenMetadata,
      paymentTokenMetadata,
    });
    setGrantIssuerBoardroom(issuerBoardroom);
    pushLog(`Loaded grant ${grant}`, "success");
  };

  const approvePayment = async (): Promise<void> => {
    if (!grantSnapshot) throw new Error("Load a grant first.");
    const grant = requireAddress(grantAddress, "Grant address");
    if (grantSnapshot.address.toLowerCase() !== grant.toLowerCase()) throw new Error("Reload the grant after changing the address.");
    if (isZeroAddress(grantSnapshot.paymentToken)) throw new Error("Selected grant has no payment token.");

    const amount = await parseErc20Amount(publicClient, paymentApproval, grantSnapshot.paymentToken, "Payment approval");
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
    const amount = await parseErc20Amount(publicClient, settleAmount, snapshot.token, "Settle amount");
    await submitContractTransaction("Grant settlement", {
      address: grant,
      abi: tokenGrantAbi,
      functionName: "settle",
      args: [amount],
    });
  };

  const readGrantIssuerBoardroomAccess = async (issuer: Address): Promise<GrantIssuerBoardroomAccess | undefined> => {
    try {
      const snapshot = await readBoardroomState(publicClient, issuer);
      if (isZeroAddress(snapshot.policyRegistry)) return undefined;
      return { boardroom: issuer, owner: snapshot.owner };
    } catch {
      return undefined;
    }
  };

  const isBoardroomIssuer = async (issuer: Address): Promise<boolean> => Boolean(await readGrantIssuerBoardroomAccess(issuer));

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
    const amount = await parseErc20Amount(publicClient, boardroomMintAmount, shareToken, "Mint amount");
    await submitContractTransaction("Share mint", buildBoardroomMintTransaction({ boardroom, to, amount }));
    await refreshBoardroom(boardroom);
  };

  const boardroomShareGrantTerms = async (): Promise<BoardroomShareGrantTerms> => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    const holder = requireAddress(boardroomGrantForm.holder, "Grant holder");
    const paymentToken = optionalPaymentToken(boardroomGrantForm.paymentToken);
    const [amount, price] = await Promise.all([
      parseErc20Amount(publicClient, boardroomGrantForm.amount, boardroomSnapshot.shareToken, "Grant amount"),
      parsePaymentAmount(publicClient, boardroomGrantForm.price, paymentToken, "Grant price"),
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
      parseErc20Amount(publicClient, fixedPriceSaleForm.shareAmount, boardroom.shareToken, "Sale share amount"),
      parseErc20Amount(publicClient, fixedPriceSaleForm.price, paymentToken, "Sale price"),
      parseErc20Amount(publicClient, fixedPriceSaleForm.maxPerBuyer, boardroom.shareToken, "Max per buyer"),
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
      parseErc20Amount(publicClient, migratingCurveForm.saleSupply, boardroom.shareToken, "Curve sale supply"),
      parseErc20Amount(publicClient, migratingCurveForm.migrationSupply, boardroom.shareToken, "Curve migration supply"),
      parseErc20Amount(publicClient, migratingCurveForm.basePrice, quoteToken, "Curve base price"),
      parseErc20Amount(publicClient, migratingCurveForm.slope, quoteToken, "Curve slope"),
      parseErc20Amount(publicClient, migratingCurveForm.graduationQuoteTarget, quoteToken, "Graduation quote target"),
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
      parseErc20Amount(publicClient, curveMigrationForm.minShareLiquidity, curveState.shareToken, "Minimum share liquidity"),
      parseErc20Amount(publicClient, curveMigrationForm.minQuoteLiquidity, curveState.quoteToken, "Minimum quote liquidity"),
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
      parseErc20Amount(publicClient, lockedLiquidityForm.shareAmountDesired, boardroom.shareToken, "Share amount desired"),
      parseErc20Amount(publicClient, lockedLiquidityForm.quoteAmountDesired, quoteToken, "Quote amount desired"),
      parseErc20Amount(publicClient, lockedLiquidityForm.shareAmountMin, boardroom.shareToken, "Share amount minimum"),
      parseErc20Amount(publicClient, lockedLiquidityForm.quoteAmountMin, quoteToken, "Quote amount minimum"),
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
      parseErc20Amount(publicClient, lockedLiquidityExitForm.amountAMin, lockerState.tokenA, "Exit amount A minimum"),
      parseErc20Amount(publicClient, lockedLiquidityExitForm.amountBMin, lockerState.tokenB, "Exit amount B minimum"),
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
      parseErc20Amount(publicClient, windDownForm.redeemShares, boardroom.shareToken, "Redeem shares"),
      parseMinAmountsOut(publicClient, windDownForm.minAmountsOut, boardroom.redeemableAssets),
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
      chainId: activeNetwork.chainId,
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
    autoDiscoveryKeyRef.current = wallet.account ? `${activeNetwork.chainId}:${wallet.account.toLowerCase()}` : undefined;
    clearDiscoverySnapshot(discoveryKey);
    setDiscovery(emptyDiscoverySnapshot());
    setLoadedDiscoveryKey(discoveryKey);
    pushLog("Cleared discovery cache.", "success");
  };

  useEffect(() => {
    autoDiscoveryKeyRef.current = undefined;
  }, [activeNetwork.chainId, wallet.account]);

  useEffect(() => {
    if (!wallet.account || !deployment || pendingAction) return;
    if (loadedDiscoveryKey !== discoveryKey) return;

    const key = `${activeNetwork.chainId}:${wallet.account.toLowerCase()}`;
    const loadedForCurrentWallet = Boolean(
      discovery.loadedFor
        && discovery.loadedFor.toLowerCase() === wallet.account.toLowerCase()
        && discovery.chainId === activeNetwork.chainId,
    );
    if (loadedForCurrentWallet || autoDiscoveryKeyRef.current === key) return;

    autoDiscoveryKeyRef.current = key;
    void runAction("scan-discovery", scanDiscovery);
  }, [activeNetwork.chainId, deployment, discovery.chainId, discovery.loadedFor, discoveryKey, loadedDiscoveryKey, pendingAction, runAction, scanDiscovery, wallet.account]);

  const inspectDiscoveredGrant = useCallback(
    (grant: Address): void => {
      updateGrantAddress(grant);
      navigateView("grants");
    },
    [navigateView, updateGrantAddress],
  );

  const useDiscoveredBoardroom = useCallback(
    (boardroom: Address): void => {
      updateBoardroomAddress(boardroom);
      navigateView("manage");
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
      navigateView("manage");
    },
    [navigateView, updateBoardroomAddress, updateFixedPriceSaleAddress, updateMigratingCurveAddress],
  );

  const useDiscoveredLockedLiquidity = useCallback(
    (locker: DiscoveredLockedLiquidity): void => {
      updateBoardroomAddress(locker.boardroom);
      updateLockedLiquidityAddress(locker.locker);
      navigateView("manage");
    },
    [navigateView, updateBoardroomAddress, updateLockedLiquidityAddress],
  );

  const grantIssuerActionsAvailable = canRunGrantIssuerActions(wallet.account, grantSnapshot, productBoardroom, boardroomSnapshot, grantIssuerBoardroom);
  const marketPanel = (
    <SwapPanel
      account={wallet.account}
      deployment={deployment}
      form={swapForm}
      liquidityForm={liquidityForm}
      liquidityQuote={liquidityQuote}
      position={ammPosition}
      pendingAction={pendingAction}
      quote={swapQuote}
      removeLiquidityForm={removeLiquidityForm}
      removeLiquidityQuote={removeLiquidityQuote}
      setLiquidityForm={setLiquidityForm}
      setRemoveLiquidityForm={setRemoveLiquidityForm}
      setForm={setSwapForm}
      tokenList={swapTokenList}
      tokenListLoading={swapTokenListLoading}
      wrappedNativeSymbol={activeNetwork.wrappedNativeSymbol}
      addLiquidity={addLiquidity}
      approveLiquidityTokenA={approveLiquidityTokenA}
      approveLiquidityTokenB={approveLiquidityTokenB}
      approveLpToken={approveLpToken}
      approveInput={approveSwapInput}
      claimAmmFees={claimAmmFees}
      executeSwap={executeSwap}
      refreshLiquidityQuote={refreshLiquidityQuote}
      refreshPosition={refreshAmmPosition}
      refreshQuote={refreshSwapQuote}
      refreshRemoveLiquidityQuote={refreshRemoveLiquidityQuote}
      refreshTokens={loadSwapTokens}
      removeLiquidity={removeLiquidity}
      runAction={runAction}
    />
  );
  const directGrantPanel = (
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
  );
  const grantPanel = (
    <GrantInspector
      account={wallet.account}
      grantAddress={grantAddress}
      grantSnapshot={grantSnapshot}
      issuerActionsAvailable={grantIssuerActionsAvailable}
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
  );
  const boardroomToolsPanel = (
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
  );
  const discoveryPanel = (
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
  );
  const walletAccessPanel = (
    <WalletAccessPanel
      account={wallet.account}
      deployment={deployment}
      discovery={discovery}
      discoveryForm={discoveryForm}
      pendingAction={pendingAction}
      inspectGrant={inspectDiscoveredGrant}
      scanDiscovery={scanDiscovery}
      useBoardroom={useDiscoveredBoardroom}
      useDistribution={useDiscoveredDistribution}
      useLockedLiquidity={useDiscoveredLockedLiquidity}
      runAction={runAction}
    />
  );
  const diagnosticsPanel = (
    <ProjectDiagnostics
      chainId={activeNetwork.chainId}
      creationFee={creationFee}
      deployment={deployment}
      factorySnapshot={factorySnapshot}
      wallet={wallet}
    />
  );

  return (
    <div className="min-h-svh text-zinc-100">
      <AppHeader
        wallet={wallet}
        chainId={activeNetwork.chainId}
        chainName={activeNetwork.name}
        networks={PLEDGE_CASH_NETWORKS}
        onNetworkChange={selectNetwork}
        pendingAction={pendingAction}
        runAction={runAction}
        switchChain={switchChain}
      />

      <main className="min-h-[calc(100svh-64px)]">
        <section className="mx-auto w-full max-w-[1480px] min-w-0 px-4 py-4 sm:px-6 sm:py-5">
          <ProjectContextBar
            activeView={activeView}
            chainName={activeNetwork.name}
            dashboard={productBoardroom}
            deployment={deployment}
            error={productBoardroomError}
            loading={productBoardroomLoading}
            pendingAction={pendingAction}
            wallet={wallet}
            navigateView={navigateView}
            refresh={loadProductBoardroom}
            runAction={runAction}
          />
          <WorkspaceNav activeView={activeView} navigateView={navigateView} />

          {activeView === "project" ? (
            <ProductBoardroomDashboard
              account={wallet.account}
              dashboard={productBoardroom}
              error={productBoardroomError}
              loading={productBoardroomLoading}
              pendingAction={pendingAction}
              inspectGrant={inspectDiscoveredGrant}
              openAdvanced={() => navigateView("advanced")}
              openGrants={() => navigateView("grants")}
              openManage={(boardroom) => {
                updateBoardroomAddress(boardroom);
                void refreshBoardroom(boardroom);
                navigateView("manage");
              }}
              openMarket={() => navigateView("market")}
              openTools={(boardroom) => {
                updateBoardroomAddress(boardroom);
                void refreshBoardroom(boardroom);
                navigateView("manage");
              }}
              refresh={loadProductBoardroom}
              runAction={runAction}
            />
          ) : null}

          {activeView === "market" ? (
            <>
              <WorkspaceHeader
                eyebrow="Market"
                title="Trade and Liquidity"
                description="Buy, sell, inspect pool reserves, and manage LP positions without leaving the project context."
              />
              {marketPanel}
            </>
          ) : null}

          {activeView === "wallet" ? (
            <PositionsWorkspace>{walletAccessPanel}</PositionsWorkspace>
          ) : null}

          {activeView === "grants" ? (
            <>
              <WorkspaceHeader
                eyebrow="Grants"
                title="Grant Settlement"
                description="Inspect a grant, verify holder and payment terms, then settle vested tokens from the current holder wallet."
              />
              {grantPanel}
            </>
          ) : null}

          {activeView === "manage" ? (
            <ManageWorkspace account={wallet.account} boardroomAddress={boardroomAddress} boardroomSnapshot={boardroomSnapshot}>
              {boardroomToolsPanel}
            </ManageWorkspace>
          ) : null}

          {activeView === "activity" ? (
            <ActivityWorkspace clearLogs={clearLogs} dashboard={productBoardroom} logs={logs} />
          ) : null}

          {activeView === "advanced" ? (
            <AdvancedWorkspace>
              {diagnosticsPanel}
              {directGrantPanel}
              {discoveryPanel}
            </AdvancedWorkspace>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function ProjectContextBar({
  activeView,
  chainName,
  dashboard,
  deployment,
  error,
  loading,
  pendingAction,
  wallet,
  navigateView,
  refresh,
  runAction,
}: {
  activeView: AppView;
  chainName: string;
  dashboard: ProductBoardroomDashboardState | undefined;
  deployment: PledgeCashDeployment | undefined;
  error: string | undefined;
  loading: boolean;
  pendingAction: string | undefined;
  wallet: WalletState;
  navigateView: (view: AppView) => void;
  refresh: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
}): React.JSX.Element {
  const project = projectContextSummary(wallet.account, dashboard, loading, error);
  const protocolReady = Boolean(deployment?.tokenGrantFactory);

  return (
    <section aria-label="Project context" className="mb-4 border-b border-zinc-800 pb-4 sm:pb-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(560px,0.68fr)] xl:items-end">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant={project.statusTone}>{project.statusLabel}</Badge>
            <Badge variant={project.roleTone}>{project.roleLabel}</Badge>
            <Badge variant={activeView === "advanced" ? "warning" : "muted"}>
              {activeView === "advanced" ? "Tools open" : "Project workspace"}
            </Badge>
          </div>
          <h1 className="m-0 truncate text-2xl font-semibold tracking-normal text-zinc-50 sm:text-3xl">
            {project.name}
          </h1>
          <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            See project state first. Trade, settle grants, and manage Boardrooms from job-based views; raw protocol details stay in Tools.
          </p>
        </div>

        <div className="grid gap-3">
          <dl className="grid min-w-0 grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 sm:grid-cols-3">
            <ContextMetric label="Network" value={chainName} />
            <ContextMetric label="Wallet" value={wallet.account ? shortAddress(wallet.account) : "Read-only visitor"} />
            <ContextMetric label="Protocol" value={protocolReady ? "Ready" : "Pending"} tone={protocolReady ? "strong" : "warning"} />
          </dl>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <ActionButton
              actionId="refresh-project-context"
              pendingAction={pendingAction}
              variant="secondary"
              onClick={() => void runAction("refresh-project-context", refresh)}
            >
              <RefreshCw className="h-4 w-4" />
              {loading ? "Loading" : "Refresh"}
            </ActionButton>
            <Button variant="secondary" onClick={() => navigateView("wallet")}>
              <WalletCards className="h-4 w-4" />
              Wallet
            </Button>
            <Button variant="ghost" onClick={() => navigateView("advanced")}>
              <Wrench className="h-4 w-4" />
              Tools
            </Button>
          </div>
        </div>
      </div>
      {error ? <p className="m-0 mt-3 rounded-md border border-red-950 bg-red-950/35 p-3 text-sm text-red-200">{error}</p> : null}
    </section>
  );
}

function ContextMetric({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "strong" | "warning";
  value: string;
}): React.JSX.Element {
  return (
    <div className="min-w-0 bg-zinc-950 px-3 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-normal text-zinc-500">{label}</dt>
      <dd
        className={
          tone === "warning"
            ? "m-0 mt-1 truncate text-sm font-semibold text-amber-200"
            : tone === "strong"
              ? "m-0 mt-1 truncate text-sm font-semibold text-lime-200"
              : "m-0 mt-1 truncate text-sm font-semibold text-zinc-100"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function ProjectDiagnostics({
  chainId,
  creationFee,
  deployment,
  factorySnapshot,
  wallet,
}: {
  chainId: number;
  creationFee: bigint;
  deployment: PledgeCashDeployment | undefined;
  factorySnapshot: FactorySnapshot;
  wallet: WalletState;
}): React.JSX.Element {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <DeploymentPanel
          chainId={chainId}
          creationFee={creationFee}
          deployment={deployment}
          factorySnapshot={factorySnapshot}
          localAmmProtocolFeeRecipient={deployment?.ammProtocolFeeRecipient}
        />
        <WalletPanel wallet={wallet} />
      </div>
      <ArtifactPanel deployment={deployment} />
    </div>
  );
}

function projectContextSummary(
  account: Address | undefined,
  dashboard: ProductBoardroomDashboardState | undefined,
  loading: boolean,
  error: string | undefined,
): {
  name: string;
  roleLabel: string;
  roleTone: "default" | "muted" | "warning";
  statusLabel: string;
  statusTone: "default" | "muted" | "warning" | "danger";
} {
  const catalogEntry = dashboard?.catalog.find((entry) => sameAddress(entry.address, dashboard.address));
  const name = catalogEntry?.name ?? catalogEntry?.symbol ?? "Project workspace";
  const role = projectContextRole(account, dashboard);

  if (error) {
    return { name, ...role, statusLabel: "Needs attention", statusTone: "danger" };
  }
  if (dashboard?.snapshot) {
    return { name, ...role, statusLabel: boardroomStatusText(dashboard.snapshot.status), statusTone: dashboard.snapshot.status === 0 ? "default" : "warning" };
  }
  if (loading) {
    return { name, ...role, statusLabel: "Loading project", statusTone: "muted" };
  }
  return { name, ...role, statusLabel: "Read-only mode", statusTone: "muted" };
}

function projectContextRole(
  account: Address | undefined,
  dashboard: ProductBoardroomDashboardState | undefined,
): {
  roleLabel: string;
  roleTone: "default" | "muted" | "warning";
} {
  if (!account) return { roleLabel: "Read-only visitor", roleTone: "muted" };
  if (!dashboard?.snapshot) return { roleLabel: "Wallet connected", roleTone: "muted" };
  if (sameAddress(account, dashboard.snapshot.owner)) return { roleLabel: "Owner wallet", roleTone: "default" };
  if (dashboard.snapshot.grantSummaries.some((grant) => sameAddress(grant.state?.holder, account))) {
    return { roleLabel: "Grant holder", roleTone: "default" };
  }
  if (dashboard.snapshot.grantSummaries.some((grant) => sameAddress(grant.state?.issuer, account))) {
    return { roleLabel: "Grant issuer", roleTone: "warning" };
  }
  return { roleLabel: "Buyer / holder view", roleTone: "muted" };
}

function WorkspaceNav({
  activeView,
  navigateView,
}: {
  activeView: AppView;
  navigateView: (view: AppView) => void;
}): React.JSX.Element {
  const items: { view: AppView; label: string; icon: ReactNode }[] = [
    { view: "project", label: "Overview", icon: <Compass className="h-4 w-4" /> },
    { view: "market", label: "Market", icon: <ArrowDownUp className="h-4 w-4" /> },
    { view: "wallet", label: "Wallet", icon: <WalletCards className="h-4 w-4" /> },
    { view: "grants", label: "Grants", icon: <KeyRound className="h-4 w-4" /> },
    { view: "manage", label: "Manage", icon: <Settings2 className="h-4 w-4" /> },
    { view: "activity", label: "Activity", icon: <Activity className="h-4 w-4" /> },
    { view: "advanced", label: "Tools", icon: <Wrench className="h-4 w-4" /> },
  ];

  return (
    <nav aria-label="Workspace" className="mb-5 flex items-center gap-1 overflow-x-auto border-b border-zinc-800">
      {items.map((item) => (
        <TabButton active={activeView === item.view} key={item.view} onClick={() => navigateView(item.view)}>
          <span className="inline-flex items-center gap-2">
            {item.icon}
            {item.label}
          </span>
        </TabButton>
      ))}
    </nav>
  );
}

function PositionsWorkspace({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <>
      <WorkspaceHeader
        eyebrow="Wallet"
        title="Wallet Access"
        description="See the grants, Boardrooms, treasury actions, and liquidity this wallet can read or manage."
      />
      {children}
    </>
  );
}

function ManageWorkspace({
  account,
  boardroomAddress,
  boardroomSnapshot,
  children,
}: {
  account: Address | undefined;
  boardroomAddress: string;
  boardroomSnapshot: BoardroomSnapshot | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const summary = manageWorkspaceSummary(account, boardroomAddress, boardroomSnapshot);

  return (
    <>
      <WorkspaceHeader
        eyebrow="Operations"
        title="Manage Boardroom"
        description="Use owner-authorized workflows for grants, token issuance, sale setup, locked liquidity, and wind-down. Read-only users can still inspect loaded state."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={summary.roleTone}>{summary.roleLabel}</Badge>
          <Badge variant={summary.statusTone}>{summary.statusLabel}</Badge>
        </div>
      </WorkspaceHeader>
      {children}
    </>
  );
}

function ActivityWorkspace({
  clearLogs,
  dashboard,
  logs,
}: {
  clearLogs: () => void;
  dashboard: ProductBoardroomDashboardState | undefined;
  logs: LogEntry[];
}): React.JSX.Element {
  const history = dashboard?.history;
  const purchaseCount = (history?.fixedPriceSale?.purchaseCount ?? 0) + (history?.curve?.buyCount ?? 0);
  const sellCount = history?.curve?.sellCount ?? 0;

  return (
    <>
      <WorkspaceHeader
        eyebrow="Activity"
        title="Project Activity"
        description="Read recent project movement from indexed protocol history and local wallet actions from this session."
      />
      <Panel title="Protocol Activity" description="These counts come from the loaded Boardroom dashboard and its distribution or AMM history.">
        <Facts columns="three" items={[
          { label: "Boardroom", value: dashboard ? <AddressLink address={dashboard.address} /> : "No project loaded" },
          { label: "Buyers", value: history?.buyerCount === undefined ? "Unknown" : history.buyerCount.toString() },
          { label: "Purchases", value: purchaseCount.toString() },
          { label: "Curve sells", value: sellCount.toString() },
          { label: "AMM swaps", value: history?.amm?.swapCount === undefined ? "Unknown" : history.amm.swapCount.toString() },
          { label: "AMM traders", value: history?.amm?.traderCount === undefined ? "Unknown" : history.amm.traderCount.toString() },
        ]} />
      </Panel>
      <div className="mt-4">
        <LogPanel logs={logs} clearLogs={clearLogs} />
      </div>
    </>
  );
}

function AdvancedWorkspace({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <>
      <WorkspaceHeader
        eyebrow="Tools"
        title="Tools and Diagnostics"
        description="Use raw deployment details, wallet diagnostics, grant creation, and discovery tools when a workflow needs protocol-level control."
      />
      <div className="grid gap-4">{children}</div>
    </>
  );
}

export function canRunGrantIssuerActions(
  account: Address | undefined,
  grantSnapshot: GrantSnapshot | undefined,
  dashboard: ProductBoardroomDashboardState | undefined,
  boardroomSnapshot: BoardroomSnapshot | undefined,
  grantIssuerBoardroom: GrantIssuerBoardroomAccess | undefined,
): boolean {
  if (!account || !grantSnapshot) return false;
  if (sameAddress(account, grantSnapshot.issuer)) return true;
  if (sameAddress(grantSnapshot.issuer, dashboard?.address) && sameAddress(account, dashboard?.snapshot.owner)) return true;
  if (sameAddress(grantSnapshot.issuer, grantIssuerBoardroom?.boardroom) && sameAddress(account, grantIssuerBoardroom?.owner)) return true;
  return sameAddress(grantSnapshot.issuer, boardroomSnapshot?.address) && sameAddress(account, boardroomSnapshot?.owner);
}

export function manageWorkspaceSummary(
  account: Address | undefined,
  boardroomAddress: string,
  boardroomSnapshot: BoardroomSnapshot | undefined,
): {
  roleLabel: string;
  roleTone: "default" | "muted" | "warning";
  statusLabel: string;
  statusTone: "default" | "muted" | "warning";
} {
  const selected = Boolean(boardroomSnapshot || boardroomAddress.trim());
  const owner = sameAddress(account, boardroomSnapshot?.owner);

  return {
    roleLabel: !account ? "Connect owner wallet" : !boardroomSnapshot ? "Load Boardroom" : owner ? "Owner wallet" : "Read-only wallet",
    roleTone: owner ? "default" : "muted",
    statusLabel: boardroomSnapshot ? boardroomStatusText(boardroomSnapshot.status) : selected ? "Selected Boardroom not loaded" : "No Boardroom selected",
    statusTone: boardroomSnapshot ? "muted" : selected ? "warning" : "muted",
  };
}

function boardroomStatusText(status: number): string {
  if (status === 0) return "Active";
  if (status === 1) return "Winding down";
  if (status === 2) return "Redemptions open";
  return "Unknown status";
}

function sameAddress(first: Address | undefined, second: Address | undefined): boolean {
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase());
}
