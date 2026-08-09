import {
  buildBoardroomAssetGrantIssuanceBatch,
  buildBoardroomBeginSnapshotTransaction,
  buildBoardroomBurnTreasurySharesTransaction,
  buildBoardroomClaimRedemptionAssetTransaction,
  buildBoardroomCreateLiquidityLockerTransaction,
  buildBoardroomCreateTransaction,
  buildBoardroomLaunchTransaction,
  buildBoardroomLiquidityLockerCancelTransaction,
  buildBoardroomLiquidityLockerExitTransaction,
  buildBoardroomMintTransaction,
  buildBoardroomOpenRedemptionsTransaction,
  buildBoardroomPreparePositionTransferTransaction,
  buildBoardroomRedeemTransaction,
  buildBoardroomRegisterLiquidityPositionTransaction,
  buildBoardroomRegisterRedeemableAssetTransaction,
  buildBoardroomSnapshotAssetsTransaction,
  buildBoardroomStartWindDownTransaction,
  buildBoardroomWrapNativeBalanceTransaction,
  buildDirectGrantCreationTransaction,
  buildErc20Approval,
  buildGrantIssuerBoardroomAction,
  buildGrantSettlementTransaction,
  buildLiquidityLockerCollectFeesTransaction,
  buildPermit2ApprovalTransaction,
  buildPositionManagerSafeTransferToLockerTransaction,
  discoverBoardrooms,
  discoverGrantHistory,
  discoverLiquidityLockers,
  getPledgeCashDeployment,
  isZeroAddress,
  predictBoardroomAddress,
  predictGrantAddress,
  readBoardroomState,
  readGrantSettlementQuote,
  readGrantState,
  readLiquidityLockerForBoardroom,
  readLiquidityLockerState,
  tokenGrantAbi,
  type Address,
  type BoardroomState,
  type DiscoveredBoardroom,
  type DiscoveredGrant,
  type DiscoveredLiquidityLocker,
  type GrantCreationTerms,
  type LiquidityLockerState,
  type PledgeCashDeployment,
} from "@pledge.cash/sdk";
import { ArrowRight, BadgeDollarSign, Landmark, LockKeyhole } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { formatUnits, type Hex } from "viem";
import { Panel } from "../components/shell";
import { TransactionReview } from "../components/transaction-review";
import { ButtonLink } from "../components/ui/button";
import {
  BoardroomCreatePanel,
  BoardroomWorkspace,
  type BoardroomAction,
  type BoardroomWorkspaceForm,
} from "../features/boardrooms/boardroom-workspace";
import {
  walletActionCapability,
  type WalletActionCapability,
} from "../features/capabilities/wallet-action";
import { ArtifactPanel, DeploymentPanel } from "../features/deployment/deployment-panel";
import { DiscoveryPanel, WalletAccessPanel } from "../features/discovery/discovery-panel";
import { DirectGrantPanel } from "../features/grants/direct-grant-panel";
import { GrantInspector } from "../features/grants/grant-inspector";
import { prepareSmartGrantSettlement } from "../features/grants/smart-settlement";
import { LogPanel } from "../features/logs/log-panel";
import { SwapPanel } from "../features/swap/swap-panel";
import { TransactionTray, useTransactionCenter } from "../features/transactions/transaction-center";
import { AppHeader } from "../features/wallet/app-header";
import { WalletPanel } from "../features/wallet/wallet-panel";
import { useActionRunner } from "../hooks/use-action-runner";
import { useFactorySnapshot } from "../hooks/use-factory-snapshot";
import { useRuntimeDeploymentAvailability } from "../hooks/use-runtime-deployment";
import { useTransactionReview } from "../hooks/use-transaction-review";
import { useWagmiWallet } from "../hooks/use-wagmi-wallet";
import {
  PLEDGE_CASH_NETWORKS,
  createPledgeCashPublicClient,
  initialSelectedNetwork,
  networkEnvironmentIdentity,
  networkForChainId,
  persistSelectedNetwork,
  supportedNetworkForChainId,
  syncSelectedNetworkSearch,
} from "../lib/contracts";
import {
  combineDiscoveryLastScanned,
  discoveryErrors,
  emptyDiscoveryResult,
  emptyDiscoverySnapshot,
  mergeAddressMap,
  parseDiscoveryToBlock,
} from "../lib/discovery";
import {
  defaultBoardroomForm,
  defaultBoardroomGrantForm,
  defaultGrantForm,
  defaultLiquidityExitForm,
  defaultLiquidityLockerForm,
  defaultLiquidityPositionForm,
  defaultWindDownForm,
  errorMessage,
  optionalPaymentToken,
  requireAddress,
  requireBytes32,
  requireDeploymentAddress,
  uintInput,
} from "../lib/forms";
import { getSentinelBaseUrl } from "../lib/sentinel";
import {
  assertFutureSwapDeadline,
  buildSwapTransaction,
  defaultSwapForm,
  readSwapQuote,
  readSwapTokenList,
  swapQuoteReady,
  withSwapTokenListDefaults,
  type SwapForm,
  type SwapQuoteState,
  type SwapTokenListState,
} from "../lib/swap";
import { parseTokenAmountInput, readTokenMetadata } from "../lib/token-amounts";
import { contractCallPreview, contractCallReview } from "../lib/transaction-preview";
import type {
  BoardroomForm,
  DiscoveryForm,
  DiscoverySnapshot,
  GrantForm,
  GrantSnapshot,
} from "../lib/types";
import { DesktopPrimaryNav, MobilePrimaryNav } from "./product-navigation";
import { PageHeading } from "./pages/page-primitives";
import { NotFoundPage } from "./pages/route-states";
import {
  appRouteHref,
  initialRoute,
  primaryDestination,
  routeFromLocation,
  type AppRoute,
  type CanonicalAppRoute,
} from "./routing";
import { SentinelSettingsView } from "./views/sentinel-settings";

type ContractRequest = Record<string, unknown> & { address: Address; functionName: string };

const EMPTY_TOKEN_LIST: SwapTokenListState = { tokens: [], pools: [], loaded: false };
const DEFAULT_DISCOVERY_FORM: DiscoveryForm = {
  fromBlock: "0",
  toBlock: "latest",
  chunkSize: "5000",
  includeClosedGrants: false,
};

export function App(): React.JSX.Element {
  const { clearLogs, logs, pendingAction, pushLog, runAction } = useActionRunner();
  const { approveReview, cancelReview, requestReview, review } = useTransactionReview();
  const [selectedChainId, setSelectedChainId] = useState(() => initialSelectedNetwork().chainId);
  const [route, setRoute] = useState<AppRoute>(() => initialRoute());
  const network = useMemo(() => networkForChainId(selectedChainId), [selectedChainId]);
  const publicClient = useMemo(() => createPledgeCashPublicClient(network), [network]);
  const generatedDeployment = useMemo(() => getPledgeCashDeployment(network.chainId), [network.chainId]);
  const deploymentAvailability = useRuntimeDeploymentAvailability(network.chainId, generatedDeployment);
  const deployment = deploymentAvailability.status === "ready" ? deploymentAvailability.deployment : undefined;
  const factorySnapshot = useFactorySnapshot(publicClient, deployment, pushLog);
  const walletApi = useWagmiWallet({ network, onAccountChanged: () => undefined, pushLog });
  const { activeAccount, nativeBalance, switchChain, wallet, walletClient } = walletApi;
  const transactionCenter = useTransactionCenter(network.chainId, wallet.account);

  const [boardroomForm, setBoardroomForm] = useState<BoardroomForm>(() => ({
    ...defaultBoardroomForm(),
    name: "Pledge Project",
    symbol: "PLDG",
  }));
  const [predictedBoardroom, setPredictedBoardroom] = useState<Address>();
  const [boardroom, setBoardroom] = useState<BoardroomState>();
  const [boardroomError, setBoardroomError] = useState<string>();
  const [locker, setLocker] = useState<LiquidityLockerState>();
  const [workspaceForm, setWorkspaceForm] = useState<BoardroomWorkspaceForm>(() => defaultBoardroomWorkspaceForm());

  const [grantForm, setGrantForm] = useState<GrantForm>(() => defaultGrantForm());
  const [predictedGrant, setPredictedGrant] = useState<Address>();
  const [grantAddress, setGrantAddress] = useState("");
  const [grantSnapshot, setGrantSnapshot] = useState<GrantSnapshot>();
  const [grantIssuerBoardroom, setGrantIssuerBoardroom] = useState<BoardroomState>();
  const [settleAmount, setSettleAmount] = useState("1");
  const [paymentApproval, setPaymentApproval] = useState("0");

  const [swapForm, setSwapForm] = useState<SwapForm>(() => defaultSwapForm());
  const [swapQuote, setSwapQuote] = useState<SwapQuoteState>();
  const [swapTokenList, setSwapTokenList] = useState<SwapTokenListState>(EMPTY_TOKEN_LIST);
  const [swapTokenListLoading, setSwapTokenListLoading] = useState(false);

  const [discoveryForm, setDiscoveryForm] = useState<DiscoveryForm>(DEFAULT_DISCOVERY_FORM);
  const [discovery, setDiscovery] = useState<DiscoverySnapshot>(() => emptyDiscoverySnapshot());

  const creationFee = factorySnapshot.creationFee ?? deployment?.creationFee ?? 0n;

  useEffect(() => {
    const onPopState = (): void => setRoute(routeFromLocation(window.location.pathname, window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!("chainId" in route) || route.chainId === undefined || !supportedNetworkForChainId(route.chainId)) return;
    setSelectedChainId(route.chainId);
  }, [route]);

  useEffect(() => {
    if (!wallet.account) return;
    setBoardroomForm((current) => ({ ...current, owner: current.owner || wallet.account || "" }));
    setWorkspaceForm((current) => ({
      ...current,
      mintTo: current.mintTo || wallet.account || "",
      windDown: { ...current.windDown, recipient: current.windDown.recipient || wallet.account || "" },
    }));
  }, [wallet.account]);

  const requestedBoardroom = route.kind === "project" || route.kind === "studio-project" ? route.boardroom : undefined;
  const refreshBoardroom = useCallback(async (): Promise<void> => {
    if (!requestedBoardroom) return;
    try {
      const next = await readBoardroomState(publicClient, requestedBoardroom);
      let nextLocker: LiquidityLockerState | undefined;
      if (deployment?.liquidityLockerFactory) {
        const lockerAddress = await readLiquidityLockerForBoardroom(publicClient, {
          factory: deployment.liquidityLockerFactory,
          boardroom: requestedBoardroom,
        });
        if (!isZeroAddress(lockerAddress)) nextLocker = await readLiquidityLockerState(publicClient, lockerAddress);
      }
      setBoardroom(next);
      setLocker(nextLocker);
      setBoardroomError(undefined);
      setWorkspaceForm((current) => ({ ...current, mintTo: current.mintTo || wallet.account || next.owner }));
    } catch (error) {
      setBoardroom(undefined);
      setLocker(undefined);
      setBoardroomError(errorMessage(error));
    }
  }, [deployment?.liquidityLockerFactory, publicClient, requestedBoardroom, wallet.account]);

  useEffect(() => {
    setBoardroom(undefined);
    setLocker(undefined);
    setBoardroomError(undefined);
    if (requestedBoardroom) void refreshBoardroom();
  }, [refreshBoardroom, requestedBoardroom]);

  useEffect(() => {
    if (route.kind !== "grant") return;
    setGrantAddress(route.grant);
    void loadGrantAddress(route.grant);
    // The route identity itself is the trigger; loadGrantAddress intentionally remains an event helper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, route]);

  useEffect(() => setSwapQuote(undefined), [swapForm]);

  const navigate = useCallback((next: CanonicalAppRoute): void => {
    const href = appRouteHref(next);
    window.history.pushState({}, "", href);
    setRoute(next);
    if ("chainId" in next && next.chainId !== undefined) setSelectedChainId(next.chainId);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const selectNetwork = (chainId: number): void => {
    setSelectedChainId(chainId);
    persistSelectedNetwork(chainId);
    syncSelectedNetworkSearch(chainId);
    if (route.kind === "project" || route.kind === "studio-project" || route.kind === "grant") {
      navigate({ kind: "explore", chainId });
    }
  };

  const submitContractTransaction = async (label: string, request: ContractRequest): Promise<Hex> => {
    const account = activeAccount();
    const callReview = contractCallReview(label, request);
    const transactionId = transactionCenter.startTransaction(callReview);
    try {
      await requestReview(callReview);
      transactionCenter.updateTransaction(transactionId, { stage: "simulating" });
      pushLog(contractCallPreview(label, request), "info");
      const simulation = await publicClient.simulateContract({
        account,
        ...request,
      } as never);
      transactionCenter.updateTransaction(transactionId, { stage: "awaiting-signature" });
      const hash = await walletClient().writeContract(simulation.request as never);
      transactionCenter.updateTransaction(transactionId, { hash, submittedHash: hash, stage: "submitted" });
      pushLog(`${label} submitted`, "info", hash, network.chainId);
      await publicClient.waitForTransactionReceipt({ hash });
      transactionCenter.updateTransaction(transactionId, { stage: "confirmed" });
      pushLog(`${label} confirmed`, "success", hash, network.chainId);
      return hash;
    } catch (error) {
      const cancelled = error instanceof Error && error.name === "TransactionReviewCancelledError";
      transactionCenter.updateTransaction(transactionId, {
        error: cancelled ? undefined : errorMessage(error),
        stage: cancelled ? "cancelled" : "failed",
      });
      throw error;
    }
  };

  async function predictBoardroom(): Promise<void> {
    const factory = requireDeploymentAddress(deployment?.boardroomFactory, "BoardroomFactory");
    const predicted = await predictBoardroomAddress(publicClient, {
      factory,
      owner: requireAddress(boardroomForm.owner, "Owner"),
      name: boardroomForm.name,
      symbol: boardroomForm.symbol,
      salt: requireBytes32(boardroomForm.salt, "Boardroom salt"),
    });
    setPredictedBoardroom(predicted);
    pushLog(`Predicted Boardroom ${predicted}`, "success");
  }

  async function createBoardroom(): Promise<void> {
    const factory = requireDeploymentAddress(deployment?.boardroomFactory, "BoardroomFactory");
    const owner = requireAddress(boardroomForm.owner, "Owner");
    const salt = requireBytes32(boardroomForm.salt, "Boardroom salt");
    const predicted = predictedBoardroom ?? await predictBoardroomAddress(publicClient, {
      factory,
      owner,
      name: boardroomForm.name,
      symbol: boardroomForm.symbol,
      salt,
    });
    await submitContractTransaction("Create Boardroom", buildBoardroomCreateTransaction({
      factory,
      owner,
      name: boardroomForm.name,
      symbol: boardroomForm.symbol,
      salt,
    }));
    navigate({ kind: "studio-project", chainId: network.chainId, boardroom: predicted, section: "setup" });
  }

  async function boardroomAction(action: BoardroomAction): Promise<void> {
    if (action === "refresh") return await refreshBoardroom();
    if (!boardroom) throw new Error("Load the Boardroom before submitting an action.");
    const boardroomAddress = boardroom.address;
    const lockerAddress = locker?.address;
    let request: ContractRequest;
    switch (action) {
      case "mint":
        request = buildBoardroomMintTransaction({ boardroom: boardroomAddress, to: requireAddress(workspaceForm.mintTo, "Mint recipient"), amount: uintInput(workspaceForm.mintAmount, "Mint amount") });
        break;
      case "launch":
        request = buildBoardroomLaunchTransaction({ boardroom: boardroomAddress });
        break;
      case "create-grant":
        request = buildBoardroomAssetGrantIssuanceBatch({
          boardroom: boardroomAddress,
          factory: requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory"),
          shareToken: boardroom.shareToken,
          terms: rawGrantTerms(workspaceForm.grant),
          creationFee,
        });
        break;
      case "create-locker":
        request = buildBoardroomCreateLiquidityLockerTransaction({
          boardroom: boardroomAddress,
          factory: requireDeploymentAddress(deployment?.liquidityLockerFactory, "LiquidityLockerFactory"),
          terms: {
            quoteAsset: requireAddress(workspaceForm.locker.quoteAsset, "Quote asset"),
            poolFee: numberInput(workspaceForm.locker.poolFee, "Pool fee"),
            tickSpacing: signedNumberInput(workspaceForm.locker.tickSpacing, "Tick spacing"),
            salt: requireBytes32(workspaceForm.locker.salt, "Locker salt"),
          },
        });
        break;
      case "prepare-position":
        request = buildBoardroomPreparePositionTransferTransaction({ boardroom: boardroomAddress, locker: requireValue(lockerAddress, "Create the locker first."), tokenId: uintInput(workspaceForm.position.tokenId, "Position token ID") });
        break;
      case "transfer-position":
        request = buildPositionManagerSafeTransferToLockerTransaction({
          positionManager: requireDeploymentAddress(deployment?.uniswapV4PositionManager, "PositionManager"),
          from: activeAccount(),
          locker: requireValue(lockerAddress, "Create the locker first."),
          tokenId: uintInput(workspaceForm.position.tokenId, "Position token ID"),
        });
        break;
      case "register-position":
        request = buildBoardroomRegisterLiquidityPositionTransaction({ boardroom: boardroomAddress, locker: requireValue(lockerAddress, "Create the locker first."), tokenId: uintInput(workspaceForm.position.tokenId, "Position token ID") });
        break;
      case "collect-fees":
        request = buildLiquidityLockerCollectFeesTransaction({ locker: requireValue(lockerAddress, "Create the locker first.") });
        break;
      case "cancel-locker":
        request = buildBoardroomLiquidityLockerCancelTransaction({ boardroom: boardroomAddress, locker: requireValue(lockerAddress, "Create the locker first."), status: activeBoardroomStatus(boardroom) });
        break;
      case "exit-locker":
        request = buildBoardroomLiquidityLockerExitTransaction({
          boardroom: boardroomAddress,
          locker: requireValue(lockerAddress, "Create the locker first."),
          amount0Min: uintInput(workspaceForm.exit.amount0Min, "amount0 minimum"),
          amount1Min: uintInput(workspaceForm.exit.amount1Min, "amount1 minimum"),
          deadline: uintInput(workspaceForm.exit.deadline, "Exit deadline"),
        });
        break;
      case "register-asset":
        request = buildBoardroomRegisterRedeemableAssetTransaction({ boardroom: boardroomAddress, asset: requireAddress(workspaceForm.windDown.asset, "Redemption asset") });
        break;
      case "start-wind-down":
        request = buildBoardroomStartWindDownTransaction({ boardroom: boardroomAddress });
        break;
      case "begin-snapshot":
        request = buildBoardroomBeginSnapshotTransaction({ boardroom: boardroomAddress });
        break;
      case "snapshot-assets":
        request = buildBoardroomSnapshotAssetsTransaction({ boardroom: boardroomAddress, maximum: uintInput(workspaceForm.snapshotMaximum, "Snapshot maximum") });
        break;
      case "wrap-native":
        request = buildBoardroomWrapNativeBalanceTransaction({ boardroom: boardroomAddress });
        break;
      case "burn-treasury-shares":
        request = buildBoardroomBurnTreasurySharesTransaction({ boardroom: boardroomAddress });
        break;
      case "open-redemptions":
        request = buildBoardroomOpenRedemptionsTransaction({ boardroom: boardroomAddress });
        break;
      case "redeem":
        request = buildBoardroomRedeemTransaction({ boardroom: boardroomAddress, shares: uintInput(workspaceForm.windDown.shares, "Shares") });
        break;
      case "claim-asset":
        request = buildBoardroomClaimRedemptionAssetTransaction({
          boardroom: boardroomAddress,
          asset: requireAddress(workspaceForm.windDown.asset, "Redemption asset"),
          recipient: requireAddress(workspaceForm.windDown.recipient, "Claim recipient"),
          minAmountOut: uintInput(workspaceForm.windDown.minAmount, "Minimum amount"),
        });
        break;
    }
    await submitContractTransaction(boardroomActionLabel(action), request);
    await refreshBoardroom();
  }

  async function directGrantTerms(): Promise<GrantCreationTerms> {
    const token = requireAddress(grantForm.token, "Grant token");
    const paymentToken = optionalPaymentToken(grantForm.paymentToken);
    const tokenMetadata = await readTokenMetadata(publicClient, token);
    if (tokenMetadata.decimals === undefined) throw new Error("Grant token decimals could not be read.");
    const amount = parseTokenAmountInput(grantForm.amount, tokenMetadata, "Grant amount");
    let price = 0n;
    if (!isZeroAddress(paymentToken)) {
      const paymentMetadata = await readTokenMetadata(publicClient, paymentToken);
      if (paymentMetadata.decimals === undefined) throw new Error("Payment token decimals could not be read.");
      price = parseTokenAmountInput(grantForm.price, paymentMetadata, "Grant price");
    }
    return {
      holder: requireAddress(grantForm.holder, "Holder"),
      token,
      paymentToken,
      amount,
      price,
      vestingCliff: uintInput(grantForm.vestingCliff, "Vesting cliff"),
      vestingEnd: uintInput(grantForm.vestingEnd, "Vesting end"),
      expiry: uintInput(grantForm.expiry, "Expiry"),
      transferable: grantForm.transferable,
      transferUnlockTime: uintInput(grantForm.transferUnlockTime, "Transfer unlock"),
      salt: requireBytes32(grantForm.salt, "Grant salt"),
    };
  }

  async function predictDirectGrant(): Promise<void> {
    const predicted = await predictGrantAddress(publicClient, {
      factory: requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory"),
      issuer: activeAccount(),
      salt: requireBytes32(grantForm.salt, "Grant salt"),
    });
    setPredictedGrant(predicted);
    setGrantAddress(predicted);
    pushLog(`Predicted grant ${predicted}`, "success");
  }

  async function approveGrantEscrow(): Promise<void> {
    const terms = await directGrantTerms();
    await submitContractTransaction("Approve grant escrow", buildErc20Approval({
      token: terms.token,
      spender: requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory"),
      amount: terms.amount,
    }));
  }

  async function createDirectGrant(): Promise<void> {
    await submitContractTransaction("Create direct grant", buildDirectGrantCreationTransaction({
      factory: requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory"),
      terms: await directGrantTerms(),
      creationFee,
    }));
  }

  async function loadGrantAddress(address = requireAddress(grantAddress, "Grant address")): Promise<void> {
    const state = await readGrantState(publicClient, address, BigInt(Math.floor(Date.now() / 1000)));
    const [tokenMetadata, paymentTokenMetadata] = await Promise.all([
      readTokenMetadata(publicClient, state.token),
      isZeroAddress(state.paymentToken) ? undefined : readTokenMetadata(publicClient, state.paymentToken),
    ]);
    setGrantSnapshot({
      address,
      issuer: state.issuer,
      holder: state.holder,
      token: state.token,
      paymentToken: state.paymentToken,
      grantSize: state.grantSize,
      claimable: state.claimable,
      price: state.price,
      vestingCliff: state.vestingCliff,
      vestingEnd: state.vestingEnd,
      expiry: state.expiry,
      settledAmount: state.settledAmount,
      settleable: state.settleable,
      settlementCost: state.settlementCost,
      halted: state.halted,
      closed: state.closed,
      tokenMetadata,
      paymentTokenMetadata,
    });
    try {
      setGrantIssuerBoardroom(await readBoardroomState(publicClient, state.issuer));
    } catch {
      setGrantIssuerBoardroom(undefined);
    }
    setGrantAddress(address);
    pushLog(`Loaded grant ${address}`, "success");
  }

  async function approveGrantPayment(): Promise<void> {
    if (!grantSnapshot || isZeroAddress(grantSnapshot.paymentToken)) throw new Error("Load a paid grant first.");
    const metadata = await readTokenMetadata(publicClient, grantSnapshot.paymentToken);
    if (metadata.decimals === undefined) throw new Error("Payment token decimals could not be read.");
    await submitContractTransaction("Approve grant payment", buildErc20Approval({
      token: grantSnapshot.paymentToken,
      spender: grantSnapshot.address,
      amount: parseTokenAmountInput(paymentApproval, metadata, "Payment approval"),
    }));
  }

  async function settleGrant(): Promise<void> {
    if (!grantSnapshot?.tokenMetadata) throw new Error("Load the grant first.");
    const amount = parseTokenAmountInput(settleAmount, grantSnapshot.tokenMetadata, "Settlement amount");
    await submitContractTransaction("Settle grant", buildGrantSettlementTransaction({ grant: grantSnapshot.address, amount }));
    await loadGrantAddress(grantSnapshot.address);
  }

  async function settleAvailableGrant(): Promise<void> {
    if (!grantSnapshot) throw new Error("Load the grant first.");
    const holder = activeAccount();
    const prepared = await prepareSmartGrantSettlement({
      chainId: network.chainId,
      grant: grantSnapshot.address,
      holder,
      readCurrentState: async () => await readGrantState(publicClient, grantSnapshot.address),
      readQuote: async (amount) => await readGrantSettlementQuote(publicClient, grantSnapshot.address, amount),
    });
    if (prepared.plan.kind === "approve") {
      await submitContractTransaction("Approve exact grant payment", buildErc20Approval({ token: prepared.quote.state.paymentToken, spender: grantSnapshot.address, amount: prepared.plan.amount }));
      setPaymentApproval(formatUnits(prepared.plan.amount, prepared.quote.state.paymentTokenDecimals));
    } else {
      await submitContractTransaction("Settle available grant", buildGrantSettlementTransaction({ grant: grantSnapshot.address, amount: prepared.plan.amount }));
      await loadGrantAddress(grantSnapshot.address);
    }
  }

  async function runGrantIssuerAction(functionName: "stopVestingAndWithdrawUnvested" | "withdrawExpiredTokens", label: string): Promise<void> {
    if (!grantSnapshot) throw new Error("Load the grant first.");
    const request = grantIssuerBoardroom
      ? buildGrantIssuerBoardroomAction({
          boardroom: grantIssuerBoardroom.address,
          grant: grantSnapshot.address,
          status: activeBoardroomStatus(grantIssuerBoardroom),
          functionName,
        })
      : { address: grantSnapshot.address, abi: tokenGrantAbi, functionName };
    await submitContractTransaction(label, request);
    await loadGrantAddress(grantSnapshot.address);
  }

  async function refreshSwapTokens(): Promise<void> {
    setSwapTokenListLoading(true);
    try {
      const next = await readSwapTokenList(publicClient, deployment, wallet.account, {
        wrappedNativeLabel: network.wrappedNativeSymbol,
      });
      setSwapTokenList(next);
      setSwapForm((current) => withSwapTokenListDefaults(current, next, deployment));
      if (next.error) pushLog(next.error, next.tokens.length > 0 ? "info" : "error");
      else pushLog(`Loaded ${next.tokens.length.toString()} tokens from ${next.pools.length.toString()} locked pools`, "success");
    } finally {
      setSwapTokenListLoading(false);
    }
  }

  async function refreshSwapQuote(): Promise<void> {
    const next = await readSwapQuote(publicClient, deployment, swapForm, wallet.account);
    setSwapQuote(next);
    if (next.error) throw new Error(next.error);
    pushLog("Loaded swap quote", "success");
  }

  async function approveSwapInput(): Promise<void> {
    const quote = await readSwapQuote(publicClient, deployment, swapForm, activeAccount());
    setSwapQuote(quote);
    if (!swapQuoteReady(quote)) throw new Error(quote.error ?? "Refresh the swap quote first.");
    const permit2 = requireDeploymentAddress(deployment?.permit2, "Permit2");
    const router = requireDeploymentAddress(deployment?.uniswapUniversalRouter, "Universal Router");
    if ((quote.tokenIn.erc20Allowance ?? 0n) < quote.amountIn) {
      await submitContractTransaction("Approve token for Permit2", buildErc20Approval({ token: quote.tokenIn.address, spender: permit2, amount: (1n << 256n) - 1n }));
    }
    if ((quote.tokenIn.permit2Allowance ?? 0n) < quote.amountIn || (quote.tokenIn.permit2Expiration ?? 0) <= Math.floor(Date.now() / 1000)) {
      await submitContractTransaction("Approve router in Permit2", buildPermit2ApprovalTransaction({
        permit2,
        token: quote.tokenIn.address,
        universalRouter: router,
        amount: (1n << 160n) - 1n,
        expiration: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      }));
    }
    await refreshSwapQuote();
  }

  async function executeSwap(): Promise<void> {
    const account = activeAccount();
    assertFutureSwapDeadline(swapForm.deadline);
    const quote = await readSwapQuote(publicClient, deployment, swapForm, account);
    setSwapQuote(quote);
    if (!swapQuoteReady(quote)) throw new Error(quote.error ?? "Refresh the swap quote first.");
    if ((quote.tokenIn.allowance ?? 0n) < quote.amountIn) throw new Error("Approve the current swap amount first.");
    await submitContractTransaction("Swap", buildSwapTransaction({ deployment, form: swapForm, quote, account }));
    await refreshSwapQuote();
  }

  async function scanDiscovery(fromBlockOverride?: bigint): Promise<void> {
    const fromBlock = fromBlockOverride ?? uintInput(discoveryForm.fromBlock || "0", "From block");
    const toBlock = parseDiscoveryToBlock(discoveryForm.toBlock);
    const chunkSize = uintInput(discoveryForm.chunkSize, "Chunk size");
    const range = { fromBlock, toBlock, chunkSize };
    const [boardrooms, grants, lockers] = await Promise.all([
      deployment?.boardroomFactory
        ? discoverBoardrooms(publicClient, { ...range, factory: deployment.boardroomFactory, ...(wallet.account ? { owner: wallet.account } : {}) })
        : emptyDiscoveryResult<DiscoveredBoardroom>(),
      deployment?.tokenGrantFactory
        ? discoverGrantHistory(publicClient, { ...range, factory: deployment.tokenGrantFactory })
        : emptyDiscoveryResult<DiscoveredGrant>(),
      deployment?.liquidityLockerFactory
        ? discoverLiquidityLockers(publicClient, { ...range, factory: deployment.liquidityLockerFactory })
        : emptyDiscoveryResult<DiscoveredLiquidityLocker>(),
    ]);
    const results = [boardrooms, grants, lockers];
    const lastScannedBlock = combineDiscoveryLastScanned(results);
    setDiscovery((current) => ({
      chainId: network.chainId,
      ...(wallet.account ? { loadedFor: wallet.account } : {}),
      fromBlock,
      toBlock,
      chunkSize,
      complete: results.every((result) => result.complete),
      ...(lastScannedBlock === undefined ? {} : { lastScannedBlock }),
      errors: discoveryErrors(results),
      boardroomsByAddress: mergeAddressMap(current.boardroomsByAddress, boardrooms.items, (item) => item.boardroom),
      grantsByAddress: mergeAddressMap(current.grantsByAddress, grants.items, (item) => item.grantAddress),
      lockersByAddress: mergeAddressMap(current.lockersByAddress, lockers.items, (item) => item.locker),
    }));
  }

  const grantCapability = walletActionCapability(wallet.account, wallet.chainId, network.chainId);
  const swapCapability: WalletActionCapability = deployment?.uniswapUniversalRouter
    ? grantCapability
    : { status: "blocked", reason: "This action is not available right now." };
  const canWrite = grantCapability.status === "enabled";
  const canManage = Boolean(canWrite && boardroom && wallet.account?.toLowerCase() === boardroom.owner.toLowerCase());
  const issuerActionsAvailable = Boolean(grantSnapshot && wallet.account && (
    wallet.account.toLowerCase() === grantSnapshot.issuer.toLowerCase()
    || wallet.account.toLowerCase() === grantIssuerBoardroom?.owner.toLowerCase()
  ));
  const nativeBalanceValue = nativeBalance.status === "ready" ? nativeBalance.value : undefined;

  const swapPanel = (
    <SwapPanel
      account={wallet.account}
      actionCapability={swapCapability}
      deployment={deployment}
      form={swapForm}
      nativeBalance={nativeBalanceValue}
      pendingAction={pendingAction}
      quote={swapQuote}
      setForm={setSwapForm}
      tokenList={swapTokenList}
      tokenListLoading={swapTokenListLoading}
      wrappedNativeSymbol={network.wrappedNativeSymbol}
      approveInput={approveSwapInput}
      executeSwap={executeSwap}
      refreshQuote={refreshSwapQuote}
      refreshTokens={refreshSwapTokens}
      runAction={runAction}
      switchWalletNetwork={switchChain}
    />
  );

  const grantInspector = (
    <GrantInspector
      account={wallet.account}
      actionCapability={grantCapability}
      addressLocked={route.kind === "grant"}
      grantAddress={grantAddress}
      grantSnapshot={grantSnapshot}
      issuerActionsAvailable={issuerActionsAvailable}
      paymentApproval={paymentApproval}
      pendingAction={pendingAction}
      settleAmount={settleAmount}
      setGrantAddress={(address) => { setGrantAddress(address); setGrantSnapshot(undefined); }}
      setPaymentApproval={setPaymentApproval}
      setSettleAmount={setSettleAmount}
      approvePayment={approveGrantPayment}
      haltGrant={async () => await runGrantIssuerAction("stopVestingAndWithdrawUnvested", "Halt grant vesting")}
      loadGrant={async () => await loadGrantAddress()}
      runAction={runAction}
      settleGrant={settleGrant}
      settleAvailableGrant={settleAvailableGrant}
      withdrawExpired={async () => await runGrantIssuerAction("withdrawExpiredTokens", "Withdraw expired grant")}
    />
  );

  const body = renderRoute({
    route,
    networkChainId: network.chainId,
    deployment,
    deploymentStatus: deploymentAvailability.status,
    deploymentReason: deploymentAvailability.reason,
    walletPanel: <WalletPanel wallet={wallet} />,
    swapPanel,
    grantInspector,
    boardroom,
    boardroomError,
    locker,
    boardroomCreate: (
      <BoardroomCreatePanel
        form={boardroomForm}
        pendingAction={pendingAction}
        predicted={predictedBoardroom}
        setForm={setBoardroomForm}
        create={createBoardroom}
        predict={predictBoardroom}
        runAction={runAction}
      />
    ),
    directGrant: (
      <DirectGrantPanel
        creationFee={creationFee}
        grantForm={grantForm}
        issuer={wallet.account}
        pendingAction={pendingAction}
        predictedGrant={predictedGrant}
        clearDirectGrantPrediction={() => setPredictedGrant(undefined)}
        setGrantForm={setGrantForm}
        approveEscrow={approveGrantEscrow}
        createGrant={createDirectGrant}
        predictGrant={predictDirectGrant}
        runAction={runAction}
      />
    ),
    boardroomWorkspace: boardroom && (route.kind === "project" || route.kind === "studio-project") ? (
      <BoardroomWorkspace
        account={wallet.account}
        boardroom={boardroom}
        canManage={canManage}
        canWrite={canWrite}
        chainId={network.chainId}
        form={workspaceForm}
        locker={locker}
        mode={route.kind === "project" ? "project" : "studio"}
        pendingAction={pendingAction}
        projectSection={route.kind === "project" ? route.section : undefined}
        setForm={setWorkspaceForm}
        studioSection={route.kind === "studio-project" ? route.section : undefined}
        swap={swapPanel}
        onAction={async (action) => await runAction(action, async () => await boardroomAction(action))}
      />
    ) : undefined,
    walletAccess: (
      <WalletAccessPanel
        account={wallet.account}
        deployment={deployment}
        discovery={discovery}
        discoveryForm={discoveryForm}
        pendingAction={pendingAction}
        inspectGrant={(grant) => navigate({ kind: "grant", chainId: network.chainId, grant })}
        scanDiscovery={async () => await scanDiscovery()}
        useBoardroom={(address) => navigate({ kind: "project", chainId: network.chainId, boardroom: address, section: "overview" })}
        useLocker={(item) => navigate({ kind: "studio-project", chainId: network.chainId, boardroom: item.boardroom, section: "liquidity" })}
        runAction={runAction}
      />
    ),
    identity: getSentinelBaseUrl()
      ? <SentinelSettingsView wallet={wallet} />
      : <Panel title="Wallet identity"><p className="m-0 border-t border-[var(--pc-border)] p-4 text-sm text-[var(--pc-text-muted)]">The optional identity service is not configured for this deployment. Wallet transactions remain available without it.</p></Panel>,
    tools: (
      <div className="grid gap-4">
        <DeploymentPanel chainId={network.chainId} creationFee={creationFee} deployment={deployment} factorySnapshot={factorySnapshot} />
        <ArtifactPanel deployment={deployment} />
        <DiscoveryPanel
          account={wallet.account}
          deployment={deployment}
          discovery={discovery}
          discoveryForm={discoveryForm}
          pendingAction={pendingAction}
          setDiscoveryForm={setDiscoveryForm}
          clearDiscovery={() => setDiscovery(emptyDiscoverySnapshot())}
          inspectGrant={(grant) => navigate({ kind: "grant", chainId: network.chainId, grant })}
          scanDiscovery={async () => await scanDiscovery()}
          resumeDiscovery={async () => await scanDiscovery((discovery.lastScannedBlock ?? -1n) + 1n)}
          useBoardroom={(address) => navigate({ kind: "studio-project", chainId: network.chainId, boardroom: address, section: "setup" })}
          useLocker={(item) => navigate({ kind: "studio-project", chainId: network.chainId, boardroom: item.boardroom, section: "liquidity" })}
          runAction={runAction}
        />
        <LogPanel logs={logs} clearLogs={clearLogs} />
      </div>
    ),
    onReturn: () => navigate({ kind: "explore", chainId: network.chainId }),
  });

  return (
    <div className="min-h-svh bg-[var(--pc-canvas)] pb-20 text-[var(--pc-text)] md:pb-0">
      <AppHeader
        wallet={wallet}
        chainId={network.chainId}
        chainName={network.name}
        environment={networkEnvironmentIdentity(network)}
        networks={PLEDGE_CASH_NETWORKS}
        networkAvailability={{ [network.chainId]: deploymentAvailability.status }}
        onNetworkChange={selectNetwork}
        pendingAction={pendingAction}
        runAction={runAction}
        switchChain={switchChain}
      />
      <div className="border-b border-[var(--pc-border)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 sm:px-8">
          <DesktopPrimaryNav
            active={primaryDestination(route)}
            chainId={network.chainId}
            onNavigate={(destination) => navigate({ kind: destination, chainId: network.chainId })}
          />
          <a className="py-3 text-xs font-semibold text-[var(--pc-text-muted)] hover:text-[var(--pc-text)]" href={appRouteHref({ kind: "tools" })}>Tools</a>
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">{body}</main>
      <MobilePrimaryNav
        active={primaryDestination(route)}
        chainId={network.chainId}
        onNavigate={(destination) => navigate({ kind: destination, chainId: network.chainId })}
      />
      <TransactionReview review={review} approve={approveReview} cancel={cancelReview} />
      <TransactionTray records={transactionCenter.records} clearSettled={transactionCenter.clearSettled} />
    </div>
  );
}

type RouteRenderInput = {
  route: AppRoute;
  networkChainId: number;
  deployment: PledgeCashDeployment | undefined;
  deploymentStatus: string;
  deploymentReason: string | undefined;
  walletPanel: ReactNode;
  swapPanel: ReactNode;
  grantInspector: ReactNode;
  boardroom: BoardroomState | undefined;
  boardroomError: string | undefined;
  locker: LiquidityLockerState | undefined;
  boardroomCreate: ReactNode;
  directGrant: ReactNode;
  boardroomWorkspace: ReactNode;
  walletAccess: ReactNode;
  identity: ReactNode;
  tools: ReactNode;
  onReturn: () => void;
};

export function renderRoute(input: RouteRenderInput): ReactNode {
  const { route } = input;
  if (route.kind === "not-found") return <NotFoundPage onReturn={input.onReturn} returnHref={appRouteHref({ kind: "explore", chainId: input.networkChainId })} />;
  if (route.kind === "identity") return input.identity;
  if (route.kind === "tools") return input.tools;
  if ("chainId" in route && route.chainId !== undefined && route.chainId !== input.networkChainId) {
    return <SurfaceNotice title="Switching networks">Preparing chain {route.chainId.toString()} for this route.</SurfaceNotice>;
  }
  if (input.deploymentStatus !== "ready" && !input.deployment) {
    return <SurfaceNotice title="Deployment unavailable">{input.deploymentReason ?? "The deployment artifact is still loading."}</SurfaceNotice>;
  }
  if (route.kind === "explore") {
    return (
      <div className="grid gap-8">
        <Landing />
        <section><PageHeading eyebrow="Exchange" title="Swap through locked v4 pools" description="Discover hookless pools from pledge.cash liquidity lockers and execute through Uniswap’s Universal Router." /></section>
        {input.swapPanel}
      </div>
    );
  }
  if (route.kind === "portfolio") {
    return (
      <div className="grid gap-4">
        <PageHeading eyebrow="Portfolio" title="Wallet access and grants" description="Inspect the Boardrooms, grant rights, and liquidity lockers connected to this wallet." />
        {input.walletPanel}
        {input.walletAccess}
        {input.grantInspector}
      </div>
    );
  }
  if (route.kind === "studio") {
    return (
      <div className="grid gap-4">
        <PageHeading eyebrow="Studio" title="Create the lean protocol core" description="Create a Boardroom custody boundary or issue a standalone token grant." />
        {input.boardroomCreate}
        {input.directGrant}
      </div>
    );
  }
  if (route.kind === "grant") return input.grantInspector;
  if (input.boardroomError) return <SurfaceNotice title="Boardroom unavailable">{input.boardroomError}</SurfaceNotice>;
  if (!input.boardroom) return <SurfaceNotice title="Loading Boardroom">Reading custody, lifecycle, share supply, and locked-liquidity state.</SurfaceNotice>;
  return input.boardroomWorkspace;
}

function Landing(): React.JSX.Element {
  const surfaces = [
    { label: "Token grants", description: "Escrow, vesting, settlement, and issuer closure.", href: appRouteHref({ kind: "portfolio" }), icon: BadgeDollarSign },
    { label: "Boardrooms", description: "Flat-owner custody, shares, wind-down, and redemption.", href: appRouteHref({ kind: "studio" }), icon: Landmark },
    { label: "Locked liquidity", description: "Canonical v4 position custody with collectable fees.", href: appRouteHref({ kind: "explore" }), icon: LockKeyhole },
  ] as const;
  return (
    <section>
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--pc-accent)]">Lean protocol core</p>
      <h1 className="m-0 mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">Grants, custody, and locked liquidity.</h1>
      <p className="m-0 mt-5 max-w-2xl text-base leading-7 text-[var(--pc-text-muted)]">Project launches use Uniswap’s native launchpad. pledge.cash coordinates the smaller lifecycle around them.</p>
      <div className="mt-10 grid border-y border-[var(--pc-border)] md:grid-cols-3">
        {surfaces.map(({ description, href, icon: Icon, label }) => (
          <a className="group border-b border-[var(--pc-border)] py-6 last:border-b-0 md:border-b-0 md:border-r md:px-6 md:first:pl-0 md:last:border-r-0" href={href} key={label}>
            <Icon className="h-5 w-5 text-[var(--pc-accent)]" />
            <div className="mt-5 flex items-center justify-between"><h2 className="m-0 text-lg font-semibold">{label}</h2><ArrowRight className="h-4 w-4" /></div>
            <p className="m-0 mt-2 text-sm leading-6 text-[var(--pc-text-muted)]">{description}</p>
          </a>
        ))}
      </div>
      <div className="mt-8"><ButtonLink href={appRouteHref({ kind: "studio" })} variant="secondary">Open Studio</ButtonLink></div>
    </section>
  );
}

function SurfaceNotice({ children, title }: { children: ReactNode; title: string }): React.JSX.Element {
  return <Panel title={title}><p className="m-0 border-t border-[var(--pc-border)] p-4 text-sm text-[var(--pc-text-muted)]">{children}</p></Panel>;
}

function defaultBoardroomWorkspaceForm(): BoardroomWorkspaceForm {
  return {
    mintTo: "",
    mintAmount: "1",
    snapshotMaximum: "32",
    grant: defaultBoardroomGrantForm(),
    locker: defaultLiquidityLockerForm(),
    position: defaultLiquidityPositionForm(),
    exit: defaultLiquidityExitForm(),
    windDown: defaultWindDownForm(),
  };
}

function rawGrantTerms(form: BoardroomWorkspaceForm["grant"]): GrantCreationTerms {
  return {
    holder: requireAddress(form.holder, "Holder"),
    token: requireAddress(form.token, "Grant asset"),
    paymentToken: optionalPaymentToken(form.paymentToken),
    amount: uintInput(form.amount, "Grant amount"),
    price: uintInput(form.price, "Grant price"),
    vestingCliff: uintInput(form.vestingCliff, "Vesting cliff"),
    vestingEnd: uintInput(form.vestingEnd, "Vesting end"),
    expiry: uintInput(form.expiry, "Expiry"),
    transferable: form.transferable,
    transferUnlockTime: uintInput(form.transferUnlockTime, "Transfer unlock"),
    salt: requireBytes32(form.salt, "Grant salt"),
  };
}

function numberInput(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} must be a non-negative safe integer.`);
  return number;
}

function signedNumberInput(value: string, label: string): number {
  if (!/^-?\d+$/.test(value.trim())) throw new Error(`${label} must be an integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} must be a safe integer.`);
  return number;
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function activeBoardroomStatus(boardroom: BoardroomState): 0 | 1 {
  if (boardroom.status !== 0 && boardroom.status !== 1) throw new Error("This escrow can only be managed before snapshotting begins.");
  return boardroom.status;
}

function boardroomActionLabel(action: Exclude<BoardroomAction, "refresh">): string {
  return action.split("-").map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
}
