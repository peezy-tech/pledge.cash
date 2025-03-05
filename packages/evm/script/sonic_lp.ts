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

import { sonic } from "viem/chains";

const COINBASE_HOT_WALLET = "0x51ba05662A3b00731d451014540049B08a4e9ea5";
const deployer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// Contract addresses
const SHADOW_ROUTER = getAddress("0x1D368773735ee1E678950B7A97bcA2CafB330CDc");
const SONIC_USDC = getAddress("0x29219dd400f2Bf60E5a23d13Be72B486D4038894");
const WRAPPED_SONIC = getAddress("0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38");

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

// Shadow Router ABI
const SHADOW_ROUTER_ABI = [
  {
    inputs: [
      { internalType: "address", name: "_factory", type: "address" },
      { internalType: "address", name: "_weth", type: "address" },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  { inputs: [], name: "ETH_TRANSFER_FAILED", type: "error" },
  { inputs: [], name: "EXCESSIVE_INPUT_AMOUNT", type: "error" },
  { inputs: [], name: "EXPIRED", type: "error" },
  { inputs: [], name: "IDENTICAL", type: "error" },
  { inputs: [], name: "INSUFFICIENT_AMOUNT", type: "error" },
  { inputs: [], name: "INSUFFICIENT_A_AMOUNT", type: "error" },
  { inputs: [], name: "INSUFFICIENT_B_AMOUNT", type: "error" },
  { inputs: [], name: "INSUFFICIENT_LIQUIDITY", type: "error" },
  { inputs: [], name: "INSUFFICIENT_OUTPUT_AMOUNT", type: "error" },
  { inputs: [], name: "INVALID_PATH", type: "error" },
  { inputs: [], name: "INVALID_RESERVES", type: "error" },
  { inputs: [], name: "ZERO_ADDRESS", type: "error" },
  {
    inputs: [],
    name: "WETH",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "tokenA", type: "address" },
      { internalType: "address", name: "tokenB", type: "address" },
      { internalType: "bool", name: "stable", type: "bool" },
      { internalType: "uint256", name: "amountADesired", type: "uint256" },
      { internalType: "uint256", name: "amountBDesired", type: "uint256" },
      { internalType: "uint256", name: "amountAMin", type: "uint256" },
      { internalType: "uint256", name: "amountBMin", type: "uint256" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "addLiquidity",
    outputs: [
      { internalType: "uint256", name: "amountA", type: "uint256" },
      { internalType: "uint256", name: "amountB", type: "uint256" },
      { internalType: "uint256", name: "liquidity", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountIn", type: "uint256" },
      { internalType: "uint256", name: "amountOutMin", type: "uint256" },
      {
        components: [
          { internalType: "address", name: "from", type: "address" },
          { internalType: "address", name: "to", type: "address" },
          { internalType: "bool", name: "stable", type: "bool" },
        ],
        internalType: "struct IRouter.route[]",
        name: "routes",
        type: "tuple[]",
      },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "swapExactTokensForTokens",
    outputs: [
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountIn", type: "uint256" },
      {
        components: [
          { internalType: "address", name: "from", type: "address" },
          { internalType: "address", name: "to", type: "address" },
          { internalType: "bool", name: "stable", type: "bool" },
        ],
        internalType: "struct IRouter.route[]",
        name: "routes",
        type: "tuple[]",
      },
    ],
    name: "getAmountsOut",
    outputs: [
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "factory",
    outputs: [{ internalType: "address", name: "", type: "address" }],
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
 * Gets pool metadata and calculates the price and market cap for the sonic token
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

  // Determine which token is sonic and which is quote
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

  // Get sonic token information
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
 * Buys a specified amount of sonic token using the quote token through the Shadow Router
 * @param shadowRouterAddress The address of the Shadow Router contract
 * @param poolAddress The address of the AMM pool
 * @param quoteToken The address of the quote token
 * @param baseToken The address of the sonic token to buy
 * @param amount The amount of quote token to spend
 * @param slippageTolerance The maximum slippage allowed (e.g., 0.01 for 1%)
 * @param walletClient Viem wallet client instance
 * @param publicClient Viem public client instance
 */
export async function buySonicWithShadowRouter(
  shadowRouterAddress: Address,
  quoteToken: Address,
  baseToken: Address,
  amount: string,
  slippageTolerance: number,
  walletClient: WalletClient,
  publicClient: PublicClient
): Promise<void> {
  console.log("\n========== STARTING BUY SONIC FUNCTION ==========");
  console.log(`Shadow Router Address: ${shadowRouterAddress}`);
  console.log(`Quote Token (USDC): ${quoteToken}`);
  console.log(`Base Token (SONIC): ${baseToken}`);
  console.log(`Amount to spend: ${amount} USDC`);
  console.log(`Slippage Tolerance: ${slippageTolerance * 100}%`);
  console.log(
    `Wallet Address: ${await walletClient.getAddresses().then((addresses) => addresses[0])}`
  );

  try {
    console.log("\n----- Creating contract instances -----");
    const shadowRouterContract = getContract({
      address: shadowRouterAddress,
      abi: SHADOW_ROUTER_ABI,
      client: { public: publicClient, wallet: walletClient },
    });
    console.log("Shadow Router contract instance created");

    // Get factory address
    console.log("\n----- Getting factory address -----");
    const factoryAddress = await shadowRouterContract.read.factory();
    console.log(`Factory Address: ${factoryAddress}`);

    // Create route for the swap
    console.log("\n----- Setting up swap route -----");
    const route: Route[] = [
      {
        from: quoteToken,
        to: baseToken,
        stable: false, // Assuming it's a volatile pair, adjust if needed
      },
    ];
    console.log(`Route: ${JSON.stringify(route)}`);

    // Get token decimals for proper formatting
    console.log("\n----- Getting token details -----");
    const quoteTokenContract = getContract({
      address: quoteToken,
      abi: erc20Abi,
      client: { public: publicClient, wallet: walletClient },
    });

    const quoteDecimals = await quoteTokenContract.read
      .decimals()
      .catch((e) => {
        console.error("Error getting quote token decimals:", e);
        return 6; // Fallback to 6 for USDC
      });
    console.log(`Quote Token Decimals: ${quoteDecimals}`);

    const baseTokenContract = getContract({
      address: baseToken,
      abi: erc20Abi,
      client: { public: publicClient, wallet: walletClient },
    });

    const baseDecimals = await baseTokenContract.read.decimals().catch((e) => {
      console.error("Error getting base token decimals:", e);
      return 18; // Fallback to 18
    });
    console.log(`Base Token Decimals: ${baseDecimals}`);

    // Parse the desired amount to the correct decimals
    console.log("\n----- Parsing input amount -----");
    const amountIn = parseUnits(amount, Number(quoteDecimals));
    console.log(`Amount In (raw): ${amountIn}`);
    console.log(
      `Amount In (formatted): ${formatUnits(amountIn, Number(quoteDecimals))} ${await quoteTokenContract.read.symbol()}`
    );

    // Check USDC allowance
    console.log("\n----- Checking token allowance -----");
    const allowance = await quoteTokenContract.read.allowance([
      await walletClient.getAddresses().then((addresses) => addresses[0]),
      shadowRouterAddress,
    ]);
    console.log(
      `Current allowance: ${formatUnits(allowance, Number(quoteDecimals))} ${await quoteTokenContract.read.symbol()}`
    );

    // Get the expected output amount
    console.log("\n----- Getting expected output amount -----");
    console.log(
      `Calling getAmountsOut with amountIn: ${amountIn} and route:`,
      route
    );

    let amounts;
    try {
      amounts = await shadowRouterContract.read.getAmountsOut([
        amountIn,
        route,
      ]);
      console.log(
        `getAmountsOut returned: ${JSON.stringify(amounts.map((a) => a.toString()))}`
      );
    } catch (error) {
      console.error("Error in getAmountsOut:", error);
      throw new Error(`Failed to get amounts out: ${error.message}`);
    }

    const amountOut = amounts[1];
    console.log(`Expected Output Amount (raw): ${amountOut}`);
    console.log(
      `Expected Output Amount (formatted): ${formatUnits(amountOut, Number(baseDecimals))} ${await baseTokenContract.read.symbol()}`
    );

    // Calculate minimum output with slippage tolerance
    console.log("\n----- Calculating minimum output with slippage -----");
    const amountOutMin =
      (amountOut * BigInt(Math.floor((1 - slippageTolerance) * 10000))) /
      10000n;
    console.log(`Min Output Amount (raw): ${amountOutMin}`);
    console.log(
      `Min Output Amount (formatted): ${formatUnits(amountOutMin, Number(baseDecimals))} ${await baseTokenContract.read.symbol()}`
    );
    console.log(
      `Effective slippage protection: ${(100 - (Number(amountOutMin) * 100) / Number(amountOut)).toFixed(2)}%`
    );

    // Set deadline to 20 minutes from now
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    console.log(
      `Deadline: ${deadline} (${new Date(Number(deadline) * 1000).toISOString()})`
    );

    // Get the user's address
    const account = COINBASE_HOT_WALLET;
    console.log(`Recipient Address: ${account}`);

    // First approve router to spend quote tokens if needed
    console.log("\n----- Approving token spending -----");
    if (allowance < amountIn) {
      console.log(
        `Need to approve ${formatUnits(amountIn, Number(quoteDecimals))} ${await quoteTokenContract.read.symbol()}`
      );

      try {
        const walletAddress = await walletClient
          .getAddresses()
          .then((addresses) => addresses[0]);
        console.log(`Approving from wallet: ${walletAddress}`);

        const approveTx = await quoteTokenContract.write.approve([
          shadowRouterAddress,
          amountIn,
        ]);
        console.log(`Approval transaction submitted: ${approveTx}`);

        // Verify the new allowance
        const newAllowance = await quoteTokenContract.read.allowance([
          walletAddress,
          shadowRouterAddress,
        ]);
        console.log(
          `New allowance: ${formatUnits(newAllowance, Number(quoteDecimals))} ${await quoteTokenContract.read.symbol()}`
        );
      } catch (error) {
        console.error("Error during token approval:", error);
        throw new Error(`Token approval failed: ${error.message}`);
      }
    } else {
      console.log(
        `Existing allowance of ${formatUnits(allowance, Number(quoteDecimals))} ${await quoteTokenContract.read.symbol()} is sufficient`
      );
    }

    // Execute the swap through the router
    console.log("\n----- Executing swap -----");
    console.log(`Calling swapExactTokensForTokens with:`);
    console.log(`- amountIn: ${amountIn}`);
    console.log(`- amountOutMin: ${amountOutMin}`);
    console.log(`- route: ${JSON.stringify(route)}`);
    console.log(`- to: ${account}`);
    console.log(`- deadline: ${deadline}`);

    try {
      const swapTx = await shadowRouterContract.write.swapExactTokensForTokens([
        amountIn,
        amountOutMin,
        route,
        account,
        deadline,
      ]);
      console.log(`Swap transaction submitted: ${swapTx}`);
    } catch (error) {
      console.error("Error during swap execution:", error);
      throw new Error(`Swap failed: ${error.message}`);
    }

    console.log("\n----- Swap completed successfully -----");
  } catch (error) {
    console.error("\n===== ERROR IN BUY SONIC FUNCTION =====");
    console.error(`Error message: ${error.message}`);
    console.error("Full error:", error);
    throw error;
  }
}

// Example usage:
async function example() {
  const publicClient = createPublicClient({
    chain: sonic,
    transport: http("http://localhost:" + sonic.id + "0"),
  });

  const client = createTestClient({
    chain: sonic,
    mode: "anvil",
    transport: http("http://localhost:" + sonic.id + "0"),
    account: COINBASE_HOT_WALLET,
  })
    .extend(publicActions)
    .extend(walletActions);

  const NUMBER_OF_REPS = 2;

  // First we'll need to find the pool address between SONIC_USDC and WRAPPED_SONIC
  const shadowRouterContract = getContract({
    address: SHADOW_ROUTER,
    abi: SHADOW_ROUTER_ABI,
    client: { public: publicClient, wallet: client },
  });

  const factoryAddress = await shadowRouterContract.read.factory();

  // We'll assume for this example that we know the pool address
  // In a real implementation, you'd get this from the factory or router
  // This is a placeholder - replace with the actual pool address
  const poolAddress = getAddress("0x1234567890123456789012345678901234567890"); // Placeholder

  console.log("Starting trade loop with Shadow Router");
  console.log(`Shadow Router: ${SHADOW_ROUTER}`);
  console.log(`SONIC USDC: ${SONIC_USDC}`);
  console.log(`WRAPPED SONIC: ${WRAPPED_SONIC}`);

  for (let i = 0; i < NUMBER_OF_REPS; i++) {
    try {
      console.log(`\nIteration ${i + 1}/${NUMBER_OF_REPS}`);

      // Check USDC balance before swap
      const usdcContract = getContract({
        address: SONIC_USDC,
        abi: erc20Abi,
        client: { public: publicClient, wallet: client },
      });

      const usdcBalance = await usdcContract.read.balanceOf([
        COINBASE_HOT_WALLET,
      ]);
      console.log(`USDC Balance Before: ${formatUnits(usdcBalance, 6)}`);

      // Check WRAPPED_SONIC balance before swap
      const wrappedSonicContract = getContract({
        address: WRAPPED_SONIC,
        abi: erc20Abi,
        client: { public: publicClient, wallet: client },
      });

      const wrappedSonicBalance = await wrappedSonicContract.read.balanceOf([
        COINBASE_HOT_WALLET,
      ]);
      const wrappedSonicDecimals = await wrappedSonicContract.read.decimals();
      console.log([wrappedSonicBalance, wrappedSonicDecimals]);
      console.log(
        `Wrapped SONIC Balance Before: ${formatUnits(wrappedSonicBalance, wrappedSonicDecimals)}`
      );

      // Impersonate the COINBASE_HOT_WALLET
      const impersonated = await client.impersonateAccount({
        address: COINBASE_HOT_WALLET,
      });

      // Execute the swap
      await buySonicWithShadowRouter(
        SHADOW_ROUTER,
        SONIC_USDC,
        WRAPPED_SONIC,
        "100", // Buy with 100 USDC
        0.01, // 1% slippage
        client,
        publicClient
      );

      // Check balances after swap
      const usdcBalanceAfter = await usdcContract.read.balanceOf([
        COINBASE_HOT_WALLET,
      ]);
      console.log(`USDC Balance After: ${formatUnits(usdcBalanceAfter, 6)}`);

      const wrappedSonicBalanceAfter =
        await wrappedSonicContract.read.balanceOf([COINBASE_HOT_WALLET]);
      console.log(
        `Wrapped SONIC Balance After: ${formatUnits(wrappedSonicBalanceAfter, wrappedSonicDecimals)}`
      );

      console.log(`Swap ${i + 1} completed`);
    } catch (error) {
      console.error(`Error in iteration ${i + 1}:`, error);
    }
  }

  console.log("\n------------FINAL SUMMARY---------------");
  try {
    const usdcContract = getContract({
      address: SONIC_USDC,
      abi: erc20Abi,
      client: { public: publicClient, wallet: client },
    });

    const wrappedSonicContract = getContract({
      address: WRAPPED_SONIC,
      abi: erc20Abi,
      client: { public: publicClient, wallet: client },
    });

    const usdcBalance = await usdcContract.read.balanceOf([
      COINBASE_HOT_WALLET,
    ]);
    const wrappedSonicBalance = await wrappedSonicContract.read.balanceOf([
      COINBASE_HOT_WALLET,
    ]);
    const wrappedSonicDecimals = await wrappedSonicContract.read.decimals();

    console.log(`Final USDC Balance: ${formatUnits(usdcBalance, 6)}`);
    console.log(
      `Final Wrapped SONIC Balance: ${formatUnits(wrappedSonicBalance, wrappedSonicDecimals)}`
    );
  } catch (error) {
    console.error("Error getting final balances:", error);
  }
}

await example();
