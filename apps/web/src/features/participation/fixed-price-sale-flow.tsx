import {
  buildErc20Approval,
  buildFixedPriceSaleBuyTransaction,
  readFixedPriceSaleParticipationQuote,
  type Address,
  type FixedPriceSaleParticipationQuote,
  type FixedPriceSaleState,
} from "@pledge.cash/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress, type PublicClient } from "viem";
import { Input } from "../../components/ui/input";
import { errorMessage } from "../../lib/forms";
import { formatTokenAmount, parseTokenAmountInput } from "../../lib/token-amounts";
import type { BoardroomDistributionSnapshot } from "../../lib/types";
import { HYPEREVM_TESTNET_CHAIN_ID } from "../../lib/x402-router";
import { ConnectWalletPrompt } from "../wallet/connect-wallet-prompt";
import { HyperliquidPaymentAction } from "../x402";
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

type FixedPriceSaleFlowProps = ParticipationFlowContext & {
  distribution: BoardroomDistributionSnapshot;
};

type ParsedAmount = { error?: string; value?: bigint };
export type FixedPriceSaleActionKind = "approve" | "trade";

export type FixedPriceSaleActionIntent = {
  account: Address;
  boardroom: Address;
  boardroomStatus: number;
  deadlineMinutes: string;
  factory: Address;
  paymentToken: Address;
  recipient: Address;
  sale: Address;
  shareAmount: bigint;
  shareToken: Address;
  slippageBps: bigint;
};

export type PreparedFixedPriceSaleAction = {
  kind: FixedPriceSaleActionKind;
  maxPayment: bigint;
  quote: FixedPriceSaleParticipationQuote;
  request: Record<string, unknown>;
};

type PrepareFixedPriceSaleActionOptions = {
  clock?: (() => number) | undefined;
  expectedAction: FixedPriceSaleActionKind;
  intent: FixedPriceSaleActionIntent;
  isCurrent?: ((intent: FixedPriceSaleActionIntent) => boolean) | undefined;
  onQuote?: ((quote: FixedPriceSaleParticipationQuote) => void) | undefined;
  readQuote?: typeof readFixedPriceSaleParticipationQuote | undefined;
};

export function FixedPriceSaleFlow({
  account,
  chainId,
  dashboard,
  distribution,
  hyperliquid,
  pendingAction,
  publicClient,
  runAction,
  submitTransaction,
}: FixedPriceSaleFlowProps): React.JSX.Element {
  const state = fixedPriceSaleState(distribution);
  const shareMetadata = distribution.shareTokenMetadata;
  const paymentMetadata = distribution.paymentTokenMetadata;
  const [amountInput, setAmountInput] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [slippageInput, setSlippageInput] = useState("0");
  const [deadlineMinutes, setDeadlineMinutes] = useState("20");
  const [quote, setQuote] = useState<FixedPriceSaleParticipationQuote>();
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
  const actionIdentity = fixedPriceSaleActionIdentity({
    account,
    boardroom: state?.boardroom,
    boardroomStatus: dashboard.snapshot.status,
    deadlineMinutes,
    factory: state?.factory,
    paymentToken: state?.paymentToken,
    recipient,
    sale: state?.address,
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
      const next = await readFixedPriceSaleParticipationQuote(publicClient, {
        sale: state.address,
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
    return (
      <ReadError>
        {distribution.error ?? "This fixed-price sale did not return a readable onchain state."}
      </ReadError>
    );
  }

  const blocker = fixedPriceBlocker({
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
  const actionId = needsApproval ? "Approve fixed-price payment" : "Buy fixed-price shares";
  const actionLabel = needsApproval ? `Approve ${paymentMetadata?.symbol ?? "payment token"}` : "Buy project tokens";
  const hyperliquidBlocker = fixedPriceHyperliquidBlocker({
    account,
    amount: parsedAmount.value,
    amountError: parsedAmount.error,
    boardroomStatus: dashboard.snapshot.status,
    chainId,
    destinationUsdc: hyperliquid?.config.hyperevmUsdc,
    distributionError: distribution.error,
    recipient,
    recipientError,
    slippageBps: slippage.value,
    slippageError: slippage.error,
    state,
  });
  const hyperliquidRequest = hyperliquid && !hyperliquidBlocker
    && account && recipient && parsedAmount.value !== undefined
    && slippage.value !== undefined
    ? {
        boardroom: state.boardroom,
        chainId: HYPEREVM_TESTNET_CHAIN_ID,
        kind: "fixed_price_sale" as const,
        maxSlippageBps: Number(slippage.value),
        payer: account,
        recipient,
        refundAddress: account,
        sale: state.address,
        shareAmount: parsedAmount.value.toString(),
      }
    : undefined;

  const submitAction = async (): Promise<void> => {
    if (!account || !quote || maxPayment === undefined || !recipient || parsedAmount.value === undefined || slippage.value === undefined) {
      throw new Error("Refresh a valid quote before continuing.");
    }
    const intent: FixedPriceSaleActionIntent = {
      account,
      boardroom: state.boardroom,
      boardroomStatus: dashboard.snapshot.status,
      deadlineMinutes,
      factory: state.factory,
      paymentToken: state.paymentToken,
      recipient,
      sale: state.address,
      shareAmount: parsedAmount.value,
      shareToken: state.shareToken,
      slippageBps: slippage.value,
    };
    const expectedIdentity = fixedPriceSaleActionIdentity(intent);
    actionGuard.sync(expectedIdentity);
    const actionTicket = actionGuard.capture();
    const prepared = await prepareFixedPriceSaleAction(publicClient, {
      expectedAction: needsApproval ? "approve" : "trade",
      intent,
      isCurrent: () => actionGuard.isCurrent(actionTicket),
      onQuote: setQuote,
    });
    await submitTransaction(
      prepared.kind === "approve" ? "Fixed-price payment approval" : "Fixed-price purchase",
      prepared.request,
      { isCurrent: () => actionGuard.isCurrent(actionTicket) },
    );
    if (actionGuard.isCurrent(actionTicket)) await refreshQuote();
  };

  return (
    <div className="min-w-0">
      <FlowHeading
        eyebrow="Known unit price"
        title="Buy from the fixed-price sale"
        description="Enter the number of project tokens you want. The live quote includes this wallet’s purchase limit, payment balance, and allowance."
      />
      <AmountField
        label="Project tokens to receive"
        onChange={setAmountInput}
        symbol={shareMetadata?.symbol}
        value={amountInput}
      />
      <QuoteGrid
        items={[
          {
            label: "Expected receive",
            value: parsedAmount.value === undefined ? "Enter an amount" : formatTokenAmount(parsedAmount.value, shareMetadata),
          },
          {
            label: "Expected payment",
            value: quote ? formatTokenAmount(quote.paymentAmount, paymentMetadata) : quoteLoading ? "Reading quote…" : "Not quoted",
          },
          {
            label: "Maximum payment",
            value: maxPayment === undefined ? "Not quoted" : formatTokenAmount(maxPayment, paymentMetadata),
            detail: `${slippageInput}% price protection`,
          },
          {
            label: "Wallet balance",
            value: quote ? formatTokenAmount(quote.paymentBalance, paymentMetadata) : "Not loaded",
          },
          {
            label: "Current allowance",
            value: quote ? formatTokenAmount(quote.paymentAllowance, paymentMetadata) : "Not loaded",
            detail: needsApproval ? "Approval is required before purchase" : quote ? "Ready for this quote" : undefined,
          },
          {
            label: "Remaining wallet limit",
            value: quote ? formatTokenAmount(quote.remainingBuyerCapacity, shareMetadata) : "Not loaded",
          },
        ]}
      />

      {distribution.error ? <ReadError>{distribution.error}</ReadError> : null}
      {quoteError ? <ReadError>{quoteError}</ReadError> : null}
      {!account ? (
        <ConnectWalletPrompt description="This sale quote depends on the connected wallet’s purchase limit, payment balance, and allowance." />
      ) : null}
      {blocker && !quoteError ? <FlowError>{blocker}</FlowError> : null}

      <AdvancedFields summary="Advanced purchase settings">
        <div className="grid gap-4 sm:grid-cols-2">
          <InlineField label="Recipient">
            <Input
              aria-label="Fixed-price recipient"
              placeholder={account ?? "0x…"}
              value={recipientInput}
              onChange={(event) => setRecipientInput(event.target.value)}
            />
          </InlineField>
          <InlineField label="Price protection (%)">
            <Input
              aria-label="Fixed-price slippage"
              inputMode="decimal"
              value={slippageInput}
              onChange={(event) => setSlippageInput(event.target.value)}
            />
          </InlineField>
          <InlineField label="Wallet deadline (minutes)">
            <Input
              aria-label="Fixed-price deadline"
              inputMode="numeric"
              value={deadlineMinutes}
              onChange={(event) => setDeadlineMinutes(event.target.value)}
            />
          </InlineField>
          <div>
            <p className="m-0 text-xs font-semibold text-zinc-400">Sale contract</p>
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
      {hyperliquid ? (
        <HyperliquidPaymentAction
          checkout={hyperliquid}
          disabledReason={hyperliquidBlocker}
          expectations={{
            inputToken: state.paymentToken,
            outputToken: state.shareToken,
            target: state.address,
          }}
          kind="fixed_price_sale"
          output={{
            decimals: shareMetadata?.decimals,
            symbol: shareMetadata?.symbol,
          }}
          payer={account}
          pendingAction={pendingAction}
          request={hyperliquidRequest}
          runAction={runAction}
        />
      ) : null}
    </div>
  );
}

export async function prepareFixedPriceSaleAction(
  client: PublicClient,
  options: PrepareFixedPriceSaleActionOptions,
): Promise<PreparedFixedPriceSaleAction> {
  const { intent } = options;
  if (intent.boardroomStatus !== 0) throw new Error("This project is no longer active.");
  if (intent.shareAmount <= 0n) throw new Error("Purchase amount must be greater than zero.");

  const readQuote = options.readQuote ?? readFixedPriceSaleParticipationQuote;
  const quote = await readQuote(client, {
    sale: intent.sale,
    buyer: intent.account,
    shareAmount: intent.shareAmount,
  });
  assertFixedPriceQuoteIdentity(quote, intent);
  if (options.isCurrent && !options.isCurrent(intent)) {
    throw new Error("Purchase details changed while the quote was refreshing. Review the updated order and try again.");
  }
  options.onQuote?.(quote);

  const nowSeconds = options.clock?.() ?? Math.floor(Date.now() / 1_000);
  if (quote.state.saleStatus !== 0 || quote.state.closed) throw new Error("This sale closed while the quote was refreshing.");
  const window = unixWindowStatus(quote.state.startTime, quote.state.endTime, nowSeconds);
  if (window !== "open") throw new Error(window === "ended" ? "This sale window has ended." : "This sale has not started yet.");
  if (intent.shareAmount > quote.state.remainingShares || intent.shareAmount > quote.remainingBuyerCapacity) {
    throw new Error("The requested amount is no longer available to this wallet.");
  }

  const maxPayment = maximumWithSlippage(quote.paymentAmount, intent.slippageBps);
  if (quote.paymentBalance < maxPayment) throw new Error("The wallet balance no longer covers the refreshed maximum payment.");
  const kind: FixedPriceSaleActionKind = quote.paymentAllowance < maxPayment ? "approve" : "trade";
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
      : buildFixedPriceSaleBuyTransaction({
          sale: quote.state.address,
          shareAmount: intent.shareAmount,
          recipient: intent.recipient,
          maxPayment,
          deadline: transactionDeadline(intent.deadlineMinutes, nowSeconds),
        }),
  };
}

export function fixedPriceSaleActionIdentity(input: {
  account: Address | undefined;
  boardroom: Address | undefined;
  boardroomStatus: number;
  deadlineMinutes: string;
  factory: Address | undefined;
  paymentToken: Address | undefined;
  recipient: Address | undefined;
  sale: Address | undefined;
  shareAmount: bigint | undefined;
  shareToken: Address | undefined;
  slippageBps: bigint | undefined;
}): string {
  return [
    input.account?.toLowerCase() ?? "",
    input.boardroom?.toLowerCase() ?? "",
    input.boardroomStatus.toString(),
    input.deadlineMinutes,
    input.factory?.toLowerCase() ?? "",
    input.paymentToken?.toLowerCase() ?? "",
    input.recipient?.toLowerCase() ?? "",
    input.sale?.toLowerCase() ?? "",
    input.shareAmount?.toString() ?? "",
    input.shareToken?.toLowerCase() ?? "",
    input.slippageBps?.toString() ?? "",
  ].join(":");
}

function assertFixedPriceQuoteIdentity(
  quote: FixedPriceSaleParticipationQuote,
  intent: FixedPriceSaleActionIntent,
): void {
  const matches = quote.shareAmount === intent.shareAmount
    && sameAddress(quote.buyer, intent.account)
    && sameAddress(quote.state.address, intent.sale)
    && sameAddress(quote.state.factory, intent.factory)
    && sameAddress(quote.state.boardroom, intent.boardroom)
    && sameAddress(quote.state.shareToken, intent.shareToken)
    && sameAddress(quote.state.paymentToken, intent.paymentToken);
  if (!matches) throw new Error("The refreshed quote does not match this wallet, sale, or exact purchase amount.");
}

function fixedPriceSaleState(distribution: BoardroomDistributionSnapshot): FixedPriceSaleState | undefined {
  const state = distribution.state;
  return distribution.kind === "fixed-price-sale" && state && "price" in state ? state : undefined;
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

function fixedPriceBlocker(input: {
  account: Address | undefined;
  amount: bigint | undefined;
  amountError: string | undefined;
  boardroomStatus: number;
  maxPayment: bigint | undefined;
  quote: FixedPriceSaleParticipationQuote | undefined;
  quoteError: string | undefined;
  quoteLoading: boolean;
  recipient: Address | undefined;
  recipientError: string | undefined;
  slippageError: string | undefined;
  state: FixedPriceSaleState;
}): string | undefined {
  if (input.boardroomStatus !== 0) return "This project is no longer active, so its sale cannot accept purchases.";
  if (input.state.saleStatus !== 0 || input.state.closed) return "This sale is closed.";
  const window = unixWindowStatus(input.state.startTime, input.state.endTime);
  if (window === "not-started") return "This sale has not started yet.";
  if (window === "ended") return "This sale window has ended.";
  if (!input.account) return undefined;
  if (input.amountError) return input.amountError;
  if (input.amount === undefined || input.amount === 0n) return "Enter the number of project tokens you want to receive.";
  if (input.amount > input.state.remainingShares) return "That amount is larger than the sale’s remaining inventory.";
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

export function fixedPriceHyperliquidBlocker(input: {
  account: Address | undefined;
  amount: bigint | undefined;
  amountError: string | undefined;
  boardroomStatus: number;
  chainId: number;
  destinationUsdc: Address | undefined;
  distributionError: string | undefined;
  recipient: Address | undefined;
  recipientError: string | undefined;
  slippageBps: bigint | undefined;
  slippageError: string | undefined;
  state: FixedPriceSaleState;
}): string | undefined {
  if (!input.account) return "Connect the wallet that will pay from HyperCore.";
  if (input.chainId !== HYPEREVM_TESTNET_CHAIN_ID) {
    return "The Hyperliquid payment rail is available on HyperEVM testnet only.";
  }
  if (input.distributionError) return "The sale’s canonical state could not be verified.";
  if (
    !input.destinationUsdc
    || !sameAddress(input.destinationUsdc, input.state.paymentToken)
  ) {
    return "Hyperliquid v1 requires the configured HyperEVM USDC payment token.";
  }
  if (input.boardroomStatus !== 0) return "This project is no longer active.";
  if (input.state.saleStatus !== 0 || input.state.closed) return "This sale is closed.";
  const window = unixWindowStatus(input.state.startTime, input.state.endTime);
  if (window === "not-started") return "This sale has not started yet.";
  if (window === "ended") return "This sale window has ended.";
  if (input.state.maxPerBuyer !== 0n) {
    return "Buyer-capped fixed-price sales are not supported by the Hyperliquid v1 rail.";
  }
  if (input.amountError) return input.amountError;
  if (input.amount === undefined || input.amount === 0n) {
    return "Enter the number of project tokens you want to receive.";
  }
  if (input.amount > input.state.remainingShares) {
    return "That amount is larger than the sale’s remaining inventory.";
  }
  if (input.recipientError) return input.recipientError;
  if (!input.recipient || !sameAddress(input.recipient, input.account)) {
    return "Payer, recipient, and refund address must be the connected wallet in v1.";
  }
  if (input.slippageError) return input.slippageError;
  if (input.slippageBps === undefined || input.slippageBps > 1_000n) {
    return "Hyperliquid v1 price protection must be between 0% and 10%.";
  }
  return undefined;
}
