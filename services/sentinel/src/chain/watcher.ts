import { setTimeout as sleep } from "node:timers/promises";

import { and, asc, desc, eq } from "drizzle-orm";
import {
  createPublicClient,
  decodeFunctionData,
  encodeFunctionData,
  getAbiItem,
  http,
  isHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient
} from "viem";

import {
  assetPolicyAbi,
  boardroomAbi,
  boardroomPolicyRegistryAbi,
  decodeQueueCalldata,
  discoverBoardrooms,
  getPledgeCashDeployment,
  hashAction,
  hashBatch,
  pledgeCashAbis,
  type BoardroomCall,
  type DecodedQueueInput,
  type DiscoveredBoardroom,
  type GovernanceEvent,
  type PledgeCashDeployment,
  type PledgeCashLogClient
} from "@pledge.cash/sdk";

import { loadConfig, type Config, type SentinelChainConfig } from "../config";
import { createDbClient, type SentinelDb } from "../db/client";
import {
  actionCalls,
  boardrooms,
  cursors,
  policyAdminEvents,
  queuedActions,
  shareBalances,
  type JsonValue
} from "../db/schema";
import type { ActionPipelineEvent, QueuedActionRow, StoredCall } from "../types";
import { advanceCursor, loadCursorWindow, type CursorWindow, type WatcherCursorScope } from "./cursor";
import { applyShareTransfers, queryShareTransfers, type ShareBalanceDeltaInput } from "./holders";

export type PolicyAdminPipelineEvent = Omit<ActionPipelineEvent, "event"> & {
  readonly event: "policy-admin";
};

export type WatcherPipelineEvent = ActionPipelineEvent | PolicyAdminPipelineEvent;

export type WatcherActionEventHandler = (event: WatcherPipelineEvent) => Promise<void> | void;

export type WatcherClient = PledgeCashLogClient &
  Pick<PublicClient, "getBlockNumber" | "getTransaction"> &
  Partial<Pick<PublicClient, "readContract">>;

export type WatcherBoardroom = {
  readonly address: Lowercase<Address>;
  readonly chainId: number;
  readonly createdBlock: bigint;
  readonly executor: Lowercase<Address>;
  readonly governanceDelay: bigint;
  readonly launched: boolean;
  readonly name: string | null;
  readonly owner: Lowercase<Address>;
  readonly shareToken: Lowercase<Address>;
  readonly status: "prelaunch" | "active" | "winddown";
};

export type InsertQueuedActionInput = {
  readonly actionHash: Lowercase<Hex>;
  readonly boardroom: Lowercase<Address>;
  readonly chainId: number;
  readonly decodeStatus: "decoded" | "undecoded";
  readonly eta: Date;
  readonly executor: Lowercase<Address>;
  readonly queueBlock: bigint;
  readonly queueTxHash: Lowercase<Hex>;
  readonly rawCalldata: Hex;
  readonly salt: Lowercase<Hex>;
};

export type InsertActionCallInput = {
  readonly callIndex: number;
  readonly data: Hex;
  readonly decodedArgs: JsonValue | null;
  readonly decodedFunction: string | null;
  readonly policy: Lowercase<Address>;
  readonly selector: Hex;
  readonly target: Lowercase<Address>;
  readonly value: `${bigint}`;
};

export type InsertPolicyAdminEventInput = {
  readonly blockNumber: bigint;
  readonly chainId: number;
  readonly contract: "registry" | "asset-policy";
  readonly enabled: boolean;
  readonly eventName: string;
  readonly logIndex: number;
  readonly subject: Lowercase<Address>;
  readonly txHash: Lowercase<Hex>;
};

export type WatcherStoreTx = {
  applyShareBalanceDelta(input: ShareBalanceDeltaInput): Promise<void>;
  getCursor(chainId: number, scope: WatcherCursorScope): Promise<bigint | undefined>;
  insertActionCalls(actionId: string, calls: readonly InsertActionCallInput[]): Promise<StoredCall[]>;
  insertPolicyAdminEvent(input: InsertPolicyAdminEventInput): Promise<boolean>;
  insertQueuedAction(input: InsertQueuedActionInput): Promise<QueuedActionRow | undefined>;
  listActionCalls(actionId: string): Promise<StoredCall[]>;
  listBoardrooms(chainId: number): Promise<WatcherBoardroom[]>;
  listQueuedActions(chainId: number): Promise<Array<{ action: QueuedActionRow; calls: StoredCall[] }>>;
  setCursor(chainId: number, scope: WatcherCursorScope, blockNumber: bigint): Promise<void>;
  transitionLatestQueuedAction(input: {
    readonly actionHash: Lowercase<Hex>;
    readonly boardroom: Lowercase<Address>;
    readonly caller: Lowercase<Address>;
    readonly chainId: number;
    readonly status: "cancelled" | "executed";
    readonly txHash: Lowercase<Hex>;
  }): Promise<{ action: QueuedActionRow; calls: StoredCall[] } | undefined>;
  upsertBoardrooms(chainId: number, discovered: readonly DiscoveredBoardroom[]): Promise<void>;
  updateBoardroomLifecycle(input: {
    readonly boardroom: Lowercase<Address>;
    readonly chainId: number;
    readonly executor?: Lowercase<Address>;
    readonly governanceDelay?: bigint;
    readonly launched?: boolean;
    readonly status?: "prelaunch" | "active" | "winddown";
  }): Promise<void>;
};

export type WatcherStore = {
  transaction<T>(fn: (tx: WatcherStoreTx) => Promise<T>): Promise<T>;
};

export type RunWatcherOnceOptions = {
  readonly chain?: SentinelChainConfig;
  readonly client?: WatcherClient;
  readonly config?: Pick<Config, "chains" | "databaseUrl" | "maxBlockRange">;
  readonly db?: SentinelDb;
  readonly deployment?: PledgeCashDeployment;
  readonly maxIterations?: number;
  readonly onActionEvent?: WatcherActionEventHandler;
  readonly store?: WatcherStore;
};

export type RunWatcherLoopOptions = RunWatcherOnceOptions & {
  readonly pollIntervalMs?: number;
  readonly signal?: AbortSignal;
};

export type WatcherRunResult = {
  readonly actionEvents: number;
  readonly chainId: number;
  readonly cursorAdvances: number;
  readonly discoveredBoardrooms: number;
  readonly fromSafeHead: bigint;
  readonly governanceEvents: number;
  readonly latestBlock: bigint;
  readonly policyAdminEvents: number;
  readonly scannedWindows: number;
  readonly shareTransfers: number;
  readonly skipped: boolean;
  readonly skipReason?: string;
};

type WatcherPassPlan = {
  readonly boardrooms: WatcherBoardroom[];
  readonly windows: Record<WatcherCursorScope, CursorWindow | undefined>;
};

type PolicyAdminEvent = InsertPolicyAdminEventInput & {
  readonly affectedQueuedActions: boolean;
};

type QueuedDecodeResult =
  | {
      readonly calls: BoardroomCall[];
      readonly decodeStatus: "decoded";
      readonly input: DecodedQueueInput;
    }
  | {
      readonly calls: [];
      readonly decodeStatus: "undecoded";
      readonly input?: undefined;
    };

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;
const DEFAULT_MAX_ITERATIONS = 1_000;
const BOARDROOM_QUERY_CHUNK_SIZE = 500;

const queueActionSelector = encodeFunctionData({
  abi: boardroomAbi,
  functionName: "queueAction",
  args: [
    { policy: ZERO_ADDRESS, target: ZERO_ADDRESS, value: 0n, data: "0x" },
    "0x0000000000000000000000000000000000000000000000000000000000000000"
  ]
}).slice(0, 10) as Hex;

const queueBatchSelector = encodeFunctionData({
  abi: boardroomAbi,
  functionName: "queueBatch",
  args: [[], "0x0000000000000000000000000000000000000000000000000000000000000000"]
}).slice(0, 10) as Hex;

const safeExecTransactionAbi = [
  {
    type: "function",
    name: "execTransaction",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" }
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "payable"
  }
] as const satisfies Abi;

const multicallAbi = [
  {
    type: "function",
    name: "multicall",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "aggregate",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "callData", type: "bytes" }
        ]
      }
    ],
    outputs: [
      { name: "blockNumber", type: "uint256" },
      { name: "returnData", type: "bytes[]" }
    ],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "tryAggregate",
    inputs: [
      { name: "requireSuccess", type: "bool" },
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "callData", type: "bytes" }
        ]
      }
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" }
        ]
      }
    ],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "aggregate3",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" }
        ]
      }
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" }
        ]
      }
    ],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" }
    ],
    outputs: [{ name: "result", type: "bytes" }],
    stateMutability: "payable"
  }
] as const satisfies Abi;

const policyAllowedSetEvent = getAbiItem({ abi: boardroomPolicyRegistryAbi, name: "PolicyAllowedSet" });
const policyStatusSetEvent = getAbiItem({ abi: boardroomPolicyRegistryAbi, name: "PolicyStatusSet" });
const assetAllowedSetEvent = getAbiItem({ abi: assetPolicyAbi, name: "AssetAllowedSet" });
const approvalSpenderAllowedSetEvent = getAbiItem({
  abi: assetPolicyAbi,
  name: "ApprovalSpenderAllowedSet"
});

let defaultActionEventHandler: WatcherActionEventHandler | undefined;

export function setActionEventHandler(handler: WatcherActionEventHandler | undefined): void {
  defaultActionEventHandler = handler;
}

export async function runWatcherOnce(
  chainId: number,
  options: RunWatcherOnceOptions = {}
): Promise<WatcherRunResult> {
  const config = options.config ?? loadConfig();
  const chain = options.chain ?? config.chains.find((candidate) => candidate.chainId === chainId);
  if (!chain) {
    return skippedResult(chainId, `Chain ${chainId} is not present in SENTINEL_CHAIN_IDS`);
  }

  const deployment = options.deployment ?? getPledgeCashDeployment(chainId);
  if (!deployment?.boardroomFactory) {
    return skippedResult(chainId, `No boardroomFactory deployment is available for chain ${chainId}`);
  }

  const ownedDbClient = options.store || options.db ? undefined : createDbClient(config.databaseUrl);
  const store = options.store ?? createDrizzleWatcherStore(options.db ?? ownedDbClient!.db);
  const client = options.client ?? createDefaultClient(chain);
  const latestBlock = await client.getBlockNumber();
  const safeHead = safeHeadFor(latestBlock, chain.confirmations);
  const maxBlockRange = BigInt(config.maxBlockRange);
  const onActionEvent = options.onActionEvent ?? defaultActionEventHandler;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const initialBlock = deploymentStartBlock(deployment);
  const totals = {
    actionEvents: 0,
    cursorAdvances: 0,
    discoveredBoardrooms: 0,
    governanceEvents: 0,
    policyAdminEvents: 0,
    scannedWindows: 0,
    shareTransfers: 0
  };

  try {
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const passInput = {
        chainId,
        client,
        deployment,
        initialBlock,
        maxBlockRange,
        safeHead,
        store,
        ...(onActionEvent ? { onActionEvent } : {})
      };
      const pass = await runWatcherPass(passInput);

      totals.actionEvents += pass.actionEvents;
      totals.cursorAdvances += pass.cursorAdvances;
      totals.discoveredBoardrooms += pass.discoveredBoardrooms;
      totals.governanceEvents += pass.governanceEvents;
      totals.policyAdminEvents += pass.policyAdminEvents;
      totals.scannedWindows += pass.scannedWindows;
      totals.shareTransfers += pass.shareTransfers;

      if (pass.scannedWindows === 0) {
        return {
          ...totals,
          chainId,
          fromSafeHead: safeHead,
          latestBlock,
          skipped: false
        };
      }
    }

    throw new Error(`Watcher did not catch up on chain ${chainId} within ${maxIterations} iterations`);
  } finally {
    if (ownedDbClient) await ownedDbClient.close();
  }
}

export async function runWatcherLoop(chainId: number, options: RunWatcherLoopOptions = {}): Promise<void> {
  const config = options.config ?? loadConfig();
  const pollIntervalMs = options.pollIntervalMs ?? (config as Config).pollIntervalMs ?? 12_000;

  while (!options.signal?.aborted) {
    await runWatcherOnce(chainId, { ...options, config });
    await sleep(pollIntervalMs, undefined, { signal: options.signal });
  }
}

export function createDrizzleWatcherStore(db: SentinelDb): WatcherStore {
  return {
    async transaction<T>(fn: (tx: WatcherStoreTx) => Promise<T>): Promise<T> {
      return db.transaction((tx) => fn(createDrizzleWatcherTx(tx as SentinelDb)));
    }
  };
}

export function decodeQueuedActionCalldata(input: {
  readonly actionHash: Hex;
  readonly expectedSalt: Hex;
  readonly txInput: Hex;
}): QueuedDecodeResult {
  const seen = new Set<string>();
  const candidates = queueCalldataCandidates(input.txInput, seen, 0);

  for (const candidate of candidates) {
    const decoded = decodeQueueCalldata(candidate);
    if (!decoded) continue;
    if (lowerHex(decoded.salt) !== lowerHex(input.expectedSalt)) continue;

    const calls = decoded.kind === "queueAction" ? [decoded.call] : decoded.calls;
    const computed =
      decoded.kind === "queueAction"
        ? hashAction(decoded.call, input.expectedSalt)
        : hashBatch(decoded.calls, input.expectedSalt);

    if (lowerHex(computed) !== lowerHex(input.actionHash)) continue;

    return {
      calls,
      decodeStatus: "decoded",
      input: decoded
    };
  }

  return { calls: [], decodeStatus: "undecoded" };
}

async function runWatcherPass(input: {
  readonly chainId: number;
  readonly client: WatcherClient;
  readonly deployment: PledgeCashDeployment;
  readonly initialBlock: bigint;
  readonly maxBlockRange: bigint;
  readonly onActionEvent?: WatcherActionEventHandler;
  readonly safeHead: bigint;
  readonly store: WatcherStore;
}): Promise<Omit<WatcherRunResult, "chainId" | "fromSafeHead" | "latestBlock" | "skipped" | "skipReason">> {
  const plan = await input.store.transaction((tx) =>
    loadWatcherPassPlan(tx, {
      chainId: input.chainId,
      initialBlock: input.initialBlock,
      maxBlockRange: input.maxBlockRange,
      safeHead: input.safeHead
    })
  );
  const windows = Object.values(plan.windows).filter((window): window is CursorWindow => window !== undefined);
  if (windows.length === 0) {
    return emptyPassResult();
  }

  const discovery = await fetchDiscovery(input.client, input.deployment, plan.windows["factory-discovery"]);
  const boardroomsForGovernance = mergeBoardrooms(plan.boardrooms, discovery.items);
  const governanceEvents = await fetchGovernanceEvents(
    input.client,
    boardroomsForGovernance.map((boardroom) => boardroom.address),
    plan.windows.governance
  );
  const policyAdminEvents = await fetchPolicyAdminEvents(
    input.client,
    input.chainId,
    input.deployment,
    plan.windows.governance
  );
  const shareTransfers = await fetchShareTransfers(
    input.client,
    boardroomsForGovernance.map((boardroom) => boardroom.shareToken),
    plan.windows["share-transfers"]
  );

  const actionEvents = await input.store.transaction(async (tx) => {
    const pendingEvents: WatcherPipelineEvent[] = [];

    await tx.upsertBoardrooms(input.chainId, discovery.items);

    for (const event of governanceEvents) {
      const emitted = await processGovernanceEvent(tx, input.client, input.chainId, event);
      pendingEvents.push(...emitted);
    }

    for (const event of policyAdminEvents) {
      const inserted = await tx.insertPolicyAdminEvent(event);
      if (inserted && event.enabled && event.affectedQueuedActions) {
        const queued = await tx.listQueuedActions(input.chainId);
        pendingEvents.push(...queued.map((item) => ({ ...item, event: "policy-admin" as const })));
      }
    }

    await applyShareTransfers(tx, input.chainId, shareTransfers);

    for (const window of windows) {
      await advanceCursor(tx, input.chainId, window);
    }

    return pendingEvents;
  });

  for (const event of actionEvents) {
    await input.onActionEvent?.(event);
  }

  return {
    actionEvents: actionEvents.length,
    cursorAdvances: windows.length,
    discoveredBoardrooms: discovery.items.length,
    governanceEvents: governanceEvents.length,
    policyAdminEvents: policyAdminEvents.length,
    scannedWindows: windows.length,
    shareTransfers: shareTransfers.length
  };
}

async function loadWatcherPassPlan(
  tx: WatcherStoreTx,
  input: {
    readonly chainId: number;
    readonly initialBlock: bigint;
    readonly maxBlockRange: bigint;
    readonly safeHead: bigint;
  }
): Promise<WatcherPassPlan> {
  const [discovery, governance, transfers, knownBoardrooms] = await Promise.all([
    loadCursorWindow(tx, { ...input, scope: "factory-discovery" }),
    loadCursorWindow(tx, { ...input, scope: "governance" }),
    loadCursorWindow(tx, { ...input, scope: "share-transfers" }),
    tx.listBoardrooms(input.chainId)
  ]);

  return {
    boardrooms: knownBoardrooms,
    windows: {
      "factory-discovery": discovery,
      governance,
      "share-transfers": transfers
    }
  };
}

async function fetchDiscovery(
  client: WatcherClient,
  deployment: PledgeCashDeployment,
  window: CursorWindow | undefined
): Promise<{ items: DiscoveredBoardroom[] }> {
  if (!window || !deployment.boardroomFactory) return { items: [] };

  const result = await discoverBoardrooms(client, {
    factory: deployment.boardroomFactory,
    fromBlock: window.fromBlock,
    toBlock: window.toBlock
  });

  if (!result.complete) {
    throw new Error(result.errors.map((error) => error.message).join(" "));
  }

  return { items: result.items };
}

async function fetchGovernanceEvents(
  client: WatcherClient,
  boardroomAddresses: readonly Address[],
  window: CursorWindow | undefined
): Promise<GovernanceEvent[]> {
  if (!window || boardroomAddresses.length === 0) return [];

  const events: GovernanceEvent[] = [];
  for (const addresses of chunks(uniqueAddresses(boardroomAddresses), BOARDROOM_QUERY_CHUNK_SIZE)) {
    const { queryGovernanceEvents } = await import("@pledge.cash/sdk");
    events.push(
      ...(await queryGovernanceEvents(client, {
        boardrooms: addresses,
        fromBlock: window.fromBlock,
        toBlock: window.toBlock
      }))
    );
  }

  return events.sort(compareGovernanceEvents);
}

async function fetchPolicyAdminEvents(
  client: WatcherClient,
  chainId: number,
  deployment: PledgeCashDeployment,
  window: CursorWindow | undefined
): Promise<PolicyAdminEvent[]> {
  if (!window) return [];

  const events: PolicyAdminEvent[] = [];
  if (deployment.boardroomPolicyRegistry) {
    events.push(
      ...(await getPolicyAdminLogs(client, {
        address: deployment.boardroomPolicyRegistry,
        chainId,
        contract: "registry",
        event: policyAllowedSetEvent,
        eventName: "PolicyAllowedSet",
        fromBlock: window.fromBlock,
        toBlock: window.toBlock,
        subjectKey: "policy"
      }))
    );
    events.push(
      ...(await getPolicyAdminLogs(client, {
        address: deployment.boardroomPolicyRegistry,
        chainId,
        contract: "registry",
        event: policyStatusSetEvent,
        eventName: "PolicyStatusSet",
        fromBlock: window.fromBlock,
        statusKey: "status",
        subjectKey: "policy",
        toBlock: window.toBlock
      }))
    );
  }

  if (deployment.assetPolicy) {
    events.push(
      ...(await getPolicyAdminLogs(client, {
        address: deployment.assetPolicy,
        chainId,
        contract: "asset-policy",
        event: assetAllowedSetEvent,
        eventName: "AssetAllowedSet",
        fromBlock: window.fromBlock,
        subjectKey: "asset",
        toBlock: window.toBlock
      }))
    );
    events.push(
      ...(await getPolicyAdminLogs(client, {
        address: deployment.assetPolicy,
        chainId,
        contract: "asset-policy",
        event: approvalSpenderAllowedSetEvent,
        eventName: "ApprovalSpenderAllowedSet",
        fromBlock: window.fromBlock,
        subjectKey: "spender",
        toBlock: window.toBlock
      }))
    );
  }

  return events.sort(comparePolicyAdminEvents);
}

async function fetchShareTransfers(
  client: WatcherClient,
  shareTokens: readonly Address[],
  window: CursorWindow | undefined
) {
  if (!window) return [];
  return queryShareTransfers(client, {
    tokens: shareTokens,
    fromBlock: window.fromBlock,
    toBlock: window.toBlock
  });
}

async function processGovernanceEvent(
  tx: WatcherStoreTx,
  client: WatcherClient,
  chainId: number,
  event: GovernanceEvent
): Promise<WatcherPipelineEvent[]> {
  const boardroom = lowerAddress(event.boardroom);

  if (event.kind === "launched") {
    await tx.updateBoardroomLifecycle({
      boardroom,
      chainId,
      executor: lowerAddress(event.executor),
      governanceDelay: event.governanceDelay,
      launched: true,
      status: "active"
    });
    return [];
  }

  if (event.kind === "executorSet") {
    await tx.updateBoardroomLifecycle({
      boardroom,
      chainId,
      executor: lowerAddress(event.executor)
    });
    return [];
  }

  if (event.kind === "windDownStarted") {
    await tx.updateBoardroomLifecycle({
      boardroom,
      chainId,
      status: "winddown"
    });
    return [];
  }

  if (event.kind === "actionQueued") {
    const txInput = await transactionInput(client, event.transactionHash);
    const decoded = decodeQueuedActionCalldata({
      actionHash: event.actionHash,
      expectedSalt: event.salt,
      txInput
    });
    const action = await tx.insertQueuedAction({
      actionHash: lowerHex(event.actionHash),
      boardroom,
      chainId,
      decodeStatus: decoded.decodeStatus,
      eta: new Date(Number(event.eta) * 1000),
      executor: lowerAddress(event.executor),
      queueBlock: event.blockNumber,
      queueTxHash: lowerHex(event.transactionHash),
      rawCalldata: txInput,
      salt: lowerHex(event.salt)
    });

    if (!action) return [];

    const calls = await tx.insertActionCalls(
      action.id,
      decoded.calls.map((call, callIndex) => storedCallInput(call, callIndex))
    );
    return [{ action, calls, event: "queued" }];
  }

  if (event.kind === "actionCancelled" || event.kind === "actionExecuted") {
    const transitioned = await tx.transitionLatestQueuedAction({
      actionHash: lowerHex(event.actionHash),
      boardroom,
      caller: lowerAddress(event.caller),
      chainId,
      status: event.kind === "actionCancelled" ? "cancelled" : "executed",
      txHash: lowerHex(event.transactionHash)
    });
    return transitioned ? [{ ...transitioned, event: transitioned.action.status }] : [];
  }

  return [];
}

function createDrizzleWatcherTx(db: SentinelDb): WatcherStoreTx {
  return {
    async applyShareBalanceDelta(input: ShareBalanceDeltaInput): Promise<void> {
      const [existing] = await db
        .select({ balance: shareBalances.balance })
        .from(shareBalances)
        .where(
          and(
            eq(shareBalances.chainId, input.chainId),
            eq(shareBalances.token, input.token),
            eq(shareBalances.holder, input.holder)
          )
        )
        .limit(1);
      const current = existing ? BigInt(existing.balance) : 0n;
      const next = current + input.delta;

      if (existing) {
        await db
          .update(shareBalances)
          .set({ balance: next.toString(), updatedBlock: input.blockNumber })
          .where(
            and(
              eq(shareBalances.chainId, input.chainId),
              eq(shareBalances.token, input.token),
              eq(shareBalances.holder, input.holder)
            )
          );
      } else {
        await db.insert(shareBalances).values({
          balance: next.toString(),
          chainId: input.chainId,
          holder: input.holder,
          token: input.token,
          updatedBlock: input.blockNumber
        });
      }
    },
    async getCursor(chainId: number, scope: WatcherCursorScope): Promise<bigint | undefined> {
      const [row] = await db
        .select({ blockNumber: cursors.blockNumber })
        .from(cursors)
        .where(and(eq(cursors.chainId, chainId), eq(cursors.scope, scope)))
        .limit(1);
      return row?.blockNumber;
    },
    async insertActionCalls(actionId: string, calls: readonly InsertActionCallInput[]): Promise<StoredCall[]> {
      if (calls.length === 0) return [];

      await db
        .insert(actionCalls)
        .values(calls.map((call) => ({ ...call, actionId })))
        .onConflictDoNothing();

      return this.listActionCalls(actionId);
    },
    async insertPolicyAdminEvent(input: InsertPolicyAdminEventInput): Promise<boolean> {
      const inserted = await db
        .insert(policyAdminEvents)
        .values({
          blockNumber: input.blockNumber,
          chainId: input.chainId,
          contract: input.contract,
          enabled: input.enabled,
          eventName: input.eventName,
          logIndex: input.logIndex,
          subject: input.subject,
          txHash: input.txHash
        })
        .onConflictDoNothing()
        .returning({ id: policyAdminEvents.id });

      return inserted.length > 0;
    },
    async insertQueuedAction(input: InsertQueuedActionInput): Promise<QueuedActionRow | undefined> {
      const inserted = await db
        .insert(queuedActions)
        .values({
          actionHash: input.actionHash,
          boardroom: input.boardroom,
          chainId: input.chainId,
          decodeStatus: input.decodeStatus,
          eta: input.eta,
          executor: input.executor,
          queueBlock: input.queueBlock,
          queueTxHash: input.queueTxHash,
          rawCalldata: input.rawCalldata,
          salt: input.salt
        })
        .onConflictDoNothing()
        .returning();
      return inserted[0];
    },
    async listActionCalls(actionId: string): Promise<StoredCall[]> {
      const rows = await db
        .select()
        .from(actionCalls)
        .where(eq(actionCalls.actionId, actionId))
        .orderBy(asc(actionCalls.callIndex));
      return rows.map(toStoredCall);
    },
    async listBoardrooms(chainId: number): Promise<WatcherBoardroom[]> {
      const rows = await db.select().from(boardrooms).where(eq(boardrooms.chainId, chainId));
      return rows.map((row) => ({
        address: row.address as Lowercase<Address>,
        chainId: row.chainId,
        createdBlock: row.createdBlock,
        executor: row.executor as Lowercase<Address>,
        governanceDelay: row.governanceDelay,
        launched: row.launched,
        name: row.name,
        owner: row.owner as Lowercase<Address>,
        shareToken: row.shareToken as Lowercase<Address>,
        status: row.status
      }));
    },
    async listQueuedActions(chainId: number): Promise<Array<{ action: QueuedActionRow; calls: StoredCall[] }>> {
      const rows = await db
        .select()
        .from(queuedActions)
        .where(and(eq(queuedActions.chainId, chainId), eq(queuedActions.status, "queued")))
        .orderBy(desc(queuedActions.queueBlock), desc(queuedActions.createdAt));
      return Promise.all(
        rows.map(async (action) => ({
          action,
          calls: await this.listActionCalls(action.id)
        }))
      );
    },
    async setCursor(chainId: number, scope: WatcherCursorScope, blockNumber: bigint): Promise<void> {
      await db
        .insert(cursors)
        .values({ blockNumber, chainId, scope, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [cursors.chainId, cursors.scope],
          set: { blockNumber, updatedAt: new Date() }
        });
    },
    async transitionLatestQueuedAction(input: {
      readonly actionHash: Lowercase<Hex>;
      readonly boardroom: Lowercase<Address>;
      readonly caller: Lowercase<Address>;
      readonly chainId: number;
      readonly status: "cancelled" | "executed";
      readonly txHash: Lowercase<Hex>;
    }): Promise<{ action: QueuedActionRow; calls: StoredCall[] } | undefined> {
      const [pending] = await db
        .select({ id: queuedActions.id })
        .from(queuedActions)
        .where(
          and(
            eq(queuedActions.chainId, input.chainId),
            eq(queuedActions.boardroom, input.boardroom),
            eq(queuedActions.actionHash, input.actionHash),
            eq(queuedActions.status, "queued")
          )
        )
        .orderBy(desc(queuedActions.queueBlock), desc(queuedActions.createdAt))
        .limit(1);
      if (!pending) return undefined;

      const updates =
        input.status === "cancelled"
          ? { cancelledBy: input.caller, resolvedTxHash: input.txHash, status: input.status, updatedAt: new Date() }
          : { executedBy: input.caller, resolvedTxHash: input.txHash, status: input.status, updatedAt: new Date() };

      const [action] = await db
        .update(queuedActions)
        .set(updates)
        .where(eq(queuedActions.id, pending.id))
        .returning();
      if (!action) return undefined;

      return {
        action,
        calls: await this.listActionCalls(action.id)
      };
    },
    async upsertBoardrooms(chainId: number, discovered: readonly DiscoveredBoardroom[]): Promise<void> {
      for (const item of discovered) {
        await db
          .insert(boardrooms)
          .values({
            address: lowerAddress(item.boardroom),
            chainId,
            createdBlock: item.createdAtBlock,
            executor: lowerAddress(item.owner),
            governanceDelay: 0n,
            launched: false,
            name: item.name,
            owner: lowerAddress(item.owner),
            shareToken: lowerAddress(item.shareToken),
            status: "prelaunch"
          })
          .onConflictDoUpdate({
            target: [boardrooms.chainId, boardrooms.address],
            set: {
              createdBlock: item.createdAtBlock,
              name: item.name,
              owner: lowerAddress(item.owner),
              shareToken: lowerAddress(item.shareToken),
              updatedAt: new Date()
            }
          });
      }
    },
    async updateBoardroomLifecycle(input: {
      readonly boardroom: Lowercase<Address>;
      readonly chainId: number;
      readonly executor?: Lowercase<Address>;
      readonly governanceDelay?: bigint;
      readonly launched?: boolean;
      readonly status?: "prelaunch" | "active" | "winddown";
    }): Promise<void> {
      const set = withoutUndefined({
        executor: input.executor,
        governanceDelay: input.governanceDelay,
        launched: input.launched,
        status: input.status,
        updatedAt: new Date()
      });
      if (Object.keys(set).length === 1) return;

      await db
        .update(boardrooms)
        .set(set)
        .where(and(eq(boardrooms.chainId, input.chainId), eq(boardrooms.address, input.boardroom)));
    }
  };
}

function storedCallInput(call: BoardroomCall, callIndex: number): InsertActionCallInput {
  const decoded = decodeKnownCall(call.data);
  return {
    callIndex,
    data: call.data,
    decodedArgs: decoded.decodedArgs,
    decodedFunction: decoded.decodedFunction,
    policy: lowerAddress(call.policy),
    selector: selectorOf(call.data),
    target: lowerAddress(call.target),
    value: call.value.toString() as `${bigint}`
  };
}

function decodeKnownCall(data: Hex): { decodedArgs: JsonValue | null; decodedFunction: string | null } {
  if (data.length < 10) return { decodedArgs: null, decodedFunction: null };

  for (const [contractName, abi] of Object.entries(pledgeCashAbis)) {
    try {
      const decoded = decodeFunctionData({ abi: abi as Abi, data });
      return {
        decodedArgs: toJson(decoded.args ?? []) as JsonValue,
        decodedFunction: `${contractName}.${decoded.functionName}`
      };
    } catch {
      // Try the next known ABI.
    }
  }

  return { decodedArgs: null, decodedFunction: null };
}

function queueCalldataCandidates(input: Hex, seen: Set<string>, depth: number): Hex[] {
  if (seen.has(input) || depth > 4) return [];
  seen.add(input);

  const candidates: Hex[] = [input];
  for (const unwrapped of unwrapCalldata(input)) {
    candidates.push(...queueCalldataCandidates(unwrapped, seen, depth + 1));
  }
  candidates.push(...scanForQueueSelectors(input));

  return candidates;
}

function unwrapCalldata(data: Hex): Hex[] {
  const unwrapped: Hex[] = [];

  try {
    const decoded = decodeFunctionData({ abi: safeExecTransactionAbi, data });
    const args = decoded.args as readonly unknown[] | undefined;
    const inner = hexValue(args?.[2]);
    if (inner) unwrapped.push(inner);
  } catch {
    // Not a Safe execTransaction payload.
  }

  try {
    const decoded = decodeFunctionData({ abi: multicallAbi, data });
    const args = decoded.args as readonly unknown[] | undefined;
    if (decoded.functionName === "multicall") {
      unwrapped.push(...hexArray(args?.[0]));
    } else if (decoded.functionName === "aggregate" || decoded.functionName === "aggregate3") {
      unwrapped.push(...tupleCallData(args?.[0]));
    } else if (decoded.functionName === "tryAggregate") {
      unwrapped.push(...tupleCallData(args?.[1]));
    } else if (decoded.functionName === "execute") {
      const inner = hexValue(args?.[2]);
      if (inner) unwrapped.push(inner);
    }
  } catch {
    // Not one of the supported multicall wrapper shapes.
  }

  return unwrapped;
}

function scanForQueueSelectors(data: Hex): Hex[] {
  const body = data.slice(2).toLowerCase();
  const selectors = [queueActionSelector, queueBatchSelector].map((selector) => selector.slice(2).toLowerCase());
  const candidates: Hex[] = [];

  for (const selector of selectors) {
    let index = body.indexOf(selector);
    while (index !== -1) {
      if (index % 2 === 0) {
        candidates.push(`0x${body.slice(index)}` as Hex);
      }
      index = body.indexOf(selector, index + 2);
    }
  }

  return candidates;
}

async function transactionInput(client: WatcherClient, hash: Hex): Promise<Hex> {
  const tx = (await client.getTransaction({ hash } as never)) as { input?: unknown; data?: unknown };
  const input = tx.input ?? tx.data;
  return typeof input === "string" && isHex(input) ? input : "0x";
}

async function getPolicyAdminLogs(
  client: WatcherClient,
  input: {
    readonly address: Address;
    readonly chainId: number;
    readonly contract: "registry" | "asset-policy";
    readonly event: unknown;
    readonly eventName: string;
    readonly fromBlock: bigint;
    readonly statusKey?: string;
    readonly subjectKey: string;
    readonly toBlock: bigint;
  }
): Promise<PolicyAdminEvent[]> {
  const logs = (await client.getLogs({
    address: input.address,
    event: input.event,
    fromBlock: input.fromBlock,
    toBlock: input.toBlock
  } as never)) as Array<{
    args?: Record<string, unknown>;
    blockNumber?: bigint;
    logIndex?: number;
    transactionHash?: Hex;
  }>;

  return logs.flatMap((log) => maybeArray(toPolicyAdminEvent(log, input)));
}

function toPolicyAdminEvent(
  log: {
    args?: Record<string, unknown>;
    blockNumber?: bigint;
    logIndex?: number;
    transactionHash?: Hex;
  },
  input: {
    readonly chainId: number;
    readonly contract: "registry" | "asset-policy";
    readonly eventName: string;
    readonly statusKey?: string;
    readonly subjectKey: string;
  }
): PolicyAdminEvent | undefined {
  if (log.blockNumber === undefined || log.logIndex === undefined || !log.transactionHash) return undefined;
  const args = log.args ?? {};
  const subject = addressValue(args[input.subjectKey]);
  if (!subject) return undefined;

  const enabled =
    input.statusKey === undefined
      ? booleanValue(args.allowed) === true
      : bigintValue(args[input.statusKey]) !== 0n;

  return {
    affectedQueuedActions: true,
    blockNumber: log.blockNumber,
    chainId: input.chainId,
    contract: input.contract,
    enabled,
    eventName: input.eventName,
    logIndex: log.logIndex,
    subject: lowerAddress(subject),
    txHash: lowerHex(log.transactionHash)
  };
}

function mergeBoardrooms(
  existing: readonly WatcherBoardroom[],
  discovered: readonly DiscoveredBoardroom[]
): WatcherBoardroom[] {
  const byAddress = new Map<string, WatcherBoardroom>();
  for (const boardroom of existing) byAddress.set(boardroom.address, boardroom);
  for (const item of discovered) {
    byAddress.set(lowerAddress(item.boardroom), {
      address: lowerAddress(item.boardroom),
      chainId: 0,
      createdBlock: item.createdAtBlock,
      executor: lowerAddress(item.owner),
      governanceDelay: 0n,
      launched: false,
      name: item.name,
      owner: lowerAddress(item.owner),
      shareToken: lowerAddress(item.shareToken),
      status: "prelaunch"
    });
  }
  return [...byAddress.values()];
}

function toStoredCall(row: typeof actionCalls.$inferSelect): StoredCall {
  return {
    ...row,
    decodedArgs: row.decodedArgs ?? null,
    value: row.value as `${bigint}`
  };
}

function createDefaultClient(chain: SentinelChainConfig): WatcherClient {
  return createPublicClient({ transport: http(chain.rpcUrl) }) as WatcherClient;
}

function safeHeadFor(latestBlock: bigint, confirmations: number): bigint {
  const lag = BigInt(confirmations);
  return latestBlock > lag ? latestBlock - lag : 0n;
}

function deploymentStartBlock(deployment: PledgeCashDeployment): bigint {
  const raw = deployment as PledgeCashDeployment & {
    blockNumber?: bigint | number | string;
    deploymentBlock?: bigint | number | string;
    startBlock?: bigint | number | string;
  };
  return blockValue(raw.startBlock ?? raw.deploymentBlock ?? raw.blockNumber) ?? 0n;
}

function blockValue(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return undefined;
}

function skippedResult(chainId: number, skipReason: string): WatcherRunResult {
  return {
    actionEvents: 0,
    chainId,
    cursorAdvances: 0,
    discoveredBoardrooms: 0,
    fromSafeHead: 0n,
    governanceEvents: 0,
    latestBlock: 0n,
    policyAdminEvents: 0,
    scannedWindows: 0,
    shareTransfers: 0,
    skipped: true,
    skipReason
  };
}

function emptyPassResult(): Omit<
  WatcherRunResult,
  "chainId" | "fromSafeHead" | "latestBlock" | "skipped" | "skipReason"
> {
  return {
    actionEvents: 0,
    cursorAdvances: 0,
    discoveredBoardrooms: 0,
    governanceEvents: 0,
    policyAdminEvents: 0,
    scannedWindows: 0,
    shareTransfers: 0
  };
}

function uniqueAddresses(addresses: readonly Address[]): Address[] {
  return [...new Map(addresses.map((address) => [address.toLowerCase(), address])).values()];
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function compareGovernanceEvents(left: GovernanceEvent, right: GovernanceEvent): number {
  if (left.blockNumber < right.blockNumber) return -1;
  if (left.blockNumber > right.blockNumber) return 1;
  return left.logIndex - right.logIndex;
}

function comparePolicyAdminEvents(left: PolicyAdminEvent, right: PolicyAdminEvent): number {
  if (left.blockNumber < right.blockNumber) return -1;
  if (left.blockNumber > right.blockNumber) return 1;
  return left.logIndex - right.logIndex;
}

function selectorOf(data: Hex): Hex {
  return data.length >= 10 ? (data.slice(0, 10) as Hex) : "0x";
}

function hexArray(value: unknown): Hex[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Hex => typeof item === "string" && isHex(item));
}

function tupleCallData(value: unknown): Hex[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const fields = item as Record<string, unknown>;
    const tuple = Array.isArray(item) ? item : undefined;
    const data = hexValue(fields.callData ?? tuple?.[1] ?? tuple?.[2]);
    return data ? [data] : [];
  });
}

function addressValue(value: unknown): Address | undefined {
  return typeof value === "string" ? (value as Address) : undefined;
}

function hexValue(value: unknown): Hex | undefined {
  return typeof value === "string" && isHex(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function bigintValue(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  return undefined;
}

function lowerAddress(address: Address): Lowercase<Address> {
  return address.toLowerCase() as Lowercase<Address>;
}

function lowerHex(hex: Hex): Lowercase<Hex> {
  return hex.toLowerCase() as Lowercase<Hex>;
}

function maybeArray<T>(value: T | undefined): T[] {
  return value === undefined ? [] : [value];
}

function toJson(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => toJson(item));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJson(item)]));
  }
  return String(value);
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}
