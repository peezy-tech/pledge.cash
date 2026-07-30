import type { Address, Hex } from "viem";
import {
  boardroomAbi,
  boardroomControllerAbi,
  protocolFacetRegistryAbi,
} from "../generated";
import type { PledgeCashBlockReadClient } from "./types";

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

export type BoardroomProtocolState = {
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

export type BoardroomProtocolControllerState = {
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
  const [activeFacetSetHash, activeRelease, requiredStorageVersion, requiredStorageLayoutHash, facets] =
    await Promise.all([
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
  ] = metadata as readonly [boolean, bigint, bigint, Hex, Hex, Hex, Address, Hex, bigint];
  const routes = await Promise.all(
    (selectors as readonly Hex[]).map(async (selector): Promise<ProtocolFacetReleaseRoute> => {
      const [facet, codeHash, kind] = await client.readContract({
        address: registry,
        abi: protocolFacetRegistryAbi,
        functionName: "facetSetRoute",
        args: [resolvedFacetSetHash, selector],
        blockNumber,
      }) as readonly [Address, Hex, number];
      return { selector, facet, codeHash, kind: kind as ProtocolFacetRouteKind };
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

export async function readBoardroomProtocolState(
  client: PledgeCashBlockReadClient,
  boardroom: Address,
): Promise<BoardroomProtocolState> {
  const blockNumber = await client.getBlockNumber();
  const read = (functionName: string) => client.readContract({
    address: boardroom,
    abi: boardroomAbi,
    functionName,
    blockNumber,
  } as never);
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
    read("owner"),
    read("shareToken"),
    read("controller"),
    read("status"),
    read("governanceEpoch"),
    read("activeObligationCount"),
    read("redeemableAssetCount"),
    read("rewardPool"),
    read("liquidityLocker"),
    read("facetRegistry"),
    read("facetSetHash"),
    read("appliedStorageVersion"),
    read("appliedStorageLayoutHash"),
    read("migrationRequired"),
  ]);
  const readRegistry = (functionName: string) => client.readContract({
    address: facetRegistry as Address,
    abi: protocolFacetRegistryAbi,
    functionName,
    blockNumber,
  } as never);
  const [activeRelease, requiredStorageVersion, requiredStorageLayoutHash] = await Promise.all([
    readRegistry("activeRelease"),
    readRegistry("activeStorageVersion"),
    readRegistry("activeStorageLayoutHash"),
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

export async function readBoardroomProtocolControllerState(
  client: PledgeCashBlockReadClient,
  controller: Address,
): Promise<BoardroomProtocolControllerState> {
  const blockNumber = await client.getBlockNumber();
  const read = (functionName: string) => client.readContract({
    address: controller,
    abi: boardroomControllerAbi,
    functionName,
    blockNumber,
  } as never);
  const [factory, boardroom, proposer, delay, gracePeriod, generation, configurationEpoch, configurationHash] =
    await Promise.all([
      read("factory"),
      read("boardroom"),
      read("proposer"),
      read("delay"),
      read("gracePeriod"),
      read("generation"),
      read("configurationEpoch"),
      read("configurationHash"),
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
