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
import { boardroomAbi, boardroomControllerAbi } from "../generated";
import type { BoardroomCall, PledgeCashGovernanceClient, PledgeCashLogClient } from "./types";

export type { BoardroomCall } from "./types";

export type GovernanceLogMeta = {
  boardroom: Address;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
};

export type GovernanceEvent =
  | (GovernanceLogMeta & {
      kind: "launched";
      controller: Address;
      proposer: Address;
      protectionStaker: Address;
      controllerGeneration: bigint;
      controllerDelay: bigint;
      windDownDelay: bigint;
      gracePeriod: bigint;
    })
  | (GovernanceLogMeta & {
      kind: "controllerReplaced";
      oldController: Address;
      controller: Address;
      controllerGeneration: bigint;
      proposer: Address;
      controllerDelay: bigint;
      gracePeriod: bigint;
    })
  | (GovernanceLogMeta & {
      kind: "boardroomOperationScheduled";
      controller: Address;
      operationId: Hex;
      proposer: Address;
      eta: bigint;
      expiresAt: bigint;
      boardroomEpoch: bigint;
      controllerGeneration: bigint;
      configurationEpoch: bigint;
      salt: Hex;
      callsHash: Hex;
    })
  | (GovernanceLogMeta & {
      kind: "controllerOperationScheduled";
      controller: Address;
      operationId: Hex;
      proposer: Address;
      eta: bigint;
      expiresAt: bigint;
      boardroomEpoch: bigint;
      controllerGeneration: bigint;
      configurationEpoch: bigint;
      salt: Hex;
      dataHash: Hex;
    })
  | (GovernanceLogMeta & { kind: "operationCancelled"; controller: Address; operationId: Hex })
  | (GovernanceLogMeta & { kind: "operationExecuted"; controller: Address; operationId: Hex; executor: Address })
  | (GovernanceLogMeta & {
      kind: "configurationUpdated";
      controller: Address;
      oldProposer: Address;
      proposer: Address;
      oldDelay: bigint;
      delay: bigint;
      oldGracePeriod: bigint;
      gracePeriod: bigint;
      configurationEpoch: bigint;
    })
  | (GovernanceLogMeta & { kind: "operationVetoed"; operationId: Hex; staker: Address })
  | (GovernanceLogMeta & {
      kind: "callExecuted";
      policy: Address;
      target: Address;
      selector: Hex;
      authority: Address;
      value: bigint;
      dataHash: Hex;
    })
  | (GovernanceLogMeta & { kind: "governanceEpochAdvanced"; epoch: bigint })
  | (GovernanceLogMeta & { kind: "windDownStarted"; caller: Address; epoch: bigint; windDownDelay: bigint });

export type GovernanceEventsQuery = {
  boardrooms: readonly Address[];
  controllers?: readonly { boardroom: Address; controller: Address }[];
  fromBlock?: bigint;
  toBlock?: bigint | "latest";
  chunkSize?: bigint;
  signal?: AbortSignal;
};

export type DecodedControllerScheduleInput =
  | {
      kind: "boardroomOperation";
      calls: BoardroomCall[];
      salt: Hex;
      expectedBoardroomEpoch: bigint;
      expectedConfigurationEpoch: bigint;
    }
  | {
      kind: "controllerOperation";
      data: Hex;
      salt: Hex;
      expectedBoardroomEpoch: bigint;
      expectedConfigurationEpoch: bigint;
    };

export type ScheduledBoardroomOperationStatus =
  | "waiting"
  | "ready"
  | "expired"
  | "invalidated"
  | "cancelled"
  | "executed"
  | "unknown";

export type ScheduledBoardroomOperation = {
  boardroom: Address;
  controller: Address;
  operationId: Hex;
  proposer: Address;
  eta: bigint;
  expiresAt: bigint;
  boardroomEpoch: bigint;
  controllerGeneration: bigint;
  configurationEpoch: bigint;
  currentBoardroomEpoch: bigint;
  currentConfigurationEpoch: bigint;
  operationStatus: number;
  salt: Hex;
  scheduleBlockNumber: bigint;
  scheduleTransactionHash: Hex;
  status: ScheduledBoardroomOperationStatus;
  kind?: DecodedControllerScheduleInput["kind"];
  calls?: BoardroomCall[];
  controllerData?: Hex;
  payloadError?: string;
};

export type ScheduledBoardroomOperationsQuery = Omit<GovernanceEventsQuery, "controllers"> & {
  currentTime?: bigint;
};

export type ScheduledBoardroomOperationCandidate = {
  boardroom: Address;
  controller: Address;
  operationId: Hex;
  scheduleTransactionHash: Hex;
  scheduleBlockNumber?: bigint;
};

export type ScheduledBoardroomOperationCandidateError = {
  boardroom: Address;
  controller: Address;
  operationId: Hex;
  message: string;
};

export type HydratedScheduledBoardroomOperations = {
  operations: ScheduledBoardroomOperation[];
  errors: ScheduledBoardroomOperationCandidateError[];
};

type RawEventLog = {
  address?: Address;
  args?: Record<string, unknown>;
  blockNumber?: bigint;
  eventName?: string;
  logIndex?: number;
  transactionHash?: Hex;
};

type ScheduleEvent = Extract<
  GovernanceEvent,
  { kind: "boardroomOperationScheduled" | "controllerOperationScheduled" }
>;

type ScheduleTransaction = {
  blockNumber?: bigint | null;
  from: Address;
  hash: Hex;
  input: Hex;
  to?: Address | null;
};

type ScheduleReceipt = {
  blockNumber: bigint;
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[];
  status: "success" | "reverted";
  transactionHash: Hex;
};

const boardroomEvents = [
  getAbiItem({ abi: boardroomAbi, name: "BoardroomLaunched" }),
  getAbiItem({ abi: boardroomAbi, name: "BoardroomControllerReplaced" }),
  getAbiItem({ abi: boardroomAbi, name: "BoardroomOperationVetoed" }),
  getAbiItem({ abi: boardroomAbi, name: "BoardroomCallExecuted" }),
  getAbiItem({ abi: boardroomAbi, name: "GovernanceEpochAdvanced" }),
  getAbiItem({ abi: boardroomAbi, name: "BoardroomWindDownStarted" }),
] as const;

const controllerEvents = [
  getAbiItem({ abi: boardroomControllerAbi, name: "BoardroomOperationScheduled" }),
  getAbiItem({ abi: boardroomControllerAbi, name: "ControllerOperationScheduled" }),
  getAbiItem({ abi: boardroomControllerAbi, name: "OperationCancelled" }),
  getAbiItem({ abi: boardroomControllerAbi, name: "OperationExecuted" }),
  getAbiItem({ abi: boardroomControllerAbi, name: "ConfigurationUpdated" }),
] as const;

const DEFAULT_CHUNK_SIZE = 100_000n;
const MAX_LOG_REQUESTS = 256;
const MAX_LOGS = 25_000;
const MAX_BOARDROOMS = 64;
const MAX_OPERATIONS = 500;
const MAX_START_SEARCH_STEPS = 64;

export async function queryGovernanceEvents(
  client: PledgeCashLogClient,
  input: GovernanceEventsQuery,
): Promise<GovernanceEvent[]> {
  throwIfAborted(input.signal);
  const boardrooms = uniqueAddresses(input.boardrooms);
  if (boardrooms.length === 0) return [];
  if (boardrooms.length > MAX_BOARDROOMS) {
    throw new Error(`Governance discovery supports at most ${MAX_BOARDROOMS} Boardrooms per query.`);
  }

  const range = await resolveRange(client, boardrooms, input);
  if (range.fromBlock > range.toBlock) return [];
  const budget = { requests: 0, logs: 0 };
  const rawBoardroomLogs = await readLogsInChunks(
    client,
    boardrooms,
    boardroomEvents,
    range.fromBlock,
    range.toBlock,
    input.chunkSize ?? DEFAULT_CHUNK_SIZE,
    budget,
    input.signal,
  );

  const controllerMap = new Map<string, Address>();
  for (const pair of input.controllers ?? []) {
    if (!boardrooms.some((boardroom) => sameAddress(boardroom, pair.boardroom))) continue;
    controllerMap.set(pair.controller.toLowerCase(), pair.boardroom);
  }
  for (const log of rawBoardroomLogs) {
    const boardroom = log.address;
    const args = log.args;
    if (!boardroom || !args) continue;
    if (log.eventName === "BoardroomLaunched") {
      const controller = addressArg(args, "controller");
      if (controller) controllerMap.set(controller.toLowerCase(), boardroom);
    } else if (log.eventName === "BoardroomControllerReplaced") {
      const oldController = addressArg(args, "oldController");
      const newController = addressArg(args, "newController");
      if (oldController) controllerMap.set(oldController.toLowerCase(), boardroom);
      if (newController) controllerMap.set(newController.toLowerCase(), boardroom);
    }
  }

  const controllers = [...controllerMap.keys()] as Address[];
  const rawControllerLogs = controllers.length === 0
    ? []
    : await readLogsInChunks(
        client,
        controllers,
        controllerEvents,
        range.fromBlock,
        range.toBlock,
        input.chunkSize ?? DEFAULT_CHUNK_SIZE,
        budget,
        input.signal,
      );

  const events = [
    ...rawBoardroomLogs.flatMap((log) => maybeEvent(toBoardroomEvent(log))),
    ...rawControllerLogs.flatMap((log) => {
      const controller = log.address;
      const boardroom = controller ? controllerMap.get(controller.toLowerCase()) : undefined;
      return boardroom && controller ? maybeEvent(toControllerEvent(log, boardroom, controller)) : [];
    }),
  ];
  return events.sort(compareGovernanceEvents);
}

export async function queryScheduledBoardroomOperations(
  client: PledgeCashGovernanceClient,
  input: ScheduledBoardroomOperationsQuery,
): Promise<ScheduledBoardroomOperation[]> {
  throwIfAborted(input.signal);
  const boardrooms = uniqueAddresses(input.boardrooms);
  const controllerPairs = (await Promise.all(boardrooms.map(async (boardroom) => {
    const [launched, controller] = await Promise.all([
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "launched" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "controller" }),
    ]);
    return launched && !isZeroAddress(controller as Address)
      ? { boardroom, controller: controller as Address }
      : undefined;
  }))).flatMap((pair) => pair ? [pair] : []);
  if (controllerPairs.length === 0) return [];

  const events = await queryGovernanceEvents(client, { ...input, controllers: controllerPairs });
  const currentControllers = new Set(controllerPairs.map((pair) => pair.controller.toLowerCase()));
  const schedules = latestScheduleEvents(events).filter((event) => currentControllers.has(event.controller.toLowerCase()));
  if (schedules.length > MAX_OPERATIONS) {
    throw new Error(`Governance operation hydration exceeds its ${MAX_OPERATIONS}-operation safety bound.`);
  }

  const currentTime = input.currentTime ?? BigInt(Math.floor(Date.now() / 1_000));
  const operations = await Promise.all(schedules.map(async (event) => {
    try {
      return await hydrateScheduleEvent(client, event, currentTime, input.signal);
    } catch (error) {
      return scheduleFromEvent(event, {
        currentTime,
        currentBoardroomEpoch: 0n,
        currentConfigurationEpoch: 0n,
        operationStatus: 0,
        status: "unknown",
        payloadError: conciseError(error),
      });
    }
  }));
  return operations.sort((left, right) => compareBigIntDesc(left.scheduleBlockNumber, right.scheduleBlockNumber));
}

export async function hydrateScheduledBoardroomOperationCandidates(
  client: PledgeCashGovernanceClient,
  input: {
    candidates: readonly ScheduledBoardroomOperationCandidate[];
    currentTime?: bigint;
    signal?: AbortSignal;
  },
): Promise<HydratedScheduledBoardroomOperations> {
  throwIfAborted(input.signal);
  const { candidates, errors } = deduplicateCandidates(input.candidates);
  if (candidates.length > MAX_OPERATIONS) {
    throw new Error(`Governance candidate hydration exceeds its ${MAX_OPERATIONS}-operation safety bound.`);
  }
  const currentTime = input.currentTime ?? BigInt(Math.floor(Date.now() / 1_000));
  const results = await Promise.all(candidates.map(async (candidate) => {
    try {
      if (!client.getTransactionReceipt) throw new Error("Schedule receipt verification is unavailable.");
      const [transaction, receipt] = await Promise.all([
        client.getTransaction({ hash: candidate.scheduleTransactionHash }),
        client.getTransactionReceipt({ hash: candidate.scheduleTransactionHash }),
      ]);
      const tx = transaction as unknown as ScheduleTransaction;
      const minedReceipt = receipt as unknown as ScheduleReceipt;
      verifyTransactionProvenance(candidate, tx, minedReceipt);
      const decoded = verifiedSchedulePayload(tx, candidate.controller);
      const event = scheduleEventFromReceipt(candidate, decoded, minedReceipt);
      const operation = await hydrateScheduleEvent(client, event, currentTime, input.signal, decoded);
      return { operation };
    } catch (error) {
      return {
        error: {
          boardroom: candidate.boardroom,
          controller: candidate.controller,
          operationId: candidate.operationId,
          message: conciseError(error),
        } satisfies ScheduledBoardroomOperationCandidateError,
      };
    }
  }));
  return {
    operations: results.flatMap((result) => result.operation ? [result.operation] : [])
      .sort((left, right) => compareBigIntDesc(left.scheduleBlockNumber, right.scheduleBlockNumber)),
    errors: [...errors, ...results.flatMap((result) => result.error ? [result.error] : [])],
  };
}

export function decodeControllerScheduleCalldata(data: Hex): DecodedControllerScheduleInput | undefined {
  try {
    const decoded = decodeFunctionData({ abi: boardroomControllerAbi, data });
    const args = decoded.args as readonly unknown[] | undefined;
    if (decoded.functionName === "scheduleBoardroomOperation") {
      const calls = normalizeBoardroomCalls(args?.[0]);
      const salt = hexValue(args?.[1]);
      const expectedBoardroomEpoch = bigintValue(args?.[2]);
      const expectedConfigurationEpoch = bigintValue(args?.[3]);
      if (!calls || !salt || expectedBoardroomEpoch === undefined || expectedConfigurationEpoch === undefined) {
        return undefined;
      }
      return { kind: "boardroomOperation", calls, salt, expectedBoardroomEpoch, expectedConfigurationEpoch };
    }
    if (decoded.functionName === "scheduleControllerOperation") {
      const controllerData = hexValue(args?.[0]);
      const salt = hexValue(args?.[1]);
      const expectedBoardroomEpoch = bigintValue(args?.[2]);
      const expectedConfigurationEpoch = bigintValue(args?.[3]);
      if (!controllerData || !salt || expectedBoardroomEpoch === undefined || expectedConfigurationEpoch === undefined) {
        return undefined;
      }
      return {
        kind: "controllerOperation",
        data: controllerData,
        salt,
        expectedBoardroomEpoch,
        expectedConfigurationEpoch,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function hashBoardroomCalls(calls: readonly BoardroomCall[]): Hex {
  return keccak256(encodeAbiParameters([
    {
      type: "tuple[]",
      components: [
        { name: "policy", type: "address" },
        { name: "target", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
      ],
    },
  ], [calls]));
}

async function hydrateScheduleEvent(
  client: PledgeCashGovernanceClient,
  event: ScheduleEvent,
  currentTime: bigint,
  signal?: AbortSignal,
  knownPayload?: DecodedControllerScheduleInput,
): Promise<ScheduledBoardroomOperation> {
  throwIfAborted(signal);
  const transaction = knownPayload
    ? undefined
    : await client.getTransaction({ hash: event.transactionHash }) as unknown as ScheduleTransaction;
  const payload = knownPayload ?? verifiedSchedulePayload(transaction!, event.controller);
  verifyPayloadAgainstEvent(payload, event);

  const operationHash = await client.readContract({
    address: event.controller,
    abi: boardroomControllerAbi,
    functionName: payload.kind === "boardroomOperation" ? "hashBoardroomOperation" : "hashControllerOperation",
    args: payload.kind === "boardroomOperation"
      ? [payload.calls, payload.salt, payload.expectedBoardroomEpoch, payload.expectedConfigurationEpoch, event.proposer]
      : [payload.data, payload.salt, payload.expectedBoardroomEpoch, payload.expectedConfigurationEpoch, event.proposer],
  });
  if (!sameHex(operationHash as Hex, event.operationId)) {
    throw new Error("Schedule calldata does not match the controller operation hash.");
  }

  const [operationState, boardroomEpoch, currentController, currentGeneration, boardroomStatus, configurationEpoch, proposer] =
    await Promise.all([
      client.readContract({
        address: event.controller,
        abi: boardroomControllerAbi,
        functionName: "operationState",
        args: [event.operationId],
      }),
      client.readContract({ address: event.boardroom, abi: boardroomAbi, functionName: "governanceEpoch" }),
      client.readContract({ address: event.boardroom, abi: boardroomAbi, functionName: "controller" }),
      client.readContract({ address: event.boardroom, abi: boardroomAbi, functionName: "controllerGeneration" }),
      client.readContract({ address: event.boardroom, abi: boardroomAbi, functionName: "status" }),
      client.readContract({ address: event.controller, abi: boardroomControllerAbi, functionName: "configurationEpoch" }),
      client.readContract({ address: event.controller, abi: boardroomControllerAbi, functionName: "proposer" }),
    ]);
  const [eta, expiresAt, rawStatus] = operationState as readonly [bigint, bigint, number];
  if (eta !== event.eta || expiresAt !== event.expiresAt) {
    throw new Error("Scheduled event does not match controller operation timing.");
  }
  const operationStatus = Number(rawStatus);
  const currentBoardroomEpoch = boardroomEpoch as bigint;
  const currentConfigurationEpoch = configurationEpoch as bigint;
  const activeContext = Number(boardroomStatus) === 0
    && sameAddress(currentController as Address, event.controller)
    && (currentGeneration as bigint) === event.controllerGeneration
    && currentBoardroomEpoch === event.boardroomEpoch
    && currentConfigurationEpoch === event.configurationEpoch
    && sameAddress(proposer as Address, event.proposer);
  const status = deriveStatus(operationStatus, activeContext, eta, expiresAt, currentTime);
  return scheduleFromEvent(event, {
    currentTime,
    currentBoardroomEpoch,
    currentConfigurationEpoch,
    operationStatus,
    status,
    ...(payload.kind === "boardroomOperation"
      ? { kind: payload.kind, calls: payload.calls }
      : { kind: payload.kind, controllerData: payload.data }),
  });
}

function scheduleFromEvent(
  event: ScheduleEvent,
  state: {
    currentTime: bigint;
    currentBoardroomEpoch: bigint;
    currentConfigurationEpoch: bigint;
    operationStatus: number;
    status: ScheduledBoardroomOperationStatus;
    kind?: DecodedControllerScheduleInput["kind"];
    calls?: BoardroomCall[];
    controllerData?: Hex;
    payloadError?: string;
  },
): ScheduledBoardroomOperation {
  return {
    boardroom: event.boardroom,
    controller: event.controller,
    operationId: event.operationId,
    proposer: event.proposer,
    eta: event.eta,
    expiresAt: event.expiresAt,
    boardroomEpoch: event.boardroomEpoch,
    controllerGeneration: event.controllerGeneration,
    configurationEpoch: event.configurationEpoch,
    currentBoardroomEpoch: state.currentBoardroomEpoch,
    currentConfigurationEpoch: state.currentConfigurationEpoch,
    operationStatus: state.operationStatus,
    salt: event.salt,
    scheduleBlockNumber: event.blockNumber,
    scheduleTransactionHash: event.transactionHash,
    status: state.status,
    ...(state.kind ? { kind: state.kind } : {}),
    ...(state.calls ? { calls: state.calls } : {}),
    ...(state.controllerData ? { controllerData: state.controllerData } : {}),
    ...(state.payloadError ? { payloadError: state.payloadError } : {}),
  };
}

function deriveStatus(
  operationStatus: number,
  activeContext: boolean,
  eta: bigint,
  expiresAt: bigint,
  currentTime: bigint,
): ScheduledBoardroomOperationStatus {
  if (operationStatus === 2) return "executed";
  if (operationStatus === 3) return "cancelled";
  if (operationStatus !== 1) return "unknown";
  if (!activeContext) return "invalidated";
  if (currentTime > expiresAt) return "expired";
  return currentTime < eta ? "waiting" : "ready";
}

function verifiedSchedulePayload(
  transaction: ScheduleTransaction,
  controller: Address,
): DecodedControllerScheduleInput {
  if (!transaction.to || !sameAddress(transaction.to, controller)) {
    throw new Error("Schedule transaction does not directly target the controller.");
  }
  const decoded = decodeControllerScheduleCalldata(transaction.input);
  if (!decoded) throw new Error("Controller schedule calldata could not be decoded.");
  return decoded;
}

function verifyPayloadAgainstEvent(payload: DecodedControllerScheduleInput, event: ScheduleEvent): void {
  if (!sameHex(payload.salt, event.salt)
    || payload.expectedBoardroomEpoch !== event.boardroomEpoch
    || payload.expectedConfigurationEpoch !== event.configurationEpoch) {
    throw new Error("Schedule calldata context does not match the emitted operation.");
  }
  if (payload.kind === "boardroomOperation" && event.kind === "boardroomOperationScheduled") {
    if (!sameHex(hashBoardroomCalls(payload.calls), event.callsHash)) {
      throw new Error("Scheduled calls do not match the emitted calls hash.");
    }
    return;
  }
  if (payload.kind === "controllerOperation" && event.kind === "controllerOperationScheduled") {
    if (!sameHex(keccak256(payload.data), event.dataHash)) {
      throw new Error("Scheduled controller data does not match the emitted data hash.");
    }
    return;
  }
  throw new Error("Schedule calldata kind does not match the emitted operation kind.");
}

function verifyTransactionProvenance(
  candidate: ScheduledBoardroomOperationCandidate,
  transaction: ScheduleTransaction,
  receipt: ScheduleReceipt,
): void {
  if (!sameHex(transaction.hash, candidate.scheduleTransactionHash)) {
    throw new Error("RPC returned a different schedule transaction hash.");
  }
  if (transaction.blockNumber === null || transaction.blockNumber === undefined) {
    throw new Error("Schedule transaction is not confirmed in a block.");
  }
  if (candidate.scheduleBlockNumber !== undefined && candidate.scheduleBlockNumber !== transaction.blockNumber) {
    throw new Error("Candidate schedule block does not match the mined transaction.");
  }
  if (receipt.status !== "success") throw new Error("Schedule transaction reverted.");
  if (!sameHex(receipt.transactionHash, candidate.scheduleTransactionHash)) {
    throw new Error("Receipt does not match the schedule transaction hash.");
  }
  if (receipt.blockNumber !== transaction.blockNumber) {
    throw new Error("Receipt block does not match the schedule transaction block.");
  }
}

function scheduleEventFromReceipt(
  candidate: ScheduledBoardroomOperationCandidate,
  payload: DecodedControllerScheduleInput,
  receipt: ScheduleReceipt,
): ScheduleEvent {
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, candidate.controller)) continue;
    try {
      const decoded = decodeEventLog({
        abi: boardroomControllerAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const expectedName = payload.kind === "boardroomOperation"
        ? "BoardroomOperationScheduled"
        : "ControllerOperationScheduled";
      if (decoded.eventName !== expectedName) continue;
      const args = decoded.args as Record<string, unknown>;
      const operationId = requireHexArg(args, "operationId");
      if (!sameHex(operationId, candidate.operationId)) continue;
      const common = {
        boardroom: candidate.boardroom,
        controller: candidate.controller,
        operationId,
        proposer: requireAddressArg(args, "proposer"),
        eta: requireBigintArg(args, "eta"),
        expiresAt: requireBigintArg(args, "expiresAt"),
        boardroomEpoch: requireBigintArg(args, "boardroomEpoch"),
        controllerGeneration: requireBigintArg(args, "controllerGeneration"),
        configurationEpoch: requireBigintArg(args, "configurationEpoch"),
        salt: requireHexArg(args, "salt"),
        blockNumber: receipt.blockNumber,
        logIndex: 0,
        transactionHash: receipt.transactionHash,
      };
      return payload.kind === "boardroomOperation"
        ? { ...common, kind: "boardroomOperationScheduled", callsHash: requireHexArg(args, "callsHash") }
        : { ...common, kind: "controllerOperationScheduled", dataHash: requireHexArg(args, "dataHash") };
    } catch {
      continue;
    }
  }
  throw new Error("Schedule receipt does not contain the matching controller event.");
}

function latestScheduleEvents(events: readonly GovernanceEvent[]): ScheduleEvent[] {
  const latest = new Map<string, ScheduleEvent>();
  for (const event of events) {
    if (event.kind !== "boardroomOperationScheduled" && event.kind !== "controllerOperationScheduled") continue;
    latest.set(`${event.controller.toLowerCase()}:${event.operationId.toLowerCase()}`, event);
  }
  return [...latest.values()];
}

function toBoardroomEvent(log: RawEventLog): GovernanceEvent | undefined {
  const meta = logMeta(log);
  if (!meta || !log.args) return undefined;
  const args = log.args;
  switch (log.eventName) {
    case "BoardroomLaunched":
      return {
        ...meta,
        kind: "launched",
        controller: requireAddressArg(args, "controller"),
        proposer: requireAddressArg(args, "proposer"),
        protectionStaker: requireAddressArg(args, "protectionStaker"),
        controllerGeneration: requireBigintArg(args, "controllerGeneration"),
        controllerDelay: requireBigintArg(args, "controllerDelay"),
        windDownDelay: requireBigintArg(args, "windDownDelay"),
        gracePeriod: requireBigintArg(args, "gracePeriod"),
      };
    case "BoardroomControllerReplaced":
      return {
        ...meta,
        kind: "controllerReplaced",
        oldController: requireAddressArg(args, "oldController"),
        controller: requireAddressArg(args, "newController"),
        controllerGeneration: requireBigintArg(args, "generation"),
        proposer: requireAddressArg(args, "proposer"),
        controllerDelay: requireBigintArg(args, "controllerDelay"),
        gracePeriod: requireBigintArg(args, "gracePeriod"),
      };
    case "BoardroomOperationVetoed":
      return {
        ...meta,
        kind: "operationVetoed",
        operationId: requireHexArg(args, "operationId"),
        staker: requireAddressArg(args, "staker"),
      };
    case "BoardroomCallExecuted":
      return {
        ...meta,
        kind: "callExecuted",
        policy: requireAddressArg(args, "policy"),
        target: requireAddressArg(args, "target"),
        selector: requireHexArg(args, "selector"),
        authority: requireAddressArg(args, "authority"),
        value: requireBigintArg(args, "value"),
        dataHash: requireHexArg(args, "dataHash"),
      };
    case "GovernanceEpochAdvanced":
      return { ...meta, kind: "governanceEpochAdvanced", epoch: requireBigintArg(args, "epoch") };
    case "BoardroomWindDownStarted":
      return {
        ...meta,
        kind: "windDownStarted",
        caller: requireAddressArg(args, "caller"),
        epoch: requireBigintArg(args, "epoch"),
        windDownDelay: requireBigintArg(args, "windDownDelay"),
      };
    default:
      return undefined;
  }
}

function toControllerEvent(log: RawEventLog, boardroom: Address, controller: Address): GovernanceEvent | undefined {
  const meta = logMeta({ ...log, address: boardroom });
  if (!meta || !log.args) return undefined;
  const args = log.args;
  switch (log.eventName) {
    case "BoardroomOperationScheduled":
      return {
        ...meta,
        kind: "boardroomOperationScheduled",
        controller,
        operationId: requireHexArg(args, "operationId"),
        proposer: requireAddressArg(args, "proposer"),
        eta: requireBigintArg(args, "eta"),
        expiresAt: requireBigintArg(args, "expiresAt"),
        boardroomEpoch: requireBigintArg(args, "boardroomEpoch"),
        controllerGeneration: requireBigintArg(args, "controllerGeneration"),
        configurationEpoch: requireBigintArg(args, "configurationEpoch"),
        salt: requireHexArg(args, "salt"),
        callsHash: requireHexArg(args, "callsHash"),
      };
    case "ControllerOperationScheduled":
      return {
        ...meta,
        kind: "controllerOperationScheduled",
        controller,
        operationId: requireHexArg(args, "operationId"),
        proposer: requireAddressArg(args, "proposer"),
        eta: requireBigintArg(args, "eta"),
        expiresAt: requireBigintArg(args, "expiresAt"),
        boardroomEpoch: requireBigintArg(args, "boardroomEpoch"),
        controllerGeneration: requireBigintArg(args, "controllerGeneration"),
        configurationEpoch: requireBigintArg(args, "configurationEpoch"),
        salt: requireHexArg(args, "salt"),
        dataHash: requireHexArg(args, "dataHash"),
      };
    case "OperationCancelled":
      return { ...meta, kind: "operationCancelled", controller, operationId: requireHexArg(args, "operationId") };
    case "OperationExecuted":
      return {
        ...meta,
        kind: "operationExecuted",
        controller,
        operationId: requireHexArg(args, "operationId"),
        executor: requireAddressArg(args, "executor"),
      };
    case "ConfigurationUpdated":
      return {
        ...meta,
        kind: "configurationUpdated",
        controller,
        oldProposer: requireAddressArg(args, "oldProposer"),
        proposer: requireAddressArg(args, "newProposer"),
        oldDelay: requireBigintArg(args, "oldDelay"),
        delay: requireBigintArg(args, "newDelay"),
        oldGracePeriod: requireBigintArg(args, "oldGracePeriod"),
        gracePeriod: requireBigintArg(args, "newGracePeriod"),
        configurationEpoch: requireBigintArg(args, "configurationEpoch"),
      };
    default:
      return undefined;
  }
}

async function resolveRange(
  client: PledgeCashLogClient,
  boardrooms: readonly Address[],
  input: GovernanceEventsQuery,
): Promise<{ fromBlock: bigint; toBlock: bigint }> {
  let toBlock = input.toBlock;
  if (toBlock === undefined || toBlock === "latest") {
    if (!client.getBlockNumber) {
      throw new Error("Governance discovery requires an ending block or a client that can read the latest block.");
    }
    toBlock = await client.getBlockNumber();
  }
  if (input.fromBlock !== undefined) return { fromBlock: input.fromBlock, toBlock };
  if (!client.getCode) return { fromBlock: 0n, toBlock };
  const starts = await Promise.all(boardrooms.map(async (boardroom) => findContractStart(client, boardroom, toBlock)));
  return { fromBlock: starts.reduce((minimum, start) => start < minimum ? start : minimum, toBlock + 1n), toBlock };
}

async function findContractStart(client: PledgeCashLogClient, address: Address, toBlock: bigint): Promise<bigint> {
  if (!client.getCode) return 0n;
  const headCode = await client.getCode({ address, blockNumber: toBlock });
  if (!headCode || headCode === "0x") return toBlock + 1n;
  let low = 0n;
  let high = toBlock;
  let steps = 0;
  while (low < high) {
    if (++steps > MAX_START_SEARCH_STEPS) throw new Error("Governance contract start search exceeded its bound.");
    const middle = (low + high) / 2n;
    const code = await client.getCode({ address, blockNumber: middle });
    if (code && code !== "0x") high = middle;
    else low = middle + 1n;
  }
  return low;
}

async function readLogsInChunks(
  client: PledgeCashLogClient,
  addresses: readonly Address[],
  events: readonly unknown[],
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint,
  budget: { requests: number; logs: number },
  signal?: AbortSignal,
): Promise<RawEventLog[]> {
  if (chunkSize <= 0n) throw new Error("Governance event chunk size must be greater than zero.");
  const logs: RawEventLog[] = [];
  for (let start = fromBlock; start <= toBlock;) {
    throwIfAborted(signal);
    const end = minBigInt(start + chunkSize - 1n, toBlock);
    logs.push(...await readLogRangeAdaptive(client, addresses, events, start, end, budget, signal));
    start = end + 1n;
  }
  return logs;
}

async function readLogRangeAdaptive(
  client: PledgeCashLogClient,
  addresses: readonly Address[],
  events: readonly unknown[],
  fromBlock: bigint,
  toBlock: bigint,
  budget: { requests: number; logs: number },
  signal?: AbortSignal,
): Promise<RawEventLog[]> {
  throwIfAborted(signal);
  if (++budget.requests > MAX_LOG_REQUESTS) throw new Error("Governance log request budget exceeded.");
  try {
    const address = addresses.length === 1 ? addresses[0]! : [...addresses];
    const logs = await client.getLogs({ address, events, fromBlock, toBlock } as never) as unknown as RawEventLog[];
    budget.logs += logs.length;
    if (budget.logs > MAX_LOGS) throw new Error("Governance log result exceeds its safety bound.");
    return logs;
  } catch (error) {
    throwIfAborted(signal);
    if (fromBlock === toBlock || conciseError(error).includes("safety bound")) throw error;
    const middle = (fromBlock + toBlock) / 2n;
    const [left, right] = await Promise.all([
      readLogRangeAdaptive(client, addresses, events, fromBlock, middle, budget, signal),
      readLogRangeAdaptive(client, addresses, events, middle + 1n, toBlock, budget, signal),
    ]);
    return [...left, ...right];
  }
}

function deduplicateCandidates(candidates: readonly ScheduledBoardroomOperationCandidate[]): {
  candidates: ScheduledBoardroomOperationCandidate[];
  errors: ScheduledBoardroomOperationCandidateError[];
} {
  const unique = new Map<string, ScheduledBoardroomOperationCandidate>();
  const errors: ScheduledBoardroomOperationCandidateError[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.controller.toLowerCase()}:${candidate.operationId.toLowerCase()}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, candidate);
      continue;
    }
    if (!sameHex(existing.scheduleTransactionHash, candidate.scheduleTransactionHash)
      || !sameAddress(existing.boardroom, candidate.boardroom)) {
      errors.push({
        boardroom: candidate.boardroom,
        controller: candidate.controller,
        operationId: candidate.operationId,
        message: "Conflicting provenance was provided for the same controller operation.",
      });
    }
  }
  return { candidates: [...unique.values()], errors };
}

function normalizeBoardroomCalls(value: unknown): BoardroomCall[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const calls = value.map(normalizeBoardroomCall);
  return calls.every((call): call is BoardroomCall => call !== undefined) ? calls : undefined;
}

function normalizeBoardroomCall(value: unknown): BoardroomCall | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown> & { 0?: unknown; 1?: unknown; 2?: unknown; 3?: unknown };
  const policy = addressValue(item.policy ?? item[0]);
  const target = addressValue(item.target ?? item[1]);
  const amount = bigintValue(item.value ?? item[2]);
  const data = hexValue(item.data ?? item[3]);
  return policy && target && amount !== undefined && data ? { policy, target, value: amount, data } : undefined;
}

function logMeta(log: RawEventLog): GovernanceLogMeta | undefined {
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

function requireAddressArg(args: Record<string, unknown>, key: string): Address {
  const value = addressArg(args, key);
  if (!value) throw new Error(`Governance event is missing ${key}.`);
  return value;
}

function requireBigintArg(args: Record<string, unknown>, key: string): bigint {
  const value = bigintArg(args, key);
  if (value === undefined) throw new Error(`Governance event is missing ${key}.`);
  return value;
}

function requireHexArg(args: Record<string, unknown>, key: string): Hex {
  const value = hexArg(args, key);
  if (!value) throw new Error(`Governance event is missing ${key}.`);
  return value;
}

function addressArg(args: Record<string, unknown>, key: string): Address | undefined {
  return addressValue(args[key]);
}

function bigintArg(args: Record<string, unknown>, key: string): bigint | undefined {
  return bigintValue(args[key]);
}

function hexArg(args: Record<string, unknown>, key: string): Hex | undefined {
  return hexValue(args[key]);
}

function addressValue(value: unknown): Address | undefined {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) ? value as Address : undefined;
}

function bigintValue(value: unknown): bigint | undefined {
  return typeof value === "bigint" ? value : undefined;
}

function hexValue(value: unknown): Hex | undefined {
  return typeof value === "string" && isHex(value) ? value as Hex : undefined;
}

function uniqueAddresses(addresses: readonly Address[]): Address[] {
  const unique = new Map<string, Address>();
  for (const address of addresses) unique.set(address.toLowerCase(), address);
  return [...unique.values()];
}

function maybeEvent(event: GovernanceEvent | undefined): GovernanceEvent[] {
  return event ? [event] : [];
}

function isZeroAddress(address: Address): boolean {
  return /^0x0{40}$/i.test(address);
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHex(left: Hex, right: Hex): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function compareGovernanceEvents(left: GovernanceLogMeta, right: GovernanceLogMeta): number {
  if (left.blockNumber < right.blockNumber) return -1;
  if (left.blockNumber > right.blockNumber) return 1;
  return left.logIndex - right.logIndex;
}

function compareBigIntDesc(left: bigint, right: bigint): number {
  if (left > right) return -1;
  if (left < right) return 1;
  return 0;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function conciseError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
}
