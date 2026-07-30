import { describe, expect, test } from "bun:test";
import { encodeErrorResult, type Address, type Hex } from "viem";

import {
  boardroomKernelAbi,
  decodeKnownPledgeCashError,
  discoverBoardrooms,
  type PledgeCashLogClient,
} from "../src";

const registry = "0x0000000000000000000000000000000000000101" as Address;
const factory = "0x0000000000000000000000000000000000000102" as Address;
const wrappedNative = "0x0000000000000000000000000000000000000106" as Address;
const boardroom = "0x0000000000000000000000000000000000000108" as Address;
const shareToken = "0x0000000000000000000000000000000000000109" as Address;
const owner = "0x000000000000000000000000000000000000010a" as Address;
const facetSetHash = `0x${"11".repeat(32)}` as Hex;
const storageLayoutHash = `0x${"22".repeat(32)}` as Hex;

describe("Boardroom ecosystem helpers", () => {
  test("discovers Boardrooms from their creation event", async () => {
    const client: PledgeCashLogClient = {
      async getLogs() {
        return [{
          args: {
            boardroom,
            owner,
            policyRegistry: registry,
            wrappedNative,
            shareToken,
            name: "Common Boardroom",
            symbol: "COMMON",
            salt: storageLayoutHash,
            facetSetHash,
          },
          blockNumber: 42n,
          logIndex: 3,
          transactionHash: `0x${"33".repeat(32)}`,
        }] as never;
      },
    };

    await expect(discoverBoardrooms(client, {
      factory,
      owner,
      fromBlock: 40n,
      toBlock: 50n,
    })).resolves.toMatchObject({
      complete: true,
      items: [{
        boardroom,
        owner,
        policyRegistry: registry,
        wrappedNative,
        shareToken,
        name: "Common Boardroom",
        symbol: "COMMON",
        salt: storageLayoutHash,
        facetSetHash,
        createdAtBlock: 42n,
      }],
    });
  });

  test("decodes stale-hash and migration failures from the kernel ABI", () => {
    const data = encodeErrorResult({
      abi: boardroomKernelAbi,
      errorName: "FacetSetHashMismatch",
      args: [facetSetHash, storageLayoutHash],
    });
    expect(decodeKnownPledgeCashError(data)).toMatchObject({
      name: "FacetSetHashMismatch",
      args: [facetSetHash, storageLayoutHash],
    });
  });

});
