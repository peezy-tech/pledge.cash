import {
  buildErc20Approval,
  buildFixedPriceSaleBuyTransaction,
  readFixedPriceSaleParticipationQuote,
  type Address,
  type FixedPriceSaleParticipationQuote,
  type FixedPriceSaleState,
} from "@pledge.cash/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress } from "viem";
import { Input } from "../../components/ui/input";
import { errorMessage } from "../../lib/forms";
import { formatTokenAmount, parseTokenAmountInput } from "../../lib/token-amounts";
import type { BoardroomDistributionSnapshot } from "../../lib/types";
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

export function FixedPriceSaleFlow({
  account,
  dashboard,
  distribution,
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

  const submitAction = async (): Promise<void> => {
    if (!quote || maxPayment === undefined || !recipient || parsedAmount.value === undefined) {
      throw new Error("Refresh a valid quote before continuing.");
    }
    if (needsApproval) {
      await submitTransaction("Fixed-price payment approval", buildErc20Approval({
        token: state.paymentToken,
        spender: state.address,
        amount: maxPayment,
      }));
    } else {
      await submitTransaction("Fixed-price purchase", buildFixedPriceSaleBuyTransaction({
        sale: state.address,
        shareAmount: parsedAmount.value,
        recipient,
        maxPayment,
        deadline: transactionDeadline(deadlineMinutes),
      }));
    }
    await refreshQuote();
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
    </div>
  );
}

function fixedPriceSaleState(distribution: BoardroomDistributionSnapshot): FixedPriceSaleState | undefined {
  const state = distribution.state;
  return distribution.kind === "fixed-price-sale" && state && "saleStatus" in state ? state : undefined;
}

function resolveRecipient(value: string, account: Address | undefined): Address | undefined {
  const normalized = value.trim();
  if (!normalized) return account;
  return isAddress(normalized) ? getAddress(normalized) : undefined;
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
