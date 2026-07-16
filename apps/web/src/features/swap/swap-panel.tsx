import type { Address, PledgeCashDeployment } from "@pledge.cash/sdk";
import { ArrowDownUp, Check, ChevronDown, Coins, Droplets, RefreshCw, Search, ShieldCheck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { isAddress } from "viem";
import { ActionButton, ActionRow, AddressLink, Facts, Field, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import type { Capability } from "../capabilities/project-capabilities";
import { ConnectWalletPrompt } from "../wallet/connect-wallet-prompt";
import type { ExactRational, MetricState, NormalizedPrice } from "../../lib/market-data";
import {
  formatPoolShareBps,
  formatSwapAmount,
  liquidityQuoteReady,
  pairHasWrappedNative,
  removeLiquidityQuoteReady,
  swapNativeMode,
  swapPairLabel,
  swapQuoteReady,
  swapQuoteRequestIdentity,
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
  actionCapability: Capability;
  deployment: PledgeCashDeployment | undefined;
  form: SwapForm;
  liquidityForm: LiquidityForm;
  liquidityQuote: LiquidityQuoteState | undefined;
  nativeBalance?: bigint | undefined;
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
  wrappedNativeSymbol: string;
  mode?: "all" | "liquidity" | "swap";
  lockSwapPair?: boolean | undefined;
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
  switchWalletNetwork: () => Promise<void>;
};

type TokenSide = "tokenIn" | "tokenOut" | "tokenA" | "tokenB";

type FactItem = {
  label: string;
  value: ReactNode;
};

type ActionDecision = {
  enabled: boolean;
  reason?: string | undefined;
};

type SwapActionState = {
  approve: ActionDecision;
  quoteReady: boolean;
  swap: ActionDecision;
};

type LiquidityActionState = {
  quoteReady: boolean;
  needsTokenAApproval: boolean;
  needsTokenBApproval: boolean;
  canApproveTokenA: boolean;
  canApproveTokenB: boolean;
  addLiquidity: ActionDecision;
};

type PositionActionState = {
  removeReady: boolean;
  needsLpApproval: boolean;
  canApproveLp: boolean;
  canRemoveLiquidity: boolean;
  canClaimFees: boolean;
};

export function SwapPanel({
  account,
  actionCapability,
  deployment,
  form,
  liquidityForm,
  liquidityQuote,
  nativeBalance,
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
  wrappedNativeSymbol,
  mode = "all",
  lockSwapPair = false,
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
  switchWalletNetwork,
}: SwapPanelProps): React.JSX.Element {
  const [selectorSide, setSelectorSide] = useState<TokenSide>();
  const [tokenSearch, setTokenSearch] = useState("");
  const [currentUnixTime, setCurrentUnixTime] = useState(() => Math.floor(Date.now() / 1000));
  const walletConnected = account !== undefined;

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentUnixTime(Math.floor(Date.now() / 1000)), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const swapNativeAvailable = pairHasWrappedNative(deployment, form.tokenIn, form.tokenOut);
  const swapNative = swapNativeMode(deployment, form);
  const swapWrappedSide = wrappedSwapSide(deployment, form);
  const swapInputIsNative = swapNative === "input";
  const swapDeadlineValid = deadlineIsFuture(form.deadline, currentUnixTime);
  const swapDecisionKey = swapDecisionFormKey(form);
  const swapQuoteCurrent = quote !== undefined && quote.requestIdentity === swapDecisionKey;
  const currentSwapQuote = swapQuoteCurrent ? quote : undefined;
  const swapActions = swapActionState(
    actionCapability,
    currentSwapQuote,
    swapInputIsNative,
    swapDeadlineValid,
    quote ? (swapQuoteCurrent ? "current" : "stale") : "missing",
    pendingAction,
    nativeBalance,
  );
  const inputToken = selectedTokenOption(form.tokenIn, tokenList.tokens, currentSwapQuote?.tokenIn);
  const outputToken = selectedTokenOption(form.tokenOut, tokenList.tokens, currentSwapQuote?.tokenOut);

  const tokenA = selectedTokenOption(liquidityForm.tokenA, tokenList.tokens, liquidityQuote?.tokenA ?? position?.tokenA);
  const tokenB = selectedTokenOption(liquidityForm.tokenB, tokenList.tokens, liquidityQuote?.tokenB ?? position?.tokenB);
  const liquidityNativeAvailable = pairHasWrappedNative(deployment, liquidityForm.tokenA, liquidityForm.tokenB);
  const tokenAIsNative = liquidityForm.useNative && liquidityNativeAvailable && deployment?.wrappedNative !== undefined && sameAddress(liquidityForm.tokenA, deployment.wrappedNative);
  const tokenBIsNative = liquidityForm.useNative && liquidityNativeAvailable && deployment?.wrappedNative !== undefined && sameAddress(liquidityForm.tokenB, deployment.wrappedNative);
  const liquidityDeadlineValid = deadlineIsFuture(liquidityForm.deadline, currentUnixTime);
  const removeDeadlineValid = deadlineIsFuture(removeLiquidityForm.deadline, currentUnixTime);
  const liquidityActions = liquidityActionState(
    actionCapability,
    liquidityQuote,
    tokenAIsNative,
    tokenBIsNative,
    liquidityDeadlineValid,
    nativeBalance,
  );
  const positionActions = positionActionState(actionCapability, position, removeLiquidityQuote, removeDeadlineValid);

  const selectorLabel = tokenSelectorLabel(selectorSide);
  const selectorValue = tokenSelectorValue(selectorSide, form, liquidityForm);
  const selectorOtherToken = tokenSelectorOtherValue(selectorSide, form, liquidityForm);
  const selectorQuoteToken = selectedTokenForSide(selectorSide, currentSwapQuote, liquidityQuote, position);
  const selectorSelected = selectedTokenOption(selectorValue, tokenList.tokens, selectorQuoteToken);

  const swapDecisionFacts = swapTransactionDecisionFacts(currentSwapQuote, form, currentUnixTime);
  const swapTechnicalFacts = swapTransactionTechnicalFacts(currentSwapQuote, swapInputIsNative, nativeBalance);
  const liquidityFacts = liquidityTransactionFacts(liquidityQuote, tokenAIsNative, tokenBIsNative);
  const positionFacts = lpPositionFacts(position, removeLiquidityQuote);
  const removeLiquidityFacts = removeLiquidityTransactionFacts(removeLiquidityQuote);

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

  useEffect(() => {
    if (lockSwapPair && (selectorSide === "tokenIn" || selectorSide === "tokenOut")) {
      setSelectorSide(undefined);
      setTokenSearch("");
    }
  }, [lockSwapPair, selectorSide]);

  return (
    <div className="grid gap-4">
      {actionCapability.status === "switch" ? (
        <div className="flex flex-col gap-3 rounded-md border border-amber-950 bg-amber-950/30 p-4 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0">{actionCapability.reason ?? "Switch your wallet to the active app network before submitting a market transaction."}</p>
          <Button
            className="shrink-0"
            disabled={pendingAction !== undefined}
            type="button"
            variant="secondary"
            onClick={() => void runAction("switch-market-chain", switchWalletNetwork)}
          >
            Switch wallet network
          </Button>
        </div>
      ) : null}
      {mode !== "liquidity" ? <Panel
        title="Swap"
        action={
          <ActionButton
            actionId="quote-swap"
            pendingAction={pendingAction}
            pendingLabel="Refreshing swap quote"
            type="button"
            variant="secondary"
            onClick={() => void runAction("quote-swap", refreshQuote)}
          >
            <RefreshCw className="h-4 w-4" />
            {pendingAction === "quote-swap" ? "Quoting…" : "Quote"}
          </ActionButton>
        }
      >
        <form
          aria-label="Swap tokens"
          onSubmit={(event) => {
            event.preventDefault();
            if (swapActions.swap.enabled) void runAction("execute-swap", executeSwap);
          }}
        >
          <div className="border-t border-zinc-800 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant={swapTone(quote, swapQuoteCurrent, swapDeadlineValid)}>{swapStatus(quote, swapQuoteCurrent, swapDeadlineValid)}</Badge>
                  <Badge variant="muted">{swapPairLabel(currentSwapQuote, form)}</Badge>
                </div>
                <h3 className="m-0 text-2xl font-semibold tracking-normal text-zinc-50 sm:text-3xl">AMM Swap</h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button aria-label="Flip swap direction" title="Flip swap direction" size="icon" type="button" variant="secondary" onClick={() => flipSwap(setForm)}>
                  <ArrowDownUp className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {quote && !swapQuoteCurrent ? (
              <p className="m-0 mt-4 rounded-md border border-amber-950 bg-amber-950/30 p-3 text-sm text-amber-100">
                Swap inputs or preferences changed. The previous decision metrics are stale and have been cleared; refresh the quote before acting.
              </p>
            ) : null}
            {currentSwapQuote?.error ? <p className="m-0 mt-4 rounded-md border border-amber-950 bg-amber-950/30 p-3 text-sm text-amber-100">{currentSwapQuote.error}</p> : null}
            {!walletConnected ? (
              <ConnectWalletPrompt description="Connect the wallet that will fund the swap to load its balance, allowance, and account-specific quote." />
            ) : null}
          </div>

          <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 md:grid-cols-2">
            <TokenSelectField
              disabled={lockSwapPair}
              label="From token"
              loading={tokenListLoading}
              option={inputToken}
              otherToken={form.tokenOut}
              tokenCount={tokenList.tokens.length}
              value={form.tokenIn}
              wrappedNativeSymbol={wrappedNativeSymbol}
              onOpen={() => openSelector("tokenIn")}
            />
            <TokenSelectField
              disabled={lockSwapPair}
              label="To token"
              loading={tokenListLoading}
              option={outputToken}
              otherToken={form.tokenIn}
              tokenCount={tokenList.tokens.length}
              value={form.tokenOut}
              wrappedNativeSymbol={wrappedNativeSymbol}
              onOpen={() => openSelector("tokenOut")}
            />
            <TextField form={form} field="amountIn" inputMode="decimal" label="Amount in" setForm={setForm} />
            <TextField form={form} field="recipient" label="Receive tokens at" placeholder={account ?? "Connected wallet"} setForm={setForm} />
            <ExecutionPreferences currentUnixTime={currentUnixTime} form={form} setForm={setForm} />
          </div>

          <Facts columns="three" items={swapDecisionFacts} />

          <TransactionTechnicalDetails
            deadline={form.deadline}
            items={swapTechnicalFacts}
            router={deployment?.ammRouter}
            nativeControl={swapNativeAvailable ? (
              <NativeModeField
                checked={form.useNative}
                disabled={false}
                label="Native asset handling"
                text={nativeSwapText(true, swapNative ?? swapWrappedSide)}
                onChange={(checked) => setForm((current) => ({ ...current, useNative: checked }))}
              />
            ) : undefined}
          />

          <ActionRow>
            <ActionControl reason={swapActions.approve.reason} reasonId="approve-swap-input-reason">
              <ActionButton
                actionId="approve-swap-input"
                aria-describedby={swapActions.approve.reason ? "approve-swap-input-reason" : undefined}
                disabled={!swapActions.approve.enabled}
                pendingAction={pendingAction}
                pendingLabel="Approving swap input"
                type="button"
                variant="secondary"
                onClick={() => void runAction("approve-swap-input", approveInput)}
              >
                <ShieldCheck className="h-4 w-4" />
                {pendingAction === "approve-swap-input" ? "Approving…" : "Approve"}
              </ActionButton>
            </ActionControl>
            <ActionControl reason={swapActions.swap.reason} reasonId="execute-swap-reason">
              <ActionButton
                actionId="execute-swap"
                aria-describedby={swapActions.swap.reason ? "execute-swap-reason" : undefined}
                disabled={!swapActions.swap.enabled}
                pendingAction={pendingAction}
                pendingLabel="Submitting swap"
                type="submit"
              >
                <ArrowDownUp className="h-4 w-4" />
                {pendingAction === "execute-swap" ? "Swapping…" : "Swap"}
              </ActionButton>
            </ActionControl>
          </ActionRow>
        </form>
      </Panel> : null}

      {mode !== "swap" ? <>
      <Panel
        title="Liquidity"
        action={
          <ActionButton actionId="quote-liquidity" pendingAction={pendingAction} type="button" variant="secondary" onClick={() => void runAction("quote-liquidity", refreshLiquidityQuote)}>
            <RefreshCw className="h-4 w-4" />
            Quote
          </ActionButton>
        }
      >
        <form
          aria-label="Add liquidity"
          onSubmit={(event) => {
            event.preventDefault();
            if (liquidityActions.addLiquidity.enabled) void runAction("add-liquidity", addLiquidity);
          }}
        >
        <div className="border-t border-zinc-800 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant={liquidityTone(liquidityQuote, liquidityDeadlineValid)}>{liquidityStatus(liquidityQuote, liquidityDeadlineValid)}</Badge>
                <Badge variant="muted">{liquidityPairLabel(liquidityQuote, liquidityForm)}</Badge>
              </div>
              <h2 className="m-0 text-xl font-semibold tracking-normal text-zinc-50 sm:text-2xl">Add Liquidity</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button aria-label="Flip liquidity pair" title="Flip liquidity pair" size="icon" type="button" variant="secondary" onClick={() => flipLiquidityPair(setLiquidityForm)}>
                <ArrowDownUp className="h-4 w-4" />
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
            wrappedNativeSymbol={wrappedNativeSymbol}
            onOpen={() => openSelector("tokenA")}
          />
          <TokenSelectField
            label="Token B"
            loading={tokenListLoading}
            option={tokenB}
            otherToken={liquidityForm.tokenA}
            tokenCount={tokenList.tokens.length}
            value={liquidityForm.tokenB}
            wrappedNativeSymbol={wrappedNativeSymbol}
            onOpen={() => openSelector("tokenB")}
          />
          <TextField form={liquidityForm} field="amountA" inputMode="decimal" label="Amount A" setForm={setLiquidityForm} />
          <TextField form={liquidityForm} field="amountB" inputMode="decimal" label="Amount B" setForm={setLiquidityForm} />
          <TextField form={liquidityForm} field="recipient" label="LP recipient" placeholder={account ?? "Wallet"} setForm={setLiquidityForm} />
          <ExecutionPreferences currentUnixTime={currentUnixTime} form={liquidityForm} setForm={setLiquidityForm} />
        </div>

        <TransactionTechnicalDetails
          deadline={liquidityForm.deadline}
          router={deployment?.ammRouter}
          nativeControl={liquidityNativeAvailable ? (
            <NativeModeField
              checked={liquidityForm.useNative}
              disabled={false}
              label="Native asset handling"
              text="Supply native currency instead of its wrapped token"
              onChange={(checked) => setLiquidityForm((current) => ({ ...current, useNative: checked }))}
            />
          ) : undefined}
        />

        <ActionRow>
          <ActionButton actionId="approve-liquidity-token-a" disabled={!liquidityActions.canApproveTokenA} pendingAction={pendingAction} type="button" variant="secondary" onClick={() => void runAction("approve-liquidity-token-a", approveLiquidityTokenA)}>
            <ShieldCheck className="h-4 w-4" />
            Approve A
          </ActionButton>
          <ActionButton actionId="approve-liquidity-token-b" disabled={!liquidityActions.canApproveTokenB} pendingAction={pendingAction} type="button" variant="secondary" onClick={() => void runAction("approve-liquidity-token-b", approveLiquidityTokenB)}>
            <ShieldCheck className="h-4 w-4" />
            Approve B
          </ActionButton>
          <ActionControl reason={liquidityActions.addLiquidity.reason} reasonId="add-liquidity-reason">
            <ActionButton
              actionId="add-liquidity"
              aria-describedby={liquidityActions.addLiquidity.reason ? "add-liquidity-reason" : undefined}
              disabled={!liquidityActions.addLiquidity.enabled}
              pendingAction={pendingAction}
              type="submit"
            >
              <Droplets className="h-4 w-4" />
              Add Liquidity
            </ActionButton>
          </ActionControl>
        </ActionRow>

        <Facts
          columns="three"
          items={liquidityFacts}
        />
        </form>
      </Panel>

      <Panel
        title="LP Position"
        action={
          <ActionButton actionId="refresh-amm-position" pendingAction={pendingAction} type="button" variant="secondary" onClick={() => void runAction("refresh-amm-position", refreshPosition)}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </ActionButton>
        }
      >
        <form
          aria-label="Remove liquidity"
          onSubmit={(event) => {
            event.preventDefault();
            if (positionActions.canRemoveLiquidity) void runAction("remove-liquidity", removeLiquidity);
          }}
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
            <ActionButton actionId="claim-amm-fees" disabled={!positionActions.canClaimFees} pendingAction={pendingAction} type="button" variant="secondary" onClick={() => void runAction("claim-amm-fees", claimAmmFees)}>
              <Coins className="h-4 w-4" />
              Claim Fees
            </ActionButton>
          </div>
          {position?.error ? <p className="m-0 mt-4 rounded-md border border-amber-950 bg-amber-950/30 p-3 text-sm text-amber-100">{position.error}</p> : null}
          {removeLiquidityQuote?.error ? <p className="m-0 mt-4 rounded-md border border-amber-950 bg-amber-950/30 p-3 text-sm text-amber-100">{removeLiquidityQuote.error}</p> : null}
        </div>

        <Facts
          columns="three"
          items={positionFacts}
        />

        <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 md:grid-cols-2">
          <TextField form={removeLiquidityForm} field="liquidity" inputMode="decimal" label="LP amount" setForm={setRemoveLiquidityForm} />
          <TextField form={removeLiquidityForm} field="recipient" label="Withdraw recipient" placeholder={account ?? "Wallet"} setForm={setRemoveLiquidityForm} />
          <ExecutionPreferences currentUnixTime={currentUnixTime} form={removeLiquidityForm} setForm={setRemoveLiquidityForm} />
        </div>

        <TransactionTechnicalDetails
          deadline={removeLiquidityForm.deadline}
          router={deployment?.ammRouter}
          nativeControl={liquidityNativeAvailable ? (
            <NativeModeField
              checked={removeLiquidityForm.useNative}
              disabled={false}
              label="Native asset handling"
              text="Receive native currency instead of its wrapped token"
              onChange={(checked) => setRemoveLiquidityForm((current) => ({ ...current, useNative: checked }))}
            />
          ) : undefined}
        />

        <ActionRow>
          <ActionButton actionId="quote-remove-liquidity" pendingAction={pendingAction} type="button" variant="secondary" onClick={() => void runAction("quote-remove-liquidity", refreshRemoveLiquidityQuote)}>
            <RefreshCw className="h-4 w-4" />
            Quote Remove
          </ActionButton>
          <ActionButton actionId="approve-lp-token" disabled={!positionActions.canApproveLp} pendingAction={pendingAction} type="button" variant="secondary" onClick={() => void runAction("approve-lp-token", approveLpToken)}>
            <ShieldCheck className="h-4 w-4" />
            Approve LP
          </ActionButton>
          <ActionButton actionId="remove-liquidity" disabled={!positionActions.canRemoveLiquidity} pendingAction={pendingAction} type="submit" variant="danger">
            <WalletCards className="h-4 w-4" />
            Remove Liquidity
          </ActionButton>
        </ActionRow>

        <Facts
          columns="two"
          items={removeLiquidityFacts}
        />
        </form>
      </Panel>
      </> : null}

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

function ActionControl({
  children,
  reason,
  reasonId,
}: {
  children: ReactNode;
  reason?: string | undefined;
  reasonId: string;
}): React.JSX.Element {
  return (
    <div className="min-w-[12rem] flex-1 sm:flex-initial">
      <div className="[&>*]:w-full">{children}</div>
      {reason ? <p className="m-0 mt-2 max-w-sm text-xs leading-5 text-zinc-400" id={reasonId}>{reason}</p> : null}
    </div>
  );
}

function TokenSelectField({
  disabled = false,
  label,
  loading,
  option,
  otherToken,
  tokenCount,
  value,
  wrappedNativeSymbol,
  onOpen,
}: {
  disabled?: boolean;
  label: string;
  loading: boolean;
  option: SwapTokenOption | undefined;
  otherToken: string;
  tokenCount: number;
  value: string;
  wrappedNativeSymbol: string;
  onOpen: () => void;
}): React.JSX.Element {
  const title = tokenTitle(option, value);
  const subtitle = tokenSubtitle(option, value, wrappedNativeSymbol);
  const route = tokenRouteLabel(option, otherToken);

  return (
    <Field label={label}>
      <button
        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-left outline-none transition-colors hover:border-zinc-700 hover:bg-zinc-900 focus:border-lime-300/70 focus:ring-2 focus:ring-lime-300/10 disabled:cursor-default disabled:opacity-80"
        disabled={disabled}
        type="button"
        onClick={onOpen}
      >
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-zinc-50">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-zinc-500">{subtitle}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Badge variant={route === "Direct pool" ? "default" : route === "No direct pool" ? "warning" : "muted"}>{loading ? "Loading" : route || `${tokenCount.toString()} tokens`}</Badge>
          {disabled ? <Badge variant="muted">Project pool</Badge> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
        </span>
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
    () => sortedTokensForSelection(tokens, otherToken).filter((token) => tokenMatchesQuery(token, normalizedQuery)),
    [normalizedQuery, otherToken, tokens],
  );
  const customAddress = isAddress(normalizedQuery) && !tokens.some((token) => sameAddress(token.address, normalizedQuery)) ? normalizedQuery : undefined;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="flex max-h-[min(760px,calc(100svh-2rem))] max-w-lg flex-col gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById("swap-token-search")?.focus();
        }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 pr-14">
          <DialogHeader className="min-w-0 text-left">
            <DialogTitle className="text-base">{label}</DialogTitle>
            <DialogDescription>{tokens.length.toString()} listed tokens. Search by symbol or paste a token address.</DialogDescription>
          </DialogHeader>
          <ActionButton
            actionId="refresh-swap-tokens"
            pendingAction={pendingAction}
            pendingLabel="Refreshing token list"
            size="icon"
            title="Refresh token list"
            type="button"
            variant="secondary"
            onClick={() => void runAction("refresh-swap-tokens", refreshTokens)}
          >
            <RefreshCw className="h-4 w-4" />
          </ActionButton>
        </div>

        <div className="border-b border-zinc-800 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
            <Input
              aria-label="Search tokens"
              id="swap-token-search"
              className="pl-9"
              placeholder="Search symbol or paste token address"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {error ? <p className="m-0 mt-3 rounded-md border border-amber-950 bg-amber-950/30 p-3 text-sm text-amber-100">{error}</p> : null}
        </div>

        <div aria-label="Available tokens" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
              actionLabel={undefined}
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
      </DialogContent>
    </Dialog>
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
      className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-zinc-900 px-4 py-3 text-left transition-colors hover:bg-zinc-900/80 focus:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime-300/70"
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

type ExecutionPreferenceForm = {
  deadline: string;
  slippageBps: string;
};

const SLIPPAGE_BPS_CHOICES = ["10", "50", "100", "200"] as const;
const DEADLINE_MINUTE_CHOICES = [10, 20, 30, 60] as const;

function ExecutionPreferences<TForm extends ExecutionPreferenceForm>({
  currentUnixTime,
  form,
  setForm,
}: {
  currentUnixTime: number;
  form: TForm;
  setForm: Dispatch<SetStateAction<TForm>>;
}): React.JSX.Element {
  const slippageChoices = SLIPPAGE_BPS_CHOICES.includes(form.slippageBps as typeof SLIPPAGE_BPS_CHOICES[number])
    ? SLIPPAGE_BPS_CHOICES
    : [form.slippageBps, ...SLIPPAGE_BPS_CHOICES];
  const deadlineMinutes = remainingDeadlineMinutes(form.deadline, currentUnixTime);
  const deadlineChoices = deadlineMinutes !== undefined
    && !DEADLINE_MINUTE_CHOICES.includes(deadlineMinutes as typeof DEADLINE_MINUTE_CHOICES[number])
    ? [deadlineMinutes, ...DEADLINE_MINUTE_CHOICES]
    : DEADLINE_MINUTE_CHOICES;
  const deadlineValue = deadlineMinutes === undefined ? "expired" : deadlineMinutes.toString();

  return (
    <>
      <Field label="Slippage tolerance">
        <select
          aria-label="Slippage tolerance"
          className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition-colors hover:border-zinc-700 focus:border-lime-300/70 focus:ring-2 focus:ring-lime-300/10"
          value={form.slippageBps}
          onChange={(event) => setForm((current) => ({ ...current, slippageBps: event.target.value }))}
        >
          {slippageChoices.map((basisPoints) => (
            <option key={basisPoints} value={basisPoints}>{formatSlippagePercent(basisPoints)}</option>
          ))}
        </select>
      </Field>
      <Field label="Quote expires in">
        <select
          aria-label="Quote expires in"
          className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition-colors hover:border-zinc-700 focus:border-lime-300/70 focus:ring-2 focus:ring-lime-300/10"
          value={deadlineValue}
          onChange={(event) => setForm((current) => ({
            ...current,
            deadline: deadlineFromMinutes(Number(event.target.value), currentUnixTime),
          }))}
        >
          {deadlineMinutes === undefined ? <option disabled value="expired">Expired — choose a new window</option> : null}
          {deadlineChoices.map((minutes) => (
            <option key={minutes} value={minutes}>{minutes.toString()} min</option>
          ))}
        </select>
        {deadlineMinutes === undefined ? (
          <span className="text-xs font-normal leading-5 text-amber-200">Choose a fresh window before submitting.</span>
        ) : null}
      </Field>
    </>
  );
}

function TransactionTechnicalDetails({
  deadline,
  items = [],
  nativeControl,
  router,
}: {
  deadline: string;
  items?: FactItem[] | undefined;
  nativeControl?: ReactNode | undefined;
  router?: Address | undefined;
}): React.JSX.Element {
  return (
    <details className="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-400">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300/70">
        Advanced transaction details
      </summary>
      <div className="grid min-w-0 gap-3 pb-1 pt-3 md:grid-cols-2">
        <div className="min-w-0 rounded-md border border-zinc-800 bg-zinc-950 p-3">
          <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-zinc-600">Router contract</span>
          <span className="mt-1 block min-w-0 [overflow-wrap:anywhere]">{router ? <AddressLink address={router} /> : "Not configured"}</span>
        </div>
        <div className="min-w-0 rounded-md border border-zinc-800 bg-zinc-950 p-3">
          <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-zinc-600">Raw Unix deadline</span>
          <code className="mt-1 block [overflow-wrap:anywhere]">{deadline}</code>
        </div>
        {items.map((item) => (
          <div className="min-w-0 rounded-md border border-zinc-800 bg-zinc-950 p-3" key={item.label}>
            <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-zinc-600">{item.label}</span>
            <span className="mt-1 block [overflow-wrap:anywhere] text-zinc-300">{item.value}</span>
          </div>
        ))}
        {nativeControl ? <div className="min-w-0 md:col-span-2">{nativeControl}</div> : null}
      </div>
    </details>
  );
}

function formatSlippagePercent(value: string): string {
  if (!/^\d+$/.test(value)) return `Custom (${value})`;
  const basisPoints = BigInt(value);
  const whole = basisPoints / 100n;
  const fraction = (basisPoints % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return `${whole.toString()}${fraction ? `.${fraction}` : ""}%`;
}

export function remainingDeadlineMinutes(deadline: string, currentUnixTime: number): number | undefined {
  const timestamp = Number(deadline);
  if (!Number.isSafeInteger(timestamp) || timestamp <= currentUnixTime) return undefined;
  return Math.max(1, Math.ceil((timestamp - currentUnixTime) / 60));
}

function deadlineFromMinutes(minutes: number, currentUnixTime: number): string {
  return String(currentUnixTime + minutes * 60);
}

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

export function deadlineIsFuture(deadline: string, currentUnixTime: number): boolean {
  const timestamp = Number(deadline);
  return Number.isSafeInteger(timestamp) && timestamp > currentUnixTime;
}

export function swapActionState(
  actionCapability: Capability,
  quote: SwapQuoteState | undefined,
  inputIsNative: boolean,
  deadlineValid: boolean,
  quoteState: "current" | "missing" | "stale" = quote ? "current" : "missing",
  pendingAction?: string | undefined,
  nativeBalance?: bigint | undefined,
): SwapActionState {
  const quoteReady = swapQuoteReady(quote);
  const commonReason = swapQuoteBlockingReason(actionCapability, quote, quoteReady, quoteState);
  let approve: ActionDecision;
  let swap: ActionDecision;

  if (commonReason) {
    approve = { enabled: false, reason: commonReason };
    swap = { enabled: false, reason: commonReason };
  } else if (!quoteReady) {
    const reason = "Quote details are incomplete. Refresh the quote before acting.";
    approve = { enabled: false, reason };
    swap = { enabled: false, reason };
  } else {
    const balance = inputIsNative ? nativeBalance : quote.tokenIn.balance;
    const allowance = quote.tokenIn.allowance;

    if (inputIsNative) {
      approve = { enabled: false, reason: "Native input does not require ERC-20 approval." };
    } else if (allowance === undefined) {
      approve = { enabled: false, reason: "Input-token allowance is unknown. Refresh the quote; unknown allowance is not treated as zero." };
    } else if (allowance >= quote.amountIn) {
      approve = { enabled: false, reason: "The current allowance already covers this swap." };
    } else {
      approve = { enabled: true };
    }

    if (!deadlineValid) {
      swap = { enabled: false, reason: "The quote expiry is invalid or has passed. Choose a fresh expiry window." };
    } else if (balance === undefined) {
      swap = {
        enabled: false,
        reason: inputIsNative
          ? "Native wallet balance is unknown. Load it before swapping; unknown balance is not treated as zero."
          : "Input-token balance is unknown. Refresh the quote; unknown balance is not treated as zero.",
      };
    } else if (balance < quote.amountIn) {
      swap = {
        enabled: false,
        reason: inputIsNative
          ? "Insufficient native wallet balance for the quoted input amount."
          : `Insufficient input-token balance. The swap needs ${formatSwapAmount(quote.amountIn, quote.tokenIn)}, but the verified balance is ${formatSwapAmount(balance, quote.tokenIn)}.`,
      };
    } else if (!inputIsNative && allowance === undefined) {
      swap = { enabled: false, reason: "Input-token allowance is unknown. Refresh the quote before swapping." };
    } else if (!inputIsNative && allowance !== undefined && allowance < quote.amountIn) {
      swap = { enabled: false, reason: "Approval needed: the verified allowance does not cover the quoted input amount." };
    } else {
      swap = { enabled: true };
    }
  }

  if (pendingAction) {
    approve = { enabled: false, reason: pendingAction === "approve-swap-input" ? "Approval is pending in the wallet or onchain." : "Another wallet action is in progress." };
    swap = { enabled: false, reason: pendingAction === "execute-swap" ? "Swap submission is pending in the wallet or onchain." : "Another wallet action is in progress." };
  }

  return { approve, quoteReady, swap };
}

function swapQuoteBlockingReason(
  actionCapability: Capability,
  quote: SwapQuoteState | undefined,
  quoteReady: boolean,
  quoteState: "current" | "missing" | "stale",
): string | undefined {
  const capabilityReason = marketWalletBlockingReason(
    actionCapability,
    "Connect a wallet to load account balance and allowance before approving or swapping.",
  );
  if (capabilityReason) return capabilityReason;
  if (quoteState === "stale") return "The quote is stale because the pair, amount, or execution preferences changed. Refresh it before acting.";
  if (quoteState === "missing" || !quote) return "No current quote is loaded. Review the inputs, then refresh the quote.";
  if (quote.error) return quoteErrorReason(quote.error);
  if (!quoteReady) return "Quote details are incomplete. Refresh the quote before acting.";
  return undefined;
}

function quoteErrorReason(error: string): string {
  if (/no two-sided liquidity|no amm pool|output would be zero/i.test(error)) return `No liquidity: ${error}`;
  if (/could not|failed|read|rpc|revert/i.test(error)) return `Read failure: ${error}`;
  return `Quote error: ${error}`;
}

export function liquidityActionState(
  actionCapability: Capability,
  quote: LiquidityQuoteState | undefined,
  tokenAIsNative: boolean,
  tokenBIsNative: boolean,
  deadlineValid: boolean,
  nativeBalance?: bigint | undefined,
): LiquidityActionState {
  const quoteReady = liquidityQuoteReady(quote);
  const tokenAAllowance = quoteReady && !tokenAIsNative ? quote.tokenA.allowance : undefined;
  const tokenBAllowance = quoteReady && !tokenBIsNative ? quote.tokenB.allowance : undefined;
  const needsTokenAApproval = quoteReady && tokenAAllowance !== undefined && tokenAAllowance < quote.amountA;
  const needsTokenBApproval = quoteReady && tokenBAllowance !== undefined && tokenBAllowance < quote.amountB;
  const blockingReasons: string[] = [];
  const walletReady = actionCapability.status === "enabled";
  const capabilityReason = marketWalletBlockingReason(
    actionCapability,
    "Connect a wallet to load balances and allowances before adding liquidity.",
  );

  if (capabilityReason) {
    blockingReasons.push(capabilityReason);
  } else if (!quote) {
    blockingReasons.push("No current liquidity quote is loaded. Review the inputs, then refresh the quote.");
  } else if (quote.error) {
    blockingReasons.push(quoteErrorReason(quote.error));
  } else if (!quoteReady) {
    blockingReasons.push("Liquidity quote details are incomplete. Refresh the quote before adding liquidity.");
  } else {
    const tokenABalanceReason = liquidityBalanceBlockingReason("A", quote.tokenA, quote.amountA, tokenAIsNative, nativeBalance);
    const tokenBBalanceReason = liquidityBalanceBlockingReason("B", quote.tokenB, quote.amountB, tokenBIsNative, nativeBalance);
    if (tokenABalanceReason) blockingReasons.push(tokenABalanceReason);
    if (tokenBBalanceReason) blockingReasons.push(tokenBBalanceReason);
    if (!tokenAIsNative && tokenAAllowance === undefined) {
      blockingReasons.push("Token A allowance is unknown. Refresh the liquidity quote before adding liquidity.");
    } else if (needsTokenAApproval) {
      blockingReasons.push("Approval needed for token A before adding liquidity.");
    }
    if (!tokenBIsNative && tokenBAllowance === undefined) {
      blockingReasons.push("Token B allowance is unknown. Refresh the liquidity quote before adding liquidity.");
    } else if (needsTokenBApproval) {
      blockingReasons.push("Approval needed for token B before adding liquidity.");
    }
    if (!deadlineValid) {
      blockingReasons.push("The quote expiry is invalid or has passed. Choose a fresh expiry window.");
    }
  }

  return {
    quoteReady,
    needsTokenAApproval,
    needsTokenBApproval,
    canApproveTokenA: walletReady && quoteReady && !tokenAIsNative && needsTokenAApproval,
    canApproveTokenB: walletReady && quoteReady && !tokenBIsNative && needsTokenBApproval,
    addLiquidity: {
      enabled: blockingReasons.length === 0,
      reason: blockingReasons.length > 0 ? blockingReasons.join(" ") : undefined,
    },
  };
}

function liquidityBalanceBlockingReason(
  side: "A" | "B",
  token: SwapTokenMetadata,
  amount: bigint,
  native: boolean,
  nativeBalance: bigint | undefined,
): string | undefined {
  const balance = native ? nativeBalance : token.balance;
  if (balance === undefined) {
    return native
      ? `Native wallet balance for token ${side} is unknown. Load it before adding liquidity; unknown balance is not treated as zero.`
      : `Token ${side} balance is unknown. Refresh the liquidity quote; unknown balance is not treated as zero.`;
  }
  if (balance >= amount) return undefined;

  const balanceToken = native ? { ...token, symbol: "Native" } : token;
  return native
    ? `Insufficient native wallet balance for token ${side}. Add liquidity needs ${formatSwapAmount(amount, balanceToken)}, but the verified native balance is ${formatSwapAmount(balance, balanceToken)}.`
    : `Insufficient token ${side} balance. Add liquidity needs ${formatSwapAmount(amount, token)}, but the verified balance is ${formatSwapAmount(balance, token)}.`;
}

export function positionActionState(
  actionCapability: Capability,
  position: AmmPositionState | undefined,
  quote: RemoveLiquidityQuoteState | undefined,
  deadlineValid: boolean,
): PositionActionState {
  const removeReady = removeLiquidityQuoteReady(quote);
  const lpAllowance = removeReady && quote
    ? quote.position.lpAllowance ?? quote.position.lpToken.allowance
    : undefined;
  const needsLpApproval = removeReady && quote !== undefined && lpAllowance !== undefined && lpAllowance < quote.liquidity;
  const walletReady = actionCapability.status === "enabled";

  return {
    removeReady,
    needsLpApproval,
    canApproveLp: walletReady && removeReady && needsLpApproval,
    canRemoveLiquidity: walletReady && removeReady && lpAllowance !== undefined && !needsLpApproval && deadlineValid,
    canClaimFees: walletReady && Boolean(position?.pool?.exists),
  };
}

function marketWalletBlockingReason(
  actionCapability: Capability,
  connectReason: string,
): string | undefined {
  if (actionCapability.status === "enabled") return undefined;
  if (actionCapability.reason) return actionCapability.reason;
  if (actionCapability.status === "connect") return connectReason;
  if (actionCapability.status === "switch") return "Switch your wallet to the active app network before submitting a market transaction.";
  return "Wallet actions are not available right now.";
}

function swapTransactionDecisionFacts(
  quote: SwapQuoteState | undefined,
  form: SwapForm,
  currentUnixTime: number,
): FactItem[] {
  return [
    { label: "Expected output", value: formatSwapAmount(quote?.amountOut, quote?.tokenOut) },
    { label: "Effective execution price", value: formatExecutionPrice(quote?.effectiveExecutionPrice, quote?.tokenIn, quote?.tokenOut) },
    { label: "Price impact (including fee)", value: formatMetricPercent(quote?.feeInclusivePriceImpact) },
    { label: "Minimum received", value: formatSwapAmount(quote?.amountOutMin, quote?.tokenOut) },
    { label: "AMM fee", value: formatFeePercent(quote?.feeBps, quote?.feeDenominator) },
    { label: "Quote expiry", value: quote ? quoteExpiryLabel(form.deadline, currentUnixTime) : "Not quoted" },
  ];
}

function swapTransactionTechnicalFacts(
  quote: SwapQuoteState | undefined,
  inputIsNative: boolean,
  nativeBalance: bigint | undefined,
): FactItem[] {
  const displayedBalance = inputIsNative && quote?.tokenIn
    ? formatSwapAmount(nativeBalance, { ...quote.tokenIn, symbol: "Native" })
    : formatSwapAmount(quote?.tokenIn?.balance, quote?.tokenIn);
  return [
    { label: "Pool contract", value: quote?.pool ? <AddressLink address={quote.pool.address} /> : "Unknown" },
    { label: "Input approval", value: inputIsNative ? "Native value" : approvalLabel(quote?.tokenIn, quote?.amountIn) },
    { label: inputIsNative ? "Native input balance" : "Input balance", value: displayedBalance },
    { label: "Input reserve", value: formatSwapAmount(quote?.pool?.reserveIn, quote?.tokenIn) },
    { label: "Output reserve", value: formatSwapAmount(quote?.pool?.reserveOut, quote?.tokenOut) },
  ];
}

function formatExecutionPrice(
  metric: MetricState<NormalizedPrice> | undefined,
  inputToken: SwapTokenMetadata | undefined,
  outputToken: SwapTokenMetadata | undefined,
): string {
  if (!metric) return "Unknown — refresh the quote";
  if (metric.status !== "known") return `Unknown — ${metric.reason}`;
  const input = inputToken?.symbol ?? shortTokenAddress(metric.value.baseToken);
  const output = outputToken?.symbol ?? shortTokenAddress(metric.value.quoteToken);
  return `1 ${input} = ${formatExactRational(metric.value.quotePerBase)} ${output}`;
}

function formatMetricPercent(metric: MetricState<ExactRational> | undefined): string {
  if (!metric) return "Unknown — refresh the quote";
  if (metric.status !== "known") return `Unknown — ${metric.reason}`;
  return formatExactRational({ numerator: metric.value.numerator * 100n, denominator: metric.value.denominator }, 4, "%");
}

function formatFeePercent(fee: bigint | undefined, denominator: bigint | undefined): string {
  if (fee === undefined || denominator === undefined || denominator <= 0n) return "Unknown";
  return formatExactRational({ numerator: fee * 100n, denominator }, 4, "%");
}

function quoteExpiryLabel(deadline: string, currentUnixTime: number): string {
  const minutes = remainingDeadlineMinutes(deadline, currentUnixTime);
  return minutes === undefined ? "Invalid or expired" : `${minutes.toString()} min`;
}

function formatExactRational(value: ExactRational, maximumFractionDigits = 6, suffix = ""): string {
  if (value.denominator === 0n) return "Unknown";
  const negative = (value.numerator < 0n) !== (value.denominator < 0n);
  const numerator = value.numerator < 0n ? -value.numerator : value.numerator;
  const denominator = value.denominator < 0n ? -value.denominator : value.denominator;
  const whole = numerator / denominator;
  let remainder = numerator % denominator;
  let fraction = "";
  for (let index = 0; index < maximumFractionDigits && remainder !== 0n; index += 1) {
    remainder *= 10n;
    fraction += (remainder / denominator).toString();
    remainder %= denominator;
  }
  fraction = fraction.replace(/0+$/, "");
  const approximate = remainder !== 0n ? "≈" : "";
  return `${approximate}${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}${suffix}`;
}

function liquidityTransactionFacts(
  quote: LiquidityQuoteState | undefined,
  tokenAIsNative: boolean,
  tokenBIsNative: boolean,
): FactItem[] {
  return [
    { label: "Pool", value: quote?.pool ? <AddressLink address={quote.pool.address} /> : "Unknown" },
    { label: "Pool status", value: quote?.pool ? quote.pool.exists ? "Existing" : "Creates on add" : "Unknown" },
    { label: "LP minted", value: formatSwapAmount(quote?.liquidityOut, lpTokenMetadata(quote?.pool)) },
    { label: "Token A used", value: formatSwapAmount(quote?.amountA, quote?.tokenA) },
    { label: "Token B used", value: formatSwapAmount(quote?.amountB, quote?.tokenB) },
    { label: "Minimum A", value: formatSwapAmount(quote?.amountAMin, quote?.tokenA) },
    { label: "Minimum B", value: formatSwapAmount(quote?.amountBMin, quote?.tokenB) },
    { label: "Token A approval", value: tokenAIsNative ? "Native value" : approvalLabel(quote?.tokenA, quote?.amountA) },
    { label: "Token B approval", value: tokenBIsNative ? "Native value" : approvalLabel(quote?.tokenB, quote?.amountB) },
  ];
}

function lpPositionFacts(position: AmmPositionState | undefined, removeQuote: RemoveLiquidityQuoteState | undefined): FactItem[] {
  return [
    { label: "Pool", value: position?.pool?.exists ? <AddressLink address={position.pool.address} /> : "None" },
    { label: "LP balance", value: formatSwapAmount(position?.lpBalance, position?.lpToken) },
    { label: "Pool share", value: formatPoolShareBps(position?.poolShareBps) },
    { label: "Claimable A", value: formatSwapAmount(position?.claimableA, position?.tokenA) },
    { label: "Claimable B", value: formatSwapAmount(position?.claimableB, position?.tokenB) },
    { label: "LP approval", value: lpApprovalLabel(position, removeQuote?.liquidity) },
    { label: "Reserve A", value: formatSwapAmount(position?.pool?.reserveA, position?.tokenA) },
    { label: "Reserve B", value: formatSwapAmount(position?.pool?.reserveB, position?.tokenB) },
    { label: "LP supply", value: formatSwapAmount(position?.pool?.totalSupply, position?.lpToken) },
  ];
}

function removeLiquidityTransactionFacts(quote: RemoveLiquidityQuoteState | undefined): FactItem[] {
  return [
    { label: "Expected A", value: formatSwapAmount(quote?.amountA, quote?.position?.tokenA) },
    { label: "Expected B", value: formatSwapAmount(quote?.amountB, quote?.position?.tokenB) },
    { label: "Minimum A", value: formatSwapAmount(quote?.amountAMin, quote?.position?.tokenA) },
    { label: "Minimum B", value: formatSwapAmount(quote?.amountBMin, quote?.position?.tokenB) },
  ];
}

function lpTokenMetadata(pool: LiquidityQuoteState["pool"]): SwapTokenMetadata | undefined {
  if (!pool) return undefined;
  return { address: pool.address, decimals: 18, symbol: "LP" };
}

function selectedTokenForSide(
  side: TokenSide | undefined,
  swapQuote: SwapQuoteState | undefined,
  liquidityQuote: LiquidityQuoteState | undefined,
  position: AmmPositionState | undefined,
): SwapTokenMetadata | undefined {
  if (side === "tokenIn") return swapQuote?.tokenIn;
  if (side === "tokenOut") return swapQuote?.tokenOut;
  if (side === "tokenA") return liquidityQuote?.tokenA ?? position?.tokenA;
  if (side === "tokenB") return liquidityQuote?.tokenB ?? position?.tokenB;
  return undefined;
}

export function swapDecisionFormKey(form: SwapForm): string {
  return swapQuoteRequestIdentity(form);
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
  if (!token || amountIn === undefined || token.allowance === undefined) return "Unknown — allowance not verified";
  return token.allowance >= amountIn ? "Approved" : `${formatSwapAmount(token.allowance, token)} approved`;
}

function lpApprovalLabel(position: AmmPositionState | undefined, liquidity: bigint | undefined): string {
  if (!position?.lpToken || liquidity === undefined) return "Unknown";
  const allowance = position.lpAllowance ?? position.lpToken.allowance ?? 0n;
  return allowance >= liquidity ? "Approved" : `${formatSwapAmount(allowance, position.lpToken)} approved`;
}

function swapStatus(quote: SwapQuoteState | undefined, quoteCurrent: boolean, deadlineValid: boolean): string {
  if (quote && !quoteCurrent) return "Quote stale";
  if (!deadlineValid) return "New expiry needed";
  if (!quote) return "Not quoted";
  if (swapQuoteReady(quote)) return "Ready";
  if (/no two-sided liquidity|no amm pool/i.test(quote.error ?? "")) return "No liquidity";
  return "Blocked";
}

function swapTone(
  quote: SwapQuoteState | undefined,
  quoteCurrent: boolean,
  deadlineValid: boolean,
): "default" | "muted" | "warning" | "danger" {
  if (quote && !quoteCurrent) return "warning";
  if (!deadlineValid) return "warning";
  if (!quote) return "muted";
  if (swapQuoteReady(quote)) return "default";
  if (/no two-sided liquidity|no amm pool/i.test(quote.error ?? "")) return "warning";
  return "danger";
}

function liquidityStatus(quote: LiquidityQuoteState | undefined, deadlineValid: boolean): string {
  if (!deadlineValid) return "New expiry needed";
  if (!quote) return "Not quoted";
  if (liquidityQuoteReady(quote)) return quote.pool.exists ? "Ready" : "New pool";
  return "Blocked";
}

function liquidityTone(quote: LiquidityQuoteState | undefined, deadlineValid: boolean): "default" | "muted" | "warning" | "danger" {
  if (!deadlineValid) return "warning";
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
  if (token.sources.includes("deployment")) return 1;
  if (token.label === "USDC / cash") return 2;
  if (token.sources.includes("pool")) return 3;
  return 4;
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

function tokenSubtitle(option: SwapTokenOption | undefined, value: string, wrappedNativeSymbol: string): string {
  if (option?.label && option.symbol && option.label !== option.symbol) return option.label;
  if (isAddress(value)) return shortTokenAddress(value);
  return `Pools, ${wrappedNativeSymbol}, USDC, or address`;
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
