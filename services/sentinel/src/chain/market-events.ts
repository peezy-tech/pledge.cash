import {
  boardroomAbi,
  migratingBondingCurveAbi,
  pledgeV4LiquidityFactoryAbi,
  pledgeV4LiquidityVaultAbi,
  type PledgeCashLogClient
} from "@pledge.cash/sdk";
import { getAbiItem, type Abi, type AbiEvent, type Address, type Hex } from "viem";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const QUERY_CHUNK_SIZE = 500;

export type MarketLifecycleSource =
  | "boardroom"
  | "bonding-curve"
  | "liquidity-factory"
  | "liquidity-locker";

export type MarketLifecycleValue = string | number | boolean | null;

export type MarketLifecycleEvent = {
  readonly actor?: Lowercase<Address>;
  readonly blockNumber: bigint;
  readonly boardroom: Lowercase<Address>;
  readonly contractAddress: Lowercase<Address>;
  readonly data: Readonly<Record<string, MarketLifecycleValue>>;
  readonly kind: MarketLifecycleEventKind;
  readonly logIndex: number;
  readonly source: MarketLifecycleSource;
  readonly transactionHash: Lowercase<Hex>;
};

export type MarketLifecycleEventKind =
  | keyof typeof BOARDROOM_EVENT_FIELDS
  | keyof typeof CURVE_EVENT_FIELDS
  | keyof typeof LIQUIDITY_FACTORY_EVENT_FIELDS
  | keyof typeof LIQUIDITY_VAULT_EVENT_FIELDS;

export type MarketBoardroomBinding = {
  readonly boardroom: Address;
  readonly bondingCurve?: Address | null;
  readonly liquidityVault?: Address | null;
  readonly liquidityReservationExpectedVault?: Address | null;
};

export type BoardroomMarketStateUpdate = {
  readonly boardroom: Lowercase<Address>;
  readonly bondingCurve?: Lowercase<Address>;
  readonly bondingCurvePhase?: number;
  readonly bondingCurvePhaseEndsAt?: bigint;
  readonly bondingCurveSettlementReason?: number;
  readonly clearLiquidityReservation?: boolean;
  readonly liquidityVault?: Lowercase<Address>;
  readonly liquidityPoolId?: Lowercase<Hex>;
  readonly liquidityQuoteAsset?: Lowercase<Address>;
  readonly liquidityReservationCurve?: Lowercase<Address>;
  readonly liquidityReservationExpectedVault?: Lowercase<Address>;
  readonly liquidityReservationExpectedPoolId?: Lowercase<Hex>;
  readonly liquidityReservationExpiresAt?: bigint;
  readonly liquidityReservationPairKey?: Lowercase<Hex>;
  readonly liquidityReservationSalt?: Lowercase<Hex>;
  readonly liquidityStatus?: number;
  readonly primaryMarketMode?: number;
  readonly primaryMarketQuoteAsset?: Lowercase<Address>;
};

type FieldKind = "address" | "bool" | "hex" | "uint";
type EventFields = Readonly<Record<string, FieldKind>>;

const BOARDROOM_EVENT_FIELDS = {
  BondingCurvePrecommitted: { curve: "address", quoteAsset: "address", fundingAmount: "uint" },
  PrimaryMarketModeChanged: { mode: "uint" },
  ProtocolLiquidityActivated: {
    vault: "address",
    poolId: "hex",
    quoteAsset: "address",
    curve: "address"
  },
  ProtocolLiquidityClosed: { vault: "address", poolId: "hex", quoteAsset: "address" },
  ProtocolLiquidityReservationReleased: {
    curve: "address",
    expectedVault: "address",
    salt: "hex"
  },
  ProtocolLiquidityReserved: {
    expectedVault: "address",
    expectedPoolId: "hex",
    quoteAsset: "address",
    curve: "address",
    salt: "hex",
    expiresAt: "uint"
  }
} as const satisfies Readonly<Record<string, EventFields>>;

const CURVE_EVENT_FIELDS = {
  CurveGraduationLatched: { quoteReserve: "uint", remainingShares: "uint", migrationEndsAt: "uint" },
  CurveMigrated: {
    vault: "address",
    poolId: "hex",
    sharesToLiquidity: "uint",
    quoteToLiquidity: "uint",
    liquidity: "uint",
    quoteToBoardroom: "uint",
    terminalPrice: "uint"
  },
  CurvePhaseChanged: { phase: "uint", reason: "uint", phaseEndsAt: "uint" },
  CurveQuoteQuarantined: {
    expectedQuote: "uint",
    observedQuote: "uint",
    returnedQuote: "uint",
    unrecoveredQuote: "uint",
    balanceReadable: "bool"
  },
  CurveQuoteRecovered: {
    recipient: "address",
    returnedQuote: "uint",
    unrecoveredQuote: "uint",
    readable: "bool"
  },
  CurveUnwindFinalized: { returnedShares: "uint", returnedQuote: "uint", retainedHolderShares: "uint" },
  ForfeitedQuoteRecovered: { recipient: "address", returnedQuote: "uint", readable: "bool" },
  QuoteForfeitureFinalized: { forfeitedQuote: "uint", terminalPhase: "uint" },
  QuoteForfeitureOpened: { windowEndsAt: "uint" },
  QuoteForfeitureVetoed: { staker: "address", nextEligibleAt: "uint" }
} as const satisfies Readonly<Record<string, EventFields>>;

const LIQUIDITY_FACTORY_EVENT_FIELDS = {
  MigrationReservationReleased: { boardroom: "address", curve: "address", expectedPoolId: "hex", salt: "hex" },
  MigrationReserved: {
    boardroom: "address",
    curve: "address",
    expectedVault: "address",
    expectedPoolId: "hex",
    salt: "hex"
  },
  ProtocolLiquidityAdded: {
    boardroom: "address",
    vault: "address",
    poolId: "hex",
    amountA: "uint",
    amountB: "uint",
    liquidity: "uint"
  },
  ProtocolLiquidityCreated: {
    vault: "address",
    boardroom: "address",
    poolId: "hex",
    quoteAsset: "address",
    amountA: "uint",
    amountB: "uint",
    liquidity: "uint",
    sqrtPriceX96: "uint",
    salt: "hex",
    curve: "address"
  },
  ProtocolLiquidityPositionClosed: { boardroom: "address", vault: "address", poolId: "hex" },
  ProtocolLiquidityRemoved: {
    boardroom: "address",
    vault: "address",
    poolId: "hex",
    liquidity: "uint",
    amountA: "uint",
    amountB: "uint"
  }
} as const satisfies Readonly<Record<string, EventFields>>;

const LIQUIDITY_VAULT_EVENT_FIELDS = {
  FeesForwarded: {
    boardroom: "address",
    protocolFeeRecipient: "address",
    boardroomAmount0: "uint",
    boardroomAmount1: "uint",
    protocolAmount0: "uint",
    protocolAmount1: "uint"
  },
  LiquidityAdded: { poolId: "hex", amountA: "uint", amountB: "uint", liquidity: "uint" },
  LiquidityClaimsMinted: { depositor: "address", recipient: "address", claims: "uint" },
  LiquidityClosed: { poolId: "hex" },
  LiquidityRemoved: { poolId: "hex", liquidity: "uint", amountA: "uint", amountB: "uint" },
  PledgeV4LiquidityVaultInitialized: {
    boardroom: "address",
    poolId: "hex",
    poolManager: "address",
    tokenA: "address",
    tokenB: "address",
    positionSalt: "hex"
  },
  PositionClaimsRedeemed: {
    holder: "address",
    recipient: "address",
    claims: "uint",
    liquidity: "uint",
    amountA: "uint",
    amountB: "uint"
  },
  PositionClaimsReleased: { poolId: "hex", boardroom: "address", claims: "uint" }
} as const satisfies Readonly<Record<string, EventFields>>;

type RawEventLog = {
  readonly address?: Address;
  readonly args?: Record<string, unknown>;
  readonly blockNumber?: bigint;
  readonly eventName?: string;
  readonly logIndex?: number;
  readonly transactionHash?: Hex;
};

export async function queryMarketLifecycleEvents(
  client: PledgeCashLogClient,
  input: {
    readonly boardrooms: readonly MarketBoardroomBinding[];
    readonly fromBlock: bigint;
    readonly pledgeV4LiquidityFactory?: Address;
    readonly toBlock: bigint;
  }
): Promise<MarketLifecycleEvent[]> {
  const boardroomMap = new Map<string, Lowercase<Address>>();
  for (const binding of input.boardrooms) {
    boardroomMap.set(binding.boardroom.toLowerCase(), lowerAddress(binding.boardroom));
  }
  if (boardroomMap.size === 0) return [];

  const boardroomLogs = await queryNamedEvents(
    client,
    [...boardroomMap.values()],
    boardroomAbi,
    BOARDROOM_EVENT_FIELDS,
    input.fromBlock,
    input.toBlock
  );
  const boardroomEvents = boardroomLogs.map((log) =>
    parseEvent(log, "boardroom", requireKnownAddress(log.address, boardroomMap, "Boardroom"), BOARDROOM_EVENT_FIELDS)
  );

  const curveToBoardroom = new Map<string, Lowercase<Address>>();
  const vaultToBoardroom = new Map<string, Lowercase<Address>>();
  for (const binding of input.boardrooms) {
    addBinding(curveToBoardroom, binding.bondingCurve, binding.boardroom);
    addBinding(vaultToBoardroom, binding.liquidityVault, binding.boardroom);
    addBinding(vaultToBoardroom, binding.liquidityReservationExpectedVault, binding.boardroom);
  }
  for (const event of boardroomEvents) {
    if (event.kind === "BondingCurvePrecommitted") addBinding(curveToBoardroom, dataAddress(event, "curve"), event.boardroom);
    if (event.kind === "ProtocolLiquidityActivated") addBinding(vaultToBoardroom, dataAddress(event, "vault"), event.boardroom);
    if (event.kind === "ProtocolLiquidityReserved") {
      addBinding(vaultToBoardroom, dataAddress(event, "expectedVault"), event.boardroom);
    }
  }

  const factoryEvents: MarketLifecycleEvent[] = [];
  if (input.pledgeV4LiquidityFactory) {
    const factoryLogs = await queryNamedEvents(
      client,
      [input.pledgeV4LiquidityFactory],
      pledgeV4LiquidityFactoryAbi,
      LIQUIDITY_FACTORY_EVENT_FIELDS,
      input.fromBlock,
      input.toBlock
    );
    for (const log of factoryLogs) {
      const parsed = parseEvent(
        log,
        "liquidity-factory",
        lowerAddress(dataAddressFromLog(log, "boardroom")),
        LIQUIDITY_FACTORY_EVENT_FIELDS
      );
      if (!boardroomMap.has(parsed.boardroom)) continue;
      factoryEvents.push(parsed);
      if (parsed.kind === "MigrationReserved") {
        addBinding(curveToBoardroom, dataAddress(parsed, "curve"), parsed.boardroom);
        addBinding(vaultToBoardroom, dataAddress(parsed, "expectedVault"), parsed.boardroom);
      } else if (parsed.kind === "ProtocolLiquidityCreated") {
        addBinding(vaultToBoardroom, dataAddress(parsed, "vault"), parsed.boardroom);
      }
    }
  }

  const curveEvents = await queryBoundEvents(
    client,
    curveToBoardroom,
    migratingBondingCurveAbi,
    CURVE_EVENT_FIELDS,
    "bonding-curve",
    input.fromBlock,
    input.toBlock
  );
  const vaultEvents = await queryBoundEvents(
    client,
    vaultToBoardroom,
    pledgeV4LiquidityVaultAbi,
    LIQUIDITY_VAULT_EVENT_FIELDS,
    "liquidity-locker",
    input.fromBlock,
    input.toBlock
  );

  return [...boardroomEvents, ...factoryEvents, ...curveEvents, ...vaultEvents].sort(compareMarketEvents);
}

export function marketStateUpdateForEvent(event: MarketLifecycleEvent): BoardroomMarketStateUpdate | undefined {
  const update = { boardroom: event.boardroom } satisfies BoardroomMarketStateUpdate;
  switch (event.kind) {
    case "BondingCurvePrecommitted":
      return {
        ...update,
        bondingCurve: dataAddress(event, "curve"),
        primaryMarketMode: 1,
        primaryMarketQuoteAsset: dataAddress(event, "quoteAsset")
      };
    case "PrimaryMarketModeChanged":
      return { ...update, primaryMarketMode: dataNumber(event, "mode") };
    case "ProtocolLiquidityReserved":
      return {
        ...update,
        liquidityQuoteAsset: dataAddress(event, "quoteAsset"),
        liquidityReservationCurve: dataAddress(event, "curve"),
        liquidityReservationExpectedVault: dataAddress(event, "expectedVault"),
        liquidityReservationExpectedPoolId: dataHex(event, "expectedPoolId"),
        liquidityReservationExpiresAt: dataBigInt(event, "expiresAt"),
        liquidityReservationPairKey: dataHex(event, "expectedPoolId"),
        liquidityReservationSalt: dataHex(event, "salt"),
        primaryMarketQuoteAsset: dataAddress(event, "quoteAsset")
      };
    case "MigrationReserved":
      return {
        ...update,
        liquidityReservationCurve: dataAddress(event, "curve"),
        liquidityReservationExpectedVault: dataAddress(event, "expectedVault"),
        liquidityReservationExpectedPoolId: dataHex(event, "expectedPoolId"),
        liquidityReservationSalt: dataHex(event, "salt")
      };
    case "ProtocolLiquidityActivated":
    case "ProtocolLiquidityCreated":
      return {
        ...update,
        clearLiquidityReservation: true,
        liquidityVault: dataAddress(event, "vault"),
        liquidityPoolId: dataHex(event, "poolId"),
        liquidityQuoteAsset: dataAddress(event, "quoteAsset"),
        primaryMarketQuoteAsset: dataAddress(event, "quoteAsset"),
        liquidityStatus: 1
      };
    case "CurveMigrated":
      return {
        ...update,
        clearLiquidityReservation: true,
        liquidityVault: dataAddress(event, "vault"),
        liquidityPoolId: dataHex(event, "poolId"),
        liquidityStatus: 1
      };
    case "ProtocolLiquidityClosed":
    case "ProtocolLiquidityPositionClosed":
    case "LiquidityClosed":
      return { ...update, liquidityStatus: 2 };
    case "ProtocolLiquidityReservationReleased":
    case "MigrationReservationReleased":
      return { ...update, clearLiquidityReservation: true };
    case "CurvePhaseChanged":
      return {
        ...update,
        bondingCurvePhase: dataNumber(event, "phase"),
        bondingCurvePhaseEndsAt: dataBigInt(event, "phaseEndsAt"),
        bondingCurveSettlementReason: dataNumber(event, "reason")
      };
    default:
      return undefined;
  }
}

async function queryBoundEvents(
  client: PledgeCashLogClient,
  bindings: ReadonlyMap<string, Lowercase<Address>>,
  abi: Abi,
  definitions: Readonly<Record<string, EventFields>>,
  source: MarketLifecycleSource,
  fromBlock: bigint,
  toBlock: bigint
): Promise<MarketLifecycleEvent[]> {
  const events: MarketLifecycleEvent[] = [];
  const addresses = [...bindings.keys()].filter((address) => address !== ZERO_ADDRESS) as Address[];
  for (const addressChunk of chunks(addresses, QUERY_CHUNK_SIZE)) {
    const logs = await queryNamedEvents(client, addressChunk, abi, definitions, fromBlock, toBlock);
    for (const log of logs) {
      const contractAddress = requireAddress(log.address, "market event contract");
      const boardroom = bindings.get(contractAddress.toLowerCase());
      if (!boardroom) throw new Error(`Unbound canonical market event source ${contractAddress}`);
      events.push(parseEvent(log, source, boardroom, definitions));
    }
  }
  return events;
}

async function queryNamedEvents(
  client: PledgeCashLogClient,
  addresses: readonly Address[],
  abi: Abi,
  definitions: Readonly<Record<string, EventFields>>,
  fromBlock: bigint,
  toBlock: bigint
): Promise<RawEventLog[]> {
  if (addresses.length === 0) return [];
  const logs: RawEventLog[] = [];
  for (const eventName of Object.keys(definitions)) {
    const event = getAbiItem({ abi, name: eventName }) as AbiEvent;
    const result = await client.getLogs({ address: [...addresses], event, fromBlock, toBlock });
    logs.push(...(result as RawEventLog[]));
  }
  return logs;
}

function parseEvent(
  log: RawEventLog,
  source: MarketLifecycleSource,
  boardroom: Address,
  definitions: Readonly<Record<string, EventFields>>
): MarketLifecycleEvent {
  const kind = log.eventName;
  const fields = kind ? definitions[kind] : undefined;
  if (!kind || !fields) throw new Error(`Unsupported ${source} lifecycle event ${String(kind)}`);
  if (log.blockNumber === undefined || log.logIndex === undefined || log.transactionHash === undefined) {
    throw new Error(`Malformed ${source} lifecycle event ${kind}`);
  }
  const args = log.args;
  if (!args || typeof args !== "object") throw new Error(`Malformed ${source} lifecycle event arguments ${kind}`);
  const data: Record<string, MarketLifecycleValue> = {};
  for (const [name, fieldKind] of Object.entries(fields)) data[name] = normalizeField(args[name], fieldKind, name);
  return {
    blockNumber: log.blockNumber,
    boardroom: lowerAddress(boardroom),
    contractAddress: lowerAddress(requireAddress(log.address, "market event contract")),
    data,
    kind: kind as MarketLifecycleEventKind,
    logIndex: log.logIndex,
    source,
    transactionHash: lowerHex(log.transactionHash)
  };
}

function normalizeField(value: unknown, kind: FieldKind, name: string): MarketLifecycleValue {
  if (kind === "address") return lowerAddress(requireAddress(value, name));
  if (kind === "hex") return lowerHex(requireHex(value, name));
  if (kind === "bool") {
    if (typeof value !== "boolean") throw new Error(`Malformed boolean ${name}`);
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value.toString();
  throw new Error(`Malformed uint ${name}`);
}

function dataAddressFromLog(log: RawEventLog, name: string): Address {
  return requireAddress(log.args?.[name], name);
}

function dataAddress(event: MarketLifecycleEvent, name: string): Lowercase<Address> {
  return lowerAddress(requireAddress(event.data[name], name));
}

function dataHex(event: MarketLifecycleEvent, name: string): Lowercase<Hex> {
  return lowerHex(requireHex(event.data[name], name));
}

function dataBigInt(event: MarketLifecycleEvent, name: string): bigint {
  const value = event.data[name];
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`Malformed projected uint ${name}`);
  return BigInt(value);
}

function dataNumber(event: MarketLifecycleEvent, name: string): number {
  const value = dataBigInt(event, name);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Projected uint exceeds safe integer ${name}`);
  return Number(value);
}

function addBinding(
  bindings: Map<string, Lowercase<Address>>,
  contract: Address | null | undefined,
  boardroom: Address
): void {
  if (!contract || contract.toLowerCase() === ZERO_ADDRESS) return;
  const key = contract.toLowerCase();
  const canonicalBoardroom = lowerAddress(boardroom);
  const existing = bindings.get(key);
  if (existing && existing !== canonicalBoardroom) throw new Error(`Conflicting market topology for ${contract}`);
  bindings.set(key, canonicalBoardroom);
}

function requireKnownAddress(
  value: unknown,
  known: ReadonlyMap<string, Lowercase<Address>>,
  label: string
): Lowercase<Address> {
  const address = lowerAddress(requireAddress(value, label));
  if (!known.has(address)) throw new Error(`Unknown canonical ${label} ${address}`);
  return address;
}

function requireAddress(value: unknown, name: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Malformed address ${name}`);
  }
  return value as Address;
}

function requireHex(value: unknown, name: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`Malformed hex ${name}`);
  }
  return value as Hex;
}

function lowerAddress(value: Address): Lowercase<Address> {
  return value.toLowerCase() as Lowercase<Address>;
}

function lowerHex(value: Hex): Lowercase<Hex> {
  return value.toLowerCase() as Lowercase<Hex>;
}

function compareMarketEvents(left: MarketLifecycleEvent, right: MarketLifecycleEvent): number {
  return Number(left.blockNumber - right.blockNumber) || left.logIndex - right.logIndex
    || left.contractAddress.localeCompare(right.contractAddress);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}
