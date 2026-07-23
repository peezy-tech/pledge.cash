import {
  boardroomAbi,
  boardroomControllerAbi,
  type PledgeCashLogClient
} from "@pledge.cash/sdk";
import { getAbiItem, type Address, type Hex } from "viem";

export type ControllerBinding = {
  readonly boardroom: Address;
  readonly controller: Address;
};

type GovernanceEventMeta = {
  readonly blockNumber: bigint;
  readonly boardroom: Address;
  readonly logIndex: number;
  readonly transactionHash: Hex;
};

export type GovernanceEvent =
  | (GovernanceEventMeta & {
      readonly kind: "launched";
      readonly controller: Address;
      readonly proposer: Address;
      readonly controllerGeneration: bigint;
      readonly configurationEpoch: bigint;
      readonly controllerDelay: bigint;
      readonly windDownDelay: bigint;
      readonly gracePeriod: bigint;
    })
  | (GovernanceEventMeta & {
      readonly kind: "controllerReplaced";
      readonly oldController: Address;
      readonly controller: Address;
      readonly proposer: Address;
      readonly controllerGeneration: bigint;
      readonly configurationEpoch: bigint;
      readonly controllerDelay: bigint;
      readonly gracePeriod: bigint;
    })
  | (GovernanceEventMeta & {
      readonly kind: "operationScheduled";
      readonly controller: Address;
      readonly operationId: Hex;
      readonly operationKind: "boardroom" | "controller";
      readonly proposer: Address;
      readonly eta: bigint;
      readonly expiresAt: bigint;
      readonly boardroomEpoch: bigint;
      readonly controllerGeneration: bigint;
      readonly configurationEpoch: bigint;
      readonly salt: Hex;
      readonly payloadHash: Hex;
    })
  | (GovernanceEventMeta & {
      readonly kind: "operationCancelled";
      readonly controller: Address;
      readonly operationId: Hex;
    })
  | (GovernanceEventMeta & {
      readonly kind: "operationExecuted";
      readonly controller: Address;
      readonly operationId: Hex;
      readonly executor: Address;
    })
  | (GovernanceEventMeta & {
      readonly kind: "configurationUpdated";
      readonly controller: Address;
      readonly oldProposer: Address;
      readonly proposer: Address;
      readonly oldDelay: bigint;
      readonly controllerDelay: bigint;
      readonly oldGracePeriod: bigint;
      readonly gracePeriod: bigint;
      readonly configurationEpoch: bigint;
    })
  | (GovernanceEventMeta & {
      readonly kind: "operationVetoed";
      readonly operationId: Hex;
      readonly staker: Address;
    })
  | (GovernanceEventMeta & {
      readonly kind: "governanceEpochAdvanced";
      readonly epoch: bigint;
    })
  | (GovernanceEventMeta & {
      readonly kind: "windDownStarted";
      readonly caller: Address;
      readonly epoch: bigint;
      readonly windDownDelay: bigint;
    })
  | (GovernanceEventMeta & { readonly kind: "snapshottingStarted" })
  | (GovernanceEventMeta & { readonly kind: "redemptionsOpened" })
  | (GovernanceEventMeta & {
      readonly kind: "callExecuted";
      readonly authority: Address;
      readonly policy: Address;
      readonly target: Address;
      readonly selector: Hex;
      readonly value: bigint;
      readonly dataHash: Hex;
    });

export type GovernanceEventsQuery = {
  readonly boardrooms: readonly Address[];
  readonly controllers: readonly ControllerBinding[];
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
};

type RawEventLog = {
  readonly address?: Address;
  readonly args?: Record<string, unknown>;
  readonly blockNumber?: bigint;
  readonly eventName?: string;
  readonly logIndex?: number;
  readonly transactionHash?: Hex;
};

const boardroomEventNames = [
  "BoardroomLaunched",
  "BoardroomControllerReplaced",
  "BoardroomOperationVetoed",
  "BoardroomCallExecuted",
  "GovernanceEpochAdvanced",
  "BoardroomWindDownStarted",
  "BoardroomSnapshottingStarted",
  "BoardroomRedemptionsOpened"
] as const;

const controllerEventNames = [
  "BoardroomOperationScheduled",
  "ControllerOperationScheduled",
  "OperationCancelled",
  "OperationExecuted",
  "ConfigurationUpdated"
] as const;

export async function queryExternalGovernanceEvents(
  client: PledgeCashLogClient,
  input: GovernanceEventsQuery
): Promise<GovernanceEvent[]> {
  const boardrooms = uniqueAddresses(input.boardrooms);
  if (boardrooms.length === 0) return [];

  const boardroomLogs = await queryNamedEvents(
    client,
    boardrooms,
    boardroomAbi,
    boardroomEventNames,
    input.fromBlock,
    input.toBlock
  );
  const boardroomEvents = boardroomLogs.map(toBoardroomEvent);
  const controllerToBoardroom = new Map<string, Address>();
  for (const binding of input.controllers) {
    controllerToBoardroom.set(binding.controller.toLowerCase(), binding.boardroom);
  }
  for (const event of boardroomEvents) {
    if (event.kind === "launched") {
      controllerToBoardroom.set(event.controller.toLowerCase(), event.boardroom);
    } else if (event.kind === "controllerReplaced") {
      controllerToBoardroom.set(event.oldController.toLowerCase(), event.boardroom);
      controllerToBoardroom.set(event.controller.toLowerCase(), event.boardroom);
    }
  }

  const controllers = uniqueAddresses(
    [...controllerToBoardroom.keys()].map((controller) => controller as Address)
  );
  const controllerLogs = await queryNamedEvents(
    client,
    controllers,
    boardroomControllerAbi,
    controllerEventNames,
    input.fromBlock,
    input.toBlock
  );
  const controllerEvents = controllerLogs.map((log) => {
    const controller = requireAddress(log.address, "controller log address");
    const boardroom = controllerToBoardroom.get(controller.toLowerCase());
    if (boardroom === undefined) {
      throw new Error(`Governance event came from an unbound controller ${controller}`);
    }
    return toControllerEvent(log, boardroom, controller);
  });

  return [...boardroomEvents, ...controllerEvents].sort(compareGovernanceEvents);
}

async function queryNamedEvents(
  client: PledgeCashLogClient,
  addresses: readonly Address[],
  abi: readonly unknown[],
  names: readonly string[],
  fromBlock: bigint,
  toBlock: bigint
): Promise<RawEventLog[]> {
  if (addresses.length === 0) return [];
  const logs = await Promise.all(
    names.map(async (name) =>
      (await client.getLogs({
        address: addresses,
        event: getAbiItem({ abi, name }),
        fromBlock,
        toBlock
      } as never)) as RawEventLog[]
    )
  );
  return logs.flat();
}

function toBoardroomEvent(log: RawEventLog): GovernanceEvent {
  const meta = eventMeta(log, requireAddress(log.address, "boardroom log address"));
  const args = log.args ?? {};
  switch (log.eventName) {
    case "BoardroomLaunched":
      return {
        ...meta,
        kind: "launched",
        controller: addressArg(args, "controller"),
        proposer: addressArg(args, "proposer"),
        controllerGeneration: bigintArg(args, "controllerGeneration"),
        configurationEpoch: 1n,
        controllerDelay: bigintArg(args, "controllerDelay"),
        windDownDelay: bigintArg(args, "windDownDelay"),
        gracePeriod: bigintArg(args, "gracePeriod")
      };
    case "BoardroomControllerReplaced":
      return {
        ...meta,
        kind: "controllerReplaced",
        oldController: addressArg(args, "oldController"),
        controller: addressArg(args, "newController"),
        proposer: addressArg(args, "proposer"),
        controllerGeneration: bigintArg(args, "generation"),
        configurationEpoch: 1n,
        controllerDelay: bigintArg(args, "controllerDelay"),
        gracePeriod: bigintArg(args, "gracePeriod")
      };
    case "BoardroomOperationVetoed":
      return {
        ...meta,
        kind: "operationVetoed",
        operationId: hexArg(args, "operationId"),
        staker: addressArg(args, "staker")
      };
    case "BoardroomCallExecuted":
      return {
        ...meta,
        kind: "callExecuted",
        authority: addressArg(args, "authority"),
        policy: addressArg(args, "policy"),
        target: addressArg(args, "target"),
        selector: hexArg(args, "selector"),
        value: bigintArg(args, "value"),
        dataHash: hexArg(args, "dataHash")
      };
    case "GovernanceEpochAdvanced":
      return { ...meta, kind: "governanceEpochAdvanced", epoch: bigintArg(args, "epoch") };
    case "BoardroomWindDownStarted":
      return {
        ...meta,
        kind: "windDownStarted",
        caller: addressArg(args, "caller"),
        epoch: bigintArg(args, "epoch"),
        windDownDelay: bigintArg(args, "windDownDelay")
      };
    case "BoardroomSnapshottingStarted":
      return { ...meta, kind: "snapshottingStarted" };
    case "BoardroomRedemptionsOpened":
      return { ...meta, kind: "redemptionsOpened" };
    default:
      throw new Error(`Unsupported Boardroom governance event ${String(log.eventName)}`);
  }
}

function toControllerEvent(log: RawEventLog, boardroom: Address, controller: Address): GovernanceEvent {
  const meta = eventMeta(log, boardroom);
  const args = log.args ?? {};
  switch (log.eventName) {
    case "BoardroomOperationScheduled":
      return {
        ...meta,
        kind: "operationScheduled",
        controller,
        operationId: hexArg(args, "operationId"),
        operationKind: "boardroom",
        proposer: addressArg(args, "proposer"),
        eta: bigintArg(args, "eta"),
        expiresAt: bigintArg(args, "expiresAt"),
        boardroomEpoch: bigintArg(args, "boardroomEpoch"),
        controllerGeneration: bigintArg(args, "controllerGeneration"),
        configurationEpoch: bigintArg(args, "configurationEpoch"),
        salt: hexArg(args, "salt"),
        payloadHash: hexArg(args, "callsHash")
      };
    case "ControllerOperationScheduled":
      return {
        ...meta,
        kind: "operationScheduled",
        controller,
        operationId: hexArg(args, "operationId"),
        operationKind: "controller",
        proposer: addressArg(args, "proposer"),
        eta: bigintArg(args, "eta"),
        expiresAt: bigintArg(args, "expiresAt"),
        boardroomEpoch: bigintArg(args, "boardroomEpoch"),
        controllerGeneration: bigintArg(args, "controllerGeneration"),
        configurationEpoch: bigintArg(args, "configurationEpoch"),
        salt: hexArg(args, "salt"),
        payloadHash: hexArg(args, "dataHash")
      };
    case "OperationCancelled":
      return {
        ...meta,
        kind: "operationCancelled",
        controller,
        operationId: hexArg(args, "operationId")
      };
    case "OperationExecuted":
      return {
        ...meta,
        kind: "operationExecuted",
        controller,
        operationId: hexArg(args, "operationId"),
        executor: addressArg(args, "executor")
      };
    case "ConfigurationUpdated":
      return {
        ...meta,
        kind: "configurationUpdated",
        controller,
        oldProposer: addressArg(args, "oldProposer"),
        proposer: addressArg(args, "newProposer"),
        oldDelay: bigintArg(args, "oldDelay"),
        controllerDelay: bigintArg(args, "newDelay"),
        oldGracePeriod: bigintArg(args, "oldGracePeriod"),
        gracePeriod: bigintArg(args, "newGracePeriod"),
        configurationEpoch: bigintArg(args, "configurationEpoch")
      };
    default:
      throw new Error(`Unsupported controller governance event ${String(log.eventName)}`);
  }
}

function eventMeta(log: RawEventLog, boardroom: Address): GovernanceEventMeta {
  if (log.blockNumber === undefined || log.logIndex === undefined || log.transactionHash === undefined) {
    throw new Error(`Malformed governance event ${String(log.eventName)}`);
  }
  return {
    blockNumber: log.blockNumber,
    boardroom,
    logIndex: log.logIndex,
    transactionHash: log.transactionHash
  };
}

function addressArg(args: Record<string, unknown>, name: string): Address {
  return requireAddress(args[name], name);
}

function requireAddress(value: unknown, name: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Malformed address ${name}`);
  }
  return value as Address;
}

function bigintArg(args: Record<string, unknown>, name: string): bigint {
  const value = args[name];
  if (typeof value !== "bigint") throw new Error(`Malformed bigint ${name}`);
  return value;
}

function hexArg(args: Record<string, unknown>, name: string): Hex {
  const value = args[name];
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`Malformed hex ${name}`);
  }
  return value as Hex;
}

function uniqueAddresses(addresses: readonly Address[]): Address[] {
  return [...new Map(addresses.map((address) => [address.toLowerCase(), address])).values()];
}

function compareGovernanceEvents(left: GovernanceEvent, right: GovernanceEvent): number {
  return Number(left.blockNumber - right.blockNumber) || left.logIndex - right.logIndex;
}
