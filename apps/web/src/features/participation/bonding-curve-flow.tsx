import {
  buildErc20Approval,
  buildMigratingBondingCurveBuyTransaction,
  buildMigratingBondingCurveSellTransaction,
  readMigratingBondingCurveBuyQuote,
  readMigratingBondingCurveSellQuote,
  type Address,
  type MigratingBondingCurveBuyQuote,
  type MigratingBondingCurveSellQuote,
  type MigratingBondingCurveState,
} from "@pledge.cash/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress, type PublicClient } from "viem";
import { Input } from "../../components/ui/input";
import { errorMessage } from "../../lib/forms";
import { formatTokenAmount, parseTokenAmountInput } from "../../lib/token-amounts";
import type { BoardroomDistributionSnapshot } from "../../lib/types";
import { cn } from "../../lib/utils";
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
import {
  maximumWithSlippage,
  minimumWithSlippage,
  parseSlippageBps,
  transactionDeadline,
  unixWindowStatus,
} from "./participation-math";
import type { ParticipationFlowContext } from "./types";

type BondingCurveFlowProps = ParticipationFlowContext & {
  distribution: BoardroomDistributionSnapshot;
};

type CurveMode = "buy" | "sell";
type CurveQuote = MigratingBondingCurveBuyQuote | MigratingBondingCurveSellQuote;
type ParsedAmount = { error?: string; value?: bigint };
export type BondingCurveActionKind = "approve" | "trade";

export type BondingCurveActionIntent = {
  account: Address;
  boardroom: Address;
  boardroomStatus: number;
  curve: Address;
  deadlineMinutes: string;
  factory: Address;
  liquidityFactory: Address;
  mode: CurveMode;
  quoteToken: Address;
  recipient: Address;
  shareAmount: bigint;
  shareToken: Address;
  slippageBps: bigint;
};

export type PreparedBondingCurveAction = {
  kind: BondingCurveActionKind;
  quote: CurveQuote;
  request: Record<string, unknown>;
};

type PrepareBondingCurveActionOptions = {
  clock?: (() => number) | undefined;
  expectedAction: BondingCurveActionKind;
  intent: BondingCurveActionIntent;
  isCurrent?: ((intent: BondingCurveActionIntent) => boolean) | undefined;
  onQuote?: ((quote: CurveQuote) => void) | undefined;
  readBuyQuote?: typeof readMigratingBondingCurveBuyQuote | undefined;
  readSellQuote?: typeof readMigratingBondingCurveSellQuote | undefined;
};

export function BondingCurveFlow({
  account,
  dashboard,
  distribution,
  pendingAction,
  publicClient,
  runAction,
  submitTransaction,
}: BondingCurveFlowProps): React.JSX.Element {
  const state = bondingCurveState(distribution);
  const shareMetadata = distribution.shareTokenMetadata;
  const quoteMetadata = distribution.quoteTokenMetadata;
  const [mode, setMode] = useState<CurveMode>("buy");
  const [amountInput, setAmountInput] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [slippageInput, setSlippageInput] = useState("1");
  const [deadlineMinutes, setDeadlineMinutes] = useState("20");
  const [quote, setQuote] = useState<CurveQuote>();
  const [quoteError, setQuoteError] = useState<string>();
  const [quoteLoading, setQuoteLoading] = useState(false);
  const requestVersion = useRef(0);

  const parsedAmount = useMemo<ParsedAmount>(() => {
    if (!amountInput.trim()) return {};
    if (!shareMetadata) return { error: "Project token decimals are unavailable." };
    try {
      return { value: parseTokenAmountInput(amountInput, shareMetadata, `${mode === "buy" ? "Buy" : "Sell"} amount`) };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [amountInput, mode, shareMetadata]);

  const slippage = safeSlippage(slippageInput);
  const recipient = resolveRecipient(recipientInput, account);
  const recipientError = recipientInput.trim() && !recipient ? "Recipient must be a valid address." : undefined;
  const buyQuote = quote && "quoteIn" in quote ? quote : undefined;
  const sellQuote = quote && "quoteOut" in quote ? quote : undefined;
  const maximumQuoteIn = buyQuote && slippage.value !== undefined
    ? maximumWithSlippage(buyQuote.quoteIn, slippage.value)
    : undefined;
  const minimumQuoteOut = sellQuote && slippage.value !== undefined
    ? minimumWithSlippage(sellQuote.quoteOut, slippage.value)
    : undefined;
  const actionIdentity = bondingCurveActionIdentity({
    account,
    boardroom: state?.boardroom,
    boardroomStatus: dashboard.snapshot.status,
    curve: state?.address,
    deadlineMinutes,
    factory: state?.factory,
    liquidityFactory: state?.liquidityFactory,
    mode,
    quoteToken: state?.quoteToken,
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
      const next = mode === "buy"
        ? await readMigratingBondingCurveBuyQuote(publicClient, {
            curve: state.address,
            buyer: account,
            shareAmount: parsedAmount.value,
          })
        : await readMigratingBondingCurveSellQuote(publicClient, {
            curve: state.address,
            seller: account,
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
  }, [account, mode, parsedAmount.value, publicClient, state]);

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
  }, [account, mode, parsedAmount.value, refreshQuote, state]);

  if (!state) {
    return (
      <ReadError>
        {distribution.error ?? "This bonding curve did not return a readable onchain state."}
      </ReadError>
    );
  }

  const blocker = curveBlocker({
    account,
    amount: parsedAmount.value,
    amountError: parsedAmount.error,
    boardroomStatus: dashboard.snapshot.status,
    buyQuote,
    maximumQuoteIn,
    minimumQuoteOut,
    mode,
    quoteError,
    quoteLoading,
    recipient,
    recipientError,
    sellQuote,
    slippageError: slippage.error,
    state,
  });
  const approval = curveApproval({ amount: parsedAmount.value, buyQuote, maximumQuoteIn, mode, sellQuote });
  const actionId = approval.required
    ? mode === "buy" ? "Approve curve quote token" : "Approve project tokens for sale"
    : mode === "buy" ? "Buy from bonding curve" : "Sell to bonding curve";
  const actionLabel = approval.required
    ? `Approve ${mode === "buy" ? quoteMetadata?.symbol ?? "quote token" : shareMetadata?.symbol ?? "project token"}`
    : mode === "buy" ? "Buy project tokens" : "Sell project tokens";

  const submitAction = async (): Promise<void> => {
    if (!account || !recipient || parsedAmount.value === undefined || slippage.value === undefined) {
      throw new Error("Refresh a valid quote before continuing.");
    }
    const intent: BondingCurveActionIntent = {
      account,
      boardroom: state.boardroom,
      boardroomStatus: dashboard.snapshot.status,
      curve: state.address,
      deadlineMinutes,
      factory: state.factory,
      liquidityFactory: state.liquidityFactory,
      mode,
      quoteToken: state.quoteToken,
      recipient,
      shareAmount: parsedAmount.value,
      shareToken: state.shareToken,
      slippageBps: slippage.value,
    };
    const expectedIdentity = bondingCurveActionIdentity(intent);
    actionGuard.sync(expectedIdentity);
    const actionTicket = actionGuard.capture();
    const prepared = await prepareBondingCurveAction(publicClient, {
      expectedAction: approval.required ? "approve" : "trade",
      intent,
      isCurrent: () => actionGuard.isCurrent(actionTicket),
      onQuote: setQuote,
    });
    await submitTransaction(
      prepared.kind === "approve"
        ? "Bonding curve token approval"
        : mode === "buy" ? "Bonding curve purchase" : "Bonding curve sale",
      prepared.request,
      { isCurrent: () => actionGuard.isCurrent(actionTicket) },
    );
    if (actionGuard.isCurrent(actionTicket)) await refreshQuote();
  };

  const expectedPayment = mode === "buy" ? buyQuote?.quoteIn : parsedAmount.value;
  const expectedReceive = mode === "buy" ? parsedAmount.value : sellQuote?.quoteOut;
  const paymentMetadata = mode === "buy" ? quoteMetadata : shareMetadata;
  const receiveMetadata = mode === "buy" ? shareMetadata : quoteMetadata;
  const walletBalance = mode === "buy" ? buyQuote?.quoteBalance : sellQuote?.shareBalance;
  const currentAllowance = mode === "buy" ? buyQuote?.quoteAllowance : sellQuote?.shareAllowance;

  return (
    <div className="min-w-0">
      <FlowHeading
        eyebrow="Live onchain price"
        title="Trade on the bonding curve"
        description="The quote changes with curve inventory. Sell rights follow transferable shares and are bounded by the curve’s one global outstanding-share liability."
      />
      <div aria-label="Bonding curve direction" className="mt-5 inline-flex border-b border-zinc-800" role="group">
        {(["buy", "sell"] as const).map((nextMode) => (
          <button
            aria-pressed={mode === nextMode}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300/70",
              mode === nextMode ? "border-lime-300 text-zinc-50" : "border-transparent text-zinc-500 hover:text-zinc-200",
            )}
            key={nextMode}
            type="button"
            onClick={() => setMode(nextMode)}
          >
            {nextMode === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>
      <AmountField
        label={`Project tokens to ${mode}`}
        onChange={setAmountInput}
        symbol={shareMetadata?.symbol}
        value={amountInput}
      />
      <QuoteGrid
        items={[
          {
            label: mode === "buy" ? "Expected payment" : "Tokens sold",
            value: expectedPayment === undefined
              ? quoteLoading ? "Reading quote…" : "Not quoted"
              : formatTokenAmount(expectedPayment, paymentMetadata),
          },
          {
            label: mode === "buy" ? "Tokens received" : "Expected return",
            value: expectedReceive === undefined
              ? quoteLoading ? "Reading quote…" : "Not quoted"
              : formatTokenAmount(expectedReceive, receiveMetadata),
          },
          {
            label: mode === "buy" ? "Maximum payment" : "Minimum return",
            value: mode === "buy"
              ? maximumQuoteIn === undefined ? "Not quoted" : formatTokenAmount(maximumQuoteIn, quoteMetadata)
              : minimumQuoteOut === undefined ? "Not quoted" : formatTokenAmount(minimumQuoteOut, quoteMetadata),
            detail: `${slippageInput}% price protection`,
          },
          {
            label: "Wallet balance",
            value: walletBalance === undefined ? "Not loaded" : formatTokenAmount(walletBalance, paymentMetadata),
          },
          {
            label: "Current allowance",
            value: currentAllowance === undefined ? "Not loaded" : formatTokenAmount(currentAllowance, paymentMetadata),
            detail: approval.required ? "Approval is required before this trade" : quote ? "Ready for this quote" : undefined,
          },
          {
            label: mode === "buy" ? "Curve inventory" : "Wallet sellable amount",
            value: mode === "buy"
              ? formatTokenAmount(state.remainingSaleShares, shareMetadata)
              : sellQuote ? formatTokenAmount(sellQuote.sellableShares, shareMetadata) : "Not loaded",
          },
          {
            label: "Outstanding curve liability",
            value: formatTokenAmount(state.outstandingCurveShareLiability, shareMetadata),
            detail: "Global transferable shares that remain sellable against this curve",
          },
        ]}
      />

      {distribution.error ? <ReadError>{distribution.error}</ReadError> : null}
      {quoteError ? <ReadError>{quoteError}</ReadError> : null}
      {!account ? (
        <ConnectWalletPrompt description="Curve quotes depend on the connected wallet’s balance, allowance, and eligible sellable amount." />
      ) : null}
      {blocker && !quoteError ? <FlowError>{blocker}</FlowError> : null}

      <AdvancedFields summary="Advanced trade settings">
        <div className="grid gap-4 sm:grid-cols-2">
          <InlineField label="Recipient">
            <Input
              aria-label="Bonding curve recipient"
              placeholder={account ?? "0x…"}
              value={recipientInput}
              onChange={(event) => setRecipientInput(event.target.value)}
            />
          </InlineField>
          <InlineField label="Price protection (%)">
            <Input
              aria-label="Bonding curve slippage"
              inputMode="decimal"
              value={slippageInput}
              onChange={(event) => setSlippageInput(event.target.value)}
            />
          </InlineField>
          <InlineField label="Wallet deadline (minutes)">
            <Input
              aria-label="Bonding curve deadline"
              inputMode="numeric"
              value={deadlineMinutes}
              onChange={(event) => setDeadlineMinutes(event.target.value)}
            />
          </InlineField>
          <div>
            <p className="m-0 text-xs font-semibold text-zinc-400">Curve contract</p>
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

export async function prepareBondingCurveAction(
  client: PublicClient,
  options: PrepareBondingCurveActionOptions,
): Promise<PreparedBondingCurveAction> {
  const { intent } = options;
  if (intent.boardroomStatus !== 0) throw new Error("This project is no longer active.");
  if (intent.shareAmount <= 0n) throw new Error("Trade amount must be greater than zero.");

  const quote: CurveQuote = intent.mode === "buy"
    ? await (options.readBuyQuote ?? readMigratingBondingCurveBuyQuote)(client, {
        curve: intent.curve,
        buyer: intent.account,
        shareAmount: intent.shareAmount,
      })
    : await (options.readSellQuote ?? readMigratingBondingCurveSellQuote)(client, {
        curve: intent.curve,
        seller: intent.account,
        shareAmount: intent.shareAmount,
      });
  assertBondingCurveQuoteIdentity(quote, intent);
  if (options.isCurrent && !options.isCurrent(intent)) {
    throw new Error("Trade details changed while the quote was refreshing. Review the updated order and try again.");
  }
  options.onQuote?.(quote);

  const nowSeconds = options.clock?.() ?? Math.floor(Date.now() / 1_000);
  if (quote.state.curveStatus !== 0 || quote.state.closed) throw new Error("This bonding curve closed while the quote was refreshing.");
  if (intent.mode === "buy") {
    if (quote.state.graduationLatched) throw new Error("This curve reached graduation while the quote was refreshing.");
    const window = unixWindowStatus(quote.state.startTime, quote.state.endTime, nowSeconds);
    if (window !== "open") throw new Error(window === "ended" ? "The curve purchase window has ended." : "Curve purchases have not started yet.");
  }

  const prepared = intent.mode === "buy"
    ? prepareBondingCurveBuyAction(quote as MigratingBondingCurveBuyQuote, intent, nowSeconds)
    : prepareBondingCurveSellAction(quote as MigratingBondingCurveSellQuote, intent, nowSeconds);
  if (prepared.kind !== options.expectedAction) {
    throw new Error(
      prepared.kind === "approve"
        ? "The refreshed trade now requires approval. Review the updated action and try again."
        : "Approval is now sufficient. Review the refreshed trade before submitting it.",
    );
  }
  return { ...prepared, quote };
}

export function bondingCurveActionIdentity(input: {
  account: Address | undefined;
  boardroom: Address | undefined;
  boardroomStatus: number;
  curve: Address | undefined;
  deadlineMinutes: string;
  factory: Address | undefined;
  liquidityFactory: Address | undefined;
  mode: CurveMode;
  quoteToken: Address | undefined;
  recipient: Address | undefined;
  shareAmount: bigint | undefined;
  shareToken: Address | undefined;
  slippageBps: bigint | undefined;
}): string {
  return [
    input.account?.toLowerCase() ?? "",
    input.boardroom?.toLowerCase() ?? "",
    input.boardroomStatus.toString(),
    input.curve?.toLowerCase() ?? "",
    input.deadlineMinutes,
    input.factory?.toLowerCase() ?? "",
    input.liquidityFactory?.toLowerCase() ?? "",
    input.mode,
    input.quoteToken?.toLowerCase() ?? "",
    input.recipient?.toLowerCase() ?? "",
    input.shareAmount?.toString() ?? "",
    input.shareToken?.toLowerCase() ?? "",
    input.slippageBps?.toString() ?? "",
  ].join(":");
}

function prepareBondingCurveBuyAction(
  quote: MigratingBondingCurveBuyQuote,
  intent: BondingCurveActionIntent,
  nowSeconds: number,
): Pick<PreparedBondingCurveAction, "kind" | "request"> {
  if (intent.shareAmount > quote.state.remainingSaleShares) throw new Error("The requested amount is no longer available on this curve.");
  const maxQuoteIn = maximumWithSlippage(quote.quoteIn, intent.slippageBps);
  if (quote.quoteBalance < maxQuoteIn) throw new Error("The wallet balance no longer covers the refreshed maximum payment.");
  const kind: BondingCurveActionKind = quote.quoteAllowance < maxQuoteIn ? "approve" : "trade";
  return {
    kind,
    request: kind === "approve"
      ? buildErc20Approval({ token: quote.state.quoteToken, spender: quote.state.address, amount: maxQuoteIn })
      : buildMigratingBondingCurveBuyTransaction({
          curve: quote.state.address,
          shareAmount: intent.shareAmount,
          recipient: intent.recipient,
          maxQuoteIn,
          deadline: transactionDeadline(intent.deadlineMinutes, nowSeconds),
        }),
  };
}

function prepareBondingCurveSellAction(
  quote: MigratingBondingCurveSellQuote,
  intent: BondingCurveActionIntent,
  nowSeconds: number,
): Pick<PreparedBondingCurveAction, "kind" | "request"> {
  if (intent.shareAmount > quote.sellableShares) throw new Error("This wallet no longer has enough currently sellable project tokens.");
  if (intent.shareAmount > quote.shareBalance) throw new Error("The wallet project-token balance is now too low for this trade.");
  const minQuoteOut = minimumWithSlippage(quote.quoteOut, intent.slippageBps);
  const kind: BondingCurveActionKind = quote.shareAllowance < intent.shareAmount ? "approve" : "trade";
  return {
    kind,
    request: kind === "approve"
      ? buildErc20Approval({ token: quote.state.shareToken, spender: quote.state.address, amount: intent.shareAmount })
      : buildMigratingBondingCurveSellTransaction({
          curve: quote.state.address,
          shareAmount: intent.shareAmount,
          recipient: intent.recipient,
          minQuoteOut,
          deadline: transactionDeadline(intent.deadlineMinutes, nowSeconds),
        }),
  };
}

function assertBondingCurveQuoteIdentity(quote: CurveQuote, intent: BondingCurveActionIntent): void {
  const actor = "buyer" in quote ? quote.buyer : quote.seller;
  const quoteMode: CurveMode = "quoteIn" in quote ? "buy" : "sell";
  const matches = quoteMode === intent.mode
    && quote.shareAmount === intent.shareAmount
    && sameAddress(actor, intent.account)
    && sameAddress(quote.state.address, intent.curve)
    && sameAddress(quote.state.factory, intent.factory)
    && sameAddress(quote.state.boardroom, intent.boardroom)
    && sameAddress(quote.state.liquidityFactory, intent.liquidityFactory)
    && sameAddress(quote.state.shareToken, intent.shareToken)
    && sameAddress(quote.state.quoteToken, intent.quoteToken);
  if (!matches) throw new Error("The refreshed quote does not match this wallet, curve, direction, or exact trade amount.");
}

function bondingCurveState(distribution: BoardroomDistributionSnapshot): MigratingBondingCurveState | undefined {
  const state = distribution.state;
  return distribution.kind === "migrating-bonding-curve" && state && "curveStatus" in state ? state : undefined;
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

function curveApproval(input: {
  amount: bigint | undefined;
  buyQuote: MigratingBondingCurveBuyQuote | undefined;
  maximumQuoteIn: bigint | undefined;
  mode: CurveMode;
  sellQuote: MigratingBondingCurveSellQuote | undefined;
}): { amount?: bigint; required: boolean } {
  if (input.mode === "buy") {
    return {
      ...(input.maximumQuoteIn === undefined ? {} : { amount: input.maximumQuoteIn }),
      required: Boolean(input.buyQuote && input.maximumQuoteIn !== undefined && input.buyQuote.quoteAllowance < input.maximumQuoteIn),
    };
  }
  return {
    ...(input.amount === undefined ? {} : { amount: input.amount }),
    required: Boolean(input.sellQuote && input.amount !== undefined && input.sellQuote.shareAllowance < input.amount),
  };
}

function curveBlocker(input: {
  account: Address | undefined;
  amount: bigint | undefined;
  amountError: string | undefined;
  boardroomStatus: number;
  buyQuote: MigratingBondingCurveBuyQuote | undefined;
  maximumQuoteIn: bigint | undefined;
  minimumQuoteOut: bigint | undefined;
  mode: CurveMode;
  quoteError: string | undefined;
  quoteLoading: boolean;
  recipient: Address | undefined;
  recipientError: string | undefined;
  sellQuote: MigratingBondingCurveSellQuote | undefined;
  slippageError: string | undefined;
  state: MigratingBondingCurveState;
}): string | undefined {
  if (input.boardroomStatus !== 0) return "This project is no longer active, so curve trading is unavailable.";
  if (input.state.curveStatus !== 0 || input.state.closed) return "This bonding curve is no longer active.";
  if (input.state.graduationLatched) return "This curve has reached graduation and is waiting for liquidity migration.";
  if (input.mode === "buy") {
    const window = unixWindowStatus(input.state.startTime, input.state.endTime);
    if (window === "not-started") return "Curve purchases have not started yet.";
    if (window === "ended") return "The curve purchase window has ended. Eligible tokens can still be sold before migration.";
  }
  if (!input.account) return undefined;
  if (input.amountError) return input.amountError;
  if (input.amount === undefined || input.amount === 0n) return `Enter the number of project tokens you want to ${input.mode}.`;
  if (input.mode === "buy" && input.amount > input.state.remainingSaleShares) return "That amount is larger than the curve’s remaining inventory.";
  if (input.recipientError) return input.recipientError;
  if (!input.recipient) return "A recipient is required.";
  if (input.slippageError) return input.slippageError;
  if (input.quoteLoading) return "Reading the account-specific quote…";
  if (input.quoteError) return input.quoteError;
  if (input.mode === "buy") {
    if (!input.buyQuote || input.maximumQuoteIn === undefined) return "A current buy quote is required.";
    if (input.buyQuote.quoteBalance < input.maximumQuoteIn) return "The wallet’s quote-token balance does not cover the maximum payment.";
  } else {
    if (!input.sellQuote || input.minimumQuoteOut === undefined) return "A current sell quote is required.";
    if (input.amount > input.sellQuote.sellableShares) return "This wallet has fewer currently sellable project tokens than requested.";
    if (input.amount > input.sellQuote.shareBalance) return "The wallet’s project-token balance is too low for this sale.";
  }
  return undefined;
}
