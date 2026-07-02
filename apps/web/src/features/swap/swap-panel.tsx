import type { Address, PledgeCashDeployment } from "@pledge.cash/sdk";
import { ArrowDownUp, Check, ChevronDown, Coins, Droplets, RefreshCw, Search, ShieldCheck, WalletCards, X } from "lucide-react";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { isAddress } from "viem";
import { ActionButton, ActionRow, AddressLink, Facts, Field, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  defaultSwapDeadline,
  formatPoolShareBps,
  formatSwapAmount,
  liquidityQuoteReady,
  pairHasWrappedNative,
  removeLiquidityQuoteReady,
  swapNativeMode,
  swapPairLabel,
  swapQuoteReady,
  type AmmPositionState,
  type LiquidityForm,
  type LiquidityQuoteState,
  type RemoveLiquidityForm,
  type RemoveLiquidityQuoteState,
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
  liquidityForm: LiquidityForm;
  liquidityQuote: LiquidityQuoteState | undefined;
  position: AmmPositionState | undefined;
  pendingAction: string | undefined;
  quote: SwapQuoteState | undefined;
  removeLiquidityForm: RemoveLiquidityForm;
  removeLiquidityQuote: RemoveLiquidityQuoteState | undefined;
  setLiquidityForm: Dispatch<SetStateAction<LiquidityForm>>;
  setRemoveLiquidityForm: Dispatch<SetStateAction<RemoveLiquidityForm>>;
  setForm: Dispatch<SetStateAction<SwapForm>>;
  tokenList: SwapTokenListState;
  tokenListLoading: boolean;
  addLiquidity: () => Promise<void>;
  approveLiquidityTokenA: () => Promise<void>;
  approveLiquidityTokenB: () => Promise<void>;
  approveLpToken: () => Promise<void>;
  approveInput: () => Promise<void>;
  claimAmmFees: () => Promise<void>;
  executeSwap: () => Promise<void>;
  refreshLiquidityQuote: () => Promise<void>;
  refreshPosition: () => Promise<void>;
  refreshQuote: () => Promise<void>;
  refreshRemoveLiquidityQuote: () => Promise<void>;
  refreshTokens: () => Promise<void>;
  removeLiquidity: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
};

type TokenSide = "tokenIn" | "tokenOut" | "tokenA" | "tokenB";

export function SwapPanel({
  account,
  deployment,
  form,
  liquidityForm,
  liquidityQuote,
  position,
  pendingAction,
  quote,
  removeLiquidityForm,
  removeLiquidityQuote,
  setLiquidityForm,
  setRemoveLiquidityForm,
  setForm,
  tokenList,
  tokenListLoading,
  addLiquidity,
  approveLiquidityTokenA,
  approveLiquidityTokenB,
  approveLpToken,
  approveInput,
  claimAmmFees,
  executeSwap,
  refreshLiquidityQuote,
  refreshPosition,
  refreshQuote,
  refreshRemoveLiquidityQuote,
  refreshTokens,
  removeLiquidity,
  runAction,
}: SwapPanelProps): React.JSX.Element {
  const [selectorSide, setSelectorSide] = useState<TokenSide>();
  const [tokenSearch, setTokenSearch] = useState("");
  const ready = swapQuoteReady(quote);
  const swapNativeAvailable = pairHasWrappedNative(deployment, form.tokenIn, form.tokenOut);
  const swapNative = swapNativeMode(deployment, form);
  const swapWrappedSide = wrappedSwapSide(deployment, form);
  const swapInputIsNative = swapNative === "input";
  const needsApproval = ready && !swapInputIsNative && (quote.tokenIn.allowance ?? 0n) < quote.amountIn;
  const canApprove = Boolean(account && ready && !swapInputIsNative);
  const canSwap = Boolean(account && ready && !needsApproval);
  const inputToken = selectedTokenOption(form.tokenIn, tokenList.tokens, quote?.tokenIn);
  const outputToken = selectedTokenOption(form.tokenOut, tokenList.tokens, quote?.tokenOut);
  const tokenA = selectedTokenOption(liquidityForm.tokenA, tokenList.tokens, liquidityQuote?.tokenA ?? position?.tokenA);
  const tokenB = selectedTokenOption(liquidityForm.tokenB, tokenList.tokens, liquidityQuote?.tokenB ?? position?.tokenB);
  const addReady = liquidityQuoteReady(liquidityQuote);
  const removeReady = removeLiquidityQuoteReady(removeLiquidityQuote);
  const nativeAvailable = pairHasWrappedNative(deployment, liquidityForm.tokenA, liquidityForm.tokenB);
  const tokenAIsNative = liquidityForm.useNative && nativeAvailable && deployment?.wrappedNative !== undefined && sameAddress(liquidityForm.tokenA, deployment.wrappedNative);
  const tokenBIsNative = liquidityForm.useNative && nativeAvailable && deployment?.wrappedNative !== undefined && sameAddress(liquidityForm.tokenB, deployment.wrappedNative);
  const needsTokenAApproval = addReady && !tokenAIsNative && (liquidityQuote.tokenA.allowance ?? 0n) < liquidityQuote.amountA;
  const needsTokenBApproval = addReady && !tokenBIsNative && (liquidityQuote.tokenB.allowance ?? 0n) < liquidityQuote.amountB;
  const needsLpApproval = removeReady && (removeLiquidityQuote.position.lpAllowance ?? 0n) < removeLiquidityQuote.liquidity;
  const canAddLiquidity = Boolean(account && addReady && !needsTokenAApproval && !needsTokenBApproval);
  const canApproveTokenA = Boolean(account && addReady && !tokenAIsNative);
  const canApproveTokenB = Boolean(account && addReady && !tokenBIsNative);
  const canApproveLp = Boolean(account && removeReady);
  const canRemoveLiquidity = Boolean(account && removeReady && !needsLpApproval);
  const canClaimFees = Boolean(account && position?.pool?.exists);
  const selectorLabel = tokenSelectorLabel(selectorSide);
  const selectorValue = tokenSelectorValue(selectorSide, form, liquidityForm);
  const selectorOtherToken = tokenSelectorOtherValue(selectorSide, form, liquidityForm);
  const selectorSelected = selectedTokenOption(selectorValue, tokenList.tokens, selectorSide === "tokenIn" ? quote?.tokenIn : selectorSide === "tokenOut" ? quote?.tokenOut : selectorSide === "tokenA" ? liquidityQuote?.tokenA ?? position?.tokenA : liquidityQuote?.tokenB ?? position?.tokenB);

  const openSelector = (side: TokenSide): void => {
    setSelectorSide(side);
    setTokenSearch("");
  };

  const selectToken = (address: string): void => {
    if (!selectorSide) return;
    if (selectorSide === "tokenIn" || selectorSide === "tokenOut") {
      setForm((current) => ({ ...current, [selectorSide]: address }));
    } else {
      setLiquidityForm((current) => ({ ...current, [selectorSide]: address }));
    }
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
          <NativeModeField
            checked={form.useNative}
            disabled={!swapNativeAvailable}
            label="Native swap"
            text={nativeSwapText(swapNativeAvailable, swapNative ?? swapWrappedSide)}
            onChange={(checked) => setForm((current) => ({ ...current, useNative: checked }))}
          />
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
            { label: "Approval", value: swapInputIsNative ? "Native value" : approvalLabel(quote?.tokenIn, quote?.amountIn) },
            { label: "From balance", value: formatSwapAmount(quote?.tokenIn?.balance, quote?.tokenIn) },
            { label: "Reserve in", value: formatSwapAmount(quote?.pool?.reserveIn, quote?.tokenIn) },
            { label: "Reserve out", value: formatSwapAmount(quote?.pool?.reserveOut, quote?.tokenOut) },
          ]}
        />
      </Panel>

      <Panel
        title="Liquidity"
        action={
          <ActionButton actionId="quote-liquidity" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("quote-liquidity", refreshLiquidityQuote)}>
            <RefreshCw className="h-4 w-4" />
            Quote
          </ActionButton>
        }
      >
        <div className="border-t border-zinc-800 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant={liquidityTone(liquidityQuote)}>{liquidityStatus(liquidityQuote)}</Badge>
                <Badge variant="muted">{liquidityPairLabel(liquidityQuote, liquidityForm)}</Badge>
              </div>
              <h2 className="m-0 text-xl font-semibold tracking-normal text-zinc-50 sm:text-2xl">Add Liquidity</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button aria-label="Flip liquidity pair" title="Flip liquidity pair" size="icon" variant="secondary" onClick={() => flipLiquidityPair(setLiquidityForm)}>
                <ArrowDownUp className="h-4 w-4" />
              </Button>
              <Button variant="secondary" onClick={() => setLiquidityForm((current) => ({ ...current, deadline: defaultSwapDeadline() }))}>
                Reset Deadline
              </Button>
            </div>
          </div>
          {liquidityQuote?.error ? <p className="m-0 mt-4 rounded-md border border-amber-950 bg-amber-950/30 p-3 text-sm text-amber-100">{liquidityQuote.error}</p> : null}
        </div>

        <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 md:grid-cols-2">
          <TokenSelectField
            label="Token A"
            loading={tokenListLoading}
            option={tokenA}
            otherToken={liquidityForm.tokenB}
            tokenCount={tokenList.tokens.length}
            value={liquidityForm.tokenA}
            onOpen={() => openSelector("tokenA")}
          />
          <TokenSelectField
            label="Token B"
            loading={tokenListLoading}
            option={tokenB}
            otherToken={liquidityForm.tokenA}
            tokenCount={tokenList.tokens.length}
            value={liquidityForm.tokenB}
            onOpen={() => openSelector("tokenB")}
          />
          <TextField form={liquidityForm} field="amountA" inputMode="decimal" label="Amount A" setForm={setLiquidityForm} />
          <TextField form={liquidityForm} field="amountB" inputMode="decimal" label="Amount B" setForm={setLiquidityForm} />
          <TextField form={liquidityForm} field="slippageBps" inputMode="numeric" label="Slippage bps" setForm={setLiquidityForm} />
          <TextField form={liquidityForm} field="recipient" label="LP recipient" placeholder={account ?? "Wallet"} setForm={setLiquidityForm} />
          <TextField form={liquidityForm} field="deadline" inputMode="numeric" label="Deadline" setForm={setLiquidityForm} />
          <NativeModeField
            checked={liquidityForm.useNative}
            disabled={!nativeAvailable}
            label="Use native"
            text={nativeAvailable ? "Supply native instead of wrapped native" : "Select the wrapped-native token pair"}
            onChange={(checked) => setLiquidityForm((current) => ({ ...current, useNative: checked }))}
          />
        </div>

        <ActionRow>
          <ActionButton actionId="approve-liquidity-token-a" disabled={!canApproveTokenA} pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("approve-liquidity-token-a", approveLiquidityTokenA)}>
            <ShieldCheck className="h-4 w-4" />
            Approve A
          </ActionButton>
          <ActionButton actionId="approve-liquidity-token-b" disabled={!canApproveTokenB} pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("approve-liquidity-token-b", approveLiquidityTokenB)}>
            <ShieldCheck className="h-4 w-4" />
            Approve B
          </ActionButton>
          <ActionButton actionId="add-liquidity" disabled={!canAddLiquidity} pendingAction={pendingAction} onClick={() => void runAction("add-liquidity", addLiquidity)}>
            <Droplets className="h-4 w-4" />
            Add Liquidity
          </ActionButton>
        </ActionRow>

        <Facts
          columns="three"
          items={[
            { label: "Pool", value: liquidityQuote?.pool ? <AddressLink address={liquidityQuote.pool.address} /> : "Unknown" },
            { label: "Pool status", value: liquidityQuote?.pool ? liquidityQuote.pool.exists ? "Existing" : "Creates on add" : "Unknown" },
            { label: "LP minted", value: formatSwapAmount(liquidityQuote?.liquidityOut, liquidityQuote?.pool ? { address: liquidityQuote.pool.address, decimals: 18, symbol: "LP" } : undefined) },
            { label: "Token A used", value: formatSwapAmount(liquidityQuote?.amountA, liquidityQuote?.tokenA) },
            { label: "Token B used", value: formatSwapAmount(liquidityQuote?.amountB, liquidityQuote?.tokenB) },
            { label: "Minimum A", value: formatSwapAmount(liquidityQuote?.amountAMin, liquidityQuote?.tokenA) },
            { label: "Minimum B", value: formatSwapAmount(liquidityQuote?.amountBMin, liquidityQuote?.tokenB) },
            { label: "Token A approval", value: tokenAIsNative ? "Native value" : approvalLabel(liquidityQuote?.tokenA, liquidityQuote?.amountA) },
            { label: "Token B approval", value: tokenBIsNative ? "Native value" : approvalLabel(liquidityQuote?.tokenB, liquidityQuote?.amountB) },
          ]}
        />
      </Panel>

      <Panel
        title="LP Position"
        action={
          <ActionButton actionId="refresh-amm-position" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("refresh-amm-position", refreshPosition)}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </ActionButton>
        }
      >
        <div className="border-t border-zinc-800 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant={position?.pool?.exists ? "default" : "muted"}>{position?.pool?.exists ? "Pool loaded" : "No position"}</Badge>
                <Badge variant="muted">{liquidityPairLabel(liquidityQuote, liquidityForm)}</Badge>
              </div>
              <h2 className="m-0 text-xl font-semibold tracking-normal text-zinc-50 sm:text-2xl">Manage LP</h2>
            </div>
            <ActionButton actionId="claim-amm-fees" disabled={!canClaimFees} pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("claim-amm-fees", claimAmmFees)}>
              <Coins className="h-4 w-4" />
              Claim Fees
            </ActionButton>
          </div>
          {position?.error ? <p className="m-0 mt-4 rounded-md border border-amber-950 bg-amber-950/30 p-3 text-sm text-amber-100">{position.error}</p> : null}
          {removeLiquidityQuote?.error ? <p className="m-0 mt-4 rounded-md border border-amber-950 bg-amber-950/30 p-3 text-sm text-amber-100">{removeLiquidityQuote.error}</p> : null}
        </div>

        <Facts
          columns="three"
          items={[
            { label: "Pool", value: position?.pool?.exists ? <AddressLink address={position.pool.address} /> : "None" },
            { label: "LP balance", value: formatSwapAmount(position?.lpBalance, position?.lpToken) },
            { label: "Pool share", value: formatPoolShareBps(position?.poolShareBps) },
            { label: "Claimable A", value: formatSwapAmount(position?.claimableA, position?.tokenA) },
            { label: "Claimable B", value: formatSwapAmount(position?.claimableB, position?.tokenB) },
            { label: "LP approval", value: lpApprovalLabel(position, removeLiquidityQuote?.liquidity) },
            { label: "Reserve A", value: formatSwapAmount(position?.pool?.reserveA, position?.tokenA) },
            { label: "Reserve B", value: formatSwapAmount(position?.pool?.reserveB, position?.tokenB) },
            { label: "LP supply", value: formatSwapAmount(position?.pool?.totalSupply, position?.lpToken) },
          ]}
        />

        <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 md:grid-cols-2">
          <TextField form={removeLiquidityForm} field="liquidity" inputMode="decimal" label="LP amount" setForm={setRemoveLiquidityForm} />
          <TextField form={removeLiquidityForm} field="slippageBps" inputMode="numeric" label="Slippage bps" setForm={setRemoveLiquidityForm} />
          <TextField form={removeLiquidityForm} field="recipient" label="Withdraw recipient" placeholder={account ?? "Wallet"} setForm={setRemoveLiquidityForm} />
          <TextField form={removeLiquidityForm} field="deadline" inputMode="numeric" label="Deadline" setForm={setRemoveLiquidityForm} />
          <NativeModeField
            checked={removeLiquidityForm.useNative}
            disabled={!nativeAvailable}
            label="Receive native"
            text={nativeAvailable ? "Unwrap wrapped native on removal" : "Select the wrapped-native token pair"}
            onChange={(checked) => setRemoveLiquidityForm((current) => ({ ...current, useNative: checked }))}
          />
        </div>

        <ActionRow>
          <ActionButton actionId="quote-remove-liquidity" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("quote-remove-liquidity", refreshRemoveLiquidityQuote)}>
            <RefreshCw className="h-4 w-4" />
            Quote Remove
          </ActionButton>
          <ActionButton actionId="approve-lp-token" disabled={!canApproveLp} pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("approve-lp-token", approveLpToken)}>
            <ShieldCheck className="h-4 w-4" />
            Approve LP
          </ActionButton>
          <ActionButton actionId="remove-liquidity" disabled={!canRemoveLiquidity} pendingAction={pendingAction} variant="danger" onClick={() => void runAction("remove-liquidity", removeLiquidity)}>
            <WalletCards className="h-4 w-4" />
            Remove Liquidity
          </ActionButton>
        </ActionRow>

        <Facts
          columns="two"
          items={[
            { label: "Expected A", value: formatSwapAmount(removeLiquidityQuote?.amountA, removeLiquidityQuote?.position?.tokenA) },
            { label: "Expected B", value: formatSwapAmount(removeLiquidityQuote?.amountB, removeLiquidityQuote?.position?.tokenB) },
            { label: "Minimum A", value: formatSwapAmount(removeLiquidityQuote?.amountAMin, removeLiquidityQuote?.position?.tokenA) },
            { label: "Minimum B", value: formatSwapAmount(removeLiquidityQuote?.amountBMin, removeLiquidityQuote?.position?.tokenB) },
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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

type StringField<TForm> = {
  [K in keyof TForm]: TForm[K] extends string ? K : never;
}[keyof TForm] & string;

function TextField<TForm extends Record<string, unknown>, K extends StringField<TForm>>({
  form,
  field,
  inputMode,
  label,
  placeholder,
  setForm,
}: {
  form: TForm;
  field: K;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  label: string;
  placeholder?: string;
  setForm: Dispatch<SetStateAction<TForm>>;
}): React.JSX.Element {
  return (
    <Field label={label}>
      <Input
        value={String(form[field])}
        inputMode={inputMode}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
      />
    </Field>
  );
}

function NativeModeField({
  checked,
  disabled,
  label,
  text,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  text: string;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <Field label={label}>
      <button
        aria-checked={checked}
        className="flex min-h-10 w-full items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-sm text-zinc-200 outline-none transition-colors hover:border-zinc-700 hover:bg-zinc-900 focus:border-lime-300/70 focus:ring-2 focus:ring-lime-300/10 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        role="checkbox"
        type="button"
        onClick={() => onChange(!checked)}
      >
        <span className="min-w-0 truncate">{text}</span>
        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${checked ? "border-lime-300 bg-lime-300 text-zinc-950" : "border-zinc-700 text-transparent"}`}>
          <Check className="h-3.5 w-3.5" />
        </span>
      </button>
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

function nativeSwapText(nativeAvailable: boolean, nativeMode: "input" | "output" | undefined): string {
  if (!nativeAvailable) return "Select the wrapped-native pair";
  if (nativeMode === "input") return "Pay native instead of wrapped native";
  if (nativeMode === "output") return "Receive native instead of wrapped native";
  return "Use native for the wrapped side";
}

function wrappedSwapSide(deployment: PledgeCashDeployment | undefined, form: SwapForm): "input" | "output" | undefined {
  const wrappedNative = deployment?.wrappedNative;
  if (!wrappedNative) return undefined;
  if (sameAddress(form.tokenIn, wrappedNative)) return "input";
  if (sameAddress(form.tokenOut, wrappedNative)) return "output";
  return undefined;
}

function flipLiquidityPair(setForm: Dispatch<SetStateAction<LiquidityForm>>): void {
  setForm((current) => ({
    ...current,
    tokenA: current.tokenB,
    tokenB: current.tokenA,
    amountA: current.amountB,
    amountB: current.amountA,
  }));
}

function approvalLabel(token: SwapTokenMetadata | undefined, amountIn: bigint | undefined): string {
  if (!token || amountIn === undefined) return "Unknown";
  const allowance = token.allowance ?? 0n;
  return allowance >= amountIn ? "Approved" : `${formatSwapAmount(allowance, token)} approved`;
}

function lpApprovalLabel(position: AmmPositionState | undefined, liquidity: bigint | undefined): string {
  if (!position?.lpToken || liquidity === undefined) return "Unknown";
  const allowance = position.lpAllowance ?? position.lpToken.allowance ?? 0n;
  return allowance >= liquidity ? "Approved" : `${formatSwapAmount(allowance, position.lpToken)} approved`;
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

function liquidityStatus(quote: LiquidityQuoteState | undefined): string {
  if (!quote) return "Not quoted";
  if (liquidityQuoteReady(quote)) return quote.pool.exists ? "Ready" : "New pool";
  return "Blocked";
}

function liquidityTone(quote: LiquidityQuoteState | undefined): "default" | "muted" | "warning" | "danger" {
  if (!quote) return "muted";
  if (liquidityQuoteReady(quote)) return quote.pool.exists ? "default" : "warning";
  return "danger";
}

function liquidityPairLabel(quote: LiquidityQuoteState | undefined, form: LiquidityForm): string {
  const tokenA = quote?.tokenA?.symbol ?? shortTokenAddressOrFallback(form.tokenA);
  const tokenB = quote?.tokenB?.symbol ?? shortTokenAddressOrFallback(form.tokenB);
  return `${tokenA} / ${tokenB}`;
}

function tokenSelectorLabel(side: TokenSide | undefined): string {
  if (side === "tokenIn") return "From token";
  if (side === "tokenOut") return "To token";
  if (side === "tokenA") return "Token A";
  if (side === "tokenB") return "Token B";
  return "Token";
}

function tokenSelectorValue(side: TokenSide | undefined, swapForm: SwapForm, liquidityForm: LiquidityForm): string {
  if (side === "tokenIn" || side === "tokenOut") return swapForm[side];
  if (side === "tokenA" || side === "tokenB") return liquidityForm[side];
  return "";
}

function tokenSelectorOtherValue(side: TokenSide | undefined, swapForm: SwapForm, liquidityForm: LiquidityForm): string {
  if (side === "tokenIn") return swapForm.tokenOut;
  if (side === "tokenOut") return swapForm.tokenIn;
  if (side === "tokenA") return liquidityForm.tokenB;
  if (side === "tokenB") return liquidityForm.tokenA;
  return "";
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

function shortTokenAddressOrFallback(address: string): string {
  return isAddress(address) ? shortTokenAddress(address) : "Token";
}
