import { isAddress, keccak256, type Address, type Hex, type PublicClient } from "viem";

import {
  boardroomDiamondAbi,
  boardroomKernelAbi,
  boardroomVNextControllerAbi,
  boardroomVNextControllerFactoryAbi,
  boardroomVNextFactoryAbi,
  protocolFacetRegistryAbi,
} from "../generated";

export type BoardroomVNextFacetAttestation = {
  facetAddress: Address;
  codeHash: Hex;
  functionSelectors: readonly Hex[];
};

export type BoardroomVNextReleaseAttestation = {
  registryOwner: Address;
  facetRegistry: Address;
  facetRegistryCodeHash: Hex;
  factory: Address;
  factoryCodeHash: Hex;
  kernel: Address;
  kernelCodeHash: Hex;
  controllerFactory: Address;
  controllerFactoryCodeHash: Hex;
  controllerImplementation: Address;
  controllerImplementationCodeHash: Hex;
  legacyBoardroomLogic: Address;
  legacyBoardroomLogicCodeHash: Hex;
  governanceLogic: Address;
  governanceLogicCodeHash: Hex;
  marketLogic: Address;
  marketLogicCodeHash: Hex;
  redemptionPayoutLogic: Address;
  redemptionPayoutLogicCodeHash: Hex;
  activeFacetSetHash: Hex;
  activeRelease: bigint;
  requiredStorageVersion: bigint;
  requiredStorageLayoutHash: Hex;
  facets: readonly BoardroomVNextFacetAttestation[];
};

export type BoardroomVNextReleaseSupport = {
  supported: boolean;
  reason?: string;
};

export type BoardroomVNextControlProofClient = Pick<
  PublicClient,
  "getBlockNumber" | "getCode" | "readContract"
>;

export type BoardroomVNextControlReleaseProof = {
  blockNumber: bigint;
  facetSetHash: Hex;
  activeRelease: bigint;
  appliedStorageVersion: bigint;
  appliedStorageLayoutHash: Hex;
  migrationRequired: boolean;
  launched: boolean;
  controller: Address;
  controllerGeneration: bigint;
};

export class BoardroomVNextControlReleaseProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardroomVNextControlReleaseProofError";
  }
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;

export function boardroomVNextReleaseSupport(
  attestation: BoardroomVNextReleaseAttestation | undefined,
): BoardroomVNextReleaseSupport {
  if (!attestation) return { supported: false, reason: "The vNext release attestation is unavailable." };

  for (const [label, address] of [
    ["registry owner", attestation.registryOwner],
    ["facet registry", attestation.facetRegistry],
    ["factory", attestation.factory],
    ["kernel", attestation.kernel],
    ["controller factory", attestation.controllerFactory],
    ["controller implementation", attestation.controllerImplementation],
    ["legacy Boardroom logic", attestation.legacyBoardroomLogic],
    ["governance logic", attestation.governanceLogic],
    ["market logic", attestation.marketLogic],
    ["redemption payout logic", attestation.redemptionPayoutLogic],
  ] as const) {
    if (!isAddress(address) || address.toLowerCase() === ZERO_ADDRESS) {
      return { supported: false, reason: `The vNext ${label} address is missing or invalid.` };
    }
  }

  for (const [label, codeHash] of [
    ["facet registry", attestation.facetRegistryCodeHash],
    ["factory", attestation.factoryCodeHash],
    ["kernel", attestation.kernelCodeHash],
    ["controller factory", attestation.controllerFactoryCodeHash],
    ["controller implementation", attestation.controllerImplementationCodeHash],
    ["legacy Boardroom logic", attestation.legacyBoardroomLogicCodeHash],
    ["governance logic", attestation.governanceLogicCodeHash],
    ["market logic", attestation.marketLogicCodeHash],
    ["redemption payout logic", attestation.redemptionPayoutLogicCodeHash],
  ] as const) {
    if (!isCodeHash(codeHash)) {
      return { supported: false, reason: `The vNext ${label} code hash is missing or invalid.` };
    }
  }

  if (!isCodeHash(attestation.activeFacetSetHash)) {
    return { supported: false, reason: "The active vNext facet-set hash is missing or invalid." };
  }
  if (!isCodeHash(attestation.requiredStorageLayoutHash)) {
    return { supported: false, reason: "The active vNext storage-layout hash is missing or invalid." };
  }
  if (attestation.activeRelease <= 0n || attestation.requiredStorageVersion <= 0n) {
    return { supported: false, reason: "The active vNext release metadata is invalid." };
  }
  if (attestation.facets.length === 0) {
    return { supported: false, reason: "The active vNext facet inventory is empty." };
  }

  const addresses = new Set<string>();
  const selectors = new Set<string>();
  for (const facet of attestation.facets) {
    const addressKey = facet.facetAddress.toLowerCase();
    if (
      !isAddress(facet.facetAddress)
      || addressKey === ZERO_ADDRESS
      || addresses.has(addressKey)
      || !isCodeHash(facet.codeHash)
      || facet.functionSelectors.length === 0
    ) {
      return { supported: false, reason: "The active vNext facet inventory is malformed." };
    }
    addresses.add(addressKey);
    for (const selector of facet.functionSelectors) {
      const selectorKey = selector.toLowerCase();
      if (!/^0x[0-9a-f]{8}$/.test(selectorKey) || selectors.has(selectorKey)) {
        return { supported: false, reason: "The active vNext selector inventory is malformed." };
      }
      selectors.add(selectorKey);
    }
  }

  return { supported: true };
}

/**
 * Pins one block and proves the registry, complete facet inventory, factory/kernel
 * bindings, Boardroom migration state, and canonical controller relationship.
 */
export async function assertLiveBoardroomVNextControlRelease(
  client: BoardroomVNextControlProofClient,
  attestation: BoardroomVNextReleaseAttestation | undefined,
  boardroom: Address,
): Promise<BoardroomVNextControlReleaseProof> {
  const support = boardroomVNextReleaseSupport(attestation);
  if (!support.supported || !attestation) {
    fail(support.reason ?? "The accepted vNext Boardroom release cannot be proven.");
  }
  if (!isAddress(boardroom) || boardroom.toLowerCase() === ZERO_ADDRESS) {
    fail("The selected vNext Boardroom address is invalid.");
  }

  const blockNumber = await client.getBlockNumber();
  await Promise.all([
    assertCodeHash(
      client,
      blockNumber,
      attestation.facetRegistry,
      attestation.facetRegistryCodeHash,
      "facet registry",
    ),
    assertCodeHash(client, blockNumber, attestation.factory, attestation.factoryCodeHash, "factory"),
    assertCodeHash(client, blockNumber, attestation.kernel, attestation.kernelCodeHash, "kernel"),
    assertCodeHash(
      client,
      blockNumber,
      attestation.controllerFactory,
      attestation.controllerFactoryCodeHash,
      "controller factory",
    ),
    assertCodeHash(
      client,
      blockNumber,
      attestation.controllerImplementation,
      attestation.controllerImplementationCodeHash,
      "controller implementation",
    ),
    assertCodeHash(
      client,
      blockNumber,
      attestation.legacyBoardroomLogic,
      attestation.legacyBoardroomLogicCodeHash,
      "legacy Boardroom logic",
    ),
    assertCodeHash(
      client,
      blockNumber,
      attestation.governanceLogic,
      attestation.governanceLogicCodeHash,
      "governance logic",
    ),
    assertCodeHash(
      client,
      blockNumber,
      attestation.marketLogic,
      attestation.marketLogicCodeHash,
      "market logic",
    ),
    assertCodeHash(
      client,
      blockNumber,
      attestation.redemptionPayoutLogic,
      attestation.redemptionPayoutLogicCodeHash,
      "redemption payout logic",
    ),
    ...attestation.facets.map((facet) =>
      assertCodeHash(client, blockNumber, facet.facetAddress, facet.codeHash, "facet")
    ),
  ]);

  const [
    registryOwner,
    activeFacetSetHash,
    activeRelease,
    activeStorageVersion,
    activeStorageLayoutHash,
    liveFacets,
    factoryRegistry,
    factoryKernel,
    factoryControllerFactory,
    factoryLegacyLogic,
    factoryGovernanceLogic,
    factoryMarketLogic,
    factoryRedemptionPayoutLogic,
    kernelRegistry,
    canonicalBoardroom,
    shareToken,
    boardroomRegistry,
    boardroomFacetSetHash,
    appliedStorageVersion,
    appliedStorageLayoutHash,
    migrationRequired,
    launched,
    owner,
    controller,
    controllerGeneration,
    boardroomControllerFactory,
    boardroomGovernanceLogic,
    boardroomMarketLogic,
    boardroomRedemptionPayoutLogic,
    controllerFactoryBoardroomFactory,
    controllerImplementation,
  ] = await Promise.all([
    client.readContract({
      address: attestation.facetRegistry,
      abi: protocolFacetRegistryAbi,
      functionName: "owner",
      blockNumber,
    }),
    client.readContract({
      address: attestation.facetRegistry,
      abi: protocolFacetRegistryAbi,
      functionName: "activeFacetSetHash",
      blockNumber,
    }),
    client.readContract({
      address: attestation.facetRegistry,
      abi: protocolFacetRegistryAbi,
      functionName: "activeRelease",
      blockNumber,
    }),
    client.readContract({
      address: attestation.facetRegistry,
      abi: protocolFacetRegistryAbi,
      functionName: "activeStorageVersion",
      blockNumber,
    }),
    client.readContract({
      address: attestation.facetRegistry,
      abi: protocolFacetRegistryAbi,
      functionName: "activeStorageLayoutHash",
      blockNumber,
    }),
    client.readContract({
      address: attestation.facetRegistry,
      abi: protocolFacetRegistryAbi,
      functionName: "facets",
      blockNumber,
    }),
    client.readContract({
      address: attestation.factory,
      abi: boardroomVNextFactoryAbi,
      functionName: "facetRegistry",
      blockNumber,
    }),
    client.readContract({
      address: attestation.factory,
      abi: boardroomVNextFactoryAbi,
      functionName: "boardroomKernelLogic",
      blockNumber,
    }),
    client.readContract({
      address: attestation.factory,
      abi: boardroomVNextFactoryAbi,
      functionName: "controllerFactory",
      blockNumber,
    }),
    client.readContract({
      address: attestation.factory,
      abi: boardroomVNextFactoryAbi,
      functionName: "legacyBoardroomLogic",
      blockNumber,
    }),
    client.readContract({
      address: attestation.factory,
      abi: boardroomVNextFactoryAbi,
      functionName: "governanceLogic",
      blockNumber,
    }),
    client.readContract({
      address: attestation.factory,
      abi: boardroomVNextFactoryAbi,
      functionName: "marketLogic",
      blockNumber,
    }),
    client.readContract({
      address: attestation.factory,
      abi: boardroomVNextFactoryAbi,
      functionName: "redemptionPayoutLogic",
      blockNumber,
    }),
    client.readContract({
      address: attestation.kernel,
      abi: boardroomKernelAbi,
      functionName: "facetRegistry",
      blockNumber,
    }),
    client.readContract({
      address: attestation.factory,
      abi: boardroomVNextFactoryAbi,
      functionName: "isBoardroom",
      args: [boardroom],
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
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "launched",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "owner",
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
      functionName: "controllerGeneration",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "controllerFactory",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "governanceLogic",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "marketLogic",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "redemptionPayoutLogic",
      blockNumber,
    }),
    client.readContract({
      address: attestation.controllerFactory,
      abi: boardroomVNextControllerFactoryAbi,
      functionName: "boardroomFactory",
      blockNumber,
    }),
    client.readContract({
      address: attestation.controllerFactory,
      abi: boardroomVNextControllerFactoryAbi,
      functionName: "controllerImplementation",
      blockNumber,
    }),
  ]);

  assertAddress(registryOwner as Address, attestation.registryOwner, "registry owner");
  assertHex(activeFacetSetHash as Hex, attestation.activeFacetSetHash, "active facet-set hash");
  if ((activeRelease as bigint) !== attestation.activeRelease) fail("The active vNext release number is stale.");
  if ((activeStorageVersion as bigint) !== attestation.requiredStorageVersion) {
    fail("The active vNext storage version is stale.");
  }
  assertHex(
    activeStorageLayoutHash as Hex,
    attestation.requiredStorageLayoutHash,
    "active storage-layout hash",
  );
  assertFacetInventory(liveFacets as readonly unknown[], attestation.facets);

  assertAddress(factoryRegistry as Address, attestation.facetRegistry, "factory registry");
  assertAddress(factoryKernel as Address, attestation.kernel, "factory kernel");
  assertAddress(factoryControllerFactory as Address, attestation.controllerFactory, "factory controller factory");
  assertAddress(factoryLegacyLogic as Address, attestation.legacyBoardroomLogic, "factory legacy logic");
  assertAddress(factoryGovernanceLogic as Address, attestation.governanceLogic, "factory governance logic");
  assertAddress(factoryMarketLogic as Address, attestation.marketLogic, "factory market logic");
  assertAddress(
    factoryRedemptionPayoutLogic as Address,
    attestation.redemptionPayoutLogic,
    "factory redemption payout logic",
  );
  assertAddress(kernelRegistry as Address, attestation.facetRegistry, "kernel registry");
  assertAddress(boardroomRegistry as Address, attestation.facetRegistry, "Boardroom registry");
  assertAddress(boardroomControllerFactory as Address, attestation.controllerFactory, "Boardroom controller factory");
  assertAddress(boardroomGovernanceLogic as Address, attestation.governanceLogic, "Boardroom governance logic");
  assertAddress(boardroomMarketLogic as Address, attestation.marketLogic, "Boardroom market logic");
  assertAddress(
    boardroomRedemptionPayoutLogic as Address,
    attestation.redemptionPayoutLogic,
    "Boardroom redemption payout logic",
  );
  assertAddress(
    controllerFactoryBoardroomFactory as Address,
    attestation.factory,
    "controller-factory Boardroom factory",
  );
  assertAddress(
    controllerImplementation as Address,
    attestation.controllerImplementation,
    "controller implementation",
  );
  if (!canonicalBoardroom) fail("The selected vNext Boardroom is not canonical.");
  if (!isAddress(shareToken as Address) || (shareToken as Address).toLowerCase() === ZERO_ADDRESS) {
    fail("The selected vNext Boardroom share token is invalid.");
  }
  const [canonicalShareToken, boardroomCode, shareTokenCode] = await Promise.all([
    client.readContract({
      address: attestation.factory,
      abi: boardroomVNextFactoryAbi,
      functionName: "isShareToken",
      args: [shareToken as Address],
      blockNumber,
    }),
    client.getCode({ address: boardroom, blockNumber }),
    client.getCode({ address: shareToken as Address, blockNumber }),
  ]);
  if (!canonicalShareToken || !boardroomCode || boardroomCode === "0x" || !shareTokenCode || shareTokenCode === "0x") {
    fail("The selected vNext Boardroom or its share token has invalid code or identity.");
  }

  assertHex(boardroomFacetSetHash as Hex, attestation.activeFacetSetHash, "Boardroom facet-set hash");
  const appliedVersion = appliedStorageVersion as bigint;
  const appliedLayout = appliedStorageLayoutHash as Hex;
  const requiresMigration = migrationRequired as boolean;
  if (!requiresMigration) {
    if (appliedVersion !== attestation.requiredStorageVersion) {
      fail("The migrated vNext Boardroom storage version is stale.");
    }
    assertHex(appliedLayout, attestation.requiredStorageLayoutHash, "Boardroom storage-layout hash");
  }

  const isLaunched = launched as boolean;
  const currentController = controller as Address;
  const generation = controllerGeneration as bigint;
  if (!isLaunched) {
    if (currentController.toLowerCase() !== ZERO_ADDRESS || generation !== 0n) {
      fail("The prelaunch vNext Boardroom already reports controller state.");
    }
    if ((owner as Address).toLowerCase() === ZERO_ADDRESS) fail("The prelaunch vNext Boardroom owner is invalid.");
  } else {
    if (currentController.toLowerCase() === ZERO_ADDRESS || generation === 0n) {
      fail("The launched vNext Boardroom controller state is incomplete.");
    }
    assertAddress(owner as Address, currentController, "launched Boardroom owner");
    const [canonical, mappedBoardroom, mappedGeneration, predicted, selfFactory, selfBoardroom, selfGeneration] =
      await Promise.all([
        client.readContract({
          address: attestation.controllerFactory,
          abi: boardroomVNextControllerFactoryAbi,
          functionName: "isController",
          args: [currentController],
          blockNumber,
        }),
        client.readContract({
          address: attestation.controllerFactory,
          abi: boardroomVNextControllerFactoryAbi,
          functionName: "boardroomOfController",
          args: [currentController],
          blockNumber,
        }),
        client.readContract({
          address: attestation.controllerFactory,
          abi: boardroomVNextControllerFactoryAbi,
          functionName: "generationOfController",
          args: [currentController],
          blockNumber,
        }),
        client.readContract({
          address: attestation.controllerFactory,
          abi: boardroomVNextControllerFactoryAbi,
          functionName: "predictControllerAddress",
          args: [boardroom, generation],
          blockNumber,
        }),
        client.readContract({
          address: currentController,
          abi: boardroomVNextControllerAbi,
          functionName: "factory",
          blockNumber,
        }),
        client.readContract({
          address: currentController,
          abi: boardroomVNextControllerAbi,
          functionName: "boardroom",
          blockNumber,
        }),
        client.readContract({
          address: currentController,
          abi: boardroomVNextControllerAbi,
          functionName: "generation",
          blockNumber,
        }),
      ]);
    if (!canonical) fail("The launched vNext controller is not canonical.");
    assertAddress(mappedBoardroom as Address, boardroom, "controller-factory Boardroom binding");
    if ((mappedGeneration as bigint) !== generation) fail("The controller-factory generation is stale.");
    assertAddress(predicted as Address, currentController, "deterministic controller address");
    assertAddress(selfFactory as Address, attestation.controllerFactory, "controller factory");
    assertAddress(selfBoardroom as Address, boardroom, "controller Boardroom");
    if ((selfGeneration as bigint) !== generation) fail("The controller generation is stale.");
    const controllerCode = await client.getCode({ address: currentController, blockNumber });
    if (!controllerCode || controllerCode === "0x") fail("The launched vNext controller has no code.");
  }

  return {
    blockNumber,
    facetSetHash: boardroomFacetSetHash as Hex,
    activeRelease: activeRelease as bigint,
    appliedStorageVersion: appliedVersion,
    appliedStorageLayoutHash: appliedLayout,
    migrationRequired: requiresMigration,
    launched: isLaunched,
    controller: currentController,
    controllerGeneration: generation,
  };
}

function assertFacetInventory(
  live: readonly unknown[],
  expected: readonly BoardroomVNextFacetAttestation[],
): void {
  const normalize = (entry: unknown): { facetAddress: Address; functionSelectors: readonly Hex[] } => {
    if (Array.isArray(entry)) {
      return { facetAddress: entry[0] as Address, functionSelectors: entry[1] as readonly Hex[] };
    }
    const value = entry as { facetAddress: Address; functionSelectors: readonly Hex[] };
    return { facetAddress: value.facetAddress, functionSelectors: value.functionSelectors };
  };
  const liveNormalized = live.map(normalize).sort((left, right) =>
    left.facetAddress.toLowerCase().localeCompare(right.facetAddress.toLowerCase())
  );
  const expectedNormalized = [...expected].sort((left, right) =>
    left.facetAddress.toLowerCase().localeCompare(right.facetAddress.toLowerCase())
  );
  if (liveNormalized.length !== expectedNormalized.length) fail("The live vNext facet inventory is incomplete.");
  for (let i = 0; i < liveNormalized.length; ++i) {
    const actual = liveNormalized[i]!;
    const attested = expectedNormalized[i]!;
    assertAddress(actual.facetAddress, attested.facetAddress, "facet inventory address");
    const actualSelectors = actual.functionSelectors.map((selector) => selector.toLowerCase());
    const expectedSelectors = attested.functionSelectors.map((selector) => selector.toLowerCase());
    if (
      actualSelectors.length !== expectedSelectors.length
      || actualSelectors.some((selector, index) => selector !== expectedSelectors[index])
    ) {
      fail(`The live selector inventory for ${attested.facetAddress} is stale.`);
    }
  }
}

async function assertCodeHash(
  client: BoardroomVNextControlProofClient,
  blockNumber: bigint,
  address: Address,
  expected: Hex,
  label: string,
): Promise<void> {
  const code = await client.getCode({ address, blockNumber });
  if (!code || code === "0x" || keccak256(code).toLowerCase() !== expected.toLowerCase()) {
    fail(`The live vNext ${label} code hash does not match the attestation.`);
  }
}

function isCodeHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) && !/^0x0{64}$/i.test(value);
}

function assertAddress(actual: Address, expected: Address, label: string): void {
  if (!isAddress(actual) || actual.toLowerCase() !== expected.toLowerCase()) {
    fail(`The live vNext ${label} does not match the attestation.`);
  }
}

function assertHex(actual: Hex, expected: Hex, label: string): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    fail(`The live vNext ${label} does not match the attestation.`);
  }
}

function fail(message: string): never {
  throw new BoardroomVNextControlReleaseProofError(message);
}
