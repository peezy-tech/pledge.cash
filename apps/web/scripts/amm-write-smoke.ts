import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildErc20Approval, type Address, type PledgeCashDeployment } from "@pledge.cash/sdk";
import { createPublicClient, createWalletClient, defineChain, formatUnits, getAddress, http, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildAddLiquidityTransaction,
  buildClaimAmmFeesTransaction,
  buildRemoveLiquidityTransaction,
  buildSwapTransaction,
  readAmmPosition,
  readLiquidityQuote,
  readRemoveLiquidityQuote,
  readSwapQuote,
  readSwapTokenList,
  type LiquidityQuoteState,
  type RemoveLiquidityQuoteState,
  type SwapQuoteState,
} from "../src/lib/swap";
import type { ProductBoardroomSeed } from "../src/lib/product-boardroom";

const DEFAULT_RPC_URL = "http://127.0.0.1:8547";
const DEFAULT_PRIVATE_KEY = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e";
const DEFAULT_DEPLOYMENT_PATH = fileURLToPath(new URL("../../../packages/contracts/deployments/31337.json", import.meta.url));
const DEFAULT_SEED_PATH = fileURLToPath(new URL("../../../packages/contracts/deployments/31337.seed.json", import.meta.url));

type SmokeConfig = {
  rpcUrl: string;
  privateKey: Hex;
  deploymentPath: string;
  seedPath: string;
};

type SmokeResult = {
  addLiquidity: Hex;
  swap: Hex;
  claimFees: Hex;
  removeLiquidity: Hex;
};

const config = readConfig();
assertLocalRpc(config.rpcUrl);

const deployment = await readJson<PledgeCashDeployment>(config.deploymentPath);
const seed = await readJson<ProductBoardroomSeed>(config.seedPath);
const chainId = Number(deployment.chainId);
const chain = defineChain({
  id: chainId,
  name: "pledge.cash local smoke",
  nativeCurrency: { decimals: 18, name: "HYPE", symbol: "HYPE" },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});
const account = privateKeyToAccount(config.privateKey);
const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) });

const remoteChainId = await publicClient.getChainId();
if (remoteChainId !== chainId || remoteChainId !== 31337) {
  throw new Error(`AMM smoke expects local chain 31337, got deployment ${chainId.toString()} and RPC ${remoteChainId.toString()}.`);
}

const cashToken = requireAddress(seed.cashToken, "seed.cashToken");
const shareToken = requireAddress(seed.boardroomShareToken, "seed.boardroomShareToken");
const router = requireAddress(deployment.ammRouter, "deployment.ammRouter");

const tokenList = await readSwapTokenList(publicClient, deployment, seed, account.address);
if (tokenList.error) throw new Error(`Token discovery failed: ${tokenList.error}`);
if (!tokenList.tokens.some((token) => sameAddress(token.address, cashToken)) || !tokenList.tokens.some((token) => sameAddress(token.address, shareToken))) {
  throw new Error("Token discovery did not include both CASH and boardroom share tokens.");
}

const beforePosition = await readAmmPosition(publicClient, deployment, cashToken, shareToken, account.address);
const beforeLpBalance = beforePosition?.lpBalance ?? 0n;

const liquidityQuote = await readRequiredLiquidityQuote();
await submit("Approve token A", buildErc20Approval({ token: cashToken, spender: router, amount: requiredAmount(liquidityQuote.amountA, "liquidity amount A") }));
await submit("Approve token B", buildErc20Approval({ token: shareToken, spender: router, amount: requiredAmount(liquidityQuote.amountB, "liquidity amount B") }));
const addLiquidity = await submit("Add liquidity", buildAddLiquidityTransaction({
  deployment,
  form: {
    tokenA: cashToken,
    tokenB: shareToken,
    amountA: "1",
    amountB: "2",
    slippageBps: "50",
    recipient: "",
    deadline: smokeDeadline(),
    useNative: false,
  },
  quote: liquidityQuote,
  account: account.address,
}));

const afterAddPosition = await readAmmPosition(publicClient, deployment, cashToken, shareToken, account.address);
const lpBalance = afterAddPosition?.lpBalance ?? 0n;
if (lpBalance <= beforeLpBalance) throw new Error("Add liquidity did not increase LP balance.");

const swapQuote = await readRequiredSwapQuote();
await submit("Approve swap input", buildErc20Approval({ token: cashToken, spender: router, amount: requiredAmount(swapQuote.amountIn, "swap amount in") }));
const swap = await submit("Swap", buildSwapTransaction({
  deployment,
  form: {
    tokenIn: cashToken,
    tokenOut: shareToken,
    amountIn: "100",
    slippageBps: "100",
    recipient: "",
    deadline: smokeDeadline(),
    useNative: false,
  },
  quote: swapQuote,
  account: account.address,
}));

const feePosition = await readAmmPosition(publicClient, deployment, cashToken, shareToken, account.address);
const claimableA = feePosition?.claimableA ?? 0n;
const claimableB = feePosition?.claimableB ?? 0n;
if (claimableA === 0n && claimableB === 0n) throw new Error("Swap did not create claimable LP fees for the smoke LP.");
const claimFees = await submit("Claim AMM fees", buildClaimAmmFeesTransaction(requiredPosition(feePosition)));

const removeQuote = await readRequiredRemoveQuote(lpBalance, afterAddPosition?.lpToken?.decimals);
await submit("Approve LP", buildErc20Approval({
  token: requiredAddress(removeQuote.position?.pool?.address, "remove quote pool"),
  spender: router,
  amount: requiredAmount(removeQuote.liquidity, "remove liquidity amount"),
}));
const removeLiquidity = await submit("Remove liquidity", buildRemoveLiquidityTransaction({
  deployment,
  form: {
    liquidity: liquidityInput(lpBalance, removeQuote.position?.lpToken?.decimals),
    slippageBps: "100",
    recipient: "",
    deadline: smokeDeadline(),
    useNative: false,
  },
  quote: removeQuote,
  account: account.address,
}));

const finalPosition = await readAmmPosition(publicClient, deployment, cashToken, shareToken, account.address);
if ((finalPosition?.lpBalance ?? 0n) >= lpBalance) throw new Error("Remove liquidity did not decrease LP balance.");

const result: SmokeResult = { addLiquidity, swap, claimFees, removeLiquidity };
console.log(JSON.stringify({
  ok: true,
  account: account.address,
  pool: afterAddPosition?.pool?.address,
  claimableA: claimableA.toString(),
  claimableB: claimableB.toString(),
  ...result,
}, null, 2));

async function readRequiredLiquidityQuote(): Promise<LiquidityQuoteState> {
  const quote = await readLiquidityQuote(publicClient, deployment, {
    tokenA: cashToken,
    tokenB: shareToken,
    amountA: "1",
    amountB: "2",
    slippageBps: "50",
    recipient: "",
    deadline: smokeDeadline(),
    useNative: false,
  }, account.address);
  if (quote.error) throw new Error(`Liquidity quote failed: ${quote.error}`);
  return quote;
}

async function readRequiredSwapQuote(): Promise<SwapQuoteState> {
  const quote = await readSwapQuote(publicClient, deployment, {
    tokenIn: cashToken,
    tokenOut: shareToken,
    amountIn: "100",
    slippageBps: "100",
    recipient: "",
    deadline: smokeDeadline(),
    useNative: false,
  }, account.address);
  if (quote.error) throw new Error(`Swap quote failed: ${quote.error}`);
  return quote;
}

async function readRequiredRemoveQuote(lpBalance: bigint, lpDecimals: number | undefined): Promise<RemoveLiquidityQuoteState> {
  const quote = await readRemoveLiquidityQuote(publicClient, deployment, {
    tokenA: cashToken,
    tokenB: shareToken,
    amountA: "1",
    amountB: "2",
    slippageBps: "50",
    recipient: "",
    deadline: smokeDeadline(),
    useNative: false,
  }, {
    liquidity: liquidityInput(lpBalance, lpDecimals),
    slippageBps: "100",
    recipient: "",
    deadline: smokeDeadline(),
    useNative: false,
  }, account.address);
  if (quote.error) throw new Error(`Remove-liquidity quote failed: ${quote.error}`);
  return quote;
}

async function submit(label: string, request: Record<string, unknown>): Promise<Hex> {
  const hash = await walletClient.writeContract({
    account,
    chain,
    ...request,
  } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.error(`${label}: ${hash}`);
  return hash;
}

function liquidityInput(lpBalance: bigint, decimals: number | undefined): string {
  const amount = lpBalance / 2n;
  if (amount === 0n) throw new Error("LP balance is too small to remove half.");
  return formatUnits(amount, decimals ?? 18);
}

function smokeDeadline(): string {
  return String(Math.floor(Date.now() / 1000) + 1200);
}

function readConfig(): SmokeConfig {
  return {
    rpcUrl: process.env.AMM_SMOKE_RPC_URL ?? DEFAULT_RPC_URL,
    privateKey: normalizePrivateKey(process.env.AMM_SMOKE_PRIVATE_KEY ?? DEFAULT_PRIVATE_KEY),
    deploymentPath: process.env.AMM_SMOKE_DEPLOYMENT ?? DEFAULT_DEPLOYMENT_PATH,
    seedPath: process.env.AMM_SMOKE_SEED ?? DEFAULT_SEED_PATH,
  };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function normalizePrivateKey(value: string): Hex {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error("AMM_SMOKE_PRIVATE_KEY must be a 32-byte hex private key.");
  return normalized as Hex;
}

function assertLocalRpc(rpcUrl: string): void {
  if (process.env.AMM_SMOKE_ALLOW_REMOTE === "1") return;
  const parsed = new URL(rpcUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "ws:") throw new Error("AMM write smoke refuses non-local RPC URLs unless AMM_SMOKE_ALLOW_REMOTE=1.");
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("AMM write smoke refuses non-loopback RPC URLs unless AMM_SMOKE_ALLOW_REMOTE=1.");
  }
}

function requireAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`${label} must be a valid address.`);
  return getAddress(value);
}

function requiredAddress(value: Address | undefined, label: string): Address {
  if (!value) throw new Error(`${label} is missing.`);
  return value;
}

function requiredAmount(value: bigint | undefined, label: string): bigint {
  if (value === undefined) throw new Error(`${label} is missing.`);
  return value;
}

function requiredPosition<T>(value: T | undefined): T {
  if (!value) throw new Error("AMM position is missing.");
  return value;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
