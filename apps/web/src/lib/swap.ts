import {
  buildUniswapV4SwapExactInputSingleTransaction,
  discoverLiquidityLockers,
  erc20Abi,
  isZeroAddress,
  liquidityLockerPoolKey,
  readLiquidityLockerState,
  readPermit2Allowance,
  readUniswapV4ExactInputSingleQuote,
  readUniswapV4PoolState,
  type Address,
  type PledgeCashDeployment,
  type PledgeCashLogClient,
  type PledgeCashReadClient,
  type UniswapV4PoolKey,
} from "@pledge.cash/sdk";
import { encodeAbiParameters, isAddress, keccak256, parseAbiParameters, type Hex } from "viem";
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

export type SwapTokenSource = "locker" | "deployment" | "custom";

export type SwapTokenListOptions = {
  discoveryMode?: "global" | "pinned-only" | undefined;
  pinnedLockers?: readonly Address[] | undefined;
  signal?: AbortSignal | undefined;
  wrappedNativeLabel?: string;
};

/** A hookless v4 pool whose canonical launch position is held by a pledge.cash locker. */
export type SwapPoolSummary = {
  address: Address;
  token0: Address;
  token1: Address;
  poolId: Hex;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  liquidity: bigint;
  sqrtPriceX96: bigint;
};

export type SwapPoolState = SwapPoolSummary;

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
  gasEstimate?: bigint;
  effectiveExecutionPrice?: MetricState<NormalizedPrice>;
  feeInclusivePriceImpact?: MetricState<ExactRational>;
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
  lockers: Address[];
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

type TokenAccumulator = {
  address: Address;
  label?: string;
  rank: number;
  sources: Set<SwapTokenSource>;
  lockers: Set<Address>;
  pairAddresses: Set<Address>;
};

type SwapReadClient = PledgeCashReadClient & Partial<PledgeCashLogClient>;

const DEFAULT_SLIPPAGE_BPS = 50;
const FULL_BPS = 10_000;
const FULL_BPS_BIGINT = 10_000n;
const V4_FEE_DENOMINATOR = 1_000_000n;
const Q192 = 1n << 192n;
const MAX_DISCOVERED_POOLS = 500;
const MAX_PINNED_LOCKERS = 64;
const SWAP_DISCOVERY_CONCURRENCY = 8;
const POOL_KEY_PARAMETERS = parseAbiParameters(
  "address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks",
);

export function swapQuoteRequestIdentity(form: SwapForm): string {
  return [
    form.tokenIn.trim().toLowerCase(),
    form.tokenOut.trim().toLowerCase(),
    form.amountIn.trim(),
    form.slippageBps.trim(),
    form.deadline.trim(),
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
    const factory = deployment?.liquidityLockerFactory;
    if (!factory) {
      errors.push("The pledge.cash liquidity locker factory is not configured.");
    } else if (typeof client.getLogs !== "function") {
      errors.push("This client cannot discover liquidity lockers.");
    } else {
      const discovery = await discoverLiquidityLockers(client as PledgeCashLogClient, {
        factory,
        fromBlock: deployment.deploymentBlock ?? 0n,
        chunkSize: 100_000n,
      });
      const discovered = discovery.items.slice(0, MAX_DISCOVERED_POOLS);
      const hydrated = await mapInBatches(
        discovered,
        SWAP_DISCOVERY_CONCURRENCY,
        async (item) => await readPoolSummary(client, deployment, item.locker),
        options.signal,
      );
      pools.push(...hydrated.fulfilled);
      errors.push(...discovery.errors.map((entry) => entry.message), ...hydrated.errors);
      if (discovery.items.length > discovered.length) {
        errors.push(`Only the newest ${MAX_DISCOVERED_POOLS.toString()} locked pools are shown.`);
      }
    }
  }

  const pinned = uniqueAddresses(options.pinnedLockers ?? []);
  const boundedPinned = pinned.slice(-MAX_PINNED_LOCKERS);
  const missing = boundedPinned.filter((locker) => !pools.some((pool) => sameAddress(pool.address, locker)));
  const hydratedPinned = await mapInBatches(
    missing,
    SWAP_DISCOVERY_CONCURRENCY,
    async (locker) => await readPoolSummary(client, deployment, locker),
    options.signal,
  );
  pools = uniquePoolSummaries([...pools, ...hydratedPinned.fulfilled]);
  errors.push(...hydratedPinned.errors);
  if (pinned.length > boundedPinned.length) {
    errors.push(`Only the newest ${MAX_PINNED_LOCKERS.toString()} project lockers can be pinned at once.`);
  }

  addPoolTokens(tokens, pools);
  const tokenResults = await mapInBatches(
    [...tokens.values()].sort((left, right) => left.rank - right.rank),
    SWAP_DISCOVERY_CONCURRENCY,
    async (entry) => await tokenOptionFromAccumulator(client, entry, account),
    options.signal,
  );
  errors.push(...tokenResults.errors);
  return {
    tokens: tokenResults.fulfilled.sort(compareTokenOptions),
    pools,
    loaded: true,
    ...(errors.length > 0 ? { error: uniqueStrings(errors).join(" ") } : {}),
  };
}

export async function readSwapQuote(
  client: SwapReadClient,
  deployment: PledgeCashDeployment | undefined,
  form: SwapForm,
  account?: Address,
): Promise<SwapQuoteState> {
  const requestIdentity = swapQuoteRequestIdentity(form);
  let slippageBps = DEFAULT_SLIPPAGE_BPS;
  try {
    slippageBps = parseSlippageBps(form.slippageBps);
    const router = requireDeploymentAddress(deployment?.uniswapUniversalRouter, "Uniswap Universal Router");
    const quoter = requireDeploymentAddress(deployment?.uniswapV4Quoter, "Uniswap v4 Quoter");
    const permit2 = requireDeploymentAddress(deployment?.permit2, "Permit2");
    const tokenIn = requireTokenAddress(form.tokenIn, "From token");
    const tokenOut = requireTokenAddress(form.tokenOut, "To token");
    if (sameAddress(tokenIn, tokenOut)) throw new Error("Choose two different tokens.");

    const pool = await readCanonicalSwapPool(client, deployment, tokenIn, tokenOut);
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
      gasEstimate: quoted.gasEstimate,
      ...swapQuoteExecutionMetrics({ tokenIn: inputToken, tokenOut: outputToken, pool, amountIn, amountOut }),
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

export function buildSwapTransaction(input: {
  deployment: PledgeCashDeployment | undefined;
  form: SwapForm;
  quote: SwapQuoteState;
  account: Address;
}) {
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

export function formatSwapAmount(amount: bigint | undefined, token: SwapTokenMetadata | undefined): string {
  return formatTokenAmount(amount, token);
}

export function pairHasWrappedNative(
  deployment: PledgeCashDeployment | undefined,
  tokenA: string,
  tokenB: string,
): boolean {
  const wrappedNative = deployment?.wrappedNative;
  return Boolean(wrappedNative && !isZeroAddress(wrappedNative)
    && (sameAddress(tokenA, wrappedNative) || sameAddress(tokenB, wrappedNative)));
}

export function swapPairLabel(quote: SwapQuoteState | undefined, form: SwapForm): string {
  return `${quote?.tokenIn?.symbol ?? shortToken(form.tokenIn)} / ${quote?.tokenOut?.symbol ?? shortToken(form.tokenOut)}`;
}

export function swapQuoteReady(quote: SwapQuoteState | undefined): quote is ExecutableSwapQuote {
  return Boolean(
    quote && !quote.error && quote.tokenIn?.decimals !== undefined && quote.tokenOut?.decimals !== undefined
      && quote.pool && quote.amountIn !== undefined && quote.amountOut !== undefined && quote.amountOutMin !== undefined,
  );
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
  client: SwapReadClient,
  deployment: PledgeCashDeployment | undefined,
  tokenIn: Address,
  tokenOut: Address,
): Promise<SwapPoolState> {
  const factory = requireDeploymentAddress(deployment?.liquidityLockerFactory, "pledge.cash liquidity locker factory");
  if (typeof client.getLogs !== "function") throw new Error("This client cannot discover liquidity lockers.");
  const discovery = await discoverLiquidityLockers(client as PledgeCashLogClient, {
    factory,
    fromBlock: deployment?.deploymentBlock ?? 0n,
    chunkSize: 100_000n,
  });
  const candidates = discovery.items.slice(0, MAX_DISCOVERED_POOLS);
  const hydrated = await mapInBatches(
    candidates,
    SWAP_DISCOVERY_CONCURRENCY,
    async (item) => await readPoolSummary(client, deployment, item.locker),
  );
  const pool = hydrated.fulfilled.find((candidate) => samePair(candidate.token0, candidate.token1, tokenIn, tokenOut));
  if (!pool) throw new Error("No pledge.cash liquidity locker identifies a v4 pool for this pair.");
  return pool;
}

async function readPoolSummary(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  locker: Address,
): Promise<SwapPoolSummary> {
  const state = await readLiquidityLockerState(client, locker);
  const key = liquidityLockerPoolKey(state);
  const poolId = poolIdForKey(key);
  const poolState = await readUniswapV4PoolState(client, {
    stateView: requireDeploymentAddress(deployment?.uniswapV4StateView, "Uniswap v4 StateView"),
    poolId,
  });
  return {
    address: locker,
    token0: key.currency0,
    token1: key.currency1,
    poolId,
    fee: key.fee,
    tickSpacing: key.tickSpacing,
    hooks: key.hooks,
    liquidity: poolState.liquidity,
    sqrtPriceX96: poolState.sqrtPriceX96,
  };
}

export function poolIdForKey(key: UniswapV4PoolKey): Hex {
  return keccak256(encodeAbiParameters(POOL_KEY_PARAMETERS, [
    key.currency0,
    key.currency1,
    key.fee,
    key.tickSpacing,
    key.hooks,
  ]));
}

async function readTokenMetadata(
  client: PledgeCashReadClient,
  address: Address,
  account?: Address,
  approval?: { permit2: Address; router: Address },
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

  if (account && approval) {
    try {
      const [erc20Allowance, permit2Allowance] = await Promise.all([
        client.readContract({ address, abi: erc20Abi, functionName: "allowance", args: [account, approval.permit2] }) as Promise<bigint>,
        readPermit2Allowance(client, { permit2: approval.permit2, owner: account, token: address, spender: approval.router }),
      ]);
      token.erc20Allowance = erc20Allowance;
      token.permit2Allowance = permit2Allowance.amount;
      token.permit2Expiration = permit2Allowance.expiration;
      token.allowance = permit2Allowance.expiration > Math.floor(Date.now() / 1000)
        ? minBigInt(erc20Allowance, permit2Allowance.amount)
        : 0n;
    } catch (error) {
      token.error ??= errorMessage(error);
    }
  }
  return token;
}

function poolKeyFromPool(pool: SwapPoolState): UniswapV4PoolKey {
  return {
    currency0: pool.token0,
    currency1: pool.token1,
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
    hooks: pool.hooks,
  };
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

function unavailableSwapExecutionMetrics(
  reason: string,
): Pick<SwapQuoteState, "effectiveExecutionPrice" | "feeInclusivePriceImpact"> {
  return { effectiveExecutionPrice: unavailableMetric(reason), feeInclusivePriceImpact: unavailableMetric(reason) };
}

function requireExecutableQuote(quote: SwapQuoteState): ExecutableSwapQuote {
  if (!swapQuoteReady(quote)) throw new Error(quote.error ?? "Refresh the v4 swap quote before submitting.");
  return quote;
}

function preferredPoolPair(
  tokenList: SwapTokenListState,
  deployment: PledgeCashDeployment | undefined,
): { tokenIn: Address; tokenOut: Address } | undefined {
  const wrappedNative = deployment?.wrappedNative;
  const preferred = wrappedNative
    ? tokenList.pools.find((pool) => sameAddress(pool.token0, wrappedNative) || sameAddress(pool.token1, wrappedNative))
      ?? tokenList.pools[0]
    : tokenList.pools[0];
  if (!preferred) return undefined;
  if (wrappedNative && sameAddress(preferred.token1, wrappedNative)) {
    return { tokenIn: preferred.token1, tokenOut: preferred.token0 };
  }
  return { tokenIn: preferred.token0, tokenOut: preferred.token1 };
}

function defaultTokenOut(current: string, tokenIn: string, fallback: Address): string {
  const output = current || fallback;
  return output && sameAddress(output, tokenIn) ? (sameAddress(fallback, tokenIn) ? "" : fallback) : output;
}

function addTokenAccumulator(
  tokens: Map<string, TokenAccumulator>,
  address: Address | undefined,
  input: { label?: string; source: SwapTokenSource; rank: number; locker?: Address; pair?: Address },
): void {
  if (!address || isZeroAddress(address)) return;
  const key = address.toLowerCase();
  const entry = tokens.get(key) ?? {
    address,
    rank: input.rank,
    sources: new Set<SwapTokenSource>(),
    lockers: new Set<Address>(),
    pairAddresses: new Set<Address>(),
  };
  entry.rank = Math.min(entry.rank, input.rank);
  entry.sources.add(input.source);
  if (input.label) entry.label = input.label;
  if (input.locker) entry.lockers.add(input.locker);
  if (input.pair) entry.pairAddresses.add(input.pair);
  tokens.set(key, entry);
}

function addPoolTokens(tokens: Map<string, TokenAccumulator>, pools: readonly SwapPoolSummary[]): void {
  pools.forEach((pool, index) => {
    addTokenAccumulator(tokens, pool.token0, { source: "locker", rank: index + 10, locker: pool.address, pair: pool.token1 });
    addTokenAccumulator(tokens, pool.token1, { source: "locker", rank: index + 10, locker: pool.address, pair: pool.token0 });
  });
}

async function tokenOptionFromAccumulator(
  client: PledgeCashReadClient,
  entry: TokenAccumulator,
  account?: Address,
): Promise<SwapTokenOption> {
  return {
    ...await readTokenMetadata(client, entry.address, account),
    ...(entry.label ? { label: entry.label } : {}),
    sources: [...entry.sources],
    lockers: [...entry.lockers],
    pairAddresses: [...entry.pairAddresses],
  };
}

function compareTokenOptions(left: SwapTokenOption, right: SwapTokenOption): number {
  return (left.symbol ?? left.label ?? left.address).localeCompare(right.symbol ?? right.label ?? right.address);
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
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed >= FULL_BPS) {
    throw new Error("Slippage must be between 0 and 9,999 basis points.");
  }
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

function samePair(first0: Address, first1: Address, second0: Address, second1: Address): boolean {
  return (sameAddress(first0, second0) && sameAddress(first1, second1))
    || (sameAddress(first0, second1) && sameAddress(first1, second0));
}

function sameAddress(first: string | undefined, second: string | undefined): boolean {
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase());
}

function minBigInt(first: bigint, second: bigint): bigint {
  return first < second ? first : second;
}

function uniqueAddresses(addresses: readonly Address[]): Address[] {
  return [...new Map(addresses.map((address) => [address.toLowerCase(), address])).values()];
}

function uniquePoolSummaries(pools: readonly SwapPoolSummary[]): SwapPoolSummary[] {
  return [...new Map(pools.map((pool) => [pool.poolId.toLowerCase(), pool])).values()];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function shortToken(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value || "Token";
}
