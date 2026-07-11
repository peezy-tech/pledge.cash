import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, type Address, type Hex } from "viem";
import {
  boardroomAbi,
  decodeQueueCalldata,
  hashAction,
  hashBatch,
  hashCall,
  hydrateQueuedBoardroomActionCandidates,
  queryGovernanceEvents,
  queryQueuedBoardroomActions,
  type BoardroomCall,
  type PledgeCashGovernanceClient,
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
    const requests: { eventNames: string[]; address: Address | Address[]; fromBlock: bigint; toBlock?: bigint | "latest" }[] =
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
          args: { actionHash, executor, eta: 100_000n, expiresAt: 704_800n, epoch: 3n, salt },
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
      GovernanceEpochAdvanced: [
        rawLog({
          args: { epoch: 3n },
          blockNumber: 12n,
          logIndex: 2,
          transactionHash: txHash(8n),
        }),
      ],
      BoardroomWindDownStarted: [
        rawLog({
          args: { caller: owner },
          blockNumber: 14n,
          logIndex: 0,
          transactionHash: txHash(7n),
        }),
      ],
    };
    const client = {
      getLogs: async (input: {
        events: readonly { name: string }[];
        address: Address | Address[];
        fromBlock: bigint;
        toBlock?: bigint | "latest";
      }) => {
        requests.push({
          eventNames: input.events.map((event) => event.name),
          address: input.address,
          fromBlock: input.fromBlock,
          toBlock: input.toBlock,
        });
        return input.events.flatMap((event) =>
          (logsByEvent[event.name] ?? []).map((log) => ({ ...(log as object), eventName: event.name }))
        );
      },
    } as unknown as PledgeCashLogClient;

    const events = await queryGovernanceEvents(client, {
      boardrooms: [boardroom, secondBoardroom],
      fromBlock: 10n,
      toBlock: 20n,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.eventNames).toEqual([
      "BoardroomLaunched",
      "ExecutorSet",
      "BoardroomActionQueued",
      "BoardroomActionCancelled",
      "BoardroomActionExecuted",
      "BoardroomCallExecuted",
      "GovernanceEpochAdvanced",
      "BoardroomWindDownStarted",
    ]);
    expect(requests.every((request) => request.fromBlock === 10n && request.toBlock === 20n)).toBe(true);
    expect(requests.every((request) => Array.isArray(request.address) && request.address.length === 2)).toBe(true);
    expect(events.map((event) => event.kind)).toEqual([
      "launched",
      "executorSet",
      "governanceEpochAdvanced",
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
      kind: "governanceEpochAdvanced",
      epoch: 3n,
      boardroom,
      blockNumber: 12n,
      logIndex: 2,
      transactionHash: txHash(8n),
    });
    expect(events[3]).toEqual({
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
    expect(events[4]).toEqual({
      kind: "actionQueued",
      actionHash,
      executor,
      eta: 100_000n,
      expiresAt: 704_800n,
      epoch: 3n,
      salt,
      boardroom,
      blockNumber: 12n,
      logIndex: 4,
      transactionHash: txHash(3n),
    });
  });

  test("hydrates a ready queued action from direct transaction calldata", async () => {
    const queuedHash = hashAction(call, salt);
    const queueData = encodeFunctionData({ abi: boardroomAbi, functionName: "queueAction", args: [call, salt] });
    const logsByEvent: Record<string, unknown[]> = {
      BoardroomActionQueued: [
        rawLog({
          args: { actionHash: queuedHash, executor, eta: 100n, expiresAt: 200n, epoch: 3n, salt },
          blockNumber: 12n,
          logIndex: 1,
          transactionHash: txHash(20n),
        }),
      ],
    };
    const client = {
      async getLogs(input: { events: readonly { name: string }[] }) {
        return input.events.flatMap((event) =>
          (logsByEvent[event.name] ?? []).map((log) => ({ ...(log as object), eventName: event.name }))
        );
      },
      async getTransaction() {
        return { to: boardroom, input: queueData };
      },
      async readContract(request: { functionName: string }) {
        if (request.functionName === "launched") return true;
        return [3n, 100n, 200n, 3n, 0];
      },
    } as unknown as PledgeCashGovernanceClient;

    await expect(
      queryQueuedBoardroomActions(client, { boardrooms: [boardroom], fromBlock: 10n, toBlock: 20n, currentTime: 150n }),
    ).resolves.toEqual([
      {
        boardroom,
        actionHash: queuedHash,
        executor,
        eta: 100n,
        expiresAt: 200n,
        epoch: 3n,
        currentEpoch: 3n,
        actionStatus: 0,
        salt,
        queueBlockNumber: 12n,
        queueTransactionHash: txHash(20n),
        status: "ready",
        kind: "queueAction",
        calls: [call],
      },
    ]);
  });

  test("hydrates a verified queued-action candidate from its transaction and live state", async () => {
    const queuedHash = hashAction(call, salt);
    const queueData = encodeFunctionData({ abi: boardroomAbi, functionName: "queueAction", args: [call, salt] });
    const transactionHash = txHash(30n);
    const client = {
      async getTransaction() {
        return { blockNumber: 12n, from: executor, hash: transactionHash, input: queueData, to: boardroom };
      },
      async getTransactionReceipt() {
        return queueReceipt({ actionHash: queuedHash, transactionHash });
      },
      async readContract() {
        return [3n, 100n, 200n, 3n, 0];
      },
    } as unknown as PledgeCashGovernanceClient;

    const result = await hydrateQueuedBoardroomActionCandidates(client, {
      candidates: [{ boardroom, actionHash: queuedHash, queueTransactionHash: transactionHash }],
      currentTime: 150n,
    });

    expect(result.errors).toEqual([]);
    expect(result.actions).toEqual([{
      boardroom,
      actionHash: queuedHash,
      executor,
      eta: 100n,
      expiresAt: 200n,
      epoch: 3n,
      currentEpoch: 3n,
      actionStatus: 0,
      salt,
      queueBlockNumber: 12n,
      queueTransactionHash: transactionHash,
      status: "ready",
      kind: "queueAction",
      calls: [call],
    }]);
  });

  test("rejects a candidate whose transaction calldata hashes to another action", async () => {
    const queuedHash = hashAction(call, salt);
    const queueData = encodeFunctionData({ abi: boardroomAbi, functionName: "queueAction", args: [call, salt] });
    const transactionHash = txHash(31n);
    let stateReads = 0;
    const client = {
      async getTransaction() {
        return { blockNumber: 12n, from: executor, hash: transactionHash, input: queueData, to: boardroom };
      },
      async getTransactionReceipt() {
        return queueReceipt({ actionHash: queuedHash, transactionHash });
      },
      async readContract() {
        stateReads += 1;
        return [3n, 100n, 200n, 3n, 0];
      },
    } as unknown as PledgeCashGovernanceClient;

    const result = await hydrateQueuedBoardroomActionCandidates(client, {
      candidates: [{ boardroom, actionHash, queueTransactionHash: transactionHash }],
      currentTime: 150n,
    });

    expect(result.actions).toEqual([]);
    expect(result.errors).toEqual([{
      boardroom,
      actionHash,
      message: "Queue calldata does not match the action hash.",
    }]);
    expect(stateReads).toBe(0);
  });

  test("rejects unmined or mismatched candidate transaction provenance before state hydration", async () => {
    const queuedHash = hashAction(call, salt);
    const queueData = encodeFunctionData({ abi: boardroomAbi, functionName: "queueAction", args: [call, salt] });
    const transactionHash = txHash(38n);
    const baseReceipt = queueReceipt({ actionHash: queuedHash, transactionHash });
    const cases = [
      {
        label: "returned transaction hash",
        message: "RPC returned a different queue transaction hash.",
        transaction: { blockNumber: 12n, from: executor, hash: txHash(999n), input: queueData, to: boardroom },
        receipt: baseReceipt,
        queueBlockNumber: 12n,
      },
      {
        label: "candidate block",
        message: "Candidate queue block does not match the mined transaction.",
        transaction: { blockNumber: 12n, from: executor, hash: transactionHash, input: queueData, to: boardroom },
        receipt: baseReceipt,
        queueBlockNumber: 13n,
      },
      {
        label: "reverted receipt",
        message: "Queue transaction reverted.",
        transaction: { blockNumber: 12n, from: executor, hash: transactionHash, input: queueData, to: boardroom },
        receipt: { ...baseReceipt, status: "reverted" as const },
        queueBlockNumber: 12n,
      },
      {
        label: "receipt block",
        message: "Receipt block does not match the queue transaction block.",
        transaction: { blockNumber: 12n, from: executor, hash: transactionHash, input: queueData, to: boardroom },
        receipt: { ...baseReceipt, blockNumber: 13n },
        queueBlockNumber: 12n,
      },
      {
        label: "missing queue event",
        message: "Queue receipt does not contain the matching Boardroom event.",
        transaction: { blockNumber: 12n, from: executor, hash: transactionHash, input: queueData, to: boardroom },
        receipt: { ...baseReceipt, logs: [] },
        queueBlockNumber: 12n,
      },
    ];

    for (const scenario of cases) {
      let stateReads = 0;
      const client = {
        async getTransaction() { return scenario.transaction; },
        async getTransactionReceipt() { return scenario.receipt; },
        async readContract() {
          stateReads += 1;
          return [3n, 100n, 200n, 3n, 0];
        },
      } as unknown as PledgeCashGovernanceClient;

      const result = await hydrateQueuedBoardroomActionCandidates(client, {
        candidates: [{
          boardroom,
          actionHash: queuedHash,
          queueBlockNumber: scenario.queueBlockNumber,
          queueTransactionHash: transactionHash,
        }],
        currentTime: 150n,
      });

      expect(result.actions, scenario.label).toEqual([]);
      expect(result.errors[0]?.message, scenario.label).toBe(scenario.message);
      expect(stateReads, scenario.label).toBe(0);
    }
  });

  test("omits a candidate after its onchain action context was deleted", async () => {
    const queuedHash = hashAction(call, salt);
    const queueData = encodeFunctionData({ abi: boardroomAbi, functionName: "queueAction", args: [call, salt] });
    const transactionHash = txHash(32n);
    const client = {
      async getTransaction() {
        return { blockNumber: 12n, from: executor, hash: transactionHash, input: queueData, to: boardroom };
      },
      async getTransactionReceipt() {
        return queueReceipt({ actionHash: queuedHash, transactionHash });
      },
      async readContract() {
        return [3n, 0n, 0n, 0n, 0];
      },
    } as unknown as PledgeCashGovernanceClient;

    await expect(hydrateQueuedBoardroomActionCandidates(client, {
      candidates: [{ boardroom, actionHash: queuedHash, queueTransactionHash: transactionHash }],
    })).resolves.toEqual({ actions: [], errors: [] });
  });

  test("preserves valid candidates when another candidate fails verification", async () => {
    const queuedHash = hashAction(call, salt);
    const queueData = encodeFunctionData({ abi: boardroomAbi, functionName: "queueAction", args: [call, salt] });
    const client = {
      async getTransaction(input: { hash: Hex }) {
        return { blockNumber: 12n, from: executor, hash: input.hash, input: queueData, to: boardroom };
      },
      async getTransactionReceipt(input: { hash: Hex }) {
        return queueReceipt({ actionHash: queuedHash, transactionHash: input.hash });
      },
      async readContract() {
        return [3n, 100n, 200n, 3n, 0];
      },
    } as unknown as PledgeCashGovernanceClient;

    const result = await hydrateQueuedBoardroomActionCandidates(client, {
      candidates: [
        { boardroom, actionHash: queuedHash, queueTransactionHash: txHash(33n) },
        { boardroom, actionHash, queueTransactionHash: txHash(34n) },
      ],
      currentTime: 150n,
    });

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.actionHash).toBe(queuedHash);
    expect(result.errors).toEqual([{
      boardroom,
      actionHash,
      message: "Queue calldata does not match the action hash.",
    }]);
  });

  test("deduplicates exact candidates before hydration", async () => {
    const queuedHash = hashAction(call, salt);
    const queueData = encodeFunctionData({ abi: boardroomAbi, functionName: "queueAction", args: [call, salt] });
    const transactionHash = txHash(35n);
    let transactionReads = 0;
    const client = {
      async getTransaction() {
        transactionReads += 1;
        return { blockNumber: 12n, from: executor, hash: transactionHash, input: queueData, to: boardroom };
      },
      async getTransactionReceipt() {
        return queueReceipt({ actionHash: queuedHash, transactionHash });
      },
      async readContract() {
        return [3n, 100n, 200n, 3n, 0];
      },
    } as unknown as PledgeCashGovernanceClient;
    const candidate = { boardroom, actionHash: queuedHash, queueBlockNumber: 12n, queueTransactionHash: transactionHash };

    const result = await hydrateQueuedBoardroomActionCandidates(client, {
      candidates: [candidate, candidate],
      currentTime: 150n,
    });

    expect(result.actions).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(transactionReads).toBe(1);
  });

  test("reports conflicting queue transactions for the same action without hydrating either", async () => {
    const queuedHash = hashAction(call, salt);
    let rpcCalls = 0;
    const client = {
      async getTransaction() { rpcCalls += 1; },
      async getTransactionReceipt() { rpcCalls += 1; },
      async readContract() { rpcCalls += 1; },
    } as unknown as PledgeCashGovernanceClient;

    const result = await hydrateQueuedBoardroomActionCandidates(client, {
      candidates: [
        { boardroom, actionHash: queuedHash, queueBlockNumber: 12n, queueTransactionHash: txHash(36n) },
        { boardroom, actionHash: queuedHash, queueBlockNumber: 13n, queueTransactionHash: txHash(37n) },
      ],
    });

    expect(result.actions).toEqual([]);
    expect(result.errors).toEqual([{
      boardroom,
      actionHash: queuedHash,
      message: "Conflicting queue candidates were returned for this action.",
    }]);
    expect(rpcCalls).toBe(0);
  });

  test("rejects pre-aborted candidate hydration before starting RPC work", async () => {
    const controller = new AbortController();
    const reason = new Error("superseded governance load");
    controller.abort(reason);
    let rpcCalls = 0;
    const client = {
      async getTransaction() { rpcCalls += 1; },
      async getTransactionReceipt() { rpcCalls += 1; },
      async readContract() { rpcCalls += 1; },
    } as unknown as PledgeCashGovernanceClient;

    let thrown: unknown;
    try {
      await hydrateQueuedBoardroomActionCandidates(client, { candidates: [], signal: controller.signal });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(reason);
    expect(rpcCalls).toBe(0);
  });

  test("stops candidate hydration before a second concurrency batch after abort", async () => {
    const controller = new AbortController();
    const reason = new Error("route changed");
    const queueData = encodeFunctionData({ abi: boardroomAbi, functionName: "queueAction", args: [call, salt] });
    let transactionReads = 0;
    let stateReads = 0;
    const client = {
      async getTransaction(input: { hash: Hex }) {
        transactionReads += 1;
        if (transactionReads === 8) controller.abort(reason);
        return { blockNumber: 12n, from: executor, hash: input.hash, input: queueData, to: boardroom };
      },
      async getTransactionReceipt(input: { hash: Hex }) {
        return { blockNumber: 12n, logs: [], status: "success" as const, transactionHash: input.hash };
      },
      async readContract() {
        stateReads += 1;
        return [3n, 100n, 200n, 3n, 0];
      },
    } as unknown as PledgeCashGovernanceClient;
    const candidates = Array.from({ length: 16 }, (_, index) => ({
      boardroom,
      actionHash: txHash(BigInt(index + 100)),
      queueTransactionHash: txHash(BigInt(index + 200)),
    }));

    let thrown: unknown;
    try {
      await hydrateQueuedBoardroomActionCandidates(client, { candidates, signal: controller.signal });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(reason);
    expect(transactionReads).toBe(8);
    expect(stateReads).toBe(0);
  });

  test("adaptively chunks queued-action history on range-limited providers", async () => {
    const queuedHash = hashAction(call, salt);
    const queueData = encodeFunctionData({ abi: boardroomAbi, functionName: "queueAction", args: [call, salt] });
    const requests: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
    const successfulRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
    const client = {
      async getBlockNumber() {
        return 4_999n;
      },
      async getLogs(input: {
        event?: { name: string } | undefined;
        events?: readonly { name: string }[] | undefined;
        fromBlock: bigint;
        toBlock: bigint;
      }) {
        requests.push({ fromBlock: input.fromBlock, toBlock: input.toBlock });
        if (input.toBlock - input.fromBlock + 1n > 1_000n) {
          throw new Error("eth_getLogs is limited to a 1000 range");
        }
        successfulRanges.push({ fromBlock: input.fromBlock, toBlock: input.toBlock });
        if (input.event) {
          return input.fromBlock <= 100n && input.toBlock >= 100n
            ? [{
                ...rawLog({
                  args: { executor, governanceDelay: 86_400n },
                  blockNumber: 100n,
                  logIndex: 0,
                  transactionHash: txHash(19n),
                }),
                eventName: "BoardroomLaunched",
              }]
            : [];
        }
        if (input.fromBlock <= 3_500n && input.toBlock >= 3_500n) {
          expect(input.events?.map((event) => event.name)).toContain("BoardroomActionQueued");
          return [{
            ...rawLog({
              args: { actionHash: queuedHash, executor, eta: 100n, expiresAt: 200n, epoch: 3n, salt },
              blockNumber: 3_500n,
              logIndex: 1,
              transactionHash: txHash(21n),
            }),
            eventName: "BoardroomActionQueued",
          }];
        }
        return [];
      },
      async getTransaction() {
        return { to: boardroom, input: queueData };
      },
      async readContract(request: { functionName: string }) {
        if (request.functionName === "launched") return true;
        return [3n, 100n, 200n, 3n, 0];
      },
    } as unknown as PledgeCashGovernanceClient;

    const actions = await queryQueuedBoardroomActions(client, {
      boardrooms: [boardroom],
      chunkSize: 5_000n,
      currentTime: 150n,
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ actionHash: queuedHash, queueBlockNumber: 3_500n, status: "ready" });
    expect(requests.length).toBeGreaterThan(successfulRanges.length);
    expect(successfulRanges.every(({ fromBlock, toBlock }) => toBlock - fromBlock + 1n <= 1_000n)).toBe(true);
  });

  test("finds and caches the Boardroom start block before scanning a live-height range", async () => {
    const deploymentBlock = 58_200_000n;
    const headBlock = 58_521_685n;
    let codeReads = 0;
    const attemptedRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
    const successfulRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
    const client = {
      async getBlockNumber() {
        return headBlock;
      },
      async getCode(input: { blockNumber: bigint }) {
        codeReads += 1;
        return input.blockNumber >= deploymentBlock ? "0x6000" : "0x";
      },
      async getLogs(input: { fromBlock: bigint; toBlock: bigint }) {
        attemptedRanges.push({ fromBlock: input.fromBlock, toBlock: input.toBlock });
        if (input.toBlock - input.fromBlock + 1n > 25_000n) {
          throw new Error("requested block range exceeds provider maximum");
        }
        successfulRanges.push({ fromBlock: input.fromBlock, toBlock: input.toBlock });
        return input.fromBlock <= deploymentBlock && input.toBlock >= deploymentBlock
          ? [{
              ...rawLog({
                args: { executor, governanceDelay: 86_400n },
                blockNumber: deploymentBlock,
                logIndex: 0,
                transactionHash: txHash(99n),
              }),
              eventName: "BoardroomLaunched",
            }]
          : [];
      },
    } as unknown as PledgeCashLogClient;

    const events = await queryGovernanceEvents(client, { boardrooms: [boardroom] });
    const codeReadsAfterFirstScan = codeReads;
    await queryGovernanceEvents(client, { boardrooms: [boardroom] });

    expect(events.map((event) => event.kind)).toEqual(["launched"]);
    expect(codeReadsAfterFirstScan).toBeGreaterThan(1);
    expect(codeReadsAfterFirstScan).toBeLessThanOrEqual(64);
    expect(codeReads).toBe(codeReadsAfterFirstScan);
    expect(attemptedRanges.every(({ fromBlock }) => fromBlock >= deploymentBlock)).toBe(true);
    expect(successfulRanges.every(({ fromBlock, toBlock }) => toBlock - fromBlock + 1n <= 25_000n)).toBe(true);
  });

  test("does not let the first caller's abort signal poison the shared start-block cache", async () => {
    const deploymentBlock = 700n;
    const headBlock = 1_000n;
    const firstController = new AbortController();
    const abortReason = new Error("first route was abandoned");
    let releaseLatestCode!: () => void;
    const latestCodeGate = new Promise<void>((resolve) => {
      releaseLatestCode = resolve;
    });
    let latestCodeReads = 0;
    const logRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
    const client = {
      async getCode(input: { blockNumber: bigint }) {
        if (input.blockNumber === headBlock) {
          latestCodeReads += 1;
          if (latestCodeReads === 1) await latestCodeGate;
        }
        return input.blockNumber >= deploymentBlock ? "0x6000" : "0x";
      },
      async getLogs(input: { fromBlock: bigint; toBlock: bigint }) {
        logRanges.push({ fromBlock: input.fromBlock, toBlock: input.toBlock });
        return [];
      },
    } as unknown as PledgeCashLogClient;

    const first = queryGovernanceEvents(client, {
      boardrooms: [secondBoardroom],
      signal: firstController.signal,
      toBlock: headBlock,
    });
    await Promise.resolve();
    const second = queryGovernanceEvents(client, { boardrooms: [secondBoardroom], toBlock: headBlock });
    firstController.abort(abortReason);

    await expect(first).rejects.toBe(abortReason);
    releaseLatestCode();
    await expect(second).resolves.toEqual([]);

    expect(latestCodeReads).toBe(1);
    expect(logRanges).toEqual([{ fromBlock: deploymentBlock, toBlock: headBlock }]);
  });

  test("falls back to the launch event when historical contract code is pruned", async () => {
    const launchBlock = 43_800_000n;
    const headBlock = 43_841_919n;
    const launchSearchRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
    const eventRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
    const client = {
      async getBlockNumber() {
        return headBlock;
      },
      async getCode(input: { blockNumber: bigint }) {
        if (input.blockNumber === headBlock) return "0x6000";
        throw new Error("historical state for this block is not available");
      },
      async getLogs(input: {
        event?: { name: string } | undefined;
        events?: readonly { name: string }[] | undefined;
        fromBlock: bigint;
        toBlock: bigint;
      }) {
        const ranges = input.event ? launchSearchRanges : eventRanges;
        ranges.push({ fromBlock: input.fromBlock, toBlock: input.toBlock });
        if (input.fromBlock > launchBlock || input.toBlock < launchBlock) return [];
        return [{
          ...rawLog({
            args: { executor, governanceDelay: 86_400n },
            blockNumber: launchBlock,
            logIndex: 0,
            transactionHash: txHash(100n),
          }),
          eventName: "BoardroomLaunched",
        }];
      },
    } as unknown as PledgeCashLogClient;

    const events = await queryGovernanceEvents(client, { boardrooms: [boardroom] });

    expect(events.map((event) => event.kind)).toEqual(["launched"]);
    expect(launchSearchRanges).toHaveLength(1);
    expect(eventRanges).toEqual([{ fromBlock: launchBlock, toBlock: headBlock }]);
    expect([...launchSearchRanges, ...eventRanges].every(({ fromBlock }) => fromBlock > 0n)).toBe(true);
  });

  test("skips governance history entirely for an unlaunched Boardroom", async () => {
    let historyCalls = 0;
    const client = {
      async getBlockNumber() {
        historyCalls += 1;
        return 1_000_000n;
      },
      async getLogs() {
        historyCalls += 1;
        return [];
      },
      async getTransaction() {
        historyCalls += 1;
        throw new Error("should not hydrate");
      },
      async readContract(request: { functionName: string }) {
        if (request.functionName === "launched") return false;
        historyCalls += 1;
        throw new Error("should not hydrate");
      },
    } as unknown as PledgeCashGovernanceClient;

    await expect(queryQueuedBoardroomActions(client, { boardrooms: [boardroom] })).resolves.toEqual([]);
    expect(historyCalls).toBe(0);
  });

  test("rejects oversized Boardroom sets before contract-start or log RPCs", async () => {
    let rpcCalls = 0;
    const client = {
      async getCode() {
        rpcCalls += 1;
        return "0x6000";
      },
      async getLogs() {
        rpcCalls += 1;
        return [];
      },
    } as unknown as PledgeCashLogClient;

    await expect(queryGovernanceEvents(client, {
      boardrooms: Array.from({ length: 65 }, (_, index) => addressValue(BigInt(index + 1))),
      toBlock: 100n,
    })).rejects.toThrow("Governance event scan exceeds its 64-Boardroom safety bound.");
    expect(rpcCalls).toBe(0);
  });

  test("does not recursively amplify generic or throttled governance log failures", async () => {
    for (const message of ["provider unavailable", "rate limit exceeded while querying this block range"]) {
      let calls = 0;
      const client = {
        async getLogs() {
          calls += 1;
          throw new Error(message);
        },
      } as unknown as PledgeCashLogClient;

      await expect(queryGovernanceEvents(client, {
        boardrooms: [boardroom],
        chunkSize: 5_000n,
        fromBlock: 0n,
        toBlock: 4_999n,
      })).rejects.toThrow(message);
      expect(calls).toBe(1);
    }
  });

  test("aborts a governance log scan before starting the next page", async () => {
    const controller = new AbortController();
    const reason = new Error("tail scan superseded");
    let calls = 0;
    const client = {
      async getLogs() {
        calls += 1;
        controller.abort(reason);
        return [];
      },
    } as unknown as PledgeCashLogClient;

    let thrown: unknown;
    try {
      await queryGovernanceEvents(client, {
        boardrooms: [boardroom],
        chunkSize: 100n,
        fromBlock: 0n,
        signal: controller.signal,
        toBlock: 199n,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(reason);
    expect(calls).toBe(1);
  });

  test("bounds unresolved action hydration without counting expired history", async () => {
    let hydrationReads = 0;
    const client = {
      async getLogs() {
        return Array.from({ length: 501 }, (_, index) => ({
          ...rawLog({
            args: {
              actionHash: txHash(BigInt(index + 1)),
              executor,
              eta: 100n,
              expiresAt: 200n,
              epoch: 3n,
              salt,
            },
            blockNumber: BigInt(index + 1),
            logIndex: 0,
            transactionHash: txHash(BigInt(index + 1_000)),
          }),
          eventName: "BoardroomActionQueued",
        }));
      },
      async getTransaction() {
        hydrationReads += 1;
        throw new Error("should not hydrate");
      },
      async readContract(request: { functionName: string }) {
        if (request.functionName === "launched") return true;
        hydrationReads += 1;
        return [3n, 100n, 200n, 3n, 0];
      },
    } as unknown as PledgeCashGovernanceClient;

    await expect(queryQueuedBoardroomActions(client, {
      boardrooms: [boardroom],
      currentTime: 201n,
      fromBlock: 0n,
      toBlock: 1_000n,
    })).resolves.toEqual([]);
    await expect(queryQueuedBoardroomActions(client, {
      boardrooms: [boardroom],
      currentTime: 150n,
      fromBlock: 0n,
      toBlock: 1_000n,
    })).rejects.toThrow("Governance queue exceeds its 500-action hydration safety bound.");
    expect(hydrationReads).toBe(0);
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

function addressValue(value: bigint): Address {
  return `0x${value.toString(16).padStart(40, "0")}` as Address;
}

function queueReceipt(input: {
  actionHash: Hex;
  transactionHash: Hex;
  blockNumber?: bigint;
  eta?: bigint;
  expiresAt?: bigint;
  epoch?: bigint;
}) {
  const blockNumber = input.blockNumber ?? 12n;
  const eta = input.eta ?? 100n;
  const expiresAt = input.expiresAt ?? 200n;
  const epoch = input.epoch ?? 3n;
  return {
    blockNumber,
    logs: [{
      address: boardroom,
      data: encodeAbiParameters(
        [
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "bytes32" },
        ],
        [eta, expiresAt, epoch, salt],
      ),
      topics: encodeEventTopics({
        abi: boardroomAbi,
        eventName: "BoardroomActionQueued",
        args: { actionHash: input.actionHash, executor },
      }),
    }],
    status: "success" as const,
    transactionHash: input.transactionHash,
  };
}
