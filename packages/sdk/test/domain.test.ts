import { describe, expect, test } from "bun:test";
import { decodeFunctionData, encodeFunctionData, type Address, type Hex } from "viem";
import {
  buildPermit2ApprovalTransaction,
  buildUniswapV4SwapExactInputSingleTransaction,
  permit2Abi,
  uniswapUniversalRouterAbi,
  type UniswapV4PoolKey,
} from "../src";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;
const token0 = "0x0000000000000000000000000000000000000010" as Address;
const token1 = "0x0000000000000000000000000000000000000020" as Address;
const account = "0x0000000000000000000000000000000000000030" as Address;
const router = "0x0000000000000000000000000000000000000040" as Address;
const permit2 = "0x0000000000000000000000000000000000000050" as Address;
const poolKey = {
  currency0: token0,
  currency1: token1,
  fee: 3_000,
  tickSpacing: 60,
  hooks: ZERO_ADDRESS,
} satisfies UniswapV4PoolKey;

describe("Uniswap v4 helpers", () => {
  test("encodes exact-input swaps through Universal Router with a mandatory deadline", () => {
    const transaction = buildUniswapV4SwapExactInputSingleTransaction({
      universalRouter: router,
      poolKey,
      currencyIn: token0,
      amountIn: 100n,
      amountOutMin: 90n,
      recipient: account,
      deadline: 1_800_000_000n,
    });
    expect(transaction).toMatchObject({ address: router, functionName: "execute" });
    const decoded = decodeFunctionData({ abi: uniswapUniversalRouterAbi, data: transactionData(transaction) });
    expect(decoded.functionName).toBe("execute");
    expect(decoded.args?.[0]).toBe("0x10");
    expect(decoded.args?.[2]).toBe(1_800_000_000n);
    expect("value" in transaction).toBe(false);
  });

  test("passes native input value and rejects unsafe swap envelopes", () => {
    const nativePool = { ...poolKey, currency0: ZERO_ADDRESS };
    expect(buildUniswapV4SwapExactInputSingleTransaction({
      universalRouter: router,
      poolKey: nativePool,
      currencyIn: ZERO_ADDRESS,
      amountIn: 100n,
      amountOutMin: 90n,
      recipient: account,
      deadline: 1n,
    })).toMatchObject({ value: 100n });
    expect(() => buildUniswapV4SwapExactInputSingleTransaction({
      universalRouter: router,
      poolKey,
      currencyIn: account,
      amountIn: 1n,
      amountOutMin: 0n,
      recipient: account,
      deadline: 1n,
    })).toThrow("not part of the PoolKey");
    expect(() => buildUniswapV4SwapExactInputSingleTransaction({
      universalRouter: router,
      poolKey,
      currencyIn: token0,
      amountIn: 1n,
      amountOutMin: 0n,
      recipient: account,
      deadline: 0n,
    })).toThrow("require a deadline");
  });

  test("encodes Permit2 allowance and enforces uint bounds", () => {
    const transaction = buildPermit2ApprovalTransaction({
      permit2,
      token: token0,
      universalRouter: router,
      amount: (1n << 160n) - 1n,
      expiration: 2 ** 48 - 1,
    });
    expect(decodeFunctionData({ abi: permit2Abi, data: transactionData(transaction) })).toMatchObject({
      functionName: "approve",
      args: [token0, router, (1n << 160n) - 1n, 2 ** 48 - 1],
    });
    expect(() => buildPermit2ApprovalTransaction({
      permit2,
      token: token0,
      universalRouter: router,
      amount: 1n << 160n,
      expiration: 1,
    })).toThrow("uint160");
  });
});

function transactionData(transaction: {
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
}): Hex {
  return encodeFunctionData(transaction as never);
}
