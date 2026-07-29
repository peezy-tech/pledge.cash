import type { Address, Hex } from "viem";
import {
  boardroomDiamondAbi,
  boardroomVNextControllerAbi,
  boardroomVNextFactoryAbi,
  protocolFacetRegistryAbi,
} from "../generated";
import type {
  BoardroomCall,
  BoardroomLaunchConfig,
  PledgeCashBlockReadClient,
} from "./types";

export type ProtocolFacetRouteKind = 0 | 1 | 2;

export type ProtocolFacetInventoryEntry = {
  facetAddress: Address;
  functionSelectors: readonly Hex[];
};

export type ProtocolFacetReleaseRoute = {
  selector: Hex;
  facet: Address;
  codeHash: Hex;
  kind: ProtocolFacetRouteKind;
};

export type ProtocolFacetRelease = {
  registry: Address;
  blockNumber: bigint;
  facetSetHash: Hex;
  published: boolean;
  release: bigint;
  requiredStorageVersion: bigint;
  predecessorFacetSetHash: Hex;
  storageLayoutHash: Hex;
  manifestHash: Hex;
  migrationFacet: Address;
  migrationSelector: Hex;
  selectorCount: bigint;
  facets: readonly ProtocolFacetInventoryEntry[];
  routes: readonly ProtocolFacetReleaseRoute[];
};

export type ProtocolFacetRegistryState = {
  address: Address;
  blockNumber: bigint;
  activeFacetSetHash: Hex;
  activeRelease: bigint;
  requiredStorageVersion: bigint;
  requiredStorageLayoutHash: Hex;
  facets: readonly ProtocolFacetInventoryEntry[];
};

export type BoardroomVNextState = {
  address: Address;
  blockNumber: bigint;
  owner: Address;
  shareToken: Address;
  controller: Address;
  status: number;
  governanceEpoch: bigint;
  activeObligationCount: bigint;
  redeemableAssetCount: bigint;
  rewardPool: Address;
  liquidityLocker: Address;
  facetRegistry: Address;
  requiredFacetSetHash: Hex;
  activeRelease: bigint;
  appliedStorageVersion: bigint;
  appliedStorageLayoutHash: Hex;
  requiredStorageVersion: bigint;
  requiredStorageLayoutHash: Hex;
  migrationRequired: boolean;
};

export type BoardroomVNextControllerState = {
  address: Address;
  blockNumber: bigint;
  factory: Address;
  boardroom: Address;
  proposer: Address;
  delay: bigint;
  gracePeriod: bigint;
  generation: bigint;
  configurationEpoch: bigint;
  configurationHash: Hex;
};

export type BoardroomVNextMutationFunctionName = Extract<
  (typeof boardroomDiamondAbi)[number],
  { type: "function"; stateMutability: "nonpayable" | "payable" }
>["name"];

function requireFacetSetHash(value: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("expectedFacetSetHash must be a 32-byte hex value.");
  }
  return value;
}

const boardroomVNextMutationFunctionNames = new Set<string>(
  boardroomDiamondAbi
    .filter(
      (item) =>
        item.type === "function"
        && (item.stateMutability === "nonpayable" || item.stateMutability === "payable"),
    )
    .map((item) => item.name),
);

export function buildBoardroomVNextMutationTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  functionName: BoardroomVNextMutationFunctionName;
  args?: readonly unknown[];
  value?: bigint;
}) {
  if (!boardroomVNextMutationFunctionNames.has(input.functionName)) {
    throw new Error(`${input.functionName} is not a mutating Boardroom vNext route.`);
  }
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: input.functionName,
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      ...(input.args ?? []),
    ] as const,
    ...(input.value === undefined ? {} : { value: input.value }),
  } as const;
}

export function buildBoardroomVNextStartWindDownTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "startWindDown",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  } as const;
}

export function buildBoardroomVNextBeginSnapshotTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "beginSnapshot",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  } as const;
}

export function buildBoardroomVNextMintTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  to: Address;
  amount: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "mint",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.to,
      input.amount,
    ] as const,
  } as const;
}

export function buildBoardroomVNextLaunchTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  config: BoardroomLaunchConfig;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "launch",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.config,
    ] as const,
  } as const;
}

export function buildBoardroomVNextExecuteTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  call: BoardroomCall;
  value?: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "execute",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.call] as const,
    value: input.value ?? input.call.value,
  } as const;
}

export function buildBoardroomVNextExecuteBatchTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  calls: readonly BoardroomCall[];
  value?: bigint;
}) {
  if (input.calls.length === 0 || input.calls.length > 16) {
    throw new Error("Boardroom execution batches must contain between 1 and 16 calls.");
  }
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "executeBatch",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.calls] as const,
    value: input.value ?? input.calls.reduce((total, call) => total + call.value, 0n),
  } as const;
}

export function buildBoardroomVNextExecuteWindDownCallTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  call: BoardroomCall;
}) {
  if (input.call.value !== 0n) throw new Error("Wind-down calls cannot transfer native value.");
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "executeWindDownCall",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.call] as const,
  } as const;
}

export function buildBoardroomVNextPruneObligationsTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  obligations: readonly Address[];
}) {
  if (input.obligations.length === 0 || input.obligations.length > 32) {
    throw new Error("Obligation prune batches must contain between 1 and 32 addresses.");
  }
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "pruneObligations",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.obligations,
    ] as const,
  } as const;
}

export function buildBoardroomVNextPruneObligationTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  obligation: Address;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "pruneObligation",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.obligation,
    ] as const,
  } as const;
}

export function buildBoardroomVNextRegisterRedeemableAssetTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  asset: Address;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "registerRedeemableAsset",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.asset,
    ] as const,
  } as const;
}

export function buildBoardroomVNextVetoTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  operationId: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "veto",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      requireFacetSetHash(input.operationId),
    ] as const,
  } as const;
}

export function buildBoardroomVNextSnapshotAssetsTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  maximum: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "snapshotAssets",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.maximum] as const,
  } as const;
}

export function buildBoardroomVNextOpenRedemptionsTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "openRedemptions",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  } as const;
}

export function buildBoardroomVNextWrapNativeBalanceTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "wrapNativeBalance",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  } as const;
}

export function buildBoardroomVNextBurnTreasurySharesTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "burnTreasuryShares",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  } as const;
}

export function buildBoardroomVNextExitProtocolLiquidityTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  amountAMin: bigint;
  amountBMin: bigint;
  deadline: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "exitProtocolLiquidity",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.amountAMin,
      input.amountBMin,
      input.deadline,
    ] as const,
  } as const;
}

export function buildBoardroomVNextReturnProtocolLiquidityAsLpTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "returnProtocolLiquidityAsLp",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  } as const;
}

export function buildBoardroomVNextCloseProtocolLiquidityAfterWindDownTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "closeProtocolLiquidityAfterWindDown",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  } as const;
}

export function buildBoardroomVNextRedeemTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  shares: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "redeem",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.shares] as const,
  } as const;
}

export function buildBoardroomVNextClaimRedemptionAssetTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  asset: Address;
  recipient: Address;
  minAmountOut: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "claimRedemptionAsset",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.asset,
      input.recipient,
      input.minAmountOut,
    ] as const,
  } as const;
}

export function buildBoardroomVNextMigrateTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomDiamondAbi,
    functionName: "migrateBoardroom",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  } as const;
}

export function buildBoardroomVNextCreateTransaction(input: {
  factory: Address;
  expectedFacetSetHash: Hex;
  owner: Address;
  name: string;
  symbol: string;
  salt: Hex;
}) {
  return {
    address: input.factory,
    abi: boardroomVNextFactoryAbi,
    functionName: "createBoardroom",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.owner,
      input.name,
      input.symbol,
      requireFacetSetHash(input.salt),
    ] as const,
  } as const;
}

export function buildBoardroomVNextScheduleOperationTransaction(input: {
  controller: Address;
  expectedFacetSetHash: Hex;
  calls: readonly BoardroomCall[];
  salt: Hex;
  expectedBoardroomEpoch: bigint;
  expectedConfigurationEpoch: bigint;
}) {
  return {
    address: input.controller,
    abi: boardroomVNextControllerAbi,
    functionName: "scheduleBoardroomOperation",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.calls,
      requireFacetSetHash(input.salt),
      input.expectedBoardroomEpoch,
      input.expectedConfigurationEpoch,
    ] as const,
  } as const;
}

export function buildBoardroomVNextExecuteOperationTransaction(input: {
  controller: Address;
  expectedFacetSetHash: Hex;
  calls: readonly BoardroomCall[];
  salt: Hex;
  expectedBoardroomEpoch: bigint;
  expectedConfigurationEpoch: bigint;
  authority: Address;
}) {
  return {
    address: input.controller,
    abi: boardroomVNextControllerAbi,
    functionName: "executeBoardroomOperation",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.calls,
      requireFacetSetHash(input.salt),
      input.expectedBoardroomEpoch,
      input.expectedConfigurationEpoch,
      input.authority,
    ] as const,
  } as const;
}

export function buildBoardroomVNextScheduleControllerOperationTransaction(input: {
  controller: Address;
  expectedFacetSetHash: Hex;
  data: Hex;
  salt: Hex;
  expectedBoardroomEpoch: bigint;
  expectedConfigurationEpoch: bigint;
}) {
  return {
    address: input.controller,
    abi: boardroomVNextControllerAbi,
    functionName: "scheduleControllerOperation",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.data,
      requireFacetSetHash(input.salt),
      input.expectedBoardroomEpoch,
      input.expectedConfigurationEpoch,
    ] as const,
  } as const;
}

export function buildBoardroomVNextExecuteControllerOperationTransaction(input: {
  controller: Address;
  expectedFacetSetHash: Hex;
  data: Hex;
  salt: Hex;
  expectedBoardroomEpoch: bigint;
  expectedConfigurationEpoch: bigint;
  authority: Address;
}) {
  return {
    address: input.controller,
    abi: boardroomVNextControllerAbi,
    functionName: "executeControllerOperation",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.data,
      requireFacetSetHash(input.salt),
      input.expectedBoardroomEpoch,
      input.expectedConfigurationEpoch,
      input.authority,
    ] as const,
  } as const;
}

type FacetTuple = {
  facetAddress: Address;
  functionSelectors: readonly Hex[];
} | readonly [Address, readonly Hex[]];

function normalizeFacet(value: FacetTuple): ProtocolFacetInventoryEntry {
  if (Array.isArray(value)) {
    return {
      facetAddress: value[0] as Address,
      functionSelectors: value[1] as readonly Hex[],
    };
  }
  const facet = value as { facetAddress: Address; functionSelectors: readonly Hex[] };
  return {
    facetAddress: facet.facetAddress,
    functionSelectors: facet.functionSelectors,
  };
}

export async function readProtocolFacetRegistryState(
  client: PledgeCashBlockReadClient,
  registry: Address,
): Promise<ProtocolFacetRegistryState> {
  const blockNumber = await client.getBlockNumber();
  const [
    activeFacetSetHash,
    activeRelease,
    requiredStorageVersion,
    requiredStorageLayoutHash,
    facets,
  ] = await Promise.all([
    client.readContract({
      address: registry,
      abi: protocolFacetRegistryAbi,
      functionName: "activeFacetSetHash",
      blockNumber,
    }),
    client.readContract({
      address: registry,
      abi: protocolFacetRegistryAbi,
      functionName: "activeRelease",
      blockNumber,
    }),
    client.readContract({
      address: registry,
      abi: protocolFacetRegistryAbi,
      functionName: "activeStorageVersion",
      blockNumber,
    }),
    client.readContract({
      address: registry,
      abi: protocolFacetRegistryAbi,
      functionName: "activeStorageLayoutHash",
      blockNumber,
    }),
    client.readContract({
      address: registry,
      abi: protocolFacetRegistryAbi,
      functionName: "facets",
      blockNumber,
    }),
  ]);

  return {
    address: registry,
    blockNumber,
    activeFacetSetHash: activeFacetSetHash as Hex,
    activeRelease: activeRelease as bigint,
    requiredStorageVersion: requiredStorageVersion as bigint,
    requiredStorageLayoutHash: requiredStorageLayoutHash as Hex,
    facets: (facets as readonly FacetTuple[]).map(normalizeFacet),
  };
}

export async function readProtocolFacetRelease(
  client: PledgeCashBlockReadClient,
  registry: Address,
  facetSetHash?: Hex,
): Promise<ProtocolFacetRelease> {
  const blockNumber = await client.getBlockNumber();
  const resolvedFacetSetHash = facetSetHash
    ?? await client.readContract({
      address: registry,
      abi: protocolFacetRegistryAbi,
      functionName: "activeFacetSetHash",
      blockNumber,
    }) as Hex;
  const [metadata, selectors] = await Promise.all([
    client.readContract({
      address: registry,
      abi: protocolFacetRegistryAbi,
      functionName: "facetSetMetadata",
      args: [resolvedFacetSetHash],
      blockNumber,
    }),
    client.readContract({
      address: registry,
      abi: protocolFacetRegistryAbi,
      functionName: "facetSetSelectors",
      args: [resolvedFacetSetHash],
      blockNumber,
    }),
  ]);
  const [
    published,
    release,
    requiredStorageVersion,
    predecessorFacetSetHash,
    storageLayoutHash,
    manifestHash,
    migrationFacet,
    migrationSelector,
    selectorCount,
  ] = metadata as readonly [
    boolean,
    bigint,
    bigint,
    Hex,
    Hex,
    Hex,
    Address,
    Hex,
    bigint,
  ];
  const routes = await Promise.all(
    (selectors as readonly Hex[]).map(async (selector): Promise<ProtocolFacetReleaseRoute> => {
      const [facet, codeHash, kind] = await client.readContract({
        address: registry,
        abi: protocolFacetRegistryAbi,
        functionName: "facetSetRoute",
        args: [resolvedFacetSetHash, selector],
        blockNumber,
      }) as readonly [Address, Hex, number];
      return {
        selector,
        facet,
        codeHash,
        kind: kind as ProtocolFacetRouteKind,
      };
    }),
  );
  const selectorsByFacet = new Map<Address, Hex[]>();
  for (const route of routes) {
    const facetSelectors = selectorsByFacet.get(route.facet) ?? [];
    facetSelectors.push(route.selector);
    selectorsByFacet.set(route.facet, facetSelectors);
  }

  return {
    registry,
    blockNumber,
    facetSetHash: resolvedFacetSetHash,
    published,
    release,
    requiredStorageVersion,
    predecessorFacetSetHash,
    storageLayoutHash,
    manifestHash,
    migrationFacet,
    migrationSelector,
    selectorCount,
    facets: [...selectorsByFacet].map(([facetAddress, functionSelectors]) => ({
      facetAddress,
      functionSelectors,
    })),
    routes,
  };
}

export async function readBoardroomVNextState(
  client: PledgeCashBlockReadClient,
  boardroom: Address,
): Promise<BoardroomVNextState> {
  const blockNumber = await client.getBlockNumber();
  const [
    owner,
    shareToken,
    controller,
    status,
    governanceEpoch,
    activeObligationCount,
    redeemableAssetCount,
    rewardPool,
    liquidityLocker,
    facetRegistry,
    requiredFacetSetHash,
    appliedStorageVersion,
    appliedStorageLayoutHash,
    migrationRequired,
  ] = await Promise.all([
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "owner",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "shareToken",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "controller",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "status",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "governanceEpoch",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "activeObligationCount",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "redeemableAssetCount",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "rewardPool",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "liquidityLocker",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "facetRegistry",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "facetSetHash",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "appliedStorageVersion",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "appliedStorageLayoutHash",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "migrationRequired",
      blockNumber,
    }),
  ]);
  const [activeRelease, requiredStorageVersion, requiredStorageLayoutHash] = await Promise.all([
    client.readContract({
      address: facetRegistry as Address,
      abi: protocolFacetRegistryAbi,
      functionName: "activeRelease",
      blockNumber,
    }),
    client.readContract({
      address: facetRegistry as Address,
      abi: protocolFacetRegistryAbi,
      functionName: "activeStorageVersion",
      blockNumber,
    }),
    client.readContract({
      address: facetRegistry as Address,
      abi: protocolFacetRegistryAbi,
      functionName: "activeStorageLayoutHash",
      blockNumber,
    }),
  ]);

  return {
    address: boardroom,
    blockNumber,
    owner: owner as Address,
    shareToken: shareToken as Address,
    controller: controller as Address,
    status: Number(status),
    governanceEpoch: governanceEpoch as bigint,
    activeObligationCount: activeObligationCount as bigint,
    redeemableAssetCount: redeemableAssetCount as bigint,
    rewardPool: rewardPool as Address,
    liquidityLocker: liquidityLocker as Address,
    facetRegistry: facetRegistry as Address,
    requiredFacetSetHash: requiredFacetSetHash as Hex,
    activeRelease: activeRelease as bigint,
    appliedStorageVersion: appliedStorageVersion as bigint,
    appliedStorageLayoutHash: appliedStorageLayoutHash as Hex,
    requiredStorageVersion: requiredStorageVersion as bigint,
    requiredStorageLayoutHash: requiredStorageLayoutHash as Hex,
    migrationRequired: migrationRequired as boolean,
  };
}

export async function readBoardroomVNextControllerState(
  client: PledgeCashBlockReadClient,
  controller: Address,
): Promise<BoardroomVNextControllerState> {
  const blockNumber = await client.getBlockNumber();
  const [
    factory,
    boardroom,
    proposer,
    delay,
    gracePeriod,
    generation,
    configurationEpoch,
    configurationHash,
  ] = await Promise.all([
    client.readContract({
      address: controller,
      abi: boardroomVNextControllerAbi,
      functionName: "factory",
      blockNumber,
    }),
    client.readContract({
      address: controller,
      abi: boardroomVNextControllerAbi,
      functionName: "boardroom",
      blockNumber,
    }),
    client.readContract({
      address: controller,
      abi: boardroomVNextControllerAbi,
      functionName: "proposer",
      blockNumber,
    }),
    client.readContract({
      address: controller,
      abi: boardroomVNextControllerAbi,
      functionName: "delay",
      blockNumber,
    }),
    client.readContract({
      address: controller,
      abi: boardroomVNextControllerAbi,
      functionName: "gracePeriod",
      blockNumber,
    }),
    client.readContract({
      address: controller,
      abi: boardroomVNextControllerAbi,
      functionName: "generation",
      blockNumber,
    }),
    client.readContract({
      address: controller,
      abi: boardroomVNextControllerAbi,
      functionName: "configurationEpoch",
      blockNumber,
    }),
    client.readContract({
      address: controller,
      abi: boardroomVNextControllerAbi,
      functionName: "configurationHash",
      blockNumber,
    }),
  ]);

  return {
    address: controller,
    blockNumber,
    factory: factory as Address,
    boardroom: boardroom as Address,
    proposer: proposer as Address,
    delay: delay as bigint,
    gracePeriod: gracePeriod as bigint,
    generation: generation as bigint,
    configurationEpoch: configurationEpoch as bigint,
    configurationHash: configurationHash as Hex,
  };
}
