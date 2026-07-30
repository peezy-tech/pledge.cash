import { describe, expect, test } from "bun:test";
import { encodeErrorResult, type Address, type Hex } from "viem";

import {
  boardroomKernelAbi,
  decodeKnownPledgeCashError,
  discoverBoardrooms,
  type PledgeCashLogClient,
} from "../src";

const factory = "0x1000000000000000000000000000000000000001" as Address;
const boardroom = "0x2000000000000000000000000000000000000001" as Address;
const owner = "0x3000000000000000000000000000000000000001" as Address;
const otherOwner = "0x3000000000000000000000000000000000000002" as Address;
const policyRegistry = "0x4000000000000000000000000000000000000001" as Address;
const wrappedNative = "0x5000000000000000000000000000000000000001" as Address;
const shareToken = "0x6000000000000000000000000000000000000001" as Address;
const salt = `0x${"11".repeat(32)}` as Hex;
const facetSetHash = `0x${"22".repeat(32)}` as Hex;

describe("Boardroom discovery and errors", () => {
  test("discovers the complete Boardroom creation identity", async () => {
    const client: PledgeCashLogClient = {
      async getLogs(parameters) {
        const eventName = (parameters.event as { name?: string }).name;
        if (eventName !== "BoardroomCreated") return [] as never;
        return [
          {
            blockNumber: 42n,
            logIndex: 0,
            transactionHash: `0x${"33".repeat(32)}`,
            args: {
              boardroom,
              owner,
              policyRegistry,
              shareToken,
              wrappedNative,
              name: "Boardroom Common",
              symbol: "VNXT",
              salt,
              facetSetHash,
            },
          },
          {
            blockNumber: 43n,
            logIndex: 0,
            transactionHash: `0x${"44".repeat(32)}`,
            args: {
              boardroom: "0x2000000000000000000000000000000000000002",
              owner: otherOwner,
              policyRegistry,
              shareToken: "0x6000000000000000000000000000000000000002",
              wrappedNative,
              name: "Other",
              symbol: "OTHR",
              salt,
              facetSetHash,
            },
          },
        ] as never;
      },
    };

    const result = await discoverBoardrooms(client, { factory, owner, fromBlock: 40n });

    expect(result.complete).toBe(true);
    expect(result.items).toEqual([
      {
        boardroom,
        owner,
        policyRegistry,
        wrappedNative,
        shareToken,
        name: "Boardroom Common",
        symbol: "VNXT",
        salt,
        facetSetHash,
        createdAtBlock: 42n,
        transactionHash: `0x${"33".repeat(32)}`,
      },
    ]);
  });

  test("decodes the release migration gate from the shipped kernel ABI", () => {
    const data = encodeErrorResult({
      abi: boardroomKernelAbi,
      errorName: "StorageMigrationRequired",
      args: [1n, 2n],
    });

    expect(decodeKnownPledgeCashError({ cause: { data } })).toMatchObject({
      name: "StorageMigrationRequired",
      args: [1n, 2n],
    });
  });
});
