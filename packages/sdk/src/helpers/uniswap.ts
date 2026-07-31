import { parseAbi, type Address, type Hex } from "viem";
import type { PledgeCashReadClient, UniswapV4PoolKey } from "./types";

export const uniswapV4QuoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) view returns (uint256 amountOut,uint256 gasEstimate)",
]);

export const uniswapV4StateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

export const permit2AllowanceAbi = parseAbi([
  "function allowance(address user,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
]);

export type UniswapV4PoolState = {
  poolId: Hex;
  sqrtPriceX96: bigint;
  tick: number;
  protocolFee: number;
  lpFee: number;
  liquidity: bigint;
};

export type Permit2Allowance = {
  amount: bigint;
  expiration: number;
  nonce: number;
};

export async function readUniswapV4PoolState(
  client: PledgeCashReadClient,
  input: { stateView: Address; poolId: Hex },
): Promise<UniswapV4PoolState> {
  const [slot0, liquidity] = await Promise.all([
    client.readContract({
      address: input.stateView,
      abi: uniswapV4StateViewAbi,
      functionName: "getSlot0",
      args: [input.poolId],
    }),
    client.readContract({
      address: input.stateView,
      abi: uniswapV4StateViewAbi,
      functionName: "getLiquidity",
      args: [input.poolId],
    }),
  ]);
  return {
    poolId: input.poolId,
    sqrtPriceX96: slot0[0],
    tick: slot0[1],
    protocolFee: slot0[2],
    lpFee: slot0[3],
    liquidity,
  };
}

export async function readUniswapV4ExactInputSingleQuote(
  client: PledgeCashReadClient,
  input: {
    quoter: Address;
    poolKey: UniswapV4PoolKey;
    currencyIn: Address;
    amountIn: bigint;
    hookData?: Hex;
  },
): Promise<{ amountOut: bigint; gasEstimate: bigint }> {
  if (input.amountIn <= 0n || input.amountIn >= 1n << 128n) {
    throw new Error("Uniswap v4 exact input must fit a positive uint128.");
  }
  const currency0 = input.poolKey.currency0.toLowerCase();
  const currency1 = input.poolKey.currency1.toLowerCase();
  if (currency0 >= currency1) throw new Error("Uniswap v4 PoolKey currencies must be sorted.");
  const currencyIn = input.currencyIn.toLowerCase();
  if (currencyIn !== currency0 && currencyIn !== currency1) {
    throw new Error("Input currency is not part of the Uniswap v4 PoolKey.");
  }
  const result = await client.readContract({
    address: input.quoter,
    abi: uniswapV4QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{
      poolKey: input.poolKey,
      zeroForOne: currencyIn === currency0,
      exactAmount: input.amountIn,
      hookData: input.hookData ?? "0x",
    }],
  });
  return { amountOut: result[0], gasEstimate: result[1] };
}

export async function readPermit2Allowance(
  client: PledgeCashReadClient,
  input: { permit2: Address; owner: Address; token: Address; spender: Address },
): Promise<Permit2Allowance> {
  const result = await client.readContract({
    address: input.permit2,
    abi: permit2AllowanceAbi,
    functionName: "allowance",
    args: [input.owner, input.token, input.spender],
  });
  return { amount: result[0], expiration: result[1], nonce: result[2] };
}
