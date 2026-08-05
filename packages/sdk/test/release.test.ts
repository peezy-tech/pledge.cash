import { describe, expect, test } from "bun:test";
import { keccak256, type Address, type Hex } from "viem";

import {
  assertLiveBoardroomControlRelease,
  assertLiveProtocolFacetRelease,
  boardroomReleaseAttestationFromDeployment,
  boardroomReleaseSupport,
  BoardroomControlReleaseProofError,
  type BoardroomControlProofClient,
  type PledgeCashDeployment,
} from "../src";

const liveCode = "0x6000" as Hex;
const liveCodeHash = keccak256(liveCode);
const futureCode = "0x6001" as Hex;
const futureCodeHash = keccak256(futureCode);
const releaseAFacetSetHash = `0x${"11".repeat(32)}` as Hex;
const releaseBFacetSetHash = `0x${"12".repeat(32)}` as Hex;
const storageLayoutHash = `0x${"22".repeat(32)}` as Hex;
const storageLayoutHashB = `0x${"23".repeat(32)}` as Hex;
const manifestHash = `0x${"33".repeat(32)}` as Hex;
const manifestHashB = `0x${"34".repeat(32)}` as Hex;
const kernelSelectorSetHash = `0x${"44".repeat(32)}` as Hex;
const pinnedBlockHash = `0x${"55".repeat(32)}` as Hex;
const replacementBlockHash = `0x${"56".repeat(32)}` as Hex;
const registryOwner = "0x1000000000000000000000000000000000000001" as Address;
const successorRegistryOwner = "0x1000000000000000000000000000000000000099" as Address;
const facetRegistry = "0x1000000000000000000000000000000000000002" as Address;
const factory = "0x1000000000000000000000000000000000000003" as Address;
const kernel = "0x1000000000000000000000000000000000000004" as Address;
const controllerFactory = "0x1000000000000000000000000000000000000005" as Address;
const controllerImplementation = "0x1000000000000000000000000000000000000006" as Address;
const governanceLogic = "0x1000000000000000000000000000000000000007" as Address;
const marketLogic = "0x1000000000000000000000000000000000000008" as Address;
const redemptionPayout = "0x1000000000000000000000000000000000000009" as Address;
const authorityFacet = "0x1000000000000000000000000000000000000010" as Address;
const executionFacet = "0x1000000000000000000000000000000000000011" as Address;
const marketFacet = "0x1000000000000000000000000000000000000012" as Address;
const redemptionFacet = "0x1000000000000000000000000000000000000013" as Address;
const viewFacet = "0x1000000000000000000000000000000000000014" as Address;
const migrationFacet = "0x1000000000000000000000000000000000000015" as Address;
const viewFacetV2 = "0x1000000000000000000000000000000000000016" as Address;
const futureFacet = "0x1000000000000000000000000000000000000017" as Address;
const boardroom = "0x2000000000000000000000000000000000000001" as Address;
const shareToken = "0x2000000000000000000000000000000000000002" as Address;
const prelaunchOwner = "0x2000000000000000000000000000000000000003" as Address;
const zeroAddress = "0x0000000000000000000000000000000000000000" as Address;
const zeroHash = `0x${"00".repeat(32)}` as Hex;
const zeroSelector = "0x00000000" as Hex;
const migrationSelector = "0x6f774fc9" as Hex;

type TestRoute = {
  selector: Hex;
  facet: Address;
  codeHash: Hex;
  kind: 0 | 1 | 2;
};

type LiveRelease = {
  facetSetHash: Hex;
  release: bigint;
  requiredStorageVersion: bigint;
  storageLayoutHash: Hex;
  manifestHash: Hex;
  predecessorFacetSetHash: Hex;
  migrationFacet: Address;
  migrationSelector: Hex;
  routes: readonly TestRoute[];
};

const releaseARoutes = [
  { selector: "0x11111111", facet: authorityFacet, codeHash: liveCodeHash, kind: 1 },
  { selector: "0x22222222", facet: executionFacet, codeHash: liveCodeHash, kind: 1 },
  { selector: "0x33333333", facet: marketFacet, codeHash: liveCodeHash, kind: 1 },
  { selector: "0x44444444", facet: redemptionFacet, codeHash: liveCodeHash, kind: 1 },
  { selector: "0x55555555", facet: viewFacet, codeHash: liveCodeHash, kind: 0 },
] as const satisfies readonly TestRoute[];

const releaseA: LiveRelease = {
  facetSetHash: releaseAFacetSetHash,
  release: 1n,
  requiredStorageVersion: 1n,
  storageLayoutHash,
  manifestHash,
  predecessorFacetSetHash: zeroHash,
  migrationFacet: zeroAddress,
  migrationSelector: zeroSelector,
  routes: releaseARoutes,
};

const releaseB: LiveRelease = {
  facetSetHash: releaseBFacetSetHash,
  release: 2n,
  requiredStorageVersion: 2n,
  storageLayoutHash: storageLayoutHashB,
  manifestHash: manifestHashB,
  predecessorFacetSetHash: releaseAFacetSetHash,
  migrationFacet,
  migrationSelector,
  routes: [
    { selector: "0x11111111", facet: futureFacet, codeHash: futureCodeHash, kind: 1 },
    { selector: "0x22222222", facet: futureFacet, codeHash: futureCodeHash, kind: 1 },
    { selector: "0x33333333", facet: futureFacet, codeHash: futureCodeHash, kind: 1 },
    { selector: "0x44444444", facet: futureFacet, codeHash: futureCodeHash, kind: 1 },
    { selector: "0x55555555", facet: futureFacet, codeHash: futureCodeHash, kind: 0 },
    { selector: migrationSelector, facet: migrationFacet, codeHash: futureCodeHash, kind: 2 },
  ],
};

function deployment(
  overrides: Partial<PledgeCashDeployment> = {},
): PledgeCashDeployment {
  return {
    chainId: 31_337,
    protocolVersion: "pledge.cash.protocol.v1",
    protocolReleaseCodeHash: liveCodeHash,
    protocolFacetRegistryOwner: registryOwner,
    protocolFacetRegistry: facetRegistry,
    protocolFacetRegistryCodeHash: liveCodeHash,
    boardroomFactory: factory,
    boardroomFactoryCodeHash: liveCodeHash,
    boardroomKernel: kernel,
    boardroomKernelCodeHash: liveCodeHash,
    boardroomControllerFactory: controllerFactory,
    boardroomControllerFactoryCodeHash: liveCodeHash,
    boardroomControllerLogic: controllerImplementation,
    boardroomControllerLogicCodeHash: liveCodeHash,
    boardroomGovernanceLogic: governanceLogic,
    boardroomGovernanceLogicCodeHash: liveCodeHash,
    boardroomMarketLogic: marketLogic,
    boardroomMarketLogicCodeHash: liveCodeHash,
    boardroomRedemptionPayout: redemptionPayout,
    boardroomRedemptionPayoutCodeHash: liveCodeHash,
    authorityFacet,
    authorityFacetCodeHash: liveCodeHash,
    executionFacet,
    executionFacetCodeHash: liveCodeHash,
    marketFacet,
    marketFacetCodeHash: liveCodeHash,
    redemptionFacet,
    redemptionFacetCodeHash: liveCodeHash,
    viewFacet,
    viewFacetCodeHash: liveCodeHash,
    activeFacetSetHash: releaseAFacetSetHash,
    activeRelease: 1n,
    requiredStorageVersion: 1n,
    requiredStorageLayoutHash: storageLayoutHash,
    manifestHash,
    kernelSelectorSetHash,
    selectorCount: 5n,
    ...overrides,
  };
}

function groupedFacets(routes: readonly TestRoute[]) {
  const facets = new Map<string, { facetAddress: Address; functionSelectors: Hex[] }>();
  for (const route of routes) {
    const key = route.facet.toLowerCase();
    const entry = facets.get(key) ?? { facetAddress: route.facet, functionSelectors: [] };
    entry.functionSelectors.push(route.selector);
    facets.set(key, entry);
  }
  return [...facets.values()];
}

function proofClient(input: {
  release?: LiveRelease;
  registryOwner?: Address;
  migrationRequired?: boolean;
  appliedStorageVersion?: bigint;
  appliedStorageLayoutHash?: Hex;
  facetsOverride?: readonly { facetAddress: Address; functionSelectors: readonly Hex[] }[];
  codeOverride?: (address: Address) => Hex | undefined;
  computedFacetSetHash?: Hex;
  blockHashes?: readonly Hex[];
  removedBoardroomViews?: boolean;
} = {}): BoardroomControlProofClient {
  const liveRelease = input.release ?? releaseA;
  const facets = input.facetsOverride ?? groupedFacets(liveRelease.routes);
  let blockReadCount = 0;
  const routeFor = (selector: Hex): TestRoute => {
    const route = liveRelease.routes.find((candidate) =>
      candidate.selector.toLowerCase() === selector.toLowerCase()
    );
    if (!route) throw new Error(`Unknown test selector ${selector}`);
    return route;
  };
  return {
    getBlockNumber: async () => 77n,
    getBlock: async ({ blockNumber }) => {
      expect(blockNumber).toBe(77n);
      const hashes = input.blockHashes ?? [pinnedBlockHash];
      const hash = hashes[Math.min(blockReadCount, hashes.length - 1)]!;
      blockReadCount += 1;
      return { number: 77n, hash } as never;
    },
    getCode: async ({ address, blockNumber }) => {
      expect(blockNumber).toBe(77n);
      const overridden = input.codeOverride?.(address);
      if (overridden !== undefined) return overridden;
      if (
        address.toLowerCase() === futureFacet.toLowerCase()
        || address.toLowerCase() === migrationFacet.toLowerCase()
      ) {
        return futureCode;
      }
      return liveCode;
    },
    readContract: async ({ address, functionName, args, blockNumber }) => {
      expect(blockNumber).toBe(77n);
      if (address.toLowerCase() === facetRegistry.toLowerCase()) {
        if (functionName === "owner") return (input.registryOwner ?? registryOwner) as never;
        if (functionName === "kernelSelectorSetHash") return kernelSelectorSetHash as never;
        if (functionName === "activeFacetSetHash") return liveRelease.facetSetHash as never;
        if (functionName === "activeRelease") return liveRelease.release as never;
        if (functionName === "activeStorageVersion") return liveRelease.requiredStorageVersion as never;
        if (functionName === "activeStorageLayoutHash") return liveRelease.storageLayoutHash as never;
        if (functionName === "isFacetSetPublished") return true as never;
        if (functionName === "facetSetHashForRelease") return liveRelease.facetSetHash as never;
        if (functionName === "facetSetMetadata") {
          return [
            true,
            liveRelease.release,
            liveRelease.requiredStorageVersion,
            liveRelease.predecessorFacetSetHash,
            liveRelease.storageLayoutHash,
            liveRelease.manifestHash,
            liveRelease.migrationFacet,
            liveRelease.migrationSelector,
            BigInt(liveRelease.routes.length),
          ] as never;
        }
        if (functionName === "facetSetSelectors") {
          return liveRelease.routes.map((route) => route.selector) as never;
        }
        if (functionName === "facets") return facets as never;
        if (functionName === "facetAddresses") {
          return facets.map((facet) => facet.facetAddress) as never;
        }
        if (functionName === "activeMigration") {
          return [liveRelease.migrationFacet, liveRelease.migrationSelector] as never;
        }
        if (functionName === "facetFunctionSelectors") {
          const requestedFacet = (args as readonly [Address])[0];
          return (
            facets.find((facet) => facet.facetAddress.toLowerCase() === requestedFacet.toLowerCase())
              ?.functionSelectors ?? []
          ) as never;
        }
        if (functionName === "facetSetRoute") {
          const route = routeFor((args as readonly [Hex, Hex])[1]);
          return [route.facet, route.codeHash, route.kind] as never;
        }
        if (functionName === "route") {
          const route = routeFor((args as readonly [Hex])[0]);
          return [
            route.facet,
            route.codeHash,
            route.kind,
            liveRelease.requiredStorageVersion,
          ] as never;
        }
        if (functionName === "facetAddress") {
          return routeFor((args as readonly [Hex])[0]).facet as never;
        }
        if (functionName === "computeFacetSetHash") {
          return (input.computedFacetSetHash ?? liveRelease.facetSetHash) as never;
        }
      }
      if (address.toLowerCase() === factory.toLowerCase()) {
        if (functionName === "facetRegistry") return facetRegistry as never;
        if (functionName === "boardroomKernelLogic") return kernel as never;
        if (functionName === "controllerFactory") return controllerFactory as never;
        if (functionName === "governanceLogic") return governanceLogic as never;
        if (functionName === "marketLogic") return marketLogic as never;
        if (functionName === "redemptionPayoutLogic") return redemptionPayout as never;
        if (functionName === "isBoardroom" || functionName === "isShareToken") return true as never;
      }
      if (address.toLowerCase() === kernel.toLowerCase()) {
        if (functionName === "facetRegistry") return facetRegistry as never;
        if (functionName === "kernelSelectorSetHash") return kernelSelectorSetHash as never;
      }
      if (address.toLowerCase() === controllerFactory.toLowerCase()) {
        if (functionName === "boardroomFactory") return factory as never;
        if (functionName === "controllerImplementation") return controllerImplementation as never;
      }
      if (address.toLowerCase() === boardroom.toLowerCase()) {
        if (input.removedBoardroomViews) throw new Error("Unknown Boardroom selector");
        if (functionName === "shareToken") return shareToken as never;
        if (functionName === "facetRegistry") return facetRegistry as never;
        if (functionName === "facetSetHash") return liveRelease.facetSetHash as never;
        if (functionName === "appliedStorageVersion") {
          return (input.appliedStorageVersion ?? liveRelease.requiredStorageVersion) as never;
        }
        if (functionName === "appliedStorageLayoutHash") {
          return (input.appliedStorageLayoutHash ?? liveRelease.storageLayoutHash) as never;
        }
        if (functionName === "migrationRequired") return (input.migrationRequired ?? false) as never;
        if (functionName === "launched") return false as never;
        if (functionName === "owner") return prelaunchOwner as never;
        if (functionName === "controller") return zeroAddress as never;
        if (functionName === "controllerGeneration") return 0n as never;
        if (functionName === "controllerFactory") return controllerFactory as never;
        if (functionName === "governanceLogic") return governanceLogic as never;
        if (functionName === "marketLogic") return marketLogic as never;
        if (functionName === "redemptionPayoutLogic") return redemptionPayout as never;
      }
      throw new Error(`Unexpected proof read ${address}:${String(functionName)}`);
    },
  } as BoardroomControlProofClient;
}

describe("Boardroom release proof", () => {
  test("normalizes permanent roots and genesis-release evidence", () => {
    expect(boardroomReleaseSupport(undefined).supported).toBe(false);
    expect(boardroomReleaseSupport(deployment())).toEqual({ supported: true });
    expect(boardroomReleaseAttestationFromDeployment(deployment())?.facets).toHaveLength(5);

  });

  test("requires permanent roots but does not gate runtime on genesis release, facets, or owner", async () => {
    const withoutGenesisEvidence = deployment({
      protocolFacetRegistryOwner: undefined,
      activeFacetSetHash: undefined,
      activeRelease: undefined,
      requiredStorageVersion: undefined,
      requiredStorageLayoutHash: undefined,
      manifestHash: undefined,
      selectorCount: undefined,
      authorityFacet: undefined,
      authorityFacetCodeHash: undefined,
      executionFacet: undefined,
      executionFacetCodeHash: undefined,
      marketFacet: undefined,
      marketFacetCodeHash: undefined,
      redemptionFacet: undefined,
      redemptionFacetCodeHash: undefined,
      viewFacet: undefined,
      viewFacetCodeHash: undefined,
    });
    expect(boardroomReleaseSupport(withoutGenesisEvidence)).toEqual({ supported: true });
    expect(boardroomReleaseAttestationFromDeployment(withoutGenesisEvidence)?.facets).toEqual([]);
    await expect(
      assertLiveProtocolFacetRelease(proofClient(), withoutGenesisEvidence),
    ).resolves.toMatchObject({
      facetSetHash: releaseAFacetSetHash,
      registryOwner,
    });
    await expect(
      assertLiveBoardroomControlRelease(proofClient(), withoutGenesisEvidence, boardroom),
    ).resolves.toMatchObject({
      facetSetHash: releaseAFacetSetHash,
      blockHash: pinnedBlockHash,
    });

    expect(boardroomReleaseSupport(deployment({ activeFacetSetHash: zeroHash })).supported).toBe(true);
    expect(boardroomReleaseSupport(deployment({ executionFacet: authorityFacet })).supported).toBe(true);
    expect(boardroomReleaseSupport(deployment({ protocolFacetRegistryCodeHash: zeroHash })).supported).toBe(false);
    expect(boardroomReleaseSupport(deployment({ kernelSelectorSetHash: zeroHash })).supported).toBe(false);
  });

  test("pins one block number and hash and proves release metadata, routes, loupe, code, and reciprocal identity", async () => {
    await expect(assertLiveBoardroomControlRelease(proofClient(), deployment(), boardroom)).resolves.toEqual({
      blockNumber: 77n,
      blockHash: pinnedBlockHash,
      facetSetHash: releaseAFacetSetHash,
      activeRelease: 1n,
      appliedStorageVersion: 1n,
      appliedStorageLayoutHash: storageLayoutHash,
      migrationRequired: false,
      launched: false,
      controller: zeroAddress,
      controllerGeneration: 0n,
    });
  });

  test("accepts a different valid active release without trusting release-A facet evidence", async () => {
    const client = proofClient({
      release: releaseB,
      migrationRequired: true,
      appliedStorageVersion: 1n,
      appliedStorageLayoutHash: storageLayoutHash,
    });

    await expect(assertLiveProtocolFacetRelease(client, deployment())).resolves.toMatchObject({
      blockNumber: 77n,
      blockHash: pinnedBlockHash,
      registryOwner,
      facetSetHash: releaseBFacetSetHash,
      activeRelease: 2n,
      requiredStorageVersion: 2n,
      requiredStorageLayoutHash: storageLayoutHashB,
      migrationFacet,
      migrationSelector,
      selectorCount: 6n,
    });
    await expect(assertLiveBoardroomControlRelease(client, deployment(), boardroom)).resolves.toEqual({
      blockNumber: 77n,
      blockHash: pinnedBlockHash,
      facetSetHash: releaseBFacetSetHash,
      activeRelease: 2n,
      appliedStorageVersion: 1n,
      appliedStorageLayoutHash: storageLayoutHash,
      migrationRequired: true,
      launched: false,
      controller: zeroAddress,
      controllerGeneration: 0n,
    });
  });

  test("accepts a legitimate live registry-owner handoff without rewriting genesis evidence", async () => {
    await expect(
      assertLiveProtocolFacetRelease(
        proofClient({ registryOwner: successorRegistryOwner }),
        deployment({ protocolFacetRegistryOwner: registryOwner }),
      ),
    ).resolves.toMatchObject({
      registryOwner: successorRegistryOwner,
      blockHash: pinnedBlockHash,
    });
  });

  test("rejects a zero live registry owner and a block-hash change during proof assembly", async () => {
    await expect(
      assertLiveProtocolFacetRelease(proofClient({ registryOwner: zeroAddress }), deployment()),
    ).rejects.toThrow("registry owner");
    await expect(
      assertLiveProtocolFacetRelease(
        proofClient({ blockHashes: [pinnedBlockHash, replacementBlockHash] }),
        deployment(),
      ),
    ).rejects.toThrow("pinned proof block changed");
  });

  test("authenticates a valid empty active release while Boardroom proof fails when views were removed", async () => {
    const emptyRelease: LiveRelease = {
      ...releaseA,
      facetSetHash: `0x${"13".repeat(32)}` as Hex,
      routes: [],
    };
    await expect(
      assertLiveProtocolFacetRelease(proofClient({ release: emptyRelease }), deployment()),
    ).resolves.toMatchObject({
      selectorCount: 0n,
      routes: [],
      registryOwner,
    });
    await expect(
      assertLiveBoardroomControlRelease(
        proofClient({ release: emptyRelease, removedBoardroomViews: true }),
        deployment(),
        boardroom,
      ),
    ).rejects.toThrow("Unknown Boardroom selector");
  });

  test("rejects selector ordering and loupe tables that differ from published routes", async () => {
    const unordered: LiveRelease = {
      ...releaseA,
      routes: [releaseARoutes[1], releaseARoutes[0], ...releaseARoutes.slice(2)],
    };
    await expect(
      assertLiveProtocolFacetRelease(proofClient({ release: unordered }), deployment()),
    ).rejects.toThrow("strictly ordered");

    await expect(
      assertLiveProtocolFacetRelease(proofClient({
        facetsOverride: [
          ...groupedFacets(releaseARoutes).slice(0, 4),
          { facetAddress: viewFacet, functionSelectors: ["0x66666666"] },
        ],
      }), deployment()),
    ).rejects.toThrow("loupe selector");
  });

  test("rejects an active selector table above the registry's 256-selector bound", async () => {
    const oversized: LiveRelease = {
      ...releaseA,
      routes: Array.from({ length: 257 }, (_, index) => ({
        selector: `0x${index.toString(16).padStart(8, "0")}` as Hex,
        facet: authorityFacet,
        codeHash: liveCodeHash,
        kind: 0 as const,
      })),
    };
    await expect(
      assertLiveProtocolFacetRelease(proofClient({ release: oversized }), deployment()),
    ).rejects.toThrow("exceeds the registry bound");
  });

  test("rejects a registry-pinned facet code hash that differs from live code", async () => {
    await expect(
      assertLiveProtocolFacetRelease(proofClient({
        codeOverride: (address) =>
          address.toLowerCase() === viewFacet.toLowerCase() ? futureCode : undefined,
      }), deployment()),
    ).rejects.toBeInstanceOf(BoardroomControlReleaseProofError);
  });

  test("rejects active metadata and routes that do not recompute to the active hash", async () => {
    await expect(
      assertLiveProtocolFacetRelease(proofClient({
        computedFacetSetHash: releaseBFacetSetHash,
      }), deployment()),
    ).rejects.toThrow("canonical facet-set hash");
  });

  test("rejects a permanent root code hash that differs from the deployment", async () => {
    const client = proofClient({
      codeOverride: (address) =>
        address.toLowerCase() === facetRegistry.toLowerCase() ? futureCode : undefined,
    });
    await expect(
      assertLiveBoardroomControlRelease(client, deployment(), boardroom),
    ).rejects.toBeInstanceOf(BoardroomControlReleaseProofError);
  });
});
