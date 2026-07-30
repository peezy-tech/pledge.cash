import {
  ammFactoryAbi,
  boardroomControllerFactoryAbi,
  boardroomFactoryAbi,
  boardroomKernelAbi,
  protocolFacetRegistryAbi,
} from "@pledge.cash/sdk";
import {
  getAddress,
  isAddress,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

export const MAX_ACTIVE_RELEASE_SELECTORS = 256;

export type CanonicalProtocolRoots = {
  chainId: 998;
  ammFactory: Address;
  ammFactoryCodeHash: Hex;
  ammFactoryOwner: Address;
  ammRouter: Address;
  ammRouterCodeHash: Hex;
  distributionFactory: Address;
  distributionFactoryCodeHash: Hex;
  boardroomFactory: Address;
  boardroomFactoryCodeHash: Hex;
  boardroomControllerFactory: Address;
  boardroomControllerFactoryCodeHash: Hex;
  boardroomControllerLogic: Address;
  boardroomControllerLogicCodeHash: Hex;
  boardroomGovernanceLogic: Address;
  boardroomGovernanceLogicCodeHash: Hex;
  boardroomMarketLogic: Address;
  boardroomMarketLogicCodeHash: Hex;
  boardroomRedemptionPayout: Address;
  boardroomRedemptionPayoutCodeHash: Hex;
  boardroomKernel: Address;
  boardroomKernelCodeHash: Hex;
  protocolFacetRegistry: Address;
  protocolFacetRegistryCodeHash: Hex;
  protocolFacetRegistryOwner: Address;
  protocolGovernance: Address;
  kernelSelectorSetHash: Hex;
};

export type PinnedFacetRelease = {
  blockHash: Hex;
  blockNumber: bigint;
  facetSetHash: Hex;
  release: bigint;
  requiredStorageLayoutHash: Hex;
  requiredStorageVersion: bigint;
};

type FacetRoute = {
  codeHash: Hex;
  facet: Address;
  kind: number;
};

/**
 * Authenticates the current governance-selected release without pinning its
 * release number, hash, manifest, selectors, or facet addresses to genesis.
 * Permanent protocol roots remain deployment-attested.
 */
export async function proveLiveFacetRelease(
  client: PublicClient,
  deployment: CanonicalProtocolRoots,
  pinned?: { blockHash: Hex; blockNumber: bigint },
): Promise<PinnedFacetRelease> {
  const block = pinned ?? await pinLatestBlock(client);
  const at = block.blockNumber;
  const actualChainId = await client.getChainId();
  if (actualChainId !== deployment.chainId) {
    throw new FacetReleaseProofError("wrong_destination_chain");
  }

  const roots = [
    [deployment.ammFactory, deployment.ammFactoryCodeHash],
    [deployment.ammRouter, deployment.ammRouterCodeHash],
    [deployment.distributionFactory, deployment.distributionFactoryCodeHash],
    [deployment.protocolFacetRegistry, deployment.protocolFacetRegistryCodeHash],
    [deployment.boardroomKernel, deployment.boardroomKernelCodeHash],
    [deployment.boardroomFactory, deployment.boardroomFactoryCodeHash],
    [deployment.boardroomControllerFactory, deployment.boardroomControllerFactoryCodeHash],
    [deployment.boardroomControllerLogic, deployment.boardroomControllerLogicCodeHash],
    [deployment.boardroomGovernanceLogic, deployment.boardroomGovernanceLogicCodeHash],
    [deployment.boardroomMarketLogic, deployment.boardroomMarketLogicCodeHash],
    [deployment.boardroomRedemptionPayout, deployment.boardroomRedemptionPayoutCodeHash],
  ] as const;
  await Promise.all(
    roots.map(async ([address, expected]) => {
      const code = await client.getCode({ address, blockNumber: at });
      requireCodeHash(code, expected);
    }),
  );

  const registry = deployment.protocolFacetRegistry;
  const [
    registryOwner,
    activeFacetSetHashRaw,
    activeReleaseRaw,
    activeStorageVersionRaw,
    activeStorageLayoutHashRaw,
    registryKernelSelectorSetHash,
    factoryRegistry,
    factoryKernel,
    factoryControllerFactory,
    factoryGovernanceLogic,
    factoryMarketLogic,
    factoryRedemptionPayout,
    kernelRegistry,
    kernelSelectorSetHash,
    controllerFactoryBoardroomFactory,
    controllerImplementation,
    ammOwner,
    configuredRouter,
  ] = await Promise.all([
    read(client, at, registry, protocolFacetRegistryAbi, "owner"),
    read(client, at, registry, protocolFacetRegistryAbi, "activeFacetSetHash"),
    read(client, at, registry, protocolFacetRegistryAbi, "activeRelease"),
    read(client, at, registry, protocolFacetRegistryAbi, "activeStorageVersion"),
    read(client, at, registry, protocolFacetRegistryAbi, "activeStorageLayoutHash"),
    read(client, at, registry, protocolFacetRegistryAbi, "kernelSelectorSetHash"),
    read(client, at, deployment.boardroomFactory, boardroomFactoryAbi, "facetRegistry"),
    read(client, at, deployment.boardroomFactory, boardroomFactoryAbi, "boardroomKernelLogic"),
    read(client, at, deployment.boardroomFactory, boardroomFactoryAbi, "controllerFactory"),
    read(client, at, deployment.boardroomFactory, boardroomFactoryAbi, "governanceLogic"),
    read(client, at, deployment.boardroomFactory, boardroomFactoryAbi, "marketLogic"),
    read(client, at, deployment.boardroomFactory, boardroomFactoryAbi, "redemptionPayoutLogic"),
    read(client, at, deployment.boardroomKernel, boardroomKernelAbi, "facetRegistry"),
    read(client, at, deployment.boardroomKernel, boardroomKernelAbi, "kernelSelectorSetHash"),
    read(
      client,
      at,
      deployment.boardroomControllerFactory,
      boardroomControllerFactoryAbi,
      "boardroomFactory",
    ),
    read(
      client,
      at,
      deployment.boardroomControllerFactory,
      boardroomControllerFactoryAbi,
      "controllerImplementation",
    ),
    read(client, at, deployment.ammFactory, ammFactoryAbi, "owner"),
    read(client, at, deployment.ammFactory, ammFactoryAbi, "liquidityRouter"),
  ]);
  checkedAddress(registryOwner);
  assertAddress(ammOwner, deployment.ammFactoryOwner);
  assertAddress(configuredRouter, deployment.ammRouter);
  assertHash(registryKernelSelectorSetHash, deployment.kernelSelectorSetHash);
  assertHash(kernelSelectorSetHash, deployment.kernelSelectorSetHash);
  assertAddress(factoryRegistry, registry);
  assertAddress(factoryKernel, deployment.boardroomKernel);
  assertAddress(factoryControllerFactory, deployment.boardroomControllerFactory);
  assertAddress(factoryGovernanceLogic, deployment.boardroomGovernanceLogic);
  assertAddress(factoryMarketLogic, deployment.boardroomMarketLogic);
  assertAddress(factoryRedemptionPayout, deployment.boardroomRedemptionPayout);
  assertAddress(kernelRegistry, registry);
  assertAddress(controllerFactoryBoardroomFactory, deployment.boardroomFactory);
  assertAddress(controllerImplementation, deployment.boardroomControllerLogic);

  const facetSetHash = checkedHash(activeFacetSetHashRaw);
  const activeRelease = checkedPositiveBigInt(activeReleaseRaw);
  const requiredStorageVersion = checkedPositiveBigInt(activeStorageVersionRaw);
  const requiredStorageLayoutHash = checkedHash(activeStorageLayoutHashRaw);
  const [metadataRaw, selectorsRaw, loupeRaw] = await Promise.all([
    read(client, at, registry, protocolFacetRegistryAbi, "facetSetMetadata", [facetSetHash]),
    read(client, at, registry, protocolFacetRegistryAbi, "facetSetSelectors", [facetSetHash]),
    read(client, at, registry, protocolFacetRegistryAbi, "facets"),
  ]);
  const metadata = parseMetadata(metadataRaw);
  if (
    !metadata.published ||
    metadata.release !== activeRelease ||
    metadata.requiredStorageVersion !== requiredStorageVersion ||
    metadata.storageLayoutHash.toLowerCase() !== requiredStorageLayoutHash.toLowerCase() ||
    metadata.selectorCount < 0n ||
    metadata.selectorCount > BigInt(MAX_ACTIVE_RELEASE_SELECTORS)
  ) {
    throw new FacetReleaseProofError("unsupported_release");
  }

  const selectors = parseSelectors(selectorsRaw);
  if (
    selectors.length > MAX_ACTIVE_RELEASE_SELECTORS ||
    BigInt(selectors.length) !== metadata.selectorCount
  ) {
    throw new FacetReleaseProofError("unsupported_release");
  }
  for (let index = 1; index < selectors.length; index += 1) {
    if (BigInt(selectors[index]!) <= BigInt(selectors[index - 1]!)) {
      throw new FacetReleaseProofError("unsupported_release");
    }
  }

  const inventory = parseLoupe(loupeRaw);
  if (inventory.length > selectors.length) {
    throw new FacetReleaseProofError("unsupported_release");
  }
  const inventoryBySelector = new Map<string, string>();
  const inventoryFacets = new Set<string>();
  for (const entry of inventory) {
    const facetKey = entry.facet.toLowerCase();
    if (
      facetKey === registry.toLowerCase() ||
      inventoryFacets.has(facetKey) ||
      entry.selectors.length === 0
    ) {
      throw new FacetReleaseProofError("unsupported_release");
    }
    inventoryFacets.add(facetKey);
    for (const selector of entry.selectors) {
      const selectorKey = selector.toLowerCase();
      if (inventoryBySelector.has(selectorKey)) {
        throw new FacetReleaseProofError("unsupported_release");
      }
      inventoryBySelector.set(selectorKey, facetKey);
    }
  }
  if (
    inventoryBySelector.size !== selectors.length ||
    selectors.some(selector => !inventoryBySelector.has(selector.toLowerCase()))
  ) {
    throw new FacetReleaseProofError("unsupported_release");
  }

  const routes = await Promise.all(
    selectors.map(async selector => {
      const [published, active] = await Promise.all([
        read(
          client,
          at,
          registry,
          protocolFacetRegistryAbi,
          "facetSetRoute",
          [facetSetHash, selector],
        ),
        read(client, at, registry, protocolFacetRegistryAbi, "route", [selector]),
      ]);
      return {
        active: parseActiveRoute(active),
        published: parseRoute(published),
        selector,
      };
    }),
  );
  const codeHashByFacet = new Map<string, { address: Address; codeHash: Hex }>();
  let migrationRoutes = 0;
  for (const route of routes) {
    const selectorKey = route.selector.toLowerCase();
    if (
      route.active.facet.toLowerCase() !== route.published.facet.toLowerCase() ||
      route.active.codeHash.toLowerCase() !== route.published.codeHash.toLowerCase() ||
      route.active.kind !== route.published.kind ||
      route.active.requiredStorageVersion !== requiredStorageVersion ||
      route.published.kind < 0 ||
      route.published.kind > 2 ||
      inventoryBySelector.get(selectorKey) !== route.published.facet.toLowerCase()
    ) {
      throw new FacetReleaseProofError("unsupported_release");
    }
    if (route.published.kind === 2) {
      migrationRoutes += 1;
      if (
        metadata.migrationFacet.toLowerCase() !== route.published.facet.toLowerCase() ||
        metadata.migrationSelector.toLowerCase() !== selectorKey
      ) {
        throw new FacetReleaseProofError("unsupported_release");
      }
    }
    const facetKey = route.published.facet.toLowerCase();
    const previous = codeHashByFacet.get(facetKey);
    if (
      previous &&
      previous.codeHash.toLowerCase() !== route.published.codeHash.toLowerCase()
    ) {
      throw new FacetReleaseProofError("unsupported_release");
    }
    codeHashByFacet.set(facetKey, {
      address: route.published.facet,
      codeHash: route.published.codeHash,
    });
  }
  const hasMigrationFacet = metadata.migrationFacet.toLowerCase() !== zeroAddress;
  const hasMigrationSelector = metadata.migrationSelector.toLowerCase() !== "0x00000000";
  if (
    hasMigrationFacet !== hasMigrationSelector ||
    (hasMigrationFacet ? migrationRoutes !== 1 : migrationRoutes !== 0)
  ) {
    throw new FacetReleaseProofError("unsupported_release");
  }
  await Promise.all(
    [...codeHashByFacet.values()].map(async facet => {
      const code = await client.getCode({ address: facet.address, blockNumber: at });
      requireCodeHash(code, facet.codeHash);
    }),
  );

  await requireSameBlock(client, block);
  return {
    ...block,
    facetSetHash,
    release: activeRelease,
    requiredStorageLayoutHash,
    requiredStorageVersion,
  };
}

export async function pinLatestBlock(
  client: PublicClient,
): Promise<{ blockHash: Hex; blockNumber: bigint }> {
  const block = await client.getBlock({ blockTag: "latest" });
  if (block.number === null || block.hash === null) {
    throw new FacetReleaseProofError("chain_unavailable");
  }
  return { blockHash: checkedHash(block.hash), blockNumber: block.number };
}

export async function requireSameBlock(
  client: PublicClient,
  pinned: { blockHash: Hex; blockNumber: bigint },
): Promise<void> {
  const block = await client.getBlock({ blockNumber: pinned.blockNumber });
  if (
    block.number !== pinned.blockNumber ||
    block.hash === null ||
    checkedHash(block.hash).toLowerCase() !== pinned.blockHash.toLowerCase()
  ) {
    throw new FacetReleaseProofError("reorg_uncertainty");
  }
}

export class FacetReleaseProofError extends Error {
  constructor(readonly failure: string) {
    super(failure);
    this.name = "FacetReleaseProofError";
  }
}

function read(
  client: PublicClient,
  blockNumber: bigint,
  address: Address,
  abi: readonly unknown[],
  functionName: string,
  args?: readonly unknown[],
): Promise<unknown> {
  return client.readContract({
    address,
    abi,
    functionName,
    ...(args ? { args } : {}),
    blockNumber,
  } as never);
}

function parseMetadata(value: unknown): {
  published: boolean;
  release: bigint;
  requiredStorageVersion: bigint;
  storageLayoutHash: Hex;
  manifestHash: Hex;
  migrationFacet: Address;
  migrationSelector: Hex;
  selectorCount: bigint;
} {
  const field = tupleOrRecord(value);
  const published = field(0, "published");
  const release = field(1, "release");
  const requiredStorageVersion = field(2, "requiredStorageVersion");
  const storageLayoutHash = field(4, "storageLayoutHash");
  const manifestHash = field(5, "manifestHash");
  const migrationFacet = field(6, "migrationFacet");
  const migrationSelector = field(7, "migrationSelector");
  const selectorCount = field(8, "selectorCount");
  if (
    typeof published !== "boolean" ||
    typeof release !== "bigint" ||
    typeof requiredStorageVersion !== "bigint" ||
    typeof selectorCount !== "bigint"
  ) {
    throw new FacetReleaseProofError("malformed_chain_result");
  }
  return {
    published,
    release,
    requiredStorageVersion,
    storageLayoutHash: checkedHash(storageLayoutHash),
    manifestHash: checkedHash(manifestHash),
    migrationFacet: checkedOptionalAddress(migrationFacet),
    migrationSelector: checkedSelector(migrationSelector),
    selectorCount,
  };
}

function parseSelectors(value: unknown): Hex[] {
  if (
    !Array.isArray(value) ||
    value.some(selector => typeof selector !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(selector))
  ) {
    throw new FacetReleaseProofError("malformed_chain_result");
  }
  return value as Hex[];
}

function parseLoupe(value: unknown): Array<{ facet: Address; selectors: Hex[] }> {
  if (!Array.isArray(value)) {
    throw new FacetReleaseProofError("malformed_chain_result");
  }
  return value.map(entry => {
    const field = tupleOrRecord(entry);
    return {
      facet: checkedAddress(field(0, "facetAddress")),
      selectors: parseSelectors(field(1, "functionSelectors")),
    };
  });
}

function parseRoute(value: unknown): FacetRoute {
  const field = tupleOrRecord(value);
  const kind = field(2, "kind");
  if (typeof kind !== "number" || !Number.isSafeInteger(kind)) {
    throw new FacetReleaseProofError("malformed_chain_result");
  }
  return {
    facet: checkedAddress(field(0, "facet")),
    codeHash: checkedHash(field(1, "codeHash")),
    kind,
  };
}

function parseActiveRoute(value: unknown): FacetRoute & {
  requiredStorageVersion: bigint;
} {
  const route = parseRoute(value);
  const requiredStorageVersion = tupleOrRecord(value)(
    3,
    "requiredStorageVersion",
  );
  if (typeof requiredStorageVersion !== "bigint") {
    throw new FacetReleaseProofError("malformed_chain_result");
  }
  return { ...route, requiredStorageVersion };
}

function tupleOrRecord(
  value: unknown,
): (index: number, name: string) => unknown {
  const tuple = Array.isArray(value) ? value : undefined;
  const record =
    tuple === undefined && typeof value === "object" && value !== null
      ? value as Record<string, unknown>
      : undefined;
  if (!tuple && !record) {
    throw new FacetReleaseProofError("malformed_chain_result");
  }
  return (index, name) => tuple?.[index] ?? record?.[name];
}

function checkedAddress(value: unknown): Address {
  if (
    typeof value !== "string" ||
    !isAddress(value) ||
    value.toLowerCase() === zeroAddress
  ) {
    throw new FacetReleaseProofError("malformed_chain_result");
  }
  return getAddress(value);
}

function checkedOptionalAddress(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new FacetReleaseProofError("malformed_chain_result");
  }
  return getAddress(value);
}

function checkedHash(value: unknown): Hex {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(value) ||
    /^0x0{64}$/i.test(value)
  ) {
    throw new FacetReleaseProofError("malformed_chain_result");
  }
  return value as Hex;
}

function checkedSelector(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(value)) {
    throw new FacetReleaseProofError("malformed_chain_result");
  }
  return value as Hex;
}

function checkedPositiveBigInt(value: unknown): bigint {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new FacetReleaseProofError("malformed_chain_result");
  }
  return value;
}

function assertAddress(actual: unknown, expected: Address): void {
  if (checkedAddress(actual).toLowerCase() !== expected.toLowerCase()) {
    throw new FacetReleaseProofError("unsupported_release");
  }
}

function assertHash(actual: unknown, expected: Hex): void {
  if (checkedHash(actual).toLowerCase() !== expected.toLowerCase()) {
    throw new FacetReleaseProofError("unsupported_release");
  }
}

function requireCodeHash(code: Hex | undefined, expected: Hex): void {
  if (
    !code ||
    code === "0x" ||
    keccak256(code).toLowerCase() !== expected.toLowerCase()
  ) {
    throw new FacetReleaseProofError("unsupported_release");
  }
}
