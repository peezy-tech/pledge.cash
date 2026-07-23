import { describe, expect, test } from "bun:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import {
  boardroomControllerAbi,
  decodeControllerScheduleCalldata,
  hashBoardroomCalls,
  hydrateScheduledBoardroomOperationCandidates,
  queryGovernanceEvents,
  queryScheduledBoardroomOperations,
  type BoardroomCall,
  type PledgeCashGovernanceClient,
  type PledgeCashLogClient,
} from "../src";

const boardroom = "0x0000000000000000000000000000000000000b0a" as Address;
const controller = "0x000000000000000000000000000000000000c011" as Address;
const proposer = "0x000000000000000000000000000000000000a11c" as Address;
const executor = "0x000000000000000000000000000000000000e111" as Address;
const policy = "0x0000000000000000000000000000000000000a55" as Address;
const target = "0x0000000000000000000000000000000000000aaa" as Address;
const salt = `0x${"11".repeat(32)}` as Hex;
const operationId = `0x${"22".repeat(32)}` as Hex;
const transactionHash = `0x${"33".repeat(32)}` as Hex;

const call = {
  policy,
  target,
  value: 7n,
  data: "0x12345678" as Hex,
} satisfies BoardroomCall;

const scheduleData = encodeFunctionData({
  abi: boardroomControllerAbi,
  functionName: "scheduleBoardroomOperation",
  args: [[call], salt, 3n, 1n],
});

describe("external Boardroom controller governance helpers", () => {
  test("decodes Boardroom and controller self-operation schedules without legacy queue aliases", () => {
    expect(decodeControllerScheduleCalldata(scheduleData)).toEqual({
      kind: "boardroomOperation",
      calls: [call],
      salt,
      expectedBoardroomEpoch: 3n,
      expectedConfigurationEpoch: 1n,
    });

    const updateData = encodeFunctionData({
      abi: boardroomControllerAbi,
      functionName: "updateConfiguration",
      args: [executor, 172_800n, 604_800n],
    });
    const controllerSchedule = encodeFunctionData({
      abi: boardroomControllerAbi,
      functionName: "scheduleControllerOperation",
      args: [updateData, salt, 3n, 1n],
    });
    expect(decodeControllerScheduleCalldata(controllerSchedule)).toEqual({
      kind: "controllerOperation",
      data: updateData,
      salt,
      expectedBoardroomEpoch: 3n,
      expectedConfigurationEpoch: 1n,
    });
    expect(decodeControllerScheduleCalldata("0x12345678")).toBeUndefined();
  });

  test("hashes the exact ABI-encoded BoardroomCall array", () => {
    expect(hashBoardroomCalls([call])).toBe(
      "0x23e332e2ca636e267a5001527b98eebd5255462ef6d627ec6c75b6f2f7e99dfa",
    );
  });

  test("queries Boardroom topology first and then controller operation events", async () => {
    const requests: Array<{ address: Address | Address[]; names: string[] }> = [];
    const client = {
      async getLogs(input: { address: Address | Address[]; events: readonly { name: string }[] }) {
        requests.push({ address: input.address, names: input.events.map((event) => event.name) });
        if (input.events.some((event) => event.name === "BoardroomLaunched")) {
          return [{
            address: boardroom,
            eventName: "BoardroomLaunched",
            args: launchArgs(),
            blockNumber: 10n,
            logIndex: 0,
            transactionHash,
          }];
        }
        return [{
          address: controller,
          eventName: "BoardroomOperationScheduled",
          args: scheduleArgs(),
          blockNumber: 11n,
          logIndex: 1,
          transactionHash,
        }];
      },
    } as unknown as PledgeCashLogClient;

    const events = await queryGovernanceEvents(client, {
      boardrooms: [boardroom],
      fromBlock: 1n,
      toBlock: 20n,
    });
    expect(requests).toHaveLength(2);
    expect(events.map((event) => event.kind)).toEqual(["launched", "boardroomOperationScheduled"]);
    expect(events[1]).toMatchObject({
      boardroom,
      controller,
      operationId,
      proposer,
      boardroomEpoch: 3n,
      controllerGeneration: 1n,
      configurationEpoch: 1n,
    });
  });

  test("hydrates a ready operation only when controller, epochs, event hashes, and calldata agree", async () => {
    const client = governanceClient();
    const operations = await queryScheduledBoardroomOperations(client, {
      boardrooms: [boardroom],
      fromBlock: 1n,
      toBlock: 20n,
      currentTime: 150n,
    });
    expect(operations).toEqual([{
      boardroom,
      controller,
      operationId,
      proposer,
      eta: 100n,
      expiresAt: 200n,
      boardroomEpoch: 3n,
      controllerGeneration: 1n,
      configurationEpoch: 1n,
      currentBoardroomEpoch: 3n,
      currentConfigurationEpoch: 1n,
      operationStatus: 1,
      salt,
      scheduleBlockNumber: 11n,
      scheduleTransactionHash: transactionHash,
      status: "ready",
      kind: "boardroomOperation",
      calls: [call],
    }]);
  });

  test("marks stale epochs invalidated and fails closed on mismatched candidate provenance", async () => {
    const stale = governanceClient({ boardroomEpoch: 4n });
    const [operation] = await queryScheduledBoardroomOperations(stale, {
      boardrooms: [boardroom],
      fromBlock: 1n,
      toBlock: 20n,
      currentTime: 150n,
    });
    expect(operation?.status).toBe("invalidated");

    const candidateClient = governanceClient({ transactionTarget: target });
    const result = await hydrateScheduledBoardroomOperationCandidates(candidateClient, {
      candidates: [{ boardroom, controller, operationId, scheduleTransactionHash: transactionHash, scheduleBlockNumber: 11n }],
      currentTime: 150n,
    });
    expect(result.operations).toEqual([]);
    expect(result.errors[0]?.message).toBe("Schedule transaction does not directly target the controller.");
  });

  test("hydrates a candidate only from a successful receipt containing its exact controller event", async () => {
    const result = await hydrateScheduledBoardroomOperationCandidates(governanceClient(), {
      candidates: [{ boardroom, controller, operationId, scheduleTransactionHash: transactionHash, scheduleBlockNumber: 11n }],
      currentTime: 150n,
    });
    expect(result.errors).toEqual([]);
    expect(result.operations[0]).toMatchObject({ operationId, controller, status: "ready", calls: [call] });
  });
});

function governanceClient(overrides: { boardroomEpoch?: bigint; transactionTarget?: Address } = {}): PledgeCashGovernanceClient {
  return {
    async getLogs(input: { events: readonly { name: string }[] }) {
      if (input.events.some((event) => event.name === "BoardroomLaunched")) {
        return [{
          address: boardroom,
          eventName: "BoardroomLaunched",
          args: launchArgs(),
          blockNumber: 10n,
          logIndex: 0,
          transactionHash,
        }] as never;
      }
      return [{
        address: controller,
        eventName: "BoardroomOperationScheduled",
        args: scheduleArgs(),
        blockNumber: 11n,
        logIndex: 1,
        transactionHash,
      }] as never;
    },
    async getTransaction() {
      return {
        blockNumber: 11n,
        from: proposer,
        hash: transactionHash,
        input: scheduleData,
        to: overrides.transactionTarget ?? controller,
      } as never;
    },
    async getTransactionReceipt() {
      return scheduleReceipt() as never;
    },
    async readContract(parameters: { address: Address; functionName: string }) {
      switch (parameters.functionName) {
        case "launched": return true;
        case "controller": return controller;
        case "hashBoardroomOperation": return operationId;
        case "operationState": return [100n, 200n, 1];
        case "governanceEpoch": return overrides.boardroomEpoch ?? 3n;
        case "controllerGeneration": return 1n;
        case "status": return 0;
        case "configurationEpoch": return 1n;
        case "proposer": return proposer;
        default: throw new Error(`Unexpected read: ${parameters.functionName}`);
      }
    },
  } as unknown as PledgeCashGovernanceClient;
}

function launchArgs() {
  return {
    controller,
    proposer,
    protectionStaker: proposer,
    controllerGeneration: 1n,
    controllerDelay: 86_400n,
    windDownDelay: 172_800n,
    gracePeriod: 604_800n,
  };
}

function scheduleArgs() {
  return {
    operationId,
    proposer,
    eta: 100n,
    expiresAt: 200n,
    boardroomEpoch: 3n,
    controllerGeneration: 1n,
    configurationEpoch: 1n,
    salt,
    callsHash: hashBoardroomCalls([call]),
  };
}

function scheduleReceipt() {
  const topics = encodeEventTopics({
    abi: boardroomControllerAbi,
    eventName: "BoardroomOperationScheduled",
    args: { operationId, proposer },
  });
  const data = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "bytes32" },
    ],
    [100n, 200n, 3n, 1n, 1n, salt, hashBoardroomCalls([call])],
  );
  return {
    blockNumber: 11n,
    logs: [{ address: controller, data, topics }],
    status: "success" as const,
    transactionHash,
  };
}
