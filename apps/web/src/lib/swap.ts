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
import type { ProductBoardroomSeed } from "./product-boardroom";
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

export type SwapTokenSource = "pool" | "seed" | "custom";

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

const AMM_MINIMUM_LIQUIDITY = 1_000n;
const FEE_INDEX_SCALE = 1_000_000_000_000_000_000n;

export function defaultSwapForm(seed?: ProductBoardroomSeed | undefined): SwapForm {
  return {
    tokenIn: seed?.cashToken ?? "",
    tokenOut: seed?.boardroomShareToken ?? "",
    amountIn: "1",
    slippageBps: "50",
    recipient: "",
    deadline: defaultSwapDeadline(),
    useNative: false,
  };
}

export function defaultLiquidityForm(seed?: ProductBoardroomSeed | undefined, deployment?: PledgeCashDeployment | undefined): LiquidityForm {
  const tokenA = deployment?.wrappedNative && !isZeroAddress(deployment.wrappedNative) ? deployment.wrappedNative : seed?.cashToken ?? "";
  const tokenB = tokenA && seed?.cashToken && !sameAddress(tokenA, seed.cashToken) ? seed.cashToken : seed?.boardroomShareToken ?? "";
  return {
    tokenA,
    tokenB,
    amountA: "1",
    amountB: "1",
    slippageBps: "50",
    recipient: "",
    deadline: defaultSwapDeadline(),
    useNative: false,
  };
}

export function defaultRemoveLiquidityForm(): RemoveLiquidityForm {
  return {
    liquidity: "",
    slippageBps: "50",
    recipient: "",
    deadline: defaultSwapDeadline(),
    useNative: false,
  };
}

export function withSwapSeedDefaults(form: SwapForm, seed: ProductBoardroomSeed | undefined, deployment?: PledgeCashDeployment | undefined): SwapForm {
  const preferredInput = deployment?.wrappedNative && !isZeroAddress(deployment.wrappedNative) ? deployment.wrappedNative : seed?.cashToken;
  const preferredOutput = preferredInput && seed?.cashToken && !sameAddress(preferredInput, seed.cashToken) ? seed.cashToken : seed?.boardroomShareToken;
  if (!seed && !preferredInput && !preferredOutput) return form;

  const tokenIn = form.tokenIn || preferredInput || "";
  let tokenOut = form.tokenOut || preferredOutput || "";
  if (tokenIn && tokenOut && sameAddress(tokenIn, tokenOut)) {
    tokenOut = seed?.boardroomShareToken && !sameAddress(tokenIn, seed.boardroomShareToken) ? seed.boardroomShareToken : "";
  }

  return {
    ...form,
    tokenIn,
    tokenOut,
    useNative: form.useNative && pairHasWrappedNative(deployment, tokenIn, tokenOut),
  };
}

export function withLiquiditySeedDefaults(form: LiquidityForm, seed: ProductBoardroomSeed | undefined, deployment?: PledgeCashDeployment | undefined): LiquidityForm {
  const defaults = defaultLiquidityForm(seed, deployment);
  const tokenA = form.tokenA || defaults.tokenA;
  let tokenB = form.tokenB || defaults.tokenB;
  if (tokenA && tokenB && sameAddress(tokenA, tokenB)) {
    tokenB = seed?.boardroomShareToken && !sameAddress(tokenA, seed.boardroomShareToken) ? seed.boardroomShareToken : "";
  }

  return {
    ...form,
    tokenA,
    tokenB,
    useNative: form.useNative && pairHasWrappedNative(deployment, tokenA, tokenB),
  };
}

export async function readSwapTokenList(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  seed: ProductBoardroomSeed | undefined,
  account?: Address | undefined,
): Promise<SwapTokenListState> {
  const tokens = new Map<string, TokenAccumulator>();
  addTokenAccumulator(tokens, deployment?.wrappedNative, { label: "WHYPE", source: "seed", rank: 0 });
  addTokenAccumulator(tokens, seed?.cashToken, { label: "USDC / cash", source: "seed", rank: 1 });
  addTokenAccumulator(tokens, seed?.boardroomShareToken, { label: "Boardroom shares", source: "seed", rank: 2 });
  addTokenAccumulator(tokens, seed?.equityToken, { label: "Equity token", source: "seed", rank: 3 });

  let pools: SwapPoolSummary[] = [];
  let listError: string | undefined;

  try {
    const factory = requireDeploymentAddress(deployment?.ammFactory, "AMM factory");
    const poolCount = await readPoolCount(client, factory);
    const cappedPoolCount = Math.min(poolCount, 500);
    const poolAddresses = await Promise.all(
      Array.from({ length: cappedPoolCount }, (_, index) =>
        client.readContract({ address: factory, abi: ammFactoryAbi, functionName: "allPools", args: [BigInt(index)] }) as Promise<Address>,
      ),
    );
    pools = await Promise.all(poolAddresses.map(async (address) => await readPoolSummary(client, address)));
    if (poolCount > cappedPoolCount) {
      listError = `Showing the first ${cappedPoolCount.toString()} pools. Narrow by token address for anything older.`;
    }
  } catch (error) {
    listError = errorMessage(error);
  }

  for (const pool of pools) {
    addTokenAccumulator(tokens, pool.token0, { source: "pool", pool: pool.address, pair: pool.token1, rank: 20 });
    addTokenAccumulator(tokens, pool.token1, { source: "pool", pool: pool.address, pair: pool.token0, rank: 20 });
  }

  const rankedTokens = Array.from(tokens.values()).sort((left, right) => left.rank - right.rank);
  const options = await Promise.all(rankedTokens.map(async (token) => await tokenOptionFromAccumulator(client, token, account)));
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
  const slippageBps = parseSlippageBpsSafe(form.slippageBps);

  try {
    const factory = requireDeploymentAddress(deployment?.ammFactory, "AMM factory");
    const router = requireDeploymentAddress(deployment?.ammRouter, "AMM router");
    const tokenIn = requireTokenAddress(form.tokenIn, "From token");
    const tokenOut = requireTokenAddress(form.tokenOut, "To token");
    if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
      throw new Error("Choose two different tokens.");
    }

    const [inputToken, outputToken, poolAddress, feeBps, feeDenominator, protocolFeeShareBps] = await Promise.all([
      readTokenMetadata(client, tokenIn, account, router),
      readTokenMetadata(client, tokenOut, account),
      client.readContract({ address: factory, abi: ammFactoryAbi, functionName: "getPool", args: [tokenIn, tokenOut] }) as Promise<Address>,
      client.readContract({ address: factory, abi: ammFactoryAbi, functionName: "SWAP_FEE_BPS" }) as Promise<bigint>,
      client.readContract({ address: factory, abi: ammFactoryAbi, functionName: "FEE_DENOMINATOR" }) as Promise<bigint>,
      client.readContract({ address: factory, abi: ammFactoryAbi, functionName: "PROTOCOL_FEE_SHARE_BPS" }) as Promise<bigint>,
    ]);

    if (inputToken.decimals === undefined) {
      return baseQuote({ inputToken, outputToken, slippageBps, feeBps, feeDenominator, protocolFeeShareBps, error: "From token decimals could not be read." });
    }
    if (outputToken.decimals === undefined) {
      return baseQuote({ inputToken, outputToken, slippageBps, feeBps, feeDenominator, protocolFeeShareBps, error: "To token decimals could not be read." });
    }

    const amountIn = parseTokenAmountInput(form.amountIn, inputToken, "Input amount");
    if (amountIn === 0n) {
      return baseQuote({ inputToken, outputToken, amountIn, slippageBps, feeBps, feeDenominator, protocolFeeShareBps, error: "Enter a positive input amount." });
    }

    if (isZeroAddress(poolAddress)) {
      return baseQuote({
        inputToken,
        outputToken,
        amountIn,
        slippageBps,
        feeBps,
        feeDenominator,
        protocolFeeShareBps,
        error: "No AMM pool exists for this pair yet.",
      });
    }

    const path = [tokenIn, tokenOut] as const;
    const [token0, token1, reserves, amounts] = await Promise.all([
      client.readContract({ address: poolAddress, abi: ammPoolAbi, functionName: "token0" }) as Promise<Address>,
      client.readContract({ address: poolAddress, abi: ammPoolAbi, functionName: "token1" }) as Promise<Address>,
      client.readContract({ address: poolAddress, abi: ammPoolAbi, functionName: "getReserves" }) as Promise<readonly [bigint, bigint, number]>,
      client.readContract({ address: router, abi: ammRouterAbi, functionName: "getAmountsOut", args: [amountIn, path] }) as Promise<readonly bigint[]>,
    ]);
    const amountOut = amounts[1] ?? 0n;
    const amountOutMin = applySlippage(amountOut, slippageBps);
    const [reserve0, reserve1] = reserves;
    const tokenInIsToken0 = token0.toLowerCase() === tokenIn.toLowerCase();
    const pool = {
      address: poolAddress,
      token0,
      token1,
      reserve0,
      reserve1,
      reserveIn: tokenInIsToken0 ? reserve0 : reserve1,
      reserveOut: tokenInIsToken0 ? reserve1 : reserve0,
    };

    if (amountOut === 0n) {
      return {
        tokenIn: inputToken,
        tokenOut: outputToken,
        pool,
        amountIn,
        amountOut,
        amountOutMin,
        slippageBps,
        feeBps,
        feeDenominator,
        protocolFeeShareBps,
        error: "Swap output would be zero.",
      };
    }

    return {
      tokenIn: inputToken,
      tokenOut: outputToken,
      pool,
      amountIn,
      amountOut,
      amountOutMin,
      slippageBps,
      feeBps,
      feeDenominator,
      protocolFeeShareBps,
    };
  } catch (error) {
    return { slippageBps, error: errorMessage(error) };
  }
}

export async function readLiquidityQuote(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  form: LiquidityForm,
  account?: Address | undefined,
): Promise<LiquidityQuoteState> {
  const slippageBps = parseSlippageBpsSafe(form.slippageBps);

  try {
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
      poolShareBps: pool.totalSupply === 0n ? 0n : (lpBalance * 10_000n) / pool.totalSupply,
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
  const slippageBps = parseSlippageBpsSafe(removeForm.slippageBps);

  try {
    const position = await readAmmPosition(client, deployment, pairForm.tokenA, pairForm.tokenB, account);
    if (!position) return { slippageBps, error: "No AMM pool exists for this pair yet." };
    if (!position.pool || !position.pool.exists || !position.lpToken) return { position, slippageBps, error: "No AMM pool exists for this pair yet." };
    if (position.lpToken.decimals === undefined) return { position, slippageBps, error: "LP token decimals could not be read." };

    const liquidity = parseTokenAmountInput(removeForm.liquidity, position.lpToken, "LP amount");
    if (liquidity === 0n) return { position, liquidity, slippageBps, error: "Enter a positive LP amount." };
    if (position.lpBalance !== undefined && liquidity > position.lpBalance) return { position, liquidity, slippageBps, error: "LP amount exceeds your balance." };
    if (position.pool.totalSupply === 0n) return { position, liquidity, slippageBps, error: "Pool supply is zero." };

    const amountA = (liquidity * position.pool.reserveA) / position.pool.totalSupply;
    const amountB = (liquidity * position.pool.reserveB) / position.pool.totalSupply;
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
      quote.tokenIn?.decimals !== undefined &&
      quote.tokenOut?.decimals !== undefined &&
      quote.pool &&
      quote.amountIn !== undefined &&
      quote.amountOut !== undefined &&
      quote.amountOutMin !== undefined,
  );
}

export function defaultSwapDeadline(): string {
  return String(Math.floor(Date.now() / 1000) + 1200);
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
      quote.tokenA?.decimals !== undefined &&
      quote.tokenB?.decimals !== undefined &&
      quote.pool &&
      quote.amountA !== undefined &&
      quote.amountB !== undefined &&
      quote.amountAMin !== undefined &&
      quote.amountBMin !== undefined &&
      quote.liquidityOut !== undefined,
  );
}

export function removeLiquidityQuoteReady(quote: RemoveLiquidityQuoteState | undefined): quote is ExecutableRemoveLiquidityQuote {
  return Boolean(
    quote &&
      !quote.error &&
      quote.position?.tokenA.decimals !== undefined &&
      quote.position.tokenB.decimals !== undefined &&
      quote.position.pool &&
      quote.position.lpToken?.decimals !== undefined &&
      quote.position.lpBalance !== undefined &&
      quote.liquidity !== undefined &&
      quote.amountA !== undefined &&
      quote.amountB !== undefined &&
      quote.amountAMin !== undefined &&
      quote.amountBMin !== undefined,
  );
}

function baseQuote(input: {
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

async function readLiquidityPool(client: PledgeCashReadClient, factory: Address, tokenA: Address, tokenB: Address): Promise<LiquidityPoolState> {
  const poolAddress = await client.readContract({ address: factory, abi: ammFactoryAbi, functionName: "getPool", args: [tokenA, tokenB] }) as Address;
  if (isZeroAddress(poolAddress)) {
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

function parseSlippageBpsSafe(value: string): number {
  try {
    return parseSlippageBps(value);
  } catch {
    return 50;
  }
}

function parseSlippageBps(value: string): number {
  const trimmed = value.trim() || "0";
  if (!/^\d+$/.test(trimmed)) throw new Error("Slippage must be whole basis points.");
  const bps = Number(trimmed);
  if (!Number.isSafeInteger(bps) || bps < 0 || bps >= 10_000) throw new Error("Slippage must be between 0 and 9999 bps.");
  return bps;
}

function applySlippage(amount: bigint, bps: number): bigint {
  return (amount * BigInt(10_000 - bps)) / 10_000n;
}

function optimalLiquidityAmounts(pool: LiquidityPoolState, amountADesired: bigint, amountBDesired: bigint): readonly [bigint, bigint] {
  if (pool.reserveA === 0n && pool.reserveB === 0n) return [amountADesired, amountBDesired];

  const amountBOptimal = quoteAmount(amountADesired, pool.reserveA, pool.reserveB);
  if (amountBOptimal <= amountBDesired) return [amountADesired, amountBOptimal];
  return [quoteAmount(amountBDesired, pool.reserveB, pool.reserveA), amountBDesired];
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
  if (!/^\d+$/.test(trimmed)) throw new Error("Deadline must be a Unix timestamp.");
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

async function readPoolSummary(client: PledgeCashReadClient, address: Address): Promise<SwapPoolSummary> {
  const [token0, token1, reserves] = await Promise.all([
    client.readContract({ address, abi: ammPoolAbi, functionName: "token0" }) as Promise<Address>,
    client.readContract({ address, abi: ammPoolAbi, functionName: "token1" }) as Promise<Address>,
    client.readContract({ address, abi: ammPoolAbi, functionName: "getReserves" }) as Promise<readonly [bigint, bigint, number]>,
  ]);
  const [reserve0, reserve1] = reserves;
  return { address, token0, token1, reserve0, reserve1 };
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
  if (token.label === "WHYPE") return 0;
  if (token.label === "USDC / cash") return 1;
  if (token.sources.includes("seed")) return 5;
  return 20;
}

function tokenName(token: SwapTokenOption): string {
  return token.symbol || token.label || token.address;
}

function sortTokenAddresses(tokenA: Address, tokenB: Address): readonly [Address, Address] {
  return BigInt(tokenA) < BigInt(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA];
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
