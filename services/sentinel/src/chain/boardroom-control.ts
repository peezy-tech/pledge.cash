import {
  boardroomAbi,
  boardroomControllerAbi,
  boardroomControllerFactoryAbi,
  boardroomFactoryAbi,
  boardroomKernelAbi,
  getPledgeCashDeployment,
  protocolFacetRegistryAbi,
  type PledgeCashDeployment
} from "@pledge.cash/sdk";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  hashMessage,
  http,
  isAddress,
  keccak256,
  padHex,
  zeroAddress,
  type Address,
  type Hex
} from "viem";

import type { Config, SentinelChainConfig } from "../config";

export const SUPPORTED_BOARDROOM_CONTROL_RELEASE = "pledge.cash.protocol.v1";
export const ERC1271_MAGIC_VALUE = "0x1626ba7e" as const;

export type BoardroomControlSnapshot = {
  readonly appliedStorageLayoutHash: Hex;
  readonly appliedStorageVersion: bigint;
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly boardroom: Address;
  readonly boardroomEpoch: bigint;
  readonly chainId: number;
  readonly configurationHash: Hex;
  readonly configurationEpoch: bigint;
  readonly controller: Address;
  readonly controllerGeneration: bigint;
  readonly facetSetHash: Hex;
};

export type BoardroomControlExpectedIdentity = Pick<
  BoardroomControlSnapshot,
  | "boardroom"
  | "boardroomEpoch"
  | "chainId"
  | "configurationHash"
  | "configurationEpoch"
  | "controller"
  | "controllerGeneration"
  | "facetSetHash"
>;

export type BoardroomControlChainReader = {
  resolveCanonicalBoardroom(input: {
    readonly boardroom: Address;
    readonly chainId: number;
  }): Promise<BoardroomControlSnapshot>;
  verifyControlSignature(input: {
    readonly expected: BoardroomControlExpectedIdentity;
    readonly message: string;
    readonly signature: Hex;
  }): Promise<BoardroomControlSnapshot>;
};

export type BoardroomControlFailure =
  | "invalid-signature"
  | "malformed-chain-result"
  | "non-canonical-boardroom"
  | "reorg-uncertainty"
  | "rpc-failure"
  | "stale-facet-set"
  | "stale-relationship"
  | "storage-migration-required"
  | "unknown-chain"
  | "unsupported-release";

export class BoardroomControlChainError extends Error {
  constructor(readonly failure: BoardroomControlFailure) {
    super(failure);
    this.name = "BoardroomControlChainError";
  }
}

export type BoardroomControlPublicClient = {
  call(input: {
    readonly blockNumber: bigint;
    readonly data: Hex;
    readonly to: Address;
  }): Promise<{ readonly data?: Hex }>;
  getBlock(input: { readonly blockNumber: bigint } | { readonly blockTag: "finalized" }): Promise<{
    readonly hash?: Hex | null;
    readonly number?: bigint | null;
  }>;
  getChainId(): Promise<number>;
  getBytecode(input: {
    readonly address: Address;
    readonly blockNumber: bigint;
  }): Promise<Hex | undefined>;
  readContract(input: {
    readonly abi: readonly unknown[];
    readonly address: Address;
    readonly args?: readonly unknown[];
    readonly blockNumber: bigint;
    readonly functionName: string;
  }): Promise<unknown>;
};

export type CreateBoardroomControlChainReaderOptions = {
  readonly chains: readonly SentinelChainConfig[];
  readonly createClient?: (chain: SentinelChainConfig) => BoardroomControlPublicClient;
  readonly getDeployment?: (chainId: number) => PledgeCashDeployment | undefined;
};

type PinnedContext = {
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly chain: SentinelChainConfig;
  readonly client: BoardroomControlPublicClient;
  readonly deployment: Required<
    Pick<
      PledgeCashDeployment,
      | "boardroomControllerFactory"
      | "boardroomControllerFactoryCodeHash"
      | "boardroomControllerLogic"
      | "boardroomControllerLogicCodeHash"
      | "boardroomFactory"
      | "boardroomFactoryCodeHash"
      | "boardroomGovernanceLogic"
      | "boardroomGovernanceLogicCodeHash"
      | "boardroomKernel"
      | "boardroomKernelCodeHash"
      | "boardroomMarketLogic"
      | "boardroomMarketLogicCodeHash"
      | "boardroomRedemptionPayout"
      | "boardroomRedemptionPayoutCodeHash"
      | "kernelSelectorSetHash"
      | "protocolFacetRegistry"
      | "protocolFacetRegistryCodeHash"
      | "protocolFacetRegistryOwner"
      | "protocolGovernance"
      | "protocolReleaseCodeHash"
    >
  >;
};

type LiveFacetRelease = {
  readonly facetSetHash: Hex;
  readonly release: bigint;
  readonly requiredStorageLayoutHash: Hex;
  readonly requiredStorageVersion: bigint;
};

const MAX_RELEASE_SELECTORS = 256;

export function createBoardroomControlChainReader(
  options: CreateBoardroomControlChainReaderOptions
): BoardroomControlChainReader {
  const chains = new Map(options.chains.map((chain) => [chain.chainId, chain]));
  const createClient =
    options.createClient ??
    ((chain: SentinelChainConfig) =>
      createPublicClient({ transport: http(chain.rpcUrl) }) as unknown as BoardroomControlPublicClient);
  const resolveDeployment = options.getDeployment ?? getPledgeCashDeployment;

  return {
    async resolveCanonicalBoardroom(input) {
      return withFailClosedErrors(async () => {
        const context = await pinContext(input.chainId, chains, createClient, resolveDeployment);
        const snapshot = await resolveAtPinnedBlock(context, input.boardroom);
        await requireSameBlock(context);
        return snapshot;
      });
    },

    async verifyControlSignature(input) {
      return withFailClosedErrors(async () => {
        const context = await pinContext(
          input.expected.chainId,
          chains,
          createClient,
          resolveDeployment
        );
        const snapshot = await resolveAtPinnedBlock(context, input.expected.boardroom);
        if (snapshot.facetSetHash.toLowerCase() !== input.expected.facetSetHash.toLowerCase()) {
          throw new BoardroomControlChainError("stale-facet-set");
        }
        if (!sameIdentity(snapshot, input.expected)) {
          throw new BoardroomControlChainError("stale-relationship");
        }

        const digest = hashMessage(input.message);
        const data = encodeFunctionData({
          abi: boardroomControllerAbi,
          functionName: "isValidSignature",
          args: [digest, input.signature]
        });
        const result = await context.client.call({
          blockNumber: context.blockNumber,
          data,
          to: snapshot.controller
        });
        const expectedResult = padHex(ERC1271_MAGIC_VALUE, { dir: "right", size: 32 });
        if (result.data === undefined || result.data.toLowerCase() !== expectedResult.toLowerCase()) {
          if (result.data !== undefined && result.data.length !== 66) {
            throw new BoardroomControlChainError("malformed-chain-result");
          }
          throw new BoardroomControlChainError("invalid-signature");
        }

        await requireSameBlock(context);
        return snapshot;
      });
    }
  };
}

async function pinContext(
  chainId: number,
  chains: ReadonlyMap<number, SentinelChainConfig>,
  createClient: (chain: SentinelChainConfig) => BoardroomControlPublicClient,
  getDeployment: (chainId: number) => PledgeCashDeployment | undefined
): Promise<PinnedContext> {
  const chain = chains.get(chainId);
  if (chain === undefined) throw new BoardroomControlChainError("unknown-chain");

  const deployment = getDeployment(chainId);
  if (
    deployment?.deterministicDeployment !== true ||
    deployment.chainId !== chainId ||
    deployment.protocolVersion !== SUPPORTED_BOARDROOM_CONTROL_RELEASE ||
    deployment.deterministicDeploymentVersion !== SUPPORTED_BOARDROOM_CONTROL_RELEASE ||
    !isHash(deployment.protocolReleaseCodeHash) ||
    deployment.protocolReleaseCodeHash.toLowerCase() !==
      deployment.deterministicReleaseCodeHash?.toLowerCase() ||
    !isAddressValue(deployment.protocolGovernance) ||
    !isAddressValue(deployment.protocolFacetRegistryOwner) ||
    !isAddressValue(deployment.protocolFacetRegistry) ||
    !isHash(deployment.protocolFacetRegistryCodeHash) ||
    !isAddressValue(deployment.boardroomKernel) ||
    !isHash(deployment.boardroomKernelCodeHash) ||
    !isAddressValue(deployment.boardroomFactory) ||
    !isHash(deployment.boardroomFactoryCodeHash) ||
    !isAddressValue(deployment.boardroomControllerFactory) ||
    !isHash(deployment.boardroomControllerFactoryCodeHash) ||
    !isAddressValue(deployment.boardroomControllerLogic) ||
    !isHash(deployment.boardroomControllerLogicCodeHash) ||
    !isAddressValue(deployment.boardroomGovernanceLogic) ||
    !isHash(deployment.boardroomGovernanceLogicCodeHash) ||
    !isAddressValue(deployment.boardroomMarketLogic) ||
    !isHash(deployment.boardroomMarketLogicCodeHash) ||
    !isAddressValue(deployment.boardroomRedemptionPayout) ||
    !isHash(deployment.boardroomRedemptionPayoutCodeHash) ||
    !isHash(deployment.kernelSelectorSetHash)
  ) {
    throw new BoardroomControlChainError("unsupported-release");
  }

  const client = createClient(chain);
  const [rpcChainId, finalized] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockTag: "finalized" })
  ]);
  if (rpcChainId !== chainId) throw new BoardroomControlChainError("unknown-chain");
  if (
    finalized.number === null ||
    finalized.number === undefined ||
    finalized.number < 0n ||
    !isHash(finalized.hash)
  ) {
    throw new BoardroomControlChainError("malformed-chain-result");
  }

  return {
    blockHash: finalized.hash,
    blockNumber: finalized.number,
    chain,
    client,
    deployment: {
      boardroomControllerFactory: getAddress(deployment.boardroomControllerFactory),
      boardroomControllerFactoryCodeHash: deployment.boardroomControllerFactoryCodeHash,
      boardroomControllerLogic: getAddress(deployment.boardroomControllerLogic),
      boardroomControllerLogicCodeHash: deployment.boardroomControllerLogicCodeHash,
      boardroomFactory: getAddress(deployment.boardroomFactory),
      boardroomFactoryCodeHash: deployment.boardroomFactoryCodeHash,
      boardroomGovernanceLogic: getAddress(deployment.boardroomGovernanceLogic),
      boardroomGovernanceLogicCodeHash: deployment.boardroomGovernanceLogicCodeHash,
      boardroomKernel: getAddress(deployment.boardroomKernel),
      boardroomKernelCodeHash: deployment.boardroomKernelCodeHash,
      boardroomMarketLogic: getAddress(deployment.boardroomMarketLogic),
      boardroomMarketLogicCodeHash: deployment.boardroomMarketLogicCodeHash,
      boardroomRedemptionPayout: getAddress(deployment.boardroomRedemptionPayout),
      boardroomRedemptionPayoutCodeHash: deployment.boardroomRedemptionPayoutCodeHash,
      kernelSelectorSetHash: deployment.kernelSelectorSetHash,
      protocolFacetRegistry: getAddress(deployment.protocolFacetRegistry),
      protocolFacetRegistryCodeHash: deployment.protocolFacetRegistryCodeHash,
      protocolFacetRegistryOwner: getAddress(deployment.protocolFacetRegistryOwner),
      protocolGovernance: getAddress(deployment.protocolGovernance),
      protocolReleaseCodeHash: deployment.protocolReleaseCodeHash
    }
  };
}

async function resolveAtPinnedBlock(
  context: PinnedContext,
  boardroomInput: Address
): Promise<BoardroomControlSnapshot> {
  const boardroom = checkedAddress(boardroomInput);
  const factory = context.deployment.boardroomFactory;
  const at = context.blockNumber;
  const release = await proveCanonicalRelease(context);

  const [canonical, boardroomCode] = await Promise.all([
    context.client.readContract({
      abi: boardroomFactoryAbi,
      address: factory,
      args: [boardroom],
      blockNumber: at,
      functionName: "isBoardroom"
    }),
    context.client.getBytecode({ address: boardroom, blockNumber: at })
  ]);
  if (canonical !== true) throw new BoardroomControlChainError("non-canonical-boardroom");
  requireMinimalProxy(boardroomCode, context.deployment.boardroomKernel);

  const [
    boardroomRegistryRaw,
    facetSetHashRaw,
    appliedStorageVersionRaw,
    appliedStorageLayoutHashRaw,
    migrationRequired,
    launched,
    ownerRaw,
    controllerRaw,
    generationRaw,
    boardroomEpochRaw,
    boundFactoryRaw,
    governanceLogicRaw,
    marketLogicRaw,
    redemptionPayoutRaw
  ] = await Promise.all([
    read(context, boardroom, boardroomAbi, "facetRegistry"),
    read(context, boardroom, boardroomAbi, "facetSetHash"),
    read(context, boardroom, boardroomAbi, "appliedStorageVersion"),
    read(context, boardroom, boardroomAbi, "appliedStorageLayoutHash"),
    read(context, boardroom, boardroomAbi, "migrationRequired"),
    read(context, boardroom, boardroomAbi, "launched"),
    read(context, boardroom, boardroomAbi, "owner"),
    read(context, boardroom, boardroomAbi, "controller"),
    read(context, boardroom, boardroomAbi, "controllerGeneration"),
    read(context, boardroom, boardroomAbi, "governanceEpoch"),
    read(context, boardroom, boardroomAbi, "controllerFactory"),
    read(context, boardroom, boardroomAbi, "governanceLogic"),
    read(context, boardroom, boardroomAbi, "marketLogic"),
    read(context, boardroom, boardroomAbi, "redemptionPayoutLogic")
  ]);

  assertAddress(boardroomRegistryRaw, context.deployment.protocolFacetRegistry);
  const facetSetHash = checkedHash(facetSetHashRaw);
  if (facetSetHash.toLowerCase() !== release.facetSetHash.toLowerCase()) {
    throw new BoardroomControlChainError("stale-facet-set");
  }
  const appliedStorageVersion = checkedPositiveBigInt(appliedStorageVersionRaw);
  const appliedStorageLayoutHash = checkedHash(appliedStorageLayoutHashRaw);
  if (migrationRequired !== false) {
    if (migrationRequired === true) {
      throw new BoardroomControlChainError("storage-migration-required");
    }
    throw new BoardroomControlChainError("malformed-chain-result");
  }
  if (
    appliedStorageVersion !== release.requiredStorageVersion ||
    appliedStorageLayoutHash.toLowerCase() !==
      release.requiredStorageLayoutHash.toLowerCase()
  ) {
    throw new BoardroomControlChainError("storage-migration-required");
  }
  if (launched !== true) throw new BoardroomControlChainError("stale-relationship");
  const owner = checkedAddress(ownerRaw);
  const controller = checkedAddress(controllerRaw);
  const controllerGeneration = checkedPositiveBigInt(generationRaw);
  const boardroomEpoch = checkedPositiveBigInt(boardroomEpochRaw);
  const boundFactory = checkedAddress(boundFactoryRaw);
  if (
    owner.toLowerCase() !== controller.toLowerCase() ||
    boundFactory.toLowerCase() !==
      context.deployment.boardroomControllerFactory.toLowerCase()
  ) {
    throw new BoardroomControlChainError("stale-relationship");
  }
  assertAddress(governanceLogicRaw, context.deployment.boardroomGovernanceLogic);
  assertAddress(marketLogicRaw, context.deployment.boardroomMarketLogic);
  assertAddress(redemptionPayoutRaw, context.deployment.boardroomRedemptionPayout);

  const [
    factoryBoardroomFactoryRaw,
    controllerImplementationRaw,
    registeredController,
    registeredBoardroomRaw,
    registeredGenerationRaw,
    controllerCode,
    controllerFactoryBindingRaw,
    controllerBoardroomRaw,
    controllerGenerationRaw,
    configurationEpochRaw,
    configurationHashRaw
  ] = await Promise.all([
    read(
      context,
      context.deployment.boardroomControllerFactory,
      boardroomControllerFactoryAbi,
      "boardroomFactory"
    ),
    read(
      context,
      context.deployment.boardroomControllerFactory,
      boardroomControllerFactoryAbi,
      "controllerImplementation"
    ),
    read(
      context,
      context.deployment.boardroomControllerFactory,
      boardroomControllerFactoryAbi,
      "isController",
      [controller]
    ),
    read(
      context,
      context.deployment.boardroomControllerFactory,
      boardroomControllerFactoryAbi,
      "boardroomOfController",
      [controller]
    ),
    read(
      context,
      context.deployment.boardroomControllerFactory,
      boardroomControllerFactoryAbi,
      "generationOfController",
      [controller]
    ),
    context.client.getBytecode({ address: controller, blockNumber: at }),
    read(context, controller, boardroomControllerAbi, "factory"),
    read(context, controller, boardroomControllerAbi, "boardroom"),
    read(context, controller, boardroomControllerAbi, "generation"),
    read(context, controller, boardroomControllerAbi, "configurationEpoch"),
    read(context, controller, boardroomControllerAbi, "configurationHash")
  ]);

  const factoryBoardroomFactory = checkedAddress(factoryBoardroomFactoryRaw);
  const controllerImplementation = checkedAddress(controllerImplementationRaw);
  const registeredBoardroom = checkedAddress(registeredBoardroomRaw);
  const registeredGeneration = checkedPositiveBigInt(registeredGenerationRaw);
  const controllerFactoryBinding = checkedAddress(controllerFactoryBindingRaw);
  const controllerBoardroom = checkedAddress(controllerBoardroomRaw);
  const controllerReportedGeneration = checkedPositiveBigInt(controllerGenerationRaw);
  const configurationEpoch = checkedPositiveBigInt(configurationEpochRaw);
  const configurationHash = checkedHash(configurationHashRaw);

  if (
    registeredController !== true ||
    factoryBoardroomFactory.toLowerCase() !== factory.toLowerCase() ||
    registeredBoardroom.toLowerCase() !== boardroom.toLowerCase() ||
    controllerFactoryBinding.toLowerCase() !==
      context.deployment.boardroomControllerFactory.toLowerCase() ||
    controllerBoardroom.toLowerCase() !== boardroom.toLowerCase() ||
    registeredGeneration !== controllerGeneration ||
    controllerReportedGeneration !== controllerGeneration ||
    controllerImplementation.toLowerCase() !==
      context.deployment.boardroomControllerLogic.toLowerCase()
  ) {
    throw new BoardroomControlChainError("stale-relationship");
  }

  requireMinimalProxy(controllerCode, controllerImplementation);

  return {
    appliedStorageLayoutHash,
    appliedStorageVersion,
    blockHash: context.blockHash,
    blockNumber: at,
    boardroom,
    boardroomEpoch,
    chainId: context.chain.chainId,
    configurationHash,
    configurationEpoch,
    controller,
    controllerGeneration,
    facetSetHash
  };
}

async function proveCanonicalRelease(context: PinnedContext): Promise<LiveFacetRelease> {
  const { deployment } = context;
  const at = context.blockNumber;
  const contracts: Array<readonly [Address, string]> = [
    [deployment.protocolFacetRegistry, deployment.protocolFacetRegistryCodeHash],
    [deployment.boardroomKernel, deployment.boardroomKernelCodeHash],
    [deployment.boardroomFactory, deployment.boardroomFactoryCodeHash],
    [deployment.boardroomControllerFactory, deployment.boardroomControllerFactoryCodeHash],
    [deployment.boardroomControllerLogic, deployment.boardroomControllerLogicCodeHash],
    [deployment.boardroomGovernanceLogic, deployment.boardroomGovernanceLogicCodeHash],
    [deployment.boardroomMarketLogic, deployment.boardroomMarketLogicCodeHash],
    [deployment.boardroomRedemptionPayout, deployment.boardroomRedemptionPayoutCodeHash]
  ];
  const codes = await Promise.all(
    contracts.map(([address]) => context.client.getBytecode({ address, blockNumber: at }))
  );
  for (let index = 0; index < contracts.length; index += 1) {
    requireCodeHash(codes[index], contracts[index]![1]);
  }

  const registry = deployment.protocolFacetRegistry;
  const [
    registryOwnerRaw,
    activeFacetSetHashRaw,
    activeReleaseRaw,
    activeStorageVersionRaw,
    activeStorageLayoutHashRaw,
    registryKernelSelectorSetHashRaw,
    factoryRegistryRaw,
    factoryKernelRaw,
    factoryControllerFactoryRaw,
    factoryGovernanceLogicRaw,
    factoryMarketLogicRaw,
    factoryRedemptionPayoutRaw,
    kernelRegistryRaw,
    kernelSelectorSetHashRaw,
    controllerFactoryBoardroomFactoryRaw,
    controllerImplementationRaw
  ] = await Promise.all([
    read(context, registry, protocolFacetRegistryAbi, "owner"),
    read(context, registry, protocolFacetRegistryAbi, "activeFacetSetHash"),
    read(context, registry, protocolFacetRegistryAbi, "activeRelease"),
    read(context, registry, protocolFacetRegistryAbi, "activeStorageVersion"),
    read(context, registry, protocolFacetRegistryAbi, "activeStorageLayoutHash"),
    read(context, registry, protocolFacetRegistryAbi, "kernelSelectorSetHash"),
    read(context, deployment.boardroomFactory, boardroomFactoryAbi, "facetRegistry"),
    read(
      context,
      deployment.boardroomFactory,
      boardroomFactoryAbi,
      "boardroomKernelLogic"
    ),
    read(context, deployment.boardroomFactory, boardroomFactoryAbi, "controllerFactory"),
    read(context, deployment.boardroomFactory, boardroomFactoryAbi, "governanceLogic"),
    read(context, deployment.boardroomFactory, boardroomFactoryAbi, "marketLogic"),
    read(
      context,
      deployment.boardroomFactory,
      boardroomFactoryAbi,
      "redemptionPayoutLogic"
    ),
    read(context, deployment.boardroomKernel, boardroomKernelAbi, "facetRegistry"),
    read(
      context,
      deployment.boardroomKernel,
      boardroomKernelAbi,
      "kernelSelectorSetHash"
    ),
    read(
      context,
      deployment.boardroomControllerFactory,
      boardroomControllerFactoryAbi,
      "boardroomFactory"
    ),
    read(
      context,
      deployment.boardroomControllerFactory,
      boardroomControllerFactoryAbi,
      "controllerImplementation"
    )
  ]);

  checkedAddress(registryOwnerRaw);
  const activeFacetSetHash = checkedHash(activeFacetSetHashRaw);
  const activeRelease = checkedPositiveBigInt(activeReleaseRaw);
  const activeStorageVersion = checkedPositiveBigInt(activeStorageVersionRaw);
  const activeStorageLayoutHash = checkedHash(activeStorageLayoutHashRaw);
  assertHash(registryKernelSelectorSetHashRaw, deployment.kernelSelectorSetHash);
  assertHash(kernelSelectorSetHashRaw, deployment.kernelSelectorSetHash);
  assertAddress(factoryRegistryRaw, registry);
  assertAddress(factoryKernelRaw, deployment.boardroomKernel);
  assertAddress(factoryControllerFactoryRaw, deployment.boardroomControllerFactory);
  assertAddress(factoryGovernanceLogicRaw, deployment.boardroomGovernanceLogic);
  assertAddress(factoryMarketLogicRaw, deployment.boardroomMarketLogic);
  assertAddress(factoryRedemptionPayoutRaw, deployment.boardroomRedemptionPayout);
  assertAddress(kernelRegistryRaw, registry);
  assertAddress(controllerFactoryBoardroomFactoryRaw, deployment.boardroomFactory);
  assertAddress(controllerImplementationRaw, deployment.boardroomControllerLogic);

  const [metadataRaw, publishedSelectorsRaw, facetsRaw] = await Promise.all([
    read(context, registry, protocolFacetRegistryAbi, "facetSetMetadata", [
      activeFacetSetHash
    ]),
    read(context, registry, protocolFacetRegistryAbi, "facetSetSelectors", [
      activeFacetSetHash
    ]),
    read(context, registry, protocolFacetRegistryAbi, "facets")
  ]);
  const metadata = facetSetMetadata(metadataRaw);
  if (
    !metadata.published ||
    metadata.release !== activeRelease ||
    metadata.requiredStorageVersion !== activeStorageVersion ||
    metadata.storageLayoutHash.toLowerCase() !== activeStorageLayoutHash.toLowerCase() ||
    metadata.selectorCount < 0n ||
    metadata.selectorCount > BigInt(MAX_RELEASE_SELECTORS)
  ) {
    throw new BoardroomControlChainError("unsupported-release");
  }

  const publishedSelectors = selectors(publishedSelectorsRaw);
  if (
    publishedSelectors.length > MAX_RELEASE_SELECTORS ||
    BigInt(publishedSelectors.length) !== metadata.selectorCount
  ) {
    throw new BoardroomControlChainError("unsupported-release");
  }
  for (let index = 1; index < publishedSelectors.length; index += 1) {
    if (BigInt(publishedSelectors[index]!) <= BigInt(publishedSelectors[index - 1]!)) {
      throw new BoardroomControlChainError("unsupported-release");
    }
  }

  const liveFacets = facetInventory(facetsRaw);
  if (liveFacets.length > publishedSelectors.length) {
    throw new BoardroomControlChainError("unsupported-release");
  }

  const inventorySelectors = new Set<string>();
  const inventoryBySelector = new Map<string, string>();
  for (const facet of liveFacets) {
    const facetKey = facet.address.toLowerCase();
    if (facetKey === registry.toLowerCase() || facet.selectors.length === 0) {
      throw new BoardroomControlChainError("unsupported-release");
    }
    for (const selector of facet.selectors) {
      const key = selector.toLowerCase();
      if (inventorySelectors.has(key)) {
        throw new BoardroomControlChainError("unsupported-release");
      }
      inventorySelectors.add(key);
      inventoryBySelector.set(key, facetKey);
    }
  }
  if (
    inventorySelectors.size !== publishedSelectors.length ||
    publishedSelectors.some((selector) => !inventorySelectors.has(selector.toLowerCase()))
  ) {
    throw new BoardroomControlChainError("unsupported-release");
  }

  const routes = await Promise.all(
    publishedSelectors.map(async (selector) => {
      const [published, active] = await Promise.all([
        read(context, registry, protocolFacetRegistryAbi, "facetSetRoute", [
          activeFacetSetHash,
          selector
        ]),
        read(context, registry, protocolFacetRegistryAbi, "route", [selector])
      ]);
      return {
        active: activeFacetRoute(active),
        published: facetSetRoute(published),
        selector
      };
    })
  );
  const codeHashByFacet = new Map<string, { address: Address; codeHash: Hex }>();
  let migrationRoutes = 0;
  for (const { active, published, selector } of routes) {
    const selectorKey = selector.toLowerCase();
    if (
      active.facet.toLowerCase() !== published.facet.toLowerCase() ||
      active.codeHash.toLowerCase() !== published.codeHash.toLowerCase() ||
      active.kind !== published.kind ||
      active.requiredStorageVersion !== activeStorageVersion ||
      published.kind < 0 ||
      published.kind > 2 ||
      inventoryBySelector.get(selectorKey) !== published.facet.toLowerCase()
    ) {
      throw new BoardroomControlChainError("unsupported-release");
    }
    if (published.kind === 2) {
      migrationRoutes += 1;
      if (
        metadata.migrationFacet.toLowerCase() !== published.facet.toLowerCase() ||
        metadata.migrationSelector.toLowerCase() !== selectorKey
      ) {
        throw new BoardroomControlChainError("unsupported-release");
      }
    }
    const facetKey = published.facet.toLowerCase();
    const previous = codeHashByFacet.get(facetKey);
    if (previous && previous.codeHash.toLowerCase() !== published.codeHash.toLowerCase()) {
      throw new BoardroomControlChainError("unsupported-release");
    }
    codeHashByFacet.set(facetKey, {
      address: published.facet,
      codeHash: published.codeHash
    });
  }
  const hasMigrationFacet = metadata.migrationFacet.toLowerCase() !== zeroAddress;
  const hasMigrationSelector = metadata.migrationSelector.toLowerCase() !== "0x00000000";
  if (
    hasMigrationFacet !== hasMigrationSelector ||
    (hasMigrationFacet ? migrationRoutes !== 1 : migrationRoutes !== 0)
  ) {
    throw new BoardroomControlChainError("unsupported-release");
  }
  await Promise.all(
    [...codeHashByFacet.values()].map(async (facet) => {
      const code = await context.client.getBytecode({
        address: facet.address,
        blockNumber: at
      });
      requireCodeHash(code, facet.codeHash);
    })
  );

  return {
    facetSetHash: activeFacetSetHash,
    release: activeRelease,
    requiredStorageLayoutHash: activeStorageLayoutHash,
    requiredStorageVersion: activeStorageVersion
  };
}

async function requireSameBlock(context: PinnedContext): Promise<void> {
  const block = await context.client.getBlock({ blockNumber: context.blockNumber });
  if (
    block.number !== context.blockNumber ||
    !isHash(block.hash) ||
    block.hash.toLowerCase() !== context.blockHash.toLowerCase()
  ) {
    throw new BoardroomControlChainError("reorg-uncertainty");
  }
}

function sameIdentity(
  actual: BoardroomControlSnapshot,
  expected: BoardroomControlExpectedIdentity
): boolean {
  return (
    actual.chainId === expected.chainId &&
    actual.boardroom.toLowerCase() === expected.boardroom.toLowerCase() &&
    actual.facetSetHash.toLowerCase() === expected.facetSetHash.toLowerCase() &&
    actual.boardroomEpoch === expected.boardroomEpoch &&
    actual.controller.toLowerCase() === expected.controller.toLowerCase() &&
    actual.controllerGeneration === expected.controllerGeneration &&
    actual.configurationEpoch === expected.configurationEpoch &&
    actual.configurationHash.toLowerCase() === expected.configurationHash.toLowerCase()
  );
}

function read(
  context: PinnedContext,
  address: Address,
  abi: readonly unknown[],
  functionName: string,
  args?: readonly unknown[]
): Promise<unknown> {
  return context.client.readContract({
    abi,
    address,
    ...(args ? { args } : {}),
    blockNumber: context.blockNumber,
    functionName
  });
}

function facetSetMetadata(value: unknown): {
  readonly manifestHash: Hex;
  readonly migrationFacet: Address;
  readonly migrationSelector: Hex;
  readonly published: boolean;
  readonly release: bigint;
  readonly requiredStorageVersion: bigint;
  readonly selectorCount: bigint;
  readonly storageLayoutHash: Hex;
} {
  const tuple = Array.isArray(value) ? value : undefined;
  const record =
    tuple === undefined && typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  const published = tuple?.[0] ?? record?.published;
  const release = tuple?.[1] ?? record?.release;
  const requiredStorageVersion =
    tuple?.[2] ?? record?.requiredStorageVersion;
  const storageLayoutHash = tuple?.[4] ?? record?.storageLayoutHash;
  const manifestHash = tuple?.[5] ?? record?.manifestHash;
  const migrationFacet = tuple?.[6] ?? record?.migrationFacet;
  const migrationSelector = tuple?.[7] ?? record?.migrationSelector;
  const selectorCount = tuple?.[8] ?? record?.selectorCount;
  if (
    typeof published !== "boolean" ||
    typeof release !== "bigint" ||
    typeof requiredStorageVersion !== "bigint" ||
    typeof selectorCount !== "bigint"
  ) {
    throw new BoardroomControlChainError("malformed-chain-result");
  }
  return {
    manifestHash: checkedHash(manifestHash),
    migrationFacet: checkedOptionalAddress(migrationFacet),
    migrationSelector: checkedSelector(migrationSelector),
    published,
    release,
    requiredStorageVersion,
    selectorCount,
    storageLayoutHash: checkedHash(storageLayoutHash)
  };
}

function selectors(value: unknown): Hex[] {
  if (
    !Array.isArray(value) ||
    value.some((selector) => typeof selector !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(selector))
  ) {
    throw new BoardroomControlChainError("malformed-chain-result");
  }
  return value as Hex[];
}

function facetInventory(value: unknown): Array<{
  readonly address: Address;
  readonly selectors: Hex[];
}> {
  if (!Array.isArray(value)) {
    throw new BoardroomControlChainError("malformed-chain-result");
  }
  return value.map((entry) => {
    const tuple = Array.isArray(entry) ? entry : undefined;
    const record =
      tuple === undefined && typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>)
        : undefined;
    const address = tuple?.[0] ?? record?.facetAddress;
    const functionSelectors = tuple?.[1] ?? record?.functionSelectors;
    return {
      address: checkedAddress(address),
      selectors: selectors(functionSelectors)
    };
  });
}

function facetSetRoute(value: unknown): {
  readonly codeHash: Hex;
  readonly facet: Address;
  readonly kind: number;
} {
  const tuple = Array.isArray(value) ? value : undefined;
  const record =
    tuple === undefined && typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  const facet = tuple?.[0] ?? record?.facet;
  const codeHash = tuple?.[1] ?? record?.codeHash;
  const kind = tuple?.[2] ?? record?.kind;
  if (typeof kind !== "number" || !Number.isSafeInteger(kind)) {
    throw new BoardroomControlChainError("malformed-chain-result");
  }
  return { codeHash: checkedHash(codeHash), facet: checkedAddress(facet), kind };
}

function activeFacetRoute(value: unknown): {
  readonly codeHash: Hex;
  readonly facet: Address;
  readonly kind: number;
  readonly requiredStorageVersion: bigint;
} {
  const tuple = Array.isArray(value) ? value : undefined;
  const record =
    tuple === undefined && typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  const facet = tuple?.[0] ?? record?.facet;
  const codeHash = tuple?.[1] ?? record?.codeHash;
  const kind = tuple?.[2] ?? record?.kind;
  const requiredStorageVersion =
    tuple?.[3] ?? record?.requiredStorageVersion;
  if (
    typeof kind !== "number" ||
    !Number.isSafeInteger(kind) ||
    typeof requiredStorageVersion !== "bigint"
  ) {
    throw new BoardroomControlChainError("malformed-chain-result");
  }
  return {
    codeHash: checkedHash(codeHash),
    facet: checkedAddress(facet),
    kind,
    requiredStorageVersion
  };
}

function assertAddress(actual: unknown, expected: Address): void {
  if (checkedAddress(actual).toLowerCase() !== expected.toLowerCase()) {
    throw new BoardroomControlChainError("unsupported-release");
  }
}

function assertHash(actual: unknown, expected: string): void {
  if (checkedHash(actual).toLowerCase() !== expected.toLowerCase()) {
    throw new BoardroomControlChainError("unsupported-release");
  }
}

function requireCodeHash(code: Hex | undefined, expectedHash: string): void {
  if (code === undefined || code === "0x" || keccak256(code).toLowerCase() !== expectedHash.toLowerCase()) {
    throw new BoardroomControlChainError("unsupported-release");
  }
}

function requireMinimalProxy(code: Hex | undefined, implementation: Address): void {
  const expected =
    `0x3d3d3d3d363d3d37363d73${implementation.slice(2).toLowerCase()}5af43d3d93803e602a57fd5bf3`;
  if (code?.toLowerCase() !== expected) {
    throw new BoardroomControlChainError("unsupported-release");
  }
}

function checkedAddress(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value) || value.toLowerCase() === zeroAddress) {
    throw new BoardroomControlChainError("malformed-chain-result");
  }
  return getAddress(value);
}

function checkedOptionalAddress(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new BoardroomControlChainError("malformed-chain-result");
  }
  return getAddress(value);
}

function checkedSelector(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(value)) {
    throw new BoardroomControlChainError("malformed-chain-result");
  }
  return value as Hex;
}

function checkedHash(value: unknown): Hex {
  if (!isHash(value)) {
    throw new BoardroomControlChainError("malformed-chain-result");
  }
  return value;
}

function checkedPositiveBigInt(value: unknown): bigint {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new BoardroomControlChainError("malformed-chain-result");
  }
  return value;
}

function isAddressValue(value: unknown): value is Address {
  return typeof value === "string" && isAddress(value) && value.toLowerCase() !== zeroAddress;
}

function isHash(value: unknown): value is Hex {
  return (
    typeof value === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(value) &&
    !/^0x0{64}$/i.test(value)
  );
}

async function withFailClosedErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BoardroomControlChainError) throw error;
    throw new BoardroomControlChainError("rpc-failure");
  }
}

export function createConfiguredBoardroomControlChainReader(config: Config): BoardroomControlChainReader {
  return createBoardroomControlChainReader({ chains: config.chains });
}
