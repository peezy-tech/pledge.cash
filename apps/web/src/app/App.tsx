import {
  boardroomControllerAbi,
  assertLiveBoardroomControlRelease,
  assertLiveProtocolFacetRelease,
  buildBoardroomBondMarketBatch,
  buildBoardroomBondMarketCloseAction,
  buildBoardroomBeginSnapshotTransaction,
  buildBoardroomBurnTreasurySharesTransaction,
  buildBoardroomClaimRedemptionAssetTransaction,
  buildBoardroomCreateTransaction,
  buildBoardroomExecuteTransaction,
  buildBoardroomDutchAuctionBatch,
  buildBoardroomDutchAuctionCancelAction,
  buildBoardroomDutchAuctionCloseAction,
  buildBoardroomFixedPriceSaleBatch,
  buildBoardroomFixedPriceSaleCancelAction,
  buildBoardroomFixedPriceSaleCloseAction,
  buildBoardroomGrantApprovalCall,
  buildBoardroomGrantCreationCall,
  buildBoardroomLockedLiquidityBatch,
  buildBoardroomLockedLiquidityAddBatch,
  buildBoardroomLockedLiquidityCloseAction,
  buildBoardroomCloseProtocolLiquidityTransaction,
  buildBoardroomLockedLiquidityExitTransaction,
  buildBoardroomLaunchTransaction,
  buildBoardroomLockedLiquidityFeeClaimAction,
  buildBoardroomLockedLiquidityRemoveAction,
  buildBoardroomMerkleAirdropBatch,
  buildBoardroomMerkleAirdropCancelAction,
  buildBoardroomMerkleAirdropCloseAction,
  buildBoardroomMigratingCurveBatch,
  buildBoardroomMigratingCurveCancelAction,
  buildMigratingBondingCurveExpireTransaction,
  buildMigratingBondingCurveFallbackTransaction,
  buildMigratingBondingCurveFinalizeForfeitureTransaction,
  buildMigratingBondingCurveFinalizeUnwindTransaction,
  buildMigratingBondingCurveMigrationTransaction,
  buildMigratingBondingCurveOpenForfeitureTransaction,
  buildMigratingBondingCurveRecoverForfeitedQuoteTransaction,
  buildMigratingBondingCurveRecoverQuoteTransaction,
  buildMigratingBondingCurveVetoForfeitureTransaction,
  buildBoardroomMintCall,
  buildBoardroomMigrateTransaction,
  buildBoardroomOpenRedemptionsTransaction,
  buildBoardroomPruneObligationTransaction,
  buildBoardroomPruneObligationsTransaction,
  buildBoardroomRedeemTransaction,
  buildBoardroomRegisterRedeemableAssetTransaction,
  buildBoardroomReplaceControllerCall,
  buildBoardroomShareGrantIssuanceBatch,
  buildBoardroomSnapshotAssetsTransaction,
  buildBoardroomStartWindDownTransaction,
  buildDirectGrantCreationTransaction,
  buildDutchAuctionFinalizeTransaction,
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
  predictBondMarketAddress as sdkPredictBondMarketAddress,
  predictBoardroomGrantAddress as sdkPredictBoardroomGrantAddress,
  predictDirectGrantAddress as sdkPredictDirectGrantAddress,
  predictDutchAuctionAddress as sdkPredictDutchAuctionAddress,
  predictFixedPriceSaleAddress as sdkPredictFixedPriceSaleAddress,
  predictLockedLiquidityAddress as sdkPredictLockedLiquidityAddress,
  predictBoardroomControllerAddress,
  predictMerkleAirdropAddress as sdkPredictMerkleAirdropAddress,
  predictMigratingBondingCurveAddress as sdkPredictMigratingBondingCurveAddress,
  planBoardroomCallExecution,
  readBoardroomState,
  readBoardroomStakerPower,
  readBondMarketState,
  readDutchAuctionState,
  readFixedPriceSaleState,
  readGrantState,
  readGrantSettlementQuote,
  readLockedLiquidityState,
  readMerkleAirdropState,
  readMigratingBondingCurveState,
  tokenGrantAbi,
  type Address,
  type BondMarketState,
  type BondMarketTerms,
  type BoardroomFixedPriceSaleTerms,
  type BoardroomDutchAuctionTerms,
  type BoardroomCall,
  type BoardroomStakerPower,
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
  type DutchAuctionState,
  type FixedPriceSaleState,
  type GrantCreationTerms,
  type LockedLiquidityState,
  type MerkleAirdropState,
  type MigratingBondingCurveState,
  type PledgeCashDeployment,
  type ScheduledBoardroomOperation,
} from "@pledge.cash/sdk";
import { Star } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, formatUnits, type Hex, type PublicClient, type WalletClient } from "viem";
import { TransactionReview } from "../components/transaction-review";
import { ConnectWalletButton } from "../components/simplekit";
import { Button, ButtonLink } from "../components/ui/button";
import {
  resolveProjectCapabilities,
  type Capability,
  type CapabilityOpportunity,
  type ProjectCapabilityContext,
  type ProjectCapabilityMap,
} from "../features/capabilities/project-capabilities";
import type { BoardroomPanelCapabilities } from "../features/boardrooms/boardroom-panel-types";
import { BoardroomRewardsPanel } from "../features/rewards";
import { RecurringSupportPanel } from "../features/support";
import { GovernanceLaunchControl, GovernanceOperations, GovernanceProposalComposer } from "../features/governance";
import {
  prepareSmartGrantSettlement,
  submitPreparedGrantSettlement,
  type GrantSettlementTicket,
} from "../features/grants/smart-settlement";
import { createParticipationFlowContent, participationAmmKey, type ParticipationContentKey } from "../features/participation";
import { AppHeader, type NetworkDeploymentAvailability } from "../features/wallet/app-header";
import { HyperliquidRecoveryCenter } from "../features/x402";
import { useActionRunner } from "../hooks/use-action-runner";
import { useFactorySnapshot } from "../hooks/use-factory-snapshot";
import {
  useRuntimeDeploymentAvailability,
  type RuntimeDeploymentAvailability,
  type RuntimeDeploymentAvailabilityStatus,
} from "../hooks/use-runtime-deployment";
import { useSavedProjects } from "../hooks/use-saved-projects";
import { useTransactionReview } from "../hooks/use-transaction-review";
import { useWagmiWallet } from "../hooks/use-wagmi-wallet";
import { readBoardroomSnapshot } from "../lib/boardroom-snapshot";
import {
  assertCanonicalFixedPriceSale,
  assertCanonicalDutchAuction,
  assertCanonicalBondMarket,
  assertCanonicalBoardroom,
  assertCanonicalGrant,
  assertCanonicalLockedLiquidity,
  assertCanonicalMerkleAirdrop,
  assertCanonicalMigratingBondingCurve,
  CanonicalProvenanceError,
} from "../lib/canonical-provenance";
import {
  PLEDGE_CASH_NETWORKS,
  createPledgeCashPublicClient,
  initialSelectedNetwork,
  networkEnvironmentIdentity,
  networkForChainId,
  persistSelectedNetwork,
  supportedNetworkForChainId,
  syncSelectedNetworkSearch,
  type PledgeCashEnvironmentIdentity,
  type PledgeCashNetwork,
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
  defaultBondMarketForm,
  defaultCurveMigrationForm,
  defaultDutchAuctionForm,
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
import { boardroomControlReleaseSupport, deploymentRuntimeIdentity } from "../lib/deployment";
import {
  readProductBoardroomCatalogPage,
  readProductBoardroomDashboard,
  resolveProductBoardroomAddress,
  type ProductBoardroomCatalogEntry,
  type ProductBoardroomDashboardState,
} from "../lib/product-boardroom";
import {
  ProjectPositionReadCoordinator,
  projectWalletPositionKey,
  readProjectWalletPosition,
  type ProjectPositionAction,
  type ProjectWalletPosition,
} from "../lib/project-position";
import { createSentinelClient, getSentinelBaseUrl } from "../lib/sentinel";
import { governanceRefreshDelay } from "../lib/governance-refresh";
import {
  assertProjectPoolAllowed,
  participationPoolAddress,
  projectPoolAddresses,
  scopeSwapTokenList,
} from "../lib/project-pools";
import {
  buildAddLiquidityTransaction,
  buildClaimAmmFeesTransaction,
  buildRemoveLiquidityTransaction,
  buildSwapTransaction,
  assertFutureSwapDeadline,
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
import {
  confirmedRefreshIsBlocked,
  confirmedReceiptInvalidationPlan,
  confirmedScopedRefreshNeedsRetry,
  monitorTransactionReceipt,
  receiptBackgroundRetryDelay,
  transactionReceiptMonitorKey,
  TransactionReceiptCoordinator,
  TransactionReceiptFinalizedError,
  TransactionReceiptMonitoringCancelledError,
  TransactionReceiptMonitoringDeferredError,
  type ScopedRefreshLoadResult,
  type TransactionReceiptOutcome,
} from "../lib/transaction-receipts";
import {
  actionInputIdentity,
  assertTransactionActionCurrent,
  assertTransactionIdentity,
  transactionContextIdentity,
  TransactionContextGuard,
  type TransactionActionGuard,
  type TransactionIdentity,
} from "../lib/transaction-identity";
import {
  HYPEREVM_TESTNET_CHAIN_ID,
  getX402RouterConfig,
} from "../lib/x402-router";
import {
  TransactionTray,
  useTransactionCenter,
  type TransactionRecord,
} from "../features/transactions/transaction-center";
import type {
  BoardroomForm,
  BondMarketForm,
  BoardroomGrantForm,
  BoardroomSnapshot,
  CurveMigrationForm,
  DiscoveryForm,
  DiscoverySnapshot,
  DutchAuctionForm,
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
  grantReturnRoute,
  governanceWatchHref,
  initialRoute,
  primaryDestination,
  projectGrantRoute,
  projectRouteHref,
  routeFromLocation,
  type AppRoute,
  type AppView,
  type CanonicalAppRoute,
  type PrimaryDestination,
  type StudioSection,
} from "./routing";
import { DesktopPrimaryNav, MobilePrimaryNav, StudioSectionNav } from "./product-navigation";
import { confirmedRouteRefreshPlan } from "./confirmed-route-refresh";
import { exploreSearchHref, exploreSearchState } from "./pages/explore-page";
import {
  AlertsUnavailablePage,
  ExplorePage,
  GovernancePage,
  GrantDetailPage,
  GrantVerificationFailureState,
  GrantVerificationLoadingState,
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

const useCommittedLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
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
const GOVERNANCE_LOAD_DEADLINE_MS = 30_000;
const AMM_TOKEN_LOAD_DEADLINE_MS = 30_000;
const TRANSACTION_RECEIPT_WAIT_TIMEOUT_MS = 60_000;
const X402_ROUTER_CONFIG = getX402RouterConfig();

type GrantIssuerAction = "stopVestingAndWithdrawUnvested" | "withdrawExpiredTokens";
type ActiveActionOrigin = {
  account: Address | undefined;
  chainId: number;
  contextGeneration: number;
  deploymentIdentity: string | undefined;
  routeIdentity: string;
};

export function verifiedAddressState<T extends { address: Address }>(
  state: T | undefined,
  verifiedKey: string | undefined,
  expectedKey: string | undefined,
  expectedAddress: Address | undefined,
): T | undefined {
  return state && verifiedKey && verifiedKey === expectedKey && expectedAddress
    && sameAddress(state.address, expectedAddress)
    ? state
    : undefined;
}

export function verifiedStudioChildState<T extends { boardroom: Address }>(
  state: T | undefined,
  verifiedKey: string | undefined,
  expectedKey: string | undefined,
  expectedBoardroom: Address | undefined,
): T | undefined {
  return state && verifiedKey && verifiedKey === expectedKey && expectedBoardroom
    && sameAddress(state.boardroom, expectedBoardroom)
    ? state
    : undefined;
}

export function requireVerifiedChildState<T extends { address: Address }>(
  state: T | undefined,
  expectedAddress: Address,
  label: string,
): T {
  if (!state || !sameAddress(state.address, expectedAddress)) {
    throw new Error(`Load and verify the current ${label} before managing it.`);
  }
  return state;
}

export function verifiedStateForKey<T>(
  state: T,
  verifiedKey: string | undefined,
  activeKey: string | undefined,
): T | undefined {
  return verifiedKey && verifiedKey === activeKey ? state : undefined;
}
export type GrantIssuerBoardroomAccess = {
  boardroom: Address;
  proposer: Address;
  launched: boolean;
  owner: Address;
  status: number;
};

type AmmReadKind = "token-list" | "swap-quote" | "liquidity-quote" | "position" | "remove-liquidity-quote";
export type AmmReadRequest = {
  key: string;
  kind: AmmReadKind;
  version: number;
};

export class AmmReadCoordinator {
  readonly #activeKeys = new Map<AmmReadKind, string>();
  readonly #versions = new Map<AmmReadKind, number>();

  sync(kind: AmmReadKind, key: string): void {
    if (this.#activeKeys.get(kind) === key) return;
    this.#activeKeys.set(kind, key);
    this.#versions.set(kind, (this.#versions.get(kind) ?? 0) + 1);
  }

  begin(kind: AmmReadKind, key: string): AmmReadRequest {
    const version = (this.#versions.get(kind) ?? 0) + 1;
    this.#versions.set(kind, version);
    return { key, kind, version };
  }

  isCurrent(request: AmmReadRequest): boolean {
    return this.#activeKeys.get(request.kind) === request.key
      && this.#versions.get(request.kind) === request.version;
  }

  invalidate(): void {
    for (const kind of this.#activeKeys.keys()) {
      this.#versions.set(kind, (this.#versions.get(kind) ?? 0) + 1);
    }
  }
}

export function ammReadIdentityKey(parts: readonly unknown[]): string {
  return JSON.stringify(parts);
}

type SwapTokenLoadScope = {
  key: string;
  mode: "global" | "pinned-only";
  pinnedPools: readonly Address[];
};

export function isGovernanceBackgroundRefresh(
  verifiedSnapshotKey: string | undefined,
  requestKey: string,
): boolean {
  return verifiedSnapshotKey === requestKey;
}

export function raceWithGovernanceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Governance loading was cancelled.", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new DOMException("Governance loading was cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
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

export type ProjectRouteFailure = {
  description: string;
  retryable: boolean;
  title: string;
};

export function projectRouteFailure(
  error: string,
  kind: "invalid" | "transient" = /not a Boardroom created by the configured BoardroomFactory/i.test(error)
    ? "invalid"
    : "transient",
): ProjectRouteFailure {
  if (kind === "invalid") {
    return {
      description: "This address is not a project created by the configured pledge.cash deployment on this network.",
      retryable: false,
      title: "Project not found",
    };
  }
  return {
    description: error,
    retryable: true,
    title: "Project temporarily unavailable",
  };
}

export function ProjectRouteFailureState({
  failure,
  onRetry,
  onReturn,
  returnHref,
}: {
  failure: ProjectRouteFailure;
  onRetry?: (() => void) | undefined;
  onReturn: () => void;
  returnHref: string;
}): React.JSX.Element {
  return (
    <div className="grid min-h-[58vh] place-items-center py-12">
      <div className="max-w-xl text-center">
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-600">Project verification</p>
        <h1 className="m-0 mt-2 text-3xl font-semibold tracking-[-0.025em] text-zinc-50">{failure.title}</h1>
        <p className="m-0 mt-3 text-sm leading-6 text-zinc-400">{failure.description}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <ButtonLink
            href={returnHref}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onReturn();
            }}
          >
            Return to Explore
          </ButtonLink>
          {failure.retryable && onRetry ? <Button variant="secondary" onClick={onRetry}>Retry verification</Button> : null}
        </div>
      </div>
    </div>
  );
}

function shouldLoadProductBoardroom({
  activeRoute,
  deployment,
  requestedAddress,
  productBoardroom,
  productBoardroomError,
  productBoardroomLoading,
  productCatalogLoaded,
}: {
  activeRoute: AppRoute;
  deployment: PledgeCashDeployment | undefined;
  requestedAddress: Address | undefined;
  productBoardroom: ProductBoardroomDashboardState | undefined;
  productBoardroomError: string | undefined;
  productBoardroomLoading: boolean;
  productCatalogLoaded: boolean;
}): boolean {
  if (!routeUsesProductData(activeRoute)) return false;
  if (!deployment?.boardroomFactory) return false;
  if (requestedAddress && productBoardroom?.address.toLowerCase() === requestedAddress.toLowerCase()) return false;
  if (!requestedAddress && productCatalogLoaded) return false;
  if (productBoardroomError || productBoardroomLoading) return false;
  return true;
}

function shouldLoadSwapTokens({
  deployment,
  loadScope,
  swapTokenList,
  swapTokenListLoading,
}: {
  deployment: PledgeCashDeployment | undefined;
  loadScope: SwapTokenLoadScope | undefined;
  swapTokenList: SwapTokenListState;
  swapTokenListLoading: boolean;
}): boolean {
  if (!loadScope) return false;
  if (!deployment?.ammFactory) return false;
  if (swapTokenList.loaded || swapTokenListLoading) return false;
  return true;
}

export function selectedParticipationPool(
  route: ParticipationContentKey | undefined,
  projectPools: readonly Address[],
): Address | undefined {
  return participationPoolAddress(route, projectPools);
}

export function studioProjectLiquidityQuote(
  quote: LiquidityQuoteState,
  projectPools: readonly Address[],
): LiquidityQuoteState {
  if (quote.error) return quote;
  try {
    assertProjectPoolAllowed(quote.pool, projectPools, "This liquidity quote");
    return quote;
  } catch (error) {
    return { ...quote, error: errorMessage(error) };
  }
}

export function studioProjectRemoveLiquidityQuote(
  quote: RemoveLiquidityQuoteState,
  projectPools: readonly Address[],
): RemoveLiquidityQuoteState {
  if (quote.error) return quote;
  try {
    assertProjectPoolAllowed(quote.position?.pool, projectPools, "This remove-liquidity quote");
    return quote;
  } catch (error) {
    return { ...quote, error: errorMessage(error) };
  }
}

export function projectSwapPoolAddresses(
  dashboard: ProductBoardroomDashboardState | undefined,
): Address[] {
  if (!dashboard) return [];
  const canonicalPoolKeys = new Set(
    projectPoolAddresses(dashboard).map((address) => address.toLowerCase()),
  );
  const candidates = [
    ...(dashboard.histories ?? []).map((history) => history.pool),
    ...dashboard.snapshot.lockedLiquiditySummaries.map((locker) => locker.state?.pool),
    dashboard.history?.pool,
    dashboard.catalog.find((entry) => sameAddress(entry.address, dashboard.address))?.pool,
  ];
  const seen = new Set<string>();
  const ordered: Address[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (!canonicalPoolKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    ordered.push(candidate);
  }
  return ordered;
}

function discoveryLoadedForWallet(discovery: DiscoverySnapshot, account: Address | undefined, chainId: number): boolean {
  return Boolean(discovery.loadedFor && sameAddress(discovery.loadedFor, account) && discovery.chainId === chainId);
}

function RuntimeDeploymentAvailabilityProbe({
  network,
  onAvailability,
}: {
  network: PledgeCashNetwork;
  onAvailability: (chainId: number, status: RuntimeDeploymentAvailabilityStatus) => void;
}): null {
  const generatedDeployment = useMemo(() => getPledgeCashDeployment(network.chainId), [network.chainId]);
  const availability = useRuntimeDeploymentAvailability(network.chainId, generatedDeployment);

  useEffect(() => {
    onAvailability(network.chainId, availability.status);
  }, [availability.status, network.chainId, onAvailability]);

  return null;
}

export function EnvironmentDisclosure({
  environment,
}: {
  environment: PledgeCashEnvironmentIdentity;
}): React.JSX.Element {
  return (
    <div
      aria-label={`${environment.label} environment disclosure`}
      className="border-b border-[var(--pc-border)] bg-[var(--pc-surface-subtle)] px-4 py-2 text-center text-xs leading-5 text-[var(--pc-text-muted)] sm:px-6"
      role="note"
    >
      <span className="font-semibold text-[var(--pc-text)]">{environment.label} environment.</span>{" "}
      {environment.description}
    </div>
  );
}

export function DeploymentUnavailablePage({
  availability,
  networkName,
}: {
  availability: RuntimeDeploymentAvailability;
  networkName: string;
}): React.JSX.Element {
  const pending = availability.status === "pending";
  const loading = availability.status === "loading";
  const title = loading
    ? "Checking deployment availability"
    : pending
      ? "Deployment pending"
      : availability.status === "missing"
        ? "Deployment not published"
        : "Deployment unavailable";
  const reason = availability.reason
    ?? (loading
      ? "The deployment artifact is still being checked."
      : "No usable deployment artifact is available for this network.");

  return (
    <div className="grid min-h-[58vh] place-items-center py-12">
      <div className="max-w-2xl text-center">
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-600">{networkName}</p>
        <h1 className="m-0 mt-2 text-3xl font-semibold tracking-[-0.025em] text-zinc-50">{title}</h1>
        <p className="m-0 mt-3 text-sm leading-6 text-zinc-400">{reason}</p>
        <p className="m-0 mt-2 text-sm leading-6 text-zinc-500">
          pledge.cash will not run discovery, contract reads, or wallet actions until this network reports a ready deployment.
        </p>
      </div>
    </div>
  );
}

export function shouldCanonicalizeAppRoute(route: AppRoute): route is CanonicalAppRoute {
  return isCanonicalAppRoute(route) && route.kind !== "alerts";
}

export function canonicalAppLocationHref(
  route: CanonicalAppRoute,
  location: Pick<Location, "hash" | "search">,
): string {
  const canonicalHref = appRouteHref(route);
  if (route.kind !== "explore") return canonicalHref;

  const canonicalUrl = new URL(canonicalHref, "https://pledge.cash");
  return exploreSearchHref(
    canonicalUrl.pathname,
    canonicalUrl.search,
    exploreSearchState(location.search),
    location.hash,
  );
}

export function routeRequiresReadyDeployment(route: AppRoute): boolean {
  return route.kind !== "alerts" && route.kind !== "not-found";
}

export function App(): React.JSX.Element {
  const { pendingAction, pushLog, runAction: runUnscopedAction } = useActionRunner();
  const { approveReview, cancelReview, requestReview, review } = useTransactionReview();
  const savedProjects = useSavedProjects();
  const [selectedChainId, setSelectedChainId] = useState(() => initialSelectedNetwork().chainId);
  const activeNetwork = useMemo(() => networkForChainId(selectedChainId), [selectedChainId]);
  const activeSavedProjects = useMemo(
    () => savedProjects.projects.filter((project) => project.chainId === activeNetwork.chainId),
    [activeNetwork.chainId, savedProjects.projects],
  );
  const activeSavedProjectAddresses = useMemo(
    () => new Set(activeSavedProjects.map((project) => project.boardroom.toLowerCase())),
    [activeSavedProjects],
  );
  const networkRequestVersion = useRef(0);
  const ammReadCoordinatorRef = useRef(new AmmReadCoordinator());
  const ammTokenLoadAbortControllerRef = useRef<AbortController | undefined>(undefined);
  const activeAmmTokenReadKeyRef = useRef("inactive");
  const activeSwapTokenLoadScopeRef = useRef<SwapTokenLoadScope | undefined>(undefined);
  const productCatalogLoadMoreAbortControllerRef = useRef<AbortController | undefined>(undefined);
  const productLoadAbortControllerRef = useRef<AbortController | undefined>(undefined);
  const projectPositionReadCoordinatorRef = useRef(new ProjectPositionReadCoordinator());
  const productRequestVersionRef = useRef(0);
  const discoveryWriteVersion = useRef(0);
  const grantLoadVersionRef = useRef(0);
  const boardroomLoadVersionRef = useRef(0);
  const bondMarketLoadVersionRef = useRef(0);
  const dutchAuctionLoadVersionRef = useRef(0);
  const fixedPriceSaleLoadVersionRef = useRef(0);
  const merkleAirdropLoadVersionRef = useRef(0);
  const migratingCurveLoadVersionRef = useRef(0);
  const lockedLiquidityLoadVersionRef = useRef(0);
  const governanceRequestVersionRef = useRef(0);
  const governanceLoadAbortControllerRef = useRef<AbortController | undefined>(undefined);
  const activeGovernanceKeyRef = useRef<string | undefined>(undefined);
  const productGovernanceLoadedKeyRef = useRef<string | undefined>(undefined);
  const productGovernanceSnapshotKeyRef = useRef<string | undefined>(undefined);
  const grantRouteLoadedKeyRef = useRef<string | undefined>(undefined);
  const watchedTransactionIdsRef = useRef(new Map<string, number>());
  const transactionReceiptCoordinatorRef = useRef(new TransactionReceiptCoordinator());
  const transactionReceiptRetryCountsRef = useRef(new Map<string, number>());
  const transactionReceiptRetryTimersRef = useRef(new Map<string, ReturnType<typeof globalThis.setTimeout>>());
  const transactionRefreshClaimIdsRef = useRef(new Set<string>());
  const transactionRefreshRetryCountsRef = useRef(new Map<string, number>());
  const transactionWatcherAbortControllerRef = useRef(new AbortController());
  const transactionWatcherIdentityRef = useRef<string | undefined>(undefined);
  const transactionWatcherVersionRef = useRef(0);
  const transactionReceiptMonitorMountedRef = useRef(false);
  const [transactionReceiptRetryGeneration, setTransactionReceiptRetryGeneration] = useState(0);
  const [transactionWatcherRenderGeneration, setTransactionWatcherRenderGeneration] = useState(0);
  useEffect(() => {
    transactionReceiptMonitorMountedRef.current = true;
    if (transactionWatcherAbortControllerRef.current.signal.aborted) {
      transactionWatcherAbortControllerRef.current = new AbortController();
      transactionWatcherVersionRef.current += 1;
      setTransactionWatcherRenderGeneration((generation) => generation + 1);
    }
    return () => {
      transactionReceiptMonitorMountedRef.current = false;
      globalThis.queueMicrotask(() => {
        if (transactionReceiptMonitorMountedRef.current) return;
        transactionWatcherAbortControllerRef.current.abort();
        for (const timer of transactionReceiptRetryTimersRef.current.values()) globalThis.clearTimeout(timer);
        transactionReceiptRetryTimersRef.current.clear();
      });
    };
  }, []);
  const activeChainIdRef = useRef(activeNetwork.chainId);
  activeChainIdRef.current = activeNetwork.chainId;
  const activeAccountRef = useRef<Address | undefined>(undefined);
  const activeWalletChainIdRef = useRef<number | undefined>(undefined);
  const walletClientRef = useRef<(() => WalletClient) | undefined>(undefined);
  const walletClientGenerationRef = useRef(0);
  const activeDiscoveryKeyRef = useRef<string | undefined>(undefined);
  const activeDeploymentIdentityRef = useRef<string | undefined>(undefined);
  const activeActionOriginRef = useRef<ActiveActionOrigin | undefined>(undefined);
  const invalidateSettledSharedStateRef = useRef<() => void>(() => undefined);
  const invalidateConfirmedScopedRouteRef = useRef<(route: AppRoute) => Promise<void>>(async () => undefined);
  const transactionContextGuardRef = useRef(new TransactionContextGuard("initial"));
  const publicClient = useMemo(() => createPledgeCashPublicClient(activeNetwork), [activeNetwork]);
  const generatedDeployment = useMemo(() => getPledgeCashDeployment(activeNetwork.chainId), [activeNetwork.chainId]);
  const runtimeDeploymentAvailability = useRuntimeDeploymentAvailability(activeNetwork.chainId, generatedDeployment);
  const deployment = runtimeDeploymentAvailability.status === "ready"
    ? runtimeDeploymentAvailability.deployment
    : undefined;
  const environment = networkEnvironmentIdentity(activeNetwork);
  const [networkDeploymentAvailability, setNetworkDeploymentAvailability] = useState<NetworkDeploymentAvailability>(() =>
    Object.fromEntries(PLEDGE_CASH_NETWORKS.map((network) => [network.chainId, "loading"])),
  );
  const reportNetworkDeploymentAvailability = useCallback((chainId: number, status: RuntimeDeploymentAvailabilityStatus): void => {
    setNetworkDeploymentAvailability((current) => current[chainId] === status
      ? current
      : { ...current, [chainId]: status });
  }, []);
  useEffect(() => {
    reportNetworkDeploymentAvailability(activeNetwork.chainId, runtimeDeploymentAvailability.status);
  }, [activeNetwork.chainId, reportNetworkDeploymentAvailability, runtimeDeploymentAvailability.status]);
  const discoveryDeploymentIdentity = deploymentDiscoveryIdentity(deployment);
  const runtimeDeploymentIdentity = deploymentRuntimeIdentity(deployment);
  const [appRoute, setAppRoute] = useState<AppRoute>(() => initialRoute());
  const activeRouteIdentity = appRouteIdentityKey(appRoute);
  const activeAppRouteRef = useRef<AppRoute>(appRoute);
  activeAppRouteRef.current = appRoute;
  const activeStudioReadScopeKey = studioReadScopeKey(appRoute, activeNetwork.chainId, runtimeDeploymentIdentity);
  const activeStudioReadScopeKeyRef = useRef(activeStudioReadScopeKey);
  activeStudioReadScopeKeyRef.current = activeStudioReadScopeKey;
  const runAction = useCallback(
    async (label: string, action: () => Promise<void>): Promise<void> => {
      await runUnscopedAction(label, async () => {
        const origin: ActiveActionOrigin = {
          account: activeAccountRef.current,
          chainId: activeChainIdRef.current,
          contextGeneration: transactionContextGuardRef.current.capture().generation,
          deploymentIdentity: activeDeploymentIdentityRef.current,
          routeIdentity: appRouteIdentityKey(activeAppRouteRef.current),
        };
        activeActionOriginRef.current = origin;
        try {
          await action();
        } finally {
          if (activeActionOriginRef.current === origin) activeActionOriginRef.current = undefined;
        }
      });
    },
    [runUnscopedAction],
  );
  const activeView = appRouteView(appRoute);
  const requestedProductBoardroom = appRoute.kind === "project" || appRoute.kind === "studio-project"
    ? appRoute.boardroom
    : undefined;
  const [grantForm, setGrantForm] = useState<GrantForm>(() => defaultGrantForm());
  const [predictedGrant, setPredictedGrant] = useState<Address>();
  const [grantAddress, setGrantAddress] = useState("");
  const [grantSnapshot, setGrantSnapshot] = useState<GrantSnapshot>();
  const [grantSnapshotVerifiedKey, setGrantSnapshotVerifiedKey] = useState<string>();
  const [grantIssuerBoardroom, setGrantIssuerBoardroom] = useState<GrantIssuerBoardroomAccess>();
  const [grantRouteError, setGrantRouteError] = useState<string>();
  const [grantRouteFailureKind, setGrantRouteFailureKind] = useState<"invalid" | "transient">();
  const [settleAmount, setSettleAmount] = useState("1");
  const [paymentApproval, setPaymentApproval] = useState("0");
  const grantSettlementTicketRef = useRef<GrantSettlementTicket | undefined>(undefined);
  const [boardroomForm, setBoardroomForm] = useState<BoardroomForm>(() => ({
    owner: "",
    name: "Pledge Common",
    symbol: "PLDG",
    salt: randomSalt(),
  }));
  const [predictedBoardroom, setPredictedBoardroom] = useState<Address>();
  const [boardroomAddress, setBoardroomAddress] = useState("");
  const [boardroomSnapshot, setBoardroomSnapshot] = useState<BoardroomSnapshot>();
  const [boardroomSnapshotVerifiedKey, setBoardroomSnapshotVerifiedKey] = useState<string>();
  const [boardroomMintAmount, setBoardroomMintAmount] = useState("1");
  const [boardroomMintTo, setBoardroomMintTo] = useState("");
  const [boardroomGrantForm, setBoardroomGrantForm] = useState<BoardroomGrantForm>(() => defaultBoardroomGrantForm());
  const [predictedBoardroomGrant, setPredictedBoardroomGrant] = useState<Address>();
  const [bondMarketForm, setBondMarketForm] = useState<BondMarketForm>(() => defaultBondMarketForm());
  const [bondMarketAddress, setBondMarketAddress] = useState("");
  const [bondMarketSnapshot, setBondMarketSnapshot] = useState<BondMarketState>();
  const [bondMarketSnapshotVerifiedKey, setBondMarketSnapshotVerifiedKey] = useState<string>();
  const [predictedBondMarket, setPredictedBondMarket] = useState<Address>();
  const [dutchAuctionForm, setDutchAuctionForm] = useState<DutchAuctionForm>(() => defaultDutchAuctionForm());
  const [dutchAuctionAddress, setDutchAuctionAddress] = useState("");
  const [dutchAuctionSnapshot, setDutchAuctionSnapshot] = useState<DutchAuctionState>();
  const [dutchAuctionSnapshotVerifiedKey, setDutchAuctionSnapshotVerifiedKey] = useState<string>();
  const [predictedDutchAuction, setPredictedDutchAuction] = useState<Address>();
  const [fixedPriceSaleForm, setFixedPriceSaleForm] = useState<FixedPriceSaleForm>(() => defaultFixedPriceSaleForm());
  const [fixedPriceSaleAddress, setFixedPriceSaleAddress] = useState("");
  const [fixedPriceSaleSnapshot, setFixedPriceSaleSnapshot] = useState<FixedPriceSaleState>();
  const [fixedPriceSaleSnapshotVerifiedKey, setFixedPriceSaleSnapshotVerifiedKey] = useState<string>();
  const [predictedFixedPriceSale, setPredictedFixedPriceSale] = useState<Address>();
  const [merkleAirdropForm, setMerkleAirdropForm] = useState<MerkleAirdropForm>(() => defaultMerkleAirdropForm());
  const [merkleAirdropAddress, setMerkleAirdropAddress] = useState("");
  const [merkleAirdropSnapshot, setMerkleAirdropSnapshot] = useState<MerkleAirdropState>();
  const [merkleAirdropSnapshotVerifiedKey, setMerkleAirdropSnapshotVerifiedKey] = useState<string>();
  const [predictedMerkleAirdrop, setPredictedMerkleAirdrop] = useState<Address>();
  const [migratingCurveForm, setMigratingCurveForm] = useState<MigratingCurveForm>(() => defaultMigratingCurveForm());
  const [migratingCurveAddress, setMigratingCurveAddress] = useState("");
  const [migratingCurveSnapshot, setMigratingCurveSnapshot] = useState<MigratingBondingCurveState>();
  const [migratingCurveSnapshotVerifiedKey, setMigratingCurveSnapshotVerifiedKey] = useState<string>();
  const [predictedMigratingCurve, setPredictedMigratingCurve] = useState<Address>();
  const [curveMigrationForm, setCurveMigrationForm] = useState<CurveMigrationForm>(() => defaultCurveMigrationForm());
  const [lockedLiquidityForm, setLockedLiquidityForm] = useState<LockedLiquidityForm>(() => defaultLockedLiquidityForm());
  const [lockedLiquidityAddress, setLockedLiquidityAddress] = useState("");
  const [lockedLiquiditySnapshot, setLockedLiquiditySnapshot] = useState<LockedLiquidityState>();
  const [lockedLiquiditySnapshotVerifiedKey, setLockedLiquiditySnapshotVerifiedKey] = useState<string>();
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
  const [productBoardroomVerifiedKey, setProductBoardroomVerifiedKey] = useState<string>();
  const [productBoardroomError, setProductBoardroomError] = useState<string>();
  const [productBoardroomFailureKind, setProductBoardroomFailureKind] = useState<"invalid" | "transient">();
  const [productBoardroomLoading, setProductBoardroomLoading] = useState(false);
  const [productCatalog, setProductCatalog] = useState<ProductBoardroomCatalogEntry[]>([]);
  const [productCatalogLoaded, setProductCatalogLoaded] = useState(false);
  const [productCatalogLoadMoreError, setProductCatalogLoadMoreError] = useState<string>();
  const [productCatalogLoadingMore, setProductCatalogLoadingMore] = useState(false);
  const [productCatalogNextCursor, setProductCatalogNextCursor] = useState<number>();
  const [productCatalogTotalCount, setProductCatalogTotalCount] = useState<number>();
  const productCatalogRef = useRef<readonly ProductBoardroomCatalogEntry[]>(productCatalog);
  productCatalogRef.current = productCatalog;
  const [boardroomStakerPower, setBoardroomStakerPower] = useState<BoardroomStakerPower>();
  const [boardroomStakerPowerVerifiedKey, setBoardroomStakerPowerVerifiedKey] = useState<string>();
  const [projectPosition, setProjectPosition] = useState<ProjectWalletPosition>();
  const [projectPositionVerifiedKey, setProjectPositionVerifiedKey] = useState<string>();
  const [projectPositionError, setProjectPositionError] = useState<string>();
  const [projectPositionErrorKey, setProjectPositionErrorKey] = useState<string>();
  const [projectPositionLoading, setProjectPositionLoading] = useState(false);
  const [projectPositionLoadingKey, setProjectPositionLoadingKey] = useState<string>();
  const [projectPositionRefreshGeneration, setProjectPositionRefreshGeneration] = useState(0);
  const [scheduledBoardroomOperations, setScheduledBoardroomOperations] = useState<ScheduledBoardroomOperation[]>([]);
  const [predictedGovernanceController, setPredictedGovernanceController] = useState<Address>();
  const [predictedReplacementController, setPredictedReplacementController] = useState<Address>();
  const [productGovernanceOperationsVerifiedKey, setProductGovernanceOperationsVerifiedKey] = useState<string>();
  const [productGovernanceOperationsComplete, setProductGovernanceOperationsComplete] = useState(false);
  const [productGovernanceOperationsLoaded, setProductGovernanceOperationsLoaded] = useState(false);
  const [productGovernanceError, setProductGovernanceError] = useState<string>();
  const [productGovernanceWarning, setProductGovernanceWarning] = useState<string>();
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
  const [selectedParticipationRoute, setSelectedParticipationRoute] = useState<ParticipationContentKey>();
  const activeActionInputIdentity = actionInputIdentity([
    grantForm,
    grantAddress,
    settleAmount,
    paymentApproval,
    boardroomForm,
    boardroomAddress,
    boardroomMintAmount,
    boardroomMintTo,
    boardroomGrantForm,
    bondMarketForm,
    bondMarketAddress,
    dutchAuctionForm,
    dutchAuctionAddress,
    fixedPriceSaleForm,
    fixedPriceSaleAddress,
    merkleAirdropForm,
    merkleAirdropAddress,
    migratingCurveForm,
    migratingCurveAddress,
    curveMigrationForm,
    lockedLiquidityForm,
    lockedLiquidityAddress,
    lockedLiquidityExitForm,
    windDownForm,
  ]);
  const exactProjectAddress = appRoute.kind === "project" || appRoute.kind === "studio-project" ? appRoute.boardroom : undefined;
  const exactProjectVerifiedKey = exactProjectAddress
    ? canonicalProjectStateKey(activeNetwork.chainId, exactProjectAddress, runtimeDeploymentIdentity)
    : undefined;
  const exactProjectDashboard = verifiedAddressState(
    productBoardroom,
    productBoardroomVerifiedKey,
    exactProjectVerifiedKey,
    exactProjectAddress,
  );
  const boardroomControlSupport = boardroomControlReleaseSupport(deployment);
  useEffect(() => {
    let current = true;
    setPredictedGovernanceController(undefined);
    setPredictedReplacementController(undefined);
    const controllerFactory = deployment?.boardroomControllerFactory;
    if (!boardroomControlSupport.supported || !exactProjectDashboard || !controllerFactory) {
      return () => { current = false; };
    }
    const generation = exactProjectDashboard.snapshot.launched
      ? exactProjectDashboard.snapshot.controllerGeneration + 1n
      : 1n;
    void predictBoardroomControllerAddress(publicClient, {
      controllerFactory,
      boardroom: exactProjectDashboard.address,
      generation,
    }).then((prediction) => {
      if (!current) return;
      if (exactProjectDashboard.snapshot.launched) setPredictedReplacementController(prediction);
      else setPredictedGovernanceController(prediction);
    }).catch(() => {
      if (!current) return;
      setPredictedGovernanceController(undefined);
      setPredictedReplacementController(undefined);
    });
    return () => { current = false; };
  }, [boardroomControlSupport.supported, deployment?.boardroomControllerFactory, exactProjectDashboard, publicClient]);
  const canonicalStudioBoardroom = appRoute.kind === "studio-project" ? appRoute.boardroom : undefined;
  const displayedBoardroomSnapshot = canonicalStudioBoardroom
    ? verifiedAddressState(
        boardroomSnapshot,
        boardroomSnapshotVerifiedKey,
        exactProjectVerifiedKey,
        canonicalStudioBoardroom,
      )
    : boardroomSnapshot;
  const displayedFixedPriceSaleSnapshot = canonicalStudioBoardroom
    ? verifiedStudioChildState(
        fixedPriceSaleSnapshot,
        fixedPriceSaleSnapshotVerifiedKey,
        exactProjectVerifiedKey,
        canonicalStudioBoardroom,
      )
    : fixedPriceSaleSnapshot;
  const displayedDutchAuctionSnapshot = canonicalStudioBoardroom
    ? verifiedStudioChildState(
        dutchAuctionSnapshot,
        dutchAuctionSnapshotVerifiedKey,
        exactProjectVerifiedKey,
        canonicalStudioBoardroom,
      )
    : dutchAuctionSnapshot;
  const displayedBondMarketSnapshot = canonicalStudioBoardroom
    ? verifiedStudioChildState(
        bondMarketSnapshot,
        bondMarketSnapshotVerifiedKey,
        exactProjectVerifiedKey,
        canonicalStudioBoardroom,
      )
    : bondMarketSnapshot;
  const displayedMerkleAirdropSnapshot = canonicalStudioBoardroom
    ? verifiedStudioChildState(
        merkleAirdropSnapshot,
        merkleAirdropSnapshotVerifiedKey,
        exactProjectVerifiedKey,
        canonicalStudioBoardroom,
      )
    : merkleAirdropSnapshot;
  const displayedMigratingCurveSnapshot = canonicalStudioBoardroom
    ? verifiedStudioChildState(
        migratingCurveSnapshot,
        migratingCurveSnapshotVerifiedKey,
        exactProjectVerifiedKey,
        canonicalStudioBoardroom,
      )
    : migratingCurveSnapshot;
  const displayedLockedLiquiditySnapshot = canonicalStudioBoardroom
    ? verifiedStudioChildState(
        lockedLiquiditySnapshot,
        lockedLiquiditySnapshotVerifiedKey,
        exactProjectVerifiedKey,
        canonicalStudioBoardroom,
      )
    : lockedLiquiditySnapshot;
  const exactProjectPools = useMemo(() => projectSwapPoolAddresses(exactProjectDashboard), [exactProjectDashboard]);
  const selectedProjectPool = selectedParticipationPool(selectedParticipationRoute, exactProjectPools);
  const exactProjectPoolRef = useRef<Address | undefined>(selectedProjectPool);
  const studioProjectPoolsRef = useRef<readonly Address[]>(exactProjectPools);
  exactProjectPoolRef.current = selectedProjectPool;
  studioProjectPoolsRef.current = exactProjectPools;
  const exactProjectIdentity = exactProjectDashboard
    ? `${activeNetwork.chainId.toString()}:${exactProjectDashboard.address.toLowerCase()}`
    : undefined;
  const projectScopedAmmRoute = (appRoute.kind === "project" && appRoute.section === "participate")
    || (appRoute.kind === "studio-project" && appRoute.section === "liquidity");
  const exactProjectPoolsKey = exactProjectPools.map((candidate) => candidate.toLowerCase()).join(",");
  const swapTokenLoadScope: SwapTokenLoadScope | undefined = projectScopedAmmRoute
    ? exactProjectIdentity && exactProjectPools.length > 0
      ? {
          key: `project:${exactProjectIdentity}:${exactProjectPoolsKey}`,
          mode: "pinned-only",
          pinnedPools: exactProjectPools,
        }
      : undefined
    : activeView === "market" && appRoute.kind !== "legacy-project"
      ? { key: `global:${activeNetwork.chainId.toString()}`, mode: "global", pinnedPools: [] }
      : undefined;
  activeSwapTokenLoadScopeRef.current = swapTokenLoadScope;
  const sentinelBaseUrl = getSentinelBaseUrl();
  const sentinelClient = useMemo(
    () => sentinelBaseUrl ? createSentinelClient({ baseUrl: sentinelBaseUrl }) : undefined,
    [sentinelBaseUrl],
  );

  const syncSelectedChainFromLocation = useCallback((): void => {
    const nextChainId = initialSelectedNetwork().chainId;
    setSelectedChainId((currentChainId) => (currentChainId === nextChainId ? currentChainId : nextChainId));
  }, []);

  const focusRouteContent = useCallback((): void => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      document.getElementById("app-main-content")?.focus({ preventScroll: true });
    });
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
      activeStudioReadScopeKeyRef.current = studioReadScopeKey(
        nextRoute,
        appRouteChainId(nextRoute) ?? activeChainIdRef.current,
        activeDeploymentIdentityRef.current,
      );
      setAppRoute(nextRoute);
      focusRouteContent();
      const routeChainId = appRouteChainId(nextRoute);
      if (routeChainId !== undefined && supportedNetworkForChainId(routeChainId)) {
        setSelectedChainId(routeChainId);
      } else if (!pendingAction) {
        syncSelectedChainFromLocation();
      }
    };
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, [focusRouteContent, pendingAction, syncSelectedChainFromLocation]);

  const navigateRoute = useCallback((route: CanonicalAppRoute, replace = false): void => {
    activeAppRouteRef.current = route;
    activeStudioReadScopeKeyRef.current = studioReadScopeKey(
      route,
      appRouteChainId(route) ?? activeChainIdRef.current,
      activeDeploymentIdentityRef.current,
    );
    setAppRoute(route);
    if (typeof window === "undefined") return;
    const href = appRouteHref(route);
    if (`${window.location.pathname}${window.location.search}` !== href) {
      window.history[replace ? "replaceState" : "pushState"]({}, "", href);
    }
    window.scrollTo({ behavior: "auto", left: 0, top: 0 });
    focusRouteContent();
  }, [focusRouteContent]);

  useEffect(() => {
    if (!shouldCanonicalizeAppRoute(appRoute) || typeof window === "undefined") return;
    const canonicalHref = canonicalAppLocationHref(appRoute, window.location);
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== canonicalHref) {
      window.history.replaceState({}, "", canonicalHref);
    }
  }, [appRoute]);

  const updateGrantAddress = useCallback((address: string): void => {
    setGrantAddress(address);
    setGrantSnapshot(undefined);
    setGrantSnapshotVerifiedKey(undefined);
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
      const nextRoute = networkSwitchDestination(appRoute, nextNetwork.chainId);
      if (nextRoute) {
        navigateRoute(nextRoute);
      } else {
        syncSelectedNetworkSearch(nextNetwork.chainId);
      }
      pushLog(`Selected ${nextNetwork.name}`, "info");
    },
    [appRoute, navigateRoute, pushLog],
  );

  const { activeAccount, nativeBalance, switchChain, wallet, walletClient } = useWagmiWallet({
    network: activeNetwork,
    onAccountChanged: clearDirectGrantPrediction,
    pushLog,
  });
  const hyperliquidCheckout = useMemo(
    () => X402_ROUTER_CONFIG && activeNetwork.chainId === HYPEREVM_TESTNET_CHAIN_ID
      ? { config: X402_ROUTER_CONFIG, walletClient }
      : undefined,
    [activeNetwork.chainId, walletClient],
  );
  const activeProjectPositionKey = appRoute.kind === "project"
    && appRoute.section === "overview"
    && exactProjectDashboard
    && wallet.account
    && runtimeDeploymentIdentity
    ? projectWalletPositionKey({
        account: wallet.account,
        chainId: activeNetwork.chainId,
        dashboard: exactProjectDashboard,
        deploymentIdentity: runtimeDeploymentIdentity,
        refreshGeneration: projectPositionRefreshGeneration,
      })
    : undefined;
  projectPositionReadCoordinatorRef.current.sync(activeProjectPositionKey);
  const verifiedProjectPosition = projectPosition
    ? verifiedStateForKey(projectPosition, projectPositionVerifiedKey, activeProjectPositionKey)
    : undefined;
  const verifiedProjectPositionError = projectPositionErrorKey === activeProjectPositionKey
    ? projectPositionError
    : undefined;
  const verifiedProjectPositionLoading = projectPositionLoadingKey === activeProjectPositionKey
    && projectPositionLoading;
  activeAccountRef.current = wallet.account;
  activeWalletChainIdRef.current = wallet.chainId;
  if (walletClientRef.current !== walletClient) walletClientGenerationRef.current += 1;
  walletClientRef.current = walletClient;
  activeDeploymentIdentityRef.current = runtimeDeploymentIdentity;
  transactionContextGuardRef.current.sync(transactionContextIdentity({
    account: wallet.account,
    actionInputIdentity: activeActionInputIdentity,
    deploymentIdentity: runtimeDeploymentIdentity,
    routeIdentity: activeRouteIdentity,
    selectedChainId: activeNetwork.chainId,
    walletChainId: wallet.chainId,
    walletClientGeneration: walletClientGenerationRef.current,
  }));
  const ammWalletScopeKey = ammReadIdentityKey([
    activeNetwork.chainId,
    runtimeDeploymentIdentity ?? "unconfigured",
    wallet.account?.toLowerCase() ?? "read-only",
  ]);
  const ammProjectScopeKey = ammReadIdentityKey([
    exactProjectAddress?.toLowerCase() ?? "global",
    exactProjectPoolsKey,
    selectedProjectPool?.toLowerCase() ?? "no-selected-pool",
  ]);
  const ammTokenReadKey = ammReadIdentityKey([
    ammWalletScopeKey,
    swapTokenLoadScope?.key ?? (projectScopedAmmRoute ? `project-waiting:${exactProjectAddress?.toLowerCase() ?? "unknown"}` : "inactive"),
  ]);
  const ammSwapQuoteReadKey = ammReadIdentityKey([ammWalletScopeKey, ammProjectScopeKey, swapForm]);
  const ammLiquidityQuoteReadKey = ammReadIdentityKey([ammWalletScopeKey, ammProjectScopeKey, liquidityForm]);
  const ammPositionReadKey = ammReadIdentityKey([
    ammWalletScopeKey,
    ammProjectScopeKey,
    liquidityForm.tokenA,
    liquidityForm.tokenB,
  ]);
  const ammRemoveLiquidityQuoteReadKey = ammReadIdentityKey([
    ammWalletScopeKey,
    ammProjectScopeKey,
    liquidityForm,
    removeLiquidityForm,
  ]);
  const ammReadCoordinator = ammReadCoordinatorRef.current;
  ammReadCoordinator.sync("token-list", ammTokenReadKey);
  ammReadCoordinator.sync("swap-quote", ammSwapQuoteReadKey);
  ammReadCoordinator.sync("liquidity-quote", ammLiquidityQuoteReadKey);
  ammReadCoordinator.sync("position", ammPositionReadKey);
  ammReadCoordinator.sync("remove-liquidity-quote", ammRemoveLiquidityQuoteReadKey);
  activeAmmTokenReadKeyRef.current = ammTokenReadKey;
  useEffect(() => {
    cancelReview();
  }, [activeNetwork.chainId, activeRouteIdentity, cancelReview, wallet.account, wallet.chainId]);
  const transactionWatcherIdentity = [
    activeNetwork.chainId.toString(),
    wallet.account?.toLowerCase() ?? "read-only",
    runtimeDeploymentIdentity ?? "unconfigured",
  ].join(":");
  useCommittedLayoutEffect(() => {
    if (transactionWatcherIdentityRef.current === transactionWatcherIdentity) return;
    transactionWatcherAbortControllerRef.current.abort();
    transactionWatcherAbortControllerRef.current = new AbortController();
    transactionWatcherIdentityRef.current = transactionWatcherIdentity;
    transactionWatcherVersionRef.current += 1;
    watchedTransactionIdsRef.current.clear();
    for (const timer of transactionReceiptRetryTimersRef.current.values()) globalThis.clearTimeout(timer);
    transactionReceiptRetryTimersRef.current.clear();
    transactionReceiptRetryCountsRef.current.clear();
    transactionRefreshClaimIdsRef.current.clear();
    transactionRefreshRetryCountsRef.current.clear();
    setTransactionWatcherRenderGeneration((generation) => generation + 1);
  }, [transactionWatcherIdentity]);
  const activeGovernanceKey = governanceRouteKey(appRoute, wallet.account, runtimeDeploymentIdentity);
  activeGovernanceKeyRef.current = activeGovernanceKey;
  const verifiedBoardroomStakerPower = boardroomStakerPower
    ? verifiedStateForKey(boardroomStakerPower, boardroomStakerPowerVerifiedKey, activeGovernanceKey)
    : undefined;
  const verifiedScheduledBoardroomOperations = verifiedStateForKey(
    scheduledBoardroomOperations,
    productGovernanceOperationsVerifiedKey,
    activeGovernanceKey,
  ) ?? [];
  const verifiedProductGovernanceOperationsLoaded = productGovernanceOperationsVerifiedKey === activeGovernanceKey
    && productGovernanceOperationsLoaded;
  const verifiedProductGovernanceOperationsComplete = productGovernanceOperationsVerifiedKey === activeGovernanceKey
    && productGovernanceOperationsComplete;
  const verifiedProductGovernanceWarning = productGovernanceOperationsVerifiedKey === activeGovernanceKey
    ? productGovernanceWarning
    : undefined;
  const {
    records: transactions,
    startTransaction,
    updateTransaction,
    updateTransactionForIdentity,
    clearSettled,
  } = useTransactionCenter(activeNetwork.chainId, wallet.account);
  const ensureTransactionReceipt = (
    transaction: Pick<TransactionRecord, "chainId" | "hash" | "id" | "label" | "refreshRoute" | "submittedHash">,
    watcherIdentity: string,
    watcherVersion: number,
    routeAtSubmission?: AppRoute,
    allowInvalidation = true,
    watcherSignal = transactionWatcherAbortControllerRef.current.signal,
  ): Promise<TransactionReceiptOutcome> => {
    const submittedHash = transaction.submittedHash ?? transaction.hash;
    if (!submittedHash) return Promise.reject(new Error("Submitted transaction is missing its original hash."));
    const monitorKey = transactionReceiptMonitorKey(watcherIdentity, watcherVersion, transaction.id, submittedHash);

    return transactionReceiptCoordinatorRef.current.ensure(monitorKey, async () => {
      const outcome = await monitorTransactionReceipt({
        hash: submittedHash,
        isCurrent: () => transactionWatcherVersionRef.current === watcherVersion,
        maxAttempts: 1,
        onMonitoringError: () => {
          if (transactionWatcherVersionRef.current !== watcherVersion) return;
          updateTransaction(transaction.id, {
            error: "Confirmation tracking was interrupted. This transaction is still submitted and is being checked again automatically.",
            stage: "submitted",
          });
        },
        signal: watcherSignal,
        waitForReceipt: async ({ hash, onReplaced }) => await publicClient.waitForTransactionReceipt({
          hash,
          onReplaced,
          timeout: TRANSACTION_RECEIPT_WAIT_TIMEOUT_MS,
        }),
      });
      if (transactionWatcherVersionRef.current !== watcherVersion) {
        throw new TransactionReceiptMonitoringCancelledError();
      }
      invalidateSettledSharedStateRef.current();

      if (outcome.kind === "cancelled") {
        updateTransaction(transaction.id, {
          error: "Cancelled in your wallet. The reviewed action was not executed.",
          hash: outcome.hash,
          refreshBlocked: false,
          refreshPending: false,
          replacementReason: "cancelled",
          stage: "cancelled",
        });
        pushLog(`${transaction.label} was cancelled in the wallet.`, "info", outcome.hash, transaction.chainId);
        return outcome;
      }
      if (outcome.kind === "replaced") {
        updateTransaction(transaction.id, {
          error: "Replaced in your wallet by a different transaction. The reviewed action was not executed.",
          hash: outcome.hash,
          refreshBlocked: false,
          refreshPending: false,
          replacementReason: "replaced",
          stage: "replaced",
        });
        pushLog(`${transaction.label} was replaced by a different wallet transaction.`, "error", outcome.hash, transaction.chainId);
        return outcome;
      }
      if (outcome.kind === "reverted") {
        updateTransaction(transaction.id, {
          error: `${transaction.label} reverted after submission.`,
          hash: outcome.hash,
          refreshBlocked: false,
          refreshPending: false,
          replacementReason: outcome.replacementReason,
          stage: "failed",
        });
        pushLog(`${transaction.label} reverted onchain.`, "error", outcome.hash, transaction.chainId);
        return outcome;
      }

      const refreshRoute = routeAtSubmission ?? transaction.refreshRoute;
      const invalidation = confirmedReceiptInvalidationPlan(Boolean(refreshRoute), allowInvalidation);
      const refreshClaimKey = invalidation.scoped
        ? [watcherVersion.toString(), transaction.id, outcome.hash.toLowerCase()].join(":")
        : undefined;
      const refreshRetryKey = `${transaction.id}:${outcome.hash.toLowerCase()}`;
      if (refreshClaimKey) transactionRefreshClaimIdsRef.current.add(refreshClaimKey);
      updateTransaction(transaction.id, {
        error: undefined,
        hash: outcome.hash,
        refreshBlocked: invalidation.refreshBlocked,
        refreshPending: invalidation.refreshPending,
        replacementReason: outcome.replacementReason,
        stage: "confirmed",
      });
      pushLog(`${transaction.label} confirmed`, "success", outcome.hash, transaction.chainId);
      if (!refreshClaimKey || !refreshRoute) return outcome;
      try {
        await invalidateConfirmedScopedRouteRef.current(refreshRoute);
        if (transactionWatcherVersionRef.current !== watcherVersion) {
          throw new TransactionReceiptMonitoringCancelledError();
        }
        transactionRefreshRetryCountsRef.current.delete(refreshRetryKey);
        updateTransaction(transaction.id, { refreshBlocked: false, refreshPending: false });
      } catch (error) {
        if (transactionWatcherVersionRef.current !== watcherVersion) {
          throw new TransactionReceiptMonitoringCancelledError();
        }
        updateTransaction(transaction.id, { refreshBlocked: false, refreshPending: true });
        pushLog(
          `${transaction.label} confirmed, but current route data could not be refreshed: ${errorMessage(error)}`,
          "error",
          outcome.hash,
          transaction.chainId,
        );
      } finally {
        transactionRefreshClaimIdsRef.current.delete(refreshClaimKey);
      }
      return outcome;
    });
  };
  useEffect(() => {
    for (const transaction of transactions) {
      if (transaction.chainId !== activeNetwork.chainId || transaction.stage !== "submitted" || !transaction.hash) continue;
      const watcherIdentity = transactionWatcherIdentity;
      const submittedHash = transaction.submittedHash ?? transaction.hash;
      const watcherVersion = transactionWatcherVersionRef.current;
      const watcherKey = transactionReceiptMonitorKey(watcherIdentity, watcherVersion, transaction.id, submittedHash);
      if (watchedTransactionIdsRef.current.has(watcherKey)) continue;
      watchedTransactionIdsRef.current.set(watcherKey, watcherVersion);
      let monitoringDeferred = false;
      const allowInvalidation = Boolean(
        transaction.deploymentIdentity
        && transaction.deploymentIdentity === runtimeDeploymentIdentity,
      );
      void ensureTransactionReceipt(transaction, watcherIdentity, watcherVersion, transaction.refreshRoute, allowInvalidation)
        .catch((error: unknown) => {
          if (error instanceof TransactionReceiptMonitoringDeferredError
            && transactionWatcherVersionRef.current === watcherVersion) {
            monitoringDeferred = true;
            const retryAttempt = (transactionReceiptRetryCountsRef.current.get(watcherKey) ?? 0) + 1;
            transactionReceiptRetryCountsRef.current.set(watcherKey, retryAttempt);
            if (!transactionReceiptRetryTimersRef.current.has(watcherKey)) {
              const timer = globalThis.setTimeout(() => {
                transactionReceiptRetryTimersRef.current.delete(watcherKey);
                if (transactionWatcherVersionRef.current !== watcherVersion) return;
                if (watchedTransactionIdsRef.current.get(watcherKey) === watcherVersion) {
                  watchedTransactionIdsRef.current.delete(watcherKey);
                }
                setTransactionReceiptRetryGeneration((generation) => generation + 1);
              }, receiptBackgroundRetryDelay(retryAttempt));
              transactionReceiptRetryTimersRef.current.set(watcherKey, timer);
            }
          }
        })
        .finally(() => {
          if (monitoringDeferred) return;
          if (watchedTransactionIdsRef.current.get(watcherKey) === watcherVersion) {
            watchedTransactionIdsRef.current.delete(watcherKey);
          }
          transactionReceiptRetryCountsRef.current.delete(watcherKey);
        });
    }
  }, [activeNetwork.chainId, publicClient, pushLog, runtimeDeploymentIdentity, transactionReceiptRetryGeneration, transactionWatcherIdentity, transactionWatcherRenderGeneration, transactions, updateTransaction, wallet.account]);
  useCommittedLayoutEffect(() => {
    for (const transaction of transactions) {
      if (transaction.stage !== "confirmed" || !transaction.refreshPending || transaction.refreshBlocked) continue;
      if (confirmedRefreshIsBlocked(
        transaction.deploymentIdentity,
        runtimeDeploymentIdentity,
        Boolean(transaction.refreshRoute),
      )) {
        updateTransaction(transaction.id, { refreshBlocked: true });
      }
    }
  }, [runtimeDeploymentIdentity, transactions, updateTransaction]);
  useEffect(() => {
    for (const transaction of transactions) {
      if (transaction.stage !== "confirmed" || !transaction.refreshPending) continue;
      const refreshBlocked = confirmedRefreshIsBlocked(
        transaction.deploymentIdentity,
        runtimeDeploymentIdentity,
        Boolean(transaction.refreshRoute),
      );
      if (refreshBlocked) {
        continue;
      }
      if (!transaction.refreshRoute) continue;
      const refreshVersion = transactionWatcherVersionRef.current;
      const claimKey = [
        refreshVersion.toString(),
        transaction.id,
        transaction.hash?.toLowerCase() ?? "no-hash",
      ].join(":");
      const refreshRetryKey = `${transaction.id}:${transaction.hash?.toLowerCase() ?? "no-hash"}`;
      if (transactionRefreshClaimIdsRef.current.has(claimKey)) continue;
      transactionRefreshClaimIdsRef.current.add(claimKey);
      if (transaction.refreshBlocked) updateTransaction(transaction.id, { refreshBlocked: false });
      let retryScheduled = false;
      void invalidateConfirmedScopedRouteRef.current(transaction.refreshRoute)
        .then(() => {
          if (transactionWatcherVersionRef.current !== refreshVersion) return;
          transactionRefreshRetryCountsRef.current.delete(refreshRetryKey);
          updateTransaction(transaction.id, { refreshBlocked: false, refreshPending: false });
        })
        .catch((error: unknown) => {
          if (transactionWatcherVersionRef.current !== refreshVersion) return;
          retryScheduled = true;
          pushLog(
            `${transaction.label} confirmed, but current route data could not be refreshed: ${errorMessage(error)}`,
            "error",
            transaction.hash,
            transaction.chainId,
          );
          const timerKey = `refresh:${claimKey}`;
          if (transactionReceiptRetryTimersRef.current.has(timerKey)) return;
          const retryAttempt = (transactionRefreshRetryCountsRef.current.get(refreshRetryKey) ?? 0) + 1;
          transactionRefreshRetryCountsRef.current.set(refreshRetryKey, retryAttempt);
          const timer = globalThis.setTimeout(() => {
            transactionReceiptRetryTimersRef.current.delete(timerKey);
            transactionRefreshClaimIdsRef.current.delete(claimKey);
            if (transactionWatcherVersionRef.current !== refreshVersion) return;
            setTransactionReceiptRetryGeneration((generation) => generation + 1);
          }, receiptBackgroundRetryDelay(retryAttempt));
          transactionReceiptRetryTimersRef.current.set(timerKey, timer);
        })
        .finally(() => {
          if (!retryScheduled) transactionRefreshClaimIdsRef.current.delete(claimKey);
        });
    }
  }, [pushLog, runtimeDeploymentIdentity, transactionReceiptRetryGeneration, transactionWatcherRenderGeneration, transactions, updateTransaction]);
  const factorySnapshot = useFactorySnapshot(publicClient, deployment, pushLog);
  const creationFee = factorySnapshot.creationFee ?? deployment?.creationFee ?? 0n;
  const discoveryKey = discoveryStorageKey(activeNetwork.chainId, wallet.account, discoveryDeploymentIdentity);
  activeDiscoveryKeyRef.current = discoveryKey;
  activeDeploymentIdentityRef.current = runtimeDeploymentIdentity;

  useEffect(() => {
    networkRequestVersion.current += 1;
  }, [activeNetwork.chainId, runtimeDeploymentIdentity]);

  useEffect(() => {
    ammTokenLoadAbortControllerRef.current?.abort(new DOMException("AMM account or project scope changed.", "AbortError"));
    ammTokenLoadAbortControllerRef.current = undefined;
    setSwapTokenList(emptySwapTokenList());
    setSwapTokenListLoading(false);
    setSwapQuote(undefined);
    setLiquidityQuote(undefined);
    setRemoveLiquidityQuote(undefined);
    setAmmPosition(undefined);
  }, [ammTokenReadKey]);

  useEffect(() => () => {
    productRequestVersionRef.current += 1;
    ammTokenLoadAbortControllerRef.current?.abort(new DOMException("AMM workspace closed.", "AbortError"));
    ammTokenLoadAbortControllerRef.current = undefined;
    productLoadAbortControllerRef.current?.abort(new DOMException("Project workspace closed.", "AbortError"));
    productLoadAbortControllerRef.current = undefined;
    productCatalogLoadMoreAbortControllerRef.current?.abort(new DOMException("Project catalog closed.", "AbortError"));
    productCatalogLoadMoreAbortControllerRef.current = undefined;
  }, []);

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
    setGrantSnapshotVerifiedKey(undefined);
    setGrantIssuerBoardroom(undefined);
    setGrantRouteError(undefined);
    setGrantRouteFailureKind(undefined);
    setPaymentApproval("0");
    setPredictedBoardroom(undefined);
    setBoardroomAddress("");
    setBoardroomSnapshot(undefined);
    setBoardroomSnapshotVerifiedKey(undefined);
    setBoardroomMintTo("");
    setPredictedBoardroomGrant(undefined);
    setBondMarketAddress("");
    setBondMarketSnapshot(undefined);
    setBondMarketSnapshotVerifiedKey(undefined);
    setPredictedBondMarket(undefined);
    setDutchAuctionAddress("");
    setDutchAuctionSnapshot(undefined);
    setDutchAuctionSnapshotVerifiedKey(undefined);
    setPredictedDutchAuction(undefined);
    setFixedPriceSaleAddress("");
    setFixedPriceSaleSnapshot(undefined);
    setFixedPriceSaleSnapshotVerifiedKey(undefined);
    setPredictedFixedPriceSale(undefined);
    setMerkleAirdropAddress("");
    setMerkleAirdropSnapshot(undefined);
    setMerkleAirdropSnapshotVerifiedKey(undefined);
    setPredictedMerkleAirdrop(undefined);
    setMigratingCurveAddress("");
    setMigratingCurveSnapshot(undefined);
    setMigratingCurveSnapshotVerifiedKey(undefined);
    setPredictedMigratingCurve(undefined);
    setLockedLiquidityAddress("");
    setLockedLiquiditySnapshot(undefined);
    setLockedLiquiditySnapshotVerifiedKey(undefined);
    setPredictedLockedLiquidity(undefined);
    setDiscovery(emptyDiscoverySnapshot());
    setProductBoardroom(undefined);
    setProductBoardroomVerifiedKey(undefined);
    setProductBoardroomError(undefined);
    setProductBoardroomFailureKind(undefined);
    setProductBoardroomLoading(false);
    setProductCatalog([]);
    setProductCatalogLoaded(false);
    setProductCatalogLoadMoreError(undefined);
    setProductCatalogLoadingMore(false);
    setProductCatalogNextCursor(undefined);
    setProductCatalogTotalCount(undefined);
    setBoardroomStakerPower(undefined);
    setBoardroomStakerPowerVerifiedKey(undefined);
    setProjectPosition(undefined);
    setProjectPositionVerifiedKey(undefined);
    setProjectPositionError(undefined);
    setProjectPositionErrorKey(undefined);
    setProjectPositionLoading(false);
    setProjectPositionLoadingKey(undefined);
    setProjectPositionRefreshGeneration(0);
    setScheduledBoardroomOperations([]);
    setProductGovernanceOperationsVerifiedKey(undefined);
    setProductGovernanceOperationsComplete(false);
    setProductGovernanceOperationsLoaded(false);
    setProductGovernanceError(undefined);
    setProductGovernanceWarning(undefined);
    setProductGovernanceLoading(false);
    productGovernanceLoadedKeyRef.current = undefined;
    productGovernanceSnapshotKeyRef.current = undefined;
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
    setSelectedParticipationRoute(undefined);
  }, []);

  useEffect(() => {
    persistSelectedNetwork(activeNetwork.chainId);
  }, [activeNetwork.chainId]);

  useEffect(() => {
    resetNetworkScopedState();
  }, [activeNetwork.chainId, runtimeDeploymentIdentity, resetNetworkScopedState]);

  const loadProductBoardroom = useCallback(async (requestedAddress?: Address): Promise<ScopedRefreshLoadResult> => {
    productLoadAbortControllerRef.current?.abort(new DOMException("A newer project load started.", "AbortError"));
    const abortController = new AbortController();
    productLoadAbortControllerRef.current = abortController;
    const networkRequest = networkRequestVersion.current;
    const productRequest = ++productRequestVersionRef.current;
    const requestChainId = activeNetwork.chainId;
    const requestDeploymentIdentity = runtimeDeploymentIdentity;
    const requestIsCurrent = (): boolean =>
      productRequestVersionRef.current === productRequest
      && isCurrentNetworkRequest(networkRequest, requestChainId)
      && activeDeploymentIdentityRef.current === requestDeploymentIdentity;
    setProductBoardroomLoading(true);
    setProductBoardroomError(undefined);
    setProductBoardroomFailureKind(undefined);
    if (requestedAddress) setProductBoardroomVerifiedKey(undefined);
    setProductCatalogLoadMoreError(undefined);
    setProductCatalogLoadingMore(false);
    try {
      if (!deployment?.boardroomFactory) {
        throw new Error("Runtime deployment is still loading for this chain.");
      }
      if (!requestedAddress) {
        const catalogPage = await readProductBoardroomCatalogPage(publicClient, deployment, {
          signal: abortController.signal,
        });
        if (!requestIsCurrent()) return "stale";
        setProductCatalog(catalogPage.entries);
        setProductCatalogLoaded(true);
        setProductCatalogNextCursor(catalogPage.nextCursor);
        setProductCatalogTotalCount(catalogPage.totalCount);
        setProductBoardroom(undefined);
        setProductBoardroomVerifiedKey(undefined);
        pushLog(`Loaded ${catalogPage.entries.length.toString()} of ${catalogPage.totalCount.toString()} product Boardrooms`, "success");
        return "loaded";
      }

      await assertCanonicalBoardroom(publicClient, deployment, requestedAddress);
      if (!requestIsCurrent()) return "stale";
      const next = await readProductBoardroomDashboard(publicClient, {
        address: requestedAddress,
        catalog: [...productCatalogRef.current],
        deployment,
        signal: abortController.signal,
      });
      if (!requestIsCurrent()) return "stale";
      setProductCatalog((current) => mergeProductBoardroomCatalog(current, next.catalog));
      setProductBoardroom(next);
      setProductBoardroomVerifiedKey(canonicalProjectStateKey(
        requestChainId,
        requestedAddress,
        requestDeploymentIdentity,
      ));
      productGovernanceLoadedKeyRef.current = undefined;
      pushLog(`Loaded product Boardroom ${requestedAddress}`, "success");

      productCatalogLoadMoreAbortControllerRef.current?.abort(
        new DOMException("A newer project directory enrichment started.", "AbortError"),
      );
      const catalogAbortController = new AbortController();
      productCatalogLoadMoreAbortControllerRef.current = catalogAbortController;
      void (async (): Promise<void> => {
        try {
          const catalogPage = await readProductBoardroomCatalogPage(publicClient, deployment, {
            signal: catalogAbortController.signal,
          });
          if (!requestIsCurrent()) return;
          // This page is read after the exact dashboard, so it owns duplicate entries.
          const mergedCatalog = mergeProductBoardroomCatalog(next.catalog, catalogPage.entries);
          setProductCatalog(mergedCatalog);
          setProductCatalogLoaded(true);
          setProductCatalogNextCursor(catalogPage.nextCursor);
          setProductCatalogTotalCount(catalogPage.totalCount);
          setProductBoardroom((current) => current && sameAddress(current.address, requestedAddress)
            ? { ...current, catalog: mergedCatalog }
            : current);
        } catch (catalogError) {
          if (catalogAbortController.signal.aborted || !requestIsCurrent()) return;
          const message = productReadErrorMessage(catalogError, activeNetwork.name);
          setProductCatalogLoadMoreError(`The project loaded, but the wider directory is unavailable. ${message}`);
          pushLog(`Project loaded without the wider directory: ${message}`, "error");
        } finally {
          if (productCatalogLoadMoreAbortControllerRef.current === catalogAbortController) {
            productCatalogLoadMoreAbortControllerRef.current = undefined;
          }
        }
      })();
      return "loaded";
    } catch (error) {
      if (!requestIsCurrent()) return "stale";
      const message = productReadErrorMessage(error, activeNetwork.name);
      setProductBoardroomError(message);
      setProductBoardroomFailureKind(error instanceof CanonicalProvenanceError ? "invalid" : "transient");
      pushLog(message, "error");
      return "failed";
    } finally {
      if (productLoadAbortControllerRef.current === abortController) {
        productLoadAbortControllerRef.current = undefined;
      }
      if (requestIsCurrent()) setProductBoardroomLoading(false);
    }
  }, [activeNetwork.chainId, activeNetwork.name, deployment, isCurrentNetworkRequest, publicClient, pushLog, runtimeDeploymentIdentity]);

  const loadMoreProductBoardrooms = useCallback(async (): Promise<void> => {
    if (productCatalogNextCursor === undefined || productCatalogLoadingMore || !deployment?.boardroomFactory) return;
    productCatalogLoadMoreAbortControllerRef.current?.abort(new DOMException("A newer project catalog load started.", "AbortError"));
    const abortController = new AbortController();
    productCatalogLoadMoreAbortControllerRef.current = abortController;
    const networkRequest = networkRequestVersion.current;
    const productRequest = productRequestVersionRef.current;
    const requestChainId = activeNetwork.chainId;
    const requestDeploymentIdentity = runtimeDeploymentIdentity;
    const cursor = productCatalogNextCursor;
    const requestIsCurrent = (): boolean =>
      productRequestVersionRef.current === productRequest
      && isCurrentNetworkRequest(networkRequest, requestChainId)
      && activeDeploymentIdentityRef.current === requestDeploymentIdentity;
    setProductCatalogLoadingMore(true);
    setProductCatalogLoadMoreError(undefined);
    try {
      const page = await readProductBoardroomCatalogPage(publicClient, deployment, {
        cursor,
        signal: abortController.signal,
        snapshotCount: productCatalogTotalCount,
      });
      if (!requestIsCurrent()) return;
      setProductCatalog((current) => mergeProductBoardroomCatalog(current, page.entries));
      setProductBoardroom((current) => current ? {
        ...current,
        catalog: mergeProductBoardroomCatalog(current.catalog, page.entries),
      } : current);
      setProductCatalogNextCursor(page.nextCursor);
      setProductCatalogTotalCount(page.totalCount);
    } catch (error) {
      if (!requestIsCurrent()) return;
      const message = productReadErrorMessage(error, activeNetwork.name);
      setProductCatalogLoadMoreError(message);
      pushLog(message, "error");
    } finally {
      if (productCatalogLoadMoreAbortControllerRef.current === abortController) {
        productCatalogLoadMoreAbortControllerRef.current = undefined;
      }
      if (requestIsCurrent()) setProductCatalogLoadingMore(false);
    }
  }, [activeNetwork.chainId, activeNetwork.name, deployment, isCurrentNetworkRequest, productCatalogLoadingMore, productCatalogNextCursor, productCatalogTotalCount, publicClient, pushLog, runtimeDeploymentIdentity]);

  const refreshProjectOverview = useCallback((boardroom: Address): void => {
    setProjectPositionRefreshGeneration((generation) => generation + 1);
    void loadProductBoardroom(boardroom);
  }, [loadProductBoardroom]);

  const loadProductGovernance = useCallback(async (address: Address): Promise<ScopedRefreshLoadResult> => {
    const key = `${activeNetwork.chainId.toString()}:${runtimeDeploymentIdentity ?? "unconfigured"}:${address.toLowerCase()}:${wallet.account?.toLowerCase() ?? "read-only"}`;
    if (activeGovernanceKeyRef.current !== key) return "stale";
    if (productGovernanceLoadedKeyRef.current === key) return "loaded";
    const requestVersion = ++governanceRequestVersionRef.current;
    governanceLoadAbortControllerRef.current?.abort(new DOMException("A newer governance load started.", "AbortError"));
    const abortController = new AbortController();
    governanceLoadAbortControllerRef.current = abortController;
    const deadline = window.setTimeout(() => {
      const error = new Error("Governance loading timed out. Try again.");
      error.name = "TimeoutError";
      abortController.abort(error);
    }, GOVERNANCE_LOAD_DEADLINE_MS);
    const backgroundRefresh = isGovernanceBackgroundRefresh(productGovernanceSnapshotKeyRef.current, key);
    productGovernanceLoadedKeyRef.current = key;
    if (!backgroundRefresh) {
      setScheduledBoardroomOperations([]);
      setProductGovernanceOperationsVerifiedKey(undefined);
      setProductGovernanceOperationsComplete(false);
      setProductGovernanceOperationsLoaded(false);
      setBoardroomStakerPower(undefined);
      setBoardroomStakerPowerVerifiedKey(undefined);
      setProductGovernanceWarning(undefined);
    }
    setProductGovernanceLoading(true);
    setProductGovernanceError(undefined);
    try {
      const releaseSupport = boardroomControlReleaseSupport(deployment);
      const [operationsResult, stakerResult] = await Promise.allSettled([
        releaseSupport.supported ? raceWithGovernanceAbort(
          import("../lib/governance-actions").then(({ loadScheduledGovernanceOperations }) =>
            loadScheduledGovernanceOperations(publicClient, {
              boardroom: address,
              chainId: activeNetwork.chainId,
              signal: abortController.signal,
              sentinelClient,
            })),
          abortController.signal,
        ) : Promise.resolve({
          operations: [],
          complete: false,
          source: "chain" as const,
          warning: releaseSupport.reason,
        }),
        wallet.account
          ? raceWithGovernanceAbort(
              readBoardroomStakerPower(publicClient, { boardroom: address, account: wallet.account }),
              abortController.signal,
            )
          : Promise.resolve(undefined),
      ]);
      if (governanceRequestVersionRef.current !== requestVersion || activeGovernanceKeyRef.current !== key) return "stale";
      if (operationsResult.status === "fulfilled") {
        setScheduledBoardroomOperations(operationsResult.value.operations.filter((operation) => sameAddress(operation.boardroom, address)));
        setProductGovernanceOperationsComplete(operationsResult.value.complete);
        setProductGovernanceOperationsLoaded(true);
        setProductGovernanceWarning(operationsResult.value.warning);
        setProductGovernanceOperationsVerifiedKey(key);
        productGovernanceSnapshotKeyRef.current = key;
      }
      if (stakerResult.status === "fulfilled" && stakerResult.value?.boardroom && sameAddress(stakerResult.value.boardroom, address)) {
        setBoardroomStakerPower(stakerResult.value);
        setBoardroomStakerPowerVerifiedKey(key);
      }
      const errors = [...new Set([operationsResult, stakerResult]
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => errorMessage(result.reason)))];
      if (errors.length > 0) {
        productGovernanceLoadedKeyRef.current = undefined;
        setProductGovernanceError(errors.join(" "));
        return "failed";
      }
      return "loaded";
    } finally {
      window.clearTimeout(deadline);
      if (governanceLoadAbortControllerRef.current === abortController) {
        governanceLoadAbortControllerRef.current = undefined;
      }
      if (governanceRequestVersionRef.current === requestVersion && activeGovernanceKeyRef.current === key) {
        setProductGovernanceLoading(false);
      }
    }
  }, [activeNetwork.chainId, deployment, publicClient, runtimeDeploymentIdentity, sentinelClient, wallet.account]);

  useEffect(() => {
    setDiscovery(loadDiscoverySnapshot(discoveryKey));
    setLoadedDiscoveryKey(discoveryKey);
  }, [discoveryKey]);

  useEffect(() => {
    productLoadAbortControllerRef.current?.abort(new DOMException("Project route changed.", "AbortError"));
    productLoadAbortControllerRef.current = undefined;
    productCatalogLoadMoreAbortControllerRef.current?.abort(new DOMException("Project route changed.", "AbortError"));
    productCatalogLoadMoreAbortControllerRef.current = undefined;
    productRequestVersionRef.current += 1;
    setProductBoardroomError(undefined);
    setProductBoardroomFailureKind(undefined);
    setProductBoardroomLoading(false);
    setProductBoardroomVerifiedKey(undefined);
    setProductBoardroom((current) => {
      if (!requestedProductBoardroom) return undefined;
      return current && sameAddress(current.address, requestedProductBoardroom) ? current : undefined;
    });
  }, [activeNetwork.chainId, requestedProductBoardroom, runtimeDeploymentIdentity]);

  useEffect(() => {
    const key = activeProjectPositionKey;
    const dashboard = exactProjectDashboard;
    const account = wallet.account;
    setProjectPosition(undefined);
    setProjectPositionVerifiedKey(undefined);
    setProjectPositionError(undefined);
    setProjectPositionErrorKey(undefined);
    setProjectPositionLoading(false);
    setProjectPositionLoadingKey(undefined);
    if (!key || !dashboard || !account) return;

    const request = projectPositionReadCoordinatorRef.current.begin(key);
    setProjectPositionLoading(true);
    setProjectPositionLoadingKey(key);
    void readProjectWalletPosition(publicClient, { account, dashboard })
      .then((position) => {
        if (!projectPositionReadCoordinatorRef.current.isCurrent(request)) return;
        setProjectPosition(position);
        setProjectPositionVerifiedKey(key);
      })
      .catch((error) => {
        if (!projectPositionReadCoordinatorRef.current.isCurrent(request)) return;
        setProjectPositionError(errorMessage(error));
        setProjectPositionErrorKey(key);
      })
      .finally(() => {
        if (projectPositionReadCoordinatorRef.current.isCurrent(request)) setProjectPositionLoading(false);
      });

    return () => {
      projectPositionReadCoordinatorRef.current.invalidate(request);
    };
  }, [activeProjectPositionKey, publicClient]);

  useEffect(() => {
    if (appRouteChainId(appRoute) !== undefined && appRouteChainId(appRoute) !== activeNetwork.chainId) return;
    if (!shouldLoadProductBoardroom({
      activeRoute: appRoute,
      deployment,
      requestedAddress: requestedProductBoardroom,
      productBoardroom: exactProjectDashboard,
      productBoardroomError,
      productBoardroomLoading,
      productCatalogLoaded,
    })) return;
    void loadProductBoardroom(requestedProductBoardroom);
  }, [activeNetwork.chainId, appRoute, deployment, exactProjectDashboard, loadProductBoardroom, productBoardroomError, productBoardroomLoading, productCatalogLoaded, requestedProductBoardroom]);

  useEffect(() => {
    if (appRoute.kind !== "legacy-project" || !productCatalogLoaded) return;
    const address = resolveProductBoardroomAddress(productCatalog);
    if (!address) return;
    navigateRoute(legacyProjectDestination(appRoute, activeNetwork.chainId, address), true);
  }, [activeNetwork.chainId, appRoute, navigateRoute, productCatalog, productCatalogLoaded]);

  useEffect(() => {
    governanceLoadAbortControllerRef.current?.abort(new DOMException("Governance route changed.", "AbortError"));
    governanceLoadAbortControllerRef.current = undefined;
    governanceRequestVersionRef.current += 1;
    productGovernanceLoadedKeyRef.current = undefined;
    productGovernanceSnapshotKeyRef.current = undefined;
    setScheduledBoardroomOperations([]);
    setProductGovernanceOperationsVerifiedKey(undefined);
    setProductGovernanceOperationsComplete(false);
    setProductGovernanceOperationsLoaded(false);
    setBoardroomStakerPower(undefined);
    setBoardroomStakerPowerVerifiedKey(undefined);
    setProductGovernanceError(undefined);
    setProductGovernanceWarning(undefined);
    setProductGovernanceLoading(false);
    return () => {
      governanceLoadAbortControllerRef.current?.abort(new DOMException("Governance view closed.", "AbortError"));
      governanceLoadAbortControllerRef.current = undefined;
      governanceRequestVersionRef.current += 1;
    };
  }, [activeGovernanceKey]);

  useEffect(() => {
    const governanceRoute = (appRoute.kind === "project" && appRoute.section === "governance")
      || (appRoute.kind === "studio-project" && (appRoute.section === "governance" || appRoute.section === "close"));
    if (!governanceRoute || !exactProjectDashboard) return;
    void loadProductGovernance(exactProjectDashboard.address);
  }, [appRoute, exactProjectDashboard, loadProductGovernance]);

  useEffect(() => {
    if (!activeGovernanceKey || productGovernanceLoading) return;
    const delay = governanceRefreshDelay(verifiedScheduledBoardroomOperations);
    const timer = window.setTimeout(() => {
      const route = activeAppRouteRef.current;
      if (activeGovernanceKeyRef.current !== activeGovernanceKey || route.kind !== "project" && route.kind !== "studio-project") return;
      productGovernanceLoadedKeyRef.current = undefined;
      void loadProductGovernance(route.boardroom);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activeGovernanceKey, loadProductGovernance, productGovernanceLoading, verifiedScheduledBoardroomOperations]);

  useEffect(() => {
    setSwapQuote(undefined);
  }, [swapForm]);

  useEffect(() => {
    setLiquidityQuote(undefined);
    setRemoveLiquidityQuote(undefined);
    setAmmPosition(undefined);
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
    const loadScope = activeSwapTokenLoadScopeRef.current;
    if (!loadScope) return;
    const request = ammReadCoordinatorRef.current.begin("token-list", activeAmmTokenReadKeyRef.current);
    if (!ammReadCoordinatorRef.current.isCurrent(request)) return;
    ammTokenLoadAbortControllerRef.current?.abort(new DOMException("A newer AMM token load started.", "AbortError"));
    const abortController = new AbortController();
    ammTokenLoadAbortControllerRef.current = abortController;
    const deadline = window.setTimeout(() => {
      const timeout = new Error("AMM token loading timed out. Try again.");
      timeout.name = "TimeoutError";
      abortController.abort(timeout);
    }, AMM_TOKEN_LOAD_DEADLINE_MS);
    setSwapTokenListLoading(true);
    try {
      if (!deployment?.ammFactory) {
        throw new Error("Runtime deployment is still loading for this chain.");
      }
      const next = await readSwapTokenList(publicClient, deployment, activeAccountRef.current, {
        discoveryMode: loadScope.mode,
        pinnedPools: loadScope.pinnedPools,
        signal: abortController.signal,
        wrappedNativeLabel: activeNetwork.wrappedNativeSymbol,
      });
      if (!ammReadCoordinatorRef.current.isCurrent(request)) return;
      setSwapTokenList(next);
      setSwapForm((current) => withSwapTokenListDefaults(current, next, deployment));
      setLiquidityForm((current) => withLiquidityTokenListDefaults(current, next, deployment));
      if (next.error) {
        pushLog(`Swap token list: ${next.error}`, next.tokens.length > 0 ? "info" : "error");
      } else {
        pushLog(`Loaded ${next.tokens.length.toString()} swap tokens across ${next.pools.length.toString()} pools`, "success");
      }
    } catch (error) {
      if (!ammReadCoordinatorRef.current.isCurrent(request)) return;
      const message = errorMessage(error);
      setSwapTokenList({ tokens: [], pools: [], loaded: true, error: message });
      pushLog(message, "error");
    } finally {
      window.clearTimeout(deadline);
      if (ammTokenLoadAbortControllerRef.current === abortController) {
        ammTokenLoadAbortControllerRef.current = undefined;
        setSwapTokenListLoading(false);
      }
    }
  }, [activeNetwork.wrappedNativeSymbol, deployment, publicClient, pushLog]);

  useEffect(() => {
    if (!shouldLoadSwapTokens({ deployment, loadScope: swapTokenLoadScope, swapTokenList, swapTokenListLoading })) return;
    void loadSwapTokens();
  }, [ammTokenReadKey, deployment, loadSwapTokens, swapTokenList, swapTokenListLoading, swapTokenLoadScope]);

  useEffect(() => {
    if (!wallet.account || boardroomForm.owner) return;
    setBoardroomForm((current) => ({ ...current, owner: wallet.account ?? current.owner }));
  }, [boardroomForm.owner, wallet.account]);

  const updateBoardroomAddress = useCallback((address: string): void => {
    boardroomLoadVersionRef.current += 1;
    bondMarketLoadVersionRef.current += 1;
    dutchAuctionLoadVersionRef.current += 1;
    fixedPriceSaleLoadVersionRef.current += 1;
    merkleAirdropLoadVersionRef.current += 1;
    migratingCurveLoadVersionRef.current += 1;
    lockedLiquidityLoadVersionRef.current += 1;
    setBoardroomAddress(address);
    setBoardroomSnapshot(undefined);
    setBoardroomSnapshotVerifiedKey(undefined);
    setBoardroomMintAmount("1");
    setBoardroomMintTo("");
    setBoardroomGrantForm(defaultBoardroomGrantForm());
    setBondMarketAddress("");
    setBondMarketForm(defaultBondMarketForm());
    setBondMarketSnapshot(undefined);
    setBondMarketSnapshotVerifiedKey(undefined);
    setDutchAuctionAddress("");
    setDutchAuctionForm(defaultDutchAuctionForm());
    setDutchAuctionSnapshot(undefined);
    setDutchAuctionSnapshotVerifiedKey(undefined);
    setFixedPriceSaleAddress("");
    setFixedPriceSaleForm(defaultFixedPriceSaleForm());
    setFixedPriceSaleSnapshot(undefined);
    setFixedPriceSaleSnapshotVerifiedKey(undefined);
    setMerkleAirdropAddress("");
    setMerkleAirdropForm(defaultMerkleAirdropForm());
    setMerkleAirdropSnapshot(undefined);
    setMerkleAirdropSnapshotVerifiedKey(undefined);
    setMigratingCurveAddress("");
    setMigratingCurveForm(defaultMigratingCurveForm());
    setMigratingCurveSnapshot(undefined);
    setMigratingCurveSnapshotVerifiedKey(undefined);
    setCurveMigrationForm(defaultCurveMigrationForm());
    setLockedLiquidityAddress("");
    setLockedLiquidityForm(defaultLockedLiquidityForm());
    setLockedLiquidityExitForm(defaultLockedLiquidityExitForm());
    setLockedLiquiditySnapshot(undefined);
    setLockedLiquiditySnapshotVerifiedKey(undefined);
    setWindDownForm(defaultWindDownForm());
    setPredictedBoardroomGrant(undefined);
    setPredictedBondMarket(undefined);
    setPredictedDutchAuction(undefined);
    setPredictedFixedPriceSale(undefined);
    setPredictedMerkleAirdrop(undefined);
    setPredictedMigratingCurve(undefined);
    setPredictedLockedLiquidity(undefined);
    setSwapForm(defaultSwapForm());
    setSwapQuote(undefined);
    setLiquidityForm(defaultLiquidityForm());
    setLiquidityQuote(undefined);
    setRemoveLiquidityForm(defaultRemoveLiquidityForm());
    setRemoveLiquidityQuote(undefined);
    setAmmPosition(undefined);
    setSelectedParticipationRoute(undefined);
  }, []);

  const updateFixedPriceSaleAddress = useCallback((address: string): void => {
    fixedPriceSaleLoadVersionRef.current += 1;
    setFixedPriceSaleAddress(address);
    setFixedPriceSaleSnapshot(undefined);
    setFixedPriceSaleSnapshotVerifiedKey(undefined);
  }, []);

  const updateDutchAuctionAddress = useCallback((address: string): void => {
    dutchAuctionLoadVersionRef.current += 1;
    setDutchAuctionAddress(address);
    setDutchAuctionSnapshot(undefined);
    setDutchAuctionSnapshotVerifiedKey(undefined);
  }, []);

  const updateBondMarketAddress = useCallback((address: string): void => {
    bondMarketLoadVersionRef.current += 1;
    setBondMarketAddress(address);
    setBondMarketSnapshot(undefined);
    setBondMarketSnapshotVerifiedKey(undefined);
  }, []);

  const updateMerkleAirdropAddress = useCallback((address: string): void => {
    merkleAirdropLoadVersionRef.current += 1;
    setMerkleAirdropAddress(address);
    setMerkleAirdropSnapshot(undefined);
    setMerkleAirdropSnapshotVerifiedKey(undefined);
  }, []);

  const updateMigratingCurveAddress = useCallback((address: string): void => {
    migratingCurveLoadVersionRef.current += 1;
    setMigratingCurveAddress(address);
    setMigratingCurveSnapshot(undefined);
    setMigratingCurveSnapshotVerifiedKey(undefined);
  }, []);

  const updateLockedLiquidityAddress = useCallback((address: string): void => {
    lockedLiquidityLoadVersionRef.current += 1;
    setLockedLiquidityAddress(address);
    setLockedLiquiditySnapshot(undefined);
    setLockedLiquiditySnapshotVerifiedKey(undefined);
  }, []);

  const clearBoardroomGrantPrediction = useCallback((): void => {
    if (predictedBoardroomGrant && grantAddress.toLowerCase() === predictedBoardroomGrant.toLowerCase()) {
      updateGrantAddress("");
    }
    setPredictedBoardroomGrant(undefined);
  }, [grantAddress, predictedBoardroomGrant, updateGrantAddress]);

  const refreshBoardroom = async (address?: Address): Promise<BoardroomSnapshot> => {
    const boardroom = address ?? boardroomSnapshot?.address ?? requireAddress(boardroomAddress, "Boardroom address");
    const requestVersion = ++boardroomLoadVersionRef.current;
    const requestScope = activeStudioReadScopeKeyRef.current;
    const requestChainId = activeNetwork.chainId;
    const requestDeploymentIdentity = runtimeDeploymentIdentity;
    const route = activeAppRouteRef.current;
    if (route.kind === "studio-project" && !sameAddress(route.boardroom, boardroom)) {
      throw new Error("Studio project identity changed. Reload the Boardroom from its canonical route before continuing.");
    }
    setBoardroomSnapshotVerifiedKey(undefined);
    const snapshot = await readBoardroomSnapshot(publicClient, boardroom, deployment);
    if (activeStudioReadScopeKeyRef.current !== requestScope || boardroomLoadVersionRef.current !== requestVersion) return snapshot;
    setBoardroomSnapshot(snapshot);
    setBoardroomSnapshotVerifiedKey(canonicalProjectStateKey(
      requestChainId,
      boardroom,
      requestDeploymentIdentity,
    ));
    setBoardroomMintTo((current) => current || snapshot.address);
    await loadProductBoardroom(boardroom);
    return snapshot;
  };

  useEffect(() => {
    if (appRoute.kind !== "studio-project" || appRoute.chainId !== activeNetwork.chainId) return;
    const address = appRoute.boardroom;
    if (boardroomAddress.toLowerCase() !== address.toLowerCase()) {
      updateBoardroomAddress(address);
      return;
    }
    if (!exactProjectDashboard || !sameAddress(exactProjectDashboard.address, address)) return;
    if (boardroomSnapshot === exactProjectDashboard.snapshot
      && boardroomSnapshotVerifiedKey === exactProjectVerifiedKey) return;
    setBoardroomSnapshot(exactProjectDashboard.snapshot);
    setBoardroomSnapshotVerifiedKey(exactProjectVerifiedKey);
    setBoardroomMintTo(exactProjectDashboard.snapshot.address);
  }, [activeNetwork.chainId, appRoute, boardroomAddress, boardroomSnapshot, boardroomSnapshotVerifiedKey, exactProjectDashboard, exactProjectVerifiedKey, updateBoardroomAddress]);

  const submitContractTransaction = async (
    label: string,
    request: Record<string, unknown>,
    actionGuard?: TransactionActionGuard,
  ): Promise<Hex> => {
    const actionOrigin = activeActionOriginRef.current;
    const contextTicket = transactionContextGuardRef.current.capture();
    const transactionIdentity: TransactionIdentity = {
      account: actionOrigin?.account ?? activeAccount(),
      chainId: actionOrigin?.chainId ?? activeNetwork.chainId,
      contextGeneration: actionOrigin?.contextGeneration ?? contextTicket.generation,
      deploymentIdentity: actionOrigin?.deploymentIdentity ?? activeDeploymentIdentityRef.current,
      routeIdentity: actionOrigin?.routeIdentity ?? appRouteIdentityKey(activeAppRouteRef.current),
    };
    const transactionRoute = activeAppRouteRef.current;
    const callReview = contractCallReview(label, request);
    const txChainId = transactionIdentity.chainId;
    const liveTransactionIdentity = () => ({
        account: activeAccountRef.current,
        chainId: activeChainIdRef.current,
        contextGeneration: transactionContextGuardRef.current.capture().generation,
        deploymentIdentity: activeDeploymentIdentityRef.current,
        routeIdentity: appRouteIdentityKey(activeAppRouteRef.current),
        walletChainId: activeWalletChainIdRef.current,
    });
    const assertLiveIdentity = (phase: "review" | "simulation" | "submission"): void => {
      assertTransactionIdentity(transactionIdentity, liveTransactionIdentity(), phase);
      assertTransactionActionCurrent(actionGuard, phase);
    };
    assertLiveIdentity("review");
    const transactionId = startTransaction(callReview);
    let submittedHash: Hex | undefined;
    try {
      await requestReview(callReview);
      assertLiveIdentity("simulation");
      updateTransaction(transactionId, { stage: "simulating" });
      pushLog(contractCallPreview(label, request), "info");
      const simulation = await publicClient.simulateContract({
        account: transactionIdentity.account,
        ...request,
      } as unknown as Parameters<typeof publicClient.simulateContract>[0]);
      updateTransaction(transactionId, { stage: "awaiting-signature" });

      assertLiveIdentity("submission");
      const client = walletClientRef.current?.();
      if (!client) throw new Error("Wallet client is not ready yet.");
      assertLiveIdentity("submission");
      const receiptWatcherIdentity = [
        txChainId.toString(),
        transactionIdentity.account.toLowerCase(),
        transactionIdentity.deploymentIdentity ?? "unconfigured",
      ].join(":");
      const receiptWatcherVersion = transactionWatcherVersionRef.current;
      const hash = (await client.writeContract({
        ...simulation.request,
      } as unknown as Parameters<typeof client.writeContract>[0])) as Hex;

      submittedHash = hash;
      updateTransactionForIdentity(txChainId, transactionIdentity.account, transactionId, {
        deploymentIdentity: transactionIdentity.deploymentIdentity,
        error: undefined,
        hash,
        refreshBlocked: false,
        refreshPending: false,
        refreshRoute: transactionRoute,
        stage: "submitted",
        submittedHash: hash,
      });
      pushLog(`${label} submitted`, "info", hash, txChainId);
      const outcome = await ensureTransactionReceipt(
        { chainId: txChainId, hash, id: transactionId, label, refreshRoute: transactionRoute, submittedHash: hash },
        receiptWatcherIdentity,
        receiptWatcherVersion,
        transactionRoute,
      );
      if (outcome.kind === "confirmed") return outcome.hash;
      throw new TransactionReceiptFinalizedError(outcome);
    } catch (error) {
      if (submittedHash) throw error;
      const cancelled = error instanceof Error && error.name === "TransactionReviewCancelledError";
      updateTransaction(transactionId, {
        error: cancelled ? undefined : errorMessage(error),
        stage: cancelled ? "cancelled" : "failed",
      });
      throw error;
    }
  };

  const requireWritableBoardroomFacetSetHash = async (
    boardroom: Address,
    preparedFacetSetHash?: Hex,
  ): Promise<Hex> => {
    const proof = await assertLiveBoardroomControlRelease(publicClient, deployment, boardroom);
    if (proof.migrationRequired) {
      throw new Error("This Boardroom must be migrated to the active protocol release before it can accept writes.");
    }
    if (
      preparedFacetSetHash
      && proof.facetSetHash.toLowerCase() !== preparedFacetSetHash.toLowerCase()
    ) {
      throw new Error("The Boardroom release changed after this operation was prepared. Refresh and review it again.");
    }
    return proof.facetSetHash;
  };

  const submitBoardroomExecution = async (
    label: string,
    boardroom: {
      address: Address;
      controller: Address;
      controllerConfigurationEpoch: bigint;
      governanceEpoch: bigint;
      launched: boolean;
      facetSetHash: Hex;
      migrationRequired: boolean;
      proposer: Address;
      status: number;
    },
    request: Record<string, unknown>,
    actionGuard?: TransactionActionGuard,
  ): Promise<"execute" | "schedule" | "windDown"> => {
    const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
      boardroom.address,
      boardroom.facetSetHash,
    );
    const calls = boardroomCallsFromExecution(request);
    const plan = planBoardroomCallExecution({
      boardroom: boardroom.address,
      expectedFacetSetHash,
      calls,
      lifecycle: {
        launched: boardroom.launched,
        status: boardroom.status,
        migrationRequired: false,
        controller: boardroom.controller,
        governanceEpoch: boardroom.governanceEpoch,
        controllerConfigurationEpoch: boardroom.controllerConfigurationEpoch,
        proposer: boardroom.proposer,
      },
      ...(boardroom.launched && boardroom.status === 0 ? { salt: randomSalt() } : {}),
    });
    const transactionLabel = plan.kind === "schedule" ? `Schedule ${label.toLowerCase()}` : label;
    await submitContractTransaction(transactionLabel, plan.transaction, actionGuard);
    if (plan.kind === "schedule") {
      pushLog(`${label} is scheduled on the current controller. Anyone may execute it after the delay.`, "success");
    }
    return plan.kind;
  };

  const activeActionOriginIsCurrent = (): boolean => {
    const origin = activeActionOriginRef.current;
    if (!origin) return true;
    const accountMatches = origin.account
      ? Boolean(activeAccountRef.current && sameAddress(origin.account, activeAccountRef.current))
      : activeAccountRef.current === undefined;
    return accountMatches
      && origin.chainId === activeChainIdRef.current
      && origin.contextGeneration === transactionContextGuardRef.current.capture().generation
      && origin.deploymentIdentity === activeDeploymentIdentityRef.current
      && origin.routeIdentity === appRouteIdentityKey(activeAppRouteRef.current);
  };

  const beginAmmRead = (kind: AmmReadKind, key: string): AmmReadRequest =>
    ammReadCoordinatorRef.current.begin(kind, key);

  const assertCurrentAmmRead = (request: AmmReadRequest): void => {
    if (!ammReadCoordinatorRef.current.isCurrent(request)) {
      throw new Error("AMM account, project, or form changed while data was loading. Refresh the current quote.");
    }
  };

  const ammActionGuard = (kind: AmmReadKind, key: string): TransactionActionGuard => {
    const request = beginAmmRead(kind, key);
    return { isCurrent: () => ammReadCoordinatorRef.current.isCurrent(request) };
  };

  const refreshSwapQuote = async (): Promise<void> => {
    const request = beginAmmRead("swap-quote", ammSwapQuoteReadKey);
    if (!ammReadCoordinatorRef.current.isCurrent(request)) return;
    const next = await readSwapQuote(publicClient, deployment, swapForm, wallet.account);
    if (!ammReadCoordinatorRef.current.isCurrent(request)) return;
    const route = activeAppRouteRef.current;
    const projectParticipationRoute = route.kind === "project" && route.section === "participate";
    const expectedPool = projectParticipationRoute ? exactProjectPoolRef.current : undefined;
    if (projectParticipationRoute && !expectedPool) {
      const message = "Select a live project AMM route before requesting a swap quote.";
      setSwapQuote({ ...next, error: message });
      pushLog(message, "error");
      return;
    }
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
    const request = beginAmmRead("swap-quote", ammSwapQuoteReadKey);
    assertCurrentAmmRead(request);
    const next = await readSwapQuote(publicClient, deployment, swapForm, wallet.account);
    assertCurrentAmmRead(request);
    setSwapQuote(next);
    if (next.error) throw new Error(next.error);
    const route = activeAppRouteRef.current;
    const projectParticipationRoute = route.kind === "project" && route.section === "participate";
    const expectedPool = projectParticipationRoute ? exactProjectPoolRef.current : undefined;
    if (projectParticipationRoute && !expectedPool) {
      throw new Error("Select a live project AMM route before submitting a swap.");
    }
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

    await submitContractTransaction(
      "Swap input approval",
      buildErc20Approval({ token: quote.tokenIn.address, spender: router, amount: quote.amountIn }),
      ammActionGuard("swap-quote", ammSwapQuoteReadKey),
    );
  };

  const executeSwap = async (): Promise<void> => {
    const account = activeAccount();
    assertFutureSwapDeadline(swapForm.deadline);
    const quote = await requireFreshSwapQuote();
    if (swapNativeMode(deployment, swapForm) !== "input") {
      requireFreshAllowance("Swap input", quote.tokenIn?.allowance, quote.amountIn);
    }
    await submitContractTransaction(
      "Swap",
      buildSwapTransaction({ deployment, form: swapForm, quote, account }),
      ammActionGuard("swap-quote", ammSwapQuoteReadKey),
    );
    if (!activeActionOriginIsCurrent()) return;
    await refreshSwapQuote();
  };

  const refreshLiquidityQuote = async (): Promise<void> => {
    const quoteRequest = beginAmmRead("liquidity-quote", ammLiquidityQuoteReadKey);
    const positionRequest = beginAmmRead("position", ammPositionReadKey);
    if (!ammReadCoordinatorRef.current.isCurrent(quoteRequest)
      || !ammReadCoordinatorRef.current.isCurrent(positionRequest)) return;
    const [next, position] = await Promise.all([
      readLiquidityQuote(publicClient, deployment, liquidityForm, wallet.account),
      readAmmPosition(publicClient, deployment, liquidityForm.tokenA, liquidityForm.tokenB, wallet.account),
    ]);
    if (!ammReadCoordinatorRef.current.isCurrent(quoteRequest)
      || !ammReadCoordinatorRef.current.isCurrent(positionRequest)) return;
    const route = activeAppRouteRef.current;
    const presentedQuote = route.kind === "studio-project" && route.section === "liquidity"
      ? studioProjectLiquidityQuote(next, studioProjectPoolsRef.current)
      : next;
    setLiquidityQuote(presentedQuote);
    if (presentedQuote === next) setAmmPosition(position);
    if (presentedQuote.error) {
      pushLog(presentedQuote.error, presentedQuote.error.includes("No AMM pool") ? "info" : "error");
      return;
    }
    pushLog("Loaded liquidity quote", "success");
  };

  const requireFreshLiquidityQuote = async (): Promise<LiquidityQuoteState> => {
    const request = beginAmmRead("liquidity-quote", ammLiquidityQuoteReadKey);
    assertCurrentAmmRead(request);
    const next = await readLiquidityQuote(publicClient, deployment, liquidityForm, wallet.account);
    assertCurrentAmmRead(request);
    const route = activeAppRouteRef.current;
    const presentedQuote = route.kind === "studio-project" && route.section === "liquidity"
      ? studioProjectLiquidityQuote(next, studioProjectPoolsRef.current)
      : next;
    setLiquidityQuote(presentedQuote);
    if (presentedQuote.error) throw new Error(presentedQuote.error);
    return presentedQuote;
  };

  const approveLiquidityTokenA = async (): Promise<void> => {
    activeAccount();
    const router = requireDeploymentAddress(deployment?.ammRouter, "AMM router");
    const quote = await requireFreshLiquidityQuote();
    if (!quote.tokenA || quote.amountA === undefined) throw new Error("Refresh the liquidity quote before approving token A.");
    await submitContractTransaction(
      "Liquidity token A approval",
      buildErc20Approval({ token: quote.tokenA.address, spender: router, amount: quote.amountA }),
      ammActionGuard("liquidity-quote", ammLiquidityQuoteReadKey),
    );
  };

  const approveLiquidityTokenB = async (): Promise<void> => {
    activeAccount();
    const router = requireDeploymentAddress(deployment?.ammRouter, "AMM router");
    const quote = await requireFreshLiquidityQuote();
    if (!quote.tokenB || quote.amountB === undefined) throw new Error("Refresh the liquidity quote before approving token B.");
    await submitContractTransaction(
      "Liquidity token B approval",
      buildErc20Approval({ token: quote.tokenB.address, spender: router, amount: quote.amountB }),
      ammActionGuard("liquidity-quote", ammLiquidityQuoteReadKey),
    );
  };

  const addLiquidity = async (): Promise<void> => {
    const account = activeAccount();
    assertFutureSwapDeadline(liquidityForm.deadline);
    const quote = await requireFreshLiquidityQuote();
    if (!liquidityTokenUsesNative(quote.tokenA?.address)) {
      requireFreshAllowance("Liquidity token A", quote.tokenA?.allowance, quote.amountA);
    }
    if (!liquidityTokenUsesNative(quote.tokenB?.address)) {
      requireFreshAllowance("Liquidity token B", quote.tokenB?.allowance, quote.amountB);
    }
    await submitContractTransaction(
      "Add liquidity",
      buildAddLiquidityTransaction({ deployment, form: liquidityForm, quote, account }),
      ammActionGuard("liquidity-quote", ammLiquidityQuoteReadKey),
    );
    if (!activeActionOriginIsCurrent()) return;
    await Promise.all([refreshLiquidityQuote(), loadSwapTokens()]);
  };

  const refreshAmmPosition = async (): Promise<void> => {
    const request = beginAmmRead("position", ammPositionReadKey);
    if (!ammReadCoordinatorRef.current.isCurrent(request)) return;
    const next = await readAmmPosition(publicClient, deployment, liquidityForm.tokenA, liquidityForm.tokenB, wallet.account);
    if (!ammReadCoordinatorRef.current.isCurrent(request)) return;
    setAmmPosition(next);
    if (next?.error) {
      pushLog(next.error, "error");
      return;
    }
    pushLog("Loaded AMM LP position", "success");
  };

  const refreshRemoveLiquidityQuote = async (): Promise<void> => {
    const request = beginAmmRead("remove-liquidity-quote", ammRemoveLiquidityQuoteReadKey);
    if (!ammReadCoordinatorRef.current.isCurrent(request)) return;
    const next = await readRemoveLiquidityQuote(publicClient, deployment, liquidityForm, removeLiquidityForm, wallet.account);
    if (!ammReadCoordinatorRef.current.isCurrent(request)) return;
    const route = activeAppRouteRef.current;
    const presentedQuote = route.kind === "studio-project" && route.section === "liquidity"
      ? studioProjectRemoveLiquidityQuote(next, studioProjectPoolsRef.current)
      : next;
    setRemoveLiquidityQuote(presentedQuote);
    if (presentedQuote.position && presentedQuote === next) setAmmPosition(presentedQuote.position);
    if (presentedQuote.error) {
      pushLog(presentedQuote.error, presentedQuote.error.includes("No AMM pool") ? "info" : "error");
      return;
    }
    pushLog("Loaded remove-liquidity quote", "success");
  };

  const requireFreshRemoveLiquidityQuote = async (): Promise<RemoveLiquidityQuoteState> => {
    const request = beginAmmRead("remove-liquidity-quote", ammRemoveLiquidityQuoteReadKey);
    assertCurrentAmmRead(request);
    const next = await readRemoveLiquidityQuote(publicClient, deployment, liquidityForm, removeLiquidityForm, wallet.account);
    assertCurrentAmmRead(request);
    const route = activeAppRouteRef.current;
    const presentedQuote = route.kind === "studio-project" && route.section === "liquidity"
      ? studioProjectRemoveLiquidityQuote(next, studioProjectPoolsRef.current)
      : next;
    setRemoveLiquidityQuote(presentedQuote);
    if (presentedQuote.position && presentedQuote === next) setAmmPosition(presentedQuote.position);
    if (presentedQuote.error) throw new Error(presentedQuote.error);
    return presentedQuote;
  };

  const approveLpToken = async (): Promise<void> => {
    activeAccount();
    const router = requireDeploymentAddress(deployment?.ammRouter, "AMM router");
    const quote = await requireFreshRemoveLiquidityQuote();
    if (!quote.position?.pool || quote.liquidity === undefined) throw new Error("Refresh the remove-liquidity quote before approving LP.");
    await submitContractTransaction(
      "LP token approval",
      buildErc20Approval({ token: quote.position.pool.address, spender: router, amount: quote.liquidity }),
      ammActionGuard("remove-liquidity-quote", ammRemoveLiquidityQuoteReadKey),
    );
  };

  const removeLiquidity = async (): Promise<void> => {
    const account = activeAccount();
    assertFutureSwapDeadline(removeLiquidityForm.deadline);
    const quote = await requireFreshRemoveLiquidityQuote();
    requireFreshAllowance("LP token", quote.position?.lpAllowance, quote.liquidity);
    await submitContractTransaction(
      "Remove liquidity",
      buildRemoveLiquidityTransaction({ deployment, form: removeLiquidityForm, quote, account }),
      ammActionGuard("remove-liquidity-quote", ammRemoveLiquidityQuoteReadKey),
    );
    if (!activeActionOriginIsCurrent()) return;
    await Promise.all([refreshAmmPosition(), refreshLiquidityQuote()]);
  };

  const claimAmmFees = async (): Promise<void> => {
    activeAccount();
    const request = beginAmmRead("position", ammPositionReadKey);
    assertCurrentAmmRead(request);
    const position = await readAmmPosition(publicClient, deployment, liquidityForm.tokenA, liquidityForm.tokenB, wallet.account);
    assertCurrentAmmRead(request);
    if (!position) throw new Error("Select a pool before claiming fees.");
    if (activeAppRouteRef.current.kind === "studio-project" && activeAppRouteRef.current.section === "liquidity") {
      assertProjectPoolAllowed(position.pool, studioProjectPoolsRef.current, "This fee claim");
    }
    await submitContractTransaction(
      "AMM fee claim",
      buildClaimAmmFeesTransaction(position),
      { isCurrent: () => ammReadCoordinatorRef.current.isCurrent(request) },
    );
    if (!activeActionOriginIsCurrent()) return;
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

  const loadGrantAddress = async (
    grant: Address,
    expectedRouteKey?: string,
    requireCanonical = false,
    existingRequestVersion?: number,
  ): Promise<ScopedRefreshLoadResult> => {
    const requestVersion = existingRequestVersion ?? ++grantLoadVersionRef.current;
    const requestChainId = activeNetwork.chainId;
    const requestDeploymentIdentity = runtimeDeploymentIdentity;
    const requestIsCurrent = (): boolean => {
      if (grantLoadVersionRef.current !== requestVersion
        || activeChainIdRef.current !== requestChainId
        || activeDeploymentIdentityRef.current !== requestDeploymentIdentity) return false;
      if (!expectedRouteKey) return true;
      const route = activeAppRouteRef.current;
      return route.kind === "grant"
        && canonicalGrantRouteKey(route.chainId, route.grant, requestDeploymentIdentity) === expectedRouteKey;
    };
    if (requireCanonical && requestIsCurrent()) setGrantSnapshotVerifiedKey(undefined);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const snapshot = await readGrantState(publicClient, grant, now);
    if (!requestIsCurrent()) return "stale";
    if (requireCanonical) {
      await assertCanonicalGrant(publicClient, deployment, grant, snapshot);
      if (!requestIsCurrent()) return "stale";
    }
    const [tokenMetadata, paymentTokenMetadata, issuerBoardroom] = await Promise.all([
      readTokenMetadata(publicClient, snapshot.token),
      isZeroAddress(snapshot.paymentToken) ? undefined : readTokenMetadata(publicClient, snapshot.paymentToken),
      readGrantIssuerBoardroomAccess(snapshot.issuer),
    ]);
    if (!requestIsCurrent()) return "stale";

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
      settlementCost: snapshot.settlementCost,
      tokenMetadata,
      paymentTokenMetadata,
    });
    setGrantSnapshotVerifiedKey(requireCanonical ? expectedRouteKey : undefined);
    setGrantIssuerBoardroom(issuerBoardroom);
    setGrantAddress(grant);
    if (requireCanonical) {
      setGrantRouteError(undefined);
      setGrantRouteFailureKind(undefined);
    }
    pushLog(`Loaded grant ${grant}`, "success");
    return "loaded";
  };

  const loadGrant = async (): Promise<void> => {
    const route = activeAppRouteRef.current;
    if (route.kind === "grant") {
      await loadCanonicalGrantRoute(
        route.grant,
        canonicalGrantRouteKey(route.chainId, route.grant, runtimeDeploymentIdentity),
      );
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

  const settleAvailableGrant = async (): Promise<void> => {
    const account = activeAccount();
    const grant = selectedGrantAddress();
    const pendingTicket = grantSettlementTicketRef.current;
    let prepared;
    try {
      prepared = await prepareSmartGrantSettlement({
        chainId: activeNetwork.chainId,
        grant,
        holder: account,
        readCurrentState: () => readGrantState(publicClient, grant),
        readQuote: (amount) => readGrantSettlementQuote(publicClient, grant, amount),
        ...(pendingTicket ? { ticket: pendingTicket } : {}),
      });
    } catch (error) {
      if (pendingTicket) grantSettlementTicketRef.current = undefined;
      throw error;
    }

    await submitPreparedGrantSettlement(
      prepared,
      async ({ plan, quote }) => {
        if (plan.kind === "approve") {
          return submitContractTransaction(
            "Approve exact grant payment",
            buildErc20Approval({ token: quote.state.paymentToken, spender: grant, amount: plan.amount }),
          );
        }
        return submitContractTransaction("Settle prepared grant tokens", {
          address: grant,
          abi: tokenGrantAbi,
          functionName: "settle",
          args: [plan.amount],
        });
      },
      ({ plan, quote, ticket }) => {
        setSettleAmount(formatUnits(ticket.amount, quote.state.tokenDecimals));
        setPaymentApproval(formatUnits(ticket.settlementCost, quote.state.paymentTokenDecimals));
        grantSettlementTicketRef.current = plan.kind === "approve" ? ticket : undefined;
      },
    );
  };

  const readGrantIssuerBoardroomAccess = async (issuer: Address): Promise<GrantIssuerBoardroomAccess | undefined> => {
    try {
      await assertCanonicalBoardroom(publicClient, deployment, issuer);
      const snapshot = await readBoardroomState(publicClient, issuer);
      if (isZeroAddress(snapshot.policyRegistry)) return undefined;
      return {
        boardroom: issuer,
        proposer: snapshot.proposer,
        launched: snapshot.launched,
        owner: snapshot.owner,
        status: snapshot.status,
      };
    } catch {
      return undefined;
    }
  };

  async function loadCanonicalGrantRoute(grant: Address, key: string): Promise<void> {
    const requestVersion = ++grantLoadVersionRef.current;
    grantRouteLoadedKeyRef.current = key;
    setGrantSnapshotVerifiedKey(undefined);
    setGrantRouteError(undefined);
    setGrantRouteFailureKind(undefined);
    try {
      const code = await publicClient.getCode({ address: grant });
      if (grantLoadVersionRef.current !== requestVersion) return;
      if (!code || code === "0x") {
        throw new CanonicalProvenanceError(
          "grant",
          "This address does not contain a grant contract on the selected network.",
        );
      }
      await loadGrantAddress(grant, key, true, requestVersion);
    } catch (error) {
      if (grantLoadVersionRef.current !== requestVersion) return;
      const route = activeAppRouteRef.current;
      if (route.kind !== "grant"
        || canonicalGrantRouteKey(route.chainId, route.grant, activeDeploymentIdentityRef.current ?? "") !== key) return;
      grantRouteLoadedKeyRef.current = undefined;
      const message = canonicalGrantReadErrorMessage(error, activeNetwork.name);
      setGrantRouteError(message);
      setGrantRouteFailureKind(error instanceof CanonicalProvenanceError ? "invalid" : "transient");
      pushLog(message, "error");
    }
  }

  useEffect(() => {
    grantLoadVersionRef.current += 1;
    if (appRoute.kind !== "grant" || appRoute.chainId !== activeNetwork.chainId) {
      grantRouteLoadedKeyRef.current = undefined;
      setGrantSnapshot(undefined);
      setGrantSnapshotVerifiedKey(undefined);
      setGrantIssuerBoardroom(undefined);
      setGrantRouteError(undefined);
      setGrantRouteFailureKind(undefined);
      return;
    }
    const key = canonicalGrantRouteKey(appRoute.chainId, appRoute.grant, runtimeDeploymentIdentity);
    if (!deployment?.tokenGrantFactory) {
      grantRouteLoadedKeyRef.current = undefined;
      setGrantRouteError(undefined);
      setGrantRouteFailureKind(undefined);
      return;
    }
    if (grantRouteLoadedKeyRef.current === key) return;
    updateGrantAddress(appRoute.grant);
    void loadCanonicalGrantRoute(appRoute.grant, key);
  }, [activeNetwork.chainId, appRoute, deployment?.tokenGrantFactory, pushLog, runtimeDeploymentIdentity]);

  function invalidateSettledSharedState(): void {
    ammReadCoordinatorRef.current.invalidate();
    ammTokenLoadAbortControllerRef.current?.abort(new DOMException("Settled transaction invalidated AMM data.", "AbortError"));
    ammTokenLoadAbortControllerRef.current = undefined;
    setSwapTokenList(emptySwapTokenList());
    setSwapTokenListLoading(false);
    setSwapQuote(undefined);
    setLiquidityQuote(undefined);
    setRemoveLiquidityQuote(undefined);
    setAmmPosition(undefined);
  }

  async function invalidateConfirmedScopedRoute(routeAtSubmission: AppRoute): Promise<void> {
    const plan = confirmedRouteRefreshPlan(routeAtSubmission, activeAppRouteRef.current);
    if (plan.kind === "none") return;
    if (plan.kind === "grant") {
      const key = canonicalGrantRouteKey(plan.chainId, plan.grant, runtimeDeploymentIdentity);
      grantRouteLoadedKeyRef.current = undefined;
      try {
        const grantResult = await loadGrantAddress(plan.grant, key, true);
        const latestPlan = confirmedRouteRefreshPlan(routeAtSubmission, activeAppRouteRef.current);
        if (confirmedScopedRefreshNeedsRetry(grantResult, latestPlan.kind === "grant")) {
          throw new Error("The confirmed transaction is still waiting for fresh grant data.");
        }
      } catch (error) {
        if (confirmedRouteRefreshPlan(routeAtSubmission, activeAppRouteRef.current).kind === "grant") {
          setGrantRouteError(canonicalGrantReadErrorMessage(error, activeNetwork.name));
          setGrantRouteFailureKind(error instanceof CanonicalProvenanceError ? "invalid" : "transient");
        }
        throw error;
      }
      if (confirmedRouteRefreshPlan(routeAtSubmission, activeAppRouteRef.current).kind === "grant") {
        grantRouteLoadedKeyRef.current = key;
      }
      return;
    }
    const activeProjectKey = canonicalProjectStateKey(
      activeNetwork.chainId,
      plan.boardroom,
      runtimeDeploymentIdentity,
    );
    boardroomLoadVersionRef.current += 1;
    dutchAuctionLoadVersionRef.current += 1;
    fixedPriceSaleLoadVersionRef.current += 1;
    merkleAirdropLoadVersionRef.current += 1;
    migratingCurveLoadVersionRef.current += 1;
    lockedLiquidityLoadVersionRef.current += 1;
    governanceRequestVersionRef.current += 1;
    governanceLoadAbortControllerRef.current?.abort(new DOMException("Confirmed transaction invalidated governance data.", "AbortError"));
    governanceLoadAbortControllerRef.current = undefined;
    productGovernanceLoadedKeyRef.current = undefined;
    productGovernanceSnapshotKeyRef.current = undefined;
    setProductGovernanceOperationsVerifiedKey(undefined);
    setBoardroomStakerPowerVerifiedKey(undefined);
    setProductGovernanceLoading(false);
    const invalidateCurrentProjectChild = (current: string | undefined): string | undefined =>
      current === activeProjectKey ? undefined : current;
    setBoardroomSnapshotVerifiedKey(invalidateCurrentProjectChild);
    setDutchAuctionSnapshotVerifiedKey(invalidateCurrentProjectChild);
    setFixedPriceSaleSnapshotVerifiedKey(invalidateCurrentProjectChild);
    setMerkleAirdropSnapshotVerifiedKey(invalidateCurrentProjectChild);
    setMigratingCurveSnapshotVerifiedKey(invalidateCurrentProjectChild);
    setLockedLiquiditySnapshotVerifiedKey(invalidateCurrentProjectChild);
    const productResult = await loadProductBoardroom(plan.boardroom);
    if (confirmedScopedRefreshNeedsRetry(
      productResult,
      confirmedRouteRefreshPlan(routeAtSubmission, activeAppRouteRef.current).kind !== "none",
    )) {
      throw new Error("The confirmed transaction is still waiting for fresh project data.");
    }
    const currentPlan = confirmedRouteRefreshPlan(routeAtSubmission, activeAppRouteRef.current);
    if (currentPlan.kind === "product" && currentPlan.refreshGovernance) {
      productGovernanceLoadedKeyRef.current = undefined;
      const governanceResult = await loadProductGovernance(currentPlan.boardroom);
      const latestPlan = confirmedRouteRefreshPlan(routeAtSubmission, activeAppRouteRef.current);
      if (confirmedScopedRefreshNeedsRetry(
        governanceResult,
        latestPlan.kind === "product" && latestPlan.refreshGovernance,
      )) {
        throw new Error("The confirmed transaction is still waiting for fresh governance data.");
      }
    }
  }
  invalidateSettledSharedStateRef.current = invalidateSettledSharedState;
  invalidateConfirmedScopedRouteRef.current = invalidateConfirmedScopedRoute;

  const runGrantIssuerAction = async (functionName: GrantIssuerAction, successMessage: string): Promise<void> => {
    const grant = selectedGrantAddress();
    const { issuer } = await readGrantState(publicClient, grant);
    const issuerBoardroom = await assertCanonicalBoardroom(publicClient, deployment, issuer)
      .then(async () => await readBoardroomState(publicClient, issuer))
      .catch(() => undefined);

    if (issuerBoardroom && !isZeroAddress(issuerBoardroom.policyRegistry)) {
      const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
      await submitBoardroomExecution(
        `${successMessage} through Boardroom`,
        issuerBoardroom,
        buildGrantIssuerBoardroomAction({
          boardroom: issuer,
          expectedFacetSetHash: issuerBoardroom.facetSetHash,
          policy: factory,
          grant,
          functionName,
        }),
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
    if (!boardroomControlSupport.supported) {
      throw new Error(boardroomControlSupport.reason ?? "The canonical Boardroom release is unavailable.");
    }
    const release = await assertLiveProtocolFacetRelease(publicClient, deployment);
    const owner = requireAddress(boardroomForm.owner, "Boardroom owner");
    const salt = requireBytes32(boardroomForm.salt, "Boardroom salt");
    const predicted = await sdkPredictBoardroomAddress(publicClient, {
      factory,
      owner,
      name: boardroomForm.name,
      symbol: boardroomForm.symbol,
      salt,
    });
    await submitContractTransaction(
      "Boardroom creation",
      buildBoardroomCreateTransaction({
        factory,
        expectedFacetSetHash: release.facetSetHash,
        owner,
        name: boardroomForm.name,
        symbol: boardroomForm.symbol,
        salt,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    setPredictedBoardroom(predicted);
    setBoardroomAddress(predicted);
    navigateRoute({ kind: "studio-project", chainId: activeNetwork.chainId, boardroom: predicted, section: "setup" });
  };

  const migrateBoardroomStorage = async (): Promise<void> => {
    const route = activeAppRouteRef.current;
    const address = route.kind === "studio-project"
      ? route.boardroom
      : requireAddress(boardroomAddress, "Boardroom address");
    const proof = await assertLiveBoardroomControlRelease(publicClient, deployment, address);
    if (!proof.migrationRequired) {
      throw new Error("This Boardroom already uses the active protocol storage version.");
    }
    await submitContractTransaction(
      "Migrate Boardroom to active protocol release",
      buildBoardroomMigrateTransaction({
        boardroom: address,
        expectedFacetSetHash: proof.facetSetHash,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await refreshBoardroom(address);
    pushLog(`Migrated Boardroom ${address} to protocol release ${proof.activeRelease.toString()}.`, "success");
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
    const lifecycle = requireLoadedBoardroom();
    const boardroom = lifecycle.address;
    const to = boardroomMintTo.trim() ? requireAddress(boardroomMintTo, "Mint recipient") : boardroom;
    const shareToken = lifecycle.shareToken;
    const amount = await parseErc20Amount(publicClient, boardroomMintAmount, shareToken, "Mint amount");
    await submitBoardroomExecution(
      "Share mint",
      lifecycle,
      buildBoardroomExecuteTransaction({
        boardroom,
        expectedFacetSetHash: lifecycle.facetSetHash,
        call: buildBoardroomMintCall({
          boardroom,
          expectedFacetSetHash: lifecycle.facetSetHash,
          to,
          amount,
        }),
      }),
    );
  };

  const boardroomShareGrantTerms = async (): Promise<BoardroomShareGrantTerms> => {
    const loadedBoardroom = requireLoadedBoardroom();
    const holder = requireAddress(boardroomGrantForm.holder, "Grant holder");
    const paymentToken = optionalPaymentToken(boardroomGrantForm.paymentToken);
    const [amount, price] = await Promise.all([
      parseErc20Amount(publicClient, boardroomGrantForm.amount, loadedBoardroom.shareToken, "Grant amount"),
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
    const loadedBoardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { salt } = await boardroomShareGrantTerms();
    const predicted = await sdkPredictBoardroomGrantAddress(publicClient, {
      factory,
      boardroom: loadedBoardroom.address,
      salt,
    });
    setPredictedBoardroomGrant(predicted);
    updateGrantAddress(predicted);
    pushLog(`Predicted Boardroom grant ${predicted}`, "success");
  };

  const boardroomApproveFactory = async (): Promise<void> => {
    const loadedBoardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const assetPolicy = requireDeploymentAddress(deployment?.assetPolicy, "AssetPolicy");
    const { amount } = await boardroomShareGrantTerms();
    await submitBoardroomExecution(
      "Boardroom approval",
      loadedBoardroom,
      buildBoardroomExecuteTransaction({
        boardroom: loadedBoardroom.address,
        expectedFacetSetHash: loadedBoardroom.facetSetHash,
        call: buildBoardroomGrantApprovalCall({
          policy: assetPolicy,
          shareToken: loadedBoardroom.shareToken,
          factory,
          amount,
        }),
      }),
    );
  };

  const boardroomCreateGrant = async (): Promise<void> => {
    const loadedBoardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const terms = await boardroomShareGrantTerms();
    const predicted = await sdkPredictBoardroomGrantAddress(publicClient, {
      factory,
      boardroom: loadedBoardroom.address,
      salt: terms.salt,
    });
    await submitBoardroomExecution(
      "Boardroom grant creation",
      loadedBoardroom,
      buildBoardroomExecuteTransaction({
        boardroom: loadedBoardroom.address,
        expectedFacetSetHash: loadedBoardroom.facetSetHash,
        call: buildBoardroomGrantCreationCall({
          policy: factory,
          factory,
          terms: { ...terms, token: loadedBoardroom.shareToken },
          creationFee,
        }),
        value: creationFee,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    setPredictedBoardroomGrant(predicted);
    updateGrantAddress(predicted);
  };

  const boardroomCreateGrantBatch = async (): Promise<void> => {
    const loadedBoardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const assetPolicy = requireDeploymentAddress(deployment?.assetPolicy, "AssetPolicy");
    const terms = await boardroomShareGrantTerms();
    const predicted = await sdkPredictBoardroomGrantAddress(publicClient, {
      factory,
      boardroom: loadedBoardroom.address,
      salt: terms.salt,
    });
    await submitBoardroomExecution(
      "Boardroom grant batch",
      loadedBoardroom,
      buildBoardroomShareGrantIssuanceBatch({
        boardroom: loadedBoardroom.address,
        expectedFacetSetHash: loadedBoardroom.facetSetHash,
        factory,
        shareToken: loadedBoardroom.shareToken,
        terms,
        creationFee,
        policy: factory,
        assetPolicy,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    setPredictedBoardroomGrant(predicted);
    updateGrantAddress(predicted);
  };

  const requireLoadedBoardroom = (): BoardroomSnapshot => {
    if (!displayedBoardroomSnapshot) throw new Error("Load and verify the current Boardroom first.");
    const route = activeAppRouteRef.current;
    if (route.kind === "studio-project" && !sameAddress(route.boardroom, displayedBoardroomSnapshot.address)) {
      throw new Error("The loaded Boardroom does not match this Studio route. Refresh the project before continuing.");
    }
    return displayedBoardroomSnapshot;
  };

  const requireLoadedBondMarket = (): BondMarketState => {
    const address = requireAddress(bondMarketAddress, "Bond market address");
    return requireVerifiedChildState(displayedBondMarketSnapshot, address, "bond market");
  };

  const requireLoadedFixedPriceSale = (): FixedPriceSaleState => {
    const address = requireAddress(fixedPriceSaleAddress, "Fixed-price sale address");
    return requireVerifiedChildState(displayedFixedPriceSaleSnapshot, address, "fixed-price sale");
  };

  const requireLoadedDutchAuction = (): DutchAuctionState => {
    const address = requireAddress(dutchAuctionAddress, "Dutch auction address");
    return requireVerifiedChildState(displayedDutchAuctionSnapshot, address, "Dutch auction");
  };

  const bondMarketTerms = async (boardroom: BoardroomSnapshot): Promise<BondMarketTerms> => {
    const quoteToken = requireAddress(bondMarketForm.quoteToken, "Bond quote token");
    const [capacity, initialPrice, minimumPrice] = await Promise.all([
      parseErc20Amount(publicClient, bondMarketForm.capacity, boardroom.shareToken, "Bond capacity"),
      parseErc20Amount(publicClient, bondMarketForm.initialPrice, quoteToken, "Bond initial price"),
      parseErc20Amount(publicClient, bondMarketForm.minimumPrice, quoteToken, "Bond minimum price"),
    ]);
    if (capacity === 0n) throw new Error("Bond capacity must be greater than zero.");
    if (initialPrice === 0n || minimumPrice === 0n || initialPrice < minimumPrice) {
      throw new Error("Bond prices must be positive and the initial price must be at least the minimum price.");
    }
    return {
      quoteToken,
      kind: bondMarketForm.kind === "liquidity" ? 1 : 0,
      capacity,
      initialPrice,
      minimumPrice,
      debtBuffer: uintNumberInput(bondMarketForm.debtBuffer, "Debt buffer", 32),
      vesting: uintNumberInput(bondMarketForm.vesting, "Vesting term", 48),
      start: uintNumberInput(bondMarketForm.start, "Market start", 48),
      duration: uintNumberInput(bondMarketForm.duration, "Market duration", 32),
      depositInterval: uintNumberInput(bondMarketForm.depositInterval, "Deposit interval", 32),
      salt: requireBytes32(bondMarketForm.salt, "Bond market salt"),
    };
  };

  const predictBondMarket = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.bondMarketFactory, "BondMarketFactory");
    const salt = requireBytes32(bondMarketForm.salt, "Bond market salt");
    const predicted = await sdkPredictBondMarketAddress(publicClient, { factory, boardroom: boardroom.address, salt });
    setPredictedBondMarket(predicted);
    updateBondMarketAddress(predicted);
    pushLog(`Predicted bond market ${predicted}`, "success");
  };

  const loadBondMarketAddress = async (address?: Address): Promise<BondMarketState> => {
    const market = address ?? requireAddress(bondMarketAddress, "Bond market address");
    const requestVersion = ++bondMarketLoadVersionRef.current;
    const requestScope = activeStudioReadScopeKeyRef.current;
    const requestChainId = activeNetwork.chainId;
    const requestDeploymentIdentity = runtimeDeploymentIdentity;
    const routeAtRequest = activeAppRouteRef.current;
    const requestIsCurrent = (): boolean =>
      activeStudioReadScopeKeyRef.current === requestScope
      && bondMarketLoadVersionRef.current === requestVersion;
    setBondMarketSnapshotVerifiedKey(undefined);
    const [snapshot, canonicalBoardroom] = await Promise.all([
      readBondMarketState(publicClient, market),
      routeAtRequest.kind === "studio-project" ? readBoardroomState(publicClient, routeAtRequest.boardroom) : undefined,
    ]);
    if (!requestIsCurrent()) return snapshot;
    if (routeAtRequest.kind === "studio-project" && canonicalBoardroom) {
      await assertCanonicalBondMarket(publicClient, deployment, canonicalBoardroom, snapshot);
      if (!requestIsCurrent()) return snapshot;
    }
    setBondMarketSnapshot(snapshot);
    setBondMarketSnapshotVerifiedKey(canonicalProjectStateKey(
      requestChainId,
      snapshot.boardroom,
      requestDeploymentIdentity,
    ));
    setBondMarketAddress(market);
    return snapshot;
  };

  const loadBondMarket = async (): Promise<void> => {
    const market = requireAddress(bondMarketAddress, "Bond market address");
    await loadBondMarketAddress(market);
    pushLog(`Loaded bond market ${market}`, "success");
  };

  const createBondMarket = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.bondMarketFactory, "BondMarketFactory");
    const assetPolicy = requireDeploymentAddress(deployment?.assetPolicy, "AssetPolicy");
    const terms = await bondMarketTerms(boardroom);
    const predicted = await sdkPredictBondMarketAddress(publicClient, { factory, boardroom: boardroom.address, salt: terms.salt });
    const executionKind = await submitBoardroomExecution(
      "Bond market creation",
      boardroom,
      buildBoardroomBondMarketBatch({
        boardroom: boardroom.address,
        expectedFacetSetHash: boardroom.facetSetHash,
        factory,
        shareToken: boardroom.shareToken,
        terms,
        policy: factory,
        assetPolicy,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    setPredictedBondMarket(predicted);
    updateBondMarketAddress(predicted);
    if (executionKind !== "schedule") await loadBondMarketAddress(predicted);
  };

  const closeBondMarket = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.bondMarketFactory, "BondMarketFactory");
    const market = requireLoadedBondMarket().address;
    await submitBoardroomExecution(
      "Bond market close",
      boardroom,
      buildBoardroomBondMarketCloseAction({
        boardroom: boardroom.address,
        expectedFacetSetHash: boardroom.facetSetHash,
        policy: factory,
        market,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await loadBondMarketAddress(market);
  };

  const requireLoadedMerkleAirdrop = (): MerkleAirdropState => {
    const address = requireAddress(merkleAirdropAddress, "Merkle airdrop address");
    return requireVerifiedChildState(displayedMerkleAirdropSnapshot, address, "Merkle airdrop");
  };

  const requireLoadedMigratingCurve = (): MigratingBondingCurveState => {
    const address = requireAddress(migratingCurveAddress, "Migrating curve address");
    return requireVerifiedChildState(displayedMigratingCurveSnapshot, address, "bonding curve");
  };

  const requireLoadedLockedLiquidity = (): LockedLiquidityState => {
    const address = requireAddress(lockedLiquidityAddress, "Locked-liquidity address");
    return requireVerifiedChildState(displayedLockedLiquiditySnapshot, address, "locked-liquidity position");
  };

  const dutchAuctionTerms = async (boardroom: BoardroomSnapshot): Promise<BoardroomDutchAuctionTerms> => {
    const paymentToken = requireAddress(dutchAuctionForm.paymentToken, "Payment token");
    const [shareAmount, startPrice, floorPrice, maxPerBuyer] = await Promise.all([
      parseErc20Amount(publicClient, dutchAuctionForm.shareAmount, boardroom.shareToken, "Auction share amount"),
      parseErc20Amount(publicClient, dutchAuctionForm.startPrice, paymentToken, "Auction start price"),
      parseErc20Amount(publicClient, dutchAuctionForm.floorPrice, paymentToken, "Auction floor price"),
      parseErc20Amount(publicClient, dutchAuctionForm.maxPerBuyer, boardroom.shareToken, "Max per buyer"),
    ]);
    const startTime = uintInput(dutchAuctionForm.startTime, "Auction start time");
    const endTime = uintInput(dutchAuctionForm.endTime, "Auction end time");
    if (shareAmount === 0n) throw new Error("Auction share amount must be greater than zero.");
    if (floorPrice === 0n || startPrice <= floorPrice) {
      throw new Error("The start price must be greater than a positive floor price.");
    }
    if (endTime <= startTime) throw new Error("Auction end time must be after its start time.");

    return {
      paymentToken,
      shareAmount,
      startPrice,
      floorPrice,
      maxPerBuyer,
      startTime,
      endTime,
      salt: requireBytes32(dutchAuctionForm.salt, "Auction salt"),
    };
  };

  const predictDutchAuction = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const { salt } = await dutchAuctionTerms(boardroom);
    const predicted = await sdkPredictDutchAuctionAddress(publicClient, { factory, boardroom: boardroom.address, salt });
    setPredictedDutchAuction(predicted);
    updateDutchAuctionAddress(predicted);
    pushLog(`Predicted Dutch auction ${predicted}`, "success");
  };

  const loadDutchAuctionAddress = async (address?: Address): Promise<DutchAuctionState> => {
    const auction = address ?? requireAddress(dutchAuctionAddress, "Dutch auction address");
    const requestVersion = ++dutchAuctionLoadVersionRef.current;
    const requestScope = activeStudioReadScopeKeyRef.current;
    const requestChainId = activeNetwork.chainId;
    const requestDeploymentIdentity = runtimeDeploymentIdentity;
    const routeAtRequest = activeAppRouteRef.current;
    const requestIsCurrent = (): boolean =>
      activeStudioReadScopeKeyRef.current === requestScope
      && dutchAuctionLoadVersionRef.current === requestVersion;
    setDutchAuctionSnapshotVerifiedKey(undefined);
    const [snapshot, canonicalBoardroom] = await Promise.all([
      readDutchAuctionState(publicClient, auction),
      routeAtRequest.kind === "studio-project" ? readBoardroomState(publicClient, routeAtRequest.boardroom) : undefined,
    ]);
    if (!requestIsCurrent()) return snapshot;
    if (routeAtRequest.kind === "studio-project" && canonicalBoardroom) {
      await assertCanonicalDutchAuction(publicClient, deployment, canonicalBoardroom, snapshot);
      if (!requestIsCurrent()) return snapshot;
    }
    setDutchAuctionSnapshot(snapshot);
    setDutchAuctionSnapshotVerifiedKey(canonicalProjectStateKey(
      requestChainId,
      snapshot.boardroom,
      requestDeploymentIdentity,
    ));
    setDutchAuctionAddress(auction);
    return snapshot;
  };

  const loadDutchAuction = async (): Promise<void> => {
    const auction = requireAddress(dutchAuctionAddress, "Dutch auction address");
    await loadDutchAuctionAddress(auction);
    pushLog(`Loaded Dutch auction ${auction}`, "success");
  };

  const createDutchAuction = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const assetPolicy = requireDeploymentAddress(deployment?.assetPolicy, "AssetPolicy");
    const terms = await dutchAuctionTerms(boardroom);
    const predicted = await sdkPredictDutchAuctionAddress(publicClient, { factory, boardroom: boardroom.address, salt: terms.salt });
    const executionKind = await submitBoardroomExecution(
      "Dutch auction creation",
      boardroom,
      buildBoardroomDutchAuctionBatch({
        boardroom: boardroom.address,
        expectedFacetSetHash: boardroom.facetSetHash,
        factory,
        shareToken: boardroom.shareToken,
        terms,
        policy: factory,
        assetPolicy,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    setPredictedDutchAuction(predicted);
    updateDutchAuctionAddress(predicted);
    if (executionKind !== "schedule") await loadDutchAuctionAddress(predicted);
  };

  const finalizeDutchAuction = async (): Promise<void> => {
    const auction = requireLoadedDutchAuction().address;
    await submitContractTransaction("Dutch auction finalization", buildDutchAuctionFinalizeTransaction({ auction }));
    if (!activeActionOriginIsCurrent()) return;
    await loadDutchAuctionAddress(auction);
  };

  const closeDutchAuction = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const auction = requireLoadedDutchAuction().address;
    await submitBoardroomExecution(
      "Dutch auction close",
      boardroom,
      buildBoardroomDutchAuctionCloseAction({
        boardroom: boardroom.address,
        expectedFacetSetHash: boardroom.facetSetHash,
        policy: factory,
        auction,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await loadDutchAuctionAddress(auction);
  };

  const cancelDutchAuction = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const auction = requireLoadedDutchAuction().address;
    await submitBoardroomExecution(
      "Dutch auction cancel",
      boardroom,
      buildBoardroomDutchAuctionCancelAction({
        boardroom: boardroom.address,
        expectedFacetSetHash: boardroom.facetSetHash,
        policy: factory,
        auction,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await loadDutchAuctionAddress(auction);
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
    const requestVersion = ++fixedPriceSaleLoadVersionRef.current;
    const requestScope = activeStudioReadScopeKeyRef.current;
    const requestChainId = activeNetwork.chainId;
    const requestDeploymentIdentity = runtimeDeploymentIdentity;
    const routeAtRequest = activeAppRouteRef.current;
    const requestIsCurrent = (): boolean =>
      activeStudioReadScopeKeyRef.current === requestScope
      && fixedPriceSaleLoadVersionRef.current === requestVersion;
    setFixedPriceSaleSnapshotVerifiedKey(undefined);
    const [snapshot, canonicalBoardroom] = await Promise.all([
      readFixedPriceSaleState(publicClient, sale),
      routeAtRequest.kind === "studio-project" ? readBoardroomState(publicClient, routeAtRequest.boardroom) : undefined,
    ]);
    if (!requestIsCurrent()) return snapshot;
    if (routeAtRequest.kind === "studio-project" && canonicalBoardroom) {
      try {
        await assertCanonicalFixedPriceSale(publicClient, deployment, canonicalBoardroom, snapshot);
      } catch (error) {
        if (!requestIsCurrent()) return snapshot;
        throw error;
      }
      if (!requestIsCurrent()) return snapshot;
    }
    setFixedPriceSaleSnapshot(snapshot);
    setFixedPriceSaleSnapshotVerifiedKey(canonicalProjectStateKey(
      requestChainId,
      snapshot.boardroom,
      requestDeploymentIdentity,
    ));
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
        expectedFacetSetHash: boardroom.facetSetHash,
        factory,
        shareToken: boardroom.shareToken,
        terms,
        policy: factory,
        assetPolicy,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    setPredictedFixedPriceSale(predicted);
    updateFixedPriceSaleAddress(predicted);
    if (executionKind !== "schedule") await loadFixedPriceSaleAddress(predicted);
  };

  const closeFixedPriceSale = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const sale = requireLoadedFixedPriceSale().address;
    await submitBoardroomExecution(
      "Fixed-price sale close",
      boardroom,
      buildBoardroomFixedPriceSaleCloseAction({
        boardroom: boardroom.address,
        expectedFacetSetHash: boardroom.facetSetHash,
        policy: factory,
        sale,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await loadFixedPriceSaleAddress(sale);
  };

  const cancelFixedPriceSale = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const sale = requireLoadedFixedPriceSale().address;
    await submitBoardroomExecution(
      "Fixed-price sale cancel",
      boardroom,
      buildBoardroomFixedPriceSaleCancelAction({
        boardroom: boardroom.address,
        expectedFacetSetHash: boardroom.facetSetHash,
        policy: factory,
        sale,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await loadFixedPriceSaleAddress(sale);
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
    const requestVersion = ++merkleAirdropLoadVersionRef.current;
    const requestScope = activeStudioReadScopeKeyRef.current;
    const requestChainId = activeNetwork.chainId;
    const requestDeploymentIdentity = runtimeDeploymentIdentity;
    const routeAtRequest = activeAppRouteRef.current;
    const requestIsCurrent = (): boolean =>
      activeStudioReadScopeKeyRef.current === requestScope
      && merkleAirdropLoadVersionRef.current === requestVersion;
    setMerkleAirdropSnapshotVerifiedKey(undefined);
    const [snapshot, canonicalBoardroom] = await Promise.all([
      readMerkleAirdropState(publicClient, airdrop),
      routeAtRequest.kind === "studio-project" ? readBoardroomState(publicClient, routeAtRequest.boardroom) : undefined,
    ]);
    if (!requestIsCurrent()) return snapshot;
    if (routeAtRequest.kind === "studio-project" && canonicalBoardroom) {
      try {
        await assertCanonicalMerkleAirdrop(publicClient, deployment, canonicalBoardroom, snapshot);
      } catch (error) {
        if (!requestIsCurrent()) return snapshot;
        throw error;
      }
      if (!requestIsCurrent()) return snapshot;
    }
    setMerkleAirdropSnapshot(snapshot);
    setMerkleAirdropSnapshotVerifiedKey(canonicalProjectStateKey(
      requestChainId,
      snapshot.boardroom,
      requestDeploymentIdentity,
    ));
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
        expectedFacetSetHash: boardroom.facetSetHash,
        factory,
        shareToken: boardroom.shareToken,
        terms,
        policy: factory,
        assetPolicy,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    setPredictedMerkleAirdrop(predicted);
    updateMerkleAirdropAddress(predicted);
    if (executionKind !== "schedule") await loadMerkleAirdropAddress(predicted);
  };

  const closeMerkleAirdrop = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const airdrop = requireLoadedMerkleAirdrop().address;
    await submitBoardroomExecution(
      "Merkle airdrop close",
      boardroom,
      buildBoardroomMerkleAirdropCloseAction({
        boardroom: boardroom.address,
        expectedFacetSetHash: boardroom.facetSetHash,
        policy: factory,
        airdrop,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await loadMerkleAirdropAddress(airdrop);
  };

  const cancelMerkleAirdrop = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const airdrop = requireLoadedMerkleAirdrop().address;
    await submitBoardroomExecution(
      "Merkle airdrop cancel",
      boardroom,
      buildBoardroomMerkleAirdropCancelAction({
        boardroom: boardroom.address,
        expectedFacetSetHash: boardroom.facetSetHash,
        policy: factory,
        airdrop,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await loadMerkleAirdropAddress(airdrop);
  };

  const migratingCurveTerms = async (boardroom: BoardroomSnapshot): Promise<BoardroomMigratingBondingCurveTerms> => {
    const quoteToken = requireAddress(migratingCurveForm.quoteToken, "Quote token");
    const quoteToLpBps = uintInput(migratingCurveForm.quoteToLpBps, "Quote-to-LP bps");
    if (quoteToLpBps === 0n || quoteToLpBps > 10_000n) throw new Error("Quote-to-LP bps must be between 1 and 10000.");
    const [saleSupply, migrationSupply, basePrice, slope, graduationQuoteTarget] = await Promise.all([
      parseErc20Amount(publicClient, migratingCurveForm.saleSupply, boardroom.shareToken, "Curve sale supply"),
      parseErc20Amount(publicClient, migratingCurveForm.migrationSupply, boardroom.shareToken, "Curve migration supply"),
      parseErc20Amount(publicClient, migratingCurveForm.basePrice, quoteToken, "Curve base price"),
      parseErc20Amount(publicClient, migratingCurveForm.slope, quoteToken, "Curve slope"),
      parseErc20Amount(publicClient, migratingCurveForm.graduationQuoteTarget, quoteToken, "Graduation quote target"),
    ]);

    const startTime = uintInput(migratingCurveForm.startTime, "Curve start time");
    const endTime = uintInput(migratingCurveForm.endTime, "Curve end time");
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const maximumLifetime = 90n * 24n * 60n * 60n;
    if (endTime === 0n || endTime <= startTime || endTime > now + maximumLifetime) {
      throw new Error("Curve end time must be after its start and no more than 90 days from now.");
    }

    return {
      quoteToken,
      saleSupply,
      migrationSupply,
      basePrice,
      slope,
      graduationQuoteTarget,
      quoteToLpBps: Number(quoteToLpBps),
      startTime,
      endTime,
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
    const requestVersion = ++migratingCurveLoadVersionRef.current;
    const requestScope = activeStudioReadScopeKeyRef.current;
    const requestChainId = activeNetwork.chainId;
    const requestDeploymentIdentity = runtimeDeploymentIdentity;
    const routeAtRequest = activeAppRouteRef.current;
    const requestIsCurrent = (): boolean =>
      activeStudioReadScopeKeyRef.current === requestScope
      && migratingCurveLoadVersionRef.current === requestVersion;
    setMigratingCurveSnapshotVerifiedKey(undefined);
    const [snapshot, canonicalBoardroom] = await Promise.all([
      readMigratingBondingCurveState(publicClient, curve),
      routeAtRequest.kind === "studio-project" ? readBoardroomState(publicClient, routeAtRequest.boardroom) : undefined,
    ]);
    if (!requestIsCurrent()) return snapshot;
    if (routeAtRequest.kind === "studio-project" && canonicalBoardroom) {
      try {
        await assertCanonicalMigratingBondingCurve(publicClient, deployment, canonicalBoardroom, snapshot);
      } catch (error) {
        if (!requestIsCurrent()) return snapshot;
        throw error;
      }
      if (!requestIsCurrent()) return snapshot;
    }
    setMigratingCurveSnapshot(snapshot);
    setMigratingCurveSnapshotVerifiedKey(canonicalProjectStateKey(
      requestChainId,
      snapshot.boardroom,
      requestDeploymentIdentity,
    ));
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
        expectedFacetSetHash: boardroom.facetSetHash,
        factory,
        shareToken: boardroom.shareToken,
        terms,
        policy: factory,
        assetPolicy,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    setPredictedMigratingCurve(predicted);
    updateMigratingCurveAddress(predicted);
    if (executionKind !== "schedule") await loadMigratingCurveAddress(predicted);
  };

  const cancelMigratingCurve = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.distributionFactory, "DistributionFactory");
    const curve = requireLoadedMigratingCurve().address;
    await submitBoardroomExecution(
      "Migrating curve cancel",
      boardroom,
      buildBoardroomMigratingCurveCancelAction({
        boardroom: boardroom.address,
        expectedFacetSetHash: boardroom.facetSetHash,
        policy: factory,
        curve,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await loadMigratingCurveAddress(curve);
  };

  const migrateCurve = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const curveState = requireLoadedMigratingCurve();
    const curve = curveState.address;
    const [minShareLiquidity, minQuoteLiquidity] = await Promise.all([
      parseErc20Amount(publicClient, curveMigrationForm.minShareLiquidity, curveState.shareToken, "Minimum share liquidity"),
      parseErc20Amount(publicClient, curveMigrationForm.minQuoteLiquidity, curveState.quoteToken, "Minimum quote liquidity"),
    ]);
    await submitContractTransaction(
      "Migrating curve migration",
      buildMigratingBondingCurveMigrationTransaction({
        curve,
        expectedFacetSetHash: boardroom.facetSetHash,
        minShareLiquidity,
        minQuoteLiquidity,
        deadline: uintInput(curveMigrationForm.deadline, "Migration deadline"),
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await loadMigratingCurveAddress(curve);
  };

  const runMigratingCurveLifecycle = async (
    label: string,
    build: (curve: Address) => Record<string, unknown>,
  ): Promise<void> => {
    const curve = requireLoadedMigratingCurve().address;
    await submitContractTransaction(label, build(curve));
    if (!activeActionOriginIsCurrent()) return;
    await loadMigratingCurveAddress(curve);
  };

  // Lifecycle steps that call back into the Boardroom commit to the release they run under.
  const runReleaseBoundMigratingCurveLifecycle = async (
    label: string,
    build: (curve: Address, expectedFacetSetHash: Hex) => Record<string, unknown>,
  ): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const curve = requireLoadedMigratingCurve().address;
    await submitContractTransaction(label, build(curve, boardroom.facetSetHash));
    if (!activeActionOriginIsCurrent()) return;
    await loadMigratingCurveAddress(curve);
  };

  const expireMigratingCurve = () =>
    runMigratingCurveLifecycle("Expire migrating curve", buildMigratingBondingCurveExpireTransaction);
  const fallbackMigratingCurve = () =>
    runMigratingCurveLifecycle("Open curve unwind fallback", buildMigratingBondingCurveFallbackTransaction);
  const finalizeMigratingCurveUnwind = () =>
    runReleaseBoundMigratingCurveLifecycle(
      "Finalize curve unwind",
      buildMigratingBondingCurveFinalizeUnwindTransaction,
    );
  const recoverMigratingCurveQuote = () =>
    runReleaseBoundMigratingCurveLifecycle(
      "Recover quarantined curve quote",
      buildMigratingBondingCurveRecoverQuoteTransaction,
    );
  const openMigratingCurveForfeiture = () =>
    runMigratingCurveLifecycle("Open curve quote forfeiture", buildMigratingBondingCurveOpenForfeitureTransaction);
  const vetoMigratingCurveForfeiture = () =>
    runMigratingCurveLifecycle("Veto curve quote forfeiture", buildMigratingBondingCurveVetoForfeitureTransaction);
  const finalizeMigratingCurveForfeiture = () =>
    runReleaseBoundMigratingCurveLifecycle(
      "Finalize curve quote forfeiture",
      buildMigratingBondingCurveFinalizeForfeitureTransaction,
    );
  const recoverMigratingCurveForfeitedQuote = () =>
    runMigratingCurveLifecycle(
      "Recover forfeited curve quote",
      buildMigratingBondingCurveRecoverForfeitedQuoteTransaction,
    );

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
    const requestVersion = ++lockedLiquidityLoadVersionRef.current;
    const requestScope = activeStudioReadScopeKeyRef.current;
    const requestChainId = activeNetwork.chainId;
    const requestDeploymentIdentity = runtimeDeploymentIdentity;
    const routeAtRequest = activeAppRouteRef.current;
    const requestIsCurrent = (): boolean =>
      activeStudioReadScopeKeyRef.current === requestScope
      && lockedLiquidityLoadVersionRef.current === requestVersion;
    setLockedLiquiditySnapshotVerifiedKey(undefined);
    const [snapshot, canonicalBoardroom] = await Promise.all([
      readLockedLiquidityState(publicClient, locker),
      routeAtRequest.kind === "studio-project" ? readBoardroomState(publicClient, routeAtRequest.boardroom) : undefined,
    ]);
    if (!requestIsCurrent()) return snapshot;
    if (routeAtRequest.kind === "studio-project" && canonicalBoardroom) {
      try {
        await assertCanonicalLockedLiquidity(publicClient, deployment, canonicalBoardroom, snapshot);
      } catch (error) {
        if (!requestIsCurrent()) return snapshot;
        throw error;
      }
      if (!requestIsCurrent()) return snapshot;
    }
    setLockedLiquiditySnapshot(snapshot);
    setLockedLiquiditySnapshotVerifiedKey(canonicalProjectStateKey(
      requestChainId,
      snapshot.boardroom,
      requestDeploymentIdentity,
    ));
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
        expectedFacetSetHash: boardroom.facetSetHash,
        factory,
        shareToken: boardroom.shareToken,
        terms,
        policy: factory,
        assetPolicy,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    setPredictedLockedLiquidity(predicted);
    updateLockedLiquidityAddress(predicted);
    if (executionKind !== "schedule") await loadLockedLiquidityAddress(predicted);
  };

  const claimLockedLiquidityFees = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const factory = requireDeploymentAddress(deployment?.lockedLiquidityFactory, "LockedLiquidityFactory");
    const locker = requireLoadedLockedLiquidity().address;
    await submitBoardroomExecution(
      "Locked-liquidity fee claim",
      boardroom,
      buildBoardroomLockedLiquidityFeeClaimAction({
        boardroom: boardroom.address,
        expectedFacetSetHash: boardroom.facetSetHash,
        policy: factory,
        locker,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await loadLockedLiquidityAddress(locker);
  };

  const addLockedLiquidity = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    if (boardroom.status !== 0) throw new Error("Canonical liquidity can be added only while the Boardroom is Active.");
    const lockerState = requireLoadedLockedLiquidity();
    const factory = requireDeploymentAddress(deployment?.lockedLiquidityFactory, "LockedLiquidityFactory");
    const assetPolicy = requireDeploymentAddress(deployment?.assetPolicy, "AssetPolicy");
    const terms = await lockedLiquidityTerms(boardroom);
    const tokenA = terms.shareTokenSide === "tokenA" ? boardroom.shareToken : terms.quoteToken;
    const tokenB = terms.shareTokenSide === "tokenA" ? terms.quoteToken : boardroom.shareToken;
    if (!sameAddress(tokenA, lockerState.tokenA) || !sameAddress(tokenB, lockerState.tokenB)) {
      throw new Error("Additional liquidity must use the permanent canonical token pair and ordering.");
    }
    await submitBoardroomExecution(
      "Add canonical protocol liquidity",
      boardroom,
      buildBoardroomLockedLiquidityAddBatch({
        boardroom: boardroom.address,
        expectedFacetSetHash: boardroom.facetSetHash,
        factory,
        shareToken: boardroom.shareToken,
        terms,
        policy: factory,
        assetPolicy,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await loadLockedLiquidityAddress(lockerState.address);
  };

  const removeLockedLiquidity = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    if (boardroom.status !== 0) throw new Error("Partial liquidity removal is available only while the Boardroom is Active.");
    const lockerState = requireLoadedLockedLiquidity();
    const factory = requireDeploymentAddress(deployment?.lockedLiquidityFactory, "LockedLiquidityFactory");
    const [liquidity, amountAMin, amountBMin] = await Promise.all([
      parseErc20Amount(publicClient, lockedLiquidityExitForm.liquidity, lockerState.pool, "LP liquidity"),
      parseErc20Amount(publicClient, lockedLiquidityExitForm.amountAMin, lockerState.tokenA, "Removal amount A minimum"),
      parseErc20Amount(publicClient, lockedLiquidityExitForm.amountBMin, lockerState.tokenB, "Removal amount B minimum"),
    ]);
    if (liquidity === 0n) throw new Error("LP liquidity to remove must be greater than zero.");
    await submitBoardroomExecution(
      "Remove canonical protocol liquidity",
      boardroom,
      buildBoardroomLockedLiquidityRemoveAction({
        boardroom: boardroom.address,
        expectedFacetSetHash: boardroom.facetSetHash,
        policy: factory,
        factory,
        liquidity,
        amountAMin,
        amountBMin,
        deadline: uintInput(lockedLiquidityExitForm.deadline, "Removal deadline"),
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await loadLockedLiquidityAddress(lockerState.address);
  };

  const closeLockedLiquidity = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const lockerState = requireLoadedLockedLiquidity();
    const factory = requireDeploymentAddress(deployment?.lockedLiquidityFactory, "LockedLiquidityFactory");
    if (boardroom.status === 1) {
      const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
        boardroom.address,
        boardroom.facetSetHash,
      );
      await submitContractTransaction(
        "Close empty protocol liquidity after wind-down",
        buildBoardroomCloseProtocolLiquidityTransaction({
          boardroom: boardroom.address,
          expectedFacetSetHash,
        }),
      );
    } else {
      await submitBoardroomExecution(
        "Close empty canonical protocol liquidity",
        boardroom,
        buildBoardroomLockedLiquidityCloseAction({
          boardroom: boardroom.address,
          expectedFacetSetHash: boardroom.facetSetHash,
          policy: factory,
          factory,
        }),
      );
    }
    if (!activeActionOriginIsCurrent()) return;
    await loadLockedLiquidityAddress(lockerState.address);
  };

  const exitLockedLiquidity = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    if (boardroom.status !== 1) throw new Error("The permissionless full liquidity exit is available only during wind-down.");
    const lockerState = requireLoadedLockedLiquidity();
    const locker = lockerState.address;
    const [amountAMin, amountBMin] = await Promise.all([
      parseErc20Amount(publicClient, lockedLiquidityExitForm.amountAMin, lockerState.tokenA, "Exit amount A minimum"),
      parseErc20Amount(publicClient, lockedLiquidityExitForm.amountBMin, lockerState.tokenB, "Exit amount B minimum"),
    ]);
    const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
      boardroom.address,
      boardroom.facetSetHash,
    );
    await submitContractTransaction(
      "Locked-liquidity exit",
      buildBoardroomLockedLiquidityExitTransaction({
        boardroom: boardroom.address,
        expectedFacetSetHash,
        amountAMin,
        amountBMin,
        deadline: uintInput(lockedLiquidityExitForm.deadline, "Exit deadline"),
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await loadLockedLiquidityAddress(locker);
  };

  const startWindDown = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
      boardroom.address,
      boardroom.facetSetHash,
    );
    await submitContractTransaction(
      "Boardroom wind-down start",
      buildBoardroomStartWindDownTransaction({ boardroom: boardroom.address, expectedFacetSetHash }),
    );
  };

  const burnTreasuryShares = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
      boardroom.address,
      boardroom.facetSetHash,
    );
    await submitContractTransaction(
      "Treasury share burn",
      buildBoardroomBurnTreasurySharesTransaction({ boardroom: boardroom.address, expectedFacetSetHash }),
    );
  };

  const pruneBoardroomObligation = async (obligationInput: string): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const obligation = requireAddress(obligationInput, "Obligation");
    const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
      boardroom.address,
      boardroom.facetSetHash,
    );
    await submitContractTransaction(
      "Prune terminal Boardroom obligation",
      buildBoardroomPruneObligationTransaction({
        boardroom: boardroom.address,
        expectedFacetSetHash,
        obligation,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await refreshBoardroom(boardroom.address);
  };

  const pruneBoardroomObligations = async (obligationsInput: string): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const rawObligations = obligationsInput.split(/[\s,]+/).filter(Boolean);
    if (rawObligations.length === 0 || rawObligations.length > 32) {
      throw new Error("Provide between 1 and 32 obligation addresses.");
    }
    const obligations = rawObligations.map((value, index) => requireAddress(value, `Obligation ${index + 1}`));
    const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
      boardroom.address,
      boardroom.facetSetHash,
    );
    await submitContractTransaction(
      "Prune terminal Boardroom obligations",
      buildBoardroomPruneObligationsTransaction({
        boardroom: boardroom.address,
        expectedFacetSetHash,
        obligations,
      }),
    );
    if (!activeActionOriginIsCurrent()) return;
    await refreshBoardroom(boardroom.address);
  };

  const registerRedeemableAsset = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const asset = requireAddress(windDownForm.redeemableAsset, "Redeemable asset");
    const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
      boardroom.address,
      boardroom.facetSetHash,
    );
    await submitContractTransaction(
      "Redeemable asset registration",
      buildBoardroomRegisterRedeemableAssetTransaction({
        boardroom: boardroom.address,
        expectedFacetSetHash,
        asset,
      }),
    );
  };

  const beginRedemptionSnapshot = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
      boardroom.address,
      boardroom.facetSetHash,
    );
    await submitContractTransaction(
      "Begin Boardroom redemption snapshot",
      buildBoardroomBeginSnapshotTransaction({ boardroom: boardroom.address, expectedFacetSetHash }),
    );
  };

  const processRedemptionSnapshot = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
      boardroom.address,
      boardroom.facetSetHash,
    );
    await submitContractTransaction(
      "Process Boardroom redemption snapshot page",
      buildBoardroomSnapshotAssetsTransaction({
        boardroom: boardroom.address,
        expectedFacetSetHash,
        maximum: 32n,
      }),
    );
  };

  const openRedemptions = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
      boardroom.address,
      boardroom.facetSetHash,
    );
    await submitContractTransaction(
      "Boardroom redemptions open",
      buildBoardroomOpenRedemptionsTransaction({ boardroom: boardroom.address, expectedFacetSetHash }),
    );
  };

  const redeemBoardroomShares = async (): Promise<void> => {
    const boardroom = requireLoadedBoardroom();
    const shares = await parseErc20Amount(
      publicClient,
      windDownForm.redeemShares,
      boardroom.shareToken,
      "Redeem shares",
    );
    const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
      boardroom.address,
      boardroom.facetSetHash,
    );
    await submitContractTransaction(
      "Boardroom share redemption",
      buildBoardroomRedeemTransaction({
        boardroom: boardroom.address,
        expectedFacetSetHash,
        shares,
      }),
    );
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
    const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
      boardroom.address,
      boardroom.facetSetHash,
    );
    await submitContractTransaction(
      "Boardroom redemption asset claim",
      buildBoardroomClaimRedemptionAssetTransaction({
        boardroom: boardroom.address,
        expectedFacetSetHash,
        asset,
        recipient,
        minAmountOut,
      }),
    );
  };

  const scanDiscoveryRange = async ({ chunkSize, fromBlock, toBlock, rangeMode = "manual" }: DiscoveryScanRange): Promise<void> => {
    if (!wallet.account) throw new Error("Connect wallet first.");
    if (!deployment) throw new Error("Load a deployment artifact first.");

    const requestVersion = networkRequestVersion.current;
    const requestChainId = activeNetwork.chainId;
    const requestAccount = wallet.account;
    const requestDiscoveryKey = discoveryKey;
    const requestDeploymentIdentity = runtimeDeploymentIdentity;
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

  const exactProjectCatalogEntry = exactProjectDashboard?.catalog.find((entry) => sameAddress(entry.address, exactProjectDashboard.address));
  const exactProjectIsSaved = appRoute.kind === "project"
    && savedProjects.isSaved(appRoute.chainId, appRoute.boardroom);
  const activeRouteTitle = contextualAppRouteTitle(
    appRoute,
    exactProjectCatalogEntry?.name ?? exactProjectCatalogEntry?.symbol,
  );
  useEffect(() => {
    if (typeof document !== "undefined") document.title = `${activeRouteTitle} · pledge.cash`;
  }, [activeRouteTitle]);
  useEffect(() => {
    setSelectedParticipationRoute(undefined);
  }, [exactProjectIdentity]);
  const projectCapabilities = resolveProjectCapabilities({
    account: wallet.account,
    routeChainId: appRouteChainId(appRoute) ?? activeNetwork.chainId,
    walletChainId: wallet.chainId,
    project: exactProjectDashboard ? {
      owner: exactProjectDashboard.snapshot.owner,
      proposer: exactProjectDashboard.snapshot.proposer,
      launched: exactProjectDashboard.snapshot.launched,
      status: capabilityLifecycle(exactProjectDashboard.snapshot.status),
      launchReady: boardroomLaunchReady(exactProjectDashboard.snapshot),
      launchBlockedReason: boardroomLaunchReady(exactProjectDashboard.snapshot)
        ? undefined
        : "Distribute at least one whole governance-eligible project token before launch.",
      windDownBlockers: exactProjectDashboard.snapshot.activeObligationCount > 0n ? 1 : 0,
      snapshotComplete: exactProjectDashboard.snapshot.snapshotCursor
        >= exactProjectDashboard.snapshot.snapshotAssetCount,
    } : undefined,
    wallet: {
      shareBalance: verifiedBoardroomStakerPower?.currentTokenBalance,
      vetoEligible: verifiedBoardroomStakerPower?.canVeto,
      windDownEligible: verifiedBoardroomStakerPower?.canStartWindDown,
    },
    governance: {
      scheduledOperationCount: verifiedScheduledBoardroomOperations.filter((operation) => operation.status === "waiting" || operation.status === "ready").length,
      readyActionCount: verifiedScheduledBoardroomOperations.filter((operation) => operation.status === "ready").length,
    },
    opportunities: participationCapabilityOpportunities(exactProjectDashboard),
  });
  const routeWalletCapability = walletWriteCapability(wallet.account, wallet.chainId, appRouteChainId(appRoute) ?? activeNetwork.chainId);
  const projectLifecycle = exactProjectDashboard?.snapshot.status;
  const lifecycleUnavailable: Capability = { status: "hidden" };
  const boardroomPanelCapabilities: BoardroomPanelCapabilities | undefined = appRoute.kind === "studio"
    ? {
        claimRedemption: lifecycleUnavailable,
        beginSnapshot: lifecycleUnavailable,
        createBoardroom: routeWalletCapability,
        createDistribution: lifecycleUnavailable,
        createGrant: lifecycleUnavailable,
        createLiquidity: lifecycleUnavailable,
        manageDistribution: lifecycleUnavailable,
        manageLiquidity: lifecycleUnavailable,
        mint: lifecycleUnavailable,
        openRedemptions: lifecycleUnavailable,
        permissionlessWindDown: lifecycleUnavailable,
        processSnapshot: lifecycleUnavailable,
        redeem: lifecycleUnavailable,
        registerRedeemableAsset: lifecycleUnavailable,
        startWindDown: lifecycleUnavailable,
      }
    : appRoute.kind === "studio-project"
      ? {
        claimRedemption: projectLifecycle === 3 ? routeWalletCapability : lifecycleUnavailable,
        beginSnapshot: projectCapabilities["windDown.beginSnapshot"],
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
        openRedemptions: projectCapabilities["windDown.openRedemptions"],
        permissionlessWindDown: projectLifecycle === 1 ? routeWalletCapability : lifecycleUnavailable,
        processSnapshot: projectCapabilities["windDown.processSnapshot"],
        redeem: projectCapabilities["redemption.redeem"],
        registerRedeemableAsset: projectCapabilities["windDown.registerAsset"],
        startWindDown: projectCapabilities["windDown.start"],
        }
      : undefined;
  const studioOperatorCapability: Capability = routeWalletCapability.status !== "enabled"
    ? routeWalletCapability
    : !exactProjectDashboard
      ? { status: "blocked", reason: "Verified project state is still loading." }
      : sameAddress(
          wallet.account,
          exactProjectDashboard.snapshot.launched
            ? exactProjectDashboard.snapshot.proposer
            : exactProjectDashboard.snapshot.owner,
        )
        ? { status: "enabled" }
        : {
            status: "blocked",
            reason: exactProjectDashboard.snapshot.launched
              ? "Only the controller proposer can schedule changes for this Studio section after launch."
              : "Only the project owner can manage this Studio section before launch.",
          };
  const studioSectionCapability = appRoute.kind === "studio-project"
    ? studioProjectSectionCapability(
        appRoute.section,
        routeWalletCapability,
        studioOperatorCapability,
        projectCapabilities,
        boardroomPanelCapabilities,
      )
    : routeWalletCapability;

  const activeGrantVerifiedKey = appRoute.kind === "grant"
    ? canonicalGrantRouteKey(appRoute.chainId, appRoute.grant, runtimeDeploymentIdentity)
    : undefined;
  const displayedGrantSnapshot = appRoute.kind === "grant"
    ? verifiedAddressState(grantSnapshot, grantSnapshotVerifiedKey, activeGrantVerifiedKey, appRoute.grant)
    : grantSnapshot;
  const grantIssuerActionsAvailable = canRunGrantIssuerActions(wallet.account, displayedGrantSnapshot, grantIssuerBoardroom);
  const scopedStudioTokenList = useMemo(
    () => scopeSwapTokenList(swapTokenList, exactProjectPools),
    [exactProjectPools, swapTokenList],
  );
  const marketPanel = (
    <Suspense fallback={<div aria-live="polite" className="border-y border-zinc-800 py-6 text-sm text-zinc-500">Loading market tools…</div>}>
    <SwapPanel
      account={wallet.account}
      actionCapability={routeWalletCapability}
      boardroom={appRoute.kind === "project" && appRoute.section === "participate"
        ? exactProjectDashboard?.address
        : undefined}
      deployment={deployment}
      form={swapForm}
      liquidityForm={liquidityForm}
      liquidityQuote={liquidityQuote}
      nativeBalance={nativeBalance.status === "ready" ? nativeBalance.value : undefined}
      position={ammPosition}
      pendingAction={pendingAction}
      quote={swapQuote}
      removeLiquidityForm={removeLiquidityForm}
      removeLiquidityQuote={removeLiquidityQuote}
      setLiquidityForm={setLiquidityForm}
      setRemoveLiquidityForm={setRemoveLiquidityForm}
      setForm={setSwapForm}
      tokenList={appRoute.kind === "studio-project" && appRoute.section === "liquidity" ? scopedStudioTokenList : swapTokenList}
      tokenListLoading={swapTokenListLoading}
      wrappedNativeSymbol={activeNetwork.wrappedNativeSymbol}
      hyperliquid={hyperliquidCheckout}
      mode={appRoute.kind === "project" ? "swap" : appRoute.kind === "studio-project" && appRoute.section === "liquidity" ? "liquidity" : "all"}
      lockSwapPair={appRoute.kind === "project" && appRoute.section === "participate"}
      projectShareToken={appRoute.kind === "project" && appRoute.section === "participate"
        ? exactProjectDashboard?.snapshot.shareToken
        : undefined}
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
      switchWalletNetwork={switchChain}
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
      settleAvailableGrant={settleAvailableGrant}
      withdrawExpired={withdrawExpired}
    />
  );
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
        migrate: migrateBoardroomStorage,
        mintShares: mintBoardroomShares,
        predict: predictBoardroom,
        setBoardroomAddress: updateBoardroomAddress,
        setBoardroomForm,
        setBoardroomMintAmount,
        setBoardroomMintTo,
        setPredictedBoardroom,
      }}
      bondMarket={{
        address: bondMarketAddress,
        form: bondMarketForm,
        predicted: predictedBondMarket,
        snapshot: displayedBondMarketSnapshot,
        close: closeBondMarket,
        create: createBondMarket,
        load: loadBondMarket,
        predict: predictBondMarket,
        setAddress: updateBondMarketAddress,
        setForm: setBondMarketForm,
      }}
      dutchAuction={{
        address: dutchAuctionAddress,
        form: dutchAuctionForm,
        predicted: predictedDutchAuction,
        snapshot: displayedDutchAuctionSnapshot,
        cancel: cancelDutchAuction,
        close: closeDutchAuction,
        create: createDutchAuction,
        finalize: finalizeDutchAuction,
        load: loadDutchAuction,
        predict: predictDutchAuction,
        setAddress: updateDutchAuctionAddress,
        setForm: setDutchAuctionForm,
      }}
      fixedPriceSale={{
        address: fixedPriceSaleAddress,
        form: fixedPriceSaleForm,
        predicted: predictedFixedPriceSale,
        snapshot: displayedFixedPriceSaleSnapshot,
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
        add: addLockedLiquidity,
        address: lockedLiquidityAddress,
        close: closeLockedLiquidity,
        exitForm: lockedLiquidityExitForm,
        form: lockedLiquidityForm,
        predicted: predictedLockedLiquidity,
        snapshot: displayedLockedLiquiditySnapshot,
        claimFees: claimLockedLiquidityFees,
        create: createLockedLiquidity,
        exit: exitLockedLiquidity,
        load: loadLockedLiquidity,
        predict: predictLockedLiquidity,
        remove: removeLockedLiquidity,
        setLockedLiquidityAddress: updateLockedLiquidityAddress,
        setLockedLiquidityExitForm,
        setLockedLiquidityForm,
      }}
      merkleAirdrop={{
        address: merkleAirdropAddress,
        form: merkleAirdropForm,
        predicted: predictedMerkleAirdrop,
        snapshot: displayedMerkleAirdropSnapshot,
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
        snapshot: displayedMigratingCurveSnapshot,
        cancel: cancelMigratingCurve,
        create: createMigratingCurve,
        expire: expireMigratingCurve,
        fallbackToUnwind: fallbackMigratingCurve,
        finalizeForfeiture: finalizeMigratingCurveForfeiture,
        finalizeUnwind: finalizeMigratingCurveUnwind,
        load: loadMigratingCurve,
        migrate: migrateCurve,
        openForfeiture: openMigratingCurveForfeiture,
        predict: predictMigratingCurve,
        recoverForfeitedQuote: recoverMigratingCurveForfeitedQuote,
        recoverQuote: recoverMigratingCurveQuote,
        setCurveMigrationForm,
        setMigratingCurveAddress: updateMigratingCurveAddress,
        setMigratingCurveForm,
        vetoForfeiture: vetoMigratingCurveForfeiture,
      }}
      windDown={{
        form: windDownForm,
        beginSnapshot: beginRedemptionSnapshot,
        burnTreasuryShares,
        claimRedemptionAsset: claimBoardroomRedemptionAsset,
        openRedemptions,
        processSnapshot: processRedemptionSnapshot,
        pruneObligation: pruneBoardroomObligation,
        pruneObligations: pruneBoardroomObligations,
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

  const governanceOperationControls = exactProjectDashboard?.snapshot.launched && !boardroomControlSupport.supported ? (
    <PageNotice title="Controller writes are unavailable" tone="warning">
      {boardroomControlSupport.reason}
    </PageNotice>
  ) : exactProjectDashboard?.snapshot.launched && verifiedProductGovernanceOperationsLoaded ? (
    !verifiedProductGovernanceOperationsComplete && verifiedScheduledBoardroomOperations.length === 0 ? (
      <PageNotice title="No verified scheduled operations" tone="warning">
        Operation coverage is incomplete, and no candidate was safe to display. The app checks again every 30 seconds; retry before assuming no operation is pending.
      </PageNotice>
    ) : (
      <GovernanceOperations
        account={wallet.account}
        operations={verifiedScheduledBoardroomOperations}
        capabilities={projectCapabilities}
        pendingAction={pendingAction}
        runAction={runAction}
        submitTransaction={async (label, request) => {
          await requireWritableBoardroomFacetSetHash(
            exactProjectDashboard.address,
            exactProjectDashboard.snapshot.facetSetHash,
          );
          return await submitContractTransaction(label, request);
        }}
      />
    )
  ) : undefined;
  const governanceProposalComposer = exactProjectDashboard?.snapshot.launched && boardroomControlSupport.supported ? (
    <GovernanceProposalComposer
      boardroom={exactProjectDashboard.address}
      capability={projectCapabilities["governance.schedule"]}
      configurationEpoch={exactProjectDashboard.snapshot.controllerConfigurationEpoch}
      controller={exactProjectDashboard.snapshot.controller}
      controllerDelay={exactProjectDashboard.snapshot.controllerDelay}
      controllerGeneration={exactProjectDashboard.snapshot.controllerGeneration}
      currentProposer={exactProjectDashboard.snapshot.proposer}
      governanceEpoch={exactProjectDashboard.snapshot.governanceEpoch}
      gracePeriod={exactProjectDashboard.snapshot.controllerGracePeriod}
      predictedNextController={predictedReplacementController}
      pendingAction={pendingAction}
      runAction={runAction}
      scheduleConfigurationChange={async (proposer, delay, gracePeriod, actionGuard) => {
        const route = activeAppRouteRef.current;
        if (route.kind !== "studio-project" || route.section !== "governance"
          || !sameAddress(route.boardroom, exactProjectDashboard.address)) {
          throw new Error("The selected Studio project changed. Reopen Governance before scheduling this operation.");
        }
        const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
          exactProjectDashboard.address,
          exactProjectDashboard.snapshot.facetSetHash,
        );
        const data = encodeFunctionData({
          abi: boardroomControllerAbi,
          functionName: "updateConfiguration",
          args: [proposer, delay, gracePeriod],
        });
        await submitContractTransaction(
          "Schedule controller configuration",
          {
            address: exactProjectDashboard.snapshot.controller,
            abi: boardroomControllerAbi,
            functionName: "scheduleControllerOperation",
            args: [
              expectedFacetSetHash,
              data,
              randomSalt(),
              exactProjectDashboard.snapshot.governanceEpoch,
              exactProjectDashboard.snapshot.controllerConfigurationEpoch,
            ] as const,
          },
          actionGuard,
        );
      }}
      scheduleControllerReplacement={async (proposer, delay, gracePeriod, expectedNextController, nextGeneration, actionGuard) => {
        const route = activeAppRouteRef.current;
        if (route.kind !== "studio-project" || route.section !== "governance"
          || !sameAddress(route.boardroom, exactProjectDashboard.address)) {
          throw new Error("The selected Studio project changed. Reopen Governance before scheduling replacement.");
        }
        const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
          exactProjectDashboard.address,
          exactProjectDashboard.snapshot.facetSetHash,
        );
        const call = buildBoardroomReplaceControllerCall({
          boardroom: exactProjectDashboard.address,
          expectedFacetSetHash,
          expectedCurrentController: exactProjectDashboard.snapshot.controller,
          expectedNextController,
          nextProposer: proposer,
          nextDelay: delay,
          nextGracePeriod: gracePeriod,
          nextGeneration,
        });
        const plan = planBoardroomCallExecution({
          boardroom: exactProjectDashboard.address,
          expectedFacetSetHash,
          calls: [call],
          lifecycle: {
            launched: true,
            status: exactProjectDashboard.snapshot.status,
            migrationRequired: false,
            controller: exactProjectDashboard.snapshot.controller,
            governanceEpoch: exactProjectDashboard.snapshot.governanceEpoch,
            controllerConfigurationEpoch: exactProjectDashboard.snapshot.controllerConfigurationEpoch,
            proposer: exactProjectDashboard.snapshot.proposer,
          },
          salt: randomSalt(),
        });
        if (plan.kind !== "schedule") throw new Error("Controller replacement must use delayed governance.");
        await submitContractTransaction("Schedule Boardroom controller replacement", plan.transaction, actionGuard);
      }}
    />
  ) : undefined;
  const governanceLaunchControls = exactProjectDashboard && !exactProjectDashboard.snapshot.launched ? (
    <GovernanceLaunchControl
      account={wallet.account}
      boardroom={exactProjectDashboard.address}
      capability={boardroomControlSupport.supported
        ? projectCapabilities["governance.launch"]
        : { status: "blocked", reason: boardroomControlSupport.reason }}
      pendingAction={pendingAction}
      predictedController={predictedGovernanceController}
      redemptionExcessRecipient={exactProjectDashboard.snapshot.redemptionExcessRecipient}
      rewardPool={exactProjectDashboard.snapshot.rewardPool}
      runAction={runAction}
      stakerCanProtect={verifiedBoardroomStakerPower?.canStartWindDown}
      submitLaunch={async (config, actionGuard) => {
        const route = activeAppRouteRef.current;
        if (route.kind !== "studio-project" || route.section !== "governance"
          || !sameAddress(route.boardroom, exactProjectDashboard.address)) {
          throw new Error("The selected Studio project changed. Reopen Governance before launching.");
        }
        const expectedFacetSetHash = await requireWritableBoardroomFacetSetHash(
          exactProjectDashboard.address,
          exactProjectDashboard.snapshot.facetSetHash,
        );
        await submitContractTransaction(
          "Launch Boardroom controller governance",
          buildBoardroomLaunchTransaction({
            boardroom: exactProjectDashboard.address,
            expectedFacetSetHash,
            config,
          }),
          actionGuard,
        );
      }}
    />
  ) : undefined;
  const publicRewardsPanel = exactProjectDashboard ? (
    <BoardroomRewardsPanel
      account={wallet.account}
      dashboard={exactProjectDashboard}
      deployment={deployment}
      pendingAction={pendingAction}
      publicClient={publicClient}
      runAction={runAction}
      submitTransaction={submitContractTransaction}
    />
  ) : undefined;
  const operatorRewardsPanel = exactProjectDashboard ? (
    <BoardroomRewardsPanel
      account={wallet.account}
      dashboard={exactProjectDashboard}
      deployment={deployment}
      operatorMode
      operatorCapability={projectCapabilities["studio.createGrant"]}
      pendingAction={pendingAction}
      publicClient={publicClient}
      runAction={runAction}
      submitTransaction={submitContractTransaction}
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
  const governanceWatchAction = sentinelBaseUrl && appRoute.kind === "project" && appRoute.section === "governance" ? (
    <ButtonLink
      href={governanceWatchHref(
        appRoute.chainId,
        appRoute.boardroom,
        projectRouteHref(appRoute.chainId, appRoute.boardroom, "governance"),
      )}
      variant="secondary"
    >
      Watch governance
    </ButtonLink>
  ) : undefined;
  const alertsUnavailableAction = !sentinelBaseUrl ? (
    <ButtonLink href={appRouteHref({ kind: "alerts" })} variant="secondary">
      View alert status
    </ButtonLink>
  ) : undefined;
  useEffect(() => {
    if (appRoute.kind !== "project" || appRoute.section !== "participate" || !selectedProjectPool) return;
    const pool = swapTokenList.pools.find((candidate) => sameAddress(candidate.address, selectedProjectPool));
    if (!pool) return;
    setSwapForm((current) => {
      const alreadyScoped = (sameAddress(current.tokenIn as Address, pool.token0) && sameAddress(current.tokenOut as Address, pool.token1))
        || (sameAddress(current.tokenIn as Address, pool.token1) && sameAddress(current.tokenOut as Address, pool.token0));
      return alreadyScoped ? current : { ...current, tokenIn: pool.token0, tokenOut: pool.token1 };
    });
    setSwapQuote((current) => current?.pool && sameAddress(current.pool.address, selectedProjectPool) ? current : undefined);
  }, [appRoute, selectedProjectPool, swapTokenList.pools]);
  useEffect(() => {
    if (appRoute.kind !== "studio-project" || appRoute.section !== "liquidity" || exactProjectPools.length === 0) return;
    setLiquidityForm((current) => {
      const selectedPool = swapTokenList.pools.find((pool) =>
        exactProjectPools.some((allowed) => sameAddress(allowed, pool.address))
        && ((sameAddress(current.tokenA as Address, pool.token0) && sameAddress(current.tokenB as Address, pool.token1))
          || (sameAddress(current.tokenA as Address, pool.token1) && sameAddress(current.tokenB as Address, pool.token0))));
      if (selectedPool) return current;
      const firstPool = swapTokenList.pools.find((pool) => sameAddress(pool.address, exactProjectPools[0]));
      return firstPool ? { ...current, tokenA: firstPool.token0, tokenB: firstPool.token1 } : current;
    });
  }, [appRoute, exactProjectPools, swapTokenList.pools]);
  const participationAmmContent = Object.fromEntries(
    exactProjectPools.map((pool) => [participationAmmKey(pool), marketPanel]),
  ) as Partial<Record<ParticipationContentKey, React.JSX.Element>>;
  const recurringSupportContent =
    exactProjectDashboard && hyperliquidCheckout
      ? {
          support: (
            <RecurringSupportPanel
              account={wallet.account}
              boardroomActive={exactProjectDashboard.snapshot.status === 0}
              boardroom={exactProjectDashboard.address}
              canPublish={Boolean(
                wallet.account
                && sameAddress(
                  wallet.account,
                  exactProjectDashboard.snapshot.launched
                    ? exactProjectDashboard.snapshot.proposer
                    : exactProjectDashboard.snapshot.owner,
                )
              )}
              checkout={hyperliquidCheckout}
              pendingAction={pendingAction}
              runAction={runAction}
            />
          ),
        }
      : {};
  const participationContent = exactProjectDashboard ? {
    ...createParticipationFlowContent({
      account: wallet.account,
      chainId: activeNetwork.chainId,
      dashboard: exactProjectDashboard,
      hyperliquid: hyperliquidCheckout,
      pendingAction,
      publicClient,
      runAction,
      submitTransaction: submitContractTransaction,
    }),
    ...participationAmmContent,
    ...recurringSupportContent,
  } : {};
  const portfolioTasks = walletPortfolioTasks({
    account: wallet.account,
    discovery,
    inspectGrant: inspectDiscoveredGrant,
  });
  const studioDirectory = productCatalog.length ? (
    <>
      <ol className="m-0 list-none border-t border-zinc-800 p-0">
        {productCatalog.map((project) => (
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
      {productCatalogNextCursor !== undefined ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 py-4">
          <span className="text-xs text-zinc-500">
            Showing {productCatalog.length.toLocaleString()} of {(productCatalogTotalCount ?? productCatalog.length).toLocaleString()} projects
          </span>
          <Button disabled={productCatalogLoadingMore} size="sm" variant="secondary" onClick={() => void loadMoreProductBoardrooms()}>
            {productCatalogLoadingMore ? "Loading projects…" : "Load more projects"}
          </Button>
        </div>
      ) : null}
      {productCatalogLoadMoreError ? <p className="m-0 mt-3 text-xs text-red-300">{productCatalogLoadMoreError}</p> : null}
    </>
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
    if (appRoute.kind === "alerts" && !sentinelBaseUrl) {
      return (
        <AlertsUnavailablePage
          returnHref={appRouteHref({ kind: "explore", chainId: activeNetwork.chainId })}
          onReturn={() => navigateRoute({ kind: "explore", chainId: activeNetwork.chainId })}
        />
      );
    }
    if (runtimeDeploymentAvailability.status !== "ready" && routeRequiresReadyDeployment(appRoute)) {
      return <DeploymentUnavailablePage availability={runtimeDeploymentAvailability} networkName={activeNetwork.name} />;
    }

    switch (appRoute.kind) {
      case "explore":
        return (
          <ExplorePage
            canLoadMore={productCatalogNextCursor !== undefined}
            chainId={activeNetwork.chainId}
            chainName={activeNetwork.name}
            emptyAction={(
              <ButtonLink
                href={appRouteHref({ kind: "studio", chainId: activeNetwork.chainId })}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  navigateRoute({ kind: "studio", chainId: activeNetwork.chainId });
                }}
              >
                Open Studio
              </ButtonLink>
            )}
            error={productBoardroomError}
            loadMoreError={productCatalogLoadMoreError}
            loading={productBoardroomLoading && !productCatalogLoaded}
            loadingMore={productCatalogLoadingMore}
            projects={productCatalog}
            totalProjects={productCatalogTotalCount}
            onLoadMore={() => void loadMoreProductBoardrooms()}
            onOpenProject={(project) => navigateRoute({ kind: "project", chainId: activeNetwork.chainId, boardroom: project.address, section: "overview" })}
            onRetry={() => void loadProductBoardroom()}
            onToggleSaved={(project) => savedProjects.toggle({
              boardroom: project.address,
              chainId: activeNetwork.chainId,
              ...(project.name ? { name: project.name } : {}),
              ...(project.symbol ? { symbol: project.symbol } : {}),
            })}
            projectHref={(project) => projectRouteHref(activeNetwork.chainId, project.address)}
            savedProjectAddresses={activeSavedProjectAddresses}
            savedProjectCount={activeSavedProjects.length}
            savedProjectsWarning={savedProjects.warning}
          />
        );
      case "project": {
        const failure = productBoardroomError && !productBoardroomLoading && !exactProjectDashboard
          ? projectRouteFailure(productBoardroomError, productBoardroomFailureKind)
          : undefined;
        if (failure) {
          return (
            <ProjectRouteFailureState
              failure={failure}
              onRetry={failure.retryable ? () => void loadProductBoardroom(appRoute.boardroom) : undefined}
              onReturn={() => navigateRoute({ kind: "explore", chainId: appRoute.chainId })}
              returnHref={appRouteHref({ kind: "explore", chainId: appRoute.chainId })}
            />
          );
        }
        return (
          <ProjectLayout
            account={wallet.account}
            activeSection={appRoute.section}
            chainName={activeNetwork.name}
            dashboard={exactProjectDashboard}
            error={productBoardroomError}
            loading={productBoardroomLoading}
            mastheadAction={exactProjectDashboard ? (
              <>
                <Button
                  aria-label={exactProjectIsSaved ? "Remove project from saved projects" : "Save project"}
                  aria-pressed={exactProjectIsSaved}
                  title={exactProjectIsSaved ? "Remove from saved projects" : "Save project"}
                  variant="secondary"
                  onClick={() => savedProjects.toggle({
                    boardroom: appRoute.boardroom,
                    chainId: appRoute.chainId,
                    ...(exactProjectCatalogEntry?.name ? { name: exactProjectCatalogEntry.name } : {}),
                    ...(exactProjectCatalogEntry?.symbol ? { symbol: exactProjectCatalogEntry.symbol } : {}),
                  })}
                >
                  <Star className={exactProjectIsSaved ? "h-4 w-4 fill-current text-lime-200" : "h-4 w-4"} />
                  {exactProjectIsSaved ? "Saved" : "Save project"}
                </Button>
                <ButtonLink
                  href={appRouteHref({ kind: "studio-project", chainId: appRoute.chainId, boardroom: appRoute.boardroom, section: "setup" })}
                  variant="secondary"
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    navigateRoute({ kind: "studio-project", chainId: appRoute.chainId, boardroom: appRoute.boardroom, section: "setup" });
                  }}
                >
                  Open Studio
                </ButtonLink>
              </>
            ) : undefined}
            onNavigateSection={(section) => navigateRoute({ kind: "project", chainId: appRoute.chainId, boardroom: appRoute.boardroom, section })}
            onRetry={() => void loadProductBoardroom(appRoute.boardroom)}
            savedProjectsWarning={savedProjects.warning}
            sectionHref={(section) => projectRouteHref(appRoute.chainId, appRoute.boardroom, section)}
          >
            {appRoute.section === "overview" ? (
              <ProjectOverviewPage
                account={wallet.account}
                actionHref={(action) => appRouteHref(projectOverviewActionRoute(action, appRoute.chainId, appRoute.boardroom))}
                dashboard={exactProjectDashboard}
                loading={productBoardroomLoading}
                onOpenAction={(action) => navigateRoute(projectOverviewActionRoute(action, appRoute.chainId, appRoute.boardroom))}
                onRefresh={() => refreshProjectOverview(appRoute.boardroom)}
                position={verifiedProjectPosition}
                positionError={verifiedProjectPositionError}
                positionLoading={verifiedProjectPositionLoading}
              />
            ) : appRoute.section === "participate" ? (
              <ParticipatePage
                content={participationContent}
                dashboard={exactProjectDashboard}
                error={productBoardroomError}
                loading={productBoardroomLoading}
                poolMarket={{
                  error: swapTokenList.error,
                  loaded: swapTokenList.loaded,
                  loading: swapTokenListLoading,
                  pools: swapTokenList.pools,
                }}
                onSelectRoute={setSelectedParticipationRoute}
                selectedRoute={selectedParticipationRoute}
              />
            ) : appRoute.section === "governance" ? (
              <GovernancePage
                activityContent={sentinelBaseUrl ? <GovernanceActivity boardroom={appRoute.boardroom} chainId={appRoute.chainId} /> : undefined}
                alertsAction={alertsUnavailableAction}
                alertsUnavailable={!sentinelBaseUrl}
                dashboard={exactProjectDashboard}
                error={productGovernanceError}
                stakerPower={verifiedBoardroomStakerPower}
                loading={productBoardroomLoading || productGovernanceLoading}
                primaryAction={retryGovernanceAction || governanceWatchAction ? (
                  <div className="flex flex-wrap gap-2">{retryGovernanceAction}{governanceWatchAction}</div>
                ) : undefined}
                operationsContent={governanceOperationControls}
                stakingContent={publicRewardsPanel}
                warning={verifiedProductGovernanceWarning}
              />
            ) : (
              <TransparencyPage
                chainId={appRoute.chainId}
                dashboard={exactProjectDashboard}
                error={productBoardroomError}
                grantHref={(grant) => appRouteHref(projectGrantRoute(appRoute.chainId, grant, appRoute.boardroom))}
                loading={productBoardroomLoading}
                onOpenGrant={(grant) => navigateRoute(projectGrantRoute(appRoute.chainId, grant, appRoute.boardroom))}
              />
            )}
          </ProjectLayout>
        );
      }
      case "portfolio":
        return (
          <PortfolioPage
            account={wallet.account}
            connectAction={wallet.account ? undefined : <ConnectWalletButton />}
            discoveryContent={walletAccessPanel}
            error={discovery.errors.length ? discovery.errors.join(" ") : undefined}
            loading={Boolean(discoveryPendingAction)}
            refreshAction={wallet.account ? <Button variant="secondary" onClick={() => void runAction("scan-wallet-access", scanWalletAccess)}>Refresh portfolio</Button> : undefined}
            savedProjectHref={(project) => projectRouteHref(project.chainId, project.boardroom)}
            savedProjects={activeSavedProjects}
            savedProjectsWarning={savedProjects.warning}
            tasks={portfolioTasks}
            onOpenSavedProject={(project) => navigateRoute({
              kind: "project",
              chainId: project.chainId,
              boardroom: project.boardroom,
              section: "overview",
            })}
          />
        );
      case "grant": {
        const returnRoute = grantReturnRoute(appRoute);
        const returnHref = appRouteHref(returnRoute);
        const returnLabel = returnRoute.kind === "project" ? "Return to Project" : "Return to Portfolio";
        if (grantRouteError) {
          const failureKind = grantRouteFailureKind ?? "transient";
          return (
            <GrantVerificationFailureState
              backHref={returnHref}
              grant={appRoute.grant}
              kind={failureKind}
              message={grantRouteError}
              onBack={() => navigateRoute(returnRoute)}
              onRetry={failureKind === "transient" ? () => void loadCanonicalGrantRoute(
                appRoute.grant,
                canonicalGrantRouteKey(appRoute.chainId, appRoute.grant, runtimeDeploymentIdentity),
              ) : undefined}
              returnLabel={returnLabel}
            />
          );
        }
        if (!displayedGrantSnapshot) {
          return <GrantVerificationLoadingState grant={appRoute.grant} />;
        }
        return (
          <GrantDetailPage
            account={wallet.account}
            backHref={returnHref}
            backLabel={returnLabel}
            grant={appRoute.grant}
            onBack={() => navigateRoute(returnRoute)}
          >
            {grantPanel}
          </GrantDetailPage>
        );
      }
      case "studio":
      case "studio-project": {
        const selectedDashboard = appRoute.kind === "studio-project" ? exactProjectDashboard : undefined;
        const exactOperatorStateReady = appRoute.kind !== "studio-project"
          || Boolean(selectedDashboard && (
            appRoute.section === "governance"
            || displayedBoardroomSnapshot && sameAddress(displayedBoardroomSnapshot.address, appRoute.boardroom)
          ));
        const studioAccessNotice = appRoute.kind === "studio-project" ? (
          <PageNotice title={`Studio ${studioSectionLabel(appRoute.section)} is locked`} tone="warning">
            <div className="grid gap-3">
              <span>{studioSectionCapability.reason ?? "This wallet is not authorized for an action in this section."}</span>
              <div className="flex flex-wrap gap-2">
                {studioSectionCapability.status === "connect" ? <ConnectWalletButton /> : null}
                {studioSectionCapability.status === "switch" ? (
                  <Button variant="secondary" onClick={() => void runAction("switch-studio-chain", switchChain)}>Switch wallet network</Button>
                ) : null}
                {studioSectionCapability.status === "blocked" || studioSectionCapability.status === "hidden" ? (
                  <Button
                    variant="secondary"
                    onClick={() => navigateRoute({ kind: "project", chainId: appRoute.chainId, boardroom: appRoute.boardroom, section: "overview" })}
                  >
                    Open public project
                  </Button>
                ) : null}
              </div>
            </div>
          </PageNotice>
        ) : null;
        const operatorTools = !exactOperatorStateReady ? (
          <PageNotice title="Loading the exact project state">
            Studio will not expose transaction controls until the loaded Boardroom matches this canonical project URL.
          </PageNotice>
        ) : appRoute.kind === "studio" && !wallet.account ? (
          <PageNotice title="Connect the operator wallet">
            Studio keeps transaction controls hidden until a wallet is connected. The project’s public state remains available in its Overview and Transparency pages.
          </PageNotice>
        ) : appRoute.kind === "studio-project" && studioSectionCapability.status !== "enabled" ? (
          studioAccessNotice
        ) : appRoute.kind === "studio-project" && appRoute.section === "governance" ? (
          <GovernancePage
            alertsAction={alertsUnavailableAction}
            alertsUnavailable={!sentinelBaseUrl}
            dashboard={selectedDashboard}
            error={productGovernanceError}
            stakerPower={verifiedBoardroomStakerPower}
            loading={productBoardroomLoading || productGovernanceLoading}
            primaryAction={retryGovernanceAction}
            proposalContent={governanceProposalComposer}
            operationsContent={governanceOperationControls ?? governanceLaunchControls}
            stakingContent={operatorRewardsPanel}
            warning={verifiedProductGovernanceWarning}
          />
        ) : appRoute.kind === "studio-project" && appRoute.section === "liquidity" ? (
          <div className="grid gap-4">
            {boardroomToolsPanel}
            {exactProjectPools.length > 0 ? marketPanel : (
              <PageNotice title="No project AMM pool is available">
                Create or migrate project liquidity before adding public AMM liquidity or managing an LP position.
              </PageNotice>
            )}
          </div>
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
      {PLEDGE_CASH_NETWORKS.filter((network) => network.chainId !== activeNetwork.chainId).map((network) => (
        <RuntimeDeploymentAvailabilityProbe
          key={network.chainId}
          network={network}
          onAvailability={reportNetworkDeploymentAvailability}
        />
      ))}
      <a
        className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-md border border-[var(--pc-border-strong)] bg-[var(--pc-surface-raised)] px-4 py-2 text-sm font-semibold text-[var(--pc-text)] shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-[var(--pc-accent)]"
        href="#app-main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("app-main-content")?.focus();
        }}
      >
        Skip to main content
      </a>
      <AppHeader
        wallet={wallet}
        chainId={activeNetwork.chainId}
        chainName={activeNetwork.name}
        environment={environment}
        networkAvailability={networkDeploymentAvailability}
        networks={PLEDGE_CASH_NETWORKS}
        onNetworkChange={selectNetwork}
        pendingAction={pendingAction}
        runAction={runAction}
        switchChain={switchChain}
      />
      <EnvironmentDisclosure environment={environment} />
      <HyperliquidRecoveryCenter
        config={X402_ROUTER_CONFIG}
        payer={wallet.account}
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

      <div aria-atomic="true" aria-live="polite" className="sr-only">{activeRouteTitle}</div>
      <main
        aria-label={activeRouteTitle}
        className="mobile-nav-safe-area min-h-[calc(100svh-56px)] outline-none md:pb-0"
        id="app-main-content"
        tabIndex={-1}
      >
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
  grantIssuerBoardroom: GrantIssuerBoardroomAccess | undefined,
): boolean {
  if (!account || !grantSnapshot) return false;
  if (sameAddress(account, grantSnapshot.issuer)) return true;
  if (grantIssuerBoardroom && sameAddress(grantSnapshot.issuer, grantIssuerBoardroom.boardroom)) {
    if (grantIssuerBoardroom.status === 1) return true;
    if (grantIssuerBoardroom.status !== 0) return false;
    const authority = grantIssuerBoardroom?.launched ? grantIssuerBoardroom.proposer : grantIssuerBoardroom?.owner;
    if (sameAddress(account, authority)) return true;
  }
  return false;
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
}: {
  account: Address | undefined;
  discovery: DiscoverySnapshot;
  inspectGrant: (grant: Address) => void;
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
  return tasks;
}

function capabilityLifecycle(status: number): NonNullable<ProjectCapabilityContext["project"]>["status"] {
  if (status === 0) return "active";
  if (status === 1) return "winding-down";
  if (status === 2) return "snapshotting";
  if (status === 3) return "redemptions-open";
  return "closed";
}

export function studioProjectSectionCapability(
  section: StudioSection,
  walletCapability: Capability,
  operatorCapability: Capability,
  projectCapabilities: ProjectCapabilityMap,
  boardroomCapabilities: BoardroomPanelCapabilities | undefined,
): Capability {
  if (walletCapability.status !== "enabled") return walletCapability;
  if (section === "setup") return operatorCapability;

  const candidates: Capability[] = section === "token"
    ? compactCapabilities([
        boardroomCapabilities?.mint,
        boardroomCapabilities?.redeem,
        boardroomCapabilities?.claimRedemption,
      ])
    : section === "grants"
      ? compactCapabilities([boardroomCapabilities?.createGrant])
      : section === "distributions"
        ? compactCapabilities([
            boardroomCapabilities?.createDistribution,
            boardroomCapabilities?.manageDistribution,
          ])
        : section === "liquidity"
          ? compactCapabilities([
              boardroomCapabilities?.createLiquidity,
              boardroomCapabilities?.manageLiquidity,
            ])
          : section === "governance"
            ? [
                projectCapabilities["governance.launch"],
                projectCapabilities["governance.schedule"],
                projectCapabilities["governance.veto"],
                projectCapabilities["governance.executeReady"],
              ]
            : compactCapabilities([
                boardroomCapabilities?.startWindDown,
                boardroomCapabilities?.registerRedeemableAsset,
                boardroomCapabilities?.permissionlessWindDown,
                boardroomCapabilities?.redeem,
                boardroomCapabilities?.claimRedemption,
              ]);

  const enabled = candidates.find((capability) => capability.status === "enabled");
  if (enabled) return enabled;
  const actionable = candidates.find((capability) => capability.status !== "hidden");
  return actionable ?? {
    status: "blocked",
    reason: `No ${studioSectionLabel(section)} action is available to this wallet right now.`,
  };
}

function compactCapabilities(capabilities: Array<Capability | undefined>): Capability[] {
  return capabilities.filter((capability): capability is Capability => capability !== undefined);
}

function studioSectionLabel(section: StudioSection): string {
  if (section === "setup") return "project setup";
  if (section === "token") return "token management";
  if (section === "grants") return "grant management";
  if (section === "distributions") return "distribution management";
  if (section === "liquidity") return "liquidity management";
  if (section === "governance") return "governance";
  return "wind-down or redemption";
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
    if (distribution.kind === "bond-market" && "live" in distribution.state) {
      const available = distribution.state.live && distribution.state.capacity > 0n;
      opportunities["participate.bond.purchase"] = mergeCapabilityOpportunity(
        opportunities["participate.bond.purchase"],
        { available, ...(!available ? { reason: "The bond market is not accepting purchases." } : {}) },
      );
    }
    if (distribution.kind === "fixed-price-sale" && "saleStatus" in distribution.state) {
      const available = distribution.state.saleStatus === 0 && !distribution.state.closed && distribution.state.remainingShares > 0n;
      opportunities["participate.fixedSale.buy"] = mergeCapabilityOpportunity(
        opportunities["participate.fixedSale.buy"],
        { available, ...(!available ? { reason: "The fixed-price sale is not accepting purchases." } : {}) },
      );
    }
    if (distribution.kind === "dutch-auction" && "saleStatus" in distribution.state) {
      const available = distribution.state.saleStatus === 0
        && !distribution.state.closed
        && distribution.state.remainingShares > 0n;
      opportunities["participate.dutchAuction.buy"] = mergeCapabilityOpportunity(
        opportunities["participate.dutchAuction.buy"],
        { available, ...(!available ? { reason: "The Dutch auction is not accepting purchases." } : {}) },
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

export function mergeProductBoardroomCatalog(
  current: readonly ProductBoardroomCatalogEntry[],
  next: readonly ProductBoardroomCatalogEntry[],
): ProductBoardroomCatalogEntry[] {
  const merged = [...current];
  const positions = new Map(merged.map((entry, index) => [entry.address.toLowerCase(), index]));
  for (const entry of next) {
    const key = entry.address.toLowerCase();
    const existing = positions.get(key);
    if (existing === undefined) {
      positions.set(key, merged.length);
      merged.push(entry);
    } else {
      merged[existing] = entry;
    }
  }
  return merged;
}

export function productReadErrorMessage(error: unknown, networkName: string): string {
  const message = errorMessage(error);
  if (/(?:http request failed|failed to fetch|fetch failed|network ?error|rpc request|timed? ?out|timeout)/i.test(message)) {
    return `Could not reach ${networkName}. Check the RPC connection and try again.`;
  }
  return message;
}

export function canonicalGrantReadErrorMessage(error: unknown, networkName: string): string {
  const message = errorMessage(error);
  if (/(?:http request failed|failed to fetch|fetch failed|network ?error|rpc request|timed? ?out|timeout)/i.test(message)) {
    return `Could not reach ${networkName} to verify this grant. Check the RPC connection and try again.`;
  }
  return "pledge.cash could not confirm that this address is a grant from the active deployment. Check the address and network, then try again.";
}

function appRouteChainId(route: AppRoute): number | undefined {
  return "chainId" in route ? route.chainId : undefined;
}

export function networkSwitchDestination(route: AppRoute, chainId: number): CanonicalAppRoute | undefined {
  if (route.kind === "portfolio" || route.kind === "grant") return { kind: "portfolio", chainId };
  if (route.kind === "studio" || route.kind === "studio-project") return { kind: "studio", chainId };
  if (route.kind === "explore" || route.kind === "project" || route.kind === "legacy-project") return { kind: "explore", chainId };
  return undefined;
}

function governanceRouteKey(
  route: AppRoute,
  account: Address | undefined,
  deploymentIdentity: string | undefined,
): string | undefined {
  const governanceRoute = (route.kind === "project" && route.section === "governance")
    || (route.kind === "studio-project" && (route.section === "governance" || route.section === "close"));
  if (!governanceRoute) return undefined;
  return `${route.chainId.toString()}:${deploymentIdentity ?? "unconfigured"}:${route.boardroom.toLowerCase()}:${account?.toLowerCase() ?? "read-only"}`;
}

function projectOverviewActionRoute(
  action: ProjectPositionAction,
  chainId: number,
  boardroom: Address,
): CanonicalAppRoute {
  if (action.kind === "grant") return projectGrantRoute(chainId, action.grant, boardroom);
  if (action.kind === "loading") return { kind: "project", chainId, boardroom, section: "overview" };
  return { kind: "project", chainId, boardroom, section: action.kind };
}

function canonicalGrantRouteKey(
  chainId: number,
  grant: Address,
  deploymentIdentity: string | undefined,
): string {
  return `${chainId.toString()}:${deploymentIdentity ?? "unconfigured"}:${grant.toLowerCase()}`;
}

function uintNumberInput(value: string, label: string, bits: 32 | 48): number {
  const parsed = uintInput(value, label);
  const maximum = (1n << BigInt(bits)) - 1n;
  if (parsed > maximum) throw new Error(`${label} must fit uint${bits.toString()}.`);
  return Number(parsed);
}

export function canonicalProjectStateKey(
  chainId: number,
  boardroom: Address,
  deploymentIdentity: string | undefined,
): string {
  return `${chainId.toString()}:${deploymentIdentity ?? "unconfigured"}:${boardroom.toLowerCase()}`;
}

export function studioReadScopeKey(
  route: AppRoute,
  chainId: number,
  deploymentIdentity: string | undefined,
): string {
  return `${chainId.toString()}:${deploymentIdentity ?? "unconfigured"}:${appRouteIdentityKey(route)}`;
}

function appRouteIdentityKey(route: AppRoute): string {
  if (isCanonicalAppRoute(route)) return appRouteHref(route);
  if (route.kind === "legacy-project") {
    return `${route.kind}:${route.surface}:${route.section}`;
  }
  return route.kind;
}

export function appRouteTitle(route: AppRoute): string {
  switch (route.kind) {
    case "explore": return "Project directory";
    case "portfolio": return "Wallet portfolio";
    case "grant": return "Grant details";
    case "studio": return "Project Studio";
    case "studio-project": return `Studio ${studioSectionLabel(route.section)}`;
    case "project": {
      if (route.section === "participate") return "Project participation";
      if (route.section === "governance") return "Project governance";
      if (route.section === "transparency") return "Project transparency";
      return "Project overview";
    }
    case "alerts": return "Alerts";
    case "tools": return "Advanced tools";
    case "legacy-project": return "Opening project";
    case "not-found": return "Page not found";
  }
}

export function contextualAppRouteTitle(route: AppRoute, projectName?: string | undefined): string {
  if (route.kind === "project") {
    const identity = projectName ?? `Project ${shortAddress(route.boardroom)}`;
    return `${identity} — ${projectSectionTitle(route.section)}`;
  }
  if (route.kind === "studio-project") {
    const identity = projectName ?? `Project ${shortAddress(route.boardroom)}`;
    return `${identity} — Studio ${studioSectionLabel(route.section)}`;
  }
  if (route.kind === "grant") return `Grant ${shortAddress(route.grant)}`;
  return appRouteTitle(route);
}

function projectSectionTitle(section: "overview" | "participate" | "governance" | "transparency"): string {
  if (section === "participate") return "Participation";
  return `${section[0]?.toUpperCase() ?? ""}${section.slice(1)}`;
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
