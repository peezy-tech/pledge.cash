import { describe, expect, test } from "bun:test";
import { encodeErrorResult, type Address, type Hex } from "viem";
import {
  decodeKnownPledgeCashError,
  discoverBoardrooms,
  discoverLiquidityLockers,
  liquidityLockerAbi,
  type PledgeCashLogClient,
} from "../src";

const factory = "0x1000000000000000000000000000000000000001" as Address;
const lockerFactory = "0x1000000000000000000000000000000000000002" as Address;
const boardroom = "0x2000000000000000000000000000000000000001" as Address;
const locker = "0x2000000000000000000000000000000000000002" as Address;
const owner = "0x3000000000000000000000000000000000000001" as Address;
const otherOwner = "0x3000000000000000000000000000000000000002" as Address;
const wrappedNative = "0x5000000000000000000000000000000000000001" as Address;
const shareToken = "0x6000000000000000000000000000000000000001" as Address;
const quoteAsset = "0x7000000000000000000000000000000000000001" as Address;
const salt = `0x${"11".repeat(32)}` as Hex;

describe("lean protocol discovery and errors", () => {
  test("discovers Boardrooms from factory creation events", async () => {
    const client = logClient((eventName) => eventName === "BoardroomCreated" ? [
      {
        blockNumber: 42n,
        logIndex: 0,
        transactionHash: `0x${"33".repeat(32)}`,
        args: { boardroom, owner, shareToken, wrappedNative, name: "Boardroom Common", symbol: "LEAN", salt },
      },
      {
        blockNumber: 43n,
        logIndex: 0,
        transactionHash: `0x${"44".repeat(32)}`,
        args: {
          boardroom: "0x2000000000000000000000000000000000000003",
          owner: otherOwner,
          shareToken: "0x6000000000000000000000000000000000000002",
          wrappedNative,
          name: "Other",
          symbol: "OTHR",
          salt,
        },
      },
    ] : []);
    const result = await discoverBoardrooms(client, { factory, owner, fromBlock: 40n });
    expect(result).toMatchObject({ complete: true, fromBlock: 40n });
    expect(result.items).toEqual([{
      boardroom,
      owner,
      wrappedNative,
      shareToken,
      name: "Boardroom Common",
      symbol: "LEAN",
      salt,
      createdAtBlock: 42n,
      transactionHash: `0x${"33".repeat(32)}`,
    }]);
  });

  test("discovers canonical locker configuration and filters by Boardroom", async () => {
    const client = logClient((eventName) => eventName === "LiquidityLockerCreated" ? [{
      blockNumber: 50n,
      logIndex: 0,
      transactionHash: `0x${"55".repeat(32)}`,
      args: { locker, boardroom, quoteAsset, poolFee: 3_000, tickSpacing: 60, salt },
    }] : []);
    const result = await discoverLiquidityLockers(client, {
      factory: lockerFactory,
      boardroom,
      fromBlock: 45n,
      toBlock: 55n,
    });
    expect(result.items).toEqual([{
      locker,
      boardroom,
      factory: lockerFactory,
      quoteAsset,
      poolFee: 3_000,
      tickSpacing: 60,
      salt,
      createdAtBlock: 50n,
      transactionHash: `0x${"55".repeat(32)}`,
    }]);
  });

  test("returns actionable partial-discovery errors", async () => {
    const client: PledgeCashLogClient = {
      async getBlockNumber() { return 9n; },
      async getLogs(parameters) {
        if (parameters.fromBlock === 5n) throw new Error("provider range limit");
        return [] as never;
      },
    };
    const result = await discoverBoardrooms(client, { factory, fromBlock: 1n, toBlock: 9n, chunkSize: 4n });
    expect(result.complete).toBe(false);
    expect(result.lastScannedBlock).toBe(4n);
    expect(result.errors[0]?.message).toContain("Try a smaller chunk size");
  });

  test("decodes frozen locker errors", () => {
    const data = encodeErrorResult({ abi: liquidityLockerAbi, errorName: "DeadlineExpired", args: [1_800_000_000n] });
    expect(decodeKnownPledgeCashError({ cause: { data } })).toMatchObject({
      name: "DeadlineExpired",
      args: [1_800_000_000n],
      message: "The transaction deadline 1800000000 has expired.",
    });
  });
});

function logClient(logs: (eventName: string | undefined) => readonly unknown[]): PledgeCashLogClient {
  return {
    async getLogs(parameters) {
      return logs((parameters.event as { name?: string }).name) as never;
    },
  };
}
