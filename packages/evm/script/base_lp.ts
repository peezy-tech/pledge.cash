import {
  type Address,
  getContract,
  formatUnits,
  parseUnits,
  createPublicClient,
  http,
  type PublicClient,
  type WalletClient,
  createTestClient,
  publicActions,
  walletActions,
  getAddress,
  erc20Abi,
} from "viem";

import { base } from "viem/chains";

const COINBASE_HOT_WALLET = "0x20FE51A9229EEf2cF8Ad9E89d91CAb9312cF3b7A";
const deployer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// Type definitions
interface PoolMetadata {
  decimals0: bigint;
  decimals1: bigint;
  reserve0: bigint;
  reserve1: bigint;
  stable: boolean;
  token0: Address;
  token1: Address;
}

interface TokenInfo {
  address: Address;
  decimals: number;
  symbol: string;
  totalSupply: bigint;
}

interface Route {
  from: Address;
  to: Address;
  stable: boolean;
}

// ABI snippets needed for the pool contract
const poolAbi = [
  {
    name: "metadata",
    inputs: [],
    outputs: [
      { name: "dec0", type: "uint256" },
      { name: "dec1", type: "uint256" },
      { name: "r0", type: "uint256" },
      { name: "r1", type: "uint256" },
      { name: "st", type: "bool" },
      { name: "t0", type: "address" },
      { name: "t1", type: "address" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    name: "getAmountOut",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "tokenIn", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    name: "swap",
    inputs: [
      { name: "amount0Out", type: "uint256" },
      { name: "amount1Out", type: "uint256" },
      { name: "to", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

const routerAbi = [
  {
    name: "swapExactTokensForTokens",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      {
        name: "routes",
        type: "tuple[]",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "stable", type: "bool" },
          { name: "factory", type: "address" },
        ],
      },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    name: "getAmountsOut",
    inputs: [
      { name: "amountIn", type: "uint256" },
      {
        name: "routes",
        type: "tuple[]",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "stable", type: "bool" },
          { name: "factory", type: "address" },
        ],
      },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
];

type MetadataArray = [
  decimals0: bigint,
  decimals1: bigint,
  reserve0: bigint,
  reserve1: bigint,
  stable: boolean,
  token0: Address,
  token1: Address,
];

const createMetadata = ([
  decimals0,
  decimals1,
  reserve0,
  reserve1,
  stable,
  token0,
  token1,
]: MetadataArray) => ({
  decimals0,
  decimals1,
  reserve0,
  reserve1,
  stable,
  token0,
  token1,
});

/**
 * Gets pool metadata and calculates the price and market cap for the base token
 * @param poolAddress The address of the AMM pool
 * @param quoteToken The address of the quote token (the token used for pricing)
 * @param publicClient Viem public client instance
 * @returns Object containing price and market cap information
 */
export async function getPoolPriceAndMarketCap(
  poolAddress: Address,
  quoteToken: Address,
  publicClient: PublicClient
): Promise<{
  baseTokenPrice: number;
  marketCap: number;
  baseToken: TokenInfo;
  coinbaseBalance: number;
}> {
  // Get pool contract instance
  const poolContract = getContract({
    address: poolAddress,
    abi: poolAbi,
    client: { public: publicClient },
  });

  // Get pool metadata
  const metadata: PoolMetadata = createMetadata(
    (await poolContract.read.metadata()) as MetadataArray
  );

  // Determine which token is base and which is quote
  const isToken0Quote =
    metadata.token0.toLowerCase() === quoteToken.toLowerCase();
  const baseTokenAddress = isToken0Quote ? metadata.token1 : metadata.token0;
  const baseReserve = isToken0Quote ? metadata.reserve1 : metadata.reserve0;
  const quoteReserve = isToken0Quote ? metadata.reserve0 : metadata.reserve1;
  const baseDecimals =
    (isToken0Quote ? metadata.decimals1 : metadata.decimals0).toString()
      .length - 1;
  const quoteDecimals =
    (isToken0Quote ? metadata.decimals0 : metadata.decimals1).toString()
      .length - 1;

  // Get base token information
  const baseTokenContract = getContract({
    address: baseTokenAddress,
    abi: erc20Abi,
    client: { public: publicClient },
  });

  const symbol = await baseTokenContract.read.symbol();
  const totalSupply = await baseTokenContract.read.totalSupply();

  const baseTokenAmt = formatUnits(baseReserve, Number(baseDecimals));
  const quoteTokenAmt = formatUnits(quoteReserve, Number(quoteDecimals));

  // Calculate price in terms of quote token
  const baseTokenPrice = Number(quoteTokenAmt) / Number(baseTokenAmt);

  // Calculate market cap
  const marketCap =
    baseTokenPrice * Number(formatUnits(totalSupply, Number(baseDecimals)));

  return {
    baseTokenPrice,
    marketCap,
    baseToken: {
      address: baseTokenAddress,
      decimals: Number(baseDecimals),
      symbol,
      totalSupply,
    },
    coinbaseBalance: Number(
      formatUnits(
        await baseTokenContract.read.balanceOf([COINBASE_HOT_WALLET]),
        Number(baseDecimals)
      )
    ),
  };
}

/**
 * Buys a specified amount of base token using the quote token through the router
 * @param routerAddress The address of the router contract
 * @param poolAddress The address of the AMM pool
 * @param quoteToken The address of the quote token
 * @param baseAmount The amount of base token to buy
 * @param factoryAddress The address of the pool factory
 * @param slippageTolerance The maximum slippage allowed (e.g., 0.01 for 1%)
 * @param walletClient Viem wallet client instance
 * @param publicClient Viem public client instance
 */
export async function buyBaseToken(
  routerAddress: Address,
  poolAddress: Address,
  quoteToken: Address,
  baseAmount: string,
  factoryAddress: Address,
  slippageTolerance: number,
  walletClient: WalletClient,
  publicClient: PublicClient
): Promise<void> {
  const poolContract = getContract({
    address: poolAddress,
    abi: poolAbi,
    client: { public: publicClient, wallet: walletClient },
  });

  const routerContract = getContract({
    address: routerAddress,
    abi: routerAbi,
    client: { public: publicClient, wallet: walletClient },
  });

  // Get pool metadata
  const metadata: PoolMetadata = createMetadata(
    (await poolContract.read.metadata()) as MetadataArray
  );

  // Determine which token is base and which is quote
  const isToken0Quote =
    metadata.token0.toLowerCase() === quoteToken.toLowerCase();
  const baseTokenAddress = isToken0Quote ? metadata.token1 : metadata.token0;
  const baseReserve = isToken0Quote ? metadata.reserve1 : metadata.reserve0;
  const quoteReserve = isToken0Quote ? metadata.reserve0 : metadata.reserve1;
  const baseDecimals =
    (isToken0Quote ? metadata.decimals1 : metadata.decimals0).toString()
      .length - 1;
  const quoteDecimals =
    (isToken0Quote ? metadata.decimals0 : metadata.decimals1).toString()
      .length - 1;

  // Create route for the swap
  const route: Route[] = [
    {
      from: quoteToken,
      to: baseTokenAddress,
      stable: metadata.stable,
      factory: factoryAddress,
    },
  ];

  // Parse the desired base amount to the correct decimals
  const baseAmountBigInt = parseUnits(baseAmount, Number(quoteDecimals));

  // Get the required input amount
  const amounts = await routerContract.read.getAmountsOut([
    baseAmountBigInt,
    route,
  ]);
  const amountIn = amounts[0];

  // Calculate minimum output with slippage tolerance
  const amountOutMin =
    (baseAmountBigInt * BigInt(Math.floor((1 - slippageTolerance) * 10000))) /
    10000n;

  // Set deadline to 20 minutes from now
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

  // Get the user's address
  const account = COINBASE_HOT_WALLET;

  // First approve router to spend quote tokens
  const quoteTokenContract = getContract({
    address: quoteToken,
    abi: erc20Abi,
    client: { public: publicClient, wallet: walletClient },
  });

  await quoteTokenContract.write.approve([routerAddress, amountIn]);

  // Execute the swap through the router
  await routerContract.write.swapExactTokensForTokens([
    amountIn,
    0n,
    route,
    account,
    deadline,
  ]);
}

const AERODROME_ROUTER = getAddress(
  "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43"
);

const AERODROME_POOL_FACTORY = getAddress(
  "0x420DD381b31aEf6683db6B902084cB0FFECe40Da"
);
// Example usage:
async function example() {
  const publicClient = createPublicClient({
    chain: base,
    transport: http("http://localhost:" + base.id),
  });

  const client = createTestClient({
    chain: base,
    mode: "anvil",
    transport: http("http://localhost:" + base.id),
    account: COINBASE_HOT_WALLET,
  })
    .extend(publicActions)
    .extend(walletActions);

  const poolAddress = getAddress("0x9c0F3DBD7cdb878787fFaeCcB9b4E8b21a000d97");
  const quoteToken = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"); // USDC
  const NUMBER_OF_REPS = 100;

  for (let i = 0; i < NUMBER_OF_REPS; i++) {
    // Get price and market cap
    const { baseTokenPrice, marketCap, baseToken, coinbaseBalance } =
      await getPoolPriceAndMarketCap(poolAddress, quoteToken, publicClient);

    console.log(`
      iteration ${i}
      Base Token: ${baseToken.symbol}
      Price: ${baseTokenPrice}
      Market Cap: ${marketCap}
      balance: ${coinbaseBalance}
    `);

    const impersonated = await client.impersonateAccount({
      address: COINBASE_HOT_WALLET,
    });

    const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const contract = getContract({
      address: USDC,
      abi: erc20Abi,
      // client: client,
      client: { public: publicClient, wallet: client },
    });

    const coinbase_usdc_balance = await contract.read.balanceOf([
      COINBASE_HOT_WALLET,
    ]);
    // console.log({ coinbase_usdc_balance });

    //   await buyBaseToken(poolAddress, USDC, "1000", client, publicClient);
    await buyBaseToken(
      AERODROME_ROUTER,
      poolAddress,
      USDC,
      "10000",
      AERODROME_POOL_FACTORY,
      1,
      client,
      publicClient
    );
  }

  console.log("------------FINAL---------------");
  // Get price and market cap
  const { baseTokenPrice, marketCap, baseToken, coinbaseBalance } =
    await getPoolPriceAndMarketCap(poolAddress, quoteToken, publicClient);

  console.log(`
  Base Token: ${baseToken.symbol}
  Price: ${baseTokenPrice}
  Market Cap: ${marketCap}
  balance: ${coinbaseBalance}
`);
}

await example();
