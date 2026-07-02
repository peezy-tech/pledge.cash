import type { Address, PledgeCashDeployment } from "@pledge.cash/sdk";
import { ArrowDownUp, Check, ChevronDown, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { isAddress } from "viem";
import { ActionButton, ActionRow, AddressLink, Facts, Field, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  defaultSwapDeadline,
  formatSwapAmount,
  swapPairLabel,
  swapQuoteReady,
  type SwapForm,
  type SwapQuoteState,
  type SwapTokenListState,
  type SwapTokenMetadata,
  type SwapTokenOption,
} from "../../lib/swap";

type SwapPanelProps = {
  account: Address | undefined;
  deployment: PledgeCashDeployment | undefined;
  form: SwapForm;
  pendingAction: string | undefined;
  quote: SwapQuoteState | undefined;
  setForm: Dispatch<SetStateAction<SwapForm>>;
  tokenList: SwapTokenListState;
  tokenListLoading: boolean;
  approveInput: () => Promise<void>;
  executeSwap: () => Promise<void>;
  refreshQuote: () => Promise<void>;
  refreshTokens: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
};

type TokenSide = "tokenIn" | "tokenOut";

export function SwapPanel({
  account,
  deployment,
  form,
  pendingAction,
  quote,
  setForm,
  tokenList,
  tokenListLoading,
  approveInput,
  executeSwap,
  refreshQuote,
  refreshTokens,
  runAction,
}: SwapPanelProps): React.JSX.Element {
  const [selectorSide, setSelectorSide] = useState<TokenSide>();
  const [tokenSearch, setTokenSearch] = useState("");
  const ready = swapQuoteReady(quote);
  const needsApproval = ready && (quote.tokenIn.allowance ?? 0n) < quote.amountIn;
  const canApprove = Boolean(account && ready);
  const canSwap = Boolean(account && ready && !needsApproval);
  const inputToken = selectedTokenOption(form.tokenIn, tokenList.tokens, quote?.tokenIn);
  const outputToken = selectedTokenOption(form.tokenOut, tokenList.tokens, quote?.tokenOut);
  const selectingInput = selectorSide === "tokenIn";
  const selectorLabel = selectingInput ? "From token" : "To token";
  const selectorValue = selectorSide ? form[selectorSide] : "";
  const selectorOtherToken = selectorSide === "tokenIn" ? form.tokenOut : form.tokenIn;
  const selectorSelected = selectorSide === "tokenIn" ? inputToken : outputToken;

  const openSelector = (side: TokenSide): void => {
    setSelectorSide(side);
    setTokenSearch("");
  };

  const selectToken = (address: string): void => {
    if (!selectorSide) return;
    setForm((current) => ({ ...current, [selectorSide]: address }));
    setSelectorSide(undefined);
    setTokenSearch("");
  };

  return (
    <div className="grid gap-4">
      <Panel
        title="Swap"
        action={
          <ActionButton actionId="quote-swap" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("quote-swap", refreshQuote)}>
            <RefreshCw className="h-4 w-4" />
            Quote
          </ActionButton>
        }
      >
        <div className="border-t border-zinc-800 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant={swapTone(quote)}>{swapStatus(quote)}</Badge>
                <Badge variant="muted">{swapPairLabel(quote, form)}</Badge>
              </div>
              <h1 className="m-0 text-2xl font-semibold tracking-normal text-zinc-50 sm:text-3xl">AMM Swap</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button aria-label="Flip swap direction" title="Flip swap direction" size="icon" variant="secondary" onClick={() => flipSwap(setForm)}>
                <ArrowDownUp className="h-4 w-4" />
              </Button>
              <Button variant="secondary" onClick={() => setForm((current) => ({ ...current, deadline: defaultSwapDeadline() }))}>
                Reset Deadline
              </Button>
            </div>
          </div>
          {quote?.error ? <p className="m-0 mt-4 rounded-md border border-amber-950 bg-amber-950/30 p-3 text-sm text-amber-100">{quote.error}</p> : null}
        </div>

        <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 md:grid-cols-2">
          <TokenSelectField
            label="From token"
            loading={tokenListLoading}
            option={inputToken}
            otherToken={form.tokenOut}
            tokenCount={tokenList.tokens.length}
            value={form.tokenIn}
            onOpen={() => openSelector("tokenIn")}
          />
          <TokenSelectField
            label="To token"
            loading={tokenListLoading}
            option={outputToken}
            otherToken={form.tokenIn}
            tokenCount={tokenList.tokens.length}
            value={form.tokenOut}
            onOpen={() => openSelector("tokenOut")}
          />
          <TextField form={form} field="amountIn" inputMode="decimal" label="Amount in" setForm={setForm} />
          <TextField form={form} field="slippageBps" inputMode="numeric" label="Slippage bps" setForm={setForm} />
          <TextField form={form} field="recipient" label="Recipient" placeholder={account ?? "Wallet"} setForm={setForm} />
          <TextField form={form} field="deadline" inputMode="numeric" label="Deadline" setForm={setForm} />
        </div>

        <ActionRow>
          <ActionButton actionId="approve-swap-input" disabled={!canApprove} pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("approve-swap-input", approveInput)}>
            <ShieldCheck className="h-4 w-4" />
            Approve
          </ActionButton>
          <ActionButton actionId="execute-swap" disabled={!canSwap} pendingAction={pendingAction} onClick={() => void runAction("execute-swap", executeSwap)}>
            <ArrowDownUp className="h-4 w-4" />
            Swap
          </ActionButton>
        </ActionRow>

        <Facts
          columns="three"
          items={[
            { label: "Router", value: deployment?.ammRouter ? <AddressLink address={deployment.ammRouter} /> : "Missing" },
            { label: "Pool", value: quote?.pool ? <AddressLink address={quote.pool.address} /> : "None" },
            { label: "Fee", value: quote?.feeBps !== undefined ? `${quote.feeBps.toString()} bps` : "Unknown" },
            { label: "Expected output", value: formatSwapAmount(quote?.amountOut, quote?.tokenOut) },
            { label: "Minimum received", value: formatSwapAmount(quote?.amountOutMin, quote?.tokenOut) },
            { label: "Approval", value: approvalLabel(quote?.tokenIn, quote?.amountIn) },
            { label: "From balance", value: formatSwapAmount(quote?.tokenIn?.balance, quote?.tokenIn) },
            { label: "Reserve in", value: formatSwapAmount(quote?.pool?.reserveIn, quote?.tokenIn) },
            { label: "Reserve out", value: formatSwapAmount(quote?.pool?.reserveOut, quote?.tokenOut) },
          ]}
        />
      </Panel>

      {selectorSide ? (
        <TokenSelectorDialog
          error={tokenList.error}
          label={selectorLabel}
          loading={tokenListLoading}
          otherToken={selectorOtherToken}
          pendingAction={pendingAction}
          query={tokenSearch}
          selected={selectorSelected}
          tokens={tokenList.tokens}
          value={selectorValue}
          refreshTokens={refreshTokens}
          runAction={runAction}
          setQuery={setTokenSearch}
          onClose={() => setSelectorSide(undefined)}
          onSelect={selectToken}
        />
      ) : null}
    </div>
  );
}

function TokenSelectField({
  label,
  loading,
  option,
  otherToken,
  tokenCount,
  value,
  onOpen,
}: {
  label: string;
  loading: boolean;
  option: SwapTokenOption | undefined;
  otherToken: string;
  tokenCount: number;
  value: string;
  onOpen: () => void;
}): React.JSX.Element {
  const title = tokenTitle(option, value);
  const subtitle = tokenSubtitle(option, value);
  const route = tokenRouteLabel(option, otherToken);

  return (
    <Field label={label}>
      <button
        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-left outline-none transition-colors hover:border-zinc-700 hover:bg-zinc-900 focus:border-lime-300/70 focus:ring-2 focus:ring-lime-300/10"
        type="button"
        onClick={onOpen}
      >
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-zinc-50">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-zinc-500">{subtitle}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Badge variant={route === "Direct pool" ? "default" : route === "No direct pool" ? "warning" : "muted"}>{loading ? "Loading" : route || `${tokenCount.toString()} tokens`}</Badge>
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        </span>
      </button>
    </Field>
  );
}

function TokenSelectorDialog({
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
    () => sortedTokensForSelection(tokens, otherToken).filter((token) => tokenMatchesQuery(token, normalizedQuery)),
    [normalizedQuery, otherToken, tokens],
  );
  const customAddress = isAddress(normalizedQuery) && !tokens.some((token) => sameAddress(token.address, normalizedQuery)) ? normalizedQuery : undefined;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={onClose}>
      <div
        aria-label={label}
        aria-modal="true"
        className="max-h-[min(760px,calc(100vh-2rem))] w-full max-w-lg overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="min-w-0">
            <h2 className="m-0 text-base font-semibold tracking-normal text-zinc-50">{label}</h2>
            <p className="m-0 mt-0.5 text-xs text-zinc-500">{tokens.length.toString()} listed tokens</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ActionButton actionId="refresh-swap-tokens" pendingAction={pendingAction} size="icon" title="Refresh token list" variant="secondary" onClick={() => void runAction("refresh-swap-tokens", refreshTokens)}>
              <RefreshCw className="h-4 w-4" />
            </ActionButton>
            <Button aria-label="Close token selector" size="icon" title="Close token selector" variant="secondary" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="border-b border-zinc-800 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
            <Input
              autoFocus
              className="pl-9"
              placeholder="Search symbol or paste token address"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {error ? <p className="m-0 mt-3 rounded-md border border-amber-950 bg-amber-950/30 p-3 text-sm text-amber-100">{error}</p> : null}
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {customAddress ? (
            <TokenRow
              actionLabel="Custom"
              active={sameAddress(customAddress, value)}
              address={customAddress}
              routeLabel="Custom address"
              subtitle="Not in the discovered pool list"
              title={shortTokenAddress(customAddress)}
              onSelect={onSelect}
            />
          ) : null}

          {visibleTokens.map((token) => (
            <TokenRow
              key={token.address.toLowerCase()}
              actionLabel={token.sources.includes("seed") ? "Pinned" : undefined}
              active={selected ? sameAddress(token.address, selected.address) : sameAddress(token.address, value)}
              address={token.address}
              balance={formatSwapAmount(token.balance, token)}
              routeLabel={tokenRouteLabel(token, otherToken)}
              subtitle={tokenRowSubtitle(token)}
              title={tokenTitle(token, token.address)}
              onSelect={onSelect}
            />
          ))}

          {!loading && visibleTokens.length === 0 && !customAddress ? (
            <div className="p-6 text-center text-sm text-zinc-500">No matching token</div>
          ) : null}
          {loading && visibleTokens.length === 0 ? <div className="p-6 text-center text-sm text-zinc-500">Loading tokens</div> : null}
        </div>
      </div>
    </div>
  );
}

function TokenRow({
  actionLabel,
  active,
  address,
  balance,
  routeLabel,
  subtitle,
  title,
  onSelect,
}: {
  actionLabel: string | undefined;
  active: boolean;
  address: string;
  balance?: string | undefined;
  routeLabel: string;
  subtitle: string;
  title: string;
  onSelect: (address: string) => void;
}): React.JSX.Element {
  return (
    <button
      className="flex w-full items-center justify-between gap-3 border-b border-zinc-900 px-4 py-3 text-left transition-colors hover:bg-zinc-900/80 focus:bg-zinc-900 focus:outline-none"
      type="button"
      onClick={() => onSelect(address)}
    >
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-zinc-100">{title}</span>
          {actionLabel ? <Badge variant="muted">{actionLabel}</Badge> : null}
        </span>
        <span className="mt-1 block truncate text-xs text-zinc-500">{subtitle}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="hidden max-w-32 truncate text-right text-xs text-zinc-500 sm:block">{balance}</span>
        <Badge variant={routeLabel === "Direct pool" ? "default" : routeLabel === "No direct pool" ? "warning" : "muted"}>{routeLabel}</Badge>
        {active ? <Check className="h-4 w-4 text-lime-300" /> : null}
      </span>
    </button>
  );
}

function TextField<K extends keyof SwapForm & string>({
  form,
  field,
  inputMode,
  label,
  placeholder,
  setForm,
}: {
  form: SwapForm;
  field: K;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  label: string;
  placeholder?: string;
  setForm: Dispatch<SetStateAction<SwapForm>>;
}): React.JSX.Element {
  return (
    <Field label={label}>
      <Input
        value={form[field]}
        inputMode={inputMode}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
      />
    </Field>
  );
}

function flipSwap(setForm: Dispatch<SetStateAction<SwapForm>>): void {
  setForm((current) => ({
    ...current,
    tokenIn: current.tokenOut,
    tokenOut: current.tokenIn,
  }));
}

function approvalLabel(token: SwapTokenMetadata | undefined, amountIn: bigint | undefined): string {
  if (!token || amountIn === undefined) return "Unknown";
  const allowance = token.allowance ?? 0n;
  return allowance >= amountIn ? "Approved" : `${formatSwapAmount(allowance, token)} approved`;
}

function swapStatus(quote: SwapQuoteState | undefined): string {
  if (!quote) return "Not quoted";
  if (swapQuoteReady(quote)) return "Ready";
  if (quote.error?.startsWith("No AMM pool")) return "No pool";
  return "Blocked";
}

function swapTone(quote: SwapQuoteState | undefined): "default" | "muted" | "warning" | "danger" {
  if (!quote) return "muted";
  if (swapQuoteReady(quote)) return "default";
  if (quote.error?.startsWith("No AMM pool")) return "warning";
  return "danger";
}

function selectedTokenOption(value: string, tokens: SwapTokenOption[], quoteToken: SwapTokenMetadata | undefined): SwapTokenOption | undefined {
  const discovered = tokens.find((token) => sameAddress(token.address, value));
  if (discovered) return discovered;
  if (quoteToken && sameAddress(quoteToken.address, value)) {
    return { ...quoteToken, sources: ["custom"], pools: [], pairAddresses: [] };
  }
  return undefined;
}

function sortedTokensForSelection(tokens: SwapTokenOption[], otherToken: string): SwapTokenOption[] {
  return [...tokens].sort(
    (left, right) =>
      tokenSelectionRank(left, otherToken) - tokenSelectionRank(right, otherToken)
      || tokenTitle(left, left.address).localeCompare(tokenTitle(right, right.address))
      || left.address.localeCompare(right.address),
  );
}

function tokenSelectionRank(token: SwapTokenOption, otherToken: string): number {
  if (hasDirectPool(token, otherToken)) return 0;
  if (token.label === "WHYPE") return 1;
  if (token.label === "USDC / cash") return 2;
  if (token.sources.includes("seed")) return 3;
  if (token.sources.includes("pool")) return 4;
  return 5;
}

function tokenMatchesQuery(token: SwapTokenOption, query: string): boolean {
  if (!query) return true;
  const haystack = [token.symbol, token.label, token.address].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function tokenTitle(option: SwapTokenOption | undefined, value: string): string {
  if (option?.symbol) return option.symbol;
  if (option?.label) return option.label;
  return isAddress(value) ? shortTokenAddress(value) : "Select token";
}

function tokenSubtitle(option: SwapTokenOption | undefined, value: string): string {
  if (option?.label && option.symbol && option.label !== option.symbol) return option.label;
  if (isAddress(value)) return shortTokenAddress(value);
  return "Pools, WHYPE, USDC, or address";
}

function tokenRowSubtitle(token: SwapTokenOption): string {
  const poolLabel = token.pools.length === 1 ? "1 pool" : `${token.pools.length.toString()} pools`;
  const label = token.label && token.symbol !== token.label ? `${token.label} · ` : "";
  return `${label}${shortTokenAddress(token.address)} · ${poolLabel}`;
}

function tokenRouteLabel(option: SwapTokenOption | undefined, otherToken: string): string {
  if (!option) return "";
  if (isAddress(otherToken)) return hasDirectPool(option, otherToken) ? "Direct pool" : "No direct pool";
  if (option.pools.length > 0) return option.pools.length === 1 ? "1 pool" : `${option.pools.length.toString()} pools`;
  return "Pinned";
}

function hasDirectPool(option: SwapTokenOption, otherToken: string): boolean {
  return isAddress(otherToken) && option.pairAddresses.some((address) => sameAddress(address, otherToken));
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function shortTokenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
