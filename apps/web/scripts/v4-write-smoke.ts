import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildErc20Approval,
  buildPermit2ApprovalTransaction,
  erc20Abi,
  type Address,
  type PledgeCashDeployment,
} from "@pledge.cash/sdk";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildAddLiquidityTransaction,
  buildSwapTransaction,
  readAmmPosition,
  readLiquidityQuote,
  readSwapQuote,
  readSwapTokenList,
  type LiquidityQuoteState,
  type SwapQuoteState,
} from "../src/lib/swap";

const DEFAULT_RPC_URL = "http://127.0.0.1:8547";
const DEFAULT_PRIVATE_KEY = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e";
const DEFAULT_DEPLOYMENT_PATH = fileURLToPath(new URL("../../../packages/contracts/deployments/31337.json", import.meta.url));
const DEFAULT_SEED_PATH = fileURLToPath(new URL("../../../packages/contracts/deployments/31337.seed.json", import.meta.url));
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;

type SmokeConfig = {
  rpcUrl: string;
  privateKey: Hex;
  deploymentPath: string;
  seedPath: string;
};

type LocalSeed = {
  cashToken?: string;
  boardroomShareToken?: string;
};

type SmokeResult = {
  p4lpDeposit: Hex;
  erc20Permit2Approval: Hex;
  permit2RouterApproval: Hex;
  swap: Hex;
};

const config = readConfig();
assertLocalRpc(config.rpcUrl);

const deployment = await readJson<PledgeCashDeployment>(config.deploymentPath);
const seed = await readJson<LocalSeed>(config.seedPath);
const chainId = Number(deployment.chainId);
const chain = defineChain({
  id: chainId,
  name: "pledge.cash local v4 smoke",
  nativeCurrency: { decimals: 18, name: "Native", symbol: "NATIVE" },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});
const account = privateKeyToAccount(config.privateKey);
const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) });

const remoteChainId = await publicClient.getChainId();
if (remoteChainId !== chainId || remoteChainId !== 31337) {
  throw new Error(`v4 smoke expects local chain 31337, got deployment ${chainId.toString()} and RPC ${remoteChainId.toString()}.`);
}

const cashToken = requireAddress(seed.cashToken, "seed.cashToken");
const shareToken = requireAddress(seed.boardroomShareToken, "seed.boardroomShareToken");
const permit2 = requireAddress(deployment.permit2, "deployment.permit2");
const universalRouter = requireAddress(deployment.uniswapUniversalRouter, "deployment.uniswapUniversalRouter");

const tokenList = await readSwapTokenList(publicClient, deployment, account.address, {
  wrappedNativeLabel: `W${chain.nativeCurrency.symbol}`,
});
if (tokenList.error) throw new Error(`Token discovery failed: ${tokenList.error}`);
if (!tokenList.tokens.some((token) => sameAddress(token.address, cashToken)) || !tokenList.tokens.some((token) => sameAddress(token.address, shareToken))) {
  throw new Error("Token discovery did not include both CASH and Boardroom share tokens.");
}

const beforePosition = await readAmmPosition(publicClient, deployment, cashToken, shareToken, account.address);
const beforeClaims = beforePosition?.lpBalance ?? 0n;
const liquidityQuote = await readRequiredLiquidityQuote();
const vault = requiredAddress(liquidityQuote.pool?.address, "P4LP vault");

await submit("Approve token A for P4LP vault", buildErc20Approval({
  token: cashToken,
  spender: vault,
  amount: requiredAmount(liquidityQuote.amountA, "liquidity amount A"),
}));
await submit("Approve token B for P4LP vault", buildErc20Approval({
  token: shareToken,
  spender: vault,
  amount: requiredAmount(liquidityQuote.amountB, "liquidity amount B"),
}));
const p4lpDeposit = await submit("Deposit into P4LP vault", buildAddLiquidityTransaction({
  deployment,
  form: liquidityForm(),
  quote: liquidityQuote,
  account: account.address,
}));

const afterPosition = await readAmmPosition(publicClient, deployment, cashToken, shareToken, account.address);
const afterClaims = afterPosition?.lpBalance ?? 0n;
if (afterClaims <= beforeClaims) throw new Error("P4LP deposit did not increase the account's claim balance.");

const swapQuote = await readRequiredSwapQuote();
const outputBefore = await tokenBalance(shareToken);
const erc20Permit2Approval = await submit("Approve CASH for Permit2", buildErc20Approval({
  token: cashToken,
  spender: permit2,
  amount: MAX_UINT256,
}));
const permit2RouterApproval = await submit("Approve Universal Router in Permit2", buildPermit2ApprovalTransaction({
  permit2,
  token: cashToken,
  universalRouter,
  amount: MAX_UINT160,
  expiration: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
}));
const swap = await submit("Swap through Uniswap v4", buildSwapTransaction({
  deployment,
  form: swapForm(),
  quote: swapQuote,
  account: account.address,
}));
const outputAfter = await tokenBalance(shareToken);
if (outputAfter <= outputBefore) throw new Error("Uniswap v4 swap did not increase the output-token balance.");

const result: SmokeResult = { p4lpDeposit, erc20Permit2Approval, permit2RouterApproval, swap };
console.log(JSON.stringify({
  ok: true,
  account: account.address,
  vault,
  poolId: liquidityQuote.pool?.poolId,
  claimsBefore: beforeClaims.toString(),
  claimsAfter: afterClaims.toString(),
  swapOutput: (outputAfter - outputBefore).toString(),
  ...result,
}, null, 2));

async function readRequiredLiquidityQuote(): Promise<LiquidityQuoteState> {
  const quote = await readLiquidityQuote(publicClient, deployment, liquidityForm(), account.address);
  if (quote.error) throw new Error(`P4LP deposit quote failed: ${quote.error}`);
  return quote;
}

async function readRequiredSwapQuote(): Promise<SwapQuoteState> {
  const quote = await readSwapQuote(publicClient, deployment, swapForm(), account.address);
  if (quote.error) throw new Error(`Uniswap v4 swap quote failed: ${quote.error}`);
  return quote;
}

function liquidityForm() {
  return {
    tokenA: cashToken,
    tokenB: shareToken,
    amountA: "1",
    amountB: "2",
    slippageBps: "50",
    recipient: "",
    deadline: smokeDeadline(),
    useNative: false,
  };
}

function swapForm() {
  return {
    tokenIn: cashToken,
    tokenOut: shareToken,
    amountIn: "100",
    slippageBps: "100",
    recipient: "",
    deadline: smokeDeadline(),
    useNative: false,
  };
}

async function tokenBalance(token: Address): Promise<bigint> {
  return await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
}

async function submit(label: string, request: Record<string, unknown>): Promise<Hex> {
  const hash = await walletClient.writeContract({ account, chain, ...request } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.error(`${label}: ${hash}`);
  return hash;
}

function smokeDeadline(): string {
  return String(Math.floor(Date.now() / 1000) + 1200);
}

function readConfig(): SmokeConfig {
  return {
    rpcUrl: process.env.V4_SMOKE_RPC_URL ?? DEFAULT_RPC_URL,
    privateKey: normalizePrivateKey(process.env.V4_SMOKE_PRIVATE_KEY ?? DEFAULT_PRIVATE_KEY),
    deploymentPath: process.env.V4_SMOKE_DEPLOYMENT ?? DEFAULT_DEPLOYMENT_PATH,
    seedPath: process.env.V4_SMOKE_SEED ?? DEFAULT_SEED_PATH,
  };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function normalizePrivateKey(value: string): Hex {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error("V4_SMOKE_PRIVATE_KEY must be a 32-byte hex private key.");
  return normalized as Hex;
}

function assertLocalRpc(rpcUrl: string): void {
  if (process.env.V4_SMOKE_ALLOW_REMOTE === "1") return;
  const parsed = new URL(rpcUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "ws:") throw new Error("v4 write smoke refuses non-local RPC URLs unless V4_SMOKE_ALLOW_REMOTE=1.");
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("v4 write smoke refuses non-loopback RPC URLs unless V4_SMOKE_ALLOW_REMOTE=1.");
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

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
