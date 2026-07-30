import { isAddress, keccak256, type Address, type Hex, type PublicClient } from "viem";

import {
  boardroomAbi,
  boardroomKernelAbi,
  boardroomControllerAbi,
  boardroomControllerFactoryAbi,
  boardroomFactoryAbi,
  protocolFacetRegistryAbi,
  type PledgeCashDeployment,
} from "../generated";

export type BoardroomFacetAttestation = {
  role:
    | "authority"
    | "execution"
    | "market"
    | "redemption"
    | "view"
    | "migration"
    | "view-v2";
  facetAddress: Address;
  codeHash: Hex;
  required: boolean;
};

export type BoardroomReleaseAttestation = {
  protocolVersion: string;
  protocolReleaseCodeHash: Hex;
  protocolFacetRegistry: Address;
  protocolFacetRegistryCodeHash: Hex;
  boardroomFactory: Address;
  boardroomFactoryCodeHash: Hex;
  boardroomKernel: Address;
  boardroomKernelCodeHash: Hex;
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
  kernelSelectorSetHash: Hex;
  /** Genesis-only evidence. The live owner may change through protocol governance. */
  protocolFacetRegistryOwner?: Address;
  /** Optional genesis-release evidence; runtime proofs derive these values from the registry. */
  activeFacetSetHash?: Hex;
  activeRelease?: bigint;
  requiredStorageVersion?: bigint;
  requiredStorageLayoutHash?: Hex;
  manifestHash?: Hex;
  selectorCount?: bigint;
  facets: readonly BoardroomFacetAttestation[];
};

export type BoardroomReleaseSupport = {
  supported: boolean;
  reason?: string;
};

export type BoardroomControlProofClient = Pick<
  PublicClient,
  "getBlockNumber" | "getBlock" | "getCode" | "readContract"
>;

export type BoardroomControlReleaseProof = {
  blockNumber: bigint;
  blockHash: Hex;
  facetSetHash: Hex;
  activeRelease: bigint;
  appliedStorageVersion: bigint;
  appliedStorageLayoutHash: Hex;
  migrationRequired: boolean;
  launched: boolean;
  controller: Address;
  controllerGeneration: bigint;
};

export type BoardroomLiveFacetRoute = {
  selector: Hex;
  facet: Address;
  codeHash: Hex;
  kind: 0 | 1 | 2;
};

export type BoardroomLiveReleaseProof = {
  blockNumber: bigint;
  blockHash: Hex;
  registryOwner: Address;
  facetSetHash: Hex;
  activeRelease: bigint;
  requiredStorageVersion: bigint;
  requiredStorageLayoutHash: Hex;
  predecessorFacetSetHash: Hex;
  manifestHash: Hex;
  migrationFacet: Address;
  migrationSelector: Hex;
  selectorCount: bigint;
  routes: readonly BoardroomLiveFacetRoute[];
};

export class BoardroomControlReleaseProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardroomControlReleaseProofError";
  }
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;

const baseFacetFields = [
  ["authority", "authorityFacet", "authorityFacetCodeHash"],
  ["execution", "executionFacet", "executionFacetCodeHash"],
  ["market", "marketFacet", "marketFacetCodeHash"],
  ["redemption", "redemptionFacet", "redemptionFacetCodeHash"],
  ["view", "viewFacet", "viewFacetCodeHash"],
] as const;

const optionalFacetFields = [
  ["migration", "boardroomReleaseBMigrationFacet", "boardroomReleaseBMigrationFacetCodeHash"],
  ["view-v2", "boardroomViewFacetV2", "boardroomViewFacetV2CodeHash"],
] as const;

/**
 * Normalizes the flat canonical deployment artifact into the exact proof
 * inputs. Optional future-release facets are admitted only as complete
 * address/code-hash pairs; the live registry decides whether they are active.
 */
export function boardroomReleaseAttestationFromDeployment(
  deployment: PledgeCashDeployment | undefined,
): BoardroomReleaseAttestation | undefined {
  if (!deployment) return undefined;
  const required = [
    deployment.protocolVersion,
    deployment.protocolReleaseCodeHash,
    deployment.protocolFacetRegistry,
    deployment.protocolFacetRegistryCodeHash,
    deployment.boardroomFactory,
    deployment.boardroomFactoryCodeHash,
    deployment.boardroomKernel,
    deployment.boardroomKernelCodeHash,
    deployment.boardroomControllerFactory,
    deployment.boardroomControllerFactoryCodeHash,
    deployment.boardroomControllerLogic,
    deployment.boardroomControllerLogicCodeHash,
    deployment.boardroomGovernanceLogic,
    deployment.boardroomGovernanceLogicCodeHash,
    deployment.boardroomMarketLogic,
    deployment.boardroomMarketLogicCodeHash,
    deployment.boardroomRedemptionPayout,
    deployment.boardroomRedemptionPayoutCodeHash,
    deployment.kernelSelectorSetHash,
  ];
  if (required.some((value) => value === undefined)) return undefined;

  const facets: BoardroomFacetAttestation[] = [];
  for (const [role, addressField, codeHashField] of [...baseFacetFields, ...optionalFacetFields]) {
    const facetAddress = deployment[addressField];
    const codeHash = deployment[codeHashField];
    if (facetAddress !== undefined && codeHash !== undefined) {
      facets.push({
        role,
        facetAddress,
        codeHash: codeHash as Hex,
        required: baseFacetFields.some(([baseRole]) => baseRole === role),
      });
    }
  }

  const attestation: BoardroomReleaseAttestation = {
    protocolVersion: deployment.protocolVersion!,
    protocolReleaseCodeHash: deployment.protocolReleaseCodeHash as Hex,
    protocolFacetRegistry: deployment.protocolFacetRegistry!,
    protocolFacetRegistryCodeHash: deployment.protocolFacetRegistryCodeHash as Hex,
    boardroomFactory: deployment.boardroomFactory!,
    boardroomFactoryCodeHash: deployment.boardroomFactoryCodeHash as Hex,
    boardroomKernel: deployment.boardroomKernel!,
    boardroomKernelCodeHash: deployment.boardroomKernelCodeHash as Hex,
    boardroomControllerFactory: deployment.boardroomControllerFactory!,
    boardroomControllerFactoryCodeHash: deployment.boardroomControllerFactoryCodeHash as Hex,
    boardroomControllerLogic: deployment.boardroomControllerLogic!,
    boardroomControllerLogicCodeHash: deployment.boardroomControllerLogicCodeHash as Hex,
    boardroomGovernanceLogic: deployment.boardroomGovernanceLogic!,
    boardroomGovernanceLogicCodeHash: deployment.boardroomGovernanceLogicCodeHash as Hex,
    boardroomMarketLogic: deployment.boardroomMarketLogic!,
    boardroomMarketLogicCodeHash: deployment.boardroomMarketLogicCodeHash as Hex,
    boardroomRedemptionPayout: deployment.boardroomRedemptionPayout!,
    boardroomRedemptionPayoutCodeHash: deployment.boardroomRedemptionPayoutCodeHash as Hex,
    kernelSelectorSetHash: deployment.kernelSelectorSetHash as Hex,
    facets,
  };
  if (deployment.protocolFacetRegistryOwner !== undefined) {
    attestation.protocolFacetRegistryOwner = deployment.protocolFacetRegistryOwner;
  }
  if (deployment.activeFacetSetHash !== undefined) {
    attestation.activeFacetSetHash = deployment.activeFacetSetHash as Hex;
  }
  if (deployment.activeRelease !== undefined) attestation.activeRelease = deployment.activeRelease;
  if (deployment.requiredStorageVersion !== undefined) {
    attestation.requiredStorageVersion = deployment.requiredStorageVersion;
  }
  if (deployment.requiredStorageLayoutHash !== undefined) {
    attestation.requiredStorageLayoutHash = deployment.requiredStorageLayoutHash as Hex;
  }
  if (deployment.manifestHash !== undefined) attestation.manifestHash = deployment.manifestHash as Hex;
  if (deployment.selectorCount !== undefined) attestation.selectorCount = deployment.selectorCount;
  return attestation;
}

export function boardroomReleaseSupport(
  deployment: PledgeCashDeployment | undefined,
): BoardroomReleaseSupport {
  const attestation = boardroomReleaseAttestationFromDeployment(deployment);
  if (!attestation) {
    return { supported: false, reason: "The deployment is missing canonical Boardroom release evidence." };
  }

  for (const [label, address] of [
    ["facet registry", attestation.protocolFacetRegistry],
    ["factory", attestation.boardroomFactory],
    ["kernel", attestation.boardroomKernel],
    ["controller factory", attestation.boardroomControllerFactory],
    ["controller implementation", attestation.boardroomControllerLogic],
    ["governance logic", attestation.boardroomGovernanceLogic],
    ["market logic", attestation.boardroomMarketLogic],
    ["redemption payout logic", attestation.boardroomRedemptionPayout],
  ] as const) {
    if (!isAddress(address) || address.toLowerCase() === ZERO_ADDRESS) {
      return { supported: false, reason: `The ${label} address is missing or invalid.` };
    }
  }

  for (const [label, codeHash] of [
    ["protocol release", attestation.protocolReleaseCodeHash],
    ["facet registry", attestation.protocolFacetRegistryCodeHash],
    ["factory", attestation.boardroomFactoryCodeHash],
    ["kernel", attestation.boardroomKernelCodeHash],
    ["controller factory", attestation.boardroomControllerFactoryCodeHash],
    ["controller implementation", attestation.boardroomControllerLogicCodeHash],
    ["governance logic", attestation.boardroomGovernanceLogicCodeHash],
    ["market logic", attestation.boardroomMarketLogicCodeHash],
    ["redemption payout logic", attestation.boardroomRedemptionPayoutCodeHash],
  ] as const) {
    if (!isCodeHash(codeHash)) {
      return { supported: false, reason: `The ${label} code hash is missing or invalid.` };
    }
  }

  if (!isCodeHash(attestation.kernelSelectorSetHash)) {
    return { supported: false, reason: "The kernel selector-set evidence is missing or invalid." };
  }
  if (attestation.protocolVersion.length === 0) {
    return { supported: false, reason: "The protocol version is invalid." };
  }

  return { supported: true };
}

/**
 * Authenticates the registry's currently active release at one pinned block.
 *
 * Release metadata and facets deliberately come from the code-attested registry,
 * not from release-A deployment fields. This allows protocol governance to
 * activate any valid higher release without invalidating permanent deployment
 * provenance.
 */
export async function assertLiveProtocolFacetRelease(
  client: BoardroomControlProofClient,
  deployment: PledgeCashDeployment | undefined,
): Promise<BoardroomLiveReleaseProof> {
  const support = boardroomReleaseSupport(deployment);
  const attestation = boardroomReleaseAttestationFromDeployment(deployment);
  if (!support.supported || !attestation) {
    fail(support.reason ?? "The accepted Boardroom deployment cannot be proven.");
  }
  const pin = await pinProofBlock(client);
  const proof = await assertLiveProtocolFacetReleaseAtBlock(client, attestation, pin);
  await assertProofBlockUnchanged(client, pin);
  return proof;
}

/**
 * Pins one block and proves the dynamic registry release, permanent
 * factory/kernel bindings, Boardroom migration state, and controller identity.
 */
export async function assertLiveBoardroomControlRelease(
  client: BoardroomControlProofClient,
  deployment: PledgeCashDeployment | undefined,
  boardroom: Address,
): Promise<BoardroomControlReleaseProof> {
  const support = boardroomReleaseSupport(deployment);
  const attestation = boardroomReleaseAttestationFromDeployment(deployment);
  if (!support.supported || !attestation) {
    fail(support.reason ?? "The accepted Boardroom deployment cannot be proven.");
  }
  if (!isAddress(boardroom) || boardroom.toLowerCase() === ZERO_ADDRESS) {
    fail("The selected Boardroom address is invalid.");
  }

  const pin = await pinProofBlock(client);
  const { blockNumber } = pin;
  const liveRelease = await assertLiveProtocolFacetReleaseAtBlock(client, attestation, pin);
  const [
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
  ] = await Promise.all([
    client.readContract({
      address: attestation.boardroomFactory,
      abi: boardroomFactoryAbi,
      functionName: "isBoardroom",
      args: [boardroom],
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "shareToken",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "facetRegistry",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "facetSetHash",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "appliedStorageVersion",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "appliedStorageLayoutHash",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "migrationRequired",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "launched",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "owner",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "controller",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "controllerGeneration",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "controllerFactory",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "governanceLogic",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "marketLogic",
      blockNumber,
    }),
    client.readContract({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "redemptionPayoutLogic",
      blockNumber,
    }),
  ]);

  assertAddress(boardroomRegistry as Address, attestation.protocolFacetRegistry, "Boardroom registry");
  assertAddress(boardroomControllerFactory as Address, attestation.boardroomControllerFactory, "Boardroom controller factory");
  assertAddress(boardroomGovernanceLogic as Address, attestation.boardroomGovernanceLogic, "Boardroom governance logic");
  assertAddress(boardroomMarketLogic as Address, attestation.boardroomMarketLogic, "Boardroom market logic");
  assertAddress(
    boardroomRedemptionPayoutLogic as Address,
    attestation.boardroomRedemptionPayout,
    "Boardroom redemption payout logic",
  );
  if (!canonicalBoardroom) fail("The selected Boardroom is not canonical.");
  if (!isAddress(shareToken as Address) || (shareToken as Address).toLowerCase() === ZERO_ADDRESS) {
    fail("The selected Boardroom share token is invalid.");
  }
  const [canonicalShareToken, boardroomCode, shareTokenCode] = await Promise.all([
    client.readContract({
      address: attestation.boardroomFactory,
      abi: boardroomFactoryAbi,
      functionName: "isShareToken",
      args: [shareToken as Address],
      blockNumber,
    }),
    client.getCode({ address: boardroom, blockNumber }),
    client.getCode({ address: shareToken as Address, blockNumber }),
  ]);
  if (!canonicalShareToken || !boardroomCode || boardroomCode === "0x" || !shareTokenCode || shareTokenCode === "0x") {
    fail("The selected Boardroom or its share token has invalid code or identity.");
  }

  assertHex(boardroomFacetSetHash as Hex, liveRelease.facetSetHash, "Boardroom facet-set hash");
  const appliedVersion = appliedStorageVersion as bigint;
  const appliedLayout = appliedStorageLayoutHash as Hex;
  const requiresMigration = migrationRequired as boolean;
  if (!requiresMigration) {
    if (appliedVersion !== liveRelease.requiredStorageVersion) {
      fail("The migrated Boardroom storage version does not match the active release.");
    }
    assertHex(
      appliedLayout,
      liveRelease.requiredStorageLayoutHash,
      "Boardroom storage-layout hash",
    );
  }

  const isLaunched = launched as boolean;
  const currentController = controller as Address;
  const generation = controllerGeneration as bigint;
  if (!isLaunched) {
    if (currentController.toLowerCase() !== ZERO_ADDRESS || generation !== 0n) {
      fail("The prelaunch Boardroom already reports controller state.");
    }
    if ((owner as Address).toLowerCase() === ZERO_ADDRESS) fail("The prelaunch Boardroom owner is invalid.");
  } else {
    if (currentController.toLowerCase() === ZERO_ADDRESS || generation === 0n) {
      fail("The launched Boardroom controller state is incomplete.");
    }
    assertAddress(owner as Address, currentController, "launched Boardroom owner");
    const [canonical, mappedBoardroom, mappedGeneration, predicted, selfFactory, selfBoardroom, selfGeneration] =
      await Promise.all([
        client.readContract({
          address: attestation.boardroomControllerFactory,
          abi: boardroomControllerFactoryAbi,
          functionName: "isController",
          args: [currentController],
          blockNumber,
        }),
        client.readContract({
          address: attestation.boardroomControllerFactory,
          abi: boardroomControllerFactoryAbi,
          functionName: "boardroomOfController",
          args: [currentController],
          blockNumber,
        }),
        client.readContract({
          address: attestation.boardroomControllerFactory,
          abi: boardroomControllerFactoryAbi,
          functionName: "generationOfController",
          args: [currentController],
          blockNumber,
        }),
        client.readContract({
          address: attestation.boardroomControllerFactory,
          abi: boardroomControllerFactoryAbi,
          functionName: "predictControllerAddress",
          args: [boardroom, generation],
          blockNumber,
        }),
        client.readContract({
          address: currentController,
          abi: boardroomControllerAbi,
          functionName: "factory",
          blockNumber,
        }),
        client.readContract({
          address: currentController,
          abi: boardroomControllerAbi,
          functionName: "boardroom",
          blockNumber,
        }),
        client.readContract({
          address: currentController,
          abi: boardroomControllerAbi,
          functionName: "generation",
          blockNumber,
        }),
      ]);
    if (!canonical) fail("The launched controller is not canonical.");
    assertAddress(mappedBoardroom as Address, boardroom, "controller-factory Boardroom binding");
    if ((mappedGeneration as bigint) !== generation) fail("The controller-factory generation is stale.");
    assertAddress(predicted as Address, currentController, "deterministic controller address");
    assertAddress(selfFactory as Address, attestation.boardroomControllerFactory, "controller factory");
    assertAddress(selfBoardroom as Address, boardroom, "controller Boardroom");
    if ((selfGeneration as bigint) !== generation) fail("The controller generation is stale.");
    const controllerCode = await client.getCode({ address: currentController, blockNumber });
    if (!controllerCode || controllerCode === "0x") fail("The launched controller has no code.");
  }

  const proof: BoardroomControlReleaseProof = {
    blockNumber,
    blockHash: pin.blockHash,
    facetSetHash: liveRelease.facetSetHash,
    activeRelease: liveRelease.activeRelease,
    appliedStorageVersion: appliedVersion,
    appliedStorageLayoutHash: appliedLayout,
    migrationRequired: requiresMigration,
    launched: isLaunched,
    controller: currentController,
    controllerGeneration: generation,
  };
  await assertProofBlockUnchanged(client, pin);
  return proof;
}

async function assertLiveProtocolFacetReleaseAtBlock(
  client: BoardroomControlProofClient,
  attestation: BoardroomReleaseAttestation,
  pin: ProofBlockPin,
): Promise<BoardroomLiveReleaseProof> {
  const { blockNumber, blockHash } = pin;
  const registryOwner = await assertPermanentProtocolBindings(client, attestation, blockNumber);
  const [activeFacetSetHash, activeRelease, activeStorageVersion, activeStorageLayoutHash] =
    await Promise.all([
      client.readContract({
        address: attestation.protocolFacetRegistry,
        abi: protocolFacetRegistryAbi,
        functionName: "activeFacetSetHash",
        blockNumber,
      }),
      client.readContract({
        address: attestation.protocolFacetRegistry,
        abi: protocolFacetRegistryAbi,
        functionName: "activeRelease",
        blockNumber,
      }),
      client.readContract({
        address: attestation.protocolFacetRegistry,
        abi: protocolFacetRegistryAbi,
        functionName: "activeStorageVersion",
        blockNumber,
      }),
      client.readContract({
        address: attestation.protocolFacetRegistry,
        abi: protocolFacetRegistryAbi,
        functionName: "activeStorageLayoutHash",
        blockNumber,
      }),
    ]);

  const facetSetHash = activeFacetSetHash as Hex;
  const release = activeRelease as bigint;
  const storageVersion = activeStorageVersion as bigint;
  const storageLayoutHash = activeStorageLayoutHash as Hex;
  if (!isCodeHash(facetSetHash) || release <= 0n || !isCodeHash(storageLayoutHash)) {
    fail("The registry does not report a valid active release.");
  }

  const [publishedFlag, releaseHash, metadata, selectorsValue, facetsValue, facetAddressesValue, activeMigration] =
    await Promise.all([
      client.readContract({
        address: attestation.protocolFacetRegistry,
        abi: protocolFacetRegistryAbi,
        functionName: "isFacetSetPublished",
        args: [facetSetHash],
        blockNumber,
      }),
      client.readContract({
        address: attestation.protocolFacetRegistry,
        abi: protocolFacetRegistryAbi,
        functionName: "facetSetHashForRelease",
        args: [release],
        blockNumber,
      }),
      client.readContract({
        address: attestation.protocolFacetRegistry,
        abi: protocolFacetRegistryAbi,
        functionName: "facetSetMetadata",
        args: [facetSetHash],
        blockNumber,
      }),
      client.readContract({
        address: attestation.protocolFacetRegistry,
        abi: protocolFacetRegistryAbi,
        functionName: "facetSetSelectors",
        args: [facetSetHash],
        blockNumber,
      }),
      client.readContract({
        address: attestation.protocolFacetRegistry,
        abi: protocolFacetRegistryAbi,
        functionName: "facets",
        blockNumber,
      }),
      client.readContract({
        address: attestation.protocolFacetRegistry,
        abi: protocolFacetRegistryAbi,
        functionName: "facetAddresses",
        blockNumber,
      }),
      client.readContract({
        address: attestation.protocolFacetRegistry,
        abi: protocolFacetRegistryAbi,
        functionName: "activeMigration",
        blockNumber,
      }),
    ]);
  const [
    metadataPublished,
    metadataRelease,
    metadataStorageVersion,
    predecessorFacetSetHash,
    metadataStorageLayoutHash,
    manifestHash,
    migrationFacet,
    migrationSelector,
    selectorCount,
  ] = metadata as readonly [boolean, bigint, bigint, Hex, Hex, Hex, Address, Hex, bigint];
  if (!publishedFlag || !metadataPublished) fail("The active facet set is not published.");
  assertHex(releaseHash as Hex, facetSetHash, "release-to-facet-set binding");
  if (metadataRelease !== release) fail("The active and published release numbers do not match.");
  if (metadataStorageVersion !== storageVersion) {
    fail("The active and published storage versions do not match.");
  }
  assertHex(
    metadataStorageLayoutHash,
    storageLayoutHash,
    "active and published storage-layout hash",
  );
  if (!isBytes32(predecessorFacetSetHash) || !isCodeHash(manifestHash)) {
    fail("The active release metadata contains an invalid hash.");
  }

  const [activeMigrationFacet, activeMigrationSelector] =
    activeMigration as readonly [Address, Hex];
  assertAddressOrZero(activeMigrationFacet, migrationFacet, "active migration facet");
  assertSelector(activeMigrationSelector, migrationSelector, "active migration selector");

  const selectors = selectorsValue as readonly Hex[];
  assertStrictSelectorOrder(selectors, selectorCount);
  const routeRows = await Promise.all(
    selectors.map(async (selector) => {
      const [stored, active, loupeFacet] = await Promise.all([
        client.readContract({
          address: attestation.protocolFacetRegistry,
          abi: protocolFacetRegistryAbi,
          functionName: "facetSetRoute",
          args: [facetSetHash, selector],
          blockNumber,
        }),
        client.readContract({
          address: attestation.protocolFacetRegistry,
          abi: protocolFacetRegistryAbi,
          functionName: "route",
          args: [selector],
          blockNumber,
        }),
        client.readContract({
          address: attestation.protocolFacetRegistry,
          abi: protocolFacetRegistryAbi,
          functionName: "facetAddress",
          args: [selector],
          blockNumber,
        }),
      ]);
      const [facet, codeHash, kindValue] = stored as readonly [Address, Hex, number];
      const [activeFacet, activeCodeHash, activeKindValue, requiredStorageVersion] =
        active as readonly [Address, Hex, number, bigint];
      const kind = Number(kindValue);
      if (
        !isAddress(facet)
        || facet.toLowerCase() === ZERO_ADDRESS
        || !isCodeHash(codeHash)
        || !isRouteKind(kind)
      ) {
        fail(`The published route for ${selector} is malformed.`);
      }
      assertAddress(activeFacet, facet, `active route ${selector} facet`);
      assertHex(activeCodeHash, codeHash, `active route ${selector} code hash`);
      if (Number(activeKindValue) !== kind) fail(`The active route ${selector} kind is stale.`);
      if (requiredStorageVersion !== storageVersion) {
        fail(`The active route ${selector} storage version is stale.`);
      }
      assertAddress(loupeFacet as Address, facet, `selector loupe ${selector}`);
      return { selector, facet, codeHash, kind: kind as 0 | 1 | 2 };
    }),
  );
  const recomputedFacetSetHash = await client.readContract({
    address: attestation.protocolFacetRegistry,
    abi: protocolFacetRegistryAbi,
    functionName: "computeFacetSetHash",
    args: [{
      release,
      requiredStorageVersion: storageVersion,
      predecessorFacetSetHash,
      storageLayoutHash,
      manifestHash,
      routes: routeRows,
      migrationFacet,
      migrationSelector,
    }],
    blockNumber,
  });
  assertHex(recomputedFacetSetHash as Hex, facetSetHash, "canonical facet-set hash");

  assertMigrationRoute(routeRows, migrationFacet, migrationSelector);
  const expectedFacets = groupRoutesByFacet(routeRows);
  await assertLoupeInventory(
    client,
    attestation.protocolFacetRegistry,
    blockNumber,
    facetsValue as readonly unknown[],
    facetAddressesValue as readonly Address[],
    expectedFacets,
  );
  await Promise.all(
    expectedFacets.map((facet) =>
      assertCodeHash(client, blockNumber, facet.facetAddress, facet.codeHash, "active facet")
    ),
  );

  return {
    blockNumber,
    blockHash,
    registryOwner,
    facetSetHash,
    activeRelease: release,
    requiredStorageVersion: storageVersion,
    requiredStorageLayoutHash: storageLayoutHash,
    predecessorFacetSetHash,
    manifestHash,
    migrationFacet,
    migrationSelector,
    selectorCount,
    routes: routeRows,
  };
}

async function assertPermanentProtocolBindings(
  client: BoardroomControlProofClient,
  attestation: BoardroomReleaseAttestation,
  blockNumber: bigint,
): Promise<Address> {
  await Promise.all([
    assertCodeHash(
      client,
      blockNumber,
      attestation.protocolFacetRegistry,
      attestation.protocolFacetRegistryCodeHash,
      "facet registry",
    ),
    assertCodeHash(client, blockNumber, attestation.boardroomFactory, attestation.boardroomFactoryCodeHash, "factory"),
    assertCodeHash(client, blockNumber, attestation.boardroomKernel, attestation.boardroomKernelCodeHash, "kernel"),
    assertCodeHash(
      client,
      blockNumber,
      attestation.boardroomControllerFactory,
      attestation.boardroomControllerFactoryCodeHash,
      "controller factory",
    ),
    assertCodeHash(
      client,
      blockNumber,
      attestation.boardroomControllerLogic,
      attestation.boardroomControllerLogicCodeHash,
      "controller implementation",
    ),
    assertCodeHash(
      client,
      blockNumber,
      attestation.boardroomGovernanceLogic,
      attestation.boardroomGovernanceLogicCodeHash,
      "governance logic",
    ),
    assertCodeHash(
      client,
      blockNumber,
      attestation.boardroomMarketLogic,
      attestation.boardroomMarketLogicCodeHash,
      "market logic",
    ),
    assertCodeHash(
      client,
      blockNumber,
      attestation.boardroomRedemptionPayout,
      attestation.boardroomRedemptionPayoutCodeHash,
      "redemption payout logic",
    ),
  ]);

  const [
    registryOwner,
    registryKernelSelectorSetHash,
    factoryRegistry,
    factoryKernel,
    factoryControllerFactory,
    factoryGovernanceLogic,
    factoryMarketLogic,
    factoryRedemptionPayoutLogic,
    kernelRegistry,
    kernelSelectorSetHash,
    controllerFactoryBoardroomFactory,
    controllerImplementation,
  ] = await Promise.all([
    client.readContract({
      address: attestation.protocolFacetRegistry,
      abi: protocolFacetRegistryAbi,
      functionName: "owner",
      blockNumber,
    }),
    client.readContract({
      address: attestation.protocolFacetRegistry,
      abi: protocolFacetRegistryAbi,
      functionName: "kernelSelectorSetHash",
      blockNumber,
    }),
    client.readContract({
      address: attestation.boardroomFactory,
      abi: boardroomFactoryAbi,
      functionName: "facetRegistry",
      blockNumber,
    }),
    client.readContract({
      address: attestation.boardroomFactory,
      abi: boardroomFactoryAbi,
      functionName: "boardroomKernelLogic",
      blockNumber,
    }),
    client.readContract({
      address: attestation.boardroomFactory,
      abi: boardroomFactoryAbi,
      functionName: "controllerFactory",
      blockNumber,
    }),
    client.readContract({
      address: attestation.boardroomFactory,
      abi: boardroomFactoryAbi,
      functionName: "governanceLogic",
      blockNumber,
    }),
    client.readContract({
      address: attestation.boardroomFactory,
      abi: boardroomFactoryAbi,
      functionName: "marketLogic",
      blockNumber,
    }),
    client.readContract({
      address: attestation.boardroomFactory,
      abi: boardroomFactoryAbi,
      functionName: "redemptionPayoutLogic",
      blockNumber,
    }),
    client.readContract({
      address: attestation.boardroomKernel,
      abi: boardroomKernelAbi,
      functionName: "facetRegistry",
      blockNumber,
    }),
    client.readContract({
      address: attestation.boardroomKernel,
      abi: boardroomKernelAbi,
      functionName: "kernelSelectorSetHash",
      blockNumber,
    }),
    client.readContract({
      address: attestation.boardroomControllerFactory,
      abi: boardroomControllerFactoryAbi,
      functionName: "boardroomFactory",
      blockNumber,
    }),
    client.readContract({
      address: attestation.boardroomControllerFactory,
      abi: boardroomControllerFactoryAbi,
      functionName: "controllerImplementation",
      blockNumber,
    }),
  ]);
  if (!isAddress(registryOwner as Address) || (registryOwner as Address).toLowerCase() === ZERO_ADDRESS) {
    fail("The live registry owner is missing or invalid.");
  }
  assertHex(
    registryKernelSelectorSetHash as Hex,
    attestation.kernelSelectorSetHash,
    "registry kernel-selector-set hash",
  );
  assertHex(
    kernelSelectorSetHash as Hex,
    attestation.kernelSelectorSetHash,
    "kernel selector-set hash",
  );
  assertAddress(factoryRegistry as Address, attestation.protocolFacetRegistry, "factory registry");
  assertAddress(factoryKernel as Address, attestation.boardroomKernel, "factory kernel");
  assertAddress(factoryControllerFactory as Address, attestation.boardroomControllerFactory, "factory controller factory");
  assertAddress(factoryGovernanceLogic as Address, attestation.boardroomGovernanceLogic, "factory governance logic");
  assertAddress(factoryMarketLogic as Address, attestation.boardroomMarketLogic, "factory market logic");
  assertAddress(
    factoryRedemptionPayoutLogic as Address,
    attestation.boardroomRedemptionPayout,
    "factory redemption payout logic",
  );
  assertAddress(kernelRegistry as Address, attestation.protocolFacetRegistry, "kernel registry");
  assertAddress(
    controllerFactoryBoardroomFactory as Address,
    attestation.boardroomFactory,
    "controller-factory Boardroom factory",
  );
  assertAddress(
    controllerImplementation as Address,
    attestation.boardroomControllerLogic,
    "controller implementation",
  );
  return registryOwner as Address;
}

type ProofBlockPin = {
  blockNumber: bigint;
  blockHash: Hex;
};

async function pinProofBlock(client: BoardroomControlProofClient): Promise<ProofBlockPin> {
  const blockNumber = await client.getBlockNumber();
  const block = await client.getBlock({ blockNumber });
  if (block.number !== blockNumber || !isCodeHash(block.hash)) {
    fail("The proof block could not be pinned to a canonical hash.");
  }
  return { blockNumber, blockHash: block.hash };
}

async function assertProofBlockUnchanged(
  client: BoardroomControlProofClient,
  pin: ProofBlockPin,
): Promise<void> {
  const block = await client.getBlock({ blockNumber: pin.blockNumber });
  if (
    block.number !== pin.blockNumber
    || !isCodeHash(block.hash)
    || block.hash.toLowerCase() !== pin.blockHash.toLowerCase()
  ) {
    fail("The pinned proof block changed while the release proof was being assembled.");
  }
}

type GroupedFacetRoutes = {
  facetAddress: Address;
  codeHash: Hex;
  functionSelectors: Hex[];
};

function groupRoutesByFacet(routes: readonly BoardroomLiveFacetRoute[]): GroupedFacetRoutes[] {
  const byAddress = new Map<string, GroupedFacetRoutes>();
  for (const route of routes) {
    const key = route.facet.toLowerCase();
    const existing = byAddress.get(key);
    if (existing) {
      assertHex(route.codeHash, existing.codeHash, `facet ${route.facet} route code hash`);
      existing.functionSelectors.push(route.selector);
    } else {
      byAddress.set(key, {
        facetAddress: route.facet,
        codeHash: route.codeHash,
        functionSelectors: [route.selector],
      });
    }
  }
  return [...byAddress.values()];
}

async function assertLoupeInventory(
  client: BoardroomControlProofClient,
  registry: Address,
  blockNumber: bigint,
  facetsValue: readonly unknown[],
  facetAddresses: readonly Address[],
  expected: readonly GroupedFacetRoutes[],
): Promise<void> {
  if (facetAddresses.length !== expected.length || facetsValue.length !== expected.length) {
    fail("The active facet loupe count does not match the published routes.");
  }
  const normalizedFacets = facetsValue.map(normalizeFacetTuple);
  for (let i = 0; i < expected.length; i += 1) {
    const expectedFacet = expected[i]!;
    assertAddress(facetAddresses[i]!, expectedFacet.facetAddress, "facet-address loupe");
    assertAddress(normalizedFacets[i]!.facetAddress, expectedFacet.facetAddress, "facets loupe");
    assertSelectorList(
      normalizedFacets[i]!.functionSelectors,
      expectedFacet.functionSelectors,
      `facet ${expectedFacet.facetAddress} loupe`,
    );
  }
  const selectorLists = await Promise.all(
    expected.map((facet) =>
      client.readContract({
        address: registry,
        abi: protocolFacetRegistryAbi,
        functionName: "facetFunctionSelectors",
        args: [facet.facetAddress],
        blockNumber,
      })
    ),
  );
  for (let i = 0; i < expected.length; i += 1) {
    const expectedFacet = expected[i]!;
    assertSelectorList(
      selectorLists[i] as readonly Hex[],
      expectedFacet.functionSelectors,
      `facet-function-selectors ${expectedFacet.facetAddress}`,
    );
  }
}

function normalizeFacetTuple(value: unknown): {
  facetAddress: Address;
  functionSelectors: readonly Hex[];
} {
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

function assertStrictSelectorOrder(selectors: readonly Hex[], expectedCount: bigint): void {
  if (BigInt(selectors.length) !== expectedCount) {
    fail("The published selector count does not match its selector table.");
  }
  if (selectors.length > 256) {
    fail("The published selector table exceeds the registry bound.");
  }
  let previous: string | undefined;
  for (const selector of selectors) {
    const normalized = selector.toLowerCase();
    if (!/^0x[0-9a-f]{8}$/.test(normalized)) {
      fail("The published selector table contains an invalid selector.");
    }
    if (previous !== undefined && normalized <= previous) {
      fail("The published selector table is not strictly ordered.");
    }
    previous = normalized;
  }
}

function assertMigrationRoute(
  routes: readonly BoardroomLiveFacetRoute[],
  migrationFacet: Address,
  migrationSelector: Hex,
): void {
  const hasFacet = isAddress(migrationFacet) && migrationFacet.toLowerCase() !== ZERO_ADDRESS;
  const hasSelector = /^0x[0-9a-fA-F]{8}$/.test(migrationSelector) && migrationSelector !== "0x00000000";
  if (hasFacet !== hasSelector) fail("The active migration metadata is malformed.");
  const migrationRoutes = routes.filter((route) => route.kind === 2);
  if (!hasFacet) {
    if (migrationRoutes.length !== 0) fail("The active release has an unpinned migration route.");
    return;
  }
  if (
    migrationRoutes.length !== 1
    || migrationRoutes[0]!.facet.toLowerCase() !== migrationFacet.toLowerCase()
    || migrationRoutes[0]!.selector.toLowerCase() !== migrationSelector.toLowerCase()
  ) {
    fail("The active migration route does not match the published metadata.");
  }
}

function assertSelectorList(actual: readonly Hex[], expected: readonly Hex[], label: string): void {
  if (actual.length !== expected.length) fail(`The ${label} selector count is stale.`);
  for (let i = 0; i < expected.length; i += 1) {
    assertSelector(actual[i]!, expected[i]!, `${label} selector`);
  }
}

function assertSelector(actual: Hex, expected: Hex, label: string): void {
  if (
    !/^0x[0-9a-fA-F]{8}$/.test(actual)
    || actual.toLowerCase() !== expected.toLowerCase()
  ) {
    fail(`The live ${label} does not match the published release.`);
  }
}

function assertAddressOrZero(actual: Address, expected: Address, label: string): void {
  const actualValid = isAddress(actual);
  const expectedValid = isAddress(expected);
  if (!actualValid || !expectedValid || actual.toLowerCase() !== expected.toLowerCase()) {
    fail(`The live ${label} does not match the published release.`);
  }
}

function isRouteKind(value: number): value is 0 | 1 | 2 {
  return value === 0 || value === 1 || value === 2;
}

async function assertCodeHash(
  client: BoardroomControlProofClient,
  blockNumber: bigint,
  address: Address,
  expected: Hex,
  label: string,
): Promise<void> {
  const code = await client.getCode({ address, blockNumber });
  if (!code || code === "0x" || keccak256(code).toLowerCase() !== expected.toLowerCase()) {
    fail(`The live ${label} code hash does not match the attestation.`);
  }
}

function isCodeHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) && !/^0x0{64}$/i.test(value);
}

function isBytes32(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function assertAddress(actual: Address, expected: Address, label: string): void {
  if (!isAddress(actual) || actual.toLowerCase() !== expected.toLowerCase()) {
    fail(`The live ${label} does not match the attestation.`);
  }
}

function assertHex(actual: Hex, expected: Hex, label: string): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    fail(`The live ${label} does not match the attestation.`);
  }
}

function fail(message: string): never {
  throw new BoardroomControlReleaseProofError(message);
}
