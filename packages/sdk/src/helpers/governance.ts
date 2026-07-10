import {
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

type RawEventLog = {
  address?: Address;
  args?: Record<string, unknown>;
  blockNumber?: bigint;
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

export async function queryGovernanceEvents(
  client: PledgeCashLogClient,
  input: GovernanceEventsQuery,
): Promise<GovernanceEvent[]> {
  if (input.boardrooms.length === 0) return [];

  const [
    launchedLogs,
    executorSetLogs,
    queuedLogs,
    cancelledLogs,
    executedLogs,
    callExecutedLogs,
    governanceEpochAdvancedLogs,
    windDownLogs,
  ] = await Promise.all([
      getGovernanceLogs(client, input, launchedEvent),
      getGovernanceLogs(client, input, executorSetEvent),
      getGovernanceLogs(client, input, actionQueuedEvent),
      getGovernanceLogs(client, input, actionCancelledEvent),
      getGovernanceLogs(client, input, actionExecutedEvent),
      getGovernanceLogs(client, input, callExecutedEvent),
      getGovernanceLogs(client, input, governanceEpochAdvancedEvent),
      getGovernanceLogs(client, input, windDownStartedEvent),
    ]);

  return [
    ...launchedLogs.flatMap((log) => maybeArray(toLaunchedEvent(log))),
    ...executorSetLogs.flatMap((log) => maybeArray(toExecutorSetEvent(log))),
    ...queuedLogs.flatMap((log) => maybeArray(toActionQueuedEvent(log))),
    ...cancelledLogs.flatMap((log) => maybeArray(toActionCancelledEvent(log))),
    ...executedLogs.flatMap((log) => maybeArray(toActionExecutedEvent(log))),
    ...callExecutedLogs.flatMap((log) => maybeArray(toCallExecutedEvent(log))),
    ...governanceEpochAdvancedLogs.flatMap((log) => maybeArray(toGovernanceEpochAdvancedEvent(log))),
    ...windDownLogs.flatMap((log) => maybeArray(toWindDownStartedEvent(log))),
  ].sort(compareGovernanceEvents);
}

export async function queryQueuedBoardroomActions(
  client: PledgeCashGovernanceClient,
  input: QueuedBoardroomActionsQuery,
): Promise<QueuedBoardroomAction[]> {
  const events = await queryGovernanceEvents(client, input);
  const latestQueues = latestQueueEvents(events);
  const currentTime = input.currentTime ?? BigInt(Math.floor(Date.now() / 1000));

  const actions = await Promise.all(
    latestQueues.map(async (queued) => {
      const [governanceStateResult, payload] = await Promise.all([
        client.readContract({
          address: queued.boardroom,
          abi: boardroomAbi,
          functionName: "governanceState",
          args: [queued.actionHash],
        }),
        readQueuedPayload(client, queued),
      ]);
      const [currentEpoch, eta, expiresAt, actionEpoch, actionStatus] = governanceStateResult as readonly [
        bigint,
        bigint,
        bigint,
        bigint,
        number,
      ];
      const terminal = latestTerminalEvent(events, queued);
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
    }),
  );

  return actions.sort((left, right) => compareBigIntDesc(left.queueBlockNumber, right.queueBlockNumber));
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

function latestQueueEvents(events: readonly GovernanceEvent[]): ActionQueuedEvent[] {
  const latest = new Map<string, ActionQueuedEvent>();
  for (const event of events) {
    if (event.kind !== "actionQueued") continue;
    latest.set(actionKey(event.boardroom, event.actionHash), event);
  }
  return [...latest.values()];
}

function latestTerminalEvent(
  events: readonly GovernanceEvent[],
  queued: ActionQueuedEvent,
): ActionTerminalEvent | undefined {
  let terminal: ActionTerminalEvent | undefined;
  for (const event of events) {
    if (event.kind !== "actionCancelled" && event.kind !== "actionExecuted") continue;
    if (actionKey(event.boardroom, event.actionHash) !== actionKey(queued.boardroom, queued.actionHash)) continue;
    if (compareEventPosition(event, queued) <= 0) continue;
    terminal = event;
  }
  return terminal;
}

async function readQueuedPayload(
  client: PledgeCashGovernanceClient,
  queued: ActionQueuedEvent,
): Promise<Pick<QueuedBoardroomAction, "kind" | "calls"> | Pick<QueuedBoardroomAction, "payloadError">> {
  try {
    const transaction = await client.getTransaction({ hash: queued.transactionHash });
    if (!transaction.to || !sameAddress(transaction.to, queued.boardroom)) {
      return { payloadError: "Queue transaction does not directly target the Boardroom." };
    }

    const decoded = decodeQueueCalldata(transaction.input);
    if (!decoded) return { payloadError: "Queue calldata could not be decoded." };
    const calls = decoded.kind === "queueAction" ? [decoded.call] : decoded.calls;
    const computedHash = decoded.kind === "queueAction"
      ? hashAction(decoded.call, decoded.salt)
      : hashBatch(decoded.calls, decoded.salt);
    if (computedHash.toLowerCase() !== queued.actionHash.toLowerCase()) {
      return { payloadError: "Queue calldata does not match the emitted action hash." };
    }
    if (decoded.salt.toLowerCase() !== queued.salt.toLowerCase()) {
      return { payloadError: "Queue calldata does not match the emitted salt." };
    }

    return { kind: decoded.kind, calls };
  } catch (error) {
    return { payloadError: error instanceof Error ? error.message : String(error) };
  }
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
  event: unknown,
): Promise<RawEventLog[]> {
  const address = input.boardrooms.length === 1 ? input.boardrooms[0]! : [...input.boardrooms];
  return (await client.getLogs({
    address,
    event,
    fromBlock: input.fromBlock ?? 0n,
    toBlock: input.toBlock,
  } as never)) as RawEventLog[];
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
