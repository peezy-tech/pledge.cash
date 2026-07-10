import {
  boardroomFactoryAbi,
  buildBoardroomBurnTreasurySharesTransaction,
  buildBoardroomClaimRedemptionAssetTransaction,
  buildBoardroomExecuteTransaction,
  buildBoardroomFixedPriceSaleBatch,
  buildBoardroomFixedPriceSaleCancelAction,
  buildBoardroomFixedPriceSaleCloseAction,
  buildBoardroomGrantApprovalCall,
  buildBoardroomGrantCreationCall,
  buildBoardroomLockedLiquidityBatch,
  buildBoardroomLockedLiquidityExitTransaction,
  buildBoardroomLockedLiquidityFeeClaimAction,
  buildBoardroomMerkleAirdropBatch,
  buildBoardroomMerkleAirdropCancelAction,
  buildBoardroomMerkleAirdropCloseAction,
  buildBoardroomMigratingCurveBatch,
  buildBoardroomMigratingCurveCancelAction,
  buildBoardroomMigratingCurveMigrationAction,
  buildBoardroomMintCall,
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
  predictMerkleAirdropAddress as sdkPredictMerkleAirdropAddress,
  predictMigratingBondingCurveAddress as sdkPredictMigratingBondingCurveAddress,
  planBoardroomCallExecution,
  queryQueuedBoardroomActions,
  readBoardroomState,
  readBoardroomHolderPower,
  readFixedPriceSaleState,
  readGrantState,
  readLockedLiquidityState,
  readMerkleAirdropState,
  readMigratingBondingCurveState,
  tokenGrantAbi,
  type Address,
  type BoardroomFixedPriceSaleTerms,
  type BoardroomCall,
  type BoardroomHolderPower,
  type BoardroomLockedLiquidityTerms,
  type BoardroomMerkleAirdropTerms,
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
  type MerkleAirdropState,
  type MigratingBondingCurveState,
  type PledgeCashDeployment,
  type QueuedBoardroomAction,
} from "@pledge.cash/sdk";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Hex, PublicClient } from "viem";
import { TransactionReview } from "../components/transaction-review";
import { ConnectWalletButton } from "../components/simplekit";
import { Button } from "../components/ui/button";
import { windDownBlockers } from "../features/boardrooms/boardroom-panel-shared";
import {
  resolveProjectCapabilities,
  type Capability,
  type CapabilityOpportunity,
  type ProjectCapabilityContext,
} from "../features/capabilities/project-capabilities";
import type { BoardroomPanelCapabilities } from "../features/boardrooms/boardroom-panel-types";
import { GovernanceLaunchControl, GovernanceQueue } from "../features/governance";
import { createParticipationFlowContent } from "../features/participation";
import { AppHeader } from "../features/wallet/app-header";
import { useActionRunner } from "../hooks/use-action-runner";
import { useFactorySnapshot } from "../hooks/use-factory-snapshot";
import { useRuntimeDeployment } from "../hooks/use-runtime-deployment";
import { useTransactionReview } from "../hooks/use-transaction-review";
import { useWagmiWallet } from "../hooks/use-wagmi-wallet";
import { readBoardroomSnapshot } from "../lib/boardroom-snapshot";
import {
  PLEDGE_CASH_NETWORKS,
  createPledgeCashPublicClient,
  initialSelectedNetwork,
  networkForChainId,
  persistSelectedNetwork,
  supportedNetworkForChainId,
  syncSelectedNetworkSearch,
} from "../lib/contracts";
import {
  addressMapKey,
  clearDiscoverySnapshot,
  combineDiscoveryLastScanned,
  deploymentDiscoveryIdentity,
  discoveryErrors,
  discoveryItems,
  discoveryStorageKey,
  emptyDiscoverySnapshot,
  emptyDiscoveryResult,
  loadDiscoverySnapshot,
  mergeAddressMap,
  parseDiscoveryToBlock,
  resumeWalletAccessRange,
  saveDiscoverySnapshot,
  walletAccessDiscoveryRange,
  type DiscoveryScanRange,
} from "../lib/discovery";
import {
  defaultBoardroomGrantForm,
  defaultCurveMigrationForm,
  defaultFixedPriceSaleForm,
  defaultGrantForm,
  defaultLockedLiquidityExitForm,
  defaultLockedLiquidityForm,
  defaultMerkleAirdropForm,
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
} from "../lib/forms";
import {
  readProductBoardroomCatalog,
  readProductBoardroomDashboard,
  resolveProductBoardroomAddress,
  type ProductBoardroomDashboardState,
} from "../lib/product-boardroom";
import { getSentinelBaseUrl } from "../lib/sentinel";
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
} from "../lib/swap";
import { parseTokenAmountInput, readTokenMetadata, type TokenMetadata } from "../lib/token-amounts";
import { contractCallPreview, contractCallReview } from "../lib/transaction-preview";
import { TransactionTray, useTransactionCenter } from "../features/transactions/transaction-center";
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
  MerkleAirdropForm,
  MigratingCurveForm,
  WindDownForm,
} from "../lib/types";

import {
  appRouteHref,
  initialRoute,
  primaryDestination,
  projectRouteHref,
  routeFromLocation,
  type AppRoute,
  type AppView,
  type CanonicalAppRoute,
  type PrimaryDestination,
} from "./routing";
import { DesktopPrimaryNav, MobilePrimaryNav, StudioSectionNav } from "./product-navigation";
import {
  ExplorePage,
  GovernancePage,
  GrantDetailPage,
  NotFoundPage,
  PageNotice,
  ParticipatePage,
  PortfolioPage,
  ProjectLayout,
  ProjectOverviewPage,
  RedirectState,
  StudioPage,
  TransparencyPage,
  type PortfolioTask,
} from "./pages";
import { sameAddress } from "./views/workspace-helpers";

const AdvancedWorkspace = lazy(async () => ({ default: (await import("./views/workspaces")).AdvancedWorkspace }));
const BoardroomPanel = lazy(async () => ({ default: (await import("../features/boardrooms/boardroom-panel")).BoardroomPanel }));
const DirectGrantPanel = lazy(async () => ({ default: (await import("../features/grants/direct-grant-panel")).DirectGrantPanel }));
const DiscoveryPanel = lazy(async () => ({ default: (await import("../features/discovery/discovery-panel")).DiscoveryPanel }));
const GovernanceActivity = lazy(async () => ({ default: (await import("../features/notifications/governance-activity")).GovernanceActivity }));
const GrantInspector = lazy(async () => ({ default: (await import("../features/grants/grant-inspector")).GrantInspector }));
const ProjectDiagnostics = lazy(async () => ({ default: (await import("./views/workspaces")).ProjectDiagnostics }));
const SentinelSettingsView = lazy(async () => ({ default: (await import("./views/sentinel-settings")).SentinelSettingsView }));
const SwapPanel = lazy(async () => ({ default: (await import("../features/swap/swap-panel")).SwapPanel }));
const WalletAccessPanel = lazy(async () => ({ default: (await import("../features/discovery/discovery-panel")).WalletAccessPanel }));

export { parseDeployment } from "../lib/deployment";
export { viewFromPath, viewHref, viewUsesProjectDashboard } from "./routing";
export type { AppView } from "./routing";
export { manageWorkspaceSummary } from "./views/workspace-helpers";

const MIN_SETTLEMENT_GRACE_SECONDS = 86_400n;

type GrantIssuerAction = "stopVestingAndWithdrawUnvested" | "withdrawExpiredTokens";
export type GrantIssuerBoardroomAccess = {
  boardroom: Address;
  executor: Address;
  launched: boolean;
  owner: Address;
  status: number;
};

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

function emptySwapTokenList(): SwapTokenListState {
  return { tokens: [], pools: [], loaded: false };
}

function shouldLoadProductBoardroom({
  activeRoute,
  deployment,
  requestedAddress,
  productBoardroom,
  productBoardroomError,
  productBoardroomLoading,
}: {
  activeRoute: AppRoute;
  deployment: PledgeCashDeployment | undefined;
  requestedAddress: Address | undefined;
  productBoardroom: ProductBoardroomDashboardState | undefined;
  productBoardroomError: string | undefined;
  productBoardroomLoading: boolean;
}): boolean {
  if (!routeUsesProductData(activeRoute)) return false;
  if (!deployment?.boardroomFactory) return false;
  if (requestedAddress && productBoardroom?.address.toLowerCase() === requestedAddress.toLowerCase()) return false;
  if (!requestedAddress && productBoardroom) return false;
  if (productBoardroomError || productBoardroomLoading) return false;
  return true;
}

function shouldLoadSwapTokens({
  activeView,
  deployment,
  swapTokenList,
  swapTokenListLoading,
}: {
  activeView: AppView;
  deployment: PledgeCashDeployment | undefined;
  swapTokenList: SwapTokenListState;
  swapTokenListLoading: boolean;
}): boolean {
  if (activeView !== "market") return false;
  if (!deployment?.ammFactory) return false;
  if (swapTokenList.loaded || swapTokenListLoading) return false;
  return true;
}

function discoveryLoadedForWallet(discovery: DiscoverySnapshot, account: Address | undefined, chainId: number): boolean {
  return Boolean(discovery.loadedFor && sameAddress(discovery.loadedFor, account) && discovery.chainId === chainId);
}

export function App(): React.JSX.Element {
  const { pendingAction, pushLog, runAction } = useActionRunner();
  const { approveReview, cancelReview, requestReview, review } = useTransactionReview();
  const [selectedChainId, setSelectedChainId] = useState(() => initialSelectedNetwork().chainId);
  const activeNetwork = useMemo(() => networkForChainId(selectedChainId), [selectedChainId]);
  const networkRequestVersion = useRef(0);
  const discoveryWriteVersion = useRef(0);
  const grantLoadVersionRef = useRef(0);
  const governanceRequestVersionRef = useRef(0);
  const activeGovernanceKeyRef = useRef<string | undefined>(undefined);
  const productGovernanceLoadedKeyRef = useRef<string | undefined>(undefined);
  const grantRouteLoadedKeyRef = useRef<string | undefined>(undefined);
  const watchedTransactionIdsRef = useRef(new Map<string, number>());
  const transactionWatcherIdentityRef = useRef<string | undefined>(undefined);
  const transactionWatcherVersionRef = useRef(0);
  const activeChainIdRef = useRef(activeNetwork.chainId);
  activeChainIdRef.current = activeNetwork.chainId;
  const activeAccountRef = useRef<Address | undefined>(undefined);
  const activeDiscoveryKeyRef = useRef<string | undefined>(undefined);
  const activeDeploymentIdentityRef = useRef<string | undefined>(undefined);
  const publicClient = useMemo(() => createPledgeCashPublicClient(activeNetwork), [activeNetwork]);
  const generatedDeployment = getPledgeCashDeployment(activeNetwork.chainId);
  const deployment = useRuntimeDeployment(activeNetwork.chainId, generatedDeployment);
  const [appRoute, setAppRoute] = useState<AppRoute>(() => initialRoute());
  const activeAppRouteRef = useRef<AppRoute>(appRoute);
  activeAppRouteRef.current = appRoute;
  const activeView = appRouteView(appRoute);
  const requestedProductBoardroom = appRoute.kind === "project" || appRoute.kind === "studio-project"
    ? appRoute.boardroom
    : undefined;
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
  const [merkleAirdropForm, setMerkleAirdropForm] = useState<MerkleAirdropForm>(() => defaultMerkleAirdropForm());
  const [merkleAirdropAddress, setMerkleAirdropAddress] = useState("");
  const [merkleAirdropSnapshot, setMerkleAirdropSnapshot] = useState<MerkleAirdropState>();
  const [predictedMerkleAirdrop, setPredictedMerkleAirdrop] = useState<Address>();
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
  const [autoDiscoveryPending, setAutoDiscoveryPending] = useState(false);
  const autoDiscoveryKeyRef = useRef<string | undefined>(undefined);
  const autoDiscoveryRunningRef = useRef(false);
  const [productBoardroom, setProductBoardroom] = useState<ProductBoardroomDashboardState>();
  const [productBoardroomError, setProductBoardroomError] = useState<string>();
  const [productBoardroomLoading, setProductBoardroomLoading] = useState(false);
  const [boardroomHolderPower, setBoardroomHolderPower] = useState<BoardroomHolderPower>();
  const [queuedBoardroomActions, setQueuedBoardroomActions] = useState<QueuedBoardroomAction[]>([]);
  const [productGovernanceError, setProductGovernanceError] = useState<string>();
  const [productGovernanceLoading, setProductGovernanceLoading] = useState(false);
  const [swapForm, setSwapForm] = useState<SwapForm>(() => defaultSwapForm());
  const [swapQuote, setSwapQuote] = useState<SwapQuoteState>();
  const [liquidityForm, setLiquidityForm] = useState<LiquidityForm>(() => defaultLiquidityForm());
  const [liquidityQuote, setLiquidityQuote] = useState<LiquidityQuoteState>();
  const [removeLiquidityForm, setRemoveLiquidityForm] = useState<RemoveLiquidityForm>(() => defaultRemoveLiquidityForm());
  const [removeLiquidityQuote, setRemoveLiquidityQuote] = useState<RemoveLiquidityQuoteState>();
  const [ammPosition, setAmmPosition] = useState<AmmPositionState>();
  const [swapTokenList, setSwapTokenList] = useState<SwapTokenListState>(() => emptySwapTokenList());
  const [swapTokenListLoading, setSwapTokenListLoading] = useState(false);
  const sentinelBaseUrl = getSentinelBaseUrl();

  const syncSelectedChainFromLocation = useCallback((): void => {
    const nextChainId = initialSelectedNetwork().chainId;
    setSelectedChainId((currentChainId) => (currentChainId === nextChainId ? currentChainId : nextChainId));
  }, []);

  useEffect(() => {
    if (pendingAction) return;
    const routeChainId = appRouteChainId(appRoute);
    if (routeChainId !== undefined && supportedNetworkForChainId(routeChainId)) {
      setSelectedChainId((current) => current === routeChainId ? current : routeChainId);
      return;
    }
    syncSelectedChainFromLocation();
  }, [appRoute, pendingAction, syncSelectedChainFromLocation]);

  useEffect(() => {
    const syncRoute = (): void => {
      const nextRoute = routeFromLocation(window.location.pathname, window.location.search);
      activeAppRouteRef.current = nextRoute;
      setAppRoute(nextRoute);
      const routeChainId = appRouteChainId(nextRoute);
      if (routeChainId !== undefined && supportedNetworkForChainId(routeChainId)) {
        setSelectedChainId(routeChainId);
      } else if (!pendingAction) {
        syncSelectedChainFromLocation();
      }
    };
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, [pendingAction, syncSelectedChainFromLocation]);

  const navigateRoute = useCallback((route: CanonicalAppRoute, replace = false): void => {
    activeAppRouteRef.current = route;
    setAppRoute(route);
    if (typeof window === "undefined") return;
    const href = appRouteHref(route);
    if (`${window.location.pathname}${window.location.search}` !== href) {
      window.history[replace ? "replaceState" : "pushState"]({}, "", href);
    }
  }, []);

  useEffect(() => {
    if (!isCanonicalAppRoute(appRoute) || typeof window === "undefined") return;
    const canonicalHref = appRouteHref(appRoute);
    if (`${window.location.pathname}${window.location.search}` !== canonicalHref) {
      window.history.replaceState({}, "", canonicalHref);
    }
  }, [appRoute]);

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
      if (appRoute.kind === "portfolio") {
        navigateRoute({ kind: "portfolio", chainId: nextNetwork.chainId });
      } else if (appRoute.kind === "studio" || appRoute.kind === "studio-project") {
        navigateRoute({ kind: "studio", chainId: nextNetwork.chainId });
      } else if (appRoute.kind === "explore" || appRoute.kind === "project" || appRoute.kind === "legacy-project") {
        navigateRoute({ kind: "explore", chainId: nextNetwork.chainId });
      } else {
        syncSelectedNetworkSearch(nextNetwork.chainId);
      }
      pushLog(`Selected ${nextNetwork.name}`, "info");
    },
    [appRoute, navigateRoute, pushLog],
  );

  const { activeAccount, switchChain, wallet, walletClient } = useWagmiWallet({
    network: activeNetwork,
    onAccountChanged: clearDirectGrantPrediction,
    pushLog,
  });
  const transactionWatcherIdentity = `${activeNetwork.chainId.toString()}:${wallet.account?.toLowerCase() ?? "read-only"}`;
  if (transactionWatcherIdentityRef.current !== transactionWatcherIdentity) {
    transactionWatcherIdentityRef.current = transactionWatcherIdentity;
    transactionWatcherVersionRef.current += 1;
    watchedTransactionIdsRef.current.clear();
  }
  const activeGovernanceKey = governanceRouteKey(appRoute, wallet.account);
  activeGovernanceKeyRef.current = activeGovernanceKey;
  const { records: transactions, startTransaction, updateTransaction, clearSettled } = useTransactionCenter(
    activeNetwork.chainId,
    wallet.account,
  );
  useEffect(() => {
    for (const transaction of transactions) {
      if (transaction.chainId !== activeNetwork.chainId || transaction.stage !== "submitted" || !transaction.hash) continue;
      const watcherKey = `${activeNetwork.chainId.toString()}:${wallet.account?.toLowerCase() ?? "read-only"}:${transaction.id}`;
      if (watchedTransactionIdsRef.current.has(watcherKey)) continue;
      const watcherVersion = transactionWatcherVersionRef.current;
      watchedTransactionIdsRef.current.set(watcherKey, watcherVersion);
      void publicClient.waitForTransactionReceipt({ hash: transaction.hash })
        .then((receipt) => {
          if (transactionWatcherVersionRef.current !== watcherVersion) return;
          updateTransaction(transaction.id, {
            ...(receipt.status === "success" ? {} : { error: `${transaction.label} failed after submission.` }),
            stage: receipt.status === "success" ? "confirmed" : "failed",
          });
        })
        .catch(() => undefined)
        .finally(() => {
          if (watchedTransactionIdsRef.current.get(watcherKey) === watcherVersion) {
            watchedTransactionIdsRef.current.delete(watcherKey);
          }
        });
    }
  }, [activeNetwork.chainId, publicClient, transactions, updateTransaction, wallet.account]);
  const factorySnapshot = useFactorySnapshot(publicClient, deployment, pushLog);
  const creationFee = factorySnapshot.creationFee ?? deployment?.creationFee ?? 0n;
  const deploymentIdentity = deploymentDiscoveryIdentity(deployment);
  const discoveryKey = discoveryStorageKey(activeNetwork.chainId, wallet.account, deploymentIdentity);
  activeAccountRef.current = wallet.account;
  activeDiscoveryKeyRef.current = discoveryKey;
  activeDeploymentIdentityRef.current = deploymentIdentity;

  useEffect(() => {
    networkRequestVersion.current += 1;
  }, [activeNetwork.chainId]);

  useEffect(() => {
    discoveryWriteVersion.current += 1;
  }, [discoveryKey]);

  const isCurrentNetworkRequest = useCallback(
    (version: number, chainId: number): boolean =>
      networkRequestVersion.current === version && activeChainIdRef.current === chainId,
    [],
  );

  const resetNetworkScopedState = useCallback((): void => {
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
    setMerkleAirdropAddress("");
    setMerkleAirdropSnapshot(undefined);
    setPredictedMerkleAirdrop(undefined);
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
    setBoardroomHolderPower(undefined);
    setQueuedBoardroomActions([]);
    setProductGovernanceError(undefined);
    setProductGovernanceLoading(false);
    productGovernanceLoadedKeyRef.current = undefined;
    grantRouteLoadedKeyRef.current = undefined;
    setSwapForm(defaultSwapForm());
    setSwapQuote(undefined);
    setLiquidityForm(defaultLiquidityForm());
    setLiquidityQuote(undefined);
    setRemoveLiquidityForm(defaultRemoveLiquidityForm());
    setRemoveLiquidityQuote(undefined);
    setAmmPosition(undefined);
    setSwapTokenList(emptySwapTokenList());
    setSwapTokenListLoading(false);
  }, []);

  useEffect(() => {
    persistSelectedNetwork(activeNetwork.chainId);
  }, [activeNetwork.chainId]);

  useEffect(() => {
    resetNetworkScopedState();
  }, [activeNetwork.chainId, resetNetworkScopedState]);

  const loadProductBoardroom = useCallback(async (requestedAddress?: Address): Promise<void> => {
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
      const address = requestedAddress ?? resolveProductBoardroomAddress(catalog);
      if (!address) {
        throw new Error("No product Boardroom address is configured for this chain.");
      }
      const next = await readProductBoardroomDashboard(publicClient, { address, catalog, deployment });
      if (!isCurrentNetworkRequest(requestVersion, requestChainId)) return;
      setProductBoardroom(next);
      productGovernanceLoadedKeyRef.current = undefined;
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

  const loadProductGovernance = useCallback(async (address: Address): Promise<void> => {
    const key = `${activeNetwork.chainId.toString()}:${address.toLowerCase()}:${wallet.account?.toLowerCase() ?? "read-only"}`;
    if (activeGovernanceKeyRef.current !== key || productGovernanceLoadedKeyRef.current === key) return;
    const requestVersion = ++governanceRequestVersionRef.current;
    productGovernanceLoadedKeyRef.current = key;
    setQueuedBoardroomActions([]);
    setBoardroomHolderPower(undefined);
    setProductGovernanceLoading(true);
    setProductGovernanceError(undefined);
    try {
      const [queuedResult, holderResult] = await Promise.allSettled([
        queryQueuedBoardroomActions(publicClient, { boardrooms: [address] }),
        wallet.account ? readBoardroomHolderPower(publicClient, { boardroom: address, account: wallet.account }) : Promise.resolve(undefined),
      ]);
      if (governanceRequestVersionRef.current !== requestVersion || activeGovernanceKeyRef.current !== key) return;
      if (queuedResult.status === "fulfilled") {
        setQueuedBoardroomActions(queuedResult.value.filter((action) => sameAddress(action.boardroom, address)));
      }
      if (holderResult.status === "fulfilled" && holderResult.value?.boardroom && sameAddress(holderResult.value.boardroom, address)) {
        setBoardroomHolderPower(holderResult.value);
      }
      const errors = [queuedResult, holderResult]
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => errorMessage(result.reason));
      if (errors.length > 0) {
        productGovernanceLoadedKeyRef.current = undefined;
        setProductGovernanceError(errors.join(" "));
      }
    } finally {
      if (governanceRequestVersionRef.current === requestVersion && activeGovernanceKeyRef.current === key) {
        setProductGovernanceLoading(false);
      }
    }
  }, [activeNetwork.chainId, publicClient, wallet.account]);

  useEffect(() => {
    setDiscovery(loadDiscoverySnapshot(discoveryKey));
    setLoadedDiscoveryKey(discoveryKey);
  }, [discoveryKey]);

  useEffect(() => {
    setProductBoardroomError(undefined);
    if (requestedProductBoardroom && productBoardroom?.address.toLowerCase() !== requestedProductBoardroom.toLowerCase()) {
      setProductBoardroom(undefined);
    }
  }, [requestedProductBoardroom, productBoardroom?.address]);

  useEffect(() => {
    if (appRouteChainId(appRoute) !== undefined && appRouteChainId(appRoute) !== activeNetwork.chainId) return;
    if (!shouldLoadProductBoardroom({
      activeRoute: appRoute,
      deployment,
      requestedAddress: requestedProductBoardroom,
      productBoardroom,
      productBoardroomError,
      productBoardroomLoading,
    })) return;
    void loadProductBoardroom(requestedProductBoardroom);
  }, [activeNetwork.chainId, appRoute, deployment, loadProductBoardroom, productBoardroom, productBoardroomError, productBoardroomLoading, requestedProductBoardroom]);

  useEffect(() => {
    if (appRoute.kind !== "legacy-project" || !productBoardroom) return;
    navigateRoute(legacyProjectDestination(appRoute, activeNetwork.chainId, productBoardroom.address), true);
  }, [activeNetwork.chainId, appRoute, navigateRoute, productBoardroom]);

  useEffect(() => {
    governanceRequestVersionRef.current += 1;
    productGovernanceLoadedKeyRef.current = undefined;
    setQueuedBoardroomActions([]);
    setBoardroomHolderPower(undefined);
    setProductGovernanceError(undefined);
    setProductGovernanceLoading(false);
  }, [activeGovernanceKey]);

  useEffect(() => {
    const governanceRoute = (appRoute.kind === "project" && appRoute.section === "governance")
      || (appRoute.kind === "studio-project" && (appRoute.section === "governance" || appRoute.section === "close"));
    if (!governanceRoute || !productBoardroom || productBoardroom.address.toLowerCase() !== requestedProductBoardroom?.toLowerCase()) return;
    void loadProductGovernance(productBoardroom.address);
  }, [appRoute, loadProductGovernance, productBoardroom, requestedProductBoardroom]);

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
    const swapPairSupportsNative = pairHasWrappedNative(deployment, swapForm.tokenIn, swapForm.tokenOut);
    const liquidityPairSupportsNative = pairHasWrappedNative(deployment, liquidityForm.tokenA, liquidityForm.tokenB);

    if (!swapPairSupportsNative && swapForm.useNative) {
      setSwapForm((current) => ({ ...current, useNative: false }));
    }
    if (liquidityPairSupportsNative) return;
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
    if (!shouldLoadSwapTokens({ activeView, deployment, swapTokenList, swapTokenListLoading })) return;
    void loadSwapTokens();
  }, [activeView, deployment, loadSwapTokens, swapTokenList, swapTokenListLoading]);

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
    setPredictedMerkleAirdrop(undefined);
    setPredictedMigratingCurve(undefined);
    setPredictedLockedLiquidity(undefined);
  }, []);

  const updateFixedPriceSaleAddress = useCallback((address: string): void => {
    setFixedPriceSaleAddress(address);
    setFixedPriceSaleSnapshot(undefined);
  }, []);

  const updateMerkleAirdropAddress = useCallback((address: string): void => {
    setMerkleAirdropAddress(address);
    setMerkleAirdropSnapshot(undefined);
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
    const route = activeAppRouteRef.current;
    if (route.kind === "studio-project" && !sameAddress(route.boardroom, boardroom)) {
      throw new Error("Studio project identity changed. Reload the Boardroom from its canonical route before continuing.");
    }
    const snapshot = await readBoardroomSnapshot(publicClient, boardroom);
    setBoardroomSnapshot(snapshot);
    setBoardroomMintTo((current) => current || snapshot.address);
    await loadProductBoardroom(boardroom);
    return snapshot;
  };

  useEffect(() => {
    if (appRoute.kind !== "studio-project" || appRoute.chainId !== activeNetwork.chainId) return;
    const address = appRoute.boardroom;
    let cancelled = false;
    setBoardroomAddress(address);
    if (boardroomSnapshot?.address.toLowerCase() === address.toLowerCase()) return;
    void readBoardroomSnapshot(publicClient, address)
      .then((snapshot) => {
        if (cancelled) return;
        setBoardroomSnapshot(snapshot);
        setBoardroomMintTo((current) => current || snapshot.address);
      })
      .catch((error) => {
        if (!cancelled) pushLog(errorMessage(error), "error");
      });
    return () => { cancelled = true; };
  }, [activeNetwork.chainId, appRoute, boardroomSnapshot?.address, publicClient, pushLog]);

  const submitContractTransaction = async (label: string, request: Record<string, unknown>): Promise<Hex> => {
    const callReview = contractCallReview(label, request);
    const transactionId = startTransaction(callReview);
    const txChainId = activeNetwork.chainId;
    try {
      await requestReview(callReview);
      updateTransaction(transactionId, { stage: "simulating" });
      pushLog(contractCallPreview(label, request), "info");
      const account = activeAccount();
      const simulation = await publicClient.simulateContract({
        account,
        ...request,
      } as unknown as Parameters<typeof publicClient.simulateContract>[0]);
      updateTransaction(transactionId, { stage: "awaiting-signature" });

      const client = walletClient();
      const hash = (await client.writeContract({
        ...simulation.request,
      } as unknown as Parameters<typeof client.writeContract>[0])) as Hex;

      updateTransaction(transactionId, { hash, stage: "submitted" });
      pushLog(`${label} submitted`, "info", hash, txChainId);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`${label} failed after submission.`);
      }

      updateTransaction(transactionId, { stage: "confirmed" });
      pushLog(`${label} confirmed`, "success", hash, txChainId);
      return hash;
    } catch (error) {
      const cancelled = error instanceof Error && error.name === "TransactionReviewCancelledError";
      updateTransaction(transactionId, {
        error: cancelled ? undefined : errorMessage(error),
        stage: cancelled ? "cancelled" : "failed",
      });
      throw error;
    }
  };

  const submitBoardroomExecution = async (
    label: string,
    boardroom: { address: Address; launched: boolean; status: number },
    request: Record<string, unknown>,
  ): Promise<"execute" | "queue" | "windDown"> => {
    const calls = boardroomCallsFromExecution(request);
    const plan = planBoardroomCallExecution({
      boardroom: boardroom.address,
      calls,
      lifecycle: { launched: boardroom.launched, status: boardroom.status },
      ...(boardroom.launched && boardroom.status === 0 ? { salt: randomSalt() } : {}),
    });
    const transactionLabel = plan.kind === "queue" ? `Queue ${label.toLowerCase()}` : label;
    await submitContractTransaction(transactionLabel, plan.transaction);
    if (plan.kind === "queue") {
      pushLog(`${label} is queued. It can execute after the project governance delay.`, "success");
    }
    return plan.kind;
  };

  const refreshSwapQuote = async (): Promise<void> => {
    const next = await readSwapQuote(publicClient, deployment, swapForm, wallet.account);
    const route = activeAppRouteRef.current;
    const expectedPool = route.kind === "project" && route.section === "participate" ? exactProjectPoolRef.current : undefined;
    if (expectedPool && (!next.pool || !sameAddress(next.pool.address, expectedPool))) {
      const message = "This quote does not use the project pool. Refresh the project before swapping.";
      setSwapQuote({ ...next, error: message });
      pushLog(message, "error");
      return;
    }
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
    const route = activeAppRouteRef.current;
    const expectedPool = route.kind === "project" && route.section === "participate" ? exactProjectPoolRef.current : undefined;
    if (expectedPool && (!next.pool || !sameAddress(next.pool.address, expectedPool))) {
      throw new Error("The current quote does not use this project’s AMM pool.");
    }
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
    if (expiry < vestingEnd + MIN_SETTLEMENT_GRACE_SECONDS) {
      throw new Error("Expiry must leave at least one day to settle after vesting ends.");
    }
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

  const loadGrantAddress = async (grant: Address, expectedRouteKey?: string): Promise<void> => {
    const requestVersion = ++grantLoadVersionRef.current;
    const requestChainId = activeNetwork.chainId;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const snapshot = await readGrantState(publicClient, grant, now);
    const [tokenMetadata, paymentTokenMetadata, issuerBoardroom] = await Promise.all([
      readTokenMetadata(publicClient, snapshot.token),
      isZeroAddress(snapshot.paymentToken) ? undefined : readTokenMetadata(publicClient, snapshot.paymentToken),
      readGrantIssuerBoardroomAccess(snapshot.issuer),
    ]);
    if (grantLoadVersionRef.current !== requestVersion || activeChainIdRef.current !== requestChainId) return;
    if (expectedRouteKey) {
      const route = activeAppRouteRef.current;
      const activeRouteKey = route.kind === "grant"
        ? `${route.chainId.toString()}:${route.grant.toLowerCase()}`
        : undefined;
      if (activeRouteKey !== expectedRouteKey) return;
    }

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
    setGrantAddress(grant);
    pushLog(`Loaded grant ${grant}`, "success");
  };

  const loadGrant = async (): Promise<void> => {
    const route = activeAppRouteRef.current;
    if (route.kind === "grant") {
      await loadGrantAddress(route.grant, `${route.chainId.toString()}:${route.grant.toLowerCase()}`);
      return;
    }
    await loadGrantAddress(requireAddress(grantAddress, "Grant address"));
  };

  const selectedGrantAddress = (): Address => {
    const route = activeAppRouteRef.current;
    return route.kind === "grant" ? route.grant : requireAddress(grantAddress, "Grant address");
  };

  const approvePayment = async (): Promise<void> => {
    if (!grantSnapshot) throw new Error("Load a grant first.");
    const grant = selectedGrantAddress();
    if (grantSnapshot.address.toLowerCase() !== grant.toLowerCase()) throw new Error("Reload the grant after changing the address.");
    if (isZeroAddress(grantSnapshot.paymentToken)) throw new Error("Selected grant has no payment token.");

    const amount = await parseErc20Amount(publicClient, paymentApproval, grantSnapshot.paymentToken, "Payment approval");
    await submitContractTransaction(
      "Payment approval",
      buildErc20Approval({ token: grantSnapshot.paymentToken, spender: grantSnapshot.address, amount }),
    );
  };

  const settleGrant = async (): Promise<void> => {
    const grant = selectedGrantAddress();
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
      return {
        boardroom: issuer,
        executor: snapshot.executor,
        launched: snapshot.launched,
        owner: snapshot.owner,
        status: snapshot.status,
      };
    } catch {
      return undefined;
    }
  };

  useEffect(() => {
    grantLoadVersionRef.current += 1;
    if (appRoute.kind !== "grant" || appRoute.chainId !== activeNetwork.chainId) {
      grantRouteLoadedKeyRef.current = undefined;
      setGrantSnapshot(undefined);
      setGrantIssuerBoardroom(undefined);
      return;
    }
    const key = `${appRoute.chainId.toString()}:${appRoute.grant.toLowerCase()}`;
    if (grantRouteLoadedKeyRef.current === key) return;
    grantRouteLoadedKeyRef.current = key;
    updateGrantAddress(appRoute.grant);
    void loadGrantAddress(appRoute.grant, key).catch((error) => {
      const route = activeAppRouteRef.current;
      if (route.kind === "grant" && `${route.chainId.toString()}:${route.grant.toLowerCase()}` === key) {
        grantRouteLoadedKeyRef.current = undefined;
        pushLog(errorMessage(error), "error");
      }
    });
  }, [activeNetwork.chainId, appRoute, pushLog]);

  const runGrantIssuerAction = async (functionName: GrantIssuerAction, successMessage: string): Promise<void> => {
    const grant = selectedGrantAddress();
    const { issuer } = await readGrantState(publicClient, grant);
    const issuerBoardroom = await readBoardroomState(publicClient, issuer).catch(() => undefined);

    if (issuerBoardroom && !isZeroAddress(issuerBoardroom.policyRegistry)) {
      const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
      await submitBoardroomExecution(
        `${successMessage} through Boardroom`,
        issuerBoardroom,
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
    navigateRoute({ kind: "studio-project", chainId: activeNetwork.chainId, boardroom: predicted, section: "setup" });
    await refreshBoardroom(predicted);
  };

  const loadBoardroom = async (): Promise<void> => {
    const route = activeAppRouteRef.current;
    const address = route.kind === "studio-project"
      ? route.boardroom
      : requireAddress(boardroomAddress, "Boardroom address");
    await refreshBoardroom(address);
    pushLog(`Loaded Boardroom ${address}`, "success");
  };

  const mintBoardroomShares = async (): Promise<void> => {
    const boardroom = boardroomSnapshot?.address ?? requireAddress(boardroomAddress, "Boardroom address");
    const lifecycle = boardroomSnapshot?.address.toLowerCase() === boardroom.toLowerCase()
      ? boardroomSnapshot
      : await readBoardroomState(publicClient, boardroom);
    const to = boardroomMintTo.trim() ? requireAddress(boardroomMintTo, "Mint recipient") : boardroom;
    const shareToken = lifecycle.shareToken;
    const amount = await parseErc20Amount(publicClient, boardroomMintAmount, shareToken, "Mint amount");
    await submitBoardroomExecution(
      "Share mint",
      lifecycle,
      buildBoardroomExecuteTransaction({ boardroom, call: buildBoardroomMintCall({ boardroom, to, amount }) }),
    );
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
    if (expiry < vestingEnd + MIN_SETTLEMENT_GRACE_SECONDS) {
      throw new Error("Grant expiry must leave at least one day to settle after vesting ends.");
    }
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
    await submitBoardroomExecution(
      "Boardroom approval",
      boardroomSnapshot,
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
    const terms = await boardroomShareGrantTerms();
    const predicted = await sdkPredictBoardroomGrantAddress(publicClient, {
      factory,
      boardroom: boardroomSnapshot.address,
      salt: terms.salt,
    });
    await submitBoardroomExecution(
      "Boardroom grant creation",
      boardroomSnapshot,
      buildBoardroomExecuteTransaction({
        boardroom: boardroomSnapshot.address,
        call: buildBoardroomGrantCreationCall({
          policy: factory,
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
    const assetPolicy = requireDeploymentAddress(deployment?.assetPolicy, "AssetPolicy");
    const terms = await boardroomShareGrantTerms();
    const predicted = await sdkPredictBoardroomGrantAddress(publicClient, {
      factory,
      boardroom: boardroomSnapshot.address,
      salt: terms.salt,
    });
    await submitBoardroomExecution(
      "Boardroom grant batch",
      boardroomSnapshot,
      buildBoardroomShareGrantIssuanceBatch({
        boardroom: boardroomSnapshot.address,
        factory,
        shareToken: boardroomSnapshot.shareToken,
        terms,
        creationFee,
        policy: factory,
        assetPolicy,
      }),
    );
    setPredictedBoardroomGrant(predicted);
    updateGrantAddress(predicted);
    await refreshBoardroom(boardroomSnapshot.address);
  };

  const requireLoadedBoardroom = (): BoardroomSnapshot => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    const route = activeAppRouteRef.current;
    if (route.kind === "studio-project" && !sameAddress(route.boardroom, boardroomSnapshot.address)) {
      throw new Error("The loaded Boardroom does not match this Studio route. Refresh the project before continuing.");
    }
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
    const assetPolicy = requireDeploymentAddress(deployment?.assetPolicy, "AssetPolicy");
    const terms = await fixedPriceSaleTerms(boardroom);
    const predicted = await sdkPredictFixedPriceSaleAddress(publicClient, { factory, boardroom: boardroom.address, salt: terms.salt });
    const executionKind = await submitBoardroomExecution(
      "Fixed-price sale creation",
      boardroom,
      buildBoardroomFixedPriceSaleBatch({
        boardroom: boardroom.address,
        factory,
        shareToken: boardroom.shareToken,
        terms,
        policy: factory,
        assetPolicy,
      }),
    );
    setPredictedFixedPriceSale(predicted);
    updateFixedPriceSaleAddress(predicted);
    await refreshBoardroom(boardroom.address);
    if (executionKind !== "queue") await loadFixedPriceSaleAddress(predicted);
  };

  const closeFixedPriceSale = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const sale = requireAddress(fixedPriceSaleAddress, "Fixed-price sale address");
    await submitBoardroomExecution(
      "Fixed-price sale close",
      boardroom,
      buildBoardroomFixedPriceSaleCloseAction({ boardroom: boardroom.address, policy: factory, sale }),
    );
    await Promise.all([refreshBoardroom(boardroom.address), loadFixedPriceSaleAddress(sale)]);
  };

  const cancelFixedPriceSale = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const sale = requireAddress(fixedPriceSaleAddress, "Fixed-price sale address");
    await submitBoardroomExecution(
      "Fixed-price sale cancel",
      boardroom,
      buildBoardroomFixedPriceSaleCancelAction({ boardroom: boardroom.address, policy: factory, sale }),
    );
    await Promise.all([refreshBoardroom(boardroom.address), loadFixedPriceSaleAddress(sale)]);
  };

  const merkleAirdropTerms = async (boardroom: BoardroomSnapshot): Promise<BoardroomMerkleAirdropTerms> => {
    const shareAmount = await parseErc20Amount(publicClient, merkleAirdropForm.shareAmount, boardroom.shareToken, "Airdrop share amount");
    const maxGrantClaims = uintInput(merkleAirdropForm.maxGrantClaims, "Airdrop grant claim cap");
    if (maxGrantClaims > 65_535n) {
      throw new Error("Airdrop grant claim cap must fit uint16.");
    }

    return {
      shareAmount,
      merkleRoot: requireBytes32(merkleAirdropForm.merkleRoot, "Merkle root"),
      startTime: uintInput(merkleAirdropForm.startTime, "Airdrop start time"),
      endTime: uintInput(merkleAirdropForm.endTime, "Airdrop end time"),
      maxGrantClaims: Number(maxGrantClaims),
      salt: requireBytes32(merkleAirdropForm.salt, "Airdrop salt"),
    };
  };

  const predictMerkleAirdrop = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const { salt } = await merkleAirdropTerms(boardroom);
    const predicted = await sdkPredictMerkleAirdropAddress(publicClient, { factory, boardroom: boardroom.address, salt });
    setPredictedMerkleAirdrop(predicted);
    updateMerkleAirdropAddress(predicted);
    pushLog(`Predicted Merkle airdrop ${predicted}`, "success");
  };

  const loadMerkleAirdropAddress = async (address?: Address): Promise<MerkleAirdropState> => {
    const airdrop = address ?? requireAddress(merkleAirdropAddress, "Merkle airdrop address");
    const snapshot = await readMerkleAirdropState(publicClient, airdrop);
    setMerkleAirdropSnapshot(snapshot);
    setMerkleAirdropAddress(airdrop);
    return snapshot;
  };

  const loadMerkleAirdrop = async (): Promise<void> => {
    const airdrop = requireAddress(merkleAirdropAddress, "Merkle airdrop address");
    await loadMerkleAirdropAddress(airdrop);
    pushLog(`Loaded Merkle airdrop ${airdrop}`, "success");
  };

  const createMerkleAirdrop = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const assetPolicy = requireDeploymentAddress(deployment?.assetPolicy, "AssetPolicy");
    const terms = await merkleAirdropTerms(boardroom);
    const predicted = await sdkPredictMerkleAirdropAddress(publicClient, { factory, boardroom: boardroom.address, salt: terms.salt });
    const executionKind = await submitBoardroomExecution(
      "Merkle airdrop creation",
      boardroom,
      buildBoardroomMerkleAirdropBatch({
        boardroom: boardroom.address,
        factory,
        shareToken: boardroom.shareToken,
        terms,
        policy: factory,
        assetPolicy,
      }),
    );
    setPredictedMerkleAirdrop(predicted);
    updateMerkleAirdropAddress(predicted);
    await refreshBoardroom(boardroom.address);
    if (executionKind !== "queue") await loadMerkleAirdropAddress(predicted);
  };

  const closeMerkleAirdrop = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const airdrop = requireAddress(merkleAirdropAddress, "Merkle airdrop address");
    await submitBoardroomExecution(
      "Merkle airdrop close",
      boardroom,
      buildBoardroomMerkleAirdropCloseAction({ boardroom: boardroom.address, policy: factory, airdrop }),
    );
    await Promise.all([refreshBoardroom(boardroom.address), loadMerkleAirdropAddress(airdrop)]);
  };

  const cancelMerkleAirdrop = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const airdrop = requireAddress(merkleAirdropAddress, "Merkle airdrop address");
    await submitBoardroomExecution(
      "Merkle airdrop cancel",
      boardroom,
      buildBoardroomMerkleAirdropCancelAction({ boardroom: boardroom.address, policy: factory, airdrop }),
    );
    await Promise.all([refreshBoardroom(boardroom.address), loadMerkleAirdropAddress(airdrop)]);
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
    const assetPolicy = requireDeploymentAddress(deployment?.assetPolicy, "AssetPolicy");
    const terms = await migratingCurveTerms(boardroom);
    const predicted = await sdkPredictMigratingBondingCurveAddress(publicClient, { factory, boardroom: boardroom.address, salt: terms.salt });
    const executionKind = await submitBoardroomExecution(
      "Migrating curve creation",
      boardroom,
      buildBoardroomMigratingCurveBatch({
        boardroom: boardroom.address,
        factory,
        shareToken: boardroom.shareToken,
        terms,
        policy: factory,
        assetPolicy,
      }),
    );
    setPredictedMigratingCurve(predicted);
    updateMigratingCurveAddress(predicted);
    await refreshBoardroom(boardroom.address);
    if (executionKind !== "queue") await loadMigratingCurveAddress(predicted);
  };

  const cancelMigratingCurve = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const curve = requireAddress(migratingCurveAddress, "Migrating curve address");
    await submitBoardroomExecution(
      "Migrating curve cancel",
      boardroom,
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
    await submitBoardroomExecution(
      "Migrating curve migration",
      boardroom,
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
    const assetPolicy = requireDeploymentAddress(deployment?.assetPolicy, "AssetPolicy");
    const terms = await lockedLiquidityTerms(boardroom);
    const predicted = await sdkPredictLockedLiquidityAddress(publicClient, { factory, boardroom: boardroom.address, salt: terms.salt });
    const executionKind = await submitBoardroomExecution(
      "Locked-liquidity creation",
      boardroom,
      buildBoardroomLockedLiquidityBatch({
        boardroom: boardroom.address,
        factory,
        shareToken: boardroom.shareToken,
        terms,
        policy: factory,
        assetPolicy,
      }),
    );
    setPredictedLockedLiquidity(predicted);
    updateLockedLiquidityAddress(predicted);
    await refreshBoardroom(boardroom.address);
    if (executionKind !== "queue") await loadLockedLiquidityAddress(predicted);
  };

  const claimLockedLiquidityFees = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.lockedLiquidityFactory, "LockedLiquidityFactory");
    const locker = requireAddress(lockedLiquidityAddress, "Locked-liquidity address");
    await submitBoardroomExecution(
      "Locked-liquidity fee claim",
      boardroom,
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

  const claimBoardroomRedemptionAsset = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const asset = requireAddress(windDownForm.claimAsset, "Redemption claim asset");
    const recipient = windDownForm.claimRecipient.trim()
      ? requireAddress(windDownForm.claimRecipient, "Redemption claim recipient")
      : activeAccount();
    const minAmountOut = await parseErc20Amount(
      publicClient,
      windDownForm.claimMinAmount,
      asset,
      "Redemption claim minimum",
    );
    await submitContractTransaction(
      "Boardroom redemption asset claim",
      buildBoardroomClaimRedemptionAssetTransaction({ boardroom: boardroom.address, asset, recipient, minAmountOut }),
    );
    await refreshBoardroom(boardroom.address);
  };

  const scanDiscoveryRange = async ({ chunkSize, fromBlock, toBlock, rangeMode = "manual" }: DiscoveryScanRange): Promise<void> => {
    if (!wallet.account) throw new Error("Connect wallet first.");
    if (!deployment) throw new Error("Load a deployment artifact first.");

    const requestVersion = networkRequestVersion.current;
    const requestChainId = activeNetwork.chainId;
    const requestAccount = wallet.account;
    const requestDiscoveryKey = discoveryKey;
    const requestDeploymentIdentity = deploymentIdentity;
    const requestDiscoveryWriteVersion = discoveryWriteVersion.current;
    const range = toBlock === undefined ? { fromBlock, chunkSize } : { fromBlock, toBlock, chunkSize };
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
      chunkSize,
      rangeMode,
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
    if (toBlock !== undefined) {
      next.toBlock = toBlock;
    }

    if (
      !isCurrentNetworkRequest(requestVersion, requestChainId)
      || discoveryWriteVersion.current !== requestDiscoveryWriteVersion
      || activeAccountRef.current?.toLowerCase() !== requestAccount.toLowerCase()
      || activeDiscoveryKeyRef.current !== requestDiscoveryKey
      || activeDeploymentIdentityRef.current !== requestDeploymentIdentity
    ) {
      return;
    }

    setDiscovery(next);
    saveDiscoverySnapshot(requestDiscoveryKey, next);
    pushLog(
      `Discovery scanned ${shortAddress(requestAccount)}: ${boardroomResult.items.length} boardrooms, ${grantResult.items.length} grants, ${relevantDistributions.length} distributions, ${relevantLockers.length} lockers.`,
      next.complete ? "success" : "error",
    );
  };

  const scanDiscoveryFrom = async (fromBlock: bigint): Promise<void> => {
    await scanDiscoveryRange({
      fromBlock,
      toBlock: parseDiscoveryToBlock(discoveryForm.toBlock),
      chunkSize: uintInput(discoveryForm.chunkSize, "Chunk size"),
    });
  };

  const scanDiscovery = async (): Promise<void> => {
    await scanDiscoveryFrom(uintInput(discoveryForm.fromBlock, "From block"));
  };

  const scanWalletAccess = async (): Promise<void> => {
    const range = await walletAccessDiscoveryRange(publicClient, deployment);
    const loadedForCurrentWallet = discoveryLoadedForWallet(discovery, wallet.account, activeNetwork.chainId);
    await scanDiscoveryRange(loadedForCurrentWallet ? resumeWalletAccessRange(range, discovery) : range);
  };

  const resumeDiscovery = async (): Promise<void> => {
    if (discovery.lastScannedBlock === undefined) throw new Error("No cached discovery range to resume.");
    const nextFromBlock = discovery.lastScannedBlock + 1n;
    setDiscoveryForm((current) => ({ ...current, fromBlock: nextFromBlock.toString() }));
    await scanDiscoveryFrom(nextFromBlock);
  };

  const clearDiscovery = (): void => {
    discoveryWriteVersion.current += 1;
    autoDiscoveryKeyRef.current = discoveryKey;
    setAutoDiscoveryPending(false);
    clearDiscoverySnapshot(discoveryKey);
    setDiscovery(emptyDiscoverySnapshot());
    setLoadedDiscoveryKey(discoveryKey);
    pushLog("Cleared discovery cache.", "success");
  };

  useEffect(() => {
    autoDiscoveryKeyRef.current = undefined;
  }, [discoveryKey]);

  useEffect(() => {
    if (!wallet.account || !deployment || pendingAction) return;
    if (loadedDiscoveryKey !== discoveryKey) return;
    if (autoDiscoveryRunningRef.current) return;

    const key = discoveryKey;
    if (!key) return;
    if (autoDiscoveryKeyRef.current === key) return;

    autoDiscoveryKeyRef.current = key;
    autoDiscoveryRunningRef.current = true;
    setAutoDiscoveryPending(true);
    void scanWalletAccess()
      .catch((error) => pushLog(errorMessage(error), "error"))
      .finally(() => {
        autoDiscoveryRunningRef.current = false;
        setAutoDiscoveryPending(false);
      });
  }, [activeNetwork.chainId, deployment, discovery.chainId, discovery.loadedFor, discoveryKey, loadedDiscoveryKey, pendingAction, pushLog, scanWalletAccess, wallet.account]);

  const inspectDiscoveredGrant = useCallback(
    (grant: Address): void => {
      updateGrantAddress(grant);
      navigateRoute({ kind: "grant", chainId: activeNetwork.chainId, grant });
    },
    [activeNetwork.chainId, navigateRoute, updateGrantAddress],
  );

  const useDiscoveredBoardroom = useCallback(
    (boardroom: Address): void => {
      updateBoardroomAddress(boardroom);
      navigateRoute({ kind: "studio-project", chainId: activeNetwork.chainId, boardroom, section: "setup" });
    },
    [activeNetwork.chainId, navigateRoute, updateBoardroomAddress],
  );

  const useDiscoveredDistribution = useCallback(
    (distribution: DiscoveredDistribution): void => {
      updateBoardroomAddress(distribution.boardroom);
      switch (distribution.kind) {
        case "migrating-bonding-curve":
          updateMigratingCurveAddress(distribution.distribution);
          break;
        case "merkle-airdrop":
          updateMerkleAirdropAddress(distribution.distribution);
          break;
        default:
          updateFixedPriceSaleAddress(distribution.distribution);
      }
      navigateRoute({ kind: "studio-project", chainId: activeNetwork.chainId, boardroom: distribution.boardroom, section: "distributions" });
    },
    [activeNetwork.chainId, navigateRoute, updateBoardroomAddress, updateFixedPriceSaleAddress, updateMerkleAirdropAddress, updateMigratingCurveAddress],
  );

  const useDiscoveredLockedLiquidity = useCallback(
    (locker: DiscoveredLockedLiquidity): void => {
      updateBoardroomAddress(locker.boardroom);
      updateLockedLiquidityAddress(locker.locker);
      navigateRoute({ kind: "studio-project", chainId: activeNetwork.chainId, boardroom: locker.boardroom, section: "liquidity" });
    },
    [activeNetwork.chainId, navigateRoute, updateBoardroomAddress, updateLockedLiquidityAddress],
  );

  const exactProjectAddress = appRoute.kind === "project" || appRoute.kind === "studio-project" ? appRoute.boardroom : undefined;
  const exactProjectDashboard = exactProjectAddress && productBoardroom?.address.toLowerCase() === exactProjectAddress.toLowerCase()
    ? productBoardroom
    : undefined;
  const projectCapabilities = resolveProjectCapabilities({
    account: wallet.account,
    routeChainId: appRouteChainId(appRoute) ?? activeNetwork.chainId,
    walletChainId: wallet.chainId,
    project: exactProjectDashboard ? {
      owner: exactProjectDashboard.snapshot.owner,
      executor: exactProjectDashboard.snapshot.executor,
      launched: exactProjectDashboard.snapshot.launched,
      status: capabilityLifecycle(exactProjectDashboard.snapshot.status),
      launchReady: boardroomLaunchReady(exactProjectDashboard.snapshot),
      launchBlockedReason: boardroomLaunchReady(exactProjectDashboard.snapshot)
        ? undefined
        : "Distribute at least one whole governance-eligible project token before launch.",
      windDownBlockers: windDownBlockers(exactProjectDashboard.snapshot).length,
    } : undefined,
    wallet: {
      shareBalance: boardroomHolderPower?.currentBalance,
      vetoEligible: boardroomHolderPower?.canVeto,
      windDownEligible: boardroomHolderPower?.canStartWindDown,
    },
    governance: {
      queuedActionCount: queuedBoardroomActions.filter((action) => action.status === "waiting" || action.status === "ready").length,
      readyActionCount: queuedBoardroomActions.filter((action) => action.status === "ready").length,
    },
    opportunities: participationCapabilityOpportunities(exactProjectDashboard),
  });
  const routeWalletCapability = walletWriteCapability(wallet.account, wallet.chainId, appRouteChainId(appRoute) ?? activeNetwork.chainId);
  const projectLifecycle = exactProjectDashboard?.snapshot.status;
  const lifecycleUnavailable: Capability = { status: "hidden" };
  const boardroomPanelCapabilities: BoardroomPanelCapabilities | undefined = appRoute.kind === "studio"
    ? {
        claimRedemption: lifecycleUnavailable,
        createBoardroom: routeWalletCapability,
        createDistribution: lifecycleUnavailable,
        createGrant: lifecycleUnavailable,
        createLiquidity: lifecycleUnavailable,
        manageDistribution: lifecycleUnavailable,
        manageLiquidity: lifecycleUnavailable,
        mint: lifecycleUnavailable,
        permissionlessWindDown: lifecycleUnavailable,
        redeem: lifecycleUnavailable,
        registerRedeemableAsset: lifecycleUnavailable,
        startWindDown: lifecycleUnavailable,
      }
    : appRoute.kind === "studio-project"
      ? {
        claimRedemption: projectLifecycle === 2 ? routeWalletCapability : lifecycleUnavailable,
        createBoardroom: lifecycleUnavailable,
        createDistribution: projectCapabilities["studio.createDistribution"],
        createGrant: projectCapabilities["studio.createGrant"],
        createLiquidity: projectCapabilities["studio.manageLiquidity"],
        manageDistribution: projectLifecycle === 1
          ? routeWalletCapability
          : projectCapabilities["studio.createDistribution"],
        manageLiquidity: projectLifecycle === 1
          ? routeWalletCapability
          : projectCapabilities["studio.manageLiquidity"],
        mint: projectCapabilities["studio.mint"],
        permissionlessWindDown: projectCapabilities["windDown.openRedemptions"],
        redeem: projectCapabilities["redemption.redeem"],
        registerRedeemableAsset: projectCapabilities["windDown.registerAsset"],
        startWindDown: projectCapabilities["windDown.start"],
        }
      : undefined;

  const displayedGrantSnapshot = appRoute.kind === "grant"
    ? grantSnapshot?.address.toLowerCase() === appRoute.grant.toLowerCase() ? grantSnapshot : undefined
    : grantSnapshot;
  const grantIssuerActionsAvailable = canRunGrantIssuerActions(wallet.account, displayedGrantSnapshot, productBoardroom, boardroomSnapshot, grantIssuerBoardroom);
  const marketPanel = (
    <Suspense fallback={<div aria-live="polite" className="border-y border-zinc-800 py-6 text-sm text-zinc-500">Loading market tools…</div>}>
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
      mode={appRoute.kind === "project" ? "swap" : appRoute.kind === "studio-project" && appRoute.section === "liquidity" ? "liquidity" : "all"}
      lockSwapPair={appRoute.kind === "project" && appRoute.section === "participate"}
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
    </Suspense>
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
      actionCapability={walletWriteCapability(wallet.account, wallet.chainId, appRouteChainId(appRoute) ?? activeNetwork.chainId)}
      addressLocked={appRoute.kind === "grant"}
      grantAddress={appRoute.kind === "grant" ? appRoute.grant : grantAddress}
      grantSnapshot={displayedGrantSnapshot}
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
  const canonicalStudioBoardroom = appRoute.kind === "studio-project" ? appRoute.boardroom : undefined;
  const displayedBoardroomSnapshot = canonicalStudioBoardroom
    ? boardroomSnapshot?.address.toLowerCase() === canonicalStudioBoardroom.toLowerCase() ? boardroomSnapshot : undefined
    : boardroomSnapshot;
  const boardroomToolsPanel = (
    <Suspense fallback={<div aria-live="polite" className="border-y border-zinc-800 py-6 text-sm text-zinc-500">Loading operator tools…</div>}>
    <BoardroomPanel
      section={appRoute.kind === "studio-project" ? appRoute.section : "setup"}
      boardroomIdentityLocked={appRoute.kind === "studio-project"}
      capabilities={boardroomPanelCapabilities}
      boardroom={{
        address: canonicalStudioBoardroom ?? boardroomAddress,
        form: boardroomForm,
        mintAmount: boardroomMintAmount,
        mintTo: boardroomMintTo,
        predicted: predictedBoardroom,
        snapshot: displayedBoardroomSnapshot,
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
      merkleAirdrop={{
        address: merkleAirdropAddress,
        form: merkleAirdropForm,
        predicted: predictedMerkleAirdrop,
        snapshot: merkleAirdropSnapshot,
        cancel: cancelMerkleAirdrop,
        close: closeMerkleAirdrop,
        create: createMerkleAirdrop,
        load: loadMerkleAirdrop,
        predict: predictMerkleAirdrop,
        setMerkleAirdropAddress: updateMerkleAirdropAddress,
        setMerkleAirdropForm,
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
        claimRedemptionAsset: claimBoardroomRedemptionAsset,
        openRedemptions,
        redeemShares: redeemBoardroomShares,
        registerRedeemableAsset,
        setForm: setWindDownForm,
        start: startWindDown,
      }}
      workflow={{ deployment, pendingAction, runAction }}
    />
    </Suspense>
  );
  const discoveryPendingAction = pendingAction ?? (autoDiscoveryPending ? "scan-discovery" : undefined);
  const discoveryPanel = (
    <DiscoveryPanel
      account={wallet.account}
      deployment={deployment}
      discovery={discovery}
      discoveryForm={discoveryForm}
      pendingAction={discoveryPendingAction}
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
      pendingAction={discoveryPendingAction}
      inspectGrant={inspectDiscoveredGrant}
      scanDiscovery={scanWalletAccess}
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

  const governanceQueueControls = exactProjectDashboard?.snapshot.launched ? (
    <GovernanceQueue
      account={wallet.account}
      actions={queuedBoardroomActions}
      capabilities={projectCapabilities}
      pendingAction={pendingAction}
      runAction={runAction}
      submitTransaction={submitContractTransaction}
    />
  ) : undefined;
  const governanceLaunchControls = exactProjectDashboard && !exactProjectDashboard.snapshot.launched ? (
    <GovernanceLaunchControl
      account={wallet.account}
      boardroom={exactProjectDashboard.address}
      capabilities={projectCapabilities}
      currentExecutor={exactProjectDashboard.snapshot.executor}
      minimumDelay={exactProjectDashboard.snapshot.governanceConfig.minimumDelay}
      pendingAction={pendingAction}
      runAction={runAction}
      submitTransaction={submitContractTransaction}
      onComplete={async () => {
        productGovernanceLoadedKeyRef.current = undefined;
        await loadProductBoardroom(exactProjectDashboard.address);
      }}
    />
  ) : undefined;
  const retryGovernanceAction = productGovernanceError && exactProjectDashboard ? (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        productGovernanceLoadedKeyRef.current = undefined;
        void loadProductGovernance(exactProjectDashboard.address);
      }}
    >
      Retry governance
    </Button>
  ) : undefined;
  const exactProjectPool = exactProjectDashboard?.histories?.find((history) => history.pool)?.pool
    ?? exactProjectDashboard?.history?.pool
    ?? exactProjectDashboard?.catalog.find((entry) => sameAddress(entry.address, exactProjectDashboard.address))?.pool;
  const exactProjectPoolRef = useRef<Address | undefined>(exactProjectPool);
  exactProjectPoolRef.current = exactProjectPool;
  useEffect(() => {
    if (appRoute.kind !== "project" || appRoute.section !== "participate" || !exactProjectPool) return;
    const pool = swapTokenList.pools.find((candidate) => sameAddress(candidate.address, exactProjectPool));
    if (!pool) return;
    setSwapForm((current) => {
      const alreadyScoped = (sameAddress(current.tokenIn as Address, pool.token0) && sameAddress(current.tokenOut as Address, pool.token1))
        || (sameAddress(current.tokenIn as Address, pool.token1) && sameAddress(current.tokenOut as Address, pool.token0));
      return alreadyScoped ? current : { ...current, tokenIn: pool.token0, tokenOut: pool.token1 };
    });
    setSwapQuote((current) => current?.pool && sameAddress(current.pool.address, exactProjectPool) ? current : undefined);
  }, [appRoute, exactProjectPool, swapTokenList.pools]);
  const participationContent = exactProjectDashboard ? {
    ...createParticipationFlowContent({
      account: wallet.account,
      dashboard: exactProjectDashboard,
      pendingAction,
      publicClient,
      runAction,
      submitTransaction: submitContractTransaction,
    }),
    ...(exactProjectPool ? { amm: marketPanel } : {}),
  } : {};
  const portfolioTasks = walletPortfolioTasks({
    account: wallet.account,
    discovery,
    inspectGrant: inspectDiscoveredGrant,
    openBoardroom: useDiscoveredBoardroom,
  });
  const studioDirectory = productBoardroom?.catalog.length ? (
    <ol className="m-0 list-none border-t border-zinc-800 p-0">
      {productBoardroom.catalog.map((project) => (
        <li className="border-b border-zinc-800" key={project.address}>
          <a
            className="flex w-full items-center justify-between gap-4 px-3 py-4 text-left transition-colors hover:bg-zinc-900/45"
            href={appRouteHref({ kind: "studio-project", chainId: activeNetwork.chainId, boardroom: project.address, section: "setup" })}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              updateBoardroomAddress(project.address);
              navigateRoute({ kind: "studio-project", chainId: activeNetwork.chainId, boardroom: project.address, section: "setup" });
            }}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-zinc-100">{project.name ?? project.symbol ?? "Project"}</span>
              <span className="mt-1 block truncate text-xs text-zinc-500">{project.symbol ?? "Boardroom"} · {shortAddress(project.address)}</span>
            </span>
            <span className="text-xs font-semibold text-lime-200">Open Studio</span>
          </a>
        </li>
      ))}
    </ol>
  ) : undefined;

  const renderActiveWorkspace = (): React.JSX.Element | null => {
    const routeChainId = appRouteChainId(appRoute);
    if (routeChainId !== undefined && !supportedNetworkForChainId(routeChainId)) {
      return (
        <NotFoundPage
          title="Unsupported network"
          description={`pledge.cash is not configured for chain ${routeChainId.toString()} in this build.`}
          returnHref={appRouteHref({ kind: "explore", chainId: activeNetwork.chainId })}
          onReturn={() => navigateRoute({ kind: "explore", chainId: activeNetwork.chainId })}
        />
      );
    }

    switch (appRoute.kind) {
      case "explore":
        return (
          <ExplorePage
            chainId={activeNetwork.chainId}
            chainName={activeNetwork.name}
            emptyAction={<Button onClick={() => navigateRoute({ kind: "studio", chainId: activeNetwork.chainId })}>Open Studio</Button>}
            error={productBoardroomError}
            loading={productBoardroomLoading}
            projects={productBoardroom?.catalog ?? []}
            onOpenProject={(project) => navigateRoute({ kind: "project", chainId: activeNetwork.chainId, boardroom: project.address, section: "overview" })}
            onRetry={() => void loadProductBoardroom()}
            projectHref={(project) => projectRouteHref(activeNetwork.chainId, project.address)}
          />
        );
      case "project":
        return (
          <ProjectLayout
            account={wallet.account}
            activeSection={appRoute.section}
            chainName={activeNetwork.name}
            dashboard={exactProjectDashboard}
            error={productBoardroomError}
            loading={productBoardroomLoading}
            mastheadAction={
              exactProjectDashboard ? (
                <Button variant="secondary" onClick={() => navigateRoute({ kind: "studio-project", chainId: appRoute.chainId, boardroom: appRoute.boardroom, section: "setup" })}>
                  Open Studio
                </Button>
              ) : undefined
            }
            onNavigateSection={(section) => navigateRoute({ kind: "project", chainId: appRoute.chainId, boardroom: appRoute.boardroom, section })}
            onRetry={() => void loadProductBoardroom(appRoute.boardroom)}
            sectionHref={(section) => projectRouteHref(appRoute.chainId, appRoute.boardroom, section)}
          >
            {appRoute.section === "overview" ? (
              <ProjectOverviewPage
                account={wallet.account}
                dashboard={exactProjectDashboard}
                loading={productBoardroomLoading}
                onOpenParticipation={() => navigateRoute({ kind: "project", chainId: appRoute.chainId, boardroom: appRoute.boardroom, section: "participate" })}
                onRefresh={() => void loadProductBoardroom(appRoute.boardroom)}
              />
            ) : appRoute.section === "participate" ? (
              <ParticipatePage
                content={participationContent}
                dashboard={exactProjectDashboard}
                error={productBoardroomError}
                loading={productBoardroomLoading}
              />
            ) : appRoute.section === "governance" ? (
              <GovernancePage
                activityContent={sentinelBaseUrl ? <GovernanceActivity boardroom={appRoute.boardroom} chainId={appRoute.chainId} /> : undefined}
                dashboard={exactProjectDashboard}
                error={productGovernanceError}
                holderPower={boardroomHolderPower}
                loading={productBoardroomLoading || productGovernanceLoading}
                primaryAction={retryGovernanceAction}
                queueContent={governanceQueueControls}
              />
            ) : (
              <TransparencyPage
                dashboard={exactProjectDashboard}
                error={productBoardroomError}
                loading={productBoardroomLoading}
              />
            )}
          </ProjectLayout>
        );
      case "portfolio":
        return (
          <PortfolioPage
            account={wallet.account}
            connectAction={wallet.account ? undefined : <ConnectWalletButton />}
            discoveryContent={walletAccessPanel}
            error={discovery.errors.length ? discovery.errors.join(" ") : undefined}
            loading={Boolean(discoveryPendingAction)}
            refreshAction={wallet.account ? <Button variant="secondary" onClick={() => void runAction("scan-wallet-access", scanWalletAccess)}>Refresh portfolio</Button> : undefined}
            tasks={portfolioTasks}
          />
        );
      case "grant":
        return (
          <GrantDetailPage
            account={wallet.account}
            grant={appRoute.grant}
            onBack={() => navigateRoute({ kind: "portfolio", chainId: appRoute.chainId })}
          >
            {grantPanel}
          </GrantDetailPage>
        );
      case "studio":
      case "studio-project": {
        const selectedDashboard = appRoute.kind === "studio-project" ? exactProjectDashboard : undefined;
        const exactOperatorStateReady = appRoute.kind !== "studio-project"
          || appRoute.section === "governance"
          || Boolean(selectedDashboard && displayedBoardroomSnapshot && sameAddress(displayedBoardroomSnapshot.address, appRoute.boardroom));
        const operatorTools = !exactOperatorStateReady ? (
          <PageNotice title="Loading the exact project state">
            Studio will not expose transaction controls until the loaded Boardroom matches this canonical project URL.
          </PageNotice>
        ) : appRoute.kind === "studio" && !wallet.account ? (
          <PageNotice title="Connect the operator wallet">
            Studio keeps transaction controls hidden until a wallet is connected. The project’s public state remains available in its Overview and Transparency pages.
          </PageNotice>
        ) : appRoute.kind === "studio-project" && appRoute.section === "governance" ? (
          <GovernancePage
            dashboard={selectedDashboard}
            error={productGovernanceError}
            holderPower={boardroomHolderPower}
            loading={productBoardroomLoading || productGovernanceLoading}
            primaryAction={retryGovernanceAction}
            queueContent={governanceQueueControls ?? governanceLaunchControls}
          />
        ) : appRoute.kind === "studio-project" && appRoute.section === "liquidity" ? (
          <div className="grid gap-4">{boardroomToolsPanel}{marketPanel}</div>
        ) : boardroomToolsPanel;
        return (
          <StudioPage
            account={wallet.account}
            dashboard={selectedDashboard}
            error={productBoardroomError ?? (appRoute.kind === "studio-project" && appRoute.section === "close" ? productGovernanceError : undefined)}
            loading={productBoardroomLoading}
            createAction={appRoute.kind === "studio" ? (
              wallet.account ? (
                <Button onClick={() => document.getElementById("studio-operator-tools")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  Start project setup
                </Button>
              ) : <ConnectWalletButton />
            ) : undefined}
            onRetry={appRoute.kind === "studio-project"
              ? () => {
                  void loadProductBoardroom(appRoute.boardroom);
                  if (appRoute.section === "close") {
                    productGovernanceLoadedKeyRef.current = undefined;
                    void loadProductGovernance(appRoute.boardroom);
                  }
                }
              : () => void loadProductBoardroom()}
            operatorTools={operatorTools}
            projectDirectoryContent={appRoute.kind === "studio" ? studioDirectory : undefined}
            showLifecycleOverview={appRoute.kind === "studio" || appRoute.section === "setup"}
            sectionNavigation={appRoute.kind === "studio-project" ? (
              <StudioSectionNav
                active={appRoute.section}
                boardroom={appRoute.boardroom}
                chainId={appRoute.chainId}
                onNavigate={(section) => navigateRoute({ kind: "studio-project", chainId: appRoute.chainId, boardroom: appRoute.boardroom, section })}
              />
            ) : undefined}
          />
        );
      }
      case "alerts":
        return <SentinelSettingsView governanceChainId={activeNetwork.chainId} wallet={wallet} />;
      case "tools":
        return <AdvancedWorkspace>{diagnosticsPanel}{directGrantPanel}{discoveryPanel}</AdvancedWorkspace>;
      case "legacy-project":
        return <RedirectState destination="Project workspace" />;
      case "not-found":
        return (
          <NotFoundPage
            returnHref={appRouteHref({ kind: "explore", chainId: activeNetwork.chainId })}
            onReturn={() => navigateRoute({ kind: "explore", chainId: activeNetwork.chainId })}
          />
        );
    }
  };

  return (
    <div className="min-h-svh text-[var(--pc-text)]">
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

      <div className="sticky top-14 z-20 hidden border-b border-[var(--pc-border)] bg-[color:var(--pc-canvas-translucent)] px-5 py-2 backdrop-blur-xl md:block">
        <div className="mx-auto flex w-full max-w-[1240px] items-center justify-between">
          <DesktopPrimaryNav
            active={primaryDestination(appRoute)}
            chainId={activeNetwork.chainId}
            onNavigate={(destination) => navigateRoute(primaryRoute(destination, activeNetwork.chainId))}
          />
          {appRoute.kind === "project" || appRoute.kind === "studio-project" ? (
            <span className="font-mono text-[11px] text-[var(--pc-text-subtle)]">{shortAddress(appRoute.boardroom)}</span>
          ) : null}
        </div>
      </div>

      <main className="mobile-nav-safe-area min-h-[calc(100svh-56px)] md:pb-0">
        <section className="page-enter mx-auto w-full max-w-[1240px] min-w-0 px-4 py-5 sm:px-6 sm:py-7">
          <Suspense fallback={<div aria-live="polite" className="border-y border-zinc-800 py-8 text-sm text-zinc-500">Loading workspace…</div>}>
            {renderActiveWorkspace()}
          </Suspense>
        </section>
      </main>
      <MobilePrimaryNav
        active={primaryDestination(appRoute)}
        chainId={activeNetwork.chainId}
        onNavigate={(destination) => navigateRoute(primaryRoute(destination, activeNetwork.chainId))}
      />
      <TransactionReview review={review} approve={approveReview} cancel={cancelReview} />
      <TransactionTray records={transactions} clearSettled={clearSettled} />
    </div>
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
  if (dashboard && sameAddress(grantSnapshot.issuer, dashboard.address)) {
    if (dashboard.snapshot.status === 1) return true;
    if (dashboard.snapshot.status !== 0) return false;
    const authority = dashboard?.snapshot.launched ? dashboard.snapshot.executor : dashboard?.snapshot.owner;
    if (sameAddress(account, authority)) return true;
  }
  if (grantIssuerBoardroom && sameAddress(grantSnapshot.issuer, grantIssuerBoardroom.boardroom)) {
    if (grantIssuerBoardroom.status === 1) return true;
    if (grantIssuerBoardroom.status !== 0) return false;
    const authority = grantIssuerBoardroom?.launched ? grantIssuerBoardroom.executor : grantIssuerBoardroom?.owner;
    if (sameAddress(account, authority)) return true;
  }
  if (!boardroomSnapshot || !sameAddress(grantSnapshot.issuer, boardroomSnapshot.address)) return false;
  if (boardroomSnapshot.status === 1) return true;
  if (boardroomSnapshot.status !== 0) return false;
  const authority = boardroomSnapshot?.launched ? boardroomSnapshot.executor : boardroomSnapshot?.owner;
  return sameAddress(account, authority);
}

function boardroomCallsFromExecution(request: Record<string, unknown>): readonly BoardroomCall[] {
  const args = request.args;
  if (!Array.isArray(args)) throw new Error("Boardroom execution is missing its calls.");
  if (request.functionName === "execute") {
    const call = args[0];
    if (!call || typeof call !== "object") throw new Error("Boardroom execution is missing its call.");
    return [call as BoardroomCall];
  }
  if (request.functionName === "executeBatch") {
    const calls = args[0];
    if (!Array.isArray(calls) || calls.length === 0) throw new Error("Boardroom execution batch is empty.");
    return calls as BoardroomCall[];
  }
  throw new Error("Expected a Boardroom execute or executeBatch transaction.");
}

function walletPortfolioTasks({
  account,
  discovery,
  inspectGrant,
  openBoardroom,
}: {
  account: Address | undefined;
  discovery: DiscoverySnapshot;
  inspectGrant: (grant: Address) => void;
  openBoardroom: (boardroom: Address) => void;
}): PortfolioTask[] {
  if (!account) return [];
  const tasks: PortfolioTask[] = [];
  for (const grant of Object.values(discovery.grantsByAddress)) {
    if (!sameAddress(grant.currentHolder, account)) continue;
    tasks.push({
      id: `grant:${grant.grantAddress}`,
      title: grant.closed ? "Grant record" : "Review token grant",
      description: grant.closed
        ? "This grant is closed and remains available as an onchain record."
        : "Check vesting, the settleable amount, payment requirements, and expiry.",
      project: shortAddress(grant.issuer),
      status: grant.closed ? "complete" : "attention",
      action: <Button size="sm" variant="secondary" onClick={() => inspectGrant(grant.grantAddress)}>Open grant</Button>,
    });
  }
  for (const boardroom of Object.values(discovery.boardroomsByAddress)) {
    if (!sameAddress(boardroom.owner, account)) continue;
    tasks.push({
      id: `boardroom:${boardroom.boardroom}`,
      title: `Operate ${boardroom.name || boardroom.symbol || "project"}`,
      description: "This wallet is the recorded project owner. Studio shows the next lifecycle-safe operation.",
      project: boardroom.symbol,
      status: "informational",
      action: <Button size="sm" variant="secondary" onClick={() => openBoardroom(boardroom.boardroom)}>Open Studio</Button>,
    });
  }
  return tasks;
}

function capabilityLifecycle(status: number): NonNullable<ProjectCapabilityContext["project"]>["status"] {
  if (status === 0) return "active";
  if (status === 1) return "winding-down";
  if (status === 2) return "redemptions-open";
  return "closed";
}

function walletWriteCapability(
  account: Address | undefined,
  walletChainId: number | undefined,
  routeChainId: number,
): Capability {
  if (!account) return { status: "connect", reason: "Connect a wallet to continue." };
  if (walletChainId !== routeChainId) {
    return { status: "switch", reason: `Switch your wallet to chain ${routeChainId.toString()} to continue.` };
  }
  return { status: "enabled" };
}

function boardroomLaunchReady(snapshot: BoardroomSnapshot): boolean {
  const decimals = snapshot.shareTokenMetadata?.decimals ?? 18;
  return snapshot.governanceEligibleSupply >= 10n ** BigInt(decimals);
}

function participationCapabilityOpportunities(
  dashboard: ProductBoardroomDashboardState | undefined,
): NonNullable<ProjectCapabilityContext["opportunities"]> {
  const opportunities: NonNullable<ProjectCapabilityContext["opportunities"]> = {};
  for (const distribution of dashboard?.snapshot.distributionSummaries ?? []) {
    if (!distribution.state) continue;
    if (distribution.kind === "fixed-price-sale" && "saleStatus" in distribution.state) {
      const available = distribution.state.saleStatus === 0 && !distribution.state.closed && distribution.state.remainingShares > 0n;
      opportunities["participate.fixedSale.buy"] = mergeCapabilityOpportunity(
        opportunities["participate.fixedSale.buy"],
        { available, ...(!available ? { reason: "The fixed-price sale is not accepting purchases." } : {}) },
      );
    }
    if (distribution.kind === "migrating-bonding-curve" && "curveStatus" in distribution.state) {
      const available = distribution.state.curveStatus === 0 && !distribution.state.closed;
      opportunities["participate.curve.buy"] = mergeCapabilityOpportunity(
        opportunities["participate.curve.buy"],
        {
          available: available && distribution.state.remainingSaleShares > 0n,
          ...(!available || distribution.state.remainingSaleShares === 0n ? { reason: "The curve is no longer selling project tokens." } : {}),
        },
      );
      opportunities["participate.curve.sell"] = mergeCapabilityOpportunity(
        opportunities["participate.curve.sell"],
        { available, ...(!available ? { reason: "The curve is no longer accepting sells." } : {}) },
      );
    }
    if (distribution.kind === "merkle-airdrop" && "airdropStatus" in distribution.state) {
      const available = distribution.state.airdropStatus === 0 && !distribution.state.closed && distribution.state.remainingShares > 0n;
      const opportunity = { available, ...(!available ? { reason: "The airdrop claim window is not active." } : {}) };
      opportunities["participate.airdrop.claim"] = mergeCapabilityOpportunity(
        opportunities["participate.airdrop.claim"],
        opportunity,
      );
      opportunities["participate.airdrop.claimGrant"] = mergeCapabilityOpportunity(
        opportunities["participate.airdrop.claimGrant"],
        opportunity,
      );
    }
  }
  const hasAmm = Boolean(dashboard?.history?.pool || dashboard?.snapshot.lockedLiquiditySummaries.some((locker) => locker.state?.pool));
  opportunities["participate.amm.swap"] = {
    available: hasAmm,
    ...(!hasAmm ? { reason: "No project AMM pool has been discovered." } : {}),
  };
  return opportunities;
}

export function mergeCapabilityOpportunity(
  current: CapabilityOpportunity | undefined,
  next: CapabilityOpportunity,
): CapabilityOpportunity {
  if (!current) return next;
  if (current.available || next.available) return { available: true };
  return { available: false, reason: current.reason ?? next.reason };
}

function appRouteChainId(route: AppRoute): number | undefined {
  return "chainId" in route ? route.chainId : undefined;
}

function governanceRouteKey(route: AppRoute, account: Address | undefined): string | undefined {
  const governanceRoute = (route.kind === "project" && route.section === "governance")
    || (route.kind === "studio-project" && (route.section === "governance" || route.section === "close"));
  if (!governanceRoute) return undefined;
  return `${route.chainId.toString()}:${route.boardroom.toLowerCase()}:${account?.toLowerCase() ?? "read-only"}`;
}

function isCanonicalAppRoute(route: AppRoute): route is CanonicalAppRoute {
  return route.kind !== "legacy-project" && route.kind !== "not-found";
}

function appRouteView(route: AppRoute): AppView {
  switch (route.kind) {
    case "portfolio":
    case "grant":
      return "wallet";
    case "studio":
    case "studio-project":
      return "manage";
    case "project":
      if (route.section === "participate") return "market";
      if (route.section === "governance" || route.section === "transparency") return "activity";
      return "project";
    case "legacy-project":
      if (route.surface === "studio") return "manage";
      if (route.section === "participate") return "market";
      if (route.section === "governance" || route.section === "transparency") return "activity";
      return "project";
    case "alerts":
      return "notifications";
    case "tools":
      return "advanced";
    case "explore":
    case "not-found":
      return "project";
  }
}

function routeUsesProductData(route: AppRoute): boolean {
  return route.kind === "explore"
    || route.kind === "project"
    || route.kind === "studio"
    || route.kind === "studio-project"
    || route.kind === "legacy-project";
}

function legacyProjectDestination(
  route: Extract<AppRoute, { kind: "legacy-project" }>,
  chainId: number,
  boardroom: Address,
): CanonicalAppRoute {
  if (route.surface === "studio") {
    const section = ["setup", "token", "grants", "distributions", "liquidity", "governance", "close"].includes(route.section)
      ? route.section as Extract<CanonicalAppRoute, { kind: "studio-project" }>["section"]
      : "setup";
    return { kind: "studio-project", chainId, boardroom, section };
  }
  const section = ["overview", "participate", "governance", "transparency"].includes(route.section)
    ? route.section as Extract<CanonicalAppRoute, { kind: "project" }>["section"]
    : "overview";
  return { kind: "project", chainId, boardroom, section };
}

function primaryRoute(destination: PrimaryDestination, chainId: number): CanonicalAppRoute {
  if (destination === "portfolio") return { kind: "portfolio", chainId };
  if (destination === "studio") return { kind: "studio", chainId };
  return { kind: "explore", chainId };
}
