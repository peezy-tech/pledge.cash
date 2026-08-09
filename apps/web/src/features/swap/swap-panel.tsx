import type { Address, PledgeCashDeployment } from "@pledge.cash/sdk";
import { ArrowDownUp, Check, ChevronDown, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { isAddress } from "viem";
import { ActionButton, ActionRow, AddressLink, Facts, Field, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import type { ExactRational, MetricState, NormalizedPrice } from "../../lib/market-data";
import {
  formatSwapAmount,
  pairHasWrappedNative,
  swapNativeMode,
  swapPairLabel,
  swapQuoteReady,
  swapQuoteRequestIdentity,
  type SwapForm,
  type SwapQuoteState,
  type SwapTokenListState,
  type SwapTokenMetadata,
  type SwapTokenOption,
} from "../../lib/swap";
import type { WalletActionCapability } from "../capabilities/wallet-action";
import { ConnectWalletPrompt } from "../wallet/connect-wallet-prompt";

type SwapPanelProps = {
  account: Address | undefined;
  actionCapability: WalletActionCapability;
  deployment: PledgeCashDeployment | undefined;
  form: SwapForm;
  nativeBalance?: bigint | undefined;
  pendingAction: string | undefined;
  quote: SwapQuoteState | undefined;
  setForm: Dispatch<SetStateAction<SwapForm>>;
  tokenList: SwapTokenListState;
  tokenListLoading: boolean;
  wrappedNativeSymbol: string;
  lockSwapPair?: boolean | undefined;
  approveInput: () => Promise<void>;
  executeSwap: () => Promise<void>;
  refreshQuote: () => Promise<void>;
  refreshTokens: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
  switchWalletNetwork: () => Promise<void>;
};

type ActionDecision = { enabled: boolean; reason?: string | undefined };
type SwapActionState = { approve: ActionDecision; quoteReady: boolean; swap: ActionDecision };
type FactItem = { label: string; value: ReactNode };

export function SwapPanel({
  account,
  actionCapability,
  deployment,
  form,
  nativeBalance,
  pendingAction,
  quote,
  setForm,
  tokenList,
  tokenListLoading,
  wrappedNativeSymbol,
  lockSwapPair = false,
  approveInput,
  executeSwap,
  refreshQuote,
  refreshTokens,
  runAction,
  switchWalletNetwork,
}: SwapPanelProps): React.JSX.Element {
  const [selectorSide, setSelectorSide] = useState<"tokenIn" | "tokenOut">();
  const [tokenSearch, setTokenSearch] = useState("");
  const [currentUnixTime, setCurrentUnixTime] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentUnixTime(Math.floor(Date.now() / 1000)), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const inputIsNative = swapNativeMode(deployment, form) === "input";
  const deadlineValid = deadlineIsFuture(form.deadline, currentUnixTime);
  const quoteCurrent = quote !== undefined && quote.requestIdentity === swapDecisionFormKey(form);
  const currentQuote = quoteCurrent ? quote : undefined;
  const actions = swapActionState(
    actionCapability,
    currentQuote,
    inputIsNative,
    deadlineValid,
    quote ? (quoteCurrent ? "current" : "stale") : "missing",
    pendingAction,
    nativeBalance,
  );
  const inputToken = selectedTokenOption(form.tokenIn, tokenList.tokens, currentQuote?.tokenIn);
  const outputToken = selectedTokenOption(form.tokenOut, tokenList.tokens, currentQuote?.tokenOut);
  const selectorValue = selectorSide ? form[selectorSide] : "";
  const selectorOtherToken = selectorSide === "tokenIn" ? form.tokenOut : form.tokenIn;
  const selectorQuoteToken = selectorSide === "tokenIn" ? currentQuote?.tokenIn : currentQuote?.tokenOut;

  const selectToken = (address: string): void => {
    if (!selectorSide) return;
    setForm((current) => ({ ...current, [selectorSide]: address }));
    setSelectorSide(undefined);
    setTokenSearch("");
  };

  return (
    <div className="grid gap-4">
      {actionCapability.status === "switch" ? (
        <div className="flex flex-col gap-3 rounded-md border border-amber-950 bg-amber-950/30 p-4 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0">{actionCapability.reason ?? "Switch your wallet to the active app network."}</p>
          <Button disabled={pendingAction !== undefined} type="button" variant="secondary" onClick={() => void runAction("switch-market-chain", switchWalletNetwork)}>
            Switch wallet network
          </Button>
        </div>
      ) : null}
      <Panel
        title="Uniswap v4 swap"
        description="Swap through hookless pools identified by canonical pledge.cash liquidity lockers."
        action={
          <ActionButton actionId="quote-swap" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("quote-swap", refreshQuote)}>
            <RefreshCw className="h-4 w-4" />{pendingAction === "quote-swap" ? "Quoting…" : "Quote"}
          </ActionButton>
        }
      >
        <form
          aria-label="Swap tokens"
          onSubmit={(event) => {
            event.preventDefault();
            if (actions.swap.enabled) void runAction("execute-swap", executeSwap);
          }}
        >
          <div className="flex flex-col gap-3 border-t border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={swapTone(quote, quoteCurrent, deadlineValid)}>{swapStatus(quote, quoteCurrent, deadlineValid)}</Badge>
                <Badge variant="muted">{swapPairLabel(currentQuote, form)}</Badge>
              </div>
              {quote && !quoteCurrent ? <p className="m-0 mt-2 text-xs text-amber-200">Inputs changed. Refresh the stale quote.</p> : null}
              {currentQuote?.error ? <p className="m-0 mt-2 text-sm text-amber-200">{currentQuote.error}</p> : null}
            </div>
            <Button aria-label="Flip swap direction" disabled={lockSwapPair} size="icon" type="button" variant="secondary" onClick={() => flipSwap(setForm)}>
              <ArrowDownUp className="h-4 w-4" />
            </Button>
          </div>

          {!account ? <ConnectWalletPrompt description="Connect the wallet that will fund this swap to load its balance and allowance." /> : null}

          <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 md:grid-cols-2">
            <TokenSelectField
              disabled={lockSwapPair}
              label="From token"
              loading={tokenListLoading}
              option={inputToken}
              otherToken={form.tokenOut}
              value={form.tokenIn}
              wrappedNativeSymbol={wrappedNativeSymbol}
              onOpen={() => { setSelectorSide("tokenIn"); setTokenSearch(""); }}
            />
            <TokenSelectField
              disabled={lockSwapPair}
              label="To token"
              loading={tokenListLoading}
              option={outputToken}
              otherToken={form.tokenIn}
              value={form.tokenOut}
              wrappedNativeSymbol={wrappedNativeSymbol}
              onOpen={() => { setSelectorSide("tokenOut"); setTokenSearch(""); }}
            />
            <TextField form={form} field="amountIn" inputMode="decimal" label="Amount in" setForm={setForm} />
            <TextField form={form} field="recipient" label="Receive tokens at" placeholder={account ?? "Connected wallet"} setForm={setForm} />
            <ExecutionPreferences currentUnixTime={currentUnixTime} form={form} setForm={setForm} />
          </div>

          <Facts columns="three" items={swapDecisionFacts(currentQuote, form, currentUnixTime)} />
          <details className="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-400">
            <summary className="cursor-pointer font-semibold text-zinc-300">Technical details</summary>
            <Facts columns="three" items={swapTechnicalFacts(currentQuote, inputIsNative, nativeBalance)} />
            <p className="m-0 pt-3 text-xs">Router: {deployment?.uniswapUniversalRouter ? <AddressLink address={deployment.uniswapUniversalRouter} /> : "Not configured"}</p>
            {pairHasWrappedNative(deployment, form.tokenIn, form.tokenOut) ? (
              <p className="m-0 pt-2 text-xs">Native routing is disabled. Wrap or unwrap {wrappedNativeSymbol} separately.</p>
            ) : null}
          </details>

          <ActionRow>
            <ActionControl reason={actions.approve.reason}>
              <ActionButton actionId="approve-swap-input" disabled={!actions.approve.enabled} pendingAction={pendingAction} type="button" variant="secondary" onClick={() => void runAction("approve-swap-input", approveInput)}>
                <ShieldCheck className="h-4 w-4" />Approve
              </ActionButton>
            </ActionControl>
            <ActionControl reason={actions.swap.reason}>
              <ActionButton actionId="execute-swap" disabled={!actions.swap.enabled} pendingAction={pendingAction} type="submit">Swap</ActionButton>
            </ActionControl>
          </ActionRow>
        </form>
      </Panel>

      {selectorSide ? (
        <TokenSelectorDialog
          error={tokenList.error}
          label={selectorSide === "tokenIn" ? "Select input token" : "Select output token"}
          loading={tokenListLoading}
          otherToken={selectorOtherToken}
          pendingAction={pendingAction}
          query={tokenSearch}
          selected={selectedTokenOption(selectorValue, tokenList.tokens, selectorQuoteToken)}
          tokens={tokenList.tokens}
          value={selectorValue}
          refreshTokens={refreshTokens}
          runAction={runAction}
          setQuery={setTokenSearch}
          onClose={() => { setSelectorSide(undefined); setTokenSearch(""); }}
          onSelect={selectToken}
        />
      ) : null}
    </div>
  );
}

function TokenSelectField({
  disabled,
  label,
  loading,
  option,
  otherToken,
  value,
  wrappedNativeSymbol,
  onOpen,
}: {
  disabled: boolean;
  label: string;
  loading: boolean;
  option: SwapTokenOption | undefined;
  otherToken: string;
  value: string;
  wrappedNativeSymbol: string;
  onOpen: () => void;
}): React.JSX.Element {
  const title = option?.symbol ?? option?.label ?? (shortTokenAddress(value) || "Choose token");
  const subtitle = option ? `${shortTokenAddress(option.address)} · ${formatSwapAmount(option.balance, option)}` : value || `Select ${wrappedNativeSymbol} or another token`;
  const direct = option?.pairAddresses.some((address) => sameAddress(address, otherToken)) ?? false;
  return (
    <Field label={label}>
      <button className="flex h-14 w-full items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-left" disabled={disabled} type="button" onClick={onOpen}>
        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-zinc-100">{title}</span><span className="block truncate text-xs text-zinc-500">{subtitle}</span></span>
        <span className="flex items-center gap-2"><Badge variant={direct ? "default" : "muted"}>{loading ? "Loading" : direct ? "Direct pool" : "Token"}</Badge>{disabled ? null : <ChevronDown className="h-4 w-4" />}</span>
      </button>
    </Field>
  );
}

export function TokenSelectorDialog({
  error,
  label,
  loading,
  otherToken,
  pendingAction,
  query,
  selected,
  tokens,
  value,
  refreshTokens,
  runAction,
  setQuery,
  onClose,
  onSelect,
}: {
  error: string | undefined;
  label: string;
  loading: boolean;
  otherToken: string;
  pendingAction: string | undefined;
  query: string;
  selected: SwapTokenOption | undefined;
  tokens: SwapTokenOption[];
  value: string;
  refreshTokens: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
  setQuery: (query: string) => void;
  onClose: () => void;
  onSelect: (address: string) => void;
}): React.JSX.Element {
  const normalizedQuery = query.trim();
  const visibleTokens = useMemo(
    () => tokens
      .filter((token) => !sameAddress(token.address, otherToken))
      .filter((token) => tokenMatchesQuery(token, normalizedQuery))
      .sort((left, right) => tokenTitle(left, left.address).localeCompare(tokenTitle(right, right.address))),
    [normalizedQuery, otherToken, tokens],
  );
  const customAddress = isAddress(normalizedQuery) && !tokens.some((token) => sameAddress(token.address, normalizedQuery))
    ? normalizedQuery
    : undefined;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[min(760px,calc(100svh-2rem))] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 pr-14">
          <DialogHeader className="text-left"><DialogTitle>{label}</DialogTitle><DialogDescription>Search by symbol or paste an address.</DialogDescription></DialogHeader>
          <ActionButton actionId="refresh-swap-tokens" pendingAction={pendingAction} size="icon" variant="secondary" onClick={() => void runAction("refresh-swap-tokens", refreshTokens)}><RefreshCw className="h-4 w-4" /></ActionButton>
        </div>
        <div className="border-b border-zinc-800 p-4">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" /><Input className="pl-9" placeholder="Symbol or token address" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          {error ? <p className="m-0 mt-3 text-sm text-amber-200">{error}</p> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {customAddress ? <TokenRow active={sameAddress(customAddress, value)} address={customAddress} subtitle="Custom token address" title={shortTokenAddress(customAddress)} onSelect={onSelect} /> : null}
          {visibleTokens.map((token) => (
            <TokenRow
              active={selected ? sameAddress(token.address, selected.address) : sameAddress(token.address, value)}
              address={token.address}
              key={token.address.toLowerCase()}
              subtitle={`${shortTokenAddress(token.address)} · ${token.pairAddresses.length.toString()} discovered pair${token.pairAddresses.length === 1 ? "" : "s"}`}
              title={tokenTitle(token, token.address)}
              onSelect={onSelect}
            />
          ))}
          {!loading && visibleTokens.length === 0 && !customAddress ? <div className="p-6 text-center text-sm text-zinc-500">No matching token</div> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TokenRow({ active, address, subtitle, title, onSelect }: { active: boolean; address: string; subtitle: string; title: string; onSelect: (address: string) => void }): React.JSX.Element {
  return (
    <button className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-zinc-900 px-4 py-3 text-left hover:bg-zinc-900" type="button" onClick={() => onSelect(address)}>
      <span className="min-w-0"><span className="block truncate text-sm font-semibold text-zinc-100">{title}</span><span className="block truncate text-xs text-zinc-500">{subtitle}</span></span>
      {active ? <Check className="h-4 w-4 text-lime-300" /> : null}
    </button>
  );
}

function ExecutionPreferences({ currentUnixTime, form, setForm }: { currentUnixTime: number; form: SwapForm; setForm: Dispatch<SetStateAction<SwapForm>> }): React.JSX.Element {
  const minutes = remainingDeadlineMinutes(form.deadline, currentUnixTime);
  return (
    <>
      <Field label="Slippage tolerance"><select className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm" value={form.slippageBps} onChange={(event) => setForm((current) => ({ ...current, slippageBps: event.target.value }))}>{["10", "50", "100", "200"].map((value) => <option key={value} value={value}>{formatSlippagePercent(value)}</option>)}</select></Field>
      <Field label="Quote expires in"><select className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm" value={minutes?.toString() ?? "expired"} onChange={(event) => setForm((current) => ({ ...current, deadline: String(currentUnixTime + Number(event.target.value) * 60) }))}>{minutes === undefined ? <option disabled value="expired">Expired</option> : null}{[10, 20, 30, 60].map((value) => <option key={value} value={value}>{value} min</option>)}</select></Field>
    </>
  );
}

function TextField<K extends "amountIn" | "recipient">({ form, field, inputMode, label, placeholder, setForm }: { form: SwapForm; field: K; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; label: string; placeholder?: string; setForm: Dispatch<SetStateAction<SwapForm>> }): React.JSX.Element {
  return <Field label={label}><Input inputMode={inputMode} placeholder={placeholder} spellCheck={false} value={form[field]} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} /></Field>;
}

export function remainingDeadlineMinutes(deadline: string, currentUnixTime: number): number | undefined {
  const timestamp = Number(deadline);
  return Number.isSafeInteger(timestamp) && timestamp > currentUnixTime ? Math.max(1, Math.ceil((timestamp - currentUnixTime) / 60)) : undefined;
}

export function deadlineIsFuture(deadline: string, currentUnixTime: number): boolean {
  const timestamp = Number(deadline);
  return Number.isSafeInteger(timestamp) && timestamp > currentUnixTime;
}

export function swapActionState(
  actionCapability: WalletActionCapability,
  quote: SwapQuoteState | undefined,
  inputIsNative: boolean,
  deadlineValid: boolean,
  quoteState: "current" | "missing" | "stale" = quote ? "current" : "missing",
  pendingAction?: string | undefined,
  nativeBalance?: bigint | undefined,
): SwapActionState {
  const quoteReady = swapQuoteReady(quote);
  const commonReason = swapQuoteBlockingReason(actionCapability, quote, quoteReady, quoteState);
  let approve: ActionDecision = { enabled: false, ...(commonReason ? { reason: commonReason } : {}) };
  let swap: ActionDecision = { enabled: false, ...(commonReason ? { reason: commonReason } : {}) };

  if (!commonReason && quoteReady) {
    const balance = inputIsNative ? nativeBalance : quote.tokenIn.balance;
    const allowance = quote.tokenIn.allowance;
    approve = inputIsNative
      ? { enabled: false, reason: "Native input does not require ERC-20 approval." }
      : allowance === undefined
        ? { enabled: false, reason: "Input-token allowance is unknown. Refresh the quote." }
        : allowance >= quote.amountIn
          ? { enabled: false, reason: "The current allowance covers this swap." }
          : { enabled: true };
    swap = !deadlineValid
      ? { enabled: false, reason: "The quote expiry is invalid or has passed." }
      : balance === undefined
        ? { enabled: false, reason: "Input-token balance is unknown. Refresh the quote." }
        : balance < quote.amountIn
          ? { enabled: false, reason: "Insufficient input-token balance." }
          : !inputIsNative && (allowance === undefined || allowance < quote.amountIn)
            ? { enabled: false, reason: "Approve the quoted input amount first." }
            : { enabled: true };
  } else if (!commonReason) {
    approve = swap = { enabled: false, reason: "Quote details are incomplete. Refresh the quote." };
  }
  if (pendingAction) {
    approve = swap = { enabled: false, reason: "Another wallet action is in progress." };
  }
  return { approve, quoteReady, swap };
}

function swapQuoteBlockingReason(actionCapability: WalletActionCapability, quote: SwapQuoteState | undefined, ready: boolean, state: "current" | "missing" | "stale"): string | undefined {
  if (actionCapability.status !== "enabled") return actionCapability.reason ?? "Wallet actions are unavailable.";
  if (state === "stale") return "The quote is stale. Refresh it before acting.";
  if (state === "missing" || !quote) return "No current quote is loaded.";
  if (quote.error) return `Quote error: ${quote.error}`;
  return ready ? undefined : "Quote details are incomplete.";
}

function swapDecisionFacts(quote: SwapQuoteState | undefined, form: SwapForm, now: number): FactItem[] {
  return [
    { label: "Expected output", value: formatSwapAmount(quote?.amountOut, quote?.tokenOut) },
    { label: "Execution price", value: formatExecutionPrice(quote?.effectiveExecutionPrice, quote?.tokenIn, quote?.tokenOut) },
    { label: "Price impact", value: formatMetricPercent(quote?.feeInclusivePriceImpact) },
    { label: "Minimum received", value: formatSwapAmount(quote?.amountOutMin, quote?.tokenOut) },
    { label: "Pool fee", value: formatFeePercent(quote?.feeBps, quote?.feeDenominator) },
    { label: "Quote expiry", value: remainingDeadlineMinutes(form.deadline, now)?.toString().concat(" min") ?? "Expired" },
  ];
}

function swapTechnicalFacts(quote: SwapQuoteState | undefined, inputIsNative: boolean, nativeBalance: bigint | undefined): FactItem[] {
  return [
    { label: "Liquidity locker", value: quote?.pool ? <AddressLink address={quote.pool.address} /> : "Unknown" },
    { label: "Pool ID", value: quote?.pool?.poolId ?? "Unknown" },
    { label: "Input approval", value: inputIsNative ? "Native value" : approvalLabel(quote?.tokenIn, quote?.amountIn) },
    { label: "Input balance", value: formatSwapAmount(inputIsNative ? nativeBalance : quote?.tokenIn?.balance, quote?.tokenIn) },
    { label: "Active liquidity", value: quote?.pool?.liquidity.toString() ?? "Unknown" },
    { label: "sqrtPriceX96", value: quote?.pool?.sqrtPriceX96.toString() ?? "Unknown" },
  ];
}

function formatExecutionPrice(metric: MetricState<NormalizedPrice> | undefined, input: SwapTokenMetadata | undefined, output: SwapTokenMetadata | undefined): string {
  if (!metric) return "Unknown";
  if (metric.status !== "known") return `Unknown — ${metric.reason}`;
  return `1 ${input?.symbol ?? "token"} = ${formatExactRational(metric.value.quotePerBase)} ${output?.symbol ?? "token"}`;
}

function formatMetricPercent(metric: MetricState<ExactRational> | undefined): string {
  return metric?.status === "known"
    ? formatExactRational({ numerator: metric.value.numerator * 100n, denominator: metric.value.denominator }, 4, "%")
    : "Unknown";
}

function formatFeePercent(fee: bigint | undefined, denominator: bigint | undefined): string {
  return fee === undefined || denominator === undefined || denominator <= 0n
    ? "Unknown"
    : formatExactRational({ numerator: fee * 100n, denominator }, 4, "%");
}

function formatExactRational(value: ExactRational, digits = 6, suffix = ""): string {
  if (value.denominator === 0n) return "Unknown";
  const negative = (value.numerator < 0n) !== (value.denominator < 0n);
  const numerator = value.numerator < 0n ? -value.numerator : value.numerator;
  const denominator = value.denominator < 0n ? -value.denominator : value.denominator;
  const whole = numerator / denominator;
  let remainder = numerator % denominator;
  let fraction = "";
  for (let index = 0; index < digits && remainder !== 0n; index += 1) {
    remainder *= 10n;
    fraction += (remainder / denominator).toString();
    remainder %= denominator;
  }
  fraction = fraction.replace(/0+$/, "");
  return `${remainder !== 0n ? "≈" : ""}${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}${suffix}`;
}

export function swapDecisionFormKey(form: SwapForm): string {
  return swapQuoteRequestIdentity(form);
}

function flipSwap(setForm: Dispatch<SetStateAction<SwapForm>>): void {
  setForm((current) => ({ ...current, tokenIn: current.tokenOut, tokenOut: current.tokenIn }));
}

function approvalLabel(token: SwapTokenMetadata | undefined, amount: bigint | undefined): string {
  if (!token || amount === undefined || token.allowance === undefined) return "Unknown";
  return token.allowance >= amount ? "Approved" : `${formatSwapAmount(token.allowance, token)} approved`;
}

function swapStatus(quote: SwapQuoteState | undefined, current: boolean, deadlineValid: boolean): string {
  if (quote && !current) return "Quote stale";
  if (!deadlineValid) return "New expiry needed";
  if (!quote) return "Not quoted";
  return swapQuoteReady(quote) ? "Ready" : "Blocked";
}

function swapTone(quote: SwapQuoteState | undefined, current: boolean, deadlineValid: boolean): "default" | "muted" | "warning" | "danger" {
  if (quote && !current || !deadlineValid) return "warning";
  if (!quote) return "muted";
  return swapQuoteReady(quote) ? "default" : "danger";
}

function ActionControl({ children, reason }: { children: ReactNode; reason?: string | undefined }): React.JSX.Element {
  return <div className="grid gap-1"><div>{children}</div>{reason ? <span className="max-w-72 text-xs text-zinc-500">{reason}</span> : null}</div>;
}

function tokenMatchesQuery(token: SwapTokenOption, query: string): boolean {
  if (!query) return true;
  const normalized = query.toLowerCase();
  return token.address.toLowerCase().includes(normalized) || token.symbol?.toLowerCase().includes(normalized) === true || token.label?.toLowerCase().includes(normalized) === true;
}

function selectedTokenOption(value: string, tokens: SwapTokenOption[], fallback?: SwapTokenMetadata): SwapTokenOption | undefined {
  const known = tokens.find((token) => sameAddress(token.address, value));
  if (known) return known;
  return fallback ? { ...fallback, sources: ["custom"], lockers: [], pairAddresses: [] } : undefined;
}

function tokenTitle(token: SwapTokenMetadata & { label?: string }, address: string): string {
  return token.symbol ?? token.label ?? shortTokenAddress(address);
}

function shortTokenAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value || "Token";
}

function sameAddress(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function formatSlippagePercent(value: string): string {
  const basisPoints = BigInt(value);
  return `${(basisPoints / 100n).toString()}.${(basisPoints % 100n).toString().padStart(2, "0")}%`;
}
