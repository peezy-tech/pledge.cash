import {
  buildDutchAuctionBuyTransaction,
  buildErc20Approval,
  readDutchAuctionParticipationQuote,
  type Address,
  type DutchAuctionParticipationQuote,
  type DutchAuctionState,
} from "@pledge.cash/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress, type PublicClient } from "viem";
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
import { maximumWithSlippage, parseSlippageBps, transactionDeadline, unixWindowStatus } from "./participation-math";
import type { ParticipationFlowContext } from "./types";

type DutchAuctionFlowProps = ParticipationFlowContext & {
  distribution: BoardroomDistributionSnapshot;
};

type ParsedAmount = { error?: string; value?: bigint };
export type DutchAuctionActionKind = "approve" | "trade";

export type DutchAuctionActionIntent = {
  account: Address;
  auction: Address;
  boardroom: Address;
  boardroomStatus: number;
  deadlineMinutes: string;
  factory: Address;
  paymentToken: Address;
  recipient: Address;
  shareAmount: bigint;
  shareToken: Address;
  slippageBps: bigint;
};

export type PreparedDutchAuctionAction = {
  kind: DutchAuctionActionKind;
  maxPayment: bigint;
  quote: DutchAuctionParticipationQuote;
  request: Record<string, unknown>;
};

type PrepareDutchAuctionActionOptions = {
  clock?: (() => number) | undefined;
  expectedAction: DutchAuctionActionKind;
  intent: DutchAuctionActionIntent;
  isCurrent?: ((intent: DutchAuctionActionIntent) => boolean) | undefined;
  onQuote?: ((quote: DutchAuctionParticipationQuote) => void) | undefined;
  readQuote?: typeof readDutchAuctionParticipationQuote | undefined;
};

export function DutchAuctionFlow({
  account,
  dashboard,
  distribution,
  pendingAction,
  publicClient,
  runAction,
  submitTransaction,
}: DutchAuctionFlowProps): React.JSX.Element {
  const state = dutchAuctionState(distribution);
  const shareMetadata = distribution.shareTokenMetadata;
  const paymentMetadata = distribution.paymentTokenMetadata;
  const [amountInput, setAmountInput] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [slippageInput, setSlippageInput] = useState("0.5");
  const [deadlineMinutes, setDeadlineMinutes] = useState("20");
  const [quote, setQuote] = useState<DutchAuctionParticipationQuote>();
  const [quoteError, setQuoteError] = useState<string>();
  const [quoteLoading, setQuoteLoading] = useState(false);
  const requestVersion = useRef(0);

  const parsedAmount = useMemo<ParsedAmount>(() => {
    if (!amountInput.trim()) return {};
    if (!shareMetadata) return { error: "Project token decimals are unavailable." };
    try {
      return { value: parseTokenAmountInput(amountInput, shareMetadata, "Purchase amount") };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [amountInput, shareMetadata]);

  const slippage = safeSlippage(slippageInput);
  const recipient = resolveRecipient(recipientInput, account);
  const recipientError = recipientInput.trim() && !recipient ? "Recipient must be a valid address." : undefined;
  const maxPayment = quote && slippage.value !== undefined
    ? maximumWithSlippage(quote.paymentAmount, slippage.value)
    : undefined;
  const actionIdentity = dutchAuctionActionIdentity({
    account,
    auction: state?.address,
    boardroom: state?.boardroom,
    boardroomStatus: dashboard.snapshot.status,
    deadlineMinutes,
    factory: state?.factory,
    paymentToken: state?.paymentToken,
    recipient,
    shareAmount: parsedAmount.value,
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
    if (!state || !account || parsedAmount.value === undefined || parsedAmount.value === 0n) return;
    const version = ++requestVersion.current;
    setQuoteLoading(true);
    setQuoteError(undefined);
    try {
      const next = await readDutchAuctionParticipationQuote(publicClient, {
        auction: state.address,
        buyer: account,
        shareAmount: parsedAmount.value,
      });
      if (requestVersion.current === version) setQuote(next);
    } catch (error) {
      if (requestVersion.current !== version) return;
      setQuote(undefined);
      setQuoteError(errorMessage(error));
    } finally {
      if (requestVersion.current === version) setQuoteLoading(false);
    }
  }, [account, parsedAmount.value, publicClient, state]);

  useEffect(() => {
    requestVersion.current += 1;
    setQuote(undefined);
    setQuoteError(undefined);
    if (!state || !account || parsedAmount.value === undefined || parsedAmount.value === 0n) {
      setQuoteLoading(false);
      return;
    }
    const timer = window.setTimeout(() => void refreshQuote(), 250);
    return () => {
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [account, parsedAmount.value, refreshQuote, state]);

  if (!state) {
    return <ReadError>{distribution.error ?? "This Dutch auction did not return a readable onchain state."}</ReadError>;
  }

  const blocker = dutchAuctionBlocker({
    account,
    amount: parsedAmount.value,
    amountError: parsedAmount.error,
    boardroomStatus: dashboard.snapshot.status,
    maxPayment,
    quote,
    quoteError,
    quoteLoading,
    recipient,
    recipientError,
    slippageError: slippage.error,
    state,
  });
  const needsApproval = Boolean(quote && maxPayment !== undefined && quote.paymentAllowance < maxPayment);
  const actionId = needsApproval ? "Approve Dutch auction payment" : "Buy Dutch auction shares";
  const actionLabel = needsApproval ? `Approve ${paymentMetadata?.symbol ?? "payment token"}` : "Buy project tokens";

  const submitAction = async (): Promise<void> => {
    if (!account || !quote || maxPayment === undefined || !recipient || parsedAmount.value === undefined || slippage.value === undefined) {
      throw new Error("Refresh a valid quote before continuing.");
    }
    const intent: DutchAuctionActionIntent = {
      account,
      auction: state.address,
      boardroom: state.boardroom,
      boardroomStatus: dashboard.snapshot.status,
      deadlineMinutes,
      factory: state.factory,
      paymentToken: state.paymentToken,
      recipient,
      shareAmount: parsedAmount.value,
      shareToken: state.shareToken,
      slippageBps: slippage.value,
    };
    const expectedIdentity = dutchAuctionActionIdentity(intent);
    actionGuard.sync(expectedIdentity);
    const actionTicket = actionGuard.capture();
    const prepared = await prepareDutchAuctionAction(publicClient, {
      expectedAction: needsApproval ? "approve" : "trade",
      intent,
      isCurrent: () => actionGuard.isCurrent(actionTicket),
      onQuote: setQuote,
    });
    await submitTransaction(
      prepared.kind === "approve" ? "Dutch auction payment approval" : "Dutch auction purchase",
      prepared.request,
      { isCurrent: () => actionGuard.isCurrent(actionTicket) },
    );
    if (actionGuard.isCurrent(actionTicket)) await refreshQuote();
  };

  return (
    <div className="min-w-0">
      <FlowHeading
        eyebrow="Descending live price"
        title="Buy from the Dutch auction"
        description="Enter the number of project tokens you want. The price descends linearly until the transaction executes; your maximum payment protects the order."
      />
      <AmountField
        label="Project tokens to receive"
        onChange={setAmountInput}
        symbol={shareMetadata?.symbol}
        value={amountInput}
      />
      <QuoteGrid
        items={[
          { label: "Expected receive", value: parsedAmount.value === undefined ? "Enter an amount" : formatTokenAmount(parsedAmount.value, shareMetadata) },
          { label: "Live unit price", value: quote ? formatTokenAmount(quote.state.currentPrice, paymentMetadata) : quoteLoading ? "Reading quote…" : "Not quoted" },
          { label: "Expected payment", value: quote ? formatTokenAmount(quote.paymentAmount, paymentMetadata) : quoteLoading ? "Reading quote…" : "Not quoted" },
          { label: "Maximum payment", value: maxPayment === undefined ? "Not quoted" : formatTokenAmount(maxPayment, paymentMetadata), detail: `${slippageInput}% price protection` },
          { label: "Wallet balance", value: quote ? formatTokenAmount(quote.paymentBalance, paymentMetadata) : "Not loaded" },
          { label: "Remaining wallet limit", value: quote ? formatTokenAmount(quote.remainingBuyerCapacity, shareMetadata) : "Not loaded" },
        ]}
      />

      {distribution.error ? <ReadError>{distribution.error}</ReadError> : null}
      {quoteError ? <ReadError>{quoteError}</ReadError> : null}
      {!account ? <ConnectWalletPrompt description="This auction quote depends on the connected wallet’s limit, payment balance, and allowance." /> : null}
      {blocker && !quoteError ? <FlowError>{blocker}</FlowError> : null}

      <AdvancedFields summary="Advanced purchase settings">
        <div className="grid gap-4 sm:grid-cols-2">
          <InlineField label="Recipient">
            <Input aria-label="Dutch auction recipient" placeholder={account ?? "0x…"} value={recipientInput} onChange={(event) => setRecipientInput(event.target.value)} />
          </InlineField>
          <InlineField label="Price protection (%)">
            <Input aria-label="Dutch auction slippage" inputMode="decimal" value={slippageInput} onChange={(event) => setSlippageInput(event.target.value)} />
          </InlineField>
          <InlineField label="Wallet deadline (minutes)">
            <Input aria-label="Dutch auction deadline" inputMode="numeric" value={deadlineMinutes} onChange={(event) => setDeadlineMinutes(event.target.value)} />
          </InlineField>
          <div>
            <p className="m-0 text-xs font-semibold text-zinc-400">Auction contract</p>
            <div className="mt-2 text-sm"><ContractFact address={state.address} /></div>
          </div>
        </div>
      </AdvancedFields>

      <FlowActions
        actionId={actionId}
        actionLabel={actionLabel}
        disabled={Boolean(blocker || quoteError || !account)}
        onAction={submitAction}
        onRefresh={account && parsedAmount.value ? refreshQuote : undefined}
        pendingAction={pendingAction}
        runAction={runAction}
      />
    </div>
  );
}

export async function prepareDutchAuctionAction(
  client: PublicClient,
  options: PrepareDutchAuctionActionOptions,
): Promise<PreparedDutchAuctionAction> {
  const { intent } = options;
  if (intent.boardroomStatus !== 0) throw new Error("This project is no longer active.");
  if (intent.shareAmount <= 0n) throw new Error("Purchase amount must be greater than zero.");

  const readQuote = options.readQuote ?? readDutchAuctionParticipationQuote;
  const quote = await readQuote(client, {
    auction: intent.auction,
    buyer: intent.account,
    shareAmount: intent.shareAmount,
  });
  assertDutchAuctionQuoteIdentity(quote, intent);
  if (options.isCurrent && !options.isCurrent(intent)) {
    throw new Error("Purchase details changed while the quote was refreshing. Review the updated order and try again.");
  }
  options.onQuote?.(quote);

  const nowSeconds = options.clock?.() ?? Math.floor(Date.now() / 1_000);
  if (quote.state.saleStatus !== 0 || quote.state.closed) throw new Error("This auction closed while the quote was refreshing.");
  const window = unixWindowStatus(quote.state.startTime, quote.state.endTime, nowSeconds, true);
  if (window !== "open") throw new Error(window === "ended" ? "This auction window has ended." : "This auction has not started yet.");
  if (intent.shareAmount > quote.state.remainingShares || intent.shareAmount > quote.remainingBuyerCapacity) {
    throw new Error("The requested amount is no longer available to this wallet.");
  }

  const maxPayment = maximumWithSlippage(quote.paymentAmount, intent.slippageBps);
  if (quote.paymentBalance < maxPayment) throw new Error("The wallet balance no longer covers the refreshed maximum payment.");
  const kind: DutchAuctionActionKind = quote.paymentAllowance < maxPayment ? "approve" : "trade";
  if (kind !== options.expectedAction) {
    throw new Error(
      kind === "approve"
        ? "The refreshed order now requires approval. Review the updated action and try again."
        : "Approval is now sufficient. Review the refreshed purchase before submitting it.",
    );
  }

  return {
    kind,
    maxPayment,
    quote,
    request: kind === "approve"
      ? buildErc20Approval({ token: quote.state.paymentToken, spender: quote.state.address, amount: maxPayment })
      : buildDutchAuctionBuyTransaction({
          auction: quote.state.address,
          shareAmount: intent.shareAmount,
          recipient: intent.recipient,
          maxPayment,
          deadline: transactionDeadline(intent.deadlineMinutes, nowSeconds),
        }),
  };
}

export function dutchAuctionActionIdentity(input: {
  account: Address | undefined;
  auction: Address | undefined;
  boardroom: Address | undefined;
  boardroomStatus: number;
  deadlineMinutes: string;
  factory: Address | undefined;
  paymentToken: Address | undefined;
  recipient: Address | undefined;
  shareAmount: bigint | undefined;
  shareToken: Address | undefined;
  slippageBps: bigint | undefined;
}): string {
  return [
    input.account?.toLowerCase() ?? "",
    input.auction?.toLowerCase() ?? "",
    input.boardroom?.toLowerCase() ?? "",
    input.boardroomStatus.toString(),
    input.deadlineMinutes,
    input.factory?.toLowerCase() ?? "",
    input.paymentToken?.toLowerCase() ?? "",
    input.recipient?.toLowerCase() ?? "",
    input.shareAmount?.toString() ?? "",
    input.shareToken?.toLowerCase() ?? "",
    input.slippageBps?.toString() ?? "",
  ].join(":");
}

function assertDutchAuctionQuoteIdentity(
  quote: DutchAuctionParticipationQuote,
  intent: DutchAuctionActionIntent,
): void {
  const matches = quote.shareAmount === intent.shareAmount
    && sameAddress(quote.buyer, intent.account)
    && sameAddress(quote.state.address, intent.auction)
    && sameAddress(quote.state.factory, intent.factory)
    && sameAddress(quote.state.boardroom, intent.boardroom)
    && sameAddress(quote.state.shareToken, intent.shareToken)
    && sameAddress(quote.state.paymentToken, intent.paymentToken);
  if (!matches) throw new Error("The refreshed quote does not match this wallet, auction, or exact purchase amount.");
}

function dutchAuctionState(distribution: BoardroomDistributionSnapshot): DutchAuctionState | undefined {
  const state = distribution.state;
  return distribution.kind === "dutch-auction" && state && "startPrice" in state ? state : undefined;
}

function resolveRecipient(value: string, account: Address | undefined): Address | undefined {
  const normalized = value.trim();
  if (!normalized) return account;
  return isAddress(normalized) ? getAddress(normalized) : undefined;
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function safeSlippage(value: string): { error?: string; value?: bigint } {
  try {
    return { value: parseSlippageBps(value) };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function dutchAuctionBlocker(input: {
  account: Address | undefined;
  amount: bigint | undefined;
  amountError: string | undefined;
  boardroomStatus: number;
  maxPayment: bigint | undefined;
  quote: DutchAuctionParticipationQuote | undefined;
  quoteError: string | undefined;
  quoteLoading: boolean;
  recipient: Address | undefined;
  recipientError: string | undefined;
  slippageError: string | undefined;
  state: DutchAuctionState;
}): string | undefined {
  if (input.boardroomStatus !== 0) return "This project is no longer active, so its auction cannot accept purchases.";
  if (input.state.saleStatus !== 0 || input.state.closed) return "This auction is closed.";
  const window = unixWindowStatus(input.state.startTime, input.state.endTime, undefined, true);
  if (window === "not-started") return "This auction has not started yet.";
  if (window === "ended") return "This auction window has ended. Anyone may finalize it.";
  if (!input.account) return undefined;
  if (input.amountError) return input.amountError;
  if (input.amount === undefined || input.amount === 0n) return "Enter the number of project tokens you want to receive.";
  if (input.amount > input.state.remainingShares) return "That amount is larger than the auction’s remaining inventory.";
  if (input.recipientError) return input.recipientError;
  if (!input.recipient) return "A recipient is required.";
  if (input.slippageError) return input.slippageError;
  if (input.quoteLoading) return "Reading the account-specific quote…";
  if (input.quoteError) return input.quoteError;
  if (!input.quote || input.maxPayment === undefined) return "A current quote is required before purchase.";
  if (input.amount > input.quote.remainingBuyerCapacity) return "This amount exceeds the wallet’s remaining purchase limit.";
  if (input.quote.paymentBalance < input.maxPayment) return "The wallet balance does not cover the maximum payment.";
  return undefined;
}
