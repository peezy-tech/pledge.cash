import {
  buildProtocolLiquidityClaimDepositTransaction,
  buildProtocolLiquidityClaimRedemptionTransaction,
  buildUniswapV4SwapExactInputSingleTransaction,
  discoverBoardroomProtocolLiquidity,
  erc20Abi,
  isZeroAddress,
  pledgeV4LiquidityFactoryAbi,
  readPermit2Allowance,
  readProtocolLiquidityVaultState,
  readUniswapV4ExactInputSingleQuote,
  readUniswapV4PoolState,
  type Address,
  type PledgeCashDeployment,
  type PledgeCashLogClient,
  type PledgeCashReadClient,
  type UniswapV4PoolKey,
} from "@pledge.cash/sdk";
import { isAddress, type Hex } from "viem";
import { errorMessage } from "./forms";
import {
  divideRationals,
  exactRational,
  exactTokenAmount,
  knownMetric,
  normalizedPriceFromAmounts,
  subtractRationals,
  unavailableMetric,
  type ExactRational,
  type MetricState,
  type NormalizedPrice,
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
  /** Effective Universal Router allowance after both ERC20-to-Permit2 and Permit2-to-router gates. */
  allowance?: bigint;
  erc20Allowance?: bigint;
  permit2Allowance?: bigint;
  permit2Expiration?: number;
  error?: string;
};

export type SwapTokenSource = "pool" | "deployment" | "custom";

export type SwapTokenListOptions = {
  discoveryMode?: "global" | "pinned-only" | undefined;
  /** Canonical pledge.cash v4 vault addresses, retained under the historical option name. */
  pinnedPools?: readonly Address[] | undefined;
  signal?: AbortSignal | undefined;
  wrappedNativeLabel?: string;
};

/** A canonical pledge.cash Uniswap v4 pool, identified by PoolId and represented in the UI by its P4LP vault. */
export type SwapPoolSummary = {
  address: Address;
  token0: Address;
  token1: Address;
  poolId?: Hex;
  fee?: number;
  tickSpacing?: number;
  hooks?: Address;
  liquidity?: bigint;
  sqrtPriceX96?: bigint;
};

export type SwapPoolState = SwapPoolSummary & {
  poolId: Hex;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  liquidity: bigint;
  sqrtPriceX96: bigint;
};

export type LiquidityPoolState = {
  address: Address;
  exists: boolean;
  token0: Address;
  token1: Address;
  totalSupply: bigint;
  poolId?: Hex;
  positionLiquidity?: bigint;
  sqrtPriceX96?: bigint;
  liquidityState?: number;
  fee?: number;
  tickSpacing?: number;
  hooks?: Address;
  tickLower?: number;
  tickUpper?: number;
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
  gasEstimate?: bigint;
  effectiveExecutionPrice?: MetricState<NormalizedPrice>;
  feeInclusivePriceImpact?: MetricState<ExactRational>;
  error?: string;
};

export type LiquidityQuoteState = {
  tokenA?: SwapTokenMetadata;
  tokenB?: SwapTokenMetadata;
  pool?: LiquidityPoolState;
  amountADesired?: bigint;
  amountBDesired?: bigint;
  amountA?: bigint;
  amountB?: bigint;
  amountAMin?: bigint;
  amountBMin?: bigint;
  liquidityOut?: bigint;
  slippageBps: number;
  error?: string;
};

/** P4LP is a fungible claim on the Boardroom's canonical full-range v4 position. */
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

export type SwapTokenOption = SwapTokenMetadata & {
  label?: string;
  sources: SwapTokenSource[];
  pools: Address[];
  pairAddresses: Address[];
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
  pool: LiquidityPoolState & { poolId: Hex };
  amountADesired: bigint;
  amountBDesired: bigint;
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
    pool: LiquidityPoolState & { poolId: Hex };
    lpToken: SwapTokenMetadata & { decimals: number };
    lpBalance: bigint;
  };
  liquidity: bigint;
  amountA: bigint;
  amountB: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
};

type TokenAccumulator = {
  address: Address;
  label?: string;
  rank: number;
  sources: Set<SwapTokenSource>;
  pools: Set<Address>;
  pairAddresses: Set<Address>;
};

type SwapReadClient = PledgeCashReadClient & Partial<PledgeCashLogClient>;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;
const DEFAULT_SLIPPAGE_BPS = 50;
const FULL_BPS = 10_000;
const FULL_BPS_BIGINT = 10_000n;
const V4_FEE_DENOMINATOR = 1_000_000n;
const P4LP_PROTOCOL_FEE_SHARE_BPS = 500n;
const Q96 = 1n << 96n;
const Q192 = 1n << 192n;
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
  deployment?: PledgeCashDeployment,
): SwapForm {
  const defaults = preferredPoolPair(tokenList, deployment);
  if (!defaults) return form;
  const tokenIn = form.tokenIn || defaults.tokenIn;
  return {
    ...form,
    tokenIn,
    tokenOut: defaultTokenOut(form.tokenOut, tokenIn, defaults.tokenOut),
    useNative: false,
  };
}

export function withLiquidityTokenListDefaults(
  form: LiquidityForm,
  tokenList: SwapTokenListState,
  deployment?: PledgeCashDeployment,
): LiquidityForm {
  const defaults = preferredPoolPair(tokenList, deployment);
  if (!defaults) return form;
  const tokenA = form.tokenA || defaults.tokenIn;
  return {
    ...form,
    tokenA,
    tokenB: defaultTokenOut(form.tokenB, tokenA, defaults.tokenOut),
    useNative: false,
  };
}

export async function readSwapTokenList(
  client: SwapReadClient,
  deployment: PledgeCashDeployment | undefined,
  account?: Address,
  options: SwapTokenListOptions = {},
): Promise<SwapTokenListState> {
  throwIfSwapReadAborted(options.signal);
  const tokens = new Map<string, TokenAccumulator>();
  addTokenAccumulator(tokens, deployment?.wrappedNative, {
    label: options.wrappedNativeLabel || "Wrapped native",
    source: "deployment",
    rank: 0,
  });

  const errors: string[] = [];
  let pools: SwapPoolSummary[] = [];
  if ((options.discoveryMode ?? "global") === "global") {
    if (!deployment?.pledgeV4LiquidityFactory) {
      errors.push("The pledge.cash v4 liquidity factory is not configured.");
    } else if (typeof client.getLogs !== "function") {
      errors.push("This client cannot discover canonical v4 liquidity events.");
    } else {
      const discovery = await discoverBoardroomProtocolLiquidity(client as PledgeCashLogClient, {
        factory: deployment.pledgeV4LiquidityFactory,
        fromBlock: deployment.deploymentBlock ?? 0n,
        chunkSize: 100_000n,
      });
      // Discovery is newest-first, so keep the head of the bounded catalog.
      const discovered = discovery.items.slice(0, MAX_DISCOVERED_POOLS);
      const hydrated = await mapInBatches(
        discovered,
        SWAP_DISCOVERY_CONCURRENCY,
        async (item) => await readPoolSummary(client, deployment, item.vault),
        options.signal,
      );
      pools.push(...hydrated.fulfilled);
      errors.push(...discovery.errors.map((entry) => entry.message), ...hydrated.errors);
      if (discovery.items.length > discovered.length) {
        errors.push(`Only the newest ${MAX_DISCOVERED_POOLS.toString()} canonical v4 pools are shown.`);
      }
    }
  }

  const pinned = uniqueAddresses(options.pinnedPools ?? []);
  const boundedPinned = pinned.slice(-MAX_PINNED_POOLS);
  const missing = boundedPinned.filter((vault) => !pools.some((pool) => sameAddress(pool.address, vault)));
  const hydratedPinned = await mapInBatches(
    missing,
    SWAP_DISCOVERY_CONCURRENCY,
    async (vault) => await readPoolSummary(client, deployment, vault),
    options.signal,
  );
  pools = uniquePoolSummaries([...pools, ...hydratedPinned.fulfilled]);
  errors.push(...hydratedPinned.errors);
  if (pinned.length > boundedPinned.length) {
    errors.push(`Only the newest ${MAX_PINNED_POOLS.toString()} project pools can be pinned at once.`);
  }

  addPoolTokens(tokens, pools);
  const tokenResults = await mapInBatches(
    [...tokens.values()].sort((left, right) => left.rank - right.rank),
    SWAP_DISCOVERY_CONCURRENCY,
    async (entry) => await tokenOptionFromAccumulator(client, entry, account),
    options.signal,
  );
  errors.push(...tokenResults.errors);
  const result: SwapTokenListState = {
    tokens: tokenResults.fulfilled.sort(compareTokenOptions),
    pools,
    loaded: true,
  };
  if (errors.length > 0) result.error = uniqueStrings(errors).join(" ");
  return result;
}

export async function readSwapQuote(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  form: SwapForm,
  account?: Address,
): Promise<SwapQuoteState> {
  const requestIdentity = swapQuoteRequestIdentity(form);
  let slippageBps = DEFAULT_SLIPPAGE_BPS;
  try {
    slippageBps = parseSlippageBps(form.slippageBps);
    if (form.useNative) throw new Error("Uniswap v4 swaps currently require wrapped ERC20 input; wrap native currency first.");
    const factory = requireDeploymentAddress(deployment?.pledgeV4LiquidityFactory, "pledge.cash v4 liquidity factory");
    const router = requireDeploymentAddress(deployment?.uniswapUniversalRouter, "Uniswap Universal Router");
    const quoter = requireDeploymentAddress(deployment?.uniswapV4Quoter, "Uniswap v4 Quoter");
    const permit2 = requireDeploymentAddress(deployment?.permit2, "Permit2");
    const tokenIn = requireTokenAddress(form.tokenIn, "From token");
    const tokenOut = requireTokenAddress(form.tokenOut, "To token");
    if (sameAddress(tokenIn, tokenOut)) throw new Error("Choose two different tokens.");

    const pool = await readCanonicalSwapPool(client, deployment, factory, tokenIn, tokenOut);
    const [inputToken, outputToken] = await Promise.all([
      readTokenMetadata(client, tokenIn, account, { permit2, router }),
      readTokenMetadata(client, tokenOut, account),
    ]);
    if (inputToken.decimals === undefined) return baseQuote(requestIdentity, inputToken, outputToken, slippageBps, "From token decimals could not be read.");
    if (outputToken.decimals === undefined) return baseQuote(requestIdentity, inputToken, outputToken, slippageBps, "To token decimals could not be read.");
    const amountIn = parseTokenAmountInput(form.amountIn, inputToken, "Input amount");
    if (amountIn === 0n) return baseQuote(requestIdentity, inputToken, outputToken, slippageBps, "Enter a positive input amount.", amountIn);
    if (pool.liquidity === 0n) {
      return {
        ...baseQuote(requestIdentity, inputToken, outputToken, slippageBps, "The Uniswap v4 pool has no active liquidity.", amountIn),
        pool,
        ...unavailableSwapExecutionMetrics("The Uniswap v4 pool has no active liquidity."),
      };
    }

    const quoted = await readUniswapV4ExactInputSingleQuote(client, {
      quoter,
      poolKey: poolKeyFromPool(pool),
      currencyIn: tokenIn,
      amountIn,
    });
    const amountOut = quoted.amountOut;
    const amountOutMin = applySlippage(amountOut, slippageBps);
    const metrics = swapQuoteExecutionMetrics({ tokenIn: inputToken, tokenOut: outputToken, pool, amountIn, amountOut });
    return {
      requestIdentity,
      tokenIn: inputToken,
      tokenOut: outputToken,
      pool,
      amountIn,
      amountOut,
      amountOutMin,
      slippageBps,
      feeBps: BigInt(pool.fee),
      feeDenominator: V4_FEE_DENOMINATOR,
      protocolFeeShareBps: P4LP_PROTOCOL_FEE_SHARE_BPS,
      gasEstimate: quoted.gasEstimate,
      ...metrics,
      ...(amountOut === 0n ? { error: "Swap output would be zero." } : {}),
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
  if (input.amountIn === 0n || input.pool.sqrtPriceX96 === 0n) {
    return unavailableSwapExecutionMetrics("The v4 pool does not expose a usable price.");
  }
  const effectiveRaw = exactRational(input.amountOut, input.amountIn);
  const tokenInIsCurrency0 = sameAddress(input.tokenIn.address, input.pool.token0);
  const spotRaw = tokenInIsCurrency0
    ? exactRational(input.pool.sqrtPriceX96 * input.pool.sqrtPriceX96, Q192)
    : exactRational(Q192, input.pool.sqrtPriceX96 * input.pool.sqrtPriceX96);
  return {
    effectiveExecutionPrice: knownMetric(normalizedPriceFromAmounts(
      exactTokenAmount(input.tokenIn.address, input.amountIn, input.tokenIn.decimals),
      exactTokenAmount(input.tokenOut.address, input.amountOut, input.tokenOut.decimals),
    )),
    feeInclusivePriceImpact: knownMetric(divideRationals(subtractRationals(spotRaw, effectiveRaw), spotRaw)),
  };
}

export async function readLiquidityQuote(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  form: LiquidityForm,
  account?: Address,
): Promise<LiquidityQuoteState> {
  let slippageBps = DEFAULT_SLIPPAGE_BPS;
  try {
    slippageBps = parseSlippageBps(form.slippageBps);
    if (form.useNative) throw new Error("P4LP deposits require wrapped ERC20 tokens; wrap native currency first.");
    const tokenA = requireTokenAddress(form.tokenA, "Token A");
    const tokenB = requireTokenAddress(form.tokenB, "Token B");
    if (sameAddress(tokenA, tokenB)) throw new Error("Choose two different tokens.");
    const pool = await readLiquidityPool(client, deployment, tokenA, tokenB);
    if (!pool.exists) throw new Error("No canonical pledge.cash v4 vault exists for this pair.");
    if (pool.liquidityState !== 1) throw new Error("This P4LP vault is not accepting deposits.");
    const [tokenAMetadata, tokenBMetadata] = await Promise.all([
      readTokenMetadata(client, tokenA, account, { spender: pool.address }),
      readTokenMetadata(client, tokenB, account, { spender: pool.address }),
    ]);
    if (tokenAMetadata.decimals === undefined) return baseLiquidityQuote(tokenAMetadata, tokenBMetadata, pool, slippageBps, "Token A decimals could not be read.");
    if (tokenBMetadata.decimals === undefined) return baseLiquidityQuote(tokenAMetadata, tokenBMetadata, pool, slippageBps, "Token B decimals could not be read.");
    const amountADesired = parseTokenAmountInput(form.amountA, tokenAMetadata, "Token A amount");
    const amountBDesired = parseTokenAmountInput(form.amountB, tokenBMetadata, "Token B amount");
    if (amountADesired === 0n || amountBDesired === 0n) {
      return baseLiquidityQuote(tokenAMetadata, tokenBMetadata, pool, slippageBps, "Enter positive amounts for both tokens.");
    }
    const estimated = estimateP4LpDeposit(pool, tokenA, amountADesired, amountBDesired);
    if (estimated.liquidity === 0n) {
      return baseLiquidityQuote(tokenAMetadata, tokenBMetadata, pool, slippageBps, "P4LP output would be zero.");
    }
    return {
      tokenA: tokenAMetadata,
      tokenB: tokenBMetadata,
      pool,
      amountADesired,
      amountBDesired,
      amountA: estimated.amountA,
      amountB: estimated.amountB,
      amountAMin: applySlippage(estimated.amountA, slippageBps),
      amountBMin: applySlippage(estimated.amountB, slippageBps),
      liquidityOut: estimated.liquidity,
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
  account?: Address,
): Promise<AmmPositionState | undefined> {
  try {
    const tokenA = requireTokenAddress(tokenAInput, "Token A");
    const tokenB = requireTokenAddress(tokenBInput, "Token B");
    if (sameAddress(tokenA, tokenB)) throw new Error("Choose two different tokens.");
    const pool = await readLiquidityPool(client, deployment, tokenA, tokenB);
    const [tokenAMetadata, tokenBMetadata] = await Promise.all([
      readTokenMetadata(client, tokenA, account),
      readTokenMetadata(client, tokenB, account),
    ]);
    const base: AmmPositionState = { tokenA: tokenAMetadata, tokenB: tokenBMetadata, pool };
    if (!pool.exists) return base;
    const lpToken = await readTokenMetadata(client, pool.address, account);
    const lpBalance = lpToken.balance ?? 0n;
    return {
      ...base,
      lpToken,
      lpBalance,
      // P4LP redemption burns the caller's claims directly and never requires allowance.
      lpAllowance: lpBalance,
      poolShareBps: pool.totalSupply === 0n ? 0n : (lpBalance * FULL_BPS_BIGINT) / pool.totalSupply,
    };
  } catch (error) {
    if (!isAddress(tokenAInput) || !isAddress(tokenBInput)) return undefined;
    return {
      tokenA: { address: tokenAInput },
      tokenB: { address: tokenBInput },
      error: errorMessage(error),
    };
  }
}

export async function readRemoveLiquidityQuote(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  pairForm: LiquidityForm,
  removeForm: RemoveLiquidityForm,
  account?: Address,
): Promise<RemoveLiquidityQuoteState> {
  let slippageBps = DEFAULT_SLIPPAGE_BPS;
  try {
    slippageBps = parseSlippageBps(removeForm.slippageBps);
    if (removeForm.useNative) throw new Error("P4LP redemption returns ERC20 tokens; unwrap wrapped native separately.");
    const position = await readAmmPosition(client, deployment, pairForm.tokenA, pairForm.tokenB, account);
    if (!position?.pool?.exists || !position.lpToken) {
      return { ...(position ? { position } : {}), slippageBps, error: "No canonical P4LP vault exists for this pair." };
    }
    if (position.pool.liquidityState !== 2) {
      return { position, slippageBps, error: "P4LP claims become redeemable only after the Boardroom enters wind-down claims mode." };
    }
    if (position.lpToken.decimals === undefined) return { position, slippageBps, error: "P4LP decimals could not be read." };
    const claims = parseTokenAmountInput(removeForm.liquidity, position.lpToken, "P4LP amount");
    if (claims === 0n) return { position, liquidity: claims, slippageBps, error: "Enter a positive P4LP amount." };
    if (claims > (position.lpBalance ?? 0n)) return { position, liquidity: claims, slippageBps, error: "P4LP amount exceeds your balance." };
    const supply = position.pool.totalSupply;
    const positionLiquidity = position.pool.positionLiquidity ?? 0n;
    if (supply === 0n || positionLiquidity === 0n) return { position, liquidity: claims, slippageBps, error: "The P4LP vault has no redeemable position." };
    const liquidity = claims === supply ? positionLiquidity : (positionLiquidity * claims) / supply;
    const [amount0, amount1] = positionAmounts(position.pool, liquidity, false);
    const tokenAIs0 = sameAddress(position.tokenA.address, position.pool.token0);
    const principalA = tokenAIs0 ? amount0 : amount1;
    const principalB = tokenAIs0 ? amount1 : amount0;
    const [vaultBalanceA, vaultBalanceB] = await Promise.all([
      client.readContract({
        address: position.tokenA.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [position.pool.address],
      }) as Promise<bigint>,
      client.readContract({
        address: position.tokenB.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [position.pool.address],
      }) as Promise<bigint>,
    ]);
    const backingA = claims === supply ? vaultBalanceA : (vaultBalanceA * claims) / supply;
    const backingB = claims === supply ? vaultBalanceB : (vaultBalanceB * claims) / supply;
    const amountA = principalA + backingA;
    const amountB = principalB + backingB;
    if (liquidity === 0n || (amountA === 0n && amountB === 0n)) {
      return { position, liquidity: claims, amountA, amountB, slippageBps, error: "P4LP amount is too small for this position." };
    }
    return {
      position,
      liquidity: claims,
      amountA,
      amountB,
      amountAMin: applySlippage(amountA, slippageBps),
      amountBMin: applySlippage(amountB, slippageBps),
      slippageBps,
    };
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
  if (input.form.useNative) throw new Error("Wrap native currency before using the v4 swap route.");
  const quote = requireExecutableQuote(input.quote);
  return buildUniswapV4SwapExactInputSingleTransaction({
    universalRouter: requireDeploymentAddress(input.deployment?.uniswapUniversalRouter, "Uniswap Universal Router"),
    poolKey: poolKeyFromPool(quote.pool),
    currencyIn: quote.tokenIn.address,
    amountIn: quote.amountIn,
    amountOutMin: quote.amountOutMin,
    recipient: input.form.recipient.trim() ? requireTokenAddress(input.form.recipient, "Recipient") : input.account,
    deadline: parseSwapDeadline(input.form.deadline),
  });
}

export function buildAddLiquidityTransaction(input: {
  deployment: PledgeCashDeployment | undefined;
  form: LiquidityForm;
  quote: LiquidityQuoteState;
  account: Address;
}) {
  if (input.form.useNative) throw new Error("Wrap native currency before depositing P4LP liquidity.");
  const quote = requireExecutableLiquidityQuote(input.quote);
  return buildProtocolLiquidityClaimDepositTransaction({
    vault: quote.pool.address,
    amountADesired: quote.amountADesired,
    amountBDesired: quote.amountBDesired,
    amountAMin: quote.amountAMin,
    amountBMin: quote.amountBMin,
    recipient: input.form.recipient.trim() ? requireTokenAddress(input.form.recipient, "Recipient") : input.account,
    deadline: parseSwapDeadline(input.form.deadline),
  });
}

export function buildRemoveLiquidityTransaction(input: {
  deployment: PledgeCashDeployment | undefined;
  form: RemoveLiquidityForm;
  quote: RemoveLiquidityQuoteState;
  account: Address;
}) {
  if (input.form.useNative) throw new Error("P4LP redemption returns wrapped ERC20 tokens.");
  const quote = requireExecutableRemoveLiquidityQuote(input.quote);
  return buildProtocolLiquidityClaimRedemptionTransaction({
    vault: quote.position.pool.address,
    claims: quote.liquidity,
    amountAMin: quote.amountAMin,
    amountBMin: quote.amountBMin,
    recipient: input.form.recipient.trim() ? requireTokenAddress(input.form.recipient, "Recipient") : input.account,
    deadline: parseSwapDeadline(input.form.deadline),
  });
}

export function buildClaimAmmFeesTransaction(_position: AmmPositionState): never {
  throw new Error("P4LP fees remain in claim backing and are realized when claims are redeemed after wind-down.");
}

export function formatSwapAmount(amount: bigint | undefined, token: SwapTokenMetadata | undefined): string {
  return formatTokenAmount(amount, token);
}

export function formatPoolShareBps(poolShareBps: bigint | undefined): string {
  if (poolShareBps === undefined) return "Unknown";
  if (poolShareBps === 0n) return "0%";
  return `${(poolShareBps / 100n).toString()}.${(poolShareBps % 100n).toString().padStart(2, "0")}%`;
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

/** Native routing is intentionally disabled until the Universal Router action plan includes explicit wrap/unwrap actions. */
export function swapNativeMode(_deployment: PledgeCashDeployment | undefined, _form: SwapForm): undefined {
  return undefined;
}

export function swapPairLabel(quote: SwapQuoteState | undefined, form: SwapForm): string {
  return `${quote?.tokenIn?.symbol ?? shortToken(form.tokenIn)} / ${quote?.tokenOut?.symbol ?? shortToken(form.tokenOut)}`;
}

export function swapQuoteReady(quote: SwapQuoteState | undefined): quote is ExecutableSwapQuote {
  return Boolean(quote && !quote.error && quote.tokenIn?.decimals !== undefined && quote.tokenOut?.decimals !== undefined && quote.pool && quote.amountIn !== undefined && quote.amountOut !== undefined && quote.amountOutMin !== undefined);
}

export function liquidityQuoteReady(quote: LiquidityQuoteState | undefined): quote is ExecutableLiquidityQuote {
  return Boolean(quote && !quote.error && quote.tokenA?.decimals !== undefined && quote.tokenB?.decimals !== undefined && quote.pool?.poolId && quote.amountADesired !== undefined && quote.amountBDesired !== undefined && quote.amountA !== undefined && quote.amountB !== undefined && quote.amountAMin !== undefined && quote.amountBMin !== undefined && quote.liquidityOut !== undefined);
}

export function removeLiquidityQuoteReady(quote: RemoveLiquidityQuoteState | undefined): quote is ExecutableRemoveLiquidityQuote {
  return Boolean(quote && !quote.error && quote.position?.tokenA.decimals !== undefined && quote.position.tokenB.decimals !== undefined && quote.position.pool?.poolId && quote.position.lpToken?.decimals !== undefined && quote.position.lpBalance !== undefined && quote.liquidity !== undefined && quote.amountA !== undefined && quote.amountB !== undefined && quote.amountAMin !== undefined && quote.amountBMin !== undefined);
}

export function defaultSwapDeadline(): string {
  return String(Math.floor(Date.now() / 1000) + 1200);
}

export function assertFutureSwapDeadline(value: string, currentUnixTime = Math.floor(Date.now() / 1000)): void {
  if (parseSwapDeadline(value) <= BigInt(currentUnixTime)) {
    throw new Error("The transaction window expired. Choose a fresh quote expiry before submitting.");
  }
}

async function readCanonicalSwapPool(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  factory: Address,
  tokenIn: Address,
  tokenOut: Address,
): Promise<SwapPoolState> {
  const poolId = await client.readContract({
    address: factory,
    abi: pledgeV4LiquidityFactoryAbi,
    functionName: "poolIdFor",
    args: [tokenIn, tokenOut],
  }) as Hex;
  const vault = await client.readContract({
    address: factory,
    abi: pledgeV4LiquidityFactoryAbi,
    functionName: "vaultForPoolId",
    args: [poolId],
  }) as Address;
  if (isZeroAddress(vault)) throw new Error("No canonical pledge.cash Uniswap v4 pool exists for this pair.");
  const summary = await readPoolSummary(client, deployment, vault);
  if (!samePair(summary.token0, summary.token1, tokenIn, tokenOut)) {
    throw new Error("The canonical v4 vault does not match the requested token pair.");
  }
  return {
    ...summary,
    poolId: requireHex(summary.poolId, "PoolId"),
    fee: requireNumber(summary.fee, "Pool fee"),
    tickSpacing: requireNumber(summary.tickSpacing, "Tick spacing"),
    hooks: requireAddress(summary.hooks, "Pool hook"),
    liquidity: summary.liquidity ?? 0n,
    sqrtPriceX96: summary.sqrtPriceX96 ?? 0n,
  };
}

async function readLiquidityPool(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  tokenA: Address,
  tokenB: Address,
): Promise<LiquidityPoolState> {
  const factory = requireDeploymentAddress(deployment?.pledgeV4LiquidityFactory, "pledge.cash v4 liquidity factory");
  const poolId = await client.readContract({ address: factory, abi: pledgeV4LiquidityFactoryAbi, functionName: "poolIdFor", args: [tokenA, tokenB] }) as Hex;
  const vault = await client.readContract({ address: factory, abi: pledgeV4LiquidityFactoryAbi, functionName: "vaultForPoolId", args: [poolId] }) as Address;
  const [token0, token1] = sortAddresses(tokenA, tokenB);
  if (isZeroAddress(vault)) {
    return { address: ZERO_ADDRESS, exists: false, token0, token1, totalSupply: 0n, poolId };
  }
  const [vaultState, v4State] = await Promise.all([
    readProtocolLiquidityVaultState(client, vault),
    readUniswapV4PoolState(client, { stateView: requireDeploymentAddress(deployment?.uniswapV4StateView, "Uniswap v4 StateView"), poolId }),
  ]);
  if (!samePair(vaultState.currency0, vaultState.currency1, tokenA, tokenB) || vaultState.poolId.toLowerCase() !== poolId.toLowerCase()) {
    throw new Error("The v4 factory and vault disagree on canonical pool identity.");
  }
  return {
    address: vault,
    exists: true,
    token0: vaultState.currency0,
    token1: vaultState.currency1,
    totalSupply: vaultState.totalSupply,
    poolId,
    positionLiquidity: vaultState.positionLiquidity,
    sqrtPriceX96: v4State.sqrtPriceX96,
    liquidityState: vaultState.liquidityState,
    fee: vaultState.poolFee,
    tickSpacing: vaultState.tickSpacing,
    hooks: vaultState.hook,
    tickLower: vaultState.tickLower,
    tickUpper: vaultState.tickUpper,
  };
}

async function readPoolSummary(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  vault: Address,
): Promise<SwapPoolSummary> {
  const stateView = requireDeploymentAddress(deployment?.uniswapV4StateView, "Uniswap v4 StateView");
  const vaultState = await readProtocolLiquidityVaultState(client, vault);
  const poolState = await readUniswapV4PoolState(client, { stateView, poolId: vaultState.poolId });
  return {
    address: vault,
    token0: vaultState.currency0,
    token1: vaultState.currency1,
    poolId: vaultState.poolId,
    fee: vaultState.poolFee,
    tickSpacing: vaultState.tickSpacing,
    hooks: vaultState.hook,
    liquidity: poolState.liquidity,
    sqrtPriceX96: poolState.sqrtPriceX96,
  };
}

async function readTokenMetadata(
  client: PledgeCashReadClient,
  address: Address,
  account?: Address,
  approval?: { spender: Address } | { permit2: Address; router: Address },
): Promise<SwapTokenMetadata> {
  const token: SwapTokenMetadata = { address };
  const reads = await Promise.allSettled([
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    account ? client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [account] }) : Promise.resolve(undefined),
  ]);
  if (reads[0].status === "fulfilled") token.symbol = reads[0].value as string;
  if (reads[1].status === "fulfilled") token.decimals = Number(reads[1].value);
  if (reads[2].status === "fulfilled" && reads[2].value !== undefined) token.balance = reads[2].value as bigint;
  const firstFailure = reads.find((result) => result.status === "rejected");
  if (firstFailure?.status === "rejected") token.error = errorMessage(firstFailure.reason);

  if (account && approval && "spender" in approval) {
    try {
      token.allowance = await client.readContract({ address, abi: erc20Abi, functionName: "allowance", args: [account, approval.spender] }) as bigint;
    } catch (error) {
      token.error ??= errorMessage(error);
    }
  }
  if (account && approval && "permit2" in approval) {
    try {
      const [erc20Allowance, permit2Allowance] = await Promise.all([
        client.readContract({ address, abi: erc20Abi, functionName: "allowance", args: [account, approval.permit2] }) as Promise<bigint>,
        readPermit2Allowance(client, { permit2: approval.permit2, owner: account, token: address, spender: approval.router }),
      ]);
      token.erc20Allowance = erc20Allowance;
      token.permit2Allowance = permit2Allowance.amount;
      token.permit2Expiration = permit2Allowance.expiration;
      const permit2Active = permit2Allowance.expiration > Math.floor(Date.now() / 1000);
      token.allowance = permit2Active ? minBigInt(erc20Allowance, permit2Allowance.amount) : 0n;
    } catch (error) {
      token.error ??= errorMessage(error);
    }
  }
  return token;
}

function estimateP4LpDeposit(
  pool: LiquidityPoolState,
  tokenA: Address,
  amountA: bigint,
  amountB: bigint,
): { amountA: bigint; amountB: bigint; liquidity: bigint } {
  const sqrtPrice = requireBigInt(pool.sqrtPriceX96, "v4 sqrt price");
  const sqrtLower = sqrtPriceAtTick(requireNumber(pool.tickLower, "vault lower tick"));
  const sqrtUpper = sqrtPriceAtTick(requireNumber(pool.tickUpper, "vault upper tick"));
  const tokenAIs0 = sameAddress(tokenA, pool.token0);
  const amount0 = tokenAIs0 ? amountA : amountB;
  const amount1 = tokenAIs0 ? amountB : amountA;
  const liquidity = liquidityForAmounts(sqrtPrice, sqrtLower, sqrtUpper, amount0, amount1);
  const [used0, used1] = positionAmountsAtPrice(sqrtPrice, sqrtLower, sqrtUpper, liquidity, true);
  return { amountA: tokenAIs0 ? used0 : used1, amountB: tokenAIs0 ? used1 : used0, liquidity };
}

function positionAmounts(pool: LiquidityPoolState, liquidity: bigint, roundUp: boolean): readonly [bigint, bigint] {
  const sqrtPrice = requireBigInt(pool.sqrtPriceX96, "v4 sqrt price");
  return positionAmountsAtPrice(
    sqrtPrice,
    sqrtPriceAtTick(requireNumber(pool.tickLower, "vault lower tick")),
    sqrtPriceAtTick(requireNumber(pool.tickUpper, "vault upper tick")),
    liquidity,
    roundUp,
  );
}

function liquidityForAmounts(sqrtPrice: bigint, sqrtLower: bigint, sqrtUpper: bigint, amount0: bigint, amount1: bigint): bigint {
  if (sqrtPrice <= sqrtLower) return (amount0 * ((sqrtLower * sqrtUpper) / Q96)) / (sqrtUpper - sqrtLower);
  if (sqrtPrice >= sqrtUpper) return (amount1 * Q96) / (sqrtUpper - sqrtLower);
  const liquidity0 = (amount0 * ((sqrtPrice * sqrtUpper) / Q96)) / (sqrtUpper - sqrtPrice);
  const liquidity1 = (amount1 * Q96) / (sqrtPrice - sqrtLower);
  return minBigInt(liquidity0, liquidity1);
}

function positionAmountsAtPrice(
  sqrtPrice: bigint,
  sqrtLower: bigint,
  sqrtUpper: bigint,
  liquidity: bigint,
  roundUp: boolean,
): readonly [bigint, bigint] {
  if (sqrtPrice <= sqrtLower) return [amount0Delta(sqrtLower, sqrtUpper, liquidity, roundUp), 0n];
  if (sqrtPrice >= sqrtUpper) return [0n, amount1Delta(sqrtLower, sqrtUpper, liquidity, roundUp)];
  return [amount0Delta(sqrtPrice, sqrtUpper, liquidity, roundUp), amount1Delta(sqrtLower, sqrtPrice, liquidity, roundUp)];
}

function amount0Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint {
  const numerator = (liquidity << 96n) * (sqrtB - sqrtA);
  const denominator = sqrtB * sqrtA;
  return roundUp ? divRoundingUp(numerator, denominator) : numerator / denominator;
}

function amount1Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint {
  const numerator = liquidity * (sqrtB - sqrtA);
  return roundUp ? divRoundingUp(numerator, Q96) : numerator / Q96;
}

function sqrtPriceAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < -887_272 || tick > 887_272) throw new Error("Tick is outside Uniswap v4 bounds.");
  let absTick = BigInt(Math.abs(tick));
  let price = (absTick & 1n) === 0n
    ? 0x100000000000000000000000000000000n
    : 0xfffcb933bd6fad37aa2d162d1a594001n;
  const factors = [
    0xfff97272373d413259a46990580e213an, 0xfff2e50f5f656932ef12357cf3c7fdccn,
    0xffe5caca7e10e4e61c3624eaa0941cd0n, 0xffcb9843d60f6159c9db58835c926644n,
    0xff973b41fa98c081472e6896dfb254c0n, 0xff2ea16466c96a3843ec78b326b52861n,
    0xfe5dee046a99a2a811c461f1969c3053n, 0xfcbe86c7900a88aedcffc83b479aa3a4n,
    0xf987a7253ac413176f2b074cf7815e54n, 0xf3392b0822b70005940c7a398e4b70f3n,
    0xe7159475a2c29b7443b29c7fa6e889d9n, 0xd097f3bdfd2022b8845ad8f792aa5825n,
    0xa9f746462d870fdf8a65dc1f90e061e5n, 0x70d869a156d2a1b890bb3df62baf32f7n,
    0x31be135f97d08fd981231505542fcfa6n, 0x9aa508b5b7a84e1c677de54f3e99bc9n,
    0x5d6af8dedb81196699c329225ee604n, 0x2216e584f5fa1ea926041bedfe98n,
    0x48a170391f7dc42444e8fa2n,
  ];
  for (let index = 0; index < factors.length; index += 1) {
    if ((absTick & (2n << BigInt(index))) !== 0n) price = (price * factors[index]!) >> 128n;
  }
  if (tick > 0) price = ((1n << 256n) - 1n) / price;
  return (price + ((1n << 32n) - 1n)) >> 32n;
}

function poolKeyFromPool(pool: SwapPoolState): UniswapV4PoolKey {
  return { currency0: pool.token0, currency1: pool.token1, fee: pool.fee, tickSpacing: pool.tickSpacing, hooks: pool.hooks };
}

function baseQuote(
  requestIdentity: string,
  tokenIn: SwapTokenMetadata,
  tokenOut: SwapTokenMetadata,
  slippageBps: number,
  error: string,
  amountIn?: bigint,
): SwapQuoteState {
  return { requestIdentity, tokenIn, tokenOut, slippageBps, error, ...(amountIn === undefined ? {} : { amountIn }) };
}

function baseLiquidityQuote(
  tokenA: SwapTokenMetadata,
  tokenB: SwapTokenMetadata,
  pool: LiquidityPoolState,
  slippageBps: number,
  error: string,
): LiquidityQuoteState {
  return { tokenA, tokenB, pool, slippageBps, error };
}

function unavailableSwapExecutionMetrics(reason: string): Pick<SwapQuoteState, "effectiveExecutionPrice" | "feeInclusivePriceImpact"> {
  return { effectiveExecutionPrice: unavailableMetric(reason), feeInclusivePriceImpact: unavailableMetric(reason) };
}

function requireExecutableQuote(quote: SwapQuoteState): ExecutableSwapQuote {
  if (!swapQuoteReady(quote)) throw new Error(quote.error ?? "Refresh the v4 swap quote before submitting.");
  return quote;
}

function requireExecutableLiquidityQuote(quote: LiquidityQuoteState): ExecutableLiquidityQuote {
  if (!liquidityQuoteReady(quote)) throw new Error(quote.error ?? "Refresh the P4LP deposit quote before submitting.");
  return quote;
}

function requireExecutableRemoveLiquidityQuote(quote: RemoveLiquidityQuoteState): ExecutableRemoveLiquidityQuote {
  if (!removeLiquidityQuoteReady(quote)) throw new Error(quote.error ?? "Refresh the P4LP redemption quote before submitting.");
  return quote;
}

function preferredPoolPair(tokenList: SwapTokenListState, deployment: PledgeCashDeployment | undefined): { tokenIn: Address; tokenOut: Address } | undefined {
  const wrappedNative = deployment?.wrappedNative;
  const preferred = wrappedNative
    ? tokenList.pools.find((pool) => sameAddress(pool.token0, wrappedNative) || sameAddress(pool.token1, wrappedNative)) ?? tokenList.pools[0]
    : tokenList.pools[0];
  if (!preferred) return undefined;
  if (wrappedNative && sameAddress(preferred.token1, wrappedNative)) return { tokenIn: preferred.token1, tokenOut: preferred.token0 };
  return { tokenIn: preferred.token0, tokenOut: preferred.token1 };
}

function defaultTokenOut(current: string, tokenIn: string, fallback: Address): string {
  const output = current || fallback;
  return output && sameAddress(output, tokenIn) ? (sameAddress(fallback, tokenIn) ? "" : fallback) : output;
}

function addTokenAccumulator(
  tokens: Map<string, TokenAccumulator>,
  address: Address | undefined,
  input: { label?: string; source: SwapTokenSource; rank: number; pool?: Address; pair?: Address },
): void {
  if (!address || isZeroAddress(address)) return;
  const key = address.toLowerCase();
  const entry = tokens.get(key) ?? { address, rank: input.rank, sources: new Set(), pools: new Set(), pairAddresses: new Set() };
  entry.rank = Math.min(entry.rank, input.rank);
  entry.sources.add(input.source);
  if (input.label) entry.label = input.label;
  if (input.pool) entry.pools.add(input.pool);
  if (input.pair) entry.pairAddresses.add(input.pair);
  tokens.set(key, entry);
}

function addPoolTokens(tokens: Map<string, TokenAccumulator>, pools: readonly SwapPoolSummary[]): void {
  pools.forEach((pool, index) => {
    addTokenAccumulator(tokens, pool.token0, { source: "pool", rank: index + 10, pool: pool.address, pair: pool.token1 });
    addTokenAccumulator(tokens, pool.token1, { source: "pool", rank: index + 10, pool: pool.address, pair: pool.token0 });
  });
}

async function tokenOptionFromAccumulator(
  client: PledgeCashReadClient,
  entry: TokenAccumulator,
  account?: Address,
): Promise<SwapTokenOption> {
  const metadata = await readTokenMetadata(client, entry.address, account);
  return {
    ...metadata,
    ...(entry.label ? { label: entry.label } : {}),
    sources: [...entry.sources],
    pools: [...entry.pools],
    pairAddresses: [...entry.pairAddresses],
  };
}

function compareTokenOptions(left: SwapTokenOption, right: SwapTokenOption): number {
  const leftLabel = left.symbol ?? left.label ?? left.address;
  const rightLabel = right.symbol ?? right.label ?? right.address;
  return leftLabel.localeCompare(rightLabel);
}

async function mapInBatches<T, U>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
  signal?: AbortSignal,
): Promise<{ fulfilled: U[]; errors: string[] }> {
  const fulfilled: Array<{ value: U } | undefined> = new Array(items.length);
  const errors: Array<string | undefined> = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      throwIfSwapReadAborted(signal);
      const index = cursor++;
      try {
        fulfilled[index] = { value: await mapper(items[index]!) };
      } catch (error) {
        errors[index] = errorMessage(error);
      }
    }
  });
  await Promise.all(workers);
  throwIfSwapReadAborted(signal);
  return {
    fulfilled: fulfilled.flatMap((entry) => entry ? [entry.value] : []),
    errors: errors.filter((entry): entry is string => entry !== undefined),
  };
}

function throwIfSwapReadAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The v4 market read was aborted.", "AbortError");
}

function parseSlippageBps(value: string): number {
  if (!/^\d+$/.test(value.trim())) throw new Error("Slippage must be a whole number of basis points.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed >= FULL_BPS) throw new Error("Slippage must be between 0 and 9,999 basis points.");
  return parsed;
}

function parseSwapDeadline(value: string): bigint {
  if (!/^\d+$/.test(value.trim())) throw new Error("Deadline must be an unsigned Unix timestamp.");
  return BigInt(value);
}

function applySlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(FULL_BPS - slippageBps)) / FULL_BPS_BIGINT;
}

function requireTokenAddress(value: string, label: string): Address {
  if (!isAddress(value.trim())) throw new Error(`${label} must be a valid address.`);
  return value.trim() as Address;
}

function requireDeploymentAddress(value: Address | undefined, label: string): Address {
  if (!value || isZeroAddress(value)) throw new Error(`${label} is unavailable in this deployment.`);
  return value;
}

function requireAddress(value: Address | undefined, label: string): Address {
  if (!value || isZeroAddress(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function requireHex(value: Hex | undefined, label: string): Hex {
  if (!value || value.length !== 66) throw new Error(`${label} is invalid.`);
  return value;
}

function requireNumber(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isSafeInteger(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function requireBigInt(value: bigint | undefined, label: string): bigint {
  if (value === undefined || value <= 0n) throw new Error(`${label} is invalid.`);
  return value;
}

function sortAddresses(first: Address, second: Address): readonly [Address, Address] {
  return first.toLowerCase() < second.toLowerCase() ? [first, second] : [second, first];
}

function samePair(first0: Address, first1: Address, second0: Address, second1: Address): boolean {
  return (sameAddress(first0, second0) && sameAddress(first1, second1)) || (sameAddress(first0, second1) && sameAddress(first1, second0));
}

function sameAddress(first: string | undefined, second: string | undefined): boolean {
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase());
}

function minBigInt(first: bigint, second: bigint): bigint {
  return first < second ? first : second;
}

function divRoundingUp(numerator: bigint, denominator: bigint): bigint {
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

function uniqueAddresses(addresses: readonly Address[]): Address[] {
  return [...new Map(addresses.map((address) => [address.toLowerCase(), address])).values()];
}

function uniquePoolSummaries(pools: readonly SwapPoolSummary[]): SwapPoolSummary[] {
  return [...new Map(pools.map((pool) => [pool.address.toLowerCase(), pool])).values()];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function shortToken(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value || "Token";
}
