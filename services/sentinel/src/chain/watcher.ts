import { setTimeout as sleep } from "node:timers/promises";

import { and, asc, desc, eq, gt, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import {
  createPublicClient,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAbiItem,
  http,
  isHex,
  keccak256,
  type Abi,
  type Address,
  type Hex,
  type PublicClient
} from "viem";

import {
  assetPolicyAbi,
  boardroomReleaseSupport,
  boardroomControllerAbi,
  boardroomPolicyRegistryAbi,
  discoverBoardrooms,
  getPledgeCashDeployment,
  pledgeCashAbis,
  protocolFacetRegistryAbi,
  type BoardroomCall,
  type DiscoveredBoardroom,
  type PledgeCashDeployment,
  type PledgeCashLogClient
} from "@pledge.cash/sdk";

import { loadConfig, type Config, type SentinelChainConfig } from "../config";
import { createDbClient, type SentinelDb } from "../db/client";
import {
  actionCalls,
  boardrooms,
  cursors,
  marketLifecycleEvents,
  policyAdminEvents,
  scheduledOperations,
  shareBalances,
  type JsonValue
} from "../db/schema";
import type { ActionPipelineEvent, ScheduledOperationRow, StoredCall } from "../types";
import { advanceCursor, loadCursorWindow, type CursorWindow, type WatcherCursorScope } from "./cursor";
import {
  aggregateShareBalanceDeltas,
  applyShareTransfers,
  queryShareTransfers,
  type ShareBalanceDeltaInput
} from "./holders";
import { SUPPORTED_BOARDROOM_CONTROL_RELEASE } from "./boardroom-control";
import {
  queryExternalGovernanceEvents,
  type GovernanceEvent
} from "./governance-events";
import {
  marketStateUpdateForEvent,
  queryMarketLifecycleEvents,
  type BoardroomMarketStateUpdate,
  type MarketLifecycleEvent
} from "./market-events";

export type PolicyAdminPipelineEvent = Omit<ActionPipelineEvent, "event"> & {
  readonly event: "policy-admin";
  readonly eventId: string;
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
  readonly controller: Lowercase<Address>;
  readonly proposer: Lowercase<Address>;
  readonly controllerGeneration: bigint;
  readonly configurationEpoch: bigint;
  readonly controllerDelay: bigint;
  readonly gracePeriod: bigint;
  readonly windDownDelay: bigint;
  readonly launched: boolean;
  readonly name: string | null;
  readonly owner: Lowercase<Address>;
  readonly shareToken: Lowercase<Address>;
  readonly status: "prelaunch" | "active" | "winddown" | "snapshotting" | "redemptions-open";
  readonly primaryMarketMode: number;
  readonly bondingCurve: Lowercase<Address> | null;
  readonly primaryMarketQuoteAsset: Lowercase<Address> | null;
  readonly bondingCurvePhase: number | null;
  readonly bondingCurveSettlementReason: number | null;
  readonly bondingCurvePhaseEndsAt: bigint;
  readonly liquidityStatus: number;
  readonly liquidityVault: Lowercase<Address> | null;
  readonly liquidityPoolId: Lowercase<Hex> | null;
  readonly liquidityQuoteAsset: Lowercase<Address> | null;
  readonly liquidityReservationCurve: Lowercase<Address> | null;
  readonly liquidityReservationExpectedVault: Lowercase<Address> | null;
  readonly liquidityReservationExpectedPoolId: Lowercase<Hex> | null;
  readonly liquidityReservationPairKey: Lowercase<Hex> | null;
  readonly liquidityReservationSalt: Lowercase<Hex> | null;
  readonly liquidityReservationExpiresAt: bigint;
};

export type InsertScheduledOperationInput = {
  readonly operationId: Lowercase<Hex>;
  readonly boardroom: Lowercase<Address>;
  readonly chainId: number;
  readonly configurationEpoch: bigint;
  readonly controller: Lowercase<Address>;
  readonly controllerGeneration: bigint;
  readonly decodeStatus: "decoded" | "undecoded";
  readonly boardroomEpoch: bigint;
  readonly eta: Date;
  readonly expiresAt: Date;
  readonly facetSetHash: Lowercase<Hex>;
  readonly operationKind: "boardroom" | "controller";
  readonly proposer: Lowercase<Address>;
  readonly scheduleBlock: bigint;
  readonly scheduleLogIndex: number;
  readonly scheduleTxHash: Lowercase<Hex>;
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
  applyShareBalanceDeltas(inputs: readonly ShareBalanceDeltaInput[]): Promise<void>;
  getCursor(chainId: number, scope: WatcherCursorScope): Promise<bigint | undefined>;
  invalidateScheduledOperationsBeforeEpoch(input: {
    readonly boardroom: Lowercase<Address>;
    readonly chainId: number;
    readonly epoch: bigint;
    readonly terminalBlock: bigint;
    readonly terminalLogIndex: number;
    readonly txHash: Lowercase<Hex>;
  }): Promise<Array<{ action: ScheduledOperationRow; calls: StoredCall[] }>>;
  invalidateScheduledOperationsBeforeConfigurationEpoch(input: {
    readonly boardroom: Lowercase<Address>;
    readonly chainId: number;
    readonly configurationEpoch: bigint;
    readonly controller: Lowercase<Address>;
    readonly terminalBlock: bigint;
    readonly terminalLogIndex: number;
    readonly txHash: Lowercase<Hex>;
  }): Promise<Array<{ action: ScheduledOperationRow; calls: StoredCall[] }>>;
  invalidateScheduledOperationsBeforeFacetSetActivation(input: {
    readonly chainId: number;
    readonly facetSetHash: Lowercase<Hex>;
    readonly terminalBlock: bigint;
    readonly terminalLogIndex: number;
    readonly txHash: Lowercase<Hex>;
  }): Promise<Array<{ action: ScheduledOperationRow; calls: StoredCall[] }>>;
  insertActionCalls(actionId: string, calls: readonly InsertActionCallInput[]): Promise<StoredCall[]>;
  insertMarketLifecycleEvent(input: MarketLifecycleEvent & { readonly chainId: number }): Promise<boolean>;
  insertPolicyAdminEvent(input: InsertPolicyAdminEventInput): Promise<boolean>;
  insertScheduledOperation(input: InsertScheduledOperationInput): Promise<ScheduledOperationRow | undefined>;
  listActionCalls(actionId: string): Promise<StoredCall[]>;
  listBoardrooms(chainId: number): Promise<WatcherBoardroom[]>;
  listScheduledOperations(chainId: number): Promise<Array<{ action: ScheduledOperationRow; calls: StoredCall[] }>>;
  setCursor(chainId: number, scope: WatcherCursorScope, blockNumber: bigint): Promise<void>;
  transitionLatestScheduledOperation(input: {
    readonly operationId: Lowercase<Hex>;
    readonly boardroom: Lowercase<Address>;
    readonly controller: Lowercase<Address>;
    readonly caller: Lowercase<Address>;
    readonly chainId: number;
    readonly status: "cancelled" | "executed";
    readonly terminalBlock: bigint;
    readonly terminalLogIndex: number;
    readonly txHash: Lowercase<Hex>;
  }): Promise<{ action: ScheduledOperationRow; calls: StoredCall[] } | undefined>;
  upsertBoardrooms(chainId: number, discovered: readonly DiscoveredBoardroom[]): Promise<void>;
  updateBoardroomLifecycle(input: {
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
  }): Promise<void>;
  updateBoardroomMarketState(input: BoardroomMarketStateUpdate & { readonly chainId: number }): Promise<void>;
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
  readonly marketLifecycleEvents: number;
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
  readonly affectedScheduledOperations: boolean;
};

type FacetSetActivationEvent = {
  readonly blockNumber: bigint;
  readonly facetSetHash: Lowercase<Hex>;
  readonly logIndex: number;
  readonly transactionHash: Lowercase<Hex>;
};

type PositionedPipelineEvent = {
  readonly blockNumber: bigint;
  readonly event: WatcherPipelineEvent;
  readonly logIndex: number;
};

type ScheduledDecodeResult =
  | {
      readonly calls: BoardroomCall[];
      readonly decodeStatus: "decoded";
      readonly input: DecodedScheduleInput;
    }
  | {
      readonly calls: [];
      readonly decodeStatus: "undecoded";
      readonly input?: undefined;
    };

type DecodedScheduleInput =
  | { readonly kind: "boardroom"; readonly calls: BoardroomCall[] }
  | { readonly kind: "controller"; readonly data: Hex };

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;
const DEFAULT_MAX_ITERATIONS = 1_000;
const BOARDROOM_QUERY_CHUNK_SIZE = 500;

const scheduleBoardroomOperationSelector = encodeFunctionData({
  abi: boardroomControllerAbi,
  functionName: "scheduleBoardroomOperation",
  args: [
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    [],
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    0n,
    0n
  ]
}).slice(0, 10) as Hex;

const scheduleControllerOperationSelector = encodeFunctionData({
  abi: boardroomControllerAbi,
  functionName: "scheduleControllerOperation",
  args: [
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    "0x",
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    0n,
    0n
  ]
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
const modulePolicyRegisteredEvent = getAbiItem({ abi: boardroomPolicyRegistryAbi, name: "ModulePolicyRegistered" });
const assetAllowedSetEvent = getAbiItem({ abi: assetPolicyAbi, name: "AssetAllowedSet" });
const approvalSpenderAllowedSetEvent = getAbiItem({
  abi: assetPolicyAbi,
  name: "ApprovalSpenderAllowedSet"
});
const facetSetActivatedEvent = getAbiItem({
  abi: protocolFacetRegistryAbi,
  name: "FacetSetActivated"
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
  const releaseSupport = boardroomReleaseSupport(deployment);
  if (
    !releaseSupport.supported ||
    deployment?.protocolVersion !== SUPPORTED_BOARDROOM_CONTROL_RELEASE ||
    !deployment.boardroomFactory
  ) {
    return skippedResult(
      chainId,
      releaseSupport.reason ??
        `No supported canonical Boardroom release is available for chain ${chainId}`
    );
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
    marketLifecycleEvents: 0,
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
      totals.marketLifecycleEvents += pass.marketLifecycleEvents;
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

export function decodeScheduledOperationCalldata(input: {
  readonly controller: Address;
  readonly expectedBoardroomEpoch: bigint;
  readonly expectedConfigurationEpoch: bigint;
  readonly expectedFacetSetHash: Hex;
  readonly expectedPayloadHash: Hex;
  readonly expectedSalt: Hex;
  readonly operationKind: "boardroom" | "controller";
  readonly txInput: Hex;
}): ScheduledDecodeResult {
  const seen = new Set<string>();
  const candidates = scheduleCalldataCandidates(input.txInput, seen, 0);

  for (const candidate of candidates) {
    const decoded = decodeScheduleCalldata(candidate);
    if (!decoded) continue;
    if (decoded.input.kind !== input.operationKind) continue;
    if (lowerHex(decoded.facetSetHash) !== lowerHex(input.expectedFacetSetHash)) continue;
    if (lowerHex(decoded.salt) !== lowerHex(input.expectedSalt)) continue;
    if (decoded.boardroomEpoch !== input.expectedBoardroomEpoch) continue;
    if (decoded.configurationEpoch !== input.expectedConfigurationEpoch) continue;
    if (lowerHex(decoded.payloadHash) !== lowerHex(input.expectedPayloadHash)) continue;

    return {
      calls:
        decoded.input.kind === "boardroom"
          ? decoded.input.calls
          : [{ policy: ZERO_ADDRESS, target: input.controller, value: 0n, data: decoded.input.data }],
      decodeStatus: "decoded",
      input: decoded.input
    };
  }

  return { calls: [], decodeStatus: "undecoded" };
}

function decodeScheduleCalldata(data: Hex):
  | {
      readonly boardroomEpoch: bigint;
      readonly configurationEpoch: bigint;
      readonly facetSetHash: Hex;
      readonly input: DecodedScheduleInput;
      readonly payloadHash: Hex;
      readonly salt: Hex;
    }
  | undefined {
  try {
    const decoded = decodeFunctionData({ abi: boardroomControllerAbi, data });
    const args = decoded.args as readonly unknown[] | undefined;
    if (decoded.functionName === "scheduleBoardroomOperation") {
      const facetSetHash = hexValue(args?.[0]);
      const calls = normalizeBoardroomCalls(args?.[1]);
      const salt = hexValue(args?.[2]);
      const boardroomEpoch = bigintValue(args?.[3]);
      const configurationEpoch = bigintValue(args?.[4]);
      if (
        !facetSetHash ||
        !calls ||
        !salt ||
        boardroomEpoch === undefined ||
        configurationEpoch === undefined
      ) return undefined;
      return {
        boardroomEpoch,
        configurationEpoch,
        facetSetHash,
        input: { kind: "boardroom", calls },
        payloadHash: keccak256(
          encodeAbiParameters(
            [
              {
                name: "calls",
                type: "tuple[]",
                components: [
                  { name: "policy", type: "address" },
                  { name: "target", type: "address" },
                  { name: "value", type: "uint256" },
                  { name: "data", type: "bytes" }
                ]
              }
            ],
            [calls]
          )
        ),
        salt
      };
    }
    if (decoded.functionName === "scheduleControllerOperation") {
      const facetSetHash = hexValue(args?.[0]);
      const selfData = hexValue(args?.[1]);
      const salt = hexValue(args?.[2]);
      const boardroomEpoch = bigintValue(args?.[3]);
      const configurationEpoch = bigintValue(args?.[4]);
      if (
        !facetSetHash ||
        !selfData ||
        !salt ||
        boardroomEpoch === undefined ||
        configurationEpoch === undefined
      ) return undefined;
      return {
        boardroomEpoch,
        configurationEpoch,
        facetSetHash,
        input: { kind: "controller", data: selfData },
        payloadHash: keccak256(selfData),
        salt
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
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
    boardroomsForGovernance,
    plan.windows.governance
  );
  const marketEvents = await fetchMarketEvents(
    input.client,
    input.deployment,
    boardroomsForGovernance,
    plan.windows.governance
  );
  const policyAdminEvents = await fetchPolicyAdminEvents(
    input.client,
    input.chainId,
    input.deployment,
    plan.windows.governance
  );
  const facetSetActivationEvents = await fetchFacetSetActivationEvents(
    input.client,
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
    const governancePipelineEvents: PositionedPipelineEvent[] = [];
    const epochEvents: Extract<GovernanceEvent, { kind: "governanceEpochAdvanced" }>[] = [];
    const configurationEvents: Extract<GovernanceEvent, { kind: "configurationUpdated" }>[] = [];
    const vetoStakers = new Map<string, Lowercase<Address>>();
    const notifiedPolicyChanges = new Set<string>();

    await tx.upsertBoardrooms(input.chainId, discovery.items);

    for (const event of marketEvents) {
      if (!(await tx.insertMarketLifecycleEvent({ ...event, chainId: input.chainId }))) continue;
      const update = marketStateUpdateForEvent(event);
      if (update) await tx.updateBoardroomMarketState({ ...update, chainId: input.chainId });
    }

    for (const event of governanceEvents) {
      if (event.kind === "operationVetoed") {
        vetoStakers.set(
          vetoKey(event.transactionHash, event.operationId),
          lowerAddress(event.staker)
        );
      }
    }

    for (const event of governanceEvents) {
      if (event.kind === "governanceEpochAdvanced") {
        epochEvents.push(event);
        continue;
      }
      if (event.kind === "configurationUpdated") {
        configurationEvents.push(event);
        continue;
      }
      if (event.kind === "operationVetoed") continue;
      const emitted = await processGovernanceEvent(
        tx,
        input.client,
        input.chainId,
        event,
        vetoStakers
      );
      governancePipelineEvents.push(
        ...emitted.map((pipelineEvent) => ({
          blockNumber: event.blockNumber,
          event: pipelineEvent,
          logIndex: event.logIndex
        }))
      );
    }

    for (const event of facetSetActivationEvents) {
      const invalidated = await tx.invalidateScheduledOperationsBeforeFacetSetActivation({
        chainId: input.chainId,
        facetSetHash: event.facetSetHash,
        terminalBlock: event.blockNumber,
        terminalLogIndex: event.logIndex,
        txHash: event.transactionHash
      });
      governancePipelineEvents.push(
        ...invalidated.map((item) => ({
          blockNumber: event.blockNumber,
          event: { ...item, event: "invalidated" as const },
          logIndex: event.logIndex
        }))
      );
    }

    // Epoch changes are emitted from inside the operation currently being executed.
    // Apply terminal events first, then invalidate only older operations that remain scheduled.
    for (const event of configurationEvents) {
      await tx.updateBoardroomLifecycle({
        boardroom: lowerAddress(event.boardroom),
        chainId: input.chainId,
        configurationEpoch: event.configurationEpoch,
        controller: lowerAddress(event.controller),
        controllerDelay: event.controllerDelay,
        gracePeriod: event.gracePeriod,
        proposer: lowerAddress(event.proposer)
      });
      const invalidated = await tx.invalidateScheduledOperationsBeforeConfigurationEpoch({
        boardroom: lowerAddress(event.boardroom),
        chainId: input.chainId,
        configurationEpoch: event.configurationEpoch,
        controller: lowerAddress(event.controller),
        terminalBlock: event.blockNumber,
        terminalLogIndex: event.logIndex,
        txHash: lowerHex(event.transactionHash)
      });
      governancePipelineEvents.push(
        ...invalidated.map((item) => ({
          blockNumber: event.blockNumber,
          event: { ...item, event: "invalidated" as const },
          logIndex: event.logIndex
        }))
      );
    }

    for (const event of epochEvents) {
      const invalidated = await tx.invalidateScheduledOperationsBeforeEpoch({
        boardroom: lowerAddress(event.boardroom),
        chainId: input.chainId,
        epoch: event.epoch,
        terminalBlock: event.blockNumber,
        terminalLogIndex: event.logIndex,
        txHash: lowerHex(event.transactionHash)
      });
      governancePipelineEvents.push(
        ...invalidated.map((item) => ({
          blockNumber: event.blockNumber,
          event: { ...item, event: "invalidated" as const },
          logIndex: event.logIndex
        }))
      );
    }

    governancePipelineEvents.sort(comparePositionedPipelineEvents);
    pendingEvents.push(...governancePipelineEvents.map((item) => item.event));

    for (const event of policyAdminEvents) {
      const inserted = await tx.insertPolicyAdminEvent(event);
      if (inserted && event.enabled && event.affectedScheduledOperations) {
        const notificationKey = policyAdminNotificationKey(event);
        if (notifiedPolicyChanges.has(notificationKey)) continue;
        notifiedPolicyChanges.add(notificationKey);
        const scheduled = await tx.listScheduledOperations(input.chainId);
        const eventId = policyAdminEventId(event);
        pendingEvents.push(
          ...scheduled.map((item) => ({ ...item, event: "policy-admin" as const, eventId }))
        );
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
    marketLifecycleEvents: marketEvents.length,
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
  boardrooms_: readonly WatcherBoardroom[],
  window: CursorWindow | undefined
): Promise<GovernanceEvent[]> {
  if (!window || boardrooms_.length === 0) return [];

  const events: GovernanceEvent[] = [];
  for (const boardroomChunk of chunks(boardrooms_, BOARDROOM_QUERY_CHUNK_SIZE)) {
    events.push(
      ...(await queryExternalGovernanceEvents(client, {
        boardrooms: boardroomChunk.map((item) => item.address),
        controllers: boardroomChunk
          .filter((item) => item.controller !== ZERO_ADDRESS)
          .map((item) => ({ boardroom: item.address, controller: item.controller })),
        fromBlock: window.fromBlock,
        toBlock: window.toBlock
      }))
    );
  }

  return events.sort(compareGovernanceEvents);
}

async function fetchMarketEvents(
  client: WatcherClient,
  deployment: PledgeCashDeployment,
  boardrooms_: readonly WatcherBoardroom[],
  window: CursorWindow | undefined
): Promise<MarketLifecycleEvent[]> {
  if (!window || boardrooms_.length === 0) return [];

  const events: MarketLifecycleEvent[] = [];
  for (const boardroomChunk of chunks(boardrooms_, BOARDROOM_QUERY_CHUNK_SIZE)) {
    events.push(
      ...(await queryMarketLifecycleEvents(client, {
        boardrooms: boardroomChunk.map((item) => ({
          boardroom: item.address,
          bondingCurve: item.bondingCurve,
          liquidityVault: item.liquidityVault,
          liquidityReservationExpectedVault: item.liquidityReservationExpectedVault
        })),
        fromBlock: window.fromBlock,
        ...(deployment.pledgeV4LiquidityFactory === undefined
          ? {}
          : { pledgeV4LiquidityFactory: deployment.pledgeV4LiquidityFactory }),
        toBlock: window.toBlock
      }))
    );
  }

  const actors = new Map<string, Lowercase<Address> | undefined>();
  for (const event of events) {
    const txHash = event.transactionHash;
    if (!actors.has(txHash)) actors.set(txHash, await transactionActor(client, txHash));
  }
  return events
    .map((event) => {
      const actor = actors.get(event.transactionHash);
      return actor === undefined ? event : { ...event, actor };
    })
    .sort(compareMarketLifecycleEvents);
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
        event: modulePolicyRegisteredEvent,
        eventName: "ModulePolicyRegistered",
        forcedEnabled: true,
        fromBlock: window.fromBlock,
        subjectKey: "policy",
        toBlock: window.toBlock
      }))
    );
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

async function fetchFacetSetActivationEvents(
  client: WatcherClient,
  deployment: PledgeCashDeployment,
  window: CursorWindow | undefined
): Promise<FacetSetActivationEvent[]> {
  if (!window || !deployment.protocolFacetRegistry) return [];

  const logs = (await client.getLogs({
    address: deployment.protocolFacetRegistry,
    event: facetSetActivatedEvent,
    fromBlock: window.fromBlock,
    toBlock: window.toBlock
  } as never)) as Array<{
    args?: Record<string, unknown>;
    blockNumber?: bigint;
    logIndex?: number;
    transactionHash?: Hex;
  }>;

  return logs
    .flatMap((log) => {
      const facetSetHash = hexValue(log.args?.facetSetHash);
      if (
        facetSetHash === undefined
        || log.blockNumber === undefined
        || log.logIndex === undefined
        || log.transactionHash === undefined
      ) return [];
      return [{
        blockNumber: log.blockNumber,
        facetSetHash: lowerHex(facetSetHash),
        logIndex: log.logIndex,
        transactionHash: lowerHex(log.transactionHash)
      }];
    })
    .sort(compareFacetSetActivationEvents);
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
  event: GovernanceEvent,
  vetoStakers: ReadonlyMap<string, Lowercase<Address>>
): Promise<WatcherPipelineEvent[]> {
  const boardroom = lowerAddress(event.boardroom);

  if (event.kind === "launched") {
    await tx.updateBoardroomLifecycle({
      boardroom,
      chainId,
      configurationEpoch: event.configurationEpoch,
      controller: lowerAddress(event.controller),
      controllerGeneration: event.controllerGeneration,
      controllerDelay: event.controllerDelay,
      gracePeriod: event.gracePeriod,
      launched: true,
      owner: lowerAddress(event.controller),
      proposer: lowerAddress(event.proposer),
      windDownDelay: event.windDownDelay,
      status: "active"
    });
    return [];
  }

  if (event.kind === "controllerReplaced") {
    await tx.updateBoardroomLifecycle({
      boardroom,
      chainId,
      configurationEpoch: event.configurationEpoch,
      controller: lowerAddress(event.controller),
      controllerGeneration: event.controllerGeneration,
      controllerDelay: event.controllerDelay,
      gracePeriod: event.gracePeriod,
      owner: lowerAddress(event.controller),
      proposer: lowerAddress(event.proposer)
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

  if (event.kind === "snapshottingStarted") {
    await tx.updateBoardroomLifecycle({ boardroom, chainId, status: "snapshotting" });
    return [];
  }

  if (event.kind === "redemptionsOpened") {
    await tx.updateBoardroomLifecycle({ boardroom, chainId, status: "redemptions-open" });
    return [];
  }

  if (event.kind === "operationScheduled") {
    const txInput = await transactionInput(client, event.transactionHash);
    const decoded = decodeScheduledOperationCalldata({
      controller: event.controller,
      expectedBoardroomEpoch: event.boardroomEpoch,
      expectedConfigurationEpoch: event.configurationEpoch,
      expectedFacetSetHash: event.facetSetHash,
      expectedPayloadHash: event.payloadHash,
      expectedSalt: event.salt,
      operationKind: event.operationKind,
      txInput
    });
    const action = await tx.insertScheduledOperation({
      operationId: lowerHex(event.operationId),
      boardroom,
      chainId,
      configurationEpoch: event.configurationEpoch,
      controller: lowerAddress(event.controller),
      controllerGeneration: event.controllerGeneration,
      decodeStatus: decoded.decodeStatus,
      boardroomEpoch: event.boardroomEpoch,
      eta: new Date(Number(event.eta) * 1000),
      expiresAt: new Date(Number(event.expiresAt) * 1000),
      facetSetHash: lowerHex(event.facetSetHash),
      operationKind: event.operationKind,
      proposer: lowerAddress(event.proposer),
      scheduleBlock: event.blockNumber,
      scheduleLogIndex: event.logIndex,
      scheduleTxHash: lowerHex(event.transactionHash),
      rawCalldata: txInput,
      salt: lowerHex(event.salt)
    });

    if (!action) return [];

    const calls = await tx.insertActionCalls(
      action.id,
      decoded.calls.map((call, callIndex) => storedCallInput(call, callIndex))
    );
    return [{ action, calls, event: "scheduled" }];
  }

  if (event.kind === "operationCancelled" || event.kind === "operationExecuted") {
    const caller =
      event.kind === "operationExecuted"
        ? lowerAddress(event.executor)
        : vetoStakers.get(vetoKey(event.transactionHash, event.operationId));
    if (caller === undefined) {
      throw new Error(
        `Controller cancellation ${event.operationId} is missing its canonical Boardroom veto event`
      );
    }
    const transitioned = await tx.transitionLatestScheduledOperation({
      operationId: lowerHex(event.operationId),
      boardroom,
      caller,
      chainId,
      controller: lowerAddress(event.controller),
      status: event.kind === "operationCancelled" ? "cancelled" : "executed",
      terminalBlock: event.blockNumber,
      terminalLogIndex: event.logIndex,
      txHash: lowerHex(event.transactionHash)
    });
    return transitioned ? [{ ...transitioned, event: transitioned.action.status }] : [];
  }

  return [];
}

function createDrizzleWatcherTx(db: SentinelDb): WatcherStoreTx {
  return {
    async applyShareBalanceDeltas(inputs: readonly ShareBalanceDeltaInput[]): Promise<void> {
      const aggregated = aggregateShareBalanceDeltas(inputs);
      if (aggregated.length === 0) return;

      await db
        .insert(shareBalances)
        .values(
          aggregated.map((input) => ({
            balance: input.delta.toString(),
            chainId: input.chainId,
            holder: input.holder,
            token: input.token,
            updatedBlock: input.blockNumber
          }))
        )
        .onConflictDoUpdate({
          target: [shareBalances.chainId, shareBalances.token, shareBalances.holder],
          set: {
            balance: sql`${shareBalances.balance} + excluded.balance`,
            updatedBlock: sql`GREATEST(${shareBalances.updatedBlock}, excluded.updated_block)`
          }
        });
    },
    async getCursor(chainId: number, scope: WatcherCursorScope): Promise<bigint | undefined> {
      const [row] = await db
        .select({ blockNumber: cursors.blockNumber })
        .from(cursors)
        .where(and(eq(cursors.chainId, chainId), eq(cursors.scope, scope)))
        .limit(1);
      return row?.blockNumber;
    },
    async invalidateScheduledOperationsBeforeEpoch(input: {
      readonly boardroom: Lowercase<Address>;
      readonly chainId: number;
      readonly epoch: bigint;
      readonly terminalBlock: bigint;
      readonly terminalLogIndex: number;
      readonly txHash: Lowercase<Hex>;
    }): Promise<Array<{ action: ScheduledOperationRow; calls: StoredCall[] }>> {
      const invalidated = await db
        .update(scheduledOperations)
        .set({
          invalidatedByEpoch: input.epoch,
          resolvedTxHash: input.txHash,
          status: "invalidated",
          updatedAt: new Date()
        })
        .where(
          and(
            eq(scheduledOperations.chainId, input.chainId),
            eq(scheduledOperations.boardroom, input.boardroom),
            eq(scheduledOperations.status, "scheduled"),
            lt(scheduledOperations.boardroomEpoch, input.epoch),
            or(
              lt(scheduledOperations.scheduleBlock, input.terminalBlock),
              and(
                eq(scheduledOperations.scheduleBlock, input.terminalBlock),
                lt(scheduledOperations.scheduleLogIndex, input.terminalLogIndex)
              )
            )
          )
        )
        .returning();

      invalidated.sort(
        (left, right) =>
          Number(left.scheduleBlock - right.scheduleBlock)
          || left.scheduleLogIndex - right.scheduleLogIndex
          || left.createdAt.getTime() - right.createdAt.getTime()
      );
      return Promise.all(
        invalidated.map(async (action) => ({
          action,
          calls: await this.listActionCalls(action.id)
        }))
      );
    },
    async invalidateScheduledOperationsBeforeConfigurationEpoch(input: {
      readonly boardroom: Lowercase<Address>;
      readonly chainId: number;
      readonly configurationEpoch: bigint;
      readonly controller: Lowercase<Address>;
      readonly terminalBlock: bigint;
      readonly terminalLogIndex: number;
      readonly txHash: Lowercase<Hex>;
    }): Promise<Array<{ action: ScheduledOperationRow; calls: StoredCall[] }>> {
      const invalidated = await db
        .update(scheduledOperations)
        .set({
          resolvedTxHash: input.txHash,
          status: "invalidated",
          updatedAt: new Date()
        })
        .where(
          and(
            eq(scheduledOperations.chainId, input.chainId),
            eq(scheduledOperations.boardroom, input.boardroom),
            eq(scheduledOperations.controller, input.controller),
            eq(scheduledOperations.status, "scheduled"),
            lt(scheduledOperations.configurationEpoch, input.configurationEpoch),
            or(
              lt(scheduledOperations.scheduleBlock, input.terminalBlock),
              and(
                eq(scheduledOperations.scheduleBlock, input.terminalBlock),
                lt(scheduledOperations.scheduleLogIndex, input.terminalLogIndex)
              )
            )
          )
        )
        .returning();
      invalidated.sort(
        (left, right) =>
          Number(left.scheduleBlock - right.scheduleBlock)
          || left.scheduleLogIndex - right.scheduleLogIndex
          || left.createdAt.getTime() - right.createdAt.getTime()
      );
      return Promise.all(
        invalidated.map(async (action) => ({
          action,
          calls: await this.listActionCalls(action.id)
        }))
      );
    },
    async invalidateScheduledOperationsBeforeFacetSetActivation(input: {
      readonly chainId: number;
      readonly facetSetHash: Lowercase<Hex>;
      readonly terminalBlock: bigint;
      readonly terminalLogIndex: number;
      readonly txHash: Lowercase<Hex>;
    }): Promise<Array<{ action: ScheduledOperationRow; calls: StoredCall[] }>> {
      const invalidated = await db
        .update(scheduledOperations)
        .set({
          resolvedTxHash: input.txHash,
          status: "invalidated",
          updatedAt: new Date()
        })
        .where(
          and(
            eq(scheduledOperations.chainId, input.chainId),
            eq(scheduledOperations.status, "scheduled"),
            ne(scheduledOperations.facetSetHash, input.facetSetHash),
            or(
              lt(scheduledOperations.scheduleBlock, input.terminalBlock),
              and(
                eq(scheduledOperations.scheduleBlock, input.terminalBlock),
                lt(scheduledOperations.scheduleLogIndex, input.terminalLogIndex)
              )
            )
          )
        )
        .returning();
      invalidated.sort(
        (left, right) =>
          Number(left.scheduleBlock - right.scheduleBlock)
          || left.scheduleLogIndex - right.scheduleLogIndex
          || left.createdAt.getTime() - right.createdAt.getTime()
      );
      return Promise.all(
        invalidated.map(async (action) => ({
          action,
          calls: await this.listActionCalls(action.id)
        }))
      );
    },
    async insertActionCalls(actionId: string, calls: readonly InsertActionCallInput[]): Promise<StoredCall[]> {
      if (calls.length === 0) return [];

      await db
        .insert(actionCalls)
        .values(calls.map((call) => ({ ...call, actionId })))
        .onConflictDoNothing();

      return this.listActionCalls(actionId);
    },
    async insertMarketLifecycleEvent(input: MarketLifecycleEvent & { readonly chainId: number }): Promise<boolean> {
      const inserted = await db
        .insert(marketLifecycleEvents)
        .values({
          actor: input.actor ?? null,
          blockNumber: input.blockNumber,
          boardroom: input.boardroom,
          chainId: input.chainId,
          contractAddress: input.contractAddress,
          kind: input.kind,
          logIndex: input.logIndex,
          metadata: input.data,
          source: input.source,
          txHash: input.transactionHash
        })
        .onConflictDoNothing()
        .returning({ id: marketLifecycleEvents.id });
      return inserted.length > 0;
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
    async insertScheduledOperation(input: InsertScheduledOperationInput): Promise<ScheduledOperationRow | undefined> {
      const inserted = await db
        .insert(scheduledOperations)
        .values({
          operationId: input.operationId,
          boardroom: input.boardroom,
          chainId: input.chainId,
          configurationEpoch: input.configurationEpoch,
          controller: input.controller,
          controllerGeneration: input.controllerGeneration,
          decodeStatus: input.decodeStatus,
          boardroomEpoch: input.boardroomEpoch,
          eta: input.eta,
          expiresAt: input.expiresAt,
          facetSetHash: input.facetSetHash,
          operationKind: input.operationKind,
          proposer: input.proposer,
          scheduleBlock: input.scheduleBlock,
          scheduleLogIndex: input.scheduleLogIndex,
          scheduleTxHash: input.scheduleTxHash,
          rawCalldata: input.rawCalldata,
          salt: input.salt
        })
        .onConflictDoNothing()
        .returning();
      if (inserted[0] !== undefined) {
        return inserted[0];
      }

      const [existing] = await db
        .select()
        .from(scheduledOperations)
        .where(
          and(
            eq(scheduledOperations.chainId, input.chainId),
            eq(scheduledOperations.boardroom, input.boardroom),
            eq(scheduledOperations.operationId, input.operationId),
            eq(scheduledOperations.scheduleTxHash, input.scheduleTxHash)
          )
        )
        .limit(1);
      return existing;
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
        configurationEpoch: row.configurationEpoch,
        controller: row.controller as Lowercase<Address>,
        controllerGeneration: row.controllerGeneration,
        createdBlock: row.createdBlock,
        controllerDelay: row.controllerDelay,
        gracePeriod: row.gracePeriod,
        launched: row.launched,
        name: row.name,
        owner: row.owner as Lowercase<Address>,
        proposer: row.proposer as Lowercase<Address>,
        shareToken: row.shareToken as Lowercase<Address>,
        status: row.status,
        windDownDelay: row.windDownDelay,
        primaryMarketMode: row.primaryMarketMode,
        bondingCurve: row.bondingCurve as Lowercase<Address> | null,
        primaryMarketQuoteAsset: row.primaryMarketQuoteAsset as Lowercase<Address> | null,
        bondingCurvePhase: row.bondingCurvePhase,
        bondingCurveSettlementReason: row.bondingCurveSettlementReason,
        bondingCurvePhaseEndsAt: row.bondingCurvePhaseEndsAt,
        liquidityStatus: row.liquidityStatus,
        liquidityVault: row.liquidityVault as Lowercase<Address> | null,
        liquidityPoolId: row.liquidityPoolId as Lowercase<Hex> | null,
        liquidityQuoteAsset: row.liquidityQuoteAsset as Lowercase<Address> | null,
        liquidityReservationCurve: row.liquidityReservationCurve as Lowercase<Address> | null,
        liquidityReservationExpectedVault: row.liquidityReservationExpectedVault as Lowercase<Address> | null,
        liquidityReservationExpectedPoolId: row.liquidityReservationExpectedPoolId as Lowercase<Hex> | null,
        liquidityReservationPairKey: row.liquidityReservationPairKey as Lowercase<Hex> | null,
        liquidityReservationSalt: row.liquidityReservationSalt as Lowercase<Hex> | null,
        liquidityReservationExpiresAt: row.liquidityReservationExpiresAt
      }));
    },
    async listScheduledOperations(chainId: number): Promise<Array<{ action: ScheduledOperationRow; calls: StoredCall[] }>> {
      const rows = await db
        .select()
        .from(scheduledOperations)
        .where(
          and(
            eq(scheduledOperations.chainId, chainId),
            eq(scheduledOperations.status, "scheduled"),
            or(isNull(scheduledOperations.expiresAt), gt(scheduledOperations.expiresAt, new Date()))
          )
        )
        .orderBy(desc(scheduledOperations.scheduleBlock), desc(scheduledOperations.scheduleLogIndex), desc(scheduledOperations.createdAt));
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
      const [pending] = await db
        .select({ id: scheduledOperations.id })
        .from(scheduledOperations)
        .where(
          and(
            eq(scheduledOperations.chainId, input.chainId),
            eq(scheduledOperations.boardroom, input.boardroom),
            eq(scheduledOperations.controller, input.controller),
            eq(scheduledOperations.operationId, input.operationId),
            or(
              lt(scheduledOperations.scheduleBlock, input.terminalBlock),
              and(
                eq(scheduledOperations.scheduleBlock, input.terminalBlock),
                lte(scheduledOperations.scheduleLogIndex, input.terminalLogIndex)
              )
            ),
            eq(scheduledOperations.status, "scheduled")
          )
        )
        .orderBy(desc(scheduledOperations.scheduleBlock), desc(scheduledOperations.scheduleLogIndex), desc(scheduledOperations.createdAt))
        .limit(1);
      if (!pending) {
        const [existing] = await db
          .select()
          .from(scheduledOperations)
          .where(
            and(
              eq(scheduledOperations.chainId, input.chainId),
              eq(scheduledOperations.boardroom, input.boardroom),
              eq(scheduledOperations.controller, input.controller),
              eq(scheduledOperations.operationId, input.operationId),
              eq(scheduledOperations.status, input.status),
              eq(scheduledOperations.resolvedTxHash, input.txHash)
            )
          )
          .orderBy(desc(scheduledOperations.scheduleBlock), desc(scheduledOperations.scheduleLogIndex), desc(scheduledOperations.createdAt))
          .limit(1);
        return existing === undefined
          ? undefined
          : { action: existing, calls: await this.listActionCalls(existing.id) };
      }

      const updates =
        input.status === "cancelled"
          ? { cancelledBy: input.caller, resolvedTxHash: input.txHash, status: input.status, updatedAt: new Date() }
          : { executedBy: input.caller, resolvedTxHash: input.txHash, status: input.status, updatedAt: new Date() };

      const [action] = await db
        .update(scheduledOperations)
        .set(updates)
        .where(eq(scheduledOperations.id, pending.id))
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
            configurationEpoch: 0n,
            controller: ZERO_ADDRESS,
            controllerGeneration: 0n,
            createdBlock: item.createdAtBlock,
            controllerDelay: 0n,
            gracePeriod: 0n,
            launched: false,
            name: item.name,
            owner: lowerAddress(item.owner),
            proposer: ZERO_ADDRESS,
            shareToken: lowerAddress(item.shareToken),
            status: "prelaunch",
            windDownDelay: 0n
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
      const set = withoutUndefined({
        configurationEpoch: input.configurationEpoch,
        controller: input.controller,
        controllerGeneration: input.controllerGeneration,
        controllerDelay: input.controllerDelay,
        gracePeriod: input.gracePeriod,
        launched: input.launched,
        owner: input.owner,
        proposer: input.proposer,
        status: input.status,
        updatedAt: new Date(),
        windDownDelay: input.windDownDelay
      });
      if (Object.keys(set).length === 1) return;

      await db
        .update(boardrooms)
        .set(set)
        .where(and(eq(boardrooms.chainId, input.chainId), eq(boardrooms.address, input.boardroom)));
    },
    async updateBoardroomMarketState(
      input: BoardroomMarketStateUpdate & { readonly chainId: number }
    ): Promise<void> {
      const [current] = await db
        .select()
        .from(boardrooms)
        .where(and(eq(boardrooms.chainId, input.chainId), eq(boardrooms.address, input.boardroom)))
        .limit(1);
      if (!current) throw new Error(`Unknown Boardroom market topology ${input.boardroom}`);

      assertTopologyAddress(current.bondingCurve, input.bondingCurve, "bonding curve");
      assertTopologyAddress(current.liquidityVault, input.liquidityVault, "protocol-liquidity vault");
      assertTopologyHex(current.liquidityPoolId, input.liquidityPoolId, "Uniswap v4 PoolId");
      assertTopologyAddress(current.primaryMarketQuoteAsset, input.primaryMarketQuoteAsset, "primary-market quote asset");
      assertTopologyAddress(current.liquidityQuoteAsset, input.liquidityQuoteAsset, "liquidity quote asset");
      const nextQuote = input.primaryMarketQuoteAsset ?? input.liquidityQuoteAsset;
      if (nextQuote) {
        assertTopologyAddress(current.primaryMarketQuoteAsset, nextQuote, "permanent quote asset");
        assertTopologyAddress(current.liquidityQuoteAsset, nextQuote, "permanent quote asset");
      }

      if (!input.clearLiquidityReservation) {
        assertTopologyAddress(
          current.liquidityReservationCurve,
          input.liquidityReservationCurve,
          "liquidity reservation curve"
        );
        assertTopologyAddress(
          current.liquidityReservationExpectedVault,
          input.liquidityReservationExpectedVault,
          "liquidity reservation vault"
        );
        assertTopologyHex(
          current.liquidityReservationExpectedPoolId,
          input.liquidityReservationExpectedPoolId,
          "liquidity reservation PoolId"
        );
        assertTopologyHex(
          current.liquidityReservationPairKey,
          input.liquidityReservationPairKey,
          "liquidity reservation pair key"
        );
        assertTopologyHex(
          current.liquidityReservationSalt,
          input.liquidityReservationSalt,
          "liquidity reservation salt"
        );
      }

      const set: Record<string, unknown> = withoutUndefined({
        bondingCurve: input.bondingCurve,
        bondingCurvePhase: input.bondingCurvePhase,
        bondingCurvePhaseEndsAt: input.bondingCurvePhaseEndsAt,
        bondingCurveSettlementReason: input.bondingCurveSettlementReason,
        liquidityVault: input.liquidityVault,
        liquidityPoolId: input.liquidityPoolId,
        liquidityQuoteAsset: input.liquidityQuoteAsset,
        liquidityReservationCurve: input.liquidityReservationCurve,
        liquidityReservationExpectedVault: input.liquidityReservationExpectedVault,
        liquidityReservationExpectedPoolId: input.liquidityReservationExpectedPoolId,
        liquidityReservationExpiresAt: input.liquidityReservationExpiresAt,
        liquidityReservationPairKey: input.liquidityReservationPairKey,
        liquidityReservationSalt: input.liquidityReservationSalt,
        liquidityStatus: input.liquidityStatus,
        primaryMarketMode: input.primaryMarketMode,
        primaryMarketQuoteAsset: input.primaryMarketQuoteAsset,
        updatedAt: new Date()
      });
      if (input.clearLiquidityReservation) {
        Object.assign(set, {
          liquidityReservationCurve: null,
          liquidityReservationExpectedVault: null,
          liquidityReservationExpectedPoolId: null,
          liquidityReservationExpiresAt: 0n,
          liquidityReservationPairKey: null,
          liquidityReservationSalt: null
        });
      }
      await db
        .update(boardrooms)
        .set(set)
        .where(and(eq(boardrooms.chainId, input.chainId), eq(boardrooms.address, input.boardroom)));
    }
  };
}

function policyAdminEventId(event: InsertPolicyAdminEventInput): string {
  return `${event.chainId}:${event.txHash.toLowerCase()}:${event.logIndex}`;
}

function vetoKey(transactionHash: Hex, operationId: Hex): string {
  return `${transactionHash.toLowerCase()}:${operationId.toLowerCase()}`;
}

function policyAdminNotificationKey(event: InsertPolicyAdminEventInput): string {
  return `${event.chainId}:${event.txHash.toLowerCase()}:${event.contract}:${event.subject}`;
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

export function decodeKnownCall(data: Hex): { decodedArgs: JsonValue | null; decodedFunction: string | null } {
  if (data.length < 10) return { decodedArgs: null, decodedFunction: null };

  const matches: Array<{ decodedArgs: JsonValue; decodedFunction: string }> = [];
  for (const [contractName, abi] of Object.entries(pledgeCashAbis)) {
    try {
      const decoded = decodeFunctionData({ abi: abi as Abi, data });
      matches.push({
        decodedArgs: toJson(decoded.args ?? []) as JsonValue,
        decodedFunction: `${contractName}.${decoded.functionName}`
      });
    } catch {
      // Try the next known ABI.
    }
  }

  if (matches.length === 0) return { decodedArgs: null, decodedFunction: null };
  if (matches.length === 1) return matches[0]!;
  return {
    decodedArgs: matches[0]!.decodedArgs,
    decodedFunction: `ambiguous:${matches.map((match) => match.decodedFunction).join("|")}`
  };
}

function scheduleCalldataCandidates(input: Hex, seen: Set<string>, depth: number): Hex[] {
  if (seen.has(input) || depth > 4) return [];
  seen.add(input);

  const candidates: Hex[] = [input];
  for (const unwrapped of unwrapCalldata(input)) {
    candidates.push(...scheduleCalldataCandidates(unwrapped, seen, depth + 1));
  }
  candidates.push(...scanForScheduleSelectors(input));

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

function scanForScheduleSelectors(data: Hex): Hex[] {
  const body = data.slice(2).toLowerCase();
  const selectors = [scheduleBoardroomOperationSelector, scheduleControllerOperationSelector]
    .map((selector) => selector.slice(2).toLowerCase());
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

function normalizeBoardroomCalls(value: unknown): BoardroomCall[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const calls: BoardroomCall[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return undefined;
    const record = item as Record<string, unknown>;
    const policy = addressValue(record.policy ?? record["0"]);
    const target = addressValue(record.target ?? record["1"]);
    const callValue = bigintValue(record.value ?? record["2"]);
    const data = hexValue(record.data ?? record["3"]);
    if (!policy || !target || callValue === undefined || !data) return undefined;
    calls.push({ policy, target, value: callValue, data });
  }
  return calls;
}

async function transactionInput(client: WatcherClient, hash: Hex): Promise<Hex> {
  const tx = (await client.getTransaction({ hash } as never)) as { input?: unknown; data?: unknown };
  const input = tx.input ?? tx.data;
  return typeof input === "string" && isHex(input) ? input : "0x";
}

async function transactionActor(client: WatcherClient, hash: Hex): Promise<Lowercase<Address> | undefined> {
  const tx = (await client.getTransaction({ hash } as never)) as { from?: unknown };
  const actor = addressValue(tx.from);
  return actor === undefined ? undefined : lowerAddress(actor);
}

async function getPolicyAdminLogs(
  client: WatcherClient,
  input: {
    readonly address: Address;
    readonly chainId: number;
    readonly contract: "registry" | "asset-policy";
    readonly event: unknown;
    readonly eventName: string;
    readonly forcedEnabled?: boolean;
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
    readonly forcedEnabled?: boolean;
    readonly statusKey?: string;
    readonly subjectKey: string;
  }
): PolicyAdminEvent | undefined {
  if (log.blockNumber === undefined || log.logIndex === undefined || !log.transactionHash) return undefined;
  const args = log.args ?? {};
  const subject = addressValue(args[input.subjectKey]);
  if (!subject) return undefined;

  const enabled =
    input.forcedEnabled
    ?? (input.statusKey === undefined
      ? booleanValue(args.allowed) === true
      : bigintValue(args[input.statusKey]) !== 0n);

  return {
    affectedScheduledOperations: true,
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
    const address = lowerAddress(item.boardroom);
    if (byAddress.has(address)) continue;
    byAddress.set(address, {
      address,
      chainId: 0,
      configurationEpoch: 0n,
      controller: ZERO_ADDRESS,
      controllerGeneration: 0n,
      createdBlock: item.createdAtBlock,
      controllerDelay: 0n,
      gracePeriod: 0n,
      launched: false,
      name: item.name,
      owner: lowerAddress(item.owner),
      proposer: ZERO_ADDRESS,
      shareToken: lowerAddress(item.shareToken),
      status: "prelaunch",
      windDownDelay: 0n,
      primaryMarketMode: 0,
      bondingCurve: null,
      primaryMarketQuoteAsset: null,
      bondingCurvePhase: null,
      bondingCurveSettlementReason: null,
      bondingCurvePhaseEndsAt: 0n,
      liquidityStatus: 0,
      liquidityVault: null,
      liquidityPoolId: null,
      liquidityQuoteAsset: null,
      liquidityReservationCurve: null,
      liquidityReservationExpectedVault: null,
      liquidityReservationExpectedPoolId: null,
      liquidityReservationPairKey: null,
      liquidityReservationSalt: null,
      liquidityReservationExpiresAt: 0n
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
    startBlock?: bigint | number | string;
  };
  const firstBlock = blockValue(raw.deploymentBlock ?? raw.startBlock ?? raw.blockNumber);
  return firstBlock === undefined || firstBlock === 0n ? 0n : firstBlock - 1n;
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
    marketLifecycleEvents: 0,
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
    marketLifecycleEvents: 0,
    policyAdminEvents: 0,
    scannedWindows: 0,
    shareTransfers: 0
  };
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

function compareMarketLifecycleEvents(left: MarketLifecycleEvent, right: MarketLifecycleEvent): number {
  if (left.blockNumber < right.blockNumber) return -1;
  if (left.blockNumber > right.blockNumber) return 1;
  return left.logIndex - right.logIndex || left.contractAddress.localeCompare(right.contractAddress);
}

function comparePositionedPipelineEvents(left: PositionedPipelineEvent, right: PositionedPipelineEvent): number {
  if (left.blockNumber < right.blockNumber) return -1;
  if (left.blockNumber > right.blockNumber) return 1;
  return left.logIndex - right.logIndex;
}

function comparePolicyAdminEvents(left: PolicyAdminEvent, right: PolicyAdminEvent): number {
  if (left.blockNumber < right.blockNumber) return -1;
  if (left.blockNumber > right.blockNumber) return 1;
  return left.logIndex - right.logIndex;
}

function compareFacetSetActivationEvents(
  left: FacetSetActivationEvent,
  right: FacetSetActivationEvent
): number {
  if (left.blockNumber < right.blockNumber) return -1;
  if (left.blockNumber > right.blockNumber) return 1;
  return left.logIndex - right.logIndex;
}

function selectorOf(data: Hex): Hex {
  return data.length >= 10 ? (data.slice(0, 10) as Hex) : "0x00000000";
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

function assertTopologyAddress(current: string | null, next: string | undefined, label: string): void {
  if (current && next && current.toLowerCase() !== next.toLowerCase()) {
    throw new Error(`Conflicting canonical ${label}: ${current} != ${next}`);
  }
}

function assertTopologyHex(current: string | null, next: string | undefined, label: string): void {
  if (current && next && current.toLowerCase() !== next.toLowerCase()) {
    throw new Error(`Conflicting canonical ${label}: ${current} != ${next}`);
  }
}
