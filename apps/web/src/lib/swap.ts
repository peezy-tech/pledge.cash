import {
  ammFactoryAbi,
  ammPoolAbi,
  ammRouterAbi,
  erc20Abi,
  isZeroAddress,
  type Address,
  type PledgeCashDeployment,
  type PledgeCashReadClient,
} from "@pledge.cash/sdk";
import { isAddress } from "viem";
import { errorMessage } from "./forms";
import {
  swapExecutionMetrics as calculateSwapExecutionMetrics,
  unavailableMetric,
  type ExactRational,
  type MetricState,
  type NormalizedPrice,
  type SwapExecutionMetrics,
} from "./market-data";
import { formatTokenAmount, parseTokenAmountInput } from "./token-amounts";

export type SwapForm = {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps: string;
  recipient: string;
  deadline: string;
  useNative: boolean;
};

export type LiquidityForm = {
  tokenA: string;
  tokenB: string;
  amountA: string;
  amountB: string;
  slippageBps: string;
  recipient: string;
  deadline: string;
  useNative: boolean;
};

export type RemoveLiquidityForm = {
  liquidity: string;
  slippageBps: string;
  recipient: string;
  deadline: string;
  useNative: boolean;
};

export type SwapTokenMetadata = {
  address: Address;
  symbol?: string;
  decimals?: number;
  balance?: bigint;
  allowance?: bigint;
  error?: string;
};

export type SwapTokenSource = "pool" | "deployment" | "custom";

export type SwapTokenListOptions = {
  discoveryMode?: "global" | "pinned-only" | undefined;
  pinnedPools?: readonly Address[] | undefined;
  signal?: AbortSignal | undefined;
  wrappedNativeLabel?: string;
};

export type SwapTokenOption = SwapTokenMetadata & {
  label?: string;
  sources: SwapTokenSource[];
  pools: Address[];
  pairAddresses: Address[];
};

export type SwapPoolSummary = {
  address: Address;
  token0: Address;
  token1: Address;
  reserve0: bigint;
  reserve1: bigint;
};

export type SwapPoolState = {
  address: Address;
  token0: Address;
  token1: Address;
  reserve0: bigint;
  reserve1: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
};

export type LiquidityPoolState = {
  address: Address;
  exists: boolean;
  token0: Address;
  token1: Address;
  reserve0: bigint;
  reserve1: bigint;
  reserveA: bigint;
  reserveB: bigint;
  totalSupply: bigint;
};

export type SwapQuoteState = {
  requestIdentity: string;
  tokenIn?: SwapTokenMetadata;
  tokenOut?: SwapTokenMetadata;
  pool?: SwapPoolState;
  amountIn?: bigint;
  amountOut?: bigint;
  amountOutMin?: bigint;
  slippageBps: number;
  feeBps?: bigint;
  feeDenominator?: bigint;
  protocolFeeShareBps?: bigint;
  effectiveExecutionPrice?: MetricState<NormalizedPrice>;
  feeInclusivePriceImpact?: MetricState<ExactRational>;
  error?: string;
};

export type LiquidityQuoteState = {
  tokenA?: SwapTokenMetadata;
  tokenB?: SwapTokenMetadata;
  pool?: LiquidityPoolState;
  amountA?: bigint;
  amountB?: bigint;
  amountAMin?: bigint;
  amountBMin?: bigint;
  liquidityOut?: bigint;
  slippageBps: number;
  error?: string;
};

export type AmmPositionState = {
  tokenA: SwapTokenMetadata;
  tokenB: SwapTokenMetadata;
  pool?: LiquidityPoolState;
  lpToken?: SwapTokenMetadata;
  lpBalance?: bigint;
  lpAllowance?: bigint;
  poolShareBps?: bigint;
  claimableA?: bigint;
  claimableB?: bigint;
  error?: string;
};

export type RemoveLiquidityQuoteState = {
  position?: AmmPositionState;
  liquidity?: bigint;
  amountA?: bigint;
  amountB?: bigint;
  amountAMin?: bigint;
  amountBMin?: bigint;
  slippageBps: number;
  error?: string;
};

export type SwapTokenListState = {
  tokens: SwapTokenOption[];
  pools: SwapPoolSummary[];
  loaded: boolean;
  error?: string;
};

type ExecutableSwapQuote = SwapQuoteState & {
  tokenIn: SwapTokenMetadata & { decimals: number };
  tokenOut: SwapTokenMetadata & { decimals: number };
  pool: SwapPoolState;
  amountIn: bigint;
  amountOut: bigint;
  amountOutMin: bigint;
};

type ExecutableLiquidityQuote = LiquidityQuoteState & {
  tokenA: SwapTokenMetadata & { decimals: number };
  tokenB: SwapTokenMetadata & { decimals: number };
  pool: LiquidityPoolState;
  amountA: bigint;
  amountB: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
  liquidityOut: bigint;
};

type ExecutableRemoveLiquidityQuote = RemoveLiquidityQuoteState & {
  position: AmmPositionState & {
    tokenA: SwapTokenMetadata & { decimals: number };
    tokenB: SwapTokenMetadata & { decimals: number };
    pool: LiquidityPoolState;
    lpToken: SwapTokenMetadata & { decimals: number };
    lpBalance: bigint;
  };
  liquidity: bigint;
  amountA: bigint;
  amountB: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
};

type AmmFeeConfig = {
  feeBps: bigint;
  feeDenominator: bigint;
  protocolFeeShareBps: bigint;
};

const AMM_MINIMUM_LIQUIDITY = 1_000n;
const FEE_INDEX_SCALE = 1_000_000_000_000_000_000n;
const DEFAULT_SLIPPAGE_BPS = 50;
const FULL_BPS = 10_000;
const FULL_BPS_BIGINT = 10_000n;
const MAX_DISCOVERED_POOLS = 500;
const MAX_PINNED_POOLS = 64;
const SWAP_DISCOVERY_CONCURRENCY = 8;

export function swapQuoteRequestIdentity(form: SwapForm): string {
  return [
    form.tokenIn.trim().toLowerCase(),
    form.tokenOut.trim().toLowerCase(),
    form.amountIn.trim(),
    form.slippageBps.trim(),
    form.deadline.trim(),
    form.useNative ? "native" : "wrapped",
  ].join("|");
}

export function defaultSwapForm(): SwapForm {
  return {
    tokenIn: "",
    tokenOut: "",
    amountIn: "1",
    slippageBps: DEFAULT_SLIPPAGE_BPS.toString(),
    recipient: "",
    deadline: defaultSwapDeadline(),
    useNative: false,
  };
}

export function defaultLiquidityForm(): LiquidityForm {
  return {
    tokenA: "",
    tokenB: "",
    amountA: "1",
    amountB: "1",
    slippageBps: DEFAULT_SLIPPAGE_BPS.toString(),
    recipient: "",
    deadline: defaultSwapDeadline(),
    useNative: false,
  };
}

export function defaultRemoveLiquidityForm(): RemoveLiquidityForm {
  return {
    liquidity: "",
    slippageBps: DEFAULT_SLIPPAGE_BPS.toString(),
    recipient: "",
    deadline: defaultSwapDeadline(),
    useNative: false,
  };
}

export function withSwapTokenListDefaults(
  form: SwapForm,
  tokenList: SwapTokenListState,
  deployment?: PledgeCashDeployment | undefined,
): SwapForm {
  const defaults = preferredPoolPair(tokenList, deployment);
  if (!defaults) return form;

  const tokenIn = form.tokenIn || defaults.tokenIn;
  const tokenOut = defaultTokenOut(form.tokenOut, tokenIn, defaults.tokenOut);

  return {
    ...form,
    tokenIn,
    tokenOut,
    useNative: form.useNative && pairHasWrappedNative(deployment, tokenIn, tokenOut),
  };
}

export function withLiquidityTokenListDefaults(
  form: LiquidityForm,
  tokenList: SwapTokenListState,
  deployment?: PledgeCashDeployment | undefined,
): LiquidityForm {
  const defaults = preferredPoolPair(tokenList, deployment);
  if (!defaults) return form;

  const tokenA = form.tokenA || defaults.tokenIn;
  const tokenB = defaultTokenOut(form.tokenB, tokenA, defaults.tokenOut);

  return {
    ...form,
    tokenA,
    tokenB,
    useNative: form.useNative && pairHasWrappedNative(deployment, tokenA, tokenB),
  };
}

function defaultTokenOut(currentTokenOut: string, tokenIn: string, fallbackTokenOut: Address): string {
  const tokenOut = currentTokenOut || fallbackTokenOut;
  if (!tokenIn || !tokenOut || !sameAddress(tokenIn, tokenOut)) return tokenOut;
  return !sameAddress(tokenIn, fallbackTokenOut) ? fallbackTokenOut : "";
}

export async function readSwapTokenList(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  account?: Address | undefined,
  listOptions: SwapTokenListOptions = {},
): Promise<SwapTokenListState> {
  throwIfSwapReadAborted(listOptions.signal);
  const read = readSwapTokenListState(client, deployment, account, listOptions);
  return listOptions.signal ? await raceWithSwapReadAbort(read, listOptions.signal) : await read;
}

async function readSwapTokenListState(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  account: Address | undefined,
  listOptions: SwapTokenListOptions,
): Promise<SwapTokenListState> {
  const tokens = new Map<string, TokenAccumulator>();
  const wrappedNativeLabel = listOptions.wrappedNativeLabel || "Wrapped native";
  addTokenAccumulator(tokens, deployment?.wrappedNative, { label: wrappedNativeLabel, source: "deployment", rank: 0 });

  let pools: SwapPoolSummary[] = [];
  let listError: string | undefined;

  if ((listOptions.discoveryMode ?? "global") === "global") {
    try {
      const factory = requireDeploymentAddress(deployment?.ammFactory, "AMM factory");
      const discovered = await readPoolSummaries(client, factory, listOptions.signal);
      pools = discovered.pools;
      listError = discovered.error;
    } catch (error) {
      listError = errorMessage(error);
    }
  }
  throwIfSwapReadAborted(listOptions.signal);

  const pinnedPools = uniquePoolAddresses(listOptions.pinnedPools ?? []);
  const boundedPinnedPools = pinnedPools.slice(-MAX_PINNED_POOLS);
  const missingPinnedPools = boundedPinnedPools.filter((address) =>
    !pools.some((pool) => sameAddress(pool.address, address)));
  const pinnedResults = await mapInBatches(
    missingPinnedPools,
    SWAP_DISCOVERY_CONCURRENCY,
    async (address): Promise<{ error?: string | undefined; pool?: SwapPoolSummary | undefined }> => {
      try {
        return { pool: await readPoolSummary(client, address) };
      } catch (error) {
        return { error: errorMessage(error) };
      }
    },
    listOptions.signal,
  );
  throwIfSwapReadAborted(listOptions.signal);
  pools = uniquePoolSummaries([
    ...pools,
    ...pinnedResults.flatMap((result) => result.pool ? [result.pool] : []),
  ]);
  const pinnedFailures = pinnedResults.filter((result) => result.error).length;
  const listErrors = [
    listError,
    pinnedPools.length > boundedPinnedPools.length
      ? `Only the newest ${MAX_PINNED_POOLS.toString()} project pools can be pinned at once.`
      : undefined,
    pinnedFailures > 0
      ? `${pinnedFailures.toString()} ${pinnedFailures === 1 ? "project pool could" : "project pools could"} not be read.`
      : undefined,
  ].filter((message): message is string => Boolean(message));
  listError = listErrors.length > 0 ? listErrors.join(" ") : undefined;

  addPoolTokens(tokens, pools);

  const rankedTokens = Array.from(tokens.values()).sort((left, right) => left.rank - right.rank);
  const options = await mapInBatches(
    rankedTokens,
    SWAP_DISCOVERY_CONCURRENCY,
    async (token) => await tokenOptionFromAccumulator(client, token, account),
    listOptions.signal,
  );
  options.sort(compareTokenOptions);

  const result: SwapTokenListState = { tokens: options, pools, loaded: true };
  if (listError) result.error = listError;
  return result;
}

export async function readSwapQuote(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  form: SwapForm,
  account?: Address | undefined,
): Promise<SwapQuoteState> {
  const requestIdentity = swapQuoteRequestIdentity(form);
  let slippageBps = DEFAULT_SLIPPAGE_BPS;

  try {
    slippageBps = parseSlippageBps(form.slippageBps);
    const factory = requireDeploymentAddress(deployment?.ammFactory, "AMM factory");
    const router = requireDeploymentAddress(deployment?.ammRouter, "AMM router");
    const tokenIn = requireTokenAddress(form.tokenIn, "From token");
    const tokenOut = requireTokenAddress(form.tokenOut, "To token");
    if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
      throw new Error("Choose two different tokens.");
    }

    const [inputToken, outputToken, poolAddress, fees] = await Promise.all([
      readTokenMetadata(client, tokenIn, account, router),
      readTokenMetadata(client, tokenOut, account),
      client.readContract({ address: factory, abi: ammFactoryAbi, functionName: "getPool", args: [tokenIn, tokenOut] }) as Promise<Address>,
      readAmmFeeConfig(client, factory),
    ]);

    if (inputToken.decimals === undefined) {
      return baseQuote({ requestIdentity, inputToken, outputToken, slippageBps, ...fees, error: "From token decimals could not be read." });
    }
    if (outputToken.decimals === undefined) {
      return baseQuote({ requestIdentity, inputToken, outputToken, slippageBps, ...fees, error: "To token decimals could not be read." });
    }

    const amountIn = parseTokenAmountInput(form.amountIn, inputToken, "Input amount");
    if (amountIn === 0n) {
      return baseQuote({ requestIdentity, inputToken, outputToken, amountIn, slippageBps, ...fees, error: "Enter a positive input amount." });
    }

    if (isZeroAddress(poolAddress)) {
      return baseQuote({
        requestIdentity,
        inputToken,
        outputToken,
        amountIn,
        slippageBps,
        ...fees,
        error: "No AMM pool exists for this pair yet.",
      });
    }

    const path = [tokenIn, tokenOut] as const;
    const amountsRead = (client.readContract({
      address: router,
      abi: ammRouterAbi,
      functionName: "getAmountsOut",
      args: [amountIn, path],
    }) as Promise<readonly bigint[]>).then(
      (amounts) => ({ status: "fulfilled" as const, amounts }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    const pool = await readSwapPoolState(client, poolAddress, tokenIn, tokenOut);
    if (pool.reserveIn === 0n || pool.reserveOut === 0n) {
      const executionMetrics = unavailableSwapExecutionMetrics("The AMM pool has no two-sided liquidity.");
      return {
        requestIdentity,
        tokenIn: inputToken,
        tokenOut: outputToken,
        pool,
        amountIn,
        slippageBps,
        ...fees,
        ...executionMetrics,
        error: "The AMM pool has no two-sided liquidity.",
      };
    }

    const amountsResult = await amountsRead;
    if (amountsResult.status === "rejected") throw amountsResult.error;
    const amounts = amountsResult.amounts;
    const amountOut = amounts[1] ?? 0n;
    const amountOutMin = applySlippage(amountOut, slippageBps);
    const executionMetrics = swapQuoteExecutionMetrics({
      tokenIn: inputToken,
      tokenOut: outputToken,
      pool,
      amountIn,
      amountOut,
    });

    if (amountOut === 0n) {
      return {
        requestIdentity,
        tokenIn: inputToken,
        tokenOut: outputToken,
        pool,
        amountIn,
        amountOut,
        amountOutMin,
        slippageBps,
        ...fees,
        ...executionMetrics,
        error: "Swap output would be zero.",
      };
    }

    return {
      requestIdentity,
      tokenIn: inputToken,
      tokenOut: outputToken,
      pool,
      amountIn,
      amountOut,
      amountOutMin,
      slippageBps,
      ...fees,
      ...executionMetrics,
    };
  } catch (error) {
    return { requestIdentity, slippageBps, error: errorMessage(error) };
  }
}

export function swapQuoteExecutionMetrics(input: {
  tokenIn: SwapTokenMetadata;
  tokenOut: SwapTokenMetadata;
  pool: SwapPoolState;
  amountIn: bigint;
  amountOut: bigint;
}): Pick<SwapQuoteState, "effectiveExecutionPrice" | "feeInclusivePriceImpact"> {
  if (input.tokenIn.decimals === undefined || input.tokenOut.decimals === undefined) {
    return unavailableSwapExecutionMetrics("Execution metrics require verified token decimals.");
  }
  const metrics = calculateSwapExecutionMetrics({
    tokenIn: input.tokenIn.address,
    tokenInDecimals: input.tokenIn.decimals,
    tokenOut: input.tokenOut.address,
    tokenOutDecimals: input.tokenOut.decimals,
    amountIn: input.amountIn,
    amountOut: input.amountOut,
    reserveIn: input.pool.reserveIn,
    reserveOut: input.pool.reserveOut,
  });
  return executionMetricFields(metrics);
}

export async function readLiquidityQuote(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  form: LiquidityForm,
  account?: Address | undefined,
): Promise<LiquidityQuoteState> {
  let slippageBps = DEFAULT_SLIPPAGE_BPS;

  try {
    slippageBps = parseSlippageBps(form.slippageBps);
    const factory = requireDeploymentAddress(deployment?.ammFactory, "AMM factory");
    const router = requireDeploymentAddress(deployment?.ammRouter, "AMM router");
    const tokenA = requireTokenAddress(form.tokenA, "Token A");
    const tokenB = requireTokenAddress(form.tokenB, "Token B");
    if (sameAddress(tokenA, tokenB)) throw new Error("Choose two different tokens.");

    const [tokenAMetadata, tokenBMetadata, pool] = await Promise.all([
      readTokenMetadata(client, tokenA, account, router),
      readTokenMetadata(client, tokenB, account, router),
      readLiquidityPool(client, factory, tokenA, tokenB),
    ]);

    if (tokenAMetadata.decimals === undefined) return baseLiquidityQuote({ tokenA: tokenAMetadata, tokenB: tokenBMetadata, pool, slippageBps, error: "Token A decimals could not be read." });
    if (tokenBMetadata.decimals === undefined) return baseLiquidityQuote({ tokenA: tokenAMetadata, tokenB: tokenBMetadata, pool, slippageBps, error: "Token B decimals could not be read." });

    const amountADesired = parseTokenAmountInput(form.amountA, tokenAMetadata, "Token A amount");
    const amountBDesired = parseTokenAmountInput(form.amountB, tokenBMetadata, "Token B amount");
    if (amountADesired === 0n || amountBDesired === 0n) {
      return baseLiquidityQuote({ tokenA: tokenAMetadata, tokenB: tokenBMetadata, pool, slippageBps, error: "Enter positive amounts for both tokens." });
    }

    const [amountA, amountB] = optimalLiquidityAmounts(pool, amountADesired, amountBDesired);
    const amountAMin = applySlippage(amountA, slippageBps);
    const amountBMin = applySlippage(amountB, slippageBps);
    const liquidityOut = estimateLiquidityOut(pool, amountA, amountB);
    if (liquidityOut === 0n) {
      return baseLiquidityQuote({ tokenA: tokenAMetadata, tokenB: tokenBMetadata, pool, amountA, amountB, amountAMin, amountBMin, slippageBps, error: "Liquidity output would be zero." });
    }

    return {
      tokenA: tokenAMetadata,
      tokenB: tokenBMetadata,
      pool,
      amountA,
      amountB,
      amountAMin,
      amountBMin,
      liquidityOut,
      slippageBps,
    };
  } catch (error) {
    return { slippageBps, error: errorMessage(error) };
  }
}

export async function readAmmPosition(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  tokenAInput: string,
  tokenBInput: string,
  account?: Address | undefined,
): Promise<AmmPositionState | undefined> {
  try {
    const factory = requireDeploymentAddress(deployment?.ammFactory, "AMM factory");
    const router = requireDeploymentAddress(deployment?.ammRouter, "AMM router");
    const tokenA = requireTokenAddress(tokenAInput, "Token A");
    const tokenB = requireTokenAddress(tokenBInput, "Token B");
    if (sameAddress(tokenA, tokenB)) throw new Error("Choose two different tokens.");

    const [tokenAMetadata, tokenBMetadata, pool] = await Promise.all([
      readTokenMetadata(client, tokenA, account),
      readTokenMetadata(client, tokenB, account),
      readLiquidityPool(client, factory, tokenA, tokenB),
    ]);
    const base: AmmPositionState = { tokenA: tokenAMetadata, tokenB: tokenBMetadata, pool };
    if (!pool.exists) return base;

    const lpToken = await readTokenMetadata(client, pool.address, account, router);
    const lpBalance = lpToken.balance ?? 0n;
    const result: AmmPositionState = {
      ...base,
      lpToken,
      lpBalance,
      lpAllowance: lpToken.allowance ?? 0n,
      poolShareBps: pool.totalSupply === 0n ? 0n : (lpBalance * FULL_BPS_BIGINT) / pool.totalSupply,
    };

    if (account) {
      const claimable = await readEffectiveClaimable(client, pool, tokenA, account);
      result.claimableA = claimable.claimableA;
      result.claimableB = claimable.claimableB;
    }

    return result;
  } catch (error) {
    if (!isAddress(tokenAInput) || !isAddress(tokenBInput)) return undefined;
    const tokenA = { address: tokenAInput } as SwapTokenMetadata;
    const tokenB = { address: tokenBInput } as SwapTokenMetadata;
    return { tokenA, tokenB, error: errorMessage(error) };
  }
}

export async function readRemoveLiquidityQuote(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  pairForm: LiquidityForm,
  removeForm: RemoveLiquidityForm,
  account?: Address | undefined,
): Promise<RemoveLiquidityQuoteState> {
  let slippageBps = DEFAULT_SLIPPAGE_BPS;

  try {
    slippageBps = parseSlippageBps(removeForm.slippageBps);
    const position = await readAmmPosition(client, deployment, pairForm.tokenA, pairForm.tokenB, account);
    if (!position) return { slippageBps, error: "No AMM pool exists for this pair yet." };
    if (!position.pool || !position.pool.exists || !position.lpToken) return { position, slippageBps, error: "No AMM pool exists for this pair yet." };
    if (position.lpToken.decimals === undefined) return { position, slippageBps, error: "LP token decimals could not be read." };

    const liquidity = parseTokenAmountInput(removeForm.liquidity, position.lpToken, "LP amount");
    if (liquidity === 0n) return { position, liquidity, slippageBps, error: "Enter a positive LP amount." };
    if (position.lpBalance !== undefined && liquidity > position.lpBalance) return { position, liquidity, slippageBps, error: "LP amount exceeds your balance." };
    if (position.pool.totalSupply === 0n) return { position, liquidity, slippageBps, error: "Pool supply is zero." };

    const [amountA, amountB] = removeLiquidityAmounts(position.pool, liquidity);
    const amountAMin = applySlippage(amountA, slippageBps);
    const amountBMin = applySlippage(amountB, slippageBps);
    if (amountA === 0n || amountB === 0n) {
      return {
        position,
        liquidity,
        amountA,
        amountB,
        amountAMin,
        amountBMin,
        slippageBps,
        error: "LP amount is too small for this pool.",
      };
    }

    return { position, liquidity, amountA, amountB, amountAMin, amountBMin, slippageBps };
  } catch (error) {
    return { slippageBps, error: errorMessage(error) };
  }
}

export function buildSwapTransaction(input: {
  deployment: PledgeCashDeployment | undefined;
  form: SwapForm;
  quote: SwapQuoteState;
  account: Address;
}) {
  const router = requireDeploymentAddress(input.deployment?.ammRouter, "AMM router");
  const quote = requireExecutableQuote(input.quote);
  const recipient = input.form.recipient.trim() ? requireTokenAddress(input.form.recipient, "Recipient") : input.account;
  const deadline = parseSwapDeadline(input.form.deadline);
  const path = [quote.tokenIn.address, quote.tokenOut.address] as const;
  const nativeMode = input.form.useNative ? requireSwapNativeMode(input.deployment, quote.tokenIn.address, quote.tokenOut.address) : undefined;

  if (nativeMode === "input") {
    return {
      address: router,
      abi: ammRouterAbi,
      functionName: "swapExactNativeForTokens",
      value: quote.amountIn,
      args: [quote.amountOutMin, path, recipient, deadline] as const,
    };
  }

  if (nativeMode === "output") {
    return {
      address: router,
      abi: ammRouterAbi,
      functionName: "swapExactTokensForNative",
      args: [quote.amountIn, quote.amountOutMin, path, recipient, deadline] as const,
    };
  }

  return {
    address: router,
    abi: ammRouterAbi,
    functionName: "swapExactTokensForTokens",
    args: [quote.amountIn, quote.amountOutMin, path, recipient, deadline] as const,
  };
}

export function buildAddLiquidityTransaction(input: {
  deployment: PledgeCashDeployment | undefined;
  form: LiquidityForm;
  quote: LiquidityQuoteState;
  account: Address;
}) {
  const router = requireDeploymentAddress(input.deployment?.ammRouter, "AMM router");
  const quote = requireExecutableLiquidityQuote(input.quote);
  const recipient = input.form.recipient.trim() ? requireTokenAddress(input.form.recipient, "Recipient") : input.account;
  const deadline = parseSwapDeadline(input.form.deadline);
  const nativeSide = input.form.useNative ? requireWrappedNativeSide(input.deployment, quote.tokenA.address, quote.tokenB.address) : undefined;

  if (nativeSide) {
    const token = nativeSide === "tokenA" ? quote.tokenB : quote.tokenA;
    const amountToken = nativeSide === "tokenA" ? quote.amountB : quote.amountA;
    const amountTokenMin = nativeSide === "tokenA" ? quote.amountBMin : quote.amountAMin;
    const amountNative = nativeSide === "tokenA" ? quote.amountA : quote.amountB;
    const amountNativeMin = nativeSide === "tokenA" ? quote.amountAMin : quote.amountBMin;

    return {
      address: router,
      abi: ammRouterAbi,
      functionName: "addLiquidityNative",
      value: amountNative,
      args: [token.address, amountToken, amountTokenMin, amountNativeMin, recipient, deadline] as const,
    };
  }

  return {
    address: router,
    abi: ammRouterAbi,
    functionName: "addLiquidity",
    args: [quote.tokenA.address, quote.tokenB.address, quote.amountA, quote.amountB, quote.amountAMin, quote.amountBMin, recipient, deadline] as const,
  };
}

export function buildRemoveLiquidityTransaction(input: {
  deployment: PledgeCashDeployment | undefined;
  form: RemoveLiquidityForm;
  quote: RemoveLiquidityQuoteState;
  account: Address;
}) {
  const router = requireDeploymentAddress(input.deployment?.ammRouter, "AMM router");
  const quote = requireExecutableRemoveLiquidityQuote(input.quote);
  const recipient = input.form.recipient.trim() ? requireTokenAddress(input.form.recipient, "Recipient") : input.account;
  const deadline = parseSwapDeadline(input.form.deadline);
  const nativeSide = input.form.useNative
    ? requireWrappedNativeSide(input.deployment, quote.position.tokenA.address, quote.position.tokenB.address)
    : undefined;

  if (nativeSide) {
    const token = nativeSide === "tokenA" ? quote.position.tokenB : quote.position.tokenA;
    const amountTokenMin = nativeSide === "tokenA" ? quote.amountBMin : quote.amountAMin;
    const amountNativeMin = nativeSide === "tokenA" ? quote.amountAMin : quote.amountBMin;

    return {
      address: router,
      abi: ammRouterAbi,
      functionName: "removeLiquidityNative",
      args: [token.address, quote.liquidity, amountTokenMin, amountNativeMin, recipient, deadline] as const,
    };
  }

  return {
    address: router,
    abi: ammRouterAbi,
    functionName: "removeLiquidity",
    args: [quote.position.tokenA.address, quote.position.tokenB.address, quote.liquidity, quote.amountAMin, quote.amountBMin, recipient, deadline] as const,
  };
}

export function buildClaimAmmFeesTransaction(position: AmmPositionState) {
  if (!position.pool?.exists) throw new Error("No AMM pool exists for this pair yet.");
  return {
    address: position.pool.address,
    abi: ammPoolAbi,
    functionName: "claimFees",
  };
}

export function formatSwapAmount(amount: bigint | undefined, token: SwapTokenMetadata | undefined): string {
  return formatTokenAmount(amount, token);
}

export function formatPoolShareBps(poolShareBps: bigint | undefined): string {
  if (poolShareBps === undefined) return "Unknown";
  if (poolShareBps === 0n) return "0%";
  const whole = poolShareBps / 100n;
  const fraction = poolShareBps % 100n;
  return `${whole.toString()}.${fraction.toString().padStart(2, "0")}%`;
}

function preferredPoolPair(
  tokenList: SwapTokenListState,
  deployment: PledgeCashDeployment | undefined,
): { tokenIn: Address; tokenOut: Address } | undefined {
  const pools = tokenList.pools;
  const wrappedNative = deployment?.wrappedNative;
  const preferred =
    wrappedNative && !isZeroAddress(wrappedNative)
      ? pools.find((pool) => sameAddress(pool.token0, wrappedNative) || sameAddress(pool.token1, wrappedNative)) ?? pools[0]
      : pools[0];
  if (!preferred) return undefined;
  if (wrappedNative && !isZeroAddress(wrappedNative)) {
    if (sameAddress(preferred.token0, wrappedNative)) return { tokenIn: preferred.token0, tokenOut: preferred.token1 };
    if (sameAddress(preferred.token1, wrappedNative)) return { tokenIn: preferred.token1, tokenOut: preferred.token0 };
  }
  return { tokenIn: preferred.token0, tokenOut: preferred.token1 };
}

export function pairHasWrappedNative(deployment: PledgeCashDeployment | undefined, tokenA: string, tokenB: string): boolean {
  const wrappedNative = deployment?.wrappedNative;
  return Boolean(wrappedNative && !isZeroAddress(wrappedNative) && (sameAddress(tokenA, wrappedNative) || sameAddress(tokenB, wrappedNative)));
}

export function wrappedNativeSide(deployment: PledgeCashDeployment | undefined, tokenA: string, tokenB: string): "tokenA" | "tokenB" | undefined {
  const wrappedNative = deployment?.wrappedNative;
  if (!wrappedNative || isZeroAddress(wrappedNative)) return undefined;
  if (sameAddress(tokenA, wrappedNative)) return "tokenA";
  if (sameAddress(tokenB, wrappedNative)) return "tokenB";
  return undefined;
}

export function swapNativeMode(deployment: PledgeCashDeployment | undefined, form: SwapForm): "input" | "output" | undefined {
  if (!form.useNative) return undefined;
  const wrappedNative = deployment?.wrappedNative;
  if (!wrappedNative || isZeroAddress(wrappedNative)) return undefined;
  if (sameAddress(form.tokenIn, wrappedNative)) return "input";
  if (sameAddress(form.tokenOut, wrappedNative)) return "output";
  return undefined;
}

export function swapPairLabel(quote: SwapQuoteState | undefined, form: SwapForm): string {
  const input = quote?.tokenIn?.symbol ?? shortToken(form.tokenIn);
  const output = quote?.tokenOut?.symbol ?? shortToken(form.tokenOut);
  return `${input} / ${output}`;
}

export function swapQuoteReady(quote: SwapQuoteState | undefined): quote is ExecutableSwapQuote {
  return Boolean(
    quote &&
      !quote.error &&
      swapQuoteTokensReady(quote) &&
      quote.pool &&
      swapQuoteAmountsReady(quote),
  );
}

export function defaultSwapDeadline(): string {
  return String(Math.floor(Date.now() / 1000) + 1200);
}

export function assertFutureSwapDeadline(value: string, currentUnixTime = Math.floor(Date.now() / 1000)): void {
  const deadline = parseSwapDeadline(value);
  if (deadline <= BigInt(currentUnixTime)) {
    throw new Error("The transaction window expired. Choose a fresh quote expiry before submitting.");
  }
}

function requireExecutableQuote(quote: SwapQuoteState): ExecutableSwapQuote {
  if (!swapQuoteReady(quote)) {
    throw new Error(quote.error ?? "Refresh the swap quote before submitting.");
  }
  return quote;
}

function requireExecutableLiquidityQuote(quote: LiquidityQuoteState): ExecutableLiquidityQuote {
  if (!liquidityQuoteReady(quote)) {
    throw new Error(quote.error ?? "Refresh the liquidity quote before submitting.");
  }
  return quote;
}

function requireExecutableRemoveLiquidityQuote(quote: RemoveLiquidityQuoteState): ExecutableRemoveLiquidityQuote {
  if (!removeLiquidityQuoteReady(quote)) {
    throw new Error(quote.error ?? "Refresh the remove-liquidity quote before submitting.");
  }
  return quote;
}

export function liquidityQuoteReady(quote: LiquidityQuoteState | undefined): quote is ExecutableLiquidityQuote {
  return Boolean(
    quote &&
      !quote.error &&
      liquidityQuoteTokensReady(quote) &&
      quote.pool &&
      liquidityQuoteAmountsReady(quote),
  );
}

export function removeLiquidityQuoteReady(quote: RemoveLiquidityQuoteState | undefined): quote is ExecutableRemoveLiquidityQuote {
  return Boolean(
    quote &&
      !quote.error &&
      removeLiquidityPositionReady(quote) &&
      removeLiquidityAmountsReady(quote),
  );
}

function swapQuoteTokensReady(quote: SwapQuoteState): boolean {
  return quote.tokenIn?.decimals !== undefined && quote.tokenOut?.decimals !== undefined;
}

function swapQuoteAmountsReady(quote: SwapQuoteState): boolean {
  return (
    quote.amountIn !== undefined &&
    quote.amountOut !== undefined &&
    quote.amountOutMin !== undefined
  );
}

function liquidityQuoteTokensReady(quote: LiquidityQuoteState): boolean {
  return quote.tokenA?.decimals !== undefined && quote.tokenB?.decimals !== undefined;
}

function liquidityQuoteAmountsReady(quote: LiquidityQuoteState): boolean {
  return (
    quote.amountA !== undefined &&
    quote.amountB !== undefined &&
    quote.amountAMin !== undefined &&
    quote.amountBMin !== undefined &&
    quote.liquidityOut !== undefined
  );
}

function removeLiquidityPositionReady(quote: RemoveLiquidityQuoteState): boolean {
  return Boolean(
    quote.position?.tokenA.decimals !== undefined &&
      quote.position.tokenB.decimals !== undefined &&
      quote.position.pool &&
      quote.position.lpToken?.decimals !== undefined &&
      quote.position.lpBalance !== undefined,
  );
}

function removeLiquidityAmountsReady(quote: RemoveLiquidityQuoteState): boolean {
  return (
    quote.liquidity !== undefined &&
    quote.amountA !== undefined &&
    quote.amountB !== undefined &&
    quote.amountAMin !== undefined &&
    quote.amountBMin !== undefined
  );
}

function executionMetricFields(
  metrics: SwapExecutionMetrics,
): Pick<SwapQuoteState, "effectiveExecutionPrice" | "feeInclusivePriceImpact"> {
  return {
    effectiveExecutionPrice: metrics.effectiveExecutionPrice,
    feeInclusivePriceImpact: metrics.feeInclusivePriceImpact,
  };
}

function unavailableSwapExecutionMetrics(
  reason: string,
): Pick<SwapQuoteState, "effectiveExecutionPrice" | "feeInclusivePriceImpact"> {
  return {
    effectiveExecutionPrice: unavailableMetric(reason),
    feeInclusivePriceImpact: unavailableMetric(reason),
  };
}

function baseQuote(input: {
  requestIdentity: string;
  inputToken: SwapTokenMetadata;
  outputToken: SwapTokenMetadata;
  slippageBps: number;
  amountIn?: bigint;
  feeBps?: bigint;
  feeDenominator?: bigint;
  protocolFeeShareBps?: bigint;
  error: string;
}): SwapQuoteState {
  const quote: SwapQuoteState = {
    requestIdentity: input.requestIdentity,
    tokenIn: input.inputToken,
    tokenOut: input.outputToken,
    slippageBps: input.slippageBps,
    error: input.error,
  };
  if (input.amountIn !== undefined) quote.amountIn = input.amountIn;
  if (input.feeBps !== undefined) quote.feeBps = input.feeBps;
  if (input.feeDenominator !== undefined) quote.feeDenominator = input.feeDenominator;
  if (input.protocolFeeShareBps !== undefined) quote.protocolFeeShareBps = input.protocolFeeShareBps;
  return quote;
}

function baseLiquidityQuote(input: {
  tokenA: SwapTokenMetadata;
  tokenB: SwapTokenMetadata;
  pool?: LiquidityPoolState | undefined;
  slippageBps: number;
  amountA?: bigint;
  amountB?: bigint;
  amountAMin?: bigint;
  amountBMin?: bigint;
  error: string;
}): LiquidityQuoteState {
  const quote: LiquidityQuoteState = {
    tokenA: input.tokenA,
    tokenB: input.tokenB,
    slippageBps: input.slippageBps,
    error: input.error,
  };
  if (input.pool) quote.pool = input.pool;
  if (input.amountA !== undefined) quote.amountA = input.amountA;
  if (input.amountB !== undefined) quote.amountB = input.amountB;
  if (input.amountAMin !== undefined) quote.amountAMin = input.amountAMin;
  if (input.amountBMin !== undefined) quote.amountBMin = input.amountBMin;
  return quote;
}

async function readTokenMetadata(
  client: PledgeCashReadClient,
  address: Address,
  account?: Address | undefined,
  spender?: Address | undefined,
): Promise<SwapTokenMetadata> {
  const token: SwapTokenMetadata = { address };

  try {
    token.symbol = (await client.readContract({ address, abi: erc20Abi, functionName: "symbol" })) as string;
  } catch (error) {
    token.error = errorMessage(error);
  }

  try {
    token.decimals = Number(await client.readContract({ address, abi: erc20Abi, functionName: "decimals" }));
  } catch (error) {
    token.error = token.error ?? errorMessage(error);
  }

  if (account) {
    try {
      token.balance = (await client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [account] })) as bigint;
    } catch (error) {
      token.error = token.error ?? errorMessage(error);
    }
  }

  if (account && spender) {
    try {
      token.allowance = (await client.readContract({ address, abi: erc20Abi, functionName: "allowance", args: [account, spender] })) as bigint;
    } catch (error) {
      token.error = token.error ?? errorMessage(error);
    }
  }

  return token;
}

async function readAmmFeeConfig(client: PledgeCashReadClient, factory: Address): Promise<AmmFeeConfig> {
  const [feeBps, feeDenominator, protocolFeeShareBps] = await Promise.all([
    client.readContract({ address: factory, abi: ammFactoryAbi, functionName: "SWAP_FEE_BPS" }) as Promise<bigint>,
    client.readContract({ address: factory, abi: ammFactoryAbi, functionName: "FEE_DENOMINATOR" }) as Promise<bigint>,
    client.readContract({ address: factory, abi: ammFactoryAbi, functionName: "PROTOCOL_FEE_SHARE_BPS" }) as Promise<bigint>,
  ]);

  return { feeBps, feeDenominator, protocolFeeShareBps };
}

async function readSwapPoolState(
  client: PledgeCashReadClient,
  poolAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
): Promise<SwapPoolState> {
  const [token0, token1, reserves] = await Promise.all([
    client.readContract({ address: poolAddress, abi: ammPoolAbi, functionName: "token0" }) as Promise<Address>,
    client.readContract({ address: poolAddress, abi: ammPoolAbi, functionName: "token1" }) as Promise<Address>,
    client.readContract({ address: poolAddress, abi: ammPoolAbi, functionName: "getReserves" }) as Promise<readonly [bigint, bigint, number]>,
  ]);
  const [reserve0, reserve1] = reserves;
  const tokenInIsToken0 = sameAddress(token0, tokenIn);
  const tokenInIsToken1 = sameAddress(token1, tokenIn);
  const tokenOutIsToken0 = sameAddress(token0, tokenOut);
  const tokenOutIsToken1 = sameAddress(token1, tokenOut);
  if (!(tokenInIsToken0 && tokenOutIsToken1) && !(tokenInIsToken1 && tokenOutIsToken0)) {
    throw new Error("The AMM pool token pair does not match the requested swap route.");
  }

  return {
    address: poolAddress,
    token0,
    token1,
    reserve0,
    reserve1,
    reserveIn: tokenInIsToken0 ? reserve0 : reserve1,
    reserveOut: tokenInIsToken0 ? reserve1 : reserve0,
  };
}

async function readLiquidityPool(client: PledgeCashReadClient, factory: Address, tokenA: Address, tokenB: Address): Promise<LiquidityPoolState> {
  const poolAddress = await client.readContract({ address: factory, abi: ammFactoryAbi, functionName: "getPool", args: [tokenA, tokenB] }) as Address;
  if (isZeroAddress(poolAddress)) {
    return await readPredictedLiquidityPool(client, factory, tokenA, tokenB);
  }

  return await readExistingLiquidityPool(client, poolAddress, tokenA);
}

async function readPredictedLiquidityPool(
  client: PledgeCashReadClient,
  factory: Address,
  tokenA: Address,
  tokenB: Address,
): Promise<LiquidityPoolState> {
  const predicted = await client.readContract({ address: factory, abi: ammFactoryAbi, functionName: "predictPoolAddress", args: [tokenA, tokenB] }) as Address;
  const [token0, token1] = sortTokenAddresses(tokenA, tokenB);
  return {
    address: predicted,
    exists: false,
    token0,
    token1,
    reserve0: 0n,
    reserve1: 0n,
    reserveA: 0n,
    reserveB: 0n,
    totalSupply: 0n,
  };
}

async function readExistingLiquidityPool(
  client: PledgeCashReadClient,
  poolAddress: Address,
  tokenA: Address,
): Promise<LiquidityPoolState> {
  const [token0, token1, reserves, totalSupply] = await Promise.all([
    client.readContract({ address: poolAddress, abi: ammPoolAbi, functionName: "token0" }) as Promise<Address>,
    client.readContract({ address: poolAddress, abi: ammPoolAbi, functionName: "token1" }) as Promise<Address>,
    client.readContract({ address: poolAddress, abi: ammPoolAbi, functionName: "getReserves" }) as Promise<readonly [bigint, bigint, number]>,
    client.readContract({ address: poolAddress, abi: ammPoolAbi, functionName: "totalSupply" }) as Promise<bigint>,
  ]);
  const [reserve0, reserve1] = reserves;
  const tokenAIsToken0 = sameAddress(tokenA, token0);

  return {
    address: poolAddress,
    exists: true,
    token0,
    token1,
    reserve0,
    reserve1,
    reserveA: tokenAIsToken0 ? reserve0 : reserve1,
    reserveB: tokenAIsToken0 ? reserve1 : reserve0,
    totalSupply,
  };
}

async function readEffectiveClaimable(
  client: PledgeCashReadClient,
  pool: LiquidityPoolState,
  tokenA: Address,
  account: Address,
): Promise<{ claimableA: bigint; claimableB: bigint }> {
  const [balance, stored0, stored1, index0, index1, supplyIndex0, supplyIndex1] = await Promise.all([
    client.readContract({ address: pool.address, abi: erc20Abi, functionName: "balanceOf", args: [account] }) as Promise<bigint>,
    client.readContract({ address: pool.address, abi: ammPoolAbi, functionName: "claimable0", args: [account] }) as Promise<bigint>,
    client.readContract({ address: pool.address, abi: ammPoolAbi, functionName: "claimable1", args: [account] }) as Promise<bigint>,
    client.readContract({ address: pool.address, abi: ammPoolAbi, functionName: "index0" }) as Promise<bigint>,
    client.readContract({ address: pool.address, abi: ammPoolAbi, functionName: "index1" }) as Promise<bigint>,
    client.readContract({ address: pool.address, abi: ammPoolAbi, functionName: "supplyIndex0", args: [account] }) as Promise<bigint>,
    client.readContract({ address: pool.address, abi: ammPoolAbi, functionName: "supplyIndex1", args: [account] }) as Promise<bigint>,
  ]);

  const claimable0 = stored0 + pendingFee(balance, index0, supplyIndex0);
  const claimable1 = stored1 + pendingFee(balance, index1, supplyIndex1);
  return sameAddress(pool.token0, tokenA)
    ? { claimableA: claimable0, claimableB: claimable1 }
    : { claimableA: claimable1, claimableB: claimable0 };
}

function requireDeploymentAddress(address: Address | undefined, label: string): Address {
  if (!address || isZeroAddress(address)) throw new Error(`${label} is not configured for this chain.`);
  return address;
}

function requireWrappedNativeSide(deployment: PledgeCashDeployment | undefined, tokenA: Address, tokenB: Address): "tokenA" | "tokenB" {
  const side = wrappedNativeSide(deployment, tokenA, tokenB);
  if (!side) throw new Error("Native mode requires one side to be the configured wrapped-native token.");
  return side;
}

function requireSwapNativeMode(deployment: PledgeCashDeployment | undefined, tokenIn: Address, tokenOut: Address): "input" | "output" {
  const mode = swapNativeMode(deployment, {
    tokenIn,
    tokenOut,
    amountIn: "0",
    slippageBps: "0",
    recipient: "",
    deadline: "0",
    useNative: true,
  });
  if (!mode) throw new Error("Native swap mode requires the input or output token to be the configured wrapped-native token.");
  return mode;
}

function requireTokenAddress(value: string, label: string): Address {
  const trimmed = value.trim();
  if (!isAddress(trimmed)) throw new Error(`${label} must be a valid address.`);
  return trimmed;
}

function parseSlippageBps(value: string): number {
  const trimmed = value.trim() || "0";
  if (!isUnsignedInteger(trimmed)) throw new Error("Slippage must be whole basis points.");
  const bps = Number(trimmed);
  if (!Number.isSafeInteger(bps) || bps < 0 || bps >= FULL_BPS) throw new Error("Slippage must be between 0 and 9999 bps.");
  return bps;
}

function applySlippage(amount: bigint, bps: number): bigint {
  return (amount * BigInt(FULL_BPS - bps)) / FULL_BPS_BIGINT;
}

function optimalLiquidityAmounts(pool: LiquidityPoolState, amountADesired: bigint, amountBDesired: bigint): readonly [bigint, bigint] {
  if (pool.reserveA === 0n && pool.reserveB === 0n) return [amountADesired, amountBDesired];

  const amountBOptimal = quoteAmount(amountADesired, pool.reserveA, pool.reserveB);
  if (amountBOptimal <= amountBDesired) return [amountADesired, amountBOptimal];
  return [quoteAmount(amountBDesired, pool.reserveB, pool.reserveA), amountBDesired];
}

function removeLiquidityAmounts(pool: LiquidityPoolState, liquidity: bigint): readonly [bigint, bigint] {
  return [
    (liquidity * pool.reserveA) / pool.totalSupply,
    (liquidity * pool.reserveB) / pool.totalSupply,
  ];
}

function quoteAmount(amountA: bigint, reserveA: bigint, reserveB: bigint): bigint {
  if (amountA === 0n || reserveA === 0n || reserveB === 0n) return 0n;
  return (amountA * reserveB) / reserveA;
}

function estimateLiquidityOut(pool: LiquidityPoolState, amountA: bigint, amountB: bigint): bigint {
  if (pool.totalSupply === 0n) {
    const root = bigintSqrt(amountA * amountB);
    return root > AMM_MINIMUM_LIQUIDITY ? root - AMM_MINIMUM_LIQUIDITY : 0n;
  }

  const liquidityA = (amountA * pool.totalSupply) / pool.reserveA;
  const liquidityB = (amountB * pool.totalSupply) / pool.reserveB;
  return liquidityA < liquidityB ? liquidityA : liquidityB;
}

function pendingFee(balance: bigint, currentIndex: bigint, suppliedIndex: bigint): bigint {
  if (balance === 0n || currentIndex <= suppliedIndex) return 0n;
  return (balance * (currentIndex - suppliedIndex)) / FEE_INDEX_SCALE;
}

function bigintSqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let left = 1n;
  let right = value;
  while (right - left > 1n) {
    const mid = (left + right) / 2n;
    if (mid * mid <= value) {
      left = mid;
    } else {
      right = mid;
    }
  }
  return left;
}

function parseSwapDeadline(value: string): bigint {
  const trimmed = value.trim();
  if (!isUnsignedInteger(trimmed)) throw new Error("Deadline must be a Unix timestamp.");
  return BigInt(trimmed);
}

function shortToken(value: string): string {
  return value && isAddress(value) ? `${value.slice(0, 6)}...${value.slice(-4)}` : "Token";
}

type TokenAccumulator = {
  address: Address;
  labels: string[];
  sources: Set<SwapTokenSource>;
  pools: Set<Address>;
  pairAddresses: Set<Address>;
  rank: number;
};

function addTokenAccumulator(
  tokens: Map<string, TokenAccumulator>,
  address: Address | undefined,
  input: { source: SwapTokenSource; rank: number; label?: string | undefined; pool?: Address | undefined; pair?: Address | undefined },
): void {
  if (!address || isZeroAddress(address)) return;
  const key = address.toLowerCase();
  let token = tokens.get(key);
  if (!token) {
    token = {
      address,
      labels: [],
      sources: new Set(),
      pools: new Set(),
      pairAddresses: new Set(),
      rank: input.rank,
    };
    tokens.set(key, token);
  }

  if (input.label && !token.labels.includes(input.label)) token.labels.push(input.label);
  token.sources.add(input.source);
  if (input.pool) token.pools.add(input.pool);
  if (input.pair) token.pairAddresses.add(input.pair);
  token.rank = Math.min(token.rank, input.rank);
}

async function readPoolCount(client: PledgeCashReadClient, factory: Address): Promise<number> {
  const raw = await client.readContract({ address: factory, abi: ammFactoryAbi, functionName: "allPoolsLength" });
  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("AMM pool count is too large to display safely.");
  return count;
}

async function readPoolSummaries(
  client: PledgeCashReadClient,
  factory: Address,
  signal?: AbortSignal | undefined,
): Promise<{ pools: SwapPoolSummary[]; error?: string | undefined }> {
  throwIfSwapReadAborted(signal);
  const poolCount = await readPoolCount(client, factory);
  const cappedPoolCount = Math.min(poolCount, MAX_DISCOVERED_POOLS);
  const firstPoolIndex = poolCount - cappedPoolCount;
  const poolAddresses = await readPoolAddresses(client, factory, firstPoolIndex, cappedPoolCount, signal);
  const pools = await mapInBatches(
    poolAddresses,
    SWAP_DISCOVERY_CONCURRENCY,
    async (address) => await readPoolSummary(client, address),
    signal,
  );

  if (poolCount <= cappedPoolCount) return { pools };
  return {
    pools,
    error: `Showing the newest ${cappedPoolCount.toString()} pools. Enter a token address to work with an older pool.`,
  };
}

async function readPoolAddresses(
  client: PledgeCashReadClient,
  factory: Address,
  start: number,
  count: number,
  signal?: AbortSignal | undefined,
): Promise<Address[]> {
  return await mapInBatches(
    Array.from({ length: count }, (_, index) => index),
    SWAP_DISCOVERY_CONCURRENCY,
    async (index) => await client.readContract({
        address: factory,
        abi: ammFactoryAbi,
        functionName: "allPools",
        args: [BigInt(start + index)],
      }) as Address,
    signal,
  );
}

async function readPoolSummary(client: PledgeCashReadClient, address: Address): Promise<SwapPoolSummary> {
  const [token0, token1, reserves] = await Promise.all([
    client.readContract({ address, abi: ammPoolAbi, functionName: "token0" }) as Promise<Address>,
    client.readContract({ address, abi: ammPoolAbi, functionName: "token1" }) as Promise<Address>,
    client.readContract({ address, abi: ammPoolAbi, functionName: "getReserves" }) as Promise<readonly [bigint, bigint, number]>,
  ]);
  const [reserve0, reserve1] = reserves;
  return { address, token0, token1, reserve0, reserve1 };
}

function addPoolTokens(tokens: Map<string, TokenAccumulator>, pools: readonly SwapPoolSummary[]): void {
  for (const pool of pools) {
    addTokenAccumulator(tokens, pool.token0, { source: "pool", pool: pool.address, pair: pool.token1, rank: 20 });
    addTokenAccumulator(tokens, pool.token1, { source: "pool", pool: pool.address, pair: pool.token0, rank: 20 });
  }
}

async function tokenOptionFromAccumulator(client: PledgeCashReadClient, token: TokenAccumulator, account: Address | undefined): Promise<SwapTokenOption> {
  const metadata = await readTokenMetadata(client, token.address, account);
  const option: SwapTokenOption = {
    ...metadata,
    sources: Array.from(token.sources),
    pools: Array.from(token.pools),
    pairAddresses: Array.from(token.pairAddresses),
  };
  const label = token.labels[0];
  if (label) option.label = label;
  return option;
}

function compareTokenOptions(left: SwapTokenOption, right: SwapTokenOption): number {
  return tokenRank(left) - tokenRank(right) || tokenName(left).localeCompare(tokenName(right)) || left.address.localeCompare(right.address);
}

function tokenRank(token: SwapTokenOption): number {
  if (token.sources.includes("deployment")) return 0;
  if (token.label === "USDC / cash") return 1;
  return 20;
}

function tokenName(token: SwapTokenOption): string {
  return token.symbol || token.label || token.address;
}

function sortTokenAddresses(tokenA: Address, tokenB: Address): readonly [Address, Address] {
  return BigInt(tokenA) < BigInt(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA];
}

function uniquePoolAddresses(addresses: readonly Address[]): Address[] {
  const seen = new Set<string>();
  return addresses.filter((address) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniquePoolSummaries(pools: readonly SwapPoolSummary[]): SwapPoolSummary[] {
  const seen = new Set<string>();
  return pools.filter((pool) => {
    const key = pool.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function mapInBatches<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input) => Promise<Output>,
  signal?: AbortSignal | undefined,
): Promise<Output[]> {
  const results: Output[] = [];
  for (let index = 0; index < values.length; index += concurrency) {
    throwIfSwapReadAborted(signal);
    results.push(...await Promise.all(values.slice(index, index + concurrency).map(mapper)));
  }
  throwIfSwapReadAborted(signal);
  return results;
}

function throwIfSwapReadAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("AMM loading was cancelled.", "AbortError");
}

function raceWithSwapReadAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("AMM loading was cancelled.", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new DOMException("AMM loading was cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isUnsignedInteger(value: string): boolean {
  return /^\d+$/.test(value);
}
