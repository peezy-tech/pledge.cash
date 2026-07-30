import { describe, expect, test } from "bun:test";

import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  type Address,
  type Hex
} from "viem";

import {
  boardroomAbi,
  boardroomControllerAbi,
  type BoardroomCall,
  type DiscoveredBoardroom
} from "@pledge.cash/sdk";

import type { ScheduledOperationRow, StoredCall } from "../src/types";
import {
  decodeScheduledOperationCalldata,
  runWatcherOnce,
  type InsertActionCallInput,
  type InsertPolicyAdminEventInput,
  type InsertScheduledOperationInput,
  type WatcherBoardroom,
  type WatcherClient,
  type WatcherPipelineEvent,
  type WatcherStore,
  type WatcherStoreTx
} from "../src/chain/watcher";
import type { ShareBalanceDeltaInput } from "../src/chain/holders";
import type { WatcherCursorScope } from "../src/chain/cursor";
import type {
  BoardroomMarketStateUpdate,
  MarketLifecycleEvent
} from "../src/chain/market-events";

const chainId = 31337;
const factory = address("fac");
const boardroom = address("b0a4d");
const shareToken = address("51a4e");
const owner = address("01");
const controller = address("c011");
const nextController = address("c022");
const proposer = owner;
const holder = address("02");
const policy = address("0a55");
const target = address("0b0b");
const assetPolicy = address("a55e7");
const policyRegistry = address("f09");
const salt = bytes32("01");
const scheduleTx = bytes32("100");
const cancelTx = bytes32("101");
const adminTx = bytes32("102");
const invalidationTx = bytes32("103");
const facetSetHash = bytes32("fac37");

const call: BoardroomCall = {
  data: encodeFunctionData({
    abi: boardroomAbi,
    functionName: "mint",
    args: [facetSetHash, address("eeee"), 1n]
  }),
  policy,
  target,
  value: 0n
};
const boardroomEpoch = 1n;
const configurationEpoch = 1n;
const controllerGeneration = 1n;
const callsHash = keccak256(encodeAbiParameters(
  [{
    type: "tuple[]",
    components: [
      { name: "policy", type: "address" },
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" }
    ]
  }],
  [[call]]
));
const operationId = bytes32("a11");
const scheduleInput = encodeFunctionData({
  abi: boardroomControllerAbi,
  functionName: "scheduleBoardroomOperation",
  args: [facetSetHash, [call], salt, boardroomEpoch, configurationEpoch]
});
const safeExecTransactionAbi = parseAbi([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool success)"
]);

describe("decodeScheduledOperationCalldata", () => {
  test("accepts selector-scanned calldata only when hash parity matches", () => {
    const scanned = `0xdeadbeef${scheduleInput.slice(2)}` as Hex;

    const decoded = decodeScheduledOperationCalldata({
      controller,
      expectedBoardroomEpoch: boardroomEpoch,
      expectedConfigurationEpoch: configurationEpoch,
      expectedFacetSetHash: facetSetHash,
      expectedPayloadHash: callsHash,
      expectedSalt: salt,
      operationKind: "boardroom",
      txInput: scanned
    });

    expect(decoded.decodeStatus).toBe("decoded");
    expect(decoded.calls[0]).toMatchObject({
      data: call.data,
      policy: call.policy,
      value: call.value
    });
    expect(decoded.calls[0]?.target.toLowerCase()).toBe(call.target);

    expect(
      decodeScheduledOperationCalldata({
        controller,
        expectedBoardroomEpoch: boardroomEpoch,
        expectedConfigurationEpoch: configurationEpoch,
        expectedFacetSetHash: facetSetHash,
        expectedPayloadHash: bytes32("999"),
        expectedSalt: salt,
        operationKind: "boardroom",
        txInput: scanned
      }).decodeStatus
    ).toBe("undecoded");

    expect(
      decodeScheduledOperationCalldata({
        controller,
        expectedBoardroomEpoch: boardroomEpoch,
        expectedConfigurationEpoch: configurationEpoch,
        expectedFacetSetHash: bytes32("bad"),
        expectedPayloadHash: callsHash,
        expectedSalt: salt,
        operationKind: "boardroom",
        txInput: scanned
      }).decodeStatus
    ).toBe("undecoded");
  });

  test("unwraps Safe execTransaction calldata before verifying hash parity", () => {
    const wrapped = encodeFunctionData({
      abi: safeExecTransactionAbi,
      functionName: "execTransaction",
      args: [controller, 0n, scheduleInput, 0, 0n, 0n, 0n, address("0"), address("0"), "0x"]
    });

    const decoded = decodeScheduledOperationCalldata({
      controller,
      expectedBoardroomEpoch: boardroomEpoch,
      expectedConfigurationEpoch: configurationEpoch,
      expectedFacetSetHash: facetSetHash,
      expectedPayloadHash: callsHash,
      expectedSalt: salt,
      operationKind: "boardroom",
      txInput: wrapped
    });

    expect(decoded.decodeStatus).toBe("decoded");
    expect(decoded.calls[0]?.policy.toLowerCase()).toBe(call.policy);
  });

  test("decodes controller self-governance without treating the permissionless executor as authority", () => {
    const data = encodeFunctionData({
      abi: boardroomControllerAbi,
      functionName: "updateConfiguration",
      args: [holder, 172_800n, 604_800n]
    });
    const input = encodeFunctionData({
      abi: boardroomControllerAbi,
      functionName: "scheduleControllerOperation",
      args: [facetSetHash, data, salt, boardroomEpoch, configurationEpoch]
    });

    const decoded = decodeScheduledOperationCalldata({
      controller,
      expectedBoardroomEpoch: boardroomEpoch,
      expectedConfigurationEpoch: configurationEpoch,
      expectedFacetSetHash: facetSetHash,
      expectedPayloadHash: keccak256(data),
      expectedSalt: salt,
      operationKind: "controller",
      txInput: input
    });

    expect(decoded).toMatchObject({ decodeStatus: "decoded", input: { kind: "controller", data } });
    expect(decoded.calls).toEqual([{ policy: address("0"), target: controller, value: 0n, data }]);
  });
});

describe("runWatcherOnce", () => {
  test("fails closed before indexing an unsupported Boardroom release", async () => {
    const result = await runWatcherOnce(chainId, {
      config: testConfig(10),
      deployment: {
        chainId,
        boardroomFactory: factory,
        deterministicDeploymentVersion: "pledge.cash.deterministic.v4"
      },
      store: new MemoryWatcherStore()
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("missing canonical Boardroom release evidence");
  });

  test("includes the recorded deployment block in the first scan", async () => {
    const fromBlocks: bigint[] = [];

    await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 45n,
        logs: [],
        txInputs: {},
        onGetLogs: (params) => {
          if (params.fromBlock !== undefined) fromBlocks.push(params.fromBlock);
        }
      }),
      config: testConfig(10),
      deployment: { ...testDeployment(), deploymentBlock: 42n },
      store: new MemoryWatcherStore()
    });

    expect(fromBlocks.length).toBeGreaterThan(0);
    expect(fromBlocks.every((block) => block === 42n)).toBe(true);
  });

  test("discovers boardrooms, decodes scheduled actions, projects holders, and advances cursors", async () => {
    const store = new MemoryWatcherStore();
    const events: WatcherPipelineEvent[] = [];
    const client = createClient({
      latestBlock: 5n,
      logs: [
        boardroomCreatedLog(1n),
        launchedLog(1n, 1),
        scheduledLog(2n, 0, scheduleTx),
        transferLog(3n, holder, 100n)
      ],
      txInputs: { [scheduleTx]: scheduleInput }
    });

    const result = await runWatcherOnce(chainId, {
      client,
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });

    expect(result).toMatchObject({
      actionEvents: 1,
      cursorAdvances: 3,
      discoveredBoardrooms: 1,
      governanceEvents: 2,
      scannedWindows: 3,
      shareTransfers: 1,
      skipped: false
    });
    expect(store.cursor("factory-discovery")).toBe(5n);
    expect(store.cursor("governance")).toBe(5n);
    expect(store.cursor("share-transfers")).toBe(5n);
    expect(store.state.boardrooms.get(boardroom)).toMatchObject({ owner: controller, shareToken });
    expect(store.state.actions).toHaveLength(1);
    expect(store.state.actions[0]).toMatchObject({
      operationId,
      boardroom,
      decodeStatus: "decoded",
      boardroomEpoch: 1n,
      expiresAt: new Date(606_600_000),
      scheduleTxHash: scheduleTx,
      status: "scheduled"
    });
    expect(store.callsFor(store.state.actions[0]!.id)).toHaveLength(1);
    expect(store.balance(shareToken, holder)).toBe(100n);
    expect(events.map((event) => event.event)).toEqual(["scheduled"]);
  });

  test("preserves a known controller binding when factory discovery is replayed", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    const events: WatcherPipelineEvent[] = [];

    await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 5n,
        logs: [boardroomCreatedLog(1n), scheduledLog(2n, 0, scheduleTx)],
        txInputs: { [scheduleTx]: scheduleInput }
      }),
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });

    expect(store.state.boardrooms.get(boardroom)).toMatchObject({
      controller,
      launched: true,
      proposer
    });
    expect(store.state.actions).toHaveLength(1);
    expect(events.map((event) => event.event)).toEqual(["scheduled"]);
  });

  test("commits the governance cursor atomically with rows before post-commit delivery", async () => {
    const store = new MemoryWatcherStore();
    const client = createClient({
      latestBlock: 5n,
      logs: [
        boardroomCreatedLog(1n),
        launchedLog(1n, 1),
        scheduledLog(2n, 0, scheduleTx),
        transferLog(3n, holder, 100n)
      ],
      txInputs: { [scheduleTx]: scheduleInput }
    });

    await expect(
      runWatcherOnce(chainId, {
        client,
        config: testConfig(10),
        deployment: testDeployment(),
        onActionEvent: () => {
          throw new Error("pipeline unavailable");
        },
        store
      })
    ).rejects.toThrow("pipeline unavailable");

    expect(store.cursor("factory-discovery")).toBe(5n);
    expect(store.cursor("share-transfers")).toBe(5n);
    expect(store.cursor("governance")).toBe(5n);
    expect(store.state.actions).toHaveLength(1);
    expect(store.balance(shareToken, holder)).toBe(100n);

    const events: WatcherPipelineEvent[] = [];
    const retry = await runWatcherOnce(chainId, {
      client,
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });

    expect(retry.actionEvents).toBe(0);
    expect(retry.cursorAdvances).toBe(0);
    expect(store.cursor("governance")).toBe(5n);
    expect(store.state.actions).toHaveLength(1);
    expect(store.balance(shareToken, holder)).toBe(100n);
    expect(events).toHaveLength(0);
  });

  test("transitions the latest pending row for repeated action hashes", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);
    const oldAction = store.addScheduledOperation({ id: "old-action", scheduleBlock: 2n, scheduleTxHash: bytes32("201") });
    const latestAction = store.addScheduledOperation({ id: "latest-action", scheduleBlock: 4n, scheduleTxHash: bytes32("202") });
    const events: WatcherPipelineEvent[] = [];

    await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 5n,
        logs: vetoLogs(5n, cancelTx, operationId, 0, 1),
        txInputs: {}
      }),
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });

    expect(store.action(oldAction.id)?.status).toBe("scheduled");
    expect(store.action(latestAction.id)?.status).toBe("cancelled");
    expect(events).toHaveLength(1);
    expect(events[0]?.action.id).toBe(latestAction.id);
    expect(events[0]?.event).toBe("cancelled");
  });

  test("matches terminal events to scheduled rows before the terminal log", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);
    const terminalAction = store.addScheduledOperation({
      id: "terminal-action",
      scheduleBlock: 5n,
      scheduleLogIndex: 1,
      scheduleTxHash: bytes32("201")
    });
    const rescheduledOperation = store.addScheduledOperation({
      id: "requeued-action",
      scheduleBlock: 5n,
      scheduleLogIndex: 4,
      scheduleTxHash: bytes32("202")
    });
    const events: WatcherPipelineEvent[] = [];

    await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 5n,
        logs: vetoLogs(5n, cancelTx, operationId, 2, 3),
        txInputs: {}
      }),
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });

    expect(store.action(terminalAction.id)?.status).toBe("cancelled");
    expect(store.action(rescheduledOperation.id)?.status).toBe("scheduled");
    expect(events).toHaveLength(1);
    expect(events[0]?.action.id).toBe(terminalAction.id);
  });

  test("records an executing epoch-changing action as executed instead of invalidated", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);
    const executingAction = store.addScheduledOperation({
      id: "executing-action",
      scheduleBlock: 2n,
      scheduleTxHash: bytes32("201")
    });
    const events: WatcherPipelineEvent[] = [];

    await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 5n,
        logs: [
          governanceLog("GovernanceEpochAdvanced", 5n, 1, invalidationTx, { epoch: 2n }),
          controllerLog("OperationExecuted", 5n, 3, invalidationTx, { operationId, executor: holder })
        ],
        txInputs: {}
      }),
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });

    expect(store.action(executingAction.id)).toMatchObject({
      invalidatedByEpoch: null,
      status: "executed"
    });
    expect(events.map((event) => event.event)).toEqual(["executed"]);
  });

  test("adopts a replacement controller and indexes its same-window operations", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);
    const stale = store.addScheduledOperation({
      id: "stale-controller-operation",
      scheduleBlock: 2n,
      scheduleTxHash: bytes32("221")
    });
    const nextScheduleTx = bytes32("222");
    const nextOperationId = bytes32("a22");
    const nextScheduleInput = encodeFunctionData({
      abi: boardroomControllerAbi,
      functionName: "scheduleBoardroomOperation",
      args: [facetSetHash, [call], salt, 2n, 1n]
    });
    const replacementTx = bytes32("220");
    const events: WatcherPipelineEvent[] = [];

    await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 5n,
        logs: [
          governanceLog("GovernanceEpochAdvanced", 5n, 1, replacementTx, { epoch: 2n }),
          governanceLog("BoardroomControllerReplaced", 5n, 2, replacementTx, {
            oldController: controller,
            newController: nextController,
            generation: 2n,
            proposer: holder,
            controllerDelay: 172_800n,
            gracePeriod: 604_800n
          }),
          rawLog("BoardroomOperationScheduled", nextController, 5n, 4, nextScheduleTx, {
            operationId: nextOperationId,
            proposer: holder,
            eta: 2_000n,
            expiresAt: 606_800n,
            boardroomEpoch: 2n,
            controllerGeneration: 2n,
            configurationEpoch: 1n,
            facetSetHash,
            salt,
            callsHash
          })
        ],
        txInputs: { [nextScheduleTx]: nextScheduleInput }
      }),
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });

    expect(store.state.boardrooms.get(boardroom)).toMatchObject({
      configurationEpoch: 1n,
      controller: nextController,
      controllerGeneration: 2n,
      controllerDelay: 172_800n,
      owner: nextController,
      proposer: holder
    });
    expect(store.action(stale.id)).toMatchObject({ status: "invalidated", invalidatedByEpoch: 2n });
    expect(store.state.actions.find((action) => action.operationId === nextOperationId)).toMatchObject({
      boardroomEpoch: 2n,
      controller: nextController,
      controllerGeneration: 2n,
      decodeStatus: "decoded",
      proposer: holder,
      status: "scheduled"
    });
    expect(events.map((event) => event.event)).toEqual(["invalidated", "scheduled"]);
  });

  test("records an executing configuration update and invalidates other stale configuration epochs", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);
    const executing = store.addScheduledOperation({
      id: "executing-configuration",
      operationId,
      scheduleBlock: 2n,
      scheduleTxHash: bytes32("211")
    });
    const stale = store.addScheduledOperation({
      id: "stale-configuration",
      operationId: bytes32("a12"),
      scheduleBlock: 3n,
      scheduleTxHash: bytes32("212")
    });
    const events: WatcherPipelineEvent[] = [];

    await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 5n,
        logs: [
          controllerLog("ConfigurationUpdated", 5n, 2, invalidationTx, {
            oldProposer: proposer,
            newProposer: holder,
            oldDelay: 86_400n,
            newDelay: 172_800n,
            oldGracePeriod: 604_800n,
            newGracePeriod: 604_800n,
            configurationEpoch: 2n
          }),
          controllerLog("OperationExecuted", 5n, 3, invalidationTx, {
            operationId,
            executor: target
          })
        ],
        txInputs: {}
      }),
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });

    expect(store.action(executing.id)?.status).toBe("executed");
    expect(store.action(stale.id)?.status).toBe("invalidated");
    expect(store.state.boardrooms.get(boardroom)).toMatchObject({
      configurationEpoch: 2n,
      controllerDelay: 172_800n,
      proposer: holder
    });
    expect(events.map((event) => event.event)).toEqual(["invalidated", "executed"]);
  });

  test("invalidates old epochs without touching a queue later in the same block", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);
    const oldAction = store.addScheduledOperation({
      id: "old-epoch-action",
      scheduleBlock: 2n,
      scheduleTxHash: bytes32("201")
    });
    const events: WatcherPipelineEvent[] = [];
    const client = createClient({
      latestBlock: 5n,
      logs: [
        governanceLog("GovernanceEpochAdvanced", 5n, 1, invalidationTx, { epoch: 2n }),
        scheduledLog(5n, 3, scheduleTx, { boardroomEpoch: 2n, eta: 2_000n, expiresAt: 606_800n })
      ],
      txInputs: { [scheduleTx]: scheduleInput }
    });

    const firstRun = await runWatcherOnce(chainId, {
      client,
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });

    expect(firstRun.actionEvents).toBe(2);
    expect(store.action(oldAction.id)).toMatchObject({
      invalidatedByEpoch: 2n,
      resolvedTxHash: invalidationTx,
      status: "invalidated"
    });
    const newAction = store.state.actions.find((action) => action.id !== oldAction.id);
    expect(newAction).toMatchObject({ boardroomEpoch: 2n, scheduleLogIndex: 3, status: "scheduled" });
    expect(events.map((event) => event.event)).toEqual(["invalidated", "scheduled"]);

    const retry = await runWatcherOnce(chainId, {
      client,
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });
    expect(retry.actionEvents).toBe(0);
    expect(store.state.actions).toHaveLength(2);
    expect(events.map((event) => event.event)).toEqual(["invalidated", "scheduled"]);
  });

  test("does not replay transitioned actions after their atomic governance cursor commit", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);
    const latestAction = store.addScheduledOperation({ id: "latest-action", scheduleBlock: 4n, scheduleTxHash: bytes32("202") });
    const client = createClient({
      latestBlock: 5n,
      logs: vetoLogs(5n, cancelTx, operationId, 0, 1),
      txInputs: {}
    });

    await expect(
      runWatcherOnce(chainId, {
        client,
        config: testConfig(10),
        deployment: testDeployment(),
        onActionEvent: () => {
          throw new Error("pipeline unavailable");
        },
        store
      })
    ).rejects.toThrow("pipeline unavailable");

    expect(store.action(latestAction.id)?.status).toBe("cancelled");
    expect(store.cursor("governance")).toBe(5n);

    const events: WatcherPipelineEvent[] = [];
    await runWatcherOnce(chainId, {
      client,
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });

    expect(store.cursor("governance")).toBe(5n);
    expect(events).toHaveLength(0);
  });

  test("persists undecoded scheduled actions instead of dropping them", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);

    await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 5n,
        logs: [scheduledLog(5n, 0, scheduleTx)],
        txInputs: { [scheduleTx]: "0x12345678" as Hex }
      }),
      config: testConfig(10),
      deployment: testDeployment(),
      store
    });

    expect(store.state.actions).toHaveLength(1);
    expect(store.state.actions[0]?.decodeStatus).toBe("undecoded");
    expect(store.callsFor(store.state.actions[0]!.id)).toHaveLength(0);
  });

  test("stores schema-valid selectors for empty calldata calls", async () => {
    const emptyCall: BoardroomCall = { ...call, data: "0x" };
    const emptyOperationId = bytes32("e001");
    const emptyCallsHash = keccak256(encodeAbiParameters(
      [{
        type: "tuple[]",
        components: [
          { name: "policy", type: "address" },
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      }],
      [[emptyCall]]
    ));
    const emptyScheduleInput = encodeFunctionData({
      abi: boardroomControllerAbi,
      functionName: "scheduleBoardroomOperation",
      args: [facetSetHash, [emptyCall], salt, boardroomEpoch, configurationEpoch]
    });
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);

    await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 5n,
        logs: [scheduledLog(5n, 0, scheduleTx, {
          operationId: emptyOperationId,
          payloadHash: emptyCallsHash
        })],
        txInputs: { [scheduleTx]: emptyScheduleInput }
      }),
      config: testConfig(10),
      deployment: testDeployment(),
      store
    });

    expect(store.state.actions).toHaveLength(1);
    expect(store.callsFor(store.state.actions[0]!.id)).toMatchObject([
      { data: "0x", decodedFunction: null, selector: "0x00000000" }
    ]);
  });

  test("emits policy-admin events for pending actions on enabling admin changes", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.addScheduledOperation({ id: "pending-action", scheduleBlock: 2n, scheduleTxHash: scheduleTx });
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);
    const events: WatcherPipelineEvent[] = [];

    const result = await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 6n,
        logs: [
          rawLog("ApprovalSpenderAllowedSet", assetPolicy, 6n, 0, adminTx, {
            allowed: true,
            spender: target
          })
        ],
        txInputs: {}
      }),
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });

    expect(result.policyAdminEvents).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("policy-admin");
    expect(events[0]?.eventId).toBe(`${chainId}:${adminTx}:0`);
    expect(events[0]?.action.id).toBe("pending-action");
  });

  test("does not fan out policy-admin changes to actions past their execution deadline", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.addScheduledOperation({
      expiresAt: new Date("2000-01-01T00:00:00.000Z"),
      id: "expired-action",
      scheduleBlock: 2n,
      scheduleTxHash: scheduleTx
    });
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);
    const events: WatcherPipelineEvent[] = [];

    await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 6n,
        logs: [
          rawLog("ApprovalSpenderAllowedSet", assetPolicy, 6n, 0, adminTx, {
            allowed: true,
            spender: target
          })
        ],
        txInputs: {}
      }),
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });

    expect(events).toHaveLength(0);
  });

  test("records permanent module registration and deduplicates its paired active-status notification", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.addScheduledOperation({ id: "pending-action", scheduleBlock: 2n, scheduleTxHash: scheduleTx });
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);
    const events: WatcherPipelineEvent[] = [];

    const result = await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 6n,
        logs: [
          rawLog("ModulePolicyRegistered", policyRegistry, 6n, 0, adminTx, { policy: target }),
          rawLog("PolicyStatusSet", policyRegistry, 6n, 1, adminTx, { policy: target, status: 1n })
        ],
        txInputs: {}
      }),
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });

    expect(result.policyAdminEvents).toBe(2);
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("policy-admin");
    expect(events[0]?.eventId).toBe(`${chainId}:${adminTx}:0`);
  });

  test("rolls back writes and cursor advances when persistence fails", async () => {
    const store = new MemoryWatcherStore();
    store.failInsertScheduledOperation = true;

    await expect(
      runWatcherOnce(chainId, {
        client: createClient({
          latestBlock: 5n,
          logs: [
            boardroomCreatedLog(1n),
            launchedLog(1n, 1),
            scheduledLog(2n, 0, scheduleTx)
          ],
          txInputs: { [scheduleTx]: scheduleInput }
        }),
        config: testConfig(10),
        deployment: testDeployment(),
        store
      })
    ).rejects.toThrow("forced scheduled operation failure");

    expect(store.cursor("factory-discovery")).toBeUndefined();
    expect(store.cursor("governance")).toBeUndefined();
    expect(store.state.actions).toHaveLength(0);
    expect(store.state.boardrooms.size).toBe(0);
  });
});

type RawLog = {
  readonly address: Address;
  readonly args: Record<string, unknown>;
  readonly blockNumber: bigint;
  readonly eventName: string;
  readonly logIndex: number;
  readonly transactionHash: Hex;
};

type MemoryState = {
  actions: ScheduledOperationRow[];
  balances: Map<string, { balance: bigint; updatedBlock: bigint }>;
  boardrooms: Map<string, WatcherBoardroom>;
  calls: Map<string, StoredCall[]>;
  cursors: Map<string, bigint>;
  marketEvents: Set<string>;
  policyEvents: Set<string>;
};

class MemoryWatcherStore implements WatcherStore {
  failInsertScheduledOperation = false;
  state: MemoryState = {
    actions: [],
    balances: new Map(),
    boardrooms: new Map(),
    calls: new Map(),
    cursors: new Map(),
    marketEvents: new Set(),
    policyEvents: new Set()
  };

  async transaction<T>(fn: (tx: WatcherStoreTx) => Promise<T>): Promise<T> {
    const next = cloneState(this.state);
    const result = await fn(new MemoryWatcherTx(next, this));
    this.state = next;
    return result;
  }

  addBoardroom(): void {
    this.state.boardrooms.set(boardroom, {
      address: boardroom,
      chainId,
      configurationEpoch,
      controller,
      controllerGeneration,
      createdBlock: 1n,
      controllerDelay: 86_400n,
      gracePeriod: 604_800n,
      launched: true,
      primaryMarketMode: 0,
      bondingCurve: null,
      primaryMarketQuoteAsset: null,
      bondingCurvePhase: null,
      bondingCurveSettlementReason: null,
      bondingCurvePhaseEndsAt: 0n,
      liquidityStatus: 0,
      liquidityLocker: null,
      liquidityPool: null,
      liquidityQuoteAsset: null,
      liquidityReservationCurve: null,
      liquidityReservationExpectedLocker: null,
      liquidityReservationExpectedPool: null,
      liquidityReservationPairKey: null,
      liquidityReservationSalt: null,
      liquidityReservationExpiresAt: 0n,
      name: "Acme Common",
      owner,
      proposer,
      shareToken,
      status: "active",
      windDownDelay: 86_400n
    });
  }

  addScheduledOperation(input: {
    boardroomEpoch?: bigint;
    expiresAt?: Date;
    id: string;
    operationId?: Lowercase<Hex>;
    scheduleBlock: bigint;
    scheduleLogIndex?: number;
    scheduleTxHash: Lowercase<Hex>;
  }): ScheduledOperationRow {
    const action = scheduledOperation({
      id: input.id,
      boardroomEpoch: input.boardroomEpoch,
      expiresAt: input.expiresAt,
      operationId: input.operationId,
      scheduleBlock: input.scheduleBlock,
      scheduleLogIndex: input.scheduleLogIndex,
      scheduleTxHash: input.scheduleTxHash
    });
    this.state.actions.push(action);
    this.state.calls.set(action.id, [storedCall(action.id)]);
    return action;
  }

  action(id: string): ScheduledOperationRow | undefined {
    return this.state.actions.find((action) => action.id === id);
  }

  balance(token: Lowercase<Address>, account: Lowercase<Address>): bigint {
    return this.state.balances.get(`${token}:${account}`)?.balance ?? 0n;
  }

  callsFor(actionId: string): StoredCall[] {
    return this.state.calls.get(actionId) ?? [];
  }

  cursor(scope: WatcherCursorScope): bigint | undefined {
    return this.state.cursors.get(`${chainId}:${scope}`);
  }

  setCursor(scope: WatcherCursorScope, blockNumber: bigint): void {
    this.state.cursors.set(`${chainId}:${scope}`, blockNumber);
  }
}

class MemoryWatcherTx implements WatcherStoreTx {
  constructor(
    private readonly state: MemoryState,
    private readonly parent: MemoryWatcherStore
  ) {}

  async applyShareBalanceDeltas(inputs: readonly ShareBalanceDeltaInput[]): Promise<void> {
    for (const input of inputs) {
      const key = `${input.token}:${input.holder}`;
      const current = this.state.balances.get(key)?.balance ?? 0n;
      this.state.balances.set(key, {
        balance: current + input.delta,
        updatedBlock: input.blockNumber
      });
    }
  }

  async getCursor(chainId_: number, scope: WatcherCursorScope): Promise<bigint | undefined> {
    return this.state.cursors.get(`${chainId_}:${scope}`);
  }

  async invalidateScheduledOperationsBeforeEpoch(input: {
    readonly boardroom: Lowercase<Address>;
    readonly chainId: number;
    readonly epoch: bigint;
    readonly terminalBlock: bigint;
    readonly terminalLogIndex: number;
    readonly txHash: Lowercase<Hex>;
  }): Promise<Array<{ action: ScheduledOperationRow; calls: StoredCall[] }>> {
    const matching = this.state.actions.filter(
      (action) =>
        action.chainId === input.chainId
        && action.boardroom === input.boardroom
        && action.status === "scheduled"
        && action.boardroomEpoch !== null
        && action.boardroomEpoch < input.epoch
        && (action.scheduleBlock < input.terminalBlock
          || (action.scheduleBlock === input.terminalBlock && action.scheduleLogIndex < input.terminalLogIndex))
    );

    return matching.map((action) => {
      const updated: ScheduledOperationRow = {
        ...action,
        invalidatedByEpoch: input.epoch,
        resolvedTxHash: input.txHash,
        status: "invalidated",
        updatedAt: new Date()
      };
      const index = this.state.actions.findIndex((candidate) => candidate.id === action.id);
      this.state.actions[index] = updated;
      return { action: updated, calls: this.state.calls.get(updated.id) ?? [] };
    });
  }

  async invalidateScheduledOperationsBeforeConfigurationEpoch(input: {
    readonly boardroom: Lowercase<Address>;
    readonly chainId: number;
    readonly configurationEpoch: bigint;
    readonly controller: Lowercase<Address>;
    readonly terminalBlock: bigint;
    readonly terminalLogIndex: number;
    readonly txHash: Lowercase<Hex>;
  }): Promise<Array<{ action: ScheduledOperationRow; calls: StoredCall[] }>> {
    const matching = this.state.actions.filter(
      (action) =>
        action.chainId === input.chainId
        && action.boardroom === input.boardroom
        && action.controller === input.controller
        && action.status === "scheduled"
        && action.configurationEpoch < input.configurationEpoch
        && (action.scheduleBlock < input.terminalBlock
          || (action.scheduleBlock === input.terminalBlock && action.scheduleLogIndex < input.terminalLogIndex))
    );
    return matching.map((action) => {
      const updated: ScheduledOperationRow = {
        ...action,
        resolvedTxHash: input.txHash,
        status: "invalidated",
        updatedAt: new Date()
      };
      const index = this.state.actions.findIndex((candidate) => candidate.id === action.id);
      this.state.actions[index] = updated;
      return { action: updated, calls: this.state.calls.get(updated.id) ?? [] };
    });
  }

  async insertActionCalls(actionId: string, calls: readonly InsertActionCallInput[]): Promise<StoredCall[]> {
    const existing = this.state.calls.get(actionId) ?? [];
    const byIndex = new Map(existing.map((call_) => [call_.callIndex, call_]));
    for (const call_ of calls) {
      if (byIndex.has(call_.callIndex)) continue;
      byIndex.set(call_.callIndex, {
        ...call_,
        actionId
      });
    }
    const stored = [...byIndex.values()].sort((left, right) => left.callIndex - right.callIndex);
    this.state.calls.set(actionId, stored);
    return stored;
  }

  async insertMarketLifecycleEvent(
    input: MarketLifecycleEvent & { readonly chainId: number }
  ): Promise<boolean> {
    const key = `${input.chainId}:${input.transactionHash}:${input.logIndex}`;
    if (this.state.marketEvents.has(key)) return false;
    this.state.marketEvents.add(key);
    return true;
  }

  async insertPolicyAdminEvent(input: InsertPolicyAdminEventInput): Promise<boolean> {
    const key = `${input.chainId}:${input.txHash}:${input.logIndex}`;
    if (this.state.policyEvents.has(key)) return false;
    this.state.policyEvents.add(key);
    return true;
  }

  async insertScheduledOperation(input: InsertScheduledOperationInput): Promise<ScheduledOperationRow | undefined> {
    if (this.parent.failInsertScheduledOperation) {
      throw new Error("forced scheduled operation failure");
    }

    const exists = this.state.actions.some(
      (action) =>
        action.chainId === input.chainId &&
        action.boardroom === input.boardroom &&
        action.operationId === input.operationId &&
        action.scheduleTxHash === input.scheduleTxHash
    );
    if (exists) {
      return this.state.actions.find(
        (action) =>
          action.chainId === input.chainId &&
          action.boardroom === input.boardroom &&
          action.operationId === input.operationId &&
          action.scheduleTxHash === input.scheduleTxHash
      );
    }

    const action = scheduledOperation({
      ...input,
      id: `action-${this.state.actions.length + 1}`,
      scheduleBlock: input.scheduleBlock,
      scheduleTxHash: input.scheduleTxHash
    });
    this.state.actions.push(action);
    return action;
  }

  async listActionCalls(actionId: string): Promise<StoredCall[]> {
    return this.state.calls.get(actionId) ?? [];
  }

  async listBoardrooms(chainId_: number): Promise<WatcherBoardroom[]> {
    return [...this.state.boardrooms.values()].filter((item) => item.chainId === chainId_);
  }

  async listScheduledOperations(chainId_: number): Promise<Array<{ action: ScheduledOperationRow; calls: StoredCall[] }>> {
    return this.state.actions
      .filter(
        (action) =>
          action.chainId === chainId_
          && action.status === "scheduled"
          && (action.expiresAt === null || action.expiresAt.getTime() > Date.now())
      )
      .sort((left, right) => Number(right.scheduleBlock - left.scheduleBlock) || right.scheduleLogIndex - left.scheduleLogIndex)
      .map((action) => ({ action, calls: this.state.calls.get(action.id) ?? [] }));
  }

  async setCursor(chainId_: number, scope: WatcherCursorScope, blockNumber: bigint): Promise<void> {
    this.state.cursors.set(`${chainId_}:${scope}`, blockNumber);
  }

  async transitionLatestScheduledOperation(input: {
    readonly operationId: Lowercase<Hex>;
    readonly boardroom: Lowercase<Address>;
    readonly caller: Lowercase<Address>;
    readonly chainId: number;
    readonly controller: Lowercase<Address>;
    readonly status: "cancelled" | "executed";
    readonly terminalBlock: bigint;
    readonly terminalLogIndex: number;
    readonly txHash: Lowercase<Hex>;
  }): Promise<{ action: ScheduledOperationRow; calls: StoredCall[] } | undefined> {
    const matching = this.state.actions
      .filter(
        (action) =>
          action.chainId === input.chainId &&
          action.boardroom === input.boardroom &&
          action.controller === input.controller &&
          action.operationId === input.operationId &&
          (action.scheduleBlock < input.terminalBlock ||
            (action.scheduleBlock === input.terminalBlock && action.scheduleLogIndex <= input.terminalLogIndex)) &&
          action.status === "scheduled"
      )
      .sort((left, right) => Number(right.scheduleBlock - left.scheduleBlock) || right.scheduleLogIndex - left.scheduleLogIndex);
    const latest = matching[0];
    if (!latest) {
      const existing = this.state.actions
        .filter(
          (action) =>
            action.chainId === input.chainId &&
            action.boardroom === input.boardroom &&
            action.controller === input.controller &&
            action.operationId === input.operationId &&
            action.status === input.status &&
            action.resolvedTxHash === input.txHash
        )
        .sort(
          (left, right) => Number(right.scheduleBlock - left.scheduleBlock) || right.scheduleLogIndex - left.scheduleLogIndex
        )[0];
      return existing === undefined
        ? undefined
        : { action: existing, calls: this.state.calls.get(existing.id) ?? [] };
    }

    const updated: ScheduledOperationRow = {
      ...latest,
      cancelledBy: input.status === "cancelled" ? input.caller : latest.cancelledBy,
      executedBy: input.status === "executed" ? input.caller : latest.executedBy,
      resolvedTxHash: input.txHash,
      status: input.status,
      updatedAt: new Date()
    };
    const index = this.state.actions.findIndex((action) => action.id === latest.id);
    this.state.actions[index] = updated;
    return { action: updated, calls: this.state.calls.get(updated.id) ?? [] };
  }

  async upsertBoardrooms(chainId_: number, discovered: readonly DiscoveredBoardroom[]): Promise<void> {
    for (const item of discovered) {
      const address_ = item.boardroom.toLowerCase() as Lowercase<Address>;
      const existing = this.state.boardrooms.get(address_);
      this.state.boardrooms.set(address_, {
        address: address_,
        chainId: chainId_,
        configurationEpoch: existing?.configurationEpoch ?? 0n,
        controller: existing?.controller ?? address("0"),
        controllerGeneration: existing?.controllerGeneration ?? 0n,
        createdBlock: item.createdAtBlock,
        controllerDelay: existing?.controllerDelay ?? 0n,
        gracePeriod: existing?.gracePeriod ?? 0n,
        launched: existing?.launched ?? false,
        primaryMarketMode: existing?.primaryMarketMode ?? 0,
        bondingCurve: existing?.bondingCurve ?? null,
        primaryMarketQuoteAsset: existing?.primaryMarketQuoteAsset ?? null,
        bondingCurvePhase: existing?.bondingCurvePhase ?? null,
        bondingCurveSettlementReason: existing?.bondingCurveSettlementReason ?? null,
        bondingCurvePhaseEndsAt: existing?.bondingCurvePhaseEndsAt ?? 0n,
        liquidityStatus: existing?.liquidityStatus ?? 0,
        liquidityLocker: existing?.liquidityLocker ?? null,
        liquidityPool: existing?.liquidityPool ?? null,
        liquidityQuoteAsset: existing?.liquidityQuoteAsset ?? null,
        liquidityReservationCurve: existing?.liquidityReservationCurve ?? null,
        liquidityReservationExpectedLocker: existing?.liquidityReservationExpectedLocker ?? null,
        liquidityReservationExpectedPool: existing?.liquidityReservationExpectedPool ?? null,
        liquidityReservationPairKey: existing?.liquidityReservationPairKey ?? null,
        liquidityReservationSalt: existing?.liquidityReservationSalt ?? null,
        liquidityReservationExpiresAt: existing?.liquidityReservationExpiresAt ?? 0n,
        name: item.name,
        owner: item.owner.toLowerCase() as Lowercase<Address>,
        proposer: existing?.proposer ?? address("0"),
        shareToken: item.shareToken.toLowerCase() as Lowercase<Address>,
        status: existing?.status ?? "prelaunch",
        windDownDelay: existing?.windDownDelay ?? 0n
      });
    }
  }

  async updateBoardroomLifecycle(input: {
    readonly boardroom: Lowercase<Address>;
    readonly chainId: number;
    readonly configurationEpoch?: bigint;
    readonly controller?: Lowercase<Address>;
    readonly controllerGeneration?: bigint;
    readonly controllerDelay?: bigint;
    readonly gracePeriod?: bigint;
    readonly launched?: boolean;
    readonly owner?: Lowercase<Address>;
    readonly proposer?: Lowercase<Address>;
    readonly status?: "prelaunch" | "active" | "winddown" | "snapshotting" | "redemptions-open";
    readonly windDownDelay?: bigint;
  }): Promise<void> {
    const existing = this.state.boardrooms.get(input.boardroom);
    if (!existing || existing.chainId !== input.chainId) return;
    this.state.boardrooms.set(input.boardroom, {
      ...existing,
      configurationEpoch: input.configurationEpoch ?? existing.configurationEpoch,
      controller: input.controller ?? existing.controller,
      controllerGeneration: input.controllerGeneration ?? existing.controllerGeneration,
      controllerDelay: input.controllerDelay ?? existing.controllerDelay,
      gracePeriod: input.gracePeriod ?? existing.gracePeriod,
      launched: input.launched ?? existing.launched,
      owner: input.owner ?? existing.owner,
      proposer: input.proposer ?? existing.proposer,
      status: input.status ?? existing.status,
      windDownDelay: input.windDownDelay ?? existing.windDownDelay
    });
  }

  async updateBoardroomMarketState(
    input: BoardroomMarketStateUpdate & { readonly chainId: number }
  ): Promise<void> {
    const existing = this.state.boardrooms.get(input.boardroom);
    if (!existing || existing.chainId !== input.chainId) return;
    this.state.boardrooms.set(input.boardroom, {
      ...existing,
      bondingCurve: input.bondingCurve ?? existing.bondingCurve,
      bondingCurvePhase: input.bondingCurvePhase ?? existing.bondingCurvePhase,
      bondingCurvePhaseEndsAt: input.bondingCurvePhaseEndsAt ?? existing.bondingCurvePhaseEndsAt,
      bondingCurveSettlementReason:
        input.bondingCurveSettlementReason ?? existing.bondingCurveSettlementReason,
      liquidityLocker: input.liquidityLocker ?? existing.liquidityLocker,
      liquidityPool: input.liquidityPool ?? existing.liquidityPool,
      liquidityQuoteAsset: input.liquidityQuoteAsset ?? existing.liquidityQuoteAsset,
      liquidityReservationCurve: input.clearLiquidityReservation
        ? null
        : (input.liquidityReservationCurve ?? existing.liquidityReservationCurve),
      liquidityReservationExpectedLocker: input.clearLiquidityReservation
        ? null
        : (input.liquidityReservationExpectedLocker ?? existing.liquidityReservationExpectedLocker),
      liquidityReservationExpectedPool: input.clearLiquidityReservation
        ? null
        : (input.liquidityReservationExpectedPool ?? existing.liquidityReservationExpectedPool),
      liquidityReservationExpiresAt: input.clearLiquidityReservation
        ? 0n
        : (input.liquidityReservationExpiresAt ?? existing.liquidityReservationExpiresAt),
      liquidityReservationPairKey: input.clearLiquidityReservation
        ? null
        : (input.liquidityReservationPairKey ?? existing.liquidityReservationPairKey),
      liquidityReservationSalt: input.clearLiquidityReservation
        ? null
        : (input.liquidityReservationSalt ?? existing.liquidityReservationSalt),
      liquidityStatus: input.liquidityStatus ?? existing.liquidityStatus,
      primaryMarketMode: input.primaryMarketMode ?? existing.primaryMarketMode,
      primaryMarketQuoteAsset: input.primaryMarketQuoteAsset ?? existing.primaryMarketQuoteAsset
    });
  }
}

function testConfig(maxBlockRange: number) {
  return {
    chains: [{ chainId, confirmations: 0, rpcUrl: "http://127.0.0.1:8545" }],
    databaseUrl: "postgres://sentinel:sentinel@127.0.0.1:5432/sentinel",
    maxBlockRange
  };
}

function testDeployment() {
  const codeHash = bytes32("11");
  return {
    activeFacetSetHash: facetSetHash,
    activeRelease: 1n,
    assetPolicy,
    authorityFacet: address("a01"),
    authorityFacetCodeHash: codeHash,
    boardroomFactory: factory,
    boardroomFactoryCodeHash: codeHash,
    boardroomControllerFactory: address("c0f1"),
    boardroomControllerFactoryCodeHash: codeHash,
    boardroomControllerLogic: address("c010"),
    boardroomControllerLogicCodeHash: codeHash,
    boardroomGovernanceLogic: address("600d"),
    boardroomGovernanceLogicCodeHash: codeHash,
    boardroomKernel: address("beef"),
    boardroomKernelCodeHash: codeHash,
    boardroomMarketLogic: address("aa11"),
    boardroomMarketLogicCodeHash: codeHash,
    boardroomRedemptionPayout: address("feed"),
    boardroomRedemptionPayoutCodeHash: codeHash,
    deterministicDeployment: true,
    deterministicDeploymentVersion: "pledge.cash.protocol.v1",
    deterministicReleaseCodeHash: codeHash,
    executionFacet: address("e02"),
    executionFacetCodeHash: codeHash,
    kernelSelectorSetHash: bytes32("12"),
    manifestHash: bytes32("13"),
    marketFacet: address("a03"),
    marketFacetCodeHash: codeHash,
    boardroomPolicyRegistry: policyRegistry,
    chainId,
    protocolFacetRegistry: address("f4ce7"),
    protocolFacetRegistryCodeHash: codeHash,
    protocolFacetRegistryOwner: owner,
    protocolGovernance: owner,
    protocolReleaseCodeHash: codeHash,
    protocolVersion: "pledge.cash.protocol.v1",
    redemptionFacet: address("a04"),
    redemptionFacetCodeHash: codeHash,
    requiredStorageLayoutHash: bytes32("14"),
    requiredStorageVersion: 1n,
    selectorCount: 5n,
    viewFacet: address("a05"),
    viewFacetCodeHash: codeHash
  };
}

function createClient(input: {
  readonly latestBlock: bigint;
  readonly logs: readonly RawLog[];
  readonly onGetLogs?: (params: {
    address?: Address | Address[];
    event?: { name?: string };
    fromBlock?: bigint;
    toBlock?: bigint | "latest";
  }) => void;
  readonly txInputs: Record<string, Hex>;
}): WatcherClient {
  return {
    async getBlockNumber() {
      return input.latestBlock;
    },
    async getLogs(params: {
      address?: Address | Address[];
      event?: { name?: string };
      fromBlock?: bigint;
      toBlock?: bigint | "latest";
    }) {
      input.onGetLogs?.(params);
      const eventName = params.event?.name;
      const addresses = new Set(
        (Array.isArray(params.address) ? params.address : params.address ? [params.address] : []).map((item) =>
          item.toLowerCase()
        )
      );
      return input.logs.filter((log) => {
        if (eventName && log.eventName !== eventName) return false;
        if (addresses.size > 0 && !addresses.has(log.address.toLowerCase())) return false;
        if (params.fromBlock !== undefined && log.blockNumber < params.fromBlock) return false;
        if (typeof params.toBlock === "bigint" && log.blockNumber > params.toBlock) return false;
        return true;
      });
    },
    async getTransaction(params: { hash: Hex }) {
      return { input: input.txInputs[params.hash] ?? "0x" };
    }
  } as WatcherClient;
}

function boardroomCreatedLog(blockNumber: bigint): RawLog {
  return rawLog("BoardroomCreated", factory, blockNumber, 0, bytes32("001"), {
    boardroom,
    facetSetHash,
    name: "Acme Common",
    owner,
    policyRegistry,
    salt,
    shareToken,
    symbol: "ACME",
    wrappedNative: address("999")
  });
}

function governanceLog(
  eventName: string,
  blockNumber: bigint,
  logIndex: number,
  transactionHash: Hex,
  args: Record<string, unknown>
): RawLog {
  return rawLog(eventName, boardroom, blockNumber, logIndex, transactionHash, args);
}

function controllerLog(
  eventName: string,
  blockNumber: bigint,
  logIndex: number,
  transactionHash: Hex,
  args: Record<string, unknown>
): RawLog {
  return rawLog(eventName, controller, blockNumber, logIndex, transactionHash, args);
}

function launchedLog(blockNumber: bigint, logIndex: number): RawLog {
  return governanceLog("BoardroomLaunched", blockNumber, logIndex, bytes32("1a"), {
    controller,
    proposer,
    protectionStaker: holder,
    controllerGeneration,
    controllerDelay: 86_400n,
    windDownDelay: 86_400n,
    gracePeriod: 604_800n
  });
}

function scheduledLog(
  blockNumber: bigint,
  logIndex: number,
  transactionHash: Hex,
  overrides: Partial<{
    operationId: Hex;
    proposer: Address;
    eta: bigint;
    expiresAt: bigint;
    boardroomEpoch: bigint;
    controllerGeneration: bigint;
    configurationEpoch: bigint;
    facetSetHash: Hex;
    salt: Hex;
    payloadHash: Hex;
  }> = {}
): RawLog {
  return controllerLog("BoardroomOperationScheduled", blockNumber, logIndex, transactionHash, {
    operationId: overrides.operationId ?? operationId,
    proposer: overrides.proposer ?? proposer,
    eta: overrides.eta ?? 1_800n,
    expiresAt: overrides.expiresAt ?? 606_600n,
    boardroomEpoch: overrides.boardroomEpoch ?? boardroomEpoch,
    controllerGeneration: overrides.controllerGeneration ?? controllerGeneration,
    configurationEpoch: overrides.configurationEpoch ?? configurationEpoch,
    facetSetHash: overrides.facetSetHash ?? facetSetHash,
    salt: overrides.salt ?? salt,
    callsHash: overrides.payloadHash ?? callsHash
  });
}

function vetoLogs(
  blockNumber: bigint,
  transactionHash: Hex,
  operationId_: Hex,
  cancelLogIndex: number,
  vetoLogIndex: number
): RawLog[] {
  return [
    controllerLog("OperationCancelled", blockNumber, cancelLogIndex, transactionHash, {
      operationId: operationId_
    }),
    governanceLog("BoardroomOperationVetoed", blockNumber, vetoLogIndex, transactionHash, {
      operationId: operationId_,
      staker: holder
    })
  ];
}

function transferLog(blockNumber: bigint, to: Address, amount: bigint): RawLog {
  return rawLog("Transfer", shareToken, blockNumber, 0, bytes32("301"), {
    amount,
    from: address("0"),
    to
  });
}

function rawLog(
  eventName: string,
  logAddress: Address,
  blockNumber: bigint,
  logIndex: number,
  transactionHash: Hex,
  args: Record<string, unknown>
): RawLog {
  return {
    address: logAddress,
    args,
    blockNumber,
    eventName,
    logIndex,
    transactionHash
  };
}

function scheduledOperation(
  input: Partial<InsertScheduledOperationInput> & {
    id: string;
    scheduleBlock: bigint;
    scheduleTxHash: Lowercase<Hex>;
  }
): ScheduledOperationRow {
  const now = new Date();
  return {
    operationId: input.operationId ?? operationId,
    boardroom: input.boardroom ?? boardroom,
    cancelledBy: null,
    chainId: input.chainId ?? chainId,
    configurationEpoch: input.configurationEpoch ?? configurationEpoch,
    controller: input.controller ?? controller,
    controllerGeneration: input.controllerGeneration ?? controllerGeneration,
    createdAt: now,
    decodeStatus: input.decodeStatus ?? "decoded",
    boardroomEpoch: input.boardroomEpoch ?? boardroomEpoch,
    eta: input.eta ?? new Date(1_800_000),
    expiresAt: input.expiresAt ?? new Date("2100-01-01T00:00:00.000Z"),
    facetSetHash: input.facetSetHash ?? facetSetHash,
    executedBy: null,
    id: input.id,
    invalidatedByEpoch: null,
    operationKind: input.operationKind ?? "boardroom",
    proposer: input.proposer ?? proposer,
    scheduleBlock: input.scheduleBlock,
    scheduleLogIndex: input.scheduleLogIndex ?? 0,
    scheduleTxHash: input.scheduleTxHash,
    rawCalldata: input.rawCalldata ?? scheduleInput,
    resolvedTxHash: null,
    salt: input.salt ?? salt,
    status: "scheduled",
    updatedAt: now
  };
}

function storedCall(actionId: string): StoredCall {
  return {
    actionId,
    callIndex: 0,
    data: call.data,
    decodedArgs: null,
    decodedFunction: null,
    policy,
    selector: call.data.slice(0, 10) as Hex,
    target,
    value: "0"
  };
}

function cloneState(state: MemoryState): MemoryState {
  return {
    actions: state.actions.map((action) => ({ ...action })),
    balances: new Map([...state.balances.entries()].map(([key, value]) => [key, { ...value }])),
    boardrooms: new Map([...state.boardrooms.entries()].map(([key, value]) => [key, { ...value }])),
    calls: new Map([...state.calls.entries()].map(([key, value]) => [key, value.map((call_) => ({ ...call_ }))])),
    cursors: new Map(state.cursors),
    marketEvents: new Set(state.marketEvents),
    policyEvents: new Set(state.policyEvents)
  };
}

function address(value: string): Lowercase<Address> {
  return `0x${value.padStart(40, "0")}` as Lowercase<Address>;
}

function bytes32(value: string): Lowercase<Hex> {
  return `0x${value.padStart(64, "0")}` as Lowercase<Hex>;
}
