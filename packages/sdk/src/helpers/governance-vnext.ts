import {
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  hashTypedData,
  isHex,
  keccak256,
  parseAbi,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { boardroomDiamondAbi, boardroomVNextControllerAbi } from "../generated";
import {
  hashBoardroomCalls,
  type GovernanceEvent,
  type GovernanceEventsQuery,
  type GovernanceLogMeta,
  type ScheduledBoardroomOperation,
  type ScheduledBoardroomOperationCandidate,
  type ScheduledBoardroomOperationCandidateError,
  type ScheduledBoardroomOperationStatus,
} from "./governance";
import type { BoardroomCall, PledgeCashGovernanceClient, PledgeCashLogClient } from "./types";

type LegacyScheduleEvent = Extract<
  GovernanceEvent,
  { kind: "boardroomOperationScheduled" | "controllerOperationScheduled" }
>;

export type BoardroomVNextScheduleEvent =
  | (GovernanceLogMeta & {
      kind: "boardroomOperationScheduled";
      controller: Address;
      operationId: Hex;
      proposer: Address;
      facetSetHash: Hex;
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
      facetSetHash: Hex;
      eta: bigint;
      expiresAt: bigint;
      boardroomEpoch: bigint;
      controllerGeneration: bigint;
      configurationEpoch: bigint;
      salt: Hex;
      dataHash: Hex;
    });

export type BoardroomVNextGovernanceEvent =
  | Exclude<GovernanceEvent, LegacyScheduleEvent>
  | BoardroomVNextScheduleEvent;

export type BoardroomVNextGovernanceEventsQuery = GovernanceEventsQuery;

export type DecodedBoardroomVNextControllerScheduleInput =
  | {
      kind: "boardroomOperation";
      expectedFacetSetHash: Hex;
      calls: BoardroomCall[];
      salt: Hex;
      expectedBoardroomEpoch: bigint;
      expectedConfigurationEpoch: bigint;
    }
  | {
      kind: "controllerOperation";
      expectedFacetSetHash: Hex;
      data: Hex;
      salt: Hex;
      expectedBoardroomEpoch: bigint;
      expectedConfigurationEpoch: bigint;
    };

export type ScheduledBoardroomVNextOperation = Omit<ScheduledBoardroomOperation, "kind"> & {
  facetSetHash: Hex;
  currentFacetSetHash: Hex;
  kind?: DecodedBoardroomVNextControllerScheduleInput["kind"];
};

export type ScheduledBoardroomVNextOperationsQuery = Omit<BoardroomVNextGovernanceEventsQuery, "controllers"> & {
  currentTime?: bigint;
};

export type HydratedScheduledBoardroomVNextOperations = {
  operations: ScheduledBoardroomVNextOperation[];
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

const boardroomEventNames = new Set([
  "BoardroomLaunched",
  "BoardroomControllerReplaced",
  "BoardroomOperationVetoed",
  "BoardroomCallExecuted",
  "GovernanceEpochAdvanced",
  "BoardroomWindDownStarted",
]);
const generatedBoardroomEvents = (
  boardroomDiamondAbi as readonly { type: string; name?: string }[]
).filter(
  (item) => item.type === "event" && item.name !== undefined && boardroomEventNames.has(item.name),
);
// Older checked-in aggregate ABIs contain only the callable interface. Keep an
// exact event-only fallback so this helper also works before ABI regeneration.
const boardroomEventFallback = parseAbi([
  "event BoardroomLaunched(address indexed controller,address indexed proposer,address indexed protectionStaker,uint256 controllerGeneration,uint256 controllerDelay,uint256 windDownDelay,uint256 gracePeriod)",
  "event BoardroomControllerReplaced(address indexed oldController,address indexed newController,uint256 indexed generation,address proposer,uint256 controllerDelay,uint256 gracePeriod)",
  "event BoardroomOperationVetoed(bytes32 indexed operationId,address indexed staker)",
  "event BoardroomCallExecuted(address indexed policy,address indexed target,bytes4 indexed selector,address authority,uint256 value,bytes32 dataHash)",
  "event GovernanceEpochAdvanced(uint256 indexed epoch)",
  "event BoardroomWindDownStarted(address indexed caller,uint256 indexed epoch,uint256 windDownDelay)",
]);
const boardroomEvents = generatedBoardroomEvents.length === boardroomEventNames.size
  ? generatedBoardroomEvents
  : boardroomEventFallback;

const controllerEventNames = new Set([
  "BoardroomOperationScheduled",
  "ControllerOperationScheduled",
  "OperationCancelled",
  "OperationExecuted",
  "ConfigurationUpdated",
]);
const controllerEvents = boardroomVNextControllerAbi.filter(
  (item) => item.type === "event" && controllerEventNames.has(item.name),
);

const DEFAULT_CHUNK_SIZE = 100_000n;
const MAX_LOG_REQUESTS = 256;
const MAX_LOGS = 25_000;
const MAX_BOARDROOMS = 64;
const MAX_OPERATIONS = 500;
const MAX_START_SEARCH_STEPS = 64;
const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
const BOARDROOM_VNEXT_ERC1271_DOMAIN_NAME = "PledgeCash Boardroom vNext Controller";
const BOARDROOM_VNEXT_ERC1271_DOMAIN_VERSION = "1";
export const BOARDROOM_VNEXT_ERC1271_ENVELOPE_SCHEME = keccak256(stringToHex(
  "PledgeCash.BoardroomVNextController.ERC1271Envelope.v1",
)).slice(0, 10) as Hex;
const BOARDROOM_VNEXT_CONTROL_PROOF_TYPES = {
  BoardroomControlProof: [
    { name: "messageHash", type: "bytes32" },
    { name: "boardroom", type: "address" },
    { name: "facetSetHash", type: "bytes32" },
    { name: "boardroomEpoch", type: "uint256" },
    { name: "controllerGeneration", type: "uint256" },
    { name: "configurationEpoch", type: "uint256" },
    { name: "configurationHash", type: "bytes32" },
  ],
} as const;
const BOARDROOM_VNEXT_ERC1271_ENVELOPE_PARAMETERS = [
  { type: "bytes4" },
  { type: "bytes32" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "bytes32" },
  { type: "bytes" },
] as const;

export type BoardroomVNextERC1271DigestInput = {
  messageHash: Hex;
  controller: Address;
  boardroom: Address;
  chainId: bigint;
  facetSetHash: Hex;
  boardroomEpoch: bigint;
  controllerGeneration: bigint;
  configurationEpoch: bigint;
  configurationHash: Hex;
};

/**
 * Builds the exact EIP-712 proof accepted by BoardroomVNextController.
 * Every context field must come from the same pinned block. EOAs should sign
 * this typed data directly, not use `signMessage`. Safe tooling should sign or
 * approve the digest returned by `hashBoardroomVNextERC1271Digest` through its
 * normal Safe/ERC-1271 flow.
 */
export function buildBoardroomVNextERC1271TypedData(input: BoardroomVNextERC1271DigestInput) {
  return {
    domain: {
      name: BOARDROOM_VNEXT_ERC1271_DOMAIN_NAME,
      version: BOARDROOM_VNEXT_ERC1271_DOMAIN_VERSION,
      chainId: requireUint256("chainId", input.chainId),
      verifyingContract: input.controller,
    },
    types: BOARDROOM_VNEXT_CONTROL_PROOF_TYPES,
    primaryType: "BoardroomControlProof",
    message: {
      messageHash: requireBytes32("messageHash", input.messageHash),
      boardroom: input.boardroom,
      facetSetHash: requireBytes32("facetSetHash", input.facetSetHash),
      boardroomEpoch: requireUint256("boardroomEpoch", input.boardroomEpoch),
      controllerGeneration: requireUint256(
        "controllerGeneration",
        input.controllerGeneration,
      ),
      configurationEpoch: requireUint256(
        "configurationEpoch",
        input.configurationEpoch,
      ),
      configurationHash: requireBytes32("configurationHash", input.configurationHash),
    },
  } as const;
}

export function hashBoardroomVNextERC1271Digest(input: BoardroomVNextERC1271DigestInput): Hex {
  return hashTypedData(buildBoardroomVNextERC1271TypedData(input));
}

/**
 * Encodes the canonical v1 ERC-1271 envelope. `proposerSignature` must be an
 * EOA typed-data signature or a contract-wallet signature/approval over the
 * digest returned by `hashBoardroomVNextERC1271Digest`.
 */
export function encodeBoardroomVNextERC1271Signature(input: {
  facetSetHash: Hex;
  boardroomEpoch: bigint;
  controllerGeneration: bigint;
  configurationEpoch: bigint;
  configurationHash: Hex;
  proposerSignature: Hex;
}): Hex {
  if (!isStrictHexBytes(input.proposerSignature)) {
    throw new Error("proposerSignature must be hex-encoded bytes.");
  }
  return encodeAbiParameters(
    BOARDROOM_VNEXT_ERC1271_ENVELOPE_PARAMETERS,
    [
      BOARDROOM_VNEXT_ERC1271_ENVELOPE_SCHEME,
      requireBytes32("facetSetHash", input.facetSetHash),
      requireUint256("boardroomEpoch", input.boardroomEpoch),
      requireUint256("controllerGeneration", input.controllerGeneration),
      requireUint256("configurationEpoch", input.configurationEpoch),
      requireBytes32("configurationHash", input.configurationHash),
      input.proposerSignature,
    ],
  );
}

export type DecodedBoardroomVNextERC1271Signature = {
  scheme: Hex;
  facetSetHash: Hex;
  boardroomEpoch: bigint;
  controllerGeneration: bigint;
  configurationEpoch: bigint;
  configurationHash: Hex;
  proposerSignature: Hex;
};

export function decodeBoardroomVNextERC1271Signature(
  signature: Hex,
): DecodedBoardroomVNextERC1271Signature {
  if (!isStrictHexBytes(signature)) {
    throw new Error("ERC-1271 envelope must be hex-encoded bytes.");
  }

  let decoded: readonly [Hex, Hex, bigint, bigint, bigint, Hex, Hex];
  try {
    decoded = decodeAbiParameters(
      BOARDROOM_VNEXT_ERC1271_ENVELOPE_PARAMETERS,
      signature,
    );
  } catch {
    throw new Error("ERC-1271 envelope is malformed.");
  }
  const [
    scheme,
    facetSetHash,
    boardroomEpoch,
    controllerGeneration,
    configurationEpoch,
    configurationHash,
    proposerSignature,
  ] = decoded;
  if (scheme.toLowerCase() !== BOARDROOM_VNEXT_ERC1271_ENVELOPE_SCHEME.toLowerCase()) {
    throw new Error("ERC-1271 envelope uses an unsupported scheme.");
  }

  const canonical = encodeAbiParameters(
    BOARDROOM_VNEXT_ERC1271_ENVELOPE_PARAMETERS,
    decoded,
  );
  if (canonical.toLowerCase() !== signature.toLowerCase()) {
    throw new Error("ERC-1271 envelope is not canonically encoded.");
  }
  return {
    scheme,
    facetSetHash,
    boardroomEpoch,
    controllerGeneration,
    configurationEpoch,
    configurationHash,
    proposerSignature,
  };
}

export async function queryBoardroomVNextGovernanceEvents(
  client: PledgeCashLogClient,
  input: BoardroomVNextGovernanceEventsQuery,
): Promise<BoardroomVNextGovernanceEvent[]> {
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

export async function queryScheduledBoardroomVNextOperations(
  client: PledgeCashGovernanceClient,
  input: ScheduledBoardroomVNextOperationsQuery,
): Promise<ScheduledBoardroomVNextOperation[]> {
  throwIfAborted(input.signal);
  const boardrooms = uniqueAddresses(input.boardrooms);
  if (boardrooms.length === 0) return [];
  if (boardrooms.length > MAX_BOARDROOMS) {
    throw new Error(`Governance discovery supports at most ${MAX_BOARDROOMS} Boardrooms per query.`);
  }
  // Controller discovery and readiness must describe one chain snapshot.
  const snapshotBlockNumber = await readSnapshotBlockNumber(client);
  const controllerPairs = (await Promise.all(boardrooms.map(async (boardroom) => {
    const [launched, controller] = await Promise.all([
      client.readContract({
        address: boardroom,
        abi: boardroomDiamondAbi,
        functionName: "launched",
        blockNumber: snapshotBlockNumber,
      }),
      client.readContract({
        address: boardroom,
        abi: boardroomDiamondAbi,
        functionName: "controller",
        blockNumber: snapshotBlockNumber,
      }),
    ]);
    return launched && !isZeroAddress(controller as Address)
      ? { boardroom, controller: controller as Address }
      : undefined;
  }))).flatMap((pair) => pair ? [pair] : []);
  if (controllerPairs.length === 0) return [];

  const requestedToBlock = input.toBlock;
  const eventToBlock = typeof requestedToBlock === "bigint" && requestedToBlock < snapshotBlockNumber
    ? requestedToBlock
    : snapshotBlockNumber;
  const events = await queryBoardroomVNextGovernanceEvents(client, {
    ...input,
    toBlock: eventToBlock,
    controllers: controllerPairs,
  });
  const currentControllers = new Set(controllerPairs.map((pair) => pair.controller.toLowerCase()));
  const schedules = latestScheduleEvents(events).filter((event) => currentControllers.has(event.controller.toLowerCase()));
  if (schedules.length > MAX_OPERATIONS) {
    throw new Error(`Governance operation hydration exceeds its ${MAX_OPERATIONS}-operation safety bound.`);
  }

  const currentTime = input.currentTime ?? BigInt(Math.floor(Date.now() / 1_000));
  const operations = await Promise.all(schedules.map(async (event) => {
    try {
      return await hydrateScheduleEvent(client, event, snapshotBlockNumber, currentTime, input.signal);
    } catch (error) {
      return scheduleFromEvent(event, {
        currentBoardroomEpoch: 0n,
        currentConfigurationEpoch: 0n,
        currentFacetSetHash: ZERO_HASH,
        operationStatus: 0,
        status: "unknown",
        payloadError: conciseError(error),
      });
    }
  }));
  return operations.sort((left, right) => compareBigIntDesc(left.scheduleBlockNumber, right.scheduleBlockNumber));
}

export async function hydrateScheduledBoardroomVNextOperationCandidates(
  client: PledgeCashGovernanceClient,
  input: {
    candidates: readonly ScheduledBoardroomOperationCandidate[];
    currentTime?: bigint;
    signal?: AbortSignal;
  },
): Promise<HydratedScheduledBoardroomVNextOperations> {
  throwIfAborted(input.signal);
  const { candidates, errors } = deduplicateCandidates(input.candidates);
  if (candidates.length > MAX_OPERATIONS) {
    throw new Error(`Governance candidate hydration exceeds its ${MAX_OPERATIONS}-operation safety bound.`);
  }
  if (candidates.length === 0) return { operations: [], errors };
  const snapshotBlockNumber = await readSnapshotBlockNumber(client);
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
      const operation = await hydrateScheduleEvent(
        client,
        event,
        snapshotBlockNumber,
        currentTime,
        input.signal,
        decoded,
      );
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

export function decodeBoardroomVNextControllerScheduleCalldata(
  data: Hex,
): DecodedBoardroomVNextControllerScheduleInput | undefined {
  try {
    const decoded = decodeFunctionData({ abi: boardroomVNextControllerAbi, data });
    const args = decoded.args as readonly unknown[] | undefined;
    const expectedFacetSetHash = hexValue(args?.[0]);
    if (!expectedFacetSetHash) return undefined;
    if (decoded.functionName === "scheduleBoardroomOperation") {
      const calls = normalizeBoardroomCalls(args?.[1]);
      const salt = hexValue(args?.[2]);
      const expectedBoardroomEpoch = bigintValue(args?.[3]);
      const expectedConfigurationEpoch = bigintValue(args?.[4]);
      if (!calls || !salt || expectedBoardroomEpoch === undefined || expectedConfigurationEpoch === undefined) {
        return undefined;
      }
      return {
        kind: "boardroomOperation",
        expectedFacetSetHash,
        calls,
        salt,
        expectedBoardroomEpoch,
        expectedConfigurationEpoch,
      };
    }
    if (decoded.functionName === "scheduleControllerOperation") {
      const controllerData = hexValue(args?.[1]);
      const salt = hexValue(args?.[2]);
      const expectedBoardroomEpoch = bigintValue(args?.[3]);
      const expectedConfigurationEpoch = bigintValue(args?.[4]);
      if (!controllerData || !salt || expectedBoardroomEpoch === undefined || expectedConfigurationEpoch === undefined) {
        return undefined;
      }
      return {
        kind: "controllerOperation",
        expectedFacetSetHash,
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

async function readSnapshotBlockNumber(client: PledgeCashGovernanceClient): Promise<bigint> {
  if (!client.getBlockNumber) {
    throw new Error("Governance operation hydration requires a client that can read the latest block.");
  }
  return client.getBlockNumber();
}

async function hydrateScheduleEvent(
  client: PledgeCashGovernanceClient,
  event: BoardroomVNextScheduleEvent,
  snapshotBlockNumber: bigint,
  currentTime: bigint,
  signal?: AbortSignal,
  knownPayload?: DecodedBoardroomVNextControllerScheduleInput,
): Promise<ScheduledBoardroomVNextOperation> {
  throwIfAborted(signal);
  const transaction = knownPayload
    ? undefined
    : await client.getTransaction({ hash: event.transactionHash }) as unknown as ScheduleTransaction;
  const payload = knownPayload ?? verifiedSchedulePayload(transaction!, event.controller);
  verifyPayloadAgainstEvent(payload, event);

  // The controller event is authoritative for the operation ID. Its calldata
  // context and payload hash are checked above; re-calling the hash helper can
  // observe a configuration update executed later in the same block.

  const [
    operationState,
    boardroomEpoch,
    currentController,
    currentGeneration,
    boardroomStatus,
    currentFacetSetHash,
    configurationEpoch,
    proposer,
  ] = await Promise.all([
    client.readContract({
      address: event.controller,
      abi: boardroomVNextControllerAbi,
      functionName: "operationState",
      args: [event.operationId],
      blockNumber: snapshotBlockNumber,
    }),
    client.readContract({
      address: event.boardroom,
      abi: boardroomDiamondAbi,
      functionName: "governanceEpoch",
      blockNumber: snapshotBlockNumber,
    }),
    client.readContract({
      address: event.boardroom,
      abi: boardroomDiamondAbi,
      functionName: "controller",
      blockNumber: snapshotBlockNumber,
    }),
    client.readContract({
      address: event.boardroom,
      abi: boardroomDiamondAbi,
      functionName: "controllerGeneration",
      blockNumber: snapshotBlockNumber,
    }),
    client.readContract({
      address: event.boardroom,
      abi: boardroomDiamondAbi,
      functionName: "status",
      blockNumber: snapshotBlockNumber,
    }),
    client.readContract({
      address: event.boardroom,
      abi: boardroomDiamondAbi,
      functionName: "facetSetHash",
      blockNumber: snapshotBlockNumber,
    }),
    client.readContract({
      address: event.controller,
      abi: boardroomVNextControllerAbi,
      functionName: "configurationEpoch",
      blockNumber: snapshotBlockNumber,
    }),
    client.readContract({
      address: event.controller,
      abi: boardroomVNextControllerAbi,
      functionName: "proposer",
      blockNumber: snapshotBlockNumber,
    }),
  ]);
  const [eta, expiresAt, rawStatus] = operationState as readonly [bigint, bigint, number];
  if (eta !== event.eta || expiresAt !== event.expiresAt) {
    throw new Error("Scheduled event does not match controller operation timing.");
  }
  const operationStatus = Number(rawStatus);
  const currentBoardroomEpoch = boardroomEpoch as bigint;
  const currentConfigurationEpoch = configurationEpoch as bigint;
  const resolvedFacetSetHash = currentFacetSetHash as Hex;
  const activeContext = Number(boardroomStatus) === 0
    && sameAddress(currentController as Address, event.controller)
    && (currentGeneration as bigint) === event.controllerGeneration
    && currentBoardroomEpoch === event.boardroomEpoch
    && currentConfigurationEpoch === event.configurationEpoch
    && sameAddress(proposer as Address, event.proposer)
    && sameHex(resolvedFacetSetHash, event.facetSetHash);
  const status = deriveStatus(operationStatus, activeContext, eta, expiresAt, currentTime);
  return scheduleFromEvent(event, {
    currentBoardroomEpoch,
    currentConfigurationEpoch,
    currentFacetSetHash: resolvedFacetSetHash,
    operationStatus,
    status,
    ...(payload.kind === "boardroomOperation"
      ? { kind: payload.kind, calls: payload.calls }
      : { kind: payload.kind, controllerData: payload.data }),
  });
}

function scheduleFromEvent(
  event: BoardroomVNextScheduleEvent,
  state: {
    currentBoardroomEpoch: bigint;
    currentConfigurationEpoch: bigint;
    currentFacetSetHash: Hex;
    operationStatus: number;
    status: ScheduledBoardroomOperationStatus;
    kind?: DecodedBoardroomVNextControllerScheduleInput["kind"];
    calls?: BoardroomCall[];
    controllerData?: Hex;
    payloadError?: string;
  },
): ScheduledBoardroomVNextOperation {
  return {
    boardroom: event.boardroom,
    controller: event.controller,
    operationId: event.operationId,
    proposer: event.proposer,
    facetSetHash: event.facetSetHash,
    currentFacetSetHash: state.currentFacetSetHash,
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
): DecodedBoardroomVNextControllerScheduleInput {
  if (!transaction.to || !sameAddress(transaction.to, controller)) {
    throw new Error("Schedule transaction does not directly target the controller.");
  }
  const decoded = decodeBoardroomVNextControllerScheduleCalldata(transaction.input);
  if (!decoded) throw new Error("vNext controller schedule calldata could not be decoded.");
  return decoded;
}

function verifyPayloadAgainstEvent(
  payload: DecodedBoardroomVNextControllerScheduleInput,
  event: BoardroomVNextScheduleEvent,
): void {
  if (!sameHex(payload.expectedFacetSetHash, event.facetSetHash)
    || !sameHex(payload.salt, event.salt)
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
  payload: DecodedBoardroomVNextControllerScheduleInput,
  receipt: ScheduleReceipt,
): BoardroomVNextScheduleEvent {
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, candidate.controller)) continue;
    try {
      const decoded = decodeEventLog({
        abi: boardroomVNextControllerAbi,
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
        facetSetHash: requireHexArg(args, "facetSetHash"),
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
  throw new Error("Schedule receipt does not contain the matching vNext controller event.");
}

function latestScheduleEvents(events: readonly BoardroomVNextGovernanceEvent[]): BoardroomVNextScheduleEvent[] {
  const latest = new Map<string, BoardroomVNextScheduleEvent>();
  for (const event of events) {
    if (event.kind !== "boardroomOperationScheduled" && event.kind !== "controllerOperationScheduled") continue;
    latest.set(`${event.controller.toLowerCase()}:${event.operationId.toLowerCase()}`, event);
  }
  return [...latest.values()];
}

function toBoardroomEvent(log: RawEventLog): BoardroomVNextGovernanceEvent | undefined {
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

function toControllerEvent(
  log: RawEventLog,
  boardroom: Address,
  controller: Address,
): BoardroomVNextGovernanceEvent | undefined {
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
        facetSetHash: requireHexArg(args, "facetSetHash"),
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
        facetSetHash: requireHexArg(args, "facetSetHash"),
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
  input: BoardroomVNextGovernanceEventsQuery,
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

function requireBytes32(name: string, value: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte hex value.`);
  }
  return value;
}

function requireUint256(name: string, value: bigint): bigint {
  if (value < 0n || value > (1n << 256n) - 1n) {
    throw new Error(`${name} must be an unsigned 256-bit integer.`);
  }
  return value;
}

function isStrictHexBytes(value: unknown): value is Hex {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);
}

function uniqueAddresses(addresses: readonly Address[]): Address[] {
  const unique = new Map<string, Address>();
  for (const address of addresses) unique.set(address.toLowerCase(), address);
  return [...unique.values()];
}

function maybeEvent(event: BoardroomVNextGovernanceEvent | undefined): BoardroomVNextGovernanceEvent[] {
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
