import { describe, expect, test } from "bun:test";

import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

import { boardroomAbi, hashAction, type BoardroomCall, type DiscoveredBoardroom } from "@pledge.cash/sdk";

import type { QueuedActionRow, StoredCall } from "../src/types";
import {
  decodeQueuedActionCalldata,
  runWatcherOnce,
  type InsertActionCallInput,
  type InsertPolicyAdminEventInput,
  type InsertQueuedActionInput,
  type WatcherBoardroom,
  type WatcherClient,
  type WatcherPipelineEvent,
  type WatcherStore,
  type WatcherStoreTx
} from "../src/chain/watcher";
import type { ShareBalanceDeltaInput } from "../src/chain/holders";
import type { WatcherCursorScope } from "../src/chain/cursor";

const chainId = 31337;
const factory = address("fac");
const boardroom = address("b0a4d");
const shareToken = address("51a4e");
const owner = address("01");
const executor = owner;
const holder = address("02");
const policy = address("0a55");
const target = address("0b0b");
const assetPolicy = address("a55e7");
const policyRegistry = address("f09");
const salt = bytes32("01");
const queueTx = bytes32("100");
const cancelTx = bytes32("101");
const adminTx = bytes32("102");

const call: BoardroomCall = {
  data: encodeFunctionData({
    abi: boardroomAbi,
    functionName: "setExecutor",
    args: [address("eeee")]
  }),
  policy,
  target,
  value: 0n
};
const actionHash = hashAction(call, salt);
const queueInput = encodeFunctionData({
  abi: boardroomAbi,
  functionName: "queueAction",
  args: [call, salt]
});
const safeExecTransactionAbi = parseAbi([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool success)"
]);

describe("decodeQueuedActionCalldata", () => {
  test("accepts selector-scanned calldata only when hash parity matches", () => {
    const scanned = `0xdeadbeef${queueInput.slice(2)}` as Hex;

    const decoded = decodeQueuedActionCalldata({
      actionHash,
      expectedSalt: salt,
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
      decodeQueuedActionCalldata({
        actionHash: bytes32("999"),
        expectedSalt: salt,
        txInput: scanned
      }).decodeStatus
    ).toBe("undecoded");
  });

  test("unwraps Safe execTransaction calldata before verifying hash parity", () => {
    const wrapped = encodeFunctionData({
      abi: safeExecTransactionAbi,
      functionName: "execTransaction",
      args: [boardroom, 0n, queueInput, 0, 0n, 0n, 0n, address("0"), address("0"), "0x"]
    });

    const decoded = decodeQueuedActionCalldata({
      actionHash,
      expectedSalt: salt,
      txInput: wrapped
    });

    expect(decoded.decodeStatus).toBe("decoded");
    expect(decoded.calls[0]?.policy.toLowerCase()).toBe(call.policy);
  });
});

describe("runWatcherOnce", () => {
  test("discovers boardrooms, decodes queued actions, projects holders, and advances cursors", async () => {
    const store = new MemoryWatcherStore();
    const events: WatcherPipelineEvent[] = [];
    const client = createClient({
      latestBlock: 5n,
      logs: [
        boardroomCreatedLog(1n),
        governanceLog("BoardroomActionQueued", 2n, 0, queueTx, {
          actionHash,
          eta: 1_800n,
          executor,
          salt
        }),
        transferLog(3n, holder, 100n)
      ],
      txInputs: { [queueTx]: queueInput }
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
      governanceEvents: 1,
      scannedWindows: 3,
      shareTransfers: 1,
      skipped: false
    });
    expect(store.cursor("factory-discovery")).toBe(5n);
    expect(store.cursor("governance")).toBe(5n);
    expect(store.cursor("share-transfers")).toBe(5n);
    expect(store.state.boardrooms.get(boardroom)?.shareToken).toBe(shareToken);
    expect(store.state.actions).toHaveLength(1);
    expect(store.state.actions[0]).toMatchObject({
      actionHash,
      boardroom,
      decodeStatus: "decoded",
      queueTxHash: queueTx,
      status: "queued"
    });
    expect(store.callsFor(store.state.actions[0]!.id)).toHaveLength(1);
    expect(store.balance(shareToken, holder)).toBe(100n);
    expect(events.map((event) => event.event)).toEqual(["queued"]);
  });

  test("commits the governance cursor atomically with rows before post-commit delivery", async () => {
    const store = new MemoryWatcherStore();
    const client = createClient({
      latestBlock: 5n,
      logs: [
        boardroomCreatedLog(1n),
        governanceLog("BoardroomActionQueued", 2n, 0, queueTx, {
          actionHash,
          eta: 1_800n,
          executor,
          salt
        }),
        transferLog(3n, holder, 100n)
      ],
      txInputs: { [queueTx]: queueInput }
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
    const oldAction = store.addQueuedAction({ id: "old-action", queueBlock: 2n, queueTxHash: bytes32("201") });
    const latestAction = store.addQueuedAction({ id: "latest-action", queueBlock: 4n, queueTxHash: bytes32("202") });
    const events: WatcherPipelineEvent[] = [];

    await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 5n,
        logs: [
          governanceLog("BoardroomActionCancelled", 5n, 0, cancelTx, {
            actionHash,
            caller: holder
          })
        ],
        txInputs: {}
      }),
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });

    expect(store.action(oldAction.id)?.status).toBe("queued");
    expect(store.action(latestAction.id)?.status).toBe("cancelled");
    expect(events).toHaveLength(1);
    expect(events[0]?.action.id).toBe(latestAction.id);
    expect(events[0]?.event).toBe("cancelled");
  });

  test("matches terminal events to queued rows before the terminal log", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);
    const terminalAction = store.addQueuedAction({
      id: "terminal-action",
      queueBlock: 5n,
      queueLogIndex: 1,
      queueTxHash: bytes32("201")
    });
    const requeuedAction = store.addQueuedAction({
      id: "requeued-action",
      queueBlock: 5n,
      queueLogIndex: 3,
      queueTxHash: bytes32("202")
    });
    const events: WatcherPipelineEvent[] = [];

    await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 5n,
        logs: [
          governanceLog("BoardroomActionCancelled", 5n, 2, cancelTx, {
            actionHash,
            caller: holder
          })
        ],
        txInputs: {}
      }),
      config: testConfig(10),
      deployment: testDeployment(),
      onActionEvent: (event) => events.push(event),
      store
    });

    expect(store.action(terminalAction.id)?.status).toBe("cancelled");
    expect(store.action(requeuedAction.id)?.status).toBe("queued");
    expect(events).toHaveLength(1);
    expect(events[0]?.action.id).toBe(terminalAction.id);
  });

  test("does not replay transitioned actions after their atomic governance cursor commit", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);
    const latestAction = store.addQueuedAction({ id: "latest-action", queueBlock: 4n, queueTxHash: bytes32("202") });
    const client = createClient({
      latestBlock: 5n,
      logs: [
        governanceLog("BoardroomActionCancelled", 5n, 0, cancelTx, {
          actionHash,
          caller: holder
        })
      ],
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

  test("persists undecoded queued actions instead of dropping them", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);

    await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 5n,
        logs: [
          governanceLog("BoardroomActionQueued", 5n, 0, queueTx, {
            actionHash,
            eta: 1_800n,
            executor,
            salt
          })
        ],
        txInputs: { [queueTx]: "0x12345678" as Hex }
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
    const emptyActionHash = hashAction(emptyCall, salt);
    const emptyQueueInput = encodeFunctionData({
      abi: boardroomAbi,
      functionName: "queueAction",
      args: [emptyCall, salt]
    });
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.setCursor("factory-discovery", 5n);
    store.setCursor("share-transfers", 5n);

    await runWatcherOnce(chainId, {
      client: createClient({
        latestBlock: 5n,
        logs: [
          governanceLog("BoardroomActionQueued", 5n, 0, queueTx, {
            actionHash: emptyActionHash,
            eta: 1_800n,
            executor,
            salt
          })
        ],
        txInputs: { [queueTx]: emptyQueueInput }
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
    store.addQueuedAction({ id: "pending-action", queueBlock: 2n, queueTxHash: queueTx });
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

  test("records permanent module registration and deduplicates its paired active-status notification", async () => {
    const store = new MemoryWatcherStore();
    store.addBoardroom();
    store.addQueuedAction({ id: "pending-action", queueBlock: 2n, queueTxHash: queueTx });
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
    store.failInsertQueuedAction = true;

    await expect(
      runWatcherOnce(chainId, {
        client: createClient({
          latestBlock: 5n,
          logs: [
            boardroomCreatedLog(1n),
            governanceLog("BoardroomActionQueued", 2n, 0, queueTx, {
              actionHash,
              eta: 1_800n,
              executor,
              salt
            })
          ],
          txInputs: { [queueTx]: queueInput }
        }),
        config: testConfig(10),
        deployment: testDeployment(),
        store
      })
    ).rejects.toThrow("forced queued action failure");

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
  actions: QueuedActionRow[];
  balances: Map<string, { balance: bigint; updatedBlock: bigint }>;
  boardrooms: Map<string, WatcherBoardroom>;
  calls: Map<string, StoredCall[]>;
  cursors: Map<string, bigint>;
  policyEvents: Set<string>;
};

class MemoryWatcherStore implements WatcherStore {
  failInsertQueuedAction = false;
  state: MemoryState = {
    actions: [],
    balances: new Map(),
    boardrooms: new Map(),
    calls: new Map(),
    cursors: new Map(),
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
      createdBlock: 1n,
      executor,
      governanceDelay: 0n,
      launched: false,
      name: "Acme Common",
      owner,
      shareToken,
      status: "prelaunch"
    });
  }

  addQueuedAction(input: {
    id: string;
    queueBlock: bigint;
    queueLogIndex?: number;
    queueTxHash: Lowercase<Hex>;
  }): QueuedActionRow {
    const action = queuedAction({
      id: input.id,
      queueBlock: input.queueBlock,
      queueLogIndex: input.queueLogIndex,
      queueTxHash: input.queueTxHash
    });
    this.state.actions.push(action);
    this.state.calls.set(action.id, [storedCall(action.id)]);
    return action;
  }

  action(id: string): QueuedActionRow | undefined {
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

  async insertPolicyAdminEvent(input: InsertPolicyAdminEventInput): Promise<boolean> {
    const key = `${input.chainId}:${input.txHash}:${input.logIndex}`;
    if (this.state.policyEvents.has(key)) return false;
    this.state.policyEvents.add(key);
    return true;
  }

  async insertQueuedAction(input: InsertQueuedActionInput): Promise<QueuedActionRow | undefined> {
    if (this.parent.failInsertQueuedAction) {
      throw new Error("forced queued action failure");
    }

    const exists = this.state.actions.some(
      (action) =>
        action.chainId === input.chainId &&
        action.boardroom === input.boardroom &&
        action.actionHash === input.actionHash &&
        action.queueTxHash === input.queueTxHash
    );
    if (exists) {
      return this.state.actions.find(
        (action) =>
          action.chainId === input.chainId &&
          action.boardroom === input.boardroom &&
          action.actionHash === input.actionHash &&
          action.queueTxHash === input.queueTxHash
      );
    }

    const action = queuedAction({
      ...input,
      id: `action-${this.state.actions.length + 1}`,
      queueBlock: input.queueBlock,
      queueTxHash: input.queueTxHash
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

  async listQueuedActions(chainId_: number): Promise<Array<{ action: QueuedActionRow; calls: StoredCall[] }>> {
    return this.state.actions
      .filter((action) => action.chainId === chainId_ && action.status === "queued")
      .sort((left, right) => Number(right.queueBlock - left.queueBlock) || right.queueLogIndex - left.queueLogIndex)
      .map((action) => ({ action, calls: this.state.calls.get(action.id) ?? [] }));
  }

  async setCursor(chainId_: number, scope: WatcherCursorScope, blockNumber: bigint): Promise<void> {
    this.state.cursors.set(`${chainId_}:${scope}`, blockNumber);
  }

  async transitionLatestQueuedAction(input: {
    readonly actionHash: Lowercase<Hex>;
    readonly boardroom: Lowercase<Address>;
    readonly caller: Lowercase<Address>;
    readonly chainId: number;
    readonly status: "cancelled" | "executed";
    readonly terminalBlock: bigint;
    readonly terminalLogIndex: number;
    readonly txHash: Lowercase<Hex>;
  }): Promise<{ action: QueuedActionRow; calls: StoredCall[] } | undefined> {
    const matching = this.state.actions
      .filter(
        (action) =>
          action.chainId === input.chainId &&
          action.boardroom === input.boardroom &&
          action.actionHash === input.actionHash &&
          (action.queueBlock < input.terminalBlock ||
            (action.queueBlock === input.terminalBlock && action.queueLogIndex <= input.terminalLogIndex)) &&
          action.status === "queued"
      )
      .sort((left, right) => Number(right.queueBlock - left.queueBlock) || right.queueLogIndex - left.queueLogIndex);
    const latest = matching[0];
    if (!latest) {
      const existing = this.state.actions
        .filter(
          (action) =>
            action.chainId === input.chainId &&
            action.boardroom === input.boardroom &&
            action.actionHash === input.actionHash &&
            action.status === input.status &&
            action.resolvedTxHash === input.txHash
        )
        .sort(
          (left, right) => Number(right.queueBlock - left.queueBlock) || right.queueLogIndex - left.queueLogIndex
        )[0];
      return existing === undefined
        ? undefined
        : { action: existing, calls: this.state.calls.get(existing.id) ?? [] };
    }

    const updated: QueuedActionRow = {
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
        createdBlock: item.createdAtBlock,
        executor: existing?.executor ?? (item.owner.toLowerCase() as Lowercase<Address>),
        governanceDelay: existing?.governanceDelay ?? 0n,
        launched: existing?.launched ?? false,
        name: item.name,
        owner: item.owner.toLowerCase() as Lowercase<Address>,
        shareToken: item.shareToken.toLowerCase() as Lowercase<Address>,
        status: existing?.status ?? "prelaunch"
      });
    }
  }

  async updateBoardroomLifecycle(input: {
    readonly boardroom: Lowercase<Address>;
    readonly chainId: number;
    readonly executor?: Lowercase<Address>;
    readonly governanceDelay?: bigint;
    readonly launched?: boolean;
    readonly status?: "prelaunch" | "active" | "winddown";
  }): Promise<void> {
    const existing = this.state.boardrooms.get(input.boardroom);
    if (!existing || existing.chainId !== input.chainId) return;
    this.state.boardrooms.set(input.boardroom, {
      ...existing,
      executor: input.executor ?? existing.executor,
      governanceDelay: input.governanceDelay ?? existing.governanceDelay,
      launched: input.launched ?? existing.launched,
      status: input.status ?? existing.status
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
  return {
    assetPolicy,
    boardroomFactory: factory,
    boardroomPolicyRegistry: policyRegistry,
    chainId
  };
}

function createClient(input: {
  readonly latestBlock: bigint;
  readonly logs: readonly RawLog[];
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

function queuedAction(
  input: Partial<InsertQueuedActionInput> & {
    id: string;
    queueBlock: bigint;
    queueTxHash: Lowercase<Hex>;
  }
): QueuedActionRow {
  const now = new Date();
  return {
    actionHash: input.actionHash ?? actionHash,
    boardroom: input.boardroom ?? boardroom,
    cancelledBy: null,
    chainId: input.chainId ?? chainId,
    createdAt: now,
    decodeStatus: input.decodeStatus ?? "decoded",
    eta: input.eta ?? new Date(1_800_000),
    executedBy: null,
    executor: input.executor ?? executor,
    id: input.id,
    queueBlock: input.queueBlock,
    queueLogIndex: input.queueLogIndex ?? 0,
    queueTxHash: input.queueTxHash,
    rawCalldata: input.rawCalldata ?? queueInput,
    resolvedTxHash: null,
    salt: input.salt ?? salt,
    status: "queued",
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
    policyEvents: new Set(state.policyEvents)
  };
}

function address(value: string): Lowercase<Address> {
  return `0x${value.padStart(40, "0")}` as Lowercase<Address>;
}

function bytes32(value: string): Lowercase<Hex> {
  return `0x${value.padStart(64, "0")}` as Lowercase<Hex>;
}
