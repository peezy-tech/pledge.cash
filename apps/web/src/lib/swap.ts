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

export function defaultSwapForm(seed?: ProductBoardroomSeed | undefined): SwapForm {
  return {
    tokenIn: seed?.cashToken ?? "",
    tokenOut: seed?.boardroomShareToken ?? "",
    amountIn: "1",
    slippageBps: "50",
    recipient: "",
    deadline: defaultSwapDeadline(),
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

    return {
      tokenIn: inputToken,
      tokenOut: outputToken,
      pool: {
        address: poolAddress,
        token0,
        token1,
        reserve0,
        reserve1,
        reserveIn: tokenInIsToken0 ? reserve0 : reserve1,
        reserveOut: tokenInIsToken0 ? reserve1 : reserve0,
      },
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

  return {
    address: router,
    abi: ammRouterAbi,
    functionName: "swapExactTokensForTokens",
    args: [quote.amountIn, quote.amountOutMin, [quote.tokenIn.address, quote.tokenOut.address] as const, recipient, deadline] as const,
  };
}

export function formatSwapAmount(amount: bigint | undefined, token: SwapTokenMetadata | undefined): string {
  return formatTokenAmount(amount, token);
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

function requireDeploymentAddress(address: Address | undefined, label: string): Address {
  if (!address || isZeroAddress(address)) throw new Error(`${label} is not configured for this chain.`);
  return address;
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

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
