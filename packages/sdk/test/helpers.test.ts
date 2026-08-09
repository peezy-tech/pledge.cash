import { describe, expect, test } from "bun:test";
import { decodeFunctionData, type Address, type Hex } from "viem";
import {
  boardroomAbi,
  erc20Abi,
  buildBoardroomCreateLiquidityLockerTransaction,
  buildBoardroomCreateTransaction,
  buildBoardroomLiquidityLockerCancelTransaction,
  buildBoardroomLiquidityLockerExitTransaction,
  buildBoardroomAssetGrantIssuanceBatch,
  buildGrantIssuerBoardroomAction,
  buildGrantRightTransferTransaction,
  buildGrantSettlementTransaction,
  liquidityLockerAbi,
  liquidityLockerFactoryAbi,
  liquidityLockerPoolKey,
  readBoardroomState,
  readGrantSettlementQuote,
  readLiquidityLockerState,
  tokenGrantFactoryAbi,
  type PledgeCashBlockReadClient,
  type PledgeCashReadClient,
} from "../src";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;
const boardroom = "0x0000000000000000000000000000000000000b0a" as Address;
const shareToken = "0x0000000000000000000000000000000000000aaa" as Address;
const quoteToken = "0x0000000000000000000000000000000000000456" as Address;
const account = "0x0000000000000000000000000000000000000b0b" as Address;
const recipient = "0x000000000000000000000000000000000000cafe" as Address;
const boardroomFactory = "0x0000000000000000000000000000000000000bf0" as Address;
const grantFactory = "0x0000000000000000000000000000000000000fac" as Address;
const lockerFactory = "0x00000000000000000000000000000000000010cf" as Address;
const locker = "0x00000000000000000000000000000000000010cc" as Address;
const grant = "0x0000000000000000000000000000000000000123" as Address;
const positionManager = "0x0000000000000000000000000000000000000555" as Address;
const feeRouter = "0x0000000000000000000000000000000000000fee" as Address;
const wrappedNative = "0x0000000000000000000000000000000000000e7a" as Address;
const salt = `0x${"11".repeat(32)}` as Hex;

describe("lean Boardroom and grant builders", () => {
  test("creates Boardrooms without release or facet arguments", () => {
    expect(buildBoardroomCreateTransaction({
      factory: boardroomFactory,
      owner: account,
      name: "Lean Project",
      symbol: "LEAN",
      salt,
    })).toMatchObject({
      address: boardroomFactory,
      functionName: "createBoardroom",
      args: [account, "Lean Project", "LEAN", salt],
    });
  });

  test("builds an atomic external-asset approval and Boardroom-funded grant batch", () => {
    const terms = {
      holder: recipient,
      token: quoteToken,
      paymentToken: quoteToken,
      amount: 1_000n,
      price: 25n,
      expiry: 2_000n,
      vestingCliff: 100n,
      vestingEnd: 1_000n,
      transferable: true,
      transferUnlockTime: 150n,
      salt,
    };
    const transaction = buildBoardroomAssetGrantIssuanceBatch({
      boardroom,
      factory: grantFactory,
      shareToken,
      terms,
      creationFee: 7n,
    });
    expect(transaction).toMatchObject({ address: boardroom, functionName: "executeBatch", value: 7n });
    const calls = transaction.args[0];
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ target: quoteToken, value: 0n });
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data })).toMatchObject({
      functionName: "approve",
      args: [grantFactory, 1_000n],
    });
    expect(calls[1]).toMatchObject({ target: grantFactory, value: 7n });
    const create = decodeFunctionData({ abi: tokenGrantFactoryAbi, data: calls[1]!.data });
    expect(create.functionName).toBe("createGrant");
    expect(String(create.args?.[0]).toLowerCase()).toBe(recipient.toLowerCase());
    expect(String(create.args?.[1]).toLowerCase()).toBe(quoteToken.toLowerCase());
    expect(create.args?.at(-1)).toBe(salt);

    expect(() => buildBoardroomAssetGrantIssuanceBatch({
      boardroom,
      factory: grantFactory,
      shareToken,
      terms: { ...terms, token: shareToken },
    })).toThrow("share tokens cannot be grant assets");
  });

  test("routes grant issuer actions by the flat Boardroom lifecycle", () => {
    expect(buildGrantIssuerBoardroomAction({
      boardroom,
      grant,
      status: 0,
      functionName: "stopVestingAndWithdrawUnvested",
    })).toMatchObject({ functionName: "execute" });
    const winding = buildGrantIssuerBoardroomAction({
      boardroom,
      grant,
      status: 1,
      functionName: "withdrawExpiredTokens",
    });
    expect(winding.functionName).toBe("executeEscrow");
    expect(winding.args[0]).toBe(grant);
    expect(buildGrantSettlementTransaction({ grant, amount: 200n })).toMatchObject({
      functionName: "settle",
      args: [200n],
    });
    expect(buildGrantRightTransferTransaction({ factory: grantFactory, from: account, to: recipient, tokenId: 123n }))
      .toMatchObject({ functionName: "safeTransferFrom", args: [account, recipient, 123n] });
  });
});

describe("liquidity locker builders", () => {
  test("creates the canonical locker through Boardroom.execute", () => {
    const transaction = buildBoardroomCreateLiquidityLockerTransaction({
      boardroom,
      factory: lockerFactory,
      terms: { quoteAsset: quoteToken, poolFee: 3_000, tickSpacing: 60, salt },
    });
    expect(transaction).toMatchObject({ address: boardroom, functionName: "execute", value: 0n });
    const call = transaction.args[0];
    expect(call.target).toBe(lockerFactory);
    expect(decodeFunctionData({ abi: liquidityLockerFactoryAbi, data: call.data })).toMatchObject({
      functionName: "createLocker",
      args: [quoteToken, 3_000, 60, salt],
    });
  });

  test("dispatches cancel active through execute and winding down through executeEscrow", () => {
    const active = buildBoardroomLiquidityLockerCancelTransaction({ boardroom, locker, status: 0 });
    expect(active).toMatchObject({ functionName: "execute" });
    expect(decodeFunctionData({ abi: liquidityLockerAbi, data: active.args[0].data }).functionName).toBe("cancel");

    const winding = buildBoardroomLiquidityLockerCancelTransaction({ boardroom, locker, status: 1 });
    expect(winding.functionName).toBe("executeEscrow");
    expect(winding.args[0]).toBe(locker);
    expect(decodeFunctionData({ abi: liquidityLockerAbi, data: winding.args[1] }).functionName).toBe("cancel");
  });

  test("exits only through the registered winding-down escrow route", () => {
    const transaction = buildBoardroomLiquidityLockerExitTransaction({
      boardroom,
      locker,
      amount0Min: 10n,
      amount1Min: 20n,
      deadline: 1_800_000_000n,
    });
    expect(transaction.functionName).toBe("executeEscrow");
    expect(transaction.args[0]).toBe(locker);
    expect(decodeFunctionData({ abi: liquidityLockerAbi, data: transaction.args[1] })).toMatchObject({
      functionName: "exit",
      args: [10n, 20n, 1_800_000_000n],
    });
  });
});

describe("lean readers", () => {
  test("reads a block-consistent Boardroom custody snapshot", async () => {
    const values: Record<string, unknown> = {
      factory: boardroomFactory,
      owner: account,
      wrappedNative,
      shareToken,
      redemptionExcessRecipient: recipient,
      status: 1,
      windDownStartedAt: 1_000n,
      redeemableAssetCount: 2n,
      assetSnapshotProgress: [2n, 1n, true],
      redemptionSupplyState: [900n, true],
      openEscrowCount: 2n,
      totalSupply: 1_000n,
      balanceOf: 100n,
    };
    const client: PledgeCashBlockReadClient = {
      async getBlockNumber() { return 77n; },
      async readContract(parameters) {
        const name = parameters.functionName as string;
        const value = values[name];
        if (value === undefined) throw new Error(`Unexpected read ${name}`);
        return value as never;
      },
    };
    await expect(readBoardroomState(client, boardroom)).resolves.toMatchObject({
      address: boardroom,
      blockNumber: 77n,
      owner: account,
      status: 1,
      totalShareSupply: 1_000n,
      treasuryShareBalance: 100n,
      openEscrowCount: 2n,
      snapshotAssetCount: 2n,
      snapshotCursor: 1n,
    });
  });

  test("reads locker identity and exposes its canonical hookless PoolKey", async () => {
    const values: Record<string, unknown> = {
      boardroom,
      shareToken,
      quoteAsset: quoteToken,
      currency0: shareToken.toLowerCase() < quoteToken.toLowerCase() ? shareToken : quoteToken,
      currency1: shareToken.toLowerCase() < quoteToken.toLowerCase() ? quoteToken : shareToken,
      protocolFeeRouter: feeRouter,
      positionManager,
      poolFee: 3_000,
      tickSpacing: 60,
      tokenId: 0n,
      positionRegistered: false,
      isClosed: false,
    };
    const state = await readLiquidityLockerState(readClient((_, name) => values[name]), locker);
    expect(state).toMatchObject({ boardroom, quoteAsset: quoteToken, poolFee: 3_000, tickSpacing: 60 });
    expect(liquidityLockerPoolKey(state)).toEqual({
      currency0: state.currency0,
      currency1: state.currency1,
      fee: 3_000,
      tickSpacing: 60,
      hooks: ZERO_ADDRESS,
    });
  });

  test("preserves priced grant settlement funding reads", async () => {
    const values: Record<string, unknown> = {
      factory: grantFactory,
      issuer: boardroom,
      holder: account,
      token: shareToken,
      paymentToken: quoteToken,
      tokenId: 123n,
      tokenDecimals: 18,
      grantSize: 1_000n,
      claimable: 900n,
      price: 25n,
      vestingCliff: 100n,
      vestingEnd: 1_000n,
      expiry: 2_000n,
      settledAmount: 100n,
      vestingIsHalted: false,
      isClosed: false,
      getSettleableAmount: 500n,
      getUnsettledAmount: 800n,
      transferable: true,
      transferUnlockTime: 150n,
      transferLocked: false,
      isExpired: false,
      isQuarantined: false,
      quarantinedAmount: 0n,
    };
    const client = readClient((address, name, args) => {
      if (address === quoteToken && name === "balanceOf") return 1_000n;
      if (address === quoteToken && name === "allowance") return 500n;
      if (name === "getSettlementCost") return args?.[0] === 200n ? 5n : 13n;
      return values[name];
    });
    await expect(readGrantSettlementQuote(client, grant, 200n, 500n)).resolves.toMatchObject({
      amount: 200n,
      settlementCost: 5n,
      paymentBalance: 1_000n,
      paymentAllowance: 500n,
      state: { settlementCost: 13n, transferable: true },
    });
  });
});

function readClient(
  value: (address: Address, functionName: string, args: readonly unknown[] | undefined) => unknown,
): PledgeCashReadClient {
  return {
    async readContract(parameters) {
      const result = value(
        parameters.address as Address,
        parameters.functionName as string,
        parameters.args as readonly unknown[] | undefined,
      );
      if (result === undefined) throw new Error(`Unexpected read ${String(parameters.functionName)}`);
      return result as never;
    },
  };
}
