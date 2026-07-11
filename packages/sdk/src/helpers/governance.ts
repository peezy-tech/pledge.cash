import {
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  getAbiItem,
  isHex,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { boardroomAbi } from "../generated";
import type { BoardroomCall, PledgeCashGovernanceClient, PledgeCashLogClient } from "./types";

export type { BoardroomCall } from "./types";

export type GovernanceLogMeta = {
  boardroom: Address;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
};

export type GovernanceEvent =
  | (GovernanceLogMeta & { kind: "launched"; executor: Address; governanceDelay: bigint })
  | (GovernanceLogMeta & { kind: "executorSet"; executor: Address })
  | (GovernanceLogMeta & {
      kind: "actionQueued";
      actionHash: Hex;
      executor: Address;
      eta: bigint;
      expiresAt: bigint;
      epoch: bigint;
      salt: Hex;
    })
  | (GovernanceLogMeta & { kind: "actionCancelled"; actionHash: Hex; caller: Address })
  | (GovernanceLogMeta & { kind: "actionExecuted"; actionHash: Hex; caller: Address })
  | (GovernanceLogMeta & { kind: "callExecuted"; policy: Address; target: Address; selector: Hex; value: bigint; dataHash: Hex })
  | (GovernanceLogMeta & { kind: "governanceEpochAdvanced"; epoch: bigint })
  | (GovernanceLogMeta & { kind: "windDownStarted"; caller: Address });

export type GovernanceEventsQuery = {
  boardrooms: readonly Address[];
  fromBlock?: bigint;
  toBlock?: bigint | "latest";
  chunkSize?: bigint;
  signal?: AbortSignal;
};

export type DecodedQueueInput =
  | { kind: "queueAction"; call: BoardroomCall; salt: Hex }
  | { kind: "queueBatch"; calls: BoardroomCall[]; salt: Hex };

export type QueuedBoardroomActionStatus =
  | "waiting"
  | "ready"
  | "expired"
  | "invalidated"
  | "cancelled"
  | "executed"
  | "unknown";

export type QueuedBoardroomAction = {
  boardroom: Address;
  actionHash: Hex;
  executor: Address;
  eta: bigint;
  expiresAt: bigint;
  epoch: bigint;
  currentEpoch: bigint;
  actionStatus: number;
  salt: Hex;
  queueBlockNumber: bigint;
  queueTransactionHash: Hex;
  status: QueuedBoardroomActionStatus;
  kind?: DecodedQueueInput["kind"];
  calls?: BoardroomCall[];
  payloadError?: string;
};

export type QueuedBoardroomActionsQuery = GovernanceEventsQuery & {
  currentTime?: bigint;
};

export type QueuedBoardroomActionCandidate = {
  boardroom: Address;
  actionHash: Hex;
  queueTransactionHash: Hex;
  queueBlockNumber?: bigint;
};

export type QueuedBoardroomActionCandidateError = {
  boardroom: Address;
  actionHash: Hex;
  message: string;
};

export type HydratedQueuedBoardroomActions = {
  actions: QueuedBoardroomAction[];
  errors: QueuedBoardroomActionCandidateError[];
};

type RawEventLog = {
  address?: Address;
  args?: Record<string, unknown>;
  blockNumber?: bigint;
  eventName?: string;
  logIndex?: number;
  transactionHash?: Hex;
};

const launchedEvent = getAbiItem({ abi: boardroomAbi, name: "BoardroomLaunched" });
const executorSetEvent = getAbiItem({ abi: boardroomAbi, name: "ExecutorSet" });
const actionQueuedEvent = getAbiItem({ abi: boardroomAbi, name: "BoardroomActionQueued" });
const actionCancelledEvent = getAbiItem({ abi: boardroomAbi, name: "BoardroomActionCancelled" });
const actionExecutedEvent = getAbiItem({ abi: boardroomAbi, name: "BoardroomActionExecuted" });
const callExecutedEvent = getAbiItem({ abi: boardroomAbi, name: "BoardroomCallExecuted" });
const governanceEpochAdvancedEvent = getAbiItem({ abi: boardroomAbi, name: "GovernanceEpochAdvanced" });
const windDownStartedEvent = getAbiItem({ abi: boardroomAbi, name: "BoardroomWindDownStarted" });
const governanceEventAbis = [
  launchedEvent,
  executorSetEvent,
  actionQueuedEvent,
  actionCancelledEvent,
  actionExecutedEvent,
  callExecutedEvent,
  governanceEpochAdvancedEvent,
  windDownStartedEvent,
] as const;

const DEFAULT_GOVERNANCE_LOG_CHUNK_SIZE = 100_000n;
const MIN_GOVERNANCE_LOG_CHUNK_SIZE = 1n;
const MAX_GOVERNANCE_LOG_REQUESTS = 128;
const MAX_GOVERNANCE_LOGS = 25_000;
const MAX_GOVERNANCE_BOARDROOMS = 64;
const MAX_QUEUED_ACTIONS = 500;
const QUEUED_ACTION_READ_CONCURRENCY = 8;
const CONTRACT_START_READ_CONCURRENCY = 4;
const MAX_CONTRACT_START_CACHE_ENTRIES = 512;
const MAX_CONTRACT_START_SEARCH_STEPS = 64;
const contractStartBlockCache = new WeakMap<object, Map<string, Promise<bigint>>>();

export async function queryGovernanceEvents(
  client: PledgeCashLogClient,
  input: GovernanceEventsQuery,
): Promise<GovernanceEvent[]> {
  throwIfAborted(input.signal);
  if (input.boardrooms.length === 0) return [];
  assertGovernanceBoardroomBound(input.boardrooms);

  const logs = await getGovernanceLogs(client, input);
  return logs.flatMap((log) => maybeArray(toGovernanceEvent(log))).sort(compareGovernanceEvents);
}

export async function queryQueuedBoardroomActions(
  client: PledgeCashGovernanceClient,
  input: QueuedBoardroomActionsQuery,
): Promise<QueuedBoardroomAction[]> {
  throwIfAborted(input.signal);
  assertGovernanceBoardroomBound(input.boardrooms);
  const boardrooms = uniqueBoardroomAddresses(input.boardrooms);
  const launched = await mapInBatches(
    boardrooms,
    QUEUED_ACTION_READ_CONCURRENCY,
    async (boardroom) => {
      throwIfAborted(input.signal);
      const launched = await client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "launched" }) as boolean;
      throwIfAborted(input.signal);
      return { boardroom, launched };
    },
    input.signal,
  );
  const launchedBoardrooms = launched.filter((entry) => entry.launched).map((entry) => entry.boardroom);
  if (launchedBoardrooms.length === 0) return [];

  const events = await queryGovernanceEvents(client, { ...input, boardrooms: launchedBoardrooms });
  const latestQueues = latestQueueEvents(events);
  const resolutionIndex = governanceResolutionIndex(events);
  const currentTime = input.currentTime ?? BigInt(Math.floor(Date.now() / 1000));
  const unresolvedQueues = latestQueues.filter((queued) =>
    latestTerminalEvent(resolutionIndex, queued) === undefined
      && currentTime <= queued.expiresAt
      && !queueEpochWasInvalidated(resolutionIndex, queued)
  );
  if (unresolvedQueues.length > MAX_QUEUED_ACTIONS) {
    throw new Error(`Governance queue exceeds its ${MAX_QUEUED_ACTIONS.toLocaleString()}-action hydration safety bound.`);
  }

  const actions = await mapInBatches(
    unresolvedQueues,
    QUEUED_ACTION_READ_CONCURRENCY,
    async (queued) => {
      throwIfAborted(input.signal);
      const [governanceStateResult, payload] = await Promise.all([
        client.readContract({
          address: queued.boardroom,
          abi: boardroomAbi,
          functionName: "governanceState",
          args: [queued.actionHash],
        }),
        readQueuedPayload(client, queued, input.signal),
      ]);
      throwIfAborted(input.signal);
      const [currentEpoch, eta, expiresAt, actionEpoch, actionStatus] = governanceStateResult as readonly [
        bigint,
        bigint,
        bigint,
        bigint,
        number,
      ];
      const terminal = latestTerminalEvent(resolutionIndex, queued);
      const status = queuedActionStatus({
        terminal,
        currentTime,
        currentEpoch,
        eta,
        expiresAt,
        actionEpoch,
      });

      return {
        boardroom: queued.boardroom,
        actionHash: queued.actionHash,
        executor: queued.executor,
        eta: queued.eta,
        expiresAt: queued.expiresAt,
        epoch: queued.epoch,
        currentEpoch,
        actionStatus: Number(actionStatus),
        salt: queued.salt,
        queueBlockNumber: queued.blockNumber,
        queueTransactionHash: queued.transactionHash,
        status,
        ...payload,
      } satisfies QueuedBoardroomAction;
    },
    input.signal,
  );

  return actions.sort((left, right) => compareBigIntDesc(left.queueBlockNumber, right.queueBlockNumber));
}

export async function hydrateQueuedBoardroomActionCandidates(
  client: PledgeCashGovernanceClient,
  input: { candidates: readonly QueuedBoardroomActionCandidate[]; currentTime?: bigint; signal?: AbortSignal },
): Promise<HydratedQueuedBoardroomActions> {
  throwIfAborted(input.signal);
  const deduplicated = deduplicateQueuedActionCandidates(input.candidates);
  if (deduplicated.candidates.length > MAX_QUEUED_ACTIONS) {
    throw new Error(`Governance candidate hydration exceeds its ${MAX_QUEUED_ACTIONS.toLocaleString()}-action safety bound.`);
  }
  const currentTime = input.currentTime ?? BigInt(Math.floor(Date.now() / 1000));
  const results = await mapInBatches(
    deduplicated.candidates,
    QUEUED_ACTION_READ_CONCURRENCY,
    async (candidate): Promise<{
      action?: QueuedBoardroomAction | undefined;
      error?: QueuedBoardroomActionCandidateError | undefined;
    }> => {
      try {
        throwIfAborted(input.signal);
        if (!client.getTransactionReceipt) throw new Error("Queue transaction receipt verification is unavailable.");
        const [transaction, receipt] = await Promise.all([
          client.getTransaction({ hash: candidate.queueTransactionHash }),
          client.getTransactionReceipt({ hash: candidate.queueTransactionHash }),
        ]);
        throwIfAborted(input.signal);
        if (!sameHex(transaction.hash, candidate.queueTransactionHash)) {
          throw new Error("RPC returned a different queue transaction hash.");
        }
        if (transaction.blockNumber === null || transaction.blockNumber === undefined) {
          throw new Error("Queue transaction is not confirmed in a block.");
        }
        if (candidate.queueBlockNumber !== undefined && candidate.queueBlockNumber !== transaction.blockNumber) {
          throw new Error("Candidate queue block does not match the mined transaction.");
        }
        const payload = verifiedQueuedPayload(transaction, candidate.boardroom, candidate.actionHash);
        const queuedEvent = verifiedQueuedReceipt({
          actionHash: candidate.actionHash,
          boardroom: candidate.boardroom,
          executor: transaction.from,
          payload,
          receipt,
          transactionBlock: transaction.blockNumber,
          transactionHash: candidate.queueTransactionHash,
        });
        const governanceStateResult = await client.readContract({
          address: candidate.boardroom,
          abi: boardroomAbi,
          functionName: "governanceState",
          args: [candidate.actionHash],
        });
        throwIfAborted(input.signal);
        const [currentEpoch, eta, expiresAt, actionEpoch, actionStatus] = governanceStateResult as readonly [
          bigint,
          bigint,
          bigint,
          bigint,
          number,
        ];
        if (eta === 0n) return {};
        if (eta !== queuedEvent.eta || expiresAt !== queuedEvent.expiresAt || actionEpoch !== queuedEvent.epoch) {
          throw new Error("Queue event does not match the current action context.");
        }

        return {
          action: {
            boardroom: candidate.boardroom,
            actionHash: candidate.actionHash,
            executor: transaction.from,
            eta,
            expiresAt,
            epoch: actionEpoch,
            currentEpoch,
            actionStatus: Number(actionStatus),
            salt: payload.salt,
            queueBlockNumber: transaction.blockNumber,
            queueTransactionHash: candidate.queueTransactionHash,
            status: queuedActionStatus({
              terminal: undefined,
              currentTime,
              currentEpoch,
              eta,
              expiresAt,
              actionEpoch,
            }),
            kind: payload.kind,
            calls: payload.calls,
          },
        };
      } catch (error) {
        throwIfAborted(input.signal);
        return {
          error: {
            boardroom: candidate.boardroom,
            actionHash: candidate.actionHash,
            message: conciseErrorMessage(error),
          },
        };
      }
    },
    input.signal,
  );

  return {
    actions: results.flatMap((result) => result.action ? [result.action] : [])
      .sort((left, right) => compareBigIntDesc(left.queueBlockNumber, right.queueBlockNumber)),
    errors: [
      ...deduplicated.errors,
      ...results.flatMap((result) => result.error ? [result.error] : []),
    ],
  };
}

export function decodeQueueCalldata(data: Hex): DecodedQueueInput | undefined {
  try {
    const decoded = decodeFunctionData({ abi: boardroomAbi, data });
    const args = decoded.args as readonly unknown[] | undefined;

    if (decoded.functionName === "queueAction") {
      const call = normalizeBoardroomCall(args?.[0]);
      const salt = hexValue(args?.[1]);
      if (!call || !salt) return undefined;
      return { kind: "queueAction", call, salt };
    }

    if (decoded.functionName === "queueBatch") {
      const calls = normalizeBoardroomCalls(args?.[0]);
      const salt = hexValue(args?.[1]);
      if (!calls || !salt) return undefined;
      return { kind: "queueBatch", calls, salt };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export function hashCall(call: BoardroomCall): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }],
      [call.policy, call.target, call.value, keccak256(call.data)],
    ),
  );
}

export function hashAction(call: BoardroomCall, salt: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [hashCall(call), salt]));
}

export function hashBatch(calls: readonly BoardroomCall[], salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "bytes32[]" }, { type: "bytes32" }], [calls.map((call) => hashCall(call)), salt]),
  );
}

type ActionQueuedEvent = Extract<GovernanceEvent, { kind: "actionQueued" }>;
type ActionTerminalEvent = Extract<GovernanceEvent, { kind: "actionCancelled" | "actionExecuted" }>;
type GovernanceResolutionIndex = {
  currentEpochs: Map<string, bigint>;
  terminalEvents: Map<string, ActionTerminalEvent>;
};
type QueueTransaction = {
  blockNumber?: bigint | null | undefined;
  from: Address;
  hash: Hex;
  input: Hex;
  to?: Address | null | undefined;
};
type QueueReceipt = {
  blockNumber: bigint;
  logs: readonly {
    address: Address;
    data: Hex;
    topics: readonly Hex[];
  }[];
  status: "success" | "reverted";
  transactionHash: Hex;
};
type VerifiedQueuedPayload = {
  calls: BoardroomCall[];
  kind: DecodedQueueInput["kind"];
  salt: Hex;
};
type VerifiedQueuedReceipt = {
  epoch: bigint;
  eta: bigint;
  expiresAt: bigint;
};

function latestQueueEvents(events: readonly GovernanceEvent[]): ActionQueuedEvent[] {
  const latest = new Map<string, ActionQueuedEvent>();
  for (const event of events) {
    if (event.kind !== "actionQueued") continue;
    latest.set(actionKey(event.boardroom, event.actionHash), event);
  }
  return [...latest.values()];
}

function governanceResolutionIndex(events: readonly GovernanceEvent[]): GovernanceResolutionIndex {
  const currentEpochs = new Map<string, bigint>();
  const terminalEvents = new Map<string, ActionTerminalEvent>();
  for (const event of events) {
    if (event.kind === "governanceEpochAdvanced") {
      currentEpochs.set(event.boardroom.toLowerCase(), event.epoch);
    } else if (event.kind === "actionCancelled" || event.kind === "actionExecuted") {
      terminalEvents.set(actionKey(event.boardroom, event.actionHash), event);
    }
  }
  return { currentEpochs, terminalEvents };
}

function latestTerminalEvent(
  index: GovernanceResolutionIndex,
  queued: ActionQueuedEvent,
): ActionTerminalEvent | undefined {
  const terminal = index.terminalEvents.get(actionKey(queued.boardroom, queued.actionHash));
  return terminal && compareEventPosition(terminal, queued) > 0 ? terminal : undefined;
}

function queueEpochWasInvalidated(index: GovernanceResolutionIndex, queued: ActionQueuedEvent): boolean {
  const currentEpoch = index.currentEpochs.get(queued.boardroom.toLowerCase());
  return currentEpoch !== undefined && currentEpoch !== queued.epoch;
}

async function readQueuedPayload(
  client: PledgeCashGovernanceClient,
  queued: ActionQueuedEvent,
  signal?: AbortSignal,
): Promise<Pick<QueuedBoardroomAction, "kind" | "calls"> | Pick<QueuedBoardroomAction, "payloadError">> {
  try {
    throwIfAborted(signal);
    const transaction = await client.getTransaction({ hash: queued.transactionHash });
    throwIfAborted(signal);
    const payload = verifiedQueuedPayload(transaction, queued.boardroom, queued.actionHash);
    if (payload.salt.toLowerCase() !== queued.salt.toLowerCase()) {
      return { payloadError: "Queue calldata does not match the emitted salt." };
    }

    return { kind: payload.kind, calls: payload.calls };
  } catch (error) {
    throwIfAborted(signal);
    return { payloadError: error instanceof Error ? error.message : String(error) };
  }
}

function verifiedQueuedPayload(
  transaction: QueueTransaction,
  boardroom: Address,
  actionHash: Hex,
): VerifiedQueuedPayload {
  if (!transaction.to || !sameAddress(transaction.to, boardroom)) {
    throw new Error("Queue transaction does not directly target the Boardroom.");
  }
  const decoded = decodeQueueCalldata(transaction.input);
  if (!decoded) throw new Error("Queue calldata could not be decoded.");
  const calls = decoded.kind === "queueAction" ? [decoded.call] : decoded.calls;
  const computedHash = decoded.kind === "queueAction"
    ? hashAction(decoded.call, decoded.salt)
    : hashBatch(decoded.calls, decoded.salt);
  if (computedHash.toLowerCase() !== actionHash.toLowerCase()) {
    throw new Error("Queue calldata does not match the action hash.");
  }
  return { kind: decoded.kind, calls, salt: decoded.salt };
}

function verifiedQueuedReceipt(input: {
  actionHash: Hex;
  boardroom: Address;
  executor: Address;
  payload: VerifiedQueuedPayload;
  receipt: QueueReceipt;
  transactionBlock: bigint;
  transactionHash: Hex;
}): VerifiedQueuedReceipt {
  if (input.receipt.status !== "success") throw new Error("Queue transaction reverted.");
  if (!sameHex(input.receipt.transactionHash, input.transactionHash)) {
    throw new Error("Receipt does not match the queue transaction hash.");
  }
  if (input.receipt.blockNumber !== input.transactionBlock) {
    throw new Error("Receipt block does not match the queue transaction block.");
  }

  for (const log of input.receipt.logs) {
    if (!sameAddress(log.address, input.boardroom)) continue;
    try {
      const decoded = decodeEventLog({
        abi: boardroomAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "BoardroomActionQueued") continue;
      const args = decoded.args as Record<string, unknown>;
      const actionHash = hexArg(args, "actionHash");
      if (!actionHash || !sameHex(actionHash, input.actionHash)) continue;
      const executor = addressArg(args, "executor");
      const eta = bigintArg(args, "eta");
      const expiresAt = bigintArg(args, "expiresAt");
      const epoch = bigintArg(args, "epoch");
      const salt = hexArg(args, "salt");
      if (!executor || !sameAddress(executor, input.executor)) {
        throw new Error("Queue event executor does not match the transaction sender.");
      }
      if (!salt || !sameHex(salt, input.payload.salt)) {
        throw new Error("Queue event salt does not match the verified calldata.");
      }
      if (eta === undefined || expiresAt === undefined || epoch === undefined) {
        throw new Error("Queue event is missing governance timing fields.");
      }
      return { epoch, eta, expiresAt };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Queue event")) throw error;
    }
  }
  throw new Error("Queue receipt does not contain the matching Boardroom event.");
}

function deduplicateQueuedActionCandidates(candidates: readonly QueuedBoardroomActionCandidate[]): {
  candidates: QueuedBoardroomActionCandidate[];
  errors: QueuedBoardroomActionCandidateError[];
} {
  const deduplicated = new Map<string, QueuedBoardroomActionCandidate>();
  const conflicts = new Set<string>();
  const errors: QueuedBoardroomActionCandidateError[] = [];
  for (const candidate of candidates) {
    const key = actionKey(candidate.boardroom, candidate.actionHash);
    if (conflicts.has(key)) continue;
    const existing = deduplicated.get(key);
    if (!existing) {
      deduplicated.set(key, candidate);
      continue;
    }
    const sameTransaction = sameHex(existing.queueTransactionHash, candidate.queueTransactionHash);
    const compatibleBlock = existing.queueBlockNumber === undefined
      || candidate.queueBlockNumber === undefined
      || existing.queueBlockNumber === candidate.queueBlockNumber;
    if (sameTransaction && compatibleBlock) {
      if (existing.queueBlockNumber === undefined && candidate.queueBlockNumber !== undefined) {
        deduplicated.set(key, candidate);
      }
      continue;
    }
    deduplicated.delete(key);
    conflicts.add(key);
    errors.push({
      boardroom: candidate.boardroom,
      actionHash: candidate.actionHash,
      message: "Conflicting queue candidates were returned for this action.",
    });
  }
  return { candidates: [...deduplicated.values()], errors };
}

function conciseErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split("\n", 1)[0]?.trim();
  return (firstLine || "Candidate could not be verified.").slice(0, 240);
}

function queuedActionStatus(input: {
  terminal: ActionTerminalEvent | undefined;
  currentTime: bigint;
  currentEpoch: bigint;
  eta: bigint;
  expiresAt: bigint;
  actionEpoch: bigint;
}): QueuedBoardroomActionStatus {
  if (input.terminal?.kind === "actionExecuted") return "executed";
  if (input.terminal?.kind === "actionCancelled") return "cancelled";
  if (input.eta === 0n) return "unknown";
  if (input.currentEpoch !== input.actionEpoch) return "invalidated";
  if (input.currentTime > input.expiresAt) return "expired";
  if (input.currentTime >= input.eta) return "ready";
  return "waiting";
}

function actionKey(boardroom: Address, actionHash: Hex): string {
  return `${boardroom.toLowerCase()}:${actionHash.toLowerCase()}`;
}

function sameHex(left: Hex, right: Hex): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function compareEventPosition(left: GovernanceLogMeta, right: GovernanceLogMeta): number {
  if (left.blockNumber < right.blockNumber) return -1;
  if (left.blockNumber > right.blockNumber) return 1;
  return left.logIndex - right.logIndex;
}

function compareBigIntDesc(left: bigint, right: bigint): number {
  if (left > right) return -1;
  if (left < right) return 1;
  return 0;
}

async function getGovernanceLogs(
  client: PledgeCashLogClient,
  input: GovernanceEventsQuery,
): Promise<RawEventLog[]> {
  throwIfAborted(input.signal);
  const address = input.boardrooms.length === 1 ? input.boardrooms[0]! : [...input.boardrooms];
  const chunkSize = input.chunkSize ?? DEFAULT_GOVERNANCE_LOG_CHUNK_SIZE;
  if (chunkSize <= 0n) throw new Error("Governance event chunk size must be greater than zero.");

  let toBlock = input.toBlock;
  if (toBlock === undefined || toBlock === "latest") {
    if (!client.getBlockNumber) {
      throw new Error("Governance event discovery requires an explicit ending block or a client that can read the latest block number.");
    }
    throwIfAborted(input.signal);
    toBlock = await client.getBlockNumber();
    throwIfAborted(input.signal);
  }
  const budget: GovernanceLogBudget = { logsUsed: 0, requestsUsed: 0 };
  const detectedStart = await governanceStartBlock(client, input.boardrooms, input.fromBlock, toBlock, input.signal);
  const fromBlock = detectedStart ?? await governanceLaunchStartBlock(
    client,
    address,
    input.boardrooms,
    toBlock,
    chunkSize,
    budget,
    input.signal,
  );
  throwIfAborted(input.signal);
  if (fromBlock > toBlock) return [];

  const logs: RawEventLog[] = [];
  let start = fromBlock;
  while (start <= toBlock) {
    throwIfAborted(input.signal);
    const end = minBigInt(start + chunkSize - 1n, toBlock);
    logs.push(...await readGovernanceLogRangeAdaptive(client, address, start, end, budget, input.signal));
    throwIfAborted(input.signal);
    start = end + 1n;
  }
  return logs;
}

async function governanceStartBlock(
  client: PledgeCashLogClient,
  boardrooms: readonly Address[],
  requestedFromBlock: bigint | undefined,
  toBlock: bigint,
  signal?: AbortSignal,
): Promise<bigint | undefined> {
  throwIfAborted(signal);
  if (requestedFromBlock !== undefined) return requestedFromBlock;
  if (!client.getCode) return undefined;
  const uniqueBoardrooms = uniqueBoardroomAddresses(boardrooms);
  const starts = await mapInBatches(
    uniqueBoardrooms,
    CONTRACT_START_READ_CONCURRENCY,
    async (address) => await governanceContractStartBlock(client, address, toBlock, signal),
    signal,
  );
  if (starts.some((start) => start === undefined)) return undefined;
  return (starts as bigint[]).reduce((earliest, start) => minBigInt(earliest, start), toBlock + 1n);
}

async function governanceContractStartBlock(
  client: PledgeCashLogClient,
  address: Address,
  toBlock: bigint,
  signal?: AbortSignal,
): Promise<bigint | undefined> {
  throwIfAborted(signal);
  if (!client.getCode) return undefined;
  let clientCache = contractStartBlockCache.get(client);
  if (!clientCache) {
    clientCache = new Map();
    contractStartBlockCache.set(client, clientCache);
  }
  const key = address.toLowerCase();
  const cached = clientCache.get(key);
  if (cached) {
    clientCache.delete(key);
    clientCache.set(key, cached);
    try {
      const start = await waitForGovernanceStartBlock(cached, signal);
      return start;
    } catch {
      throwIfAborted(signal);
      if (clientCache.get(key) === cached) clientCache.delete(key);
      return undefined;
    }
  }

  // The cached lookup is deliberately independent from any one caller's
  // cancellation signal. Each caller races its own wait against its signal,
  // so an abandoned route cannot poison a concurrent or later lookup.
  const request = findGovernanceContractStartBlock(client, address, toBlock);
  while (clientCache.size >= MAX_CONTRACT_START_CACHE_ENTRIES) {
    const oldest = clientCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    clientCache.delete(oldest);
  }
  clientCache.set(key, request);
  try {
    const start = await waitForGovernanceStartBlock(request, signal);
    if (start > toBlock && clientCache.get(key) === request) clientCache.delete(key);
    return start;
  } catch {
    throwIfAborted(signal);
    if (clientCache.get(key) === request) clientCache.delete(key);
    return undefined;
  }
}

async function findGovernanceContractStartBlock(
  client: PledgeCashLogClient,
  address: Address,
  toBlock: bigint,
): Promise<bigint> {
  if (!client.getCode) return 0n;
  const latestCode = await client.getCode({ address, blockNumber: toBlock });
  if (!latestCode || latestCode === "0x") return toBlock + 1n;

  let low = 0n;
  let high = toBlock;
  let steps = 0;
  while (low < high && steps < MAX_CONTRACT_START_SEARCH_STEPS) {
    const middle = (low + high) / 2n;
    const code = await client.getCode({ address, blockNumber: middle });
    if (code && code !== "0x") high = middle;
    else low = middle + 1n;
    steps += 1;
  }
  if (low < high) {
    throw new Error(`Governance contract start-block search exceeded ${MAX_CONTRACT_START_SEARCH_STEPS.toString()} steps.`);
  }
  return low;
}

async function waitForGovernanceStartBlock(request: Promise<bigint>, signal?: AbortSignal): Promise<bigint> {
  throwIfAborted(signal);
  if (!signal) return await request;

  return await new Promise<bigint>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    request.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function governanceLaunchStartBlock(
  client: PledgeCashLogClient,
  address: Address | Address[],
  boardrooms: readonly Address[],
  toBlock: bigint,
  chunkSize: bigint,
  budget: GovernanceLogBudget,
  signal?: AbortSignal,
): Promise<bigint> {
  throwIfAborted(signal);
  const remaining = new Set(uniqueBoardroomAddresses(boardrooms).map((boardroom) => boardroom.toLowerCase()));
  const launchBlocks: bigint[] = [];
  let end = toBlock;
  while (true) {
    throwIfAborted(signal);
    const start = end >= chunkSize - 1n ? end - chunkSize + 1n : 0n;
    const logs = await readGovernanceLaunchRangeAdaptive(client, address, start, end, budget, signal);
    throwIfAborted(signal);
    for (const log of logs) {
      if (!log.address || log.blockNumber === undefined || !remaining.delete(log.address.toLowerCase())) continue;
      launchBlocks.push(log.blockNumber);
    }
    if (remaining.size === 0) {
      return launchBlocks.reduce((earliest, block) => minBigInt(earliest, block), toBlock);
    }
    if (start === 0n) return 0n;
    end = start - 1n;
  }
}

async function readGovernanceLaunchRangeAdaptive(
  client: PledgeCashLogClient,
  address: Address | Address[],
  fromBlock: bigint,
  toBlock: bigint,
  budget: GovernanceLogBudget,
  signal?: AbortSignal,
): Promise<RawEventLog[]> {
  throwIfAborted(signal);
  reserveGovernanceLogRequest(budget);
  try {
    throwIfAborted(signal);
    const logs = (await client.getLogs({
      address,
      event: launchedEvent,
      fromBlock,
      toBlock,
    } as never)) as RawEventLog[];
    throwIfAborted(signal);
    reserveGovernanceLogResults(budget, logs.length);
    return logs;
  } catch (error) {
    throwIfAborted(signal);
    const size = toBlock - fromBlock + 1n;
    if (!isGovernanceLogRangeLimitError(error) || size <= MIN_GOVERNANCE_LOG_CHUNK_SIZE) throw error;
    const middle = fromBlock + (toBlock - fromBlock) / 2n;
    const first = await readGovernanceLaunchRangeAdaptive(client, address, fromBlock, middle, budget, signal);
    const second = await readGovernanceLaunchRangeAdaptive(client, address, middle + 1n, toBlock, budget, signal);
    return [...first, ...second];
  }
}

type GovernanceLogBudget = {
  logsUsed: number;
  requestsUsed: number;
};

async function readGovernanceLogRangeAdaptive(
  client: PledgeCashLogClient,
  address: Address | Address[],
  fromBlock: bigint,
  toBlock: bigint,
  budget: GovernanceLogBudget,
  signal?: AbortSignal,
): Promise<RawEventLog[]> {
  throwIfAborted(signal);
  reserveGovernanceLogRequest(budget);
  try {
    throwIfAborted(signal);
    const logs = (await client.getLogs({
      address,
      events: governanceEventAbis,
      fromBlock,
      toBlock,
    } as never)) as RawEventLog[];
    throwIfAborted(signal);
    reserveGovernanceLogResults(budget, logs.length);
    return logs;
  } catch (error) {
    throwIfAborted(signal);
    const size = toBlock - fromBlock + 1n;
    if (!isGovernanceLogRangeLimitError(error) || size <= MIN_GOVERNANCE_LOG_CHUNK_SIZE) throw error;
    const middle = fromBlock + (toBlock - fromBlock) / 2n;
    const first = await readGovernanceLogRangeAdaptive(client, address, fromBlock, middle, budget, signal);
    const second = await readGovernanceLogRangeAdaptive(client, address, middle + 1n, toBlock, budget, signal);
    return [...first, ...second];
  }
}

function reserveGovernanceLogRequest(budget: GovernanceLogBudget): void {
  if (budget.requestsUsed >= MAX_GOVERNANCE_LOG_REQUESTS) {
    throw new Error(`Governance event scan exceeded its ${MAX_GOVERNANCE_LOG_REQUESTS.toString()}-request safety bound.`);
  }
  budget.requestsUsed += 1;
}

function reserveGovernanceLogResults(budget: GovernanceLogBudget, count: number): void {
  if (count > MAX_GOVERNANCE_LOGS - budget.logsUsed) {
    throw new Error(`Governance event scan exceeds its ${MAX_GOVERNANCE_LOGS.toLocaleString()}-event safety bound.`);
  }
  budget.logsUsed += count;
}

function isGovernanceLogRangeLimitError(error: unknown): boolean {
  const message = governanceLogErrorText(error).toLowerCase();
  if (/(?:rate[ -]?limit|too many requests|\b429\b|quota|throttl)/.test(message)) return false;
  return [
    /(?:exceed|maximum|max|limit|limited)[^.\n]*block range/,
    /(?:limit|limited)[^.\n]*\brange\b/,
    /block range[^.\n]*(?:exceed|maximum|max|limit|too (?:large|wide))/,
    /range[^.\n]*(?:too (?:large|wide)|exceed|limit)/,
    /query returned more than/,
    /too many (?:logs|results)/,
    /response size[^.\n]*(?:exceed|limit|too large)/,
    /please (?:reduce|limit)[^.\n]*(?:block|range)/,
    /eth_getlogs[^.\n]*(?:exceed|limit|too (?:large|wide))/,
  ].some((pattern) => pattern.test(message));
}

function governanceLogErrorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current === "string") {
      parts.push(current);
      break;
    }
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
      continue;
    }
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      for (const field of ["shortMessage", "details", "message"] as const) {
        if (typeof record[field] === "string") parts.push(record[field]);
      }
      current = record.cause;
      continue;
    }
    parts.push(String(current));
    break;
  }
  return parts.join(" ");
}

function toGovernanceEvent(log: RawEventLog): GovernanceEvent | undefined {
  switch (log.eventName) {
    case "BoardroomLaunched": return toLaunchedEvent(log);
    case "ExecutorSet": return toExecutorSetEvent(log);
    case "BoardroomActionQueued": return toActionQueuedEvent(log);
    case "BoardroomActionCancelled": return toActionCancelledEvent(log);
    case "BoardroomActionExecuted": return toActionExecutedEvent(log);
    case "BoardroomCallExecuted": return toCallExecutedEvent(log);
    case "GovernanceEpochAdvanced": return toGovernanceEpochAdvancedEvent(log);
    case "BoardroomWindDownStarted": return toWindDownStartedEvent(log);
    default: return undefined;
  }
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function uniqueBoardroomAddresses(boardrooms: readonly Address[]): Address[] {
  return Array.from(new Map(boardrooms.map((address) => [address.toLowerCase(), address])).values());
}

function assertGovernanceBoardroomBound(boardrooms: readonly Address[]): void {
  if (uniqueBoardroomAddresses(boardrooms).length > MAX_GOVERNANCE_BOARDROOMS) {
    throw new Error(`Governance event scan exceeds its ${MAX_GOVERNANCE_BOARDROOMS.toString()}-Boardroom safety bound.`);
  }
}

async function mapInBatches<T, U>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<U>,
  signal?: AbortSignal,
): Promise<U[]> {
  throwIfAborted(signal);
  const results: U[] = [];
  for (let start = 0; start < values.length; start += concurrency) {
    throwIfAborted(signal);
    const batch = values.slice(start, start + concurrency);
    results.push(...await Promise.all(batch.map(mapper)));
    throwIfAborted(signal);
  }
  return results;
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function toLaunchedEvent(log: RawEventLog): GovernanceEvent | undefined {
  const meta = governanceMeta(log);
  const executor = addressArg(log.args, "executor");
  const governanceDelay = bigintArg(log.args, "governanceDelay");
  if (!meta || !executor || governanceDelay === undefined) return undefined;
  return { kind: "launched", executor, governanceDelay, ...meta };
}

function toExecutorSetEvent(log: RawEventLog): GovernanceEvent | undefined {
  const meta = governanceMeta(log);
  const executor = addressArg(log.args, "executor");
  if (!meta || !executor) return undefined;
  return { kind: "executorSet", executor, ...meta };
}

function toActionQueuedEvent(log: RawEventLog): GovernanceEvent | undefined {
  const meta = governanceMeta(log);
  const actionHash = hexArg(log.args, "actionHash");
  const executor = addressArg(log.args, "executor");
  const eta = bigintArg(log.args, "eta");
  const expiresAt = bigintArg(log.args, "expiresAt");
  const epoch = bigintArg(log.args, "epoch");
  const salt = hexArg(log.args, "salt");
  if (
    !meta
    || !actionHash
    || !executor
    || eta === undefined
    || expiresAt === undefined
    || epoch === undefined
    || !salt
  ) {
    return undefined;
  }
  return { kind: "actionQueued", actionHash, executor, eta, expiresAt, epoch, salt, ...meta };
}

function toActionCancelledEvent(log: RawEventLog): GovernanceEvent | undefined {
  const meta = governanceMeta(log);
  const actionHash = hexArg(log.args, "actionHash");
  const caller = addressArg(log.args, "caller");
  if (!meta || !actionHash || !caller) return undefined;
  return { kind: "actionCancelled", actionHash, caller, ...meta };
}

function toActionExecutedEvent(log: RawEventLog): GovernanceEvent | undefined {
  const meta = governanceMeta(log);
  const actionHash = hexArg(log.args, "actionHash");
  const caller = addressArg(log.args, "caller");
  if (!meta || !actionHash || !caller) return undefined;
  return { kind: "actionExecuted", actionHash, caller, ...meta };
}

function toCallExecutedEvent(log: RawEventLog): GovernanceEvent | undefined {
  const meta = governanceMeta(log);
  const policy = addressArg(log.args, "policy");
  const target = addressArg(log.args, "target");
  const selector = hexArg(log.args, "selector");
  const value = bigintArg(log.args, "value");
  const dataHash = hexArg(log.args, "dataHash");
  if (!meta || !policy || !target || !selector || value === undefined || !dataHash) return undefined;
  return { kind: "callExecuted", policy, target, selector, value, dataHash, ...meta };
}

function toGovernanceEpochAdvancedEvent(log: RawEventLog): GovernanceEvent | undefined {
  const meta = governanceMeta(log);
  const epoch = bigintArg(log.args, "epoch");
  if (!meta || epoch === undefined) return undefined;
  return { kind: "governanceEpochAdvanced", epoch, ...meta };
}

function toWindDownStartedEvent(log: RawEventLog): GovernanceEvent | undefined {
  const meta = governanceMeta(log);
  const caller = addressArg(log.args, "caller");
  if (!meta || !caller) return undefined;
  return { kind: "windDownStarted", caller, ...meta };
}

function governanceMeta(log: RawEventLog): GovernanceLogMeta | undefined {
  if (!log.address || log.blockNumber === undefined || log.logIndex === undefined || !log.transactionHash) {
    return undefined;
  }
  return {
    boardroom: log.address,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    transactionHash: log.transactionHash,
  };
}

function normalizeBoardroomCalls(value: unknown): BoardroomCall[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const calls: BoardroomCall[] = [];
  for (const item of value) {
    const call = normalizeBoardroomCall(item);
    if (!call) return undefined;
    calls.push(call);
  }
  return calls;
}

function normalizeBoardroomCall(value: unknown): BoardroomCall | undefined {
  if (!value || typeof value !== "object") return undefined;

  const fields = value as Record<string, unknown>;
  const tuple = Array.isArray(value) ? value : undefined;
  const policy = addressValue(fields.policy ?? tuple?.[0]);
  const target = addressValue(fields.target ?? tuple?.[1]);
  const amount = bigintValue(fields.value ?? tuple?.[2]);
  const data = hexValue(fields.data ?? tuple?.[3]);
  if (!policy || !target || amount === undefined || !data) return undefined;

  return { policy, target, value: amount, data };
}

function maybeArray<T>(value: T | undefined): T[] {
  return value === undefined ? [] : [value];
}

function addressArg(args: Record<string, unknown> | undefined, name: string): Address | undefined {
  return addressValue(args?.[name]);
}

function hexArg(args: Record<string, unknown> | undefined, name: string): Hex | undefined {
  return hexValue(args?.[name]);
}

function addressValue(value: unknown): Address | undefined {
  return typeof value === "string" ? (value as Address) : undefined;
}

function hexValue(value: unknown): Hex | undefined {
  return typeof value === "string" && isHex(value) ? value : undefined;
}

function bigintArg(args: Record<string, unknown> | undefined, name: string): bigint | undefined {
  return bigintValue(args?.[name]);
}

function bigintValue(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  return undefined;
}

function compareGovernanceEvents(left: GovernanceEvent, right: GovernanceEvent): number {
  if (left.blockNumber < right.blockNumber) return -1;
  if (left.blockNumber > right.blockNumber) return 1;
  return left.logIndex - right.logIndex;
}
