import {
  buildBondFinalizeTransaction,
  buildBondPurchaseTransaction,
  buildBondRedeemTransaction,
  buildErc20Approval,
  readBondPositionsForOwner,
  readBondPurchaseQuote,
  type Address,
  type BondMarketState,
  type BondPositionState,
  type BondPurchaseQuote,
} from "@pledge.cash/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicClient } from "viem";
import { ActionButton } from "../../components/shell";
import { Input } from "../../components/ui/input";
import { errorMessage } from "../../lib/forms";
import { formatTokenAmount, parseTokenAmountInput } from "../../lib/token-amounts";
import type { BoardroomDistributionSnapshot } from "../../lib/types";
import { ConnectWalletPrompt } from "../wallet/connect-wallet-prompt";
import { ParticipationActionGuard } from "./action-integrity";
import {
  AdvancedFields,
  AmountField,
  ContractFact,
  FlowActions,
  FlowError,
  FlowHeading,
  InlineField,
  QuoteGrid,
  ReadError,
} from "./flow-primitives";
import { minimumWithSlippage, parseSlippageBps, transactionDeadline } from "./participation-math";
import type { ParticipationFlowContext } from "./types";

type BondMarketFlowProps = ParticipationFlowContext & {
  distribution: BoardroomDistributionSnapshot;
};

type ParsedAmount = { error?: string; value?: bigint };
export type BondMarketActionKind = "approve" | "trade";

export type BondMarketActionIntent = {
  account: Address;
  boardroom: Address;
  boardroomStatus: number;
  deadlineMinutes: string;
  factory: Address;
  market: Address;
  quoteAmount: bigint;
  quoteToken: Address;
  shareToken: Address;
  slippageBps: bigint;
};

export type PreparedBondMarketAction = {
  kind: BondMarketActionKind;
  minimumPayout: bigint;
  quote: BondPurchaseQuote;
  request: Record<string, unknown>;
};

type PrepareBondMarketActionOptions = {
  clock?: (() => number) | undefined;
  expectedAction: BondMarketActionKind;
  intent: BondMarketActionIntent;
  isCurrent?: ((intent: BondMarketActionIntent) => boolean) | undefined;
  onQuote?: ((quote: BondPurchaseQuote) => void) | undefined;
  readQuote?: typeof readBondPurchaseQuote | undefined;
};

export function BondMarketFlow({
  account,
  dashboard,
  distribution,
  pendingAction,
  publicClient,
  runAction,
  submitTransaction,
}: BondMarketFlowProps): React.JSX.Element {
  const state = bondMarketState(distribution);
  const quoteMetadata = distribution.quoteTokenMetadata;
  const shareMetadata = distribution.shareTokenMetadata;
  const [amountInput, setAmountInput] = useState("");
  const [slippageInput, setSlippageInput] = useState("1");
  const [deadlineMinutes, setDeadlineMinutes] = useState("20");
  const [quote, setQuote] = useState<BondPurchaseQuote>();
  const [quoteError, setQuoteError] = useState<string>();
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [positions, setPositions] = useState<BondPositionState[]>([]);
  const [positionsError, setPositionsError] = useState<string>();
  const quoteVersion = useRef(0);

  const parsedAmount = useMemo<ParsedAmount>(() => {
    if (!amountInput.trim()) return {};
    if (!quoteMetadata) return { error: "Quote-token decimals are unavailable." };
    try {
      return { value: parseTokenAmountInput(amountInput, quoteMetadata, "Commit amount") };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [amountInput, quoteMetadata]);

  const slippage = safeSlippage(slippageInput);
  const minimumPayout = quote && slippage.value !== undefined
    ? minimumWithSlippage(quote.payout, slippage.value)
    : undefined;
  const actionIdentity = bondMarketActionIdentity({
    account,
    boardroom: state?.boardroom,
    boardroomStatus: dashboard.snapshot.status,
    deadlineMinutes,
    factory: state?.factory,
    market: state?.address,
    quoteAmount: parsedAmount.value,
    quoteToken: state?.quoteToken,
    shareToken: state?.shareToken,
    slippageBps: slippage.value,
  });
  const actionGuardRef = useRef<ParticipationActionGuard | undefined>(undefined);
  actionGuardRef.current ??= new ParticipationActionGuard(actionIdentity);
  const actionGuard = actionGuardRef.current;
  actionGuard.sync(actionIdentity);

  useEffect(() => {
    actionGuard.activate();
    return () => actionGuard.deactivate();
  }, [actionGuard]);

  const refreshQuote = useCallback(async (): Promise<void> => {
    if (!state || !account || !parsedAmount.value) return;
    const version = ++quoteVersion.current;
    setQuoteLoading(true);
    setQuoteError(undefined);
    try {
      const next = await readBondPurchaseQuote(publicClient, {
        market: state.address,
        buyer: account,
        quoteAmount: parsedAmount.value,
      });
      if (version === quoteVersion.current) setQuote(next);
    } catch (error) {
      if (version === quoteVersion.current) {
        setQuote(undefined);
        setQuoteError(errorMessage(error));
      }
    } finally {
      if (version === quoteVersion.current) setQuoteLoading(false);
    }
  }, [account, parsedAmount.value, publicClient, state]);

  const refreshPositions = useCallback(async (): Promise<void> => {
    if (!state || !account) {
      setPositions([]);
      setPositionsError(undefined);
      return;
    }
    try {
      setPositions(await readBondPositionsForOwner(publicClient, { market: state.address, owner: account }));
      setPositionsError(undefined);
    } catch (error) {
      setPositionsError(errorMessage(error));
    }
  }, [account, publicClient, state]);

  useEffect(() => {
    quoteVersion.current += 1;
    setQuote(undefined);
    setQuoteError(undefined);
    if (!state || !account || !parsedAmount.value) {
      setQuoteLoading(false);
      return;
    }
    const timer = window.setTimeout(() => void refreshQuote(), 250);
    return () => {
      window.clearTimeout(timer);
      quoteVersion.current += 1;
    };
  }, [account, parsedAmount.value, refreshQuote, state]);

  useEffect(() => {
    void refreshPositions();
  }, [refreshPositions]);

  if (!state) {
    return <ReadError>{distribution.error ?? "This bond market did not return readable onchain state."}</ReadError>;
  }

  const now = Math.floor(Date.now() / 1_000);
  const needsApproval = Boolean(quote && quote.quoteAllowance < quote.quoteAmount);
  const blocker = bondPurchaseBlocker({
    account,
    amount: parsedAmount.value,
    amountError: parsedAmount.error,
    boardroomStatus: dashboard.snapshot.status,
    minimumPayout,
    quote,
    quoteError,
    quoteLoading,
    slippageError: slippage.error,
    state,
  });
  const actionId = needsApproval ? "Approve bond quote token" : "Create bond position";
  const actionLabel = needsApproval ? `Approve ${quoteMetadata?.symbol ?? "quote token"}` : "Commit and create position";

  const submitPurchase = async (): Promise<void> => {
    if (!account || !parsedAmount.value || slippage.value === undefined) throw new Error("Enter a valid amount first.");
    const intent: BondMarketActionIntent = {
      account,
      boardroom: state.boardroom,
      boardroomStatus: dashboard.snapshot.status,
      deadlineMinutes,
      factory: state.factory,
      market: state.address,
      quoteAmount: parsedAmount.value,
      quoteToken: state.quoteToken,
      shareToken: state.shareToken,
      slippageBps: slippage.value,
    };
    const expectedIdentity = bondMarketActionIdentity(intent);
    actionGuard.sync(expectedIdentity);
    const actionTicket = actionGuard.capture();
    const prepared = await prepareBondMarketAction(publicClient, {
      expectedAction: needsApproval ? "approve" : "trade",
      intent,
      isCurrent: () => actionGuard.isCurrent(actionTicket),
      onQuote: setQuote,
    });
    await submitTransaction(
      prepared.kind === "approve" ? "Bond quote-token approval" : "Create non-transferable bond position",
      prepared.request,
      { isCurrent: () => actionGuard.isCurrent(actionTicket) },
    );
    if (actionGuard.isCurrent(actionTicket)) await refreshQuote();
  };

  const redeem = async (positionId: bigint): Promise<void> => {
    await submitTransaction("Claim matured bond position", buildBondRedeemTransaction({ market: state.address, positionId }));
    await refreshPositions();
  };

  const finalize = async (): Promise<void> => {
    await submitTransaction("Finalize concluded bond market", buildBondFinalizeTransaction({ market: state.address }));
  };

  return (
    <div>
      <FlowHeading
        eyebrow={state.kind === 1 ? "Liquidity bond" : "Reserve bond"}
        title="Commit now, claim vested project tokens later"
        description="The auction prices a new position at execution. Each position is recorded to this wallet and cannot be transferred, approved, or sold as an NFT."
      />

      <AmountField
        label="Amount to commit"
        symbol={quoteMetadata?.symbol}
        value={amountInput}
        onChange={setAmountInput}
      />

      <QuoteGrid items={[
        {
          label: "Expected payout",
          value: quote ? formatTokenAmount(quote.payout, shareMetadata) : "Enter an amount",
          detail: minimumPayout !== undefined ? `Minimum ${formatTokenAmount(minimumPayout, shareMetadata)}` : undefined,
        },
        {
          label: "Current auction price",
          value: formatTokenAmount(state.currentPrice, quoteMetadata),
          detail: `per whole ${shareMetadata?.symbol ?? "project token"}`,
        },
        { label: "Remaining capacity", value: formatTokenAmount(state.capacity, shareMetadata) },
        { label: "Maximum next payout", value: formatTokenAmount(state.maximumPayout, shareMetadata) },
        { label: "Wallet balance", value: quote ? formatTokenAmount(quote.quoteBalance, quoteMetadata) : "Not loaded" },
        {
          label: "Current allowance",
          value: quote ? formatTokenAmount(quote.quoteAllowance, quoteMetadata) : "Not loaded",
          detail: needsApproval ? "Approval is required before purchase" : quote ? "Ready for this commitment" : undefined,
        },
        { label: "Vesting term", value: durationLabel(state.vestingTerm) },
        { label: "Market conclusion", value: timestampLabel(state.conclusion) },
        { label: "Position ownership", value: "Non-transferable", detail: "Only the recorded wallet receives the payout" },
      ]} />

      {distribution.error ? <ReadError>{distribution.error}</ReadError> : null}
      {quoteError ? <ReadError>{quoteError}</ReadError> : null}
      {!account ? <ConnectWalletPrompt description="Connect to quote a purchase and load this wallet’s bond positions." /> : null}
      {blocker && !quoteError ? <FlowError>{blocker}</FlowError> : null}

      <AdvancedFields summary="Auction protection and contract details">
        <div className="grid gap-4 sm:grid-cols-2">
          <InlineField label="Minimum-payout protection (%)">
            <Input aria-label="Bond slippage" inputMode="decimal" value={slippageInput} onChange={(event) => setSlippageInput(event.target.value)} />
          </InlineField>
          <InlineField label="Wallet deadline (minutes)">
            <Input aria-label="Bond deadline" inputMode="numeric" value={deadlineMinutes} onChange={(event) => setDeadlineMinutes(event.target.value)} />
          </InlineField>
          <div>
            <p className="m-0 text-xs font-semibold text-zinc-400">Bond market</p>
            <div className="mt-2 text-sm"><ContractFact address={state.address} /></div>
          </div>
          <div>
            <p className="m-0 text-xs font-semibold text-zinc-400">Quote asset</p>
            <div className="mt-2 text-sm"><ContractFact address={state.quoteToken} /></div>
          </div>
        </div>
      </AdvancedFields>

      <FlowActions
        actionId={actionId}
        actionLabel={actionLabel}
        disabled={Boolean(blocker || quoteError || !account)}
        onAction={submitPurchase}
        onRefresh={account && parsedAmount.value ? refreshQuote : undefined}
        pendingAction={pendingAction}
        runAction={runAction}
      />

      <section className="mt-8 border-t border-zinc-800 pt-5" aria-label="Your bond positions">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-lime-200/80">Position ledger</p>
            <h4 className="m-0 mt-1 text-base font-semibold text-zinc-100">Your non-transferable positions</h4>
          </div>
          {account ? (
            <ActionButton actionId="Refresh bond positions" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("Refresh bond positions", refreshPositions)}>
              Refresh positions
            </ActionButton>
          ) : null}
        </div>
        {positionsError ? <ReadError>{positionsError}</ReadError> : null}
        {account && positions.length === 0 && !positionsError ? <p className="mt-4 text-sm text-zinc-500">No positions were found for this wallet.</p> : null}
        {positions.length > 0 ? (
          <div className="mt-4 border-y border-zinc-800">
            {[...positions].reverse().map((position) => {
              const claimable = !position.redeemed && now >= position.maturity;
              return (
                <div className="grid gap-3 border-b border-zinc-800 py-4 last:border-b-0 sm:grid-cols-[0.5fr_1fr_1fr_auto] sm:items-center" key={position.positionId.toString()}>
                  <span className="text-xs font-semibold text-zinc-400">#{position.positionId.toString()}</span>
                  <span className="text-sm font-semibold text-zinc-100">{formatTokenAmount(position.payout, shareMetadata)}</span>
                  <span className="text-xs text-zinc-500">{position.redeemed ? "Claimed" : claimable ? "Claimable now" : `Unlocks ${timestampLabel(position.maturity)}`}</span>
                  {!position.redeemed ? (
                    <ActionButton actionId={`Claim bond #${position.positionId.toString()}`} disabled={!claimable} pendingAction={pendingAction} onClick={() => void runAction(`Claim bond #${position.positionId.toString()}`, () => redeem(position.positionId))}>
                      {claimable ? "Claim" : "Locked"}
                    </ActionButton>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      {state.status === 0 && now >= state.conclusion && account ? (
        <div className="mt-5 border-t border-zinc-800 pt-5">
          <p className="m-0 text-sm text-zinc-400">The auction has concluded. Anyone may return its unsold project tokens to the Boardroom.</p>
          <div className="mt-3">
            <ActionButton actionId="Finalize bond market" pendingAction={pendingAction} onClick={() => void runAction("Finalize bond market", finalize)}>
              Finalize market
            </ActionButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function bondMarketState(distribution: BoardroomDistributionSnapshot): BondMarketState | undefined {
  const state = distribution.state;
  return distribution.kind === "bond-market" && state && "live" in state ? state : undefined;
}

function bondPurchaseBlocker(input: {
  account: `0x${string}` | undefined;
  amount: bigint | undefined;
  amountError: string | undefined;
  boardroomStatus: number;
  minimumPayout: bigint | undefined;
  quote: BondPurchaseQuote | undefined;
  quoteError: string | undefined;
  quoteLoading: boolean;
  slippageError: string | undefined;
  state: BondMarketState;
}): string | undefined {
  if (!input.account) return undefined;
  if (input.boardroomStatus !== 0) return "This project is no longer active.";
  if (!input.state.live) {
    const now = Math.floor(Date.now() / 1_000);
    if (input.state.status !== 0) return "This auction is closed; existing positions can still be claimed below.";
    if (now < input.state.startTime) return `This auction opens ${timestampLabel(input.state.startTime)}.`;
    return "This auction is not accepting purchases.";
  }
  if (input.amountError) return input.amountError;
  if (!input.amount || input.amount === 0n) return "Enter an amount to commit.";
  if (input.slippageError) return input.slippageError;
  if (input.quoteLoading) return "Refreshing the auction quote…";
  if (input.quoteError) return undefined;
  if (!input.quote || input.minimumPayout === undefined) return "Refresh a quote before continuing.";
  if (input.quote.payout === 0n) return "This amount is too small to produce a payout.";
  if (input.quote.payout > input.state.capacity) return "This purchase exceeds the remaining capacity.";
  if (input.quote.payout > input.state.maximumPayout) return "This purchase exceeds the auction’s maximum position size.";
  if (input.quote.quoteBalance < input.quote.quoteAmount) return "The connected wallet does not hold enough of the quote asset.";
  return undefined;
}

export async function prepareBondMarketAction(
  client: PublicClient,
  options: PrepareBondMarketActionOptions,
): Promise<PreparedBondMarketAction> {
  const { intent } = options;
  if (intent.boardroomStatus !== 0) throw new Error("This project is no longer active.");
  if (intent.quoteAmount <= 0n) throw new Error("Commitment amount must be greater than zero.");

  const readQuote = options.readQuote ?? readBondPurchaseQuote;
  const quote = await readQuote(client, {
    market: intent.market,
    buyer: intent.account,
    quoteAmount: intent.quoteAmount,
  });
  assertBondQuoteIdentity(quote, intent);
  if (options.isCurrent && !options.isCurrent(intent)) {
    throw new Error("Bond details changed while the quote was refreshing. Review the updated commitment and try again.");
  }
  options.onQuote?.(quote);

  if (!quote.state.live || quote.state.status !== 0) {
    throw new Error("This market stopped accepting purchases while the quote was refreshing.");
  }
  if (quote.payout === 0n || quote.payout > quote.state.capacity || quote.payout > quote.state.maximumPayout) {
    throw new Error("The refreshed payout is no longer available in this market.");
  }
  if (quote.quoteBalance < quote.quoteAmount) {
    throw new Error("The wallet balance no longer covers this commitment.");
  }

  const minimumPayout = minimumWithSlippage(quote.payout, intent.slippageBps);
  const kind: BondMarketActionKind = quote.quoteAllowance < quote.quoteAmount ? "approve" : "trade";
  if (kind !== options.expectedAction) {
    throw new Error(
      kind === "approve"
        ? "The refreshed commitment now requires approval. Review the updated action and try again."
        : "Approval is now sufficient. Review the refreshed bond purchase before submitting it.",
    );
  }

  const nowSeconds = options.clock?.() ?? Math.floor(Date.now() / 1_000);
  return {
    kind,
    minimumPayout,
    quote,
    request: kind === "approve"
      ? buildErc20Approval({ token: quote.state.quoteToken, spender: quote.state.address, amount: quote.quoteAmount })
      : buildBondPurchaseTransaction({
          market: quote.state.address,
          quoteAmount: quote.quoteAmount,
          minimumPayout,
          deadline: transactionDeadline(intent.deadlineMinutes, nowSeconds),
        }),
  };
}

export function bondMarketActionIdentity(input: {
  account: Address | undefined;
  boardroom: Address | undefined;
  boardroomStatus: number;
  deadlineMinutes: string;
  factory: Address | undefined;
  market: Address | undefined;
  quoteAmount: bigint | undefined;
  quoteToken: Address | undefined;
  shareToken: Address | undefined;
  slippageBps: bigint | undefined;
}): string {
  return [
    input.account?.toLowerCase() ?? "",
    input.boardroom?.toLowerCase() ?? "",
    input.boardroomStatus.toString(),
    input.deadlineMinutes,
    input.factory?.toLowerCase() ?? "",
    input.market?.toLowerCase() ?? "",
    input.quoteAmount?.toString() ?? "",
    input.quoteToken?.toLowerCase() ?? "",
    input.shareToken?.toLowerCase() ?? "",
    input.slippageBps?.toString() ?? "",
  ].join(":");
}

function assertBondQuoteIdentity(quote: BondPurchaseQuote, intent: BondMarketActionIntent): void {
  if (quote.buyer.toLowerCase() !== intent.account.toLowerCase()
    || quote.state.address.toLowerCase() !== intent.market.toLowerCase()
    || quote.state.factory.toLowerCase() !== intent.factory.toLowerCase()
    || quote.state.boardroom.toLowerCase() !== intent.boardroom.toLowerCase()
    || quote.state.shareToken.toLowerCase() !== intent.shareToken.toLowerCase()
    || quote.state.quoteToken.toLowerCase() !== intent.quoteToken.toLowerCase()
    || quote.quoteAmount !== intent.quoteAmount) {
    throw new Error("The refreshed quote does not match this wallet, market, or exact commitment amount.");
  }
}

function safeSlippage(value: string): { error?: string; value?: bigint } {
  try {
    return { value: parseSlippageBps(value) };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function timestampLabel(timestamp: number): string {
  return new Date(timestamp * 1_000).toLocaleString();
}

function durationLabel(seconds: number): string {
  if (seconds % 86_400 === 0) return `${(seconds / 86_400).toString()} day${seconds === 86_400 ? "" : "s"}`;
  if (seconds % 3_600 === 0) return `${(seconds / 3_600).toString()} hour${seconds === 3_600 ? "" : "s"}`;
  return `${seconds.toLocaleString()} seconds`;
}
