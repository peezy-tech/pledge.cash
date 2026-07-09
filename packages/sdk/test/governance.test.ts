import { describe, expect, test } from "bun:test";
import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  boardroomAbi,
  decodeQueueCalldata,
  hashAction,
  hashBatch,
  hashCall,
  queryGovernanceEvents,
  type BoardroomCall,
  type PledgeCashLogClient,
} from "../src";

const boardroom = "0x0000000000000000000000000000000000000b0a" as Address;
const secondBoardroom = "0x0000000000000000000000000000000000000b0b" as Address;
const executor = "0x0000000000000000000000000000000000000e0a" as Address;
const caller = "0x000000000000000000000000000000000000ca11" as Address;
const owner = "0x0000000000000000000000000000000000000a11" as Address;
const policy = "0x0000000000000000000000000000000000000a55" as Address;
const target = "0x0000000000000000000000000000000000000aaa" as Address;
const secondTarget = "0x0000000000000000000000000000000000000123" as Address;
const salt = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
const actionHash = "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex;
const dataHash = "0x3333333333333333333333333333333333333333333333333333333333333333" as Hex;
const selector = "0x12345678" as Hex;

const call = {
  policy,
  target,
  value: 123n,
  data: "0xa9059cbb0000000000000000000000000000000000000000000000000000000000000b0b00000000000000000000000000000000000000000000000000000000000003e8" as Hex,
} satisfies BoardroomCall;

const secondCall = {
  policy,
  target: secondTarget,
  value: 0n,
  data: "0x" as Hex,
} satisfies BoardroomCall;

describe("governance helpers", () => {
  test("decodes queueAction calldata", () => {
    const data = encodeFunctionData({
      abi: boardroomAbi,
      functionName: "queueAction",
      args: [call, salt],
    });

    expect(decodeQueueCalldata(data)).toEqual({ kind: "queueAction", call, salt });
  });

  test("decodes queueBatch calldata", () => {
    const data = encodeFunctionData({
      abi: boardroomAbi,
      functionName: "queueBatch",
      args: [[call, secondCall], salt],
    });

    expect(decodeQueueCalldata(data)).toEqual({ kind: "queueBatch", calls: [call, secondCall], salt });
  });

  test("returns undefined for non-queue calldata", () => {
    expect(
      decodeQueueCalldata(
        encodeFunctionData({
          abi: boardroomAbi,
          functionName: "launch",
          args: [86_400n],
        }),
      ),
    ).toBeUndefined();
    expect(decodeQueueCalldata("0x12345678")).toBeUndefined();
  });

  test("hashes calls, actions, and batches using Boardroom abi.encode scheme", () => {
    expect(hashCall(call)).toBe("0x19101745909e2dca8c9c7550cc1aaca497046a86be7c2a5b94a40df8a859924d");
    expect(hashAction(call, salt)).toBe("0xa17af9d04da1a54810b7a993bac00b3102dca98ff1e98154ae2730a2526e350e");
    expect(hashBatch([call, secondCall], salt)).toBe(
      "0x2f25a1fa3a8c055c3b8d77f36d76c446297687b3c77fd0b5332a0c9a7c8bb3d2",
    );
  });

  test("queries and normalizes governance events with log metadata", async () => {
    const requests: { eventName: string; address: Address | Address[]; fromBlock: bigint; toBlock?: bigint | "latest" }[] =
      [];
    const logsByEvent: Record<string, unknown[]> = {
      BoardroomLaunched: [
        rawLog({
          args: { executor, governanceDelay: 86_400n },
          blockNumber: 10n,
          logIndex: 1,
          transactionHash: txHash(1n),
        }),
      ],
      ExecutorSet: [
        rawLog({
          args: { executor: caller },
          blockNumber: 11n,
          logIndex: 2,
          transactionHash: txHash(2n),
        }),
      ],
      BoardroomActionQueued: [
        rawLog({
          args: { actionHash, executor, eta: 100_000n, salt },
          blockNumber: 12n,
          logIndex: 4,
          transactionHash: txHash(3n),
        }),
      ],
      BoardroomActionCancelled: [
        rawLog({
          args: { actionHash, caller },
          blockNumber: 12n,
          logIndex: 5,
          transactionHash: txHash(4n),
        }),
      ],
      BoardroomActionExecuted: [
        rawLog({
          args: { actionHash, caller: executor },
          blockNumber: 13n,
          logIndex: 0,
          transactionHash: txHash(5n),
        }),
      ],
      BoardroomCallExecuted: [
        rawLog({
          args: { policy, target, selector, value: 123n, dataHash },
          blockNumber: 12n,
          logIndex: 3,
          transactionHash: txHash(6n),
        }),
      ],
      BoardroomWindDownStarted: [
        rawLog({
          args: { owner },
          blockNumber: 14n,
          logIndex: 0,
          transactionHash: txHash(7n),
        }),
      ],
    };
    const client = {
      getLogs: async (input: {
        event: { name: string };
        address: Address | Address[];
        fromBlock: bigint;
        toBlock?: bigint | "latest";
      }) => {
        requests.push({
          eventName: input.event.name,
          address: input.address,
          fromBlock: input.fromBlock,
          toBlock: input.toBlock,
        });
        return logsByEvent[input.event.name] ?? [];
      },
    } as unknown as PledgeCashLogClient;

    const events = await queryGovernanceEvents(client, {
      boardrooms: [boardroom, secondBoardroom],
      fromBlock: 10n,
      toBlock: 20n,
    });

    expect(requests.map((request) => request.eventName)).toEqual([
      "BoardroomLaunched",
      "ExecutorSet",
      "BoardroomActionQueued",
      "BoardroomActionCancelled",
      "BoardroomActionExecuted",
      "BoardroomCallExecuted",
      "BoardroomWindDownStarted",
    ]);
    expect(requests.every((request) => request.fromBlock === 10n && request.toBlock === 20n)).toBe(true);
    expect(requests.every((request) => Array.isArray(request.address) && request.address.length === 2)).toBe(true);
    expect(events.map((event) => event.kind)).toEqual([
      "launched",
      "executorSet",
      "callExecuted",
      "actionQueued",
      "actionCancelled",
      "actionExecuted",
      "windDownStarted",
    ]);
    expect(events[0]).toEqual({
      kind: "launched",
      executor,
      governanceDelay: 86_400n,
      boardroom,
      blockNumber: 10n,
      logIndex: 1,
      transactionHash: txHash(1n),
    });
    expect(events[2]).toEqual({
      kind: "callExecuted",
      policy,
      target,
      selector,
      value: 123n,
      dataHash,
      boardroom,
      blockNumber: 12n,
      logIndex: 3,
      transactionHash: txHash(6n),
    });
  });
});

function rawLog(input: {
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
}) {
  return { address: boardroom, ...input };
}

function txHash(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}
