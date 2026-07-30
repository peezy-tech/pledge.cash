import { describe, expect, test } from "bun:test";
import type { PledgeCashDeployment } from "@pledge.cash/sdk";
import { hashMessage, keccak256, padHex, type Address, type Hex } from "viem";

import {
  BoardroomControlChainError,
  ERC1271_MAGIC_VALUE,
  SUPPORTED_BOARDROOM_CONTROL_RELEASE,
  createBoardroomControlChainReader,
  type BoardroomControlPublicClient
} from "../src/chain/boardroom-control";
import type { SentinelChainConfig } from "../src/config";

const FACTORY = "0x1000000000000000000000000000000000000001" as Address;
const CONTROLLER_FACTORY = "0x3000000000000000000000000000000000000003" as Address;
const CONTROLLER_LOGIC = "0x4000000000000000000000000000000000000004" as Address;
const BOARDROOM = "0x5000000000000000000000000000000000000005" as Address;
const CONTROLLER = "0x6000000000000000000000000000000000000006" as Address;
const REGISTRY = "0x7000000000000000000000000000000000000007" as Address;
const KERNEL = "0x8000000000000000000000000000000000000008" as Address;
const GOVERNANCE = "0x9000000000000000000000000000000000000009" as Address;
const REGISTRY_CEREMONY_OWNER = "0x9100000000000000000000000000000000000009" as Address;
const LIVE_REGISTRY_OWNER = "0x9200000000000000000000000000000000000009" as Address;
const GOVERNANCE_LOGIC = "0xa00000000000000000000000000000000000000a" as Address;
const MARKET_LOGIC = "0xb00000000000000000000000000000000000000b" as Address;
const REDEMPTION_PAYOUT = "0xc00000000000000000000000000000000000000c" as Address;
const RELEASE_B_FACET = "0x1300000000000000000000000000000000000013" as Address;
const FACETS = [
  "0xd00000000000000000000000000000000000000d",
  "0xe00000000000000000000000000000000000000e",
  "0xf00000000000000000000000000000000000000f",
  "0x1100000000000000000000000000000000000011",
  "0x1200000000000000000000000000000000000012"
] as const satisfies readonly Address[];
const FACET_SELECTORS = [
  "0x01020304",
  "0x02030405",
  "0x03040506",
  "0x04050607",
  "0x05060708"
] as const satisfies readonly Hex[];
const ACTIVE_FACET_SET_HASH = `0x${"31".repeat(32)}` as Hex;
const STORAGE_LAYOUT_HASH = `0x${"32".repeat(32)}` as Hex;
const MANIFEST_HASH = `0x${"33".repeat(32)}` as Hex;
const KERNEL_SELECTOR_SET_HASH = `0x${"34".repeat(32)}` as Hex;
const CONFIGURATION_HASH = `0x${"35".repeat(32)}` as Hex;
const PROTOCOL_RELEASE_CODE_HASH = `0x${"36".repeat(32)}` as Hex;
const FINALIZED_HASH = `0x${"ab".repeat(32)}` as Hex;
const REORG_HASH = `0x${"cd".repeat(32)}` as Hex;
const FACTORY_CODE = "0x60006000" as Hex;
const CONTROLLER_FACTORY_CODE = "0x60026002" as Hex;
const CONTROLLER_LOGIC_CODE = "0x60036003" as Hex;
const REGISTRY_CODE = "0x60046004" as Hex;
const KERNEL_CODE = "0x60056005" as Hex;
const GOVERNANCE_LOGIC_CODE = "0x60066006" as Hex;
const MARKET_LOGIC_CODE = "0x60076007" as Hex;
const REDEMPTION_PAYOUT_CODE = "0x60086008" as Hex;
const FACET_CODES = [
  "0x60106010",
  "0x60116011",
  "0x60126012",
  "0x60136013",
  "0x60146014"
] as const satisfies readonly Hex[];
const RELEASE_B_FACET_CODE = "0x60156015" as Hex;

class FakeClient implements BoardroomControlPublicClient {
  blockHash = FINALIZED_HASH;
  blockNumber = 100n;
  callResult = padHex(ERC1271_MAGIC_VALUE, { dir: "right", size: 32 });
  readonly pinnedCalls: bigint[] = [];
  lastCallData: Hex | undefined;
  boardroomFacetRoutesUnavailable = false;
  reorg = false;
  rpcFailure = false;
  rpcChainId = 31337;
  readonly values = new Map<string, unknown>();

  constructor() {
    this.values.set(key(FACTORY, "isBoardroom"), true);
    this.values.set(key(FACTORY, "facetRegistry"), REGISTRY);
    this.values.set(key(FACTORY, "boardroomKernelLogic"), KERNEL);
    this.values.set(key(FACTORY, "controllerFactory"), CONTROLLER_FACTORY);
    this.values.set(key(FACTORY, "governanceLogic"), GOVERNANCE_LOGIC);
    this.values.set(key(FACTORY, "marketLogic"), MARKET_LOGIC);
    this.values.set(key(FACTORY, "redemptionPayoutLogic"), REDEMPTION_PAYOUT);
    this.values.set(key(REGISTRY, "owner"), LIVE_REGISTRY_OWNER);
    this.values.set(key(REGISTRY, "activeFacetSetHash"), ACTIVE_FACET_SET_HASH);
    this.values.set(key(REGISTRY, "activeRelease"), 1n);
    this.values.set(key(REGISTRY, "activeStorageVersion"), 1n);
    this.values.set(key(REGISTRY, "activeStorageLayoutHash"), STORAGE_LAYOUT_HASH);
    this.values.set(key(REGISTRY, "kernelSelectorSetHash"), KERNEL_SELECTOR_SET_HASH);
    this.values.set(key(REGISTRY, "facetSetMetadata"), {
      published: true,
      release: 1n,
      requiredStorageVersion: 1n,
      predecessorFacetSetHash: `0x${"00".repeat(32)}`,
      storageLayoutHash: STORAGE_LAYOUT_HASH,
      manifestHash: MANIFEST_HASH,
      migrationFacet: "0x0000000000000000000000000000000000000000",
      migrationSelector: "0x00000000",
      selectorCount: 5n
    });
    this.values.set(key(REGISTRY, "facetSetSelectors"), FACET_SELECTORS);
    this.values.set(
      key(REGISTRY, "facets"),
      FACETS.map((facetAddress, index) => ({
        facetAddress,
        functionSelectors: [FACET_SELECTORS[index]]
      }))
    );
    this.values.set(key(KERNEL, "facetRegistry"), REGISTRY);
    this.values.set(key(KERNEL, "kernelSelectorSetHash"), KERNEL_SELECTOR_SET_HASH);
    this.values.set(key(BOARDROOM, "facetRegistry"), REGISTRY);
    this.values.set(key(BOARDROOM, "facetSetHash"), ACTIVE_FACET_SET_HASH);
    this.values.set(key(BOARDROOM, "appliedStorageVersion"), 1n);
    this.values.set(key(BOARDROOM, "appliedStorageLayoutHash"), STORAGE_LAYOUT_HASH);
    this.values.set(key(BOARDROOM, "migrationRequired"), false);
    this.values.set(key(BOARDROOM, "launched"), true);
    this.values.set(key(BOARDROOM, "owner"), CONTROLLER);
    this.values.set(key(BOARDROOM, "controller"), CONTROLLER);
    this.values.set(key(BOARDROOM, "controllerGeneration"), 3n);
    this.values.set(key(BOARDROOM, "governanceEpoch"), 5n);
    this.values.set(key(BOARDROOM, "controllerFactory"), CONTROLLER_FACTORY);
    this.values.set(key(BOARDROOM, "governanceLogic"), GOVERNANCE_LOGIC);
    this.values.set(key(BOARDROOM, "marketLogic"), MARKET_LOGIC);
    this.values.set(key(BOARDROOM, "redemptionPayoutLogic"), REDEMPTION_PAYOUT);
    this.values.set(key(CONTROLLER_FACTORY, "boardroomFactory"), FACTORY);
    this.values.set(key(CONTROLLER_FACTORY, "controllerImplementation"), CONTROLLER_LOGIC);
    this.values.set(key(CONTROLLER_FACTORY, "isController"), true);
    this.values.set(key(CONTROLLER_FACTORY, "boardroomOfController"), BOARDROOM);
    this.values.set(key(CONTROLLER_FACTORY, "generationOfController"), 3n);
    this.values.set(key(CONTROLLER, "factory"), CONTROLLER_FACTORY);
    this.values.set(key(CONTROLLER, "boardroom"), BOARDROOM);
    this.values.set(key(CONTROLLER, "generation"), 3n);
    this.values.set(key(CONTROLLER, "configurationEpoch"), 7n);
    this.values.set(key(CONTROLLER, "configurationHash"), CONFIGURATION_HASH);
  }

  async call(input: { readonly blockNumber: bigint; readonly data: Hex; readonly to: Address }) {
    this.maybeFail();
    this.pinnedCalls.push(input.blockNumber);
    this.lastCallData = input.data;
    expect(input.to.toLowerCase()).toBe(CONTROLLER.toLowerCase());
    return { data: this.callResult };
  }

  async getBlock(input: { readonly blockNumber: bigint } | { readonly blockTag: "finalized" }) {
    this.maybeFail();
    if ("blockTag" in input) return { hash: this.blockHash, number: this.blockNumber };
    this.pinnedCalls.push(input.blockNumber);
    return { hash: this.reorg ? REORG_HASH : this.blockHash, number: input.blockNumber };
  }

  async getChainId() {
    this.maybeFail();
    return this.rpcChainId;
  }

  async getBytecode(input: { readonly address: Address; readonly blockNumber: bigint }) {
    this.maybeFail();
    this.pinnedCalls.push(input.blockNumber);
    const codes = new Map<string, Hex>([
      [FACTORY.toLowerCase(), FACTORY_CODE],
      [CONTROLLER_FACTORY.toLowerCase(), CONTROLLER_FACTORY_CODE],
      [CONTROLLER_LOGIC.toLowerCase(), CONTROLLER_LOGIC_CODE],
      [REGISTRY.toLowerCase(), REGISTRY_CODE],
      [KERNEL.toLowerCase(), KERNEL_CODE],
      [GOVERNANCE_LOGIC.toLowerCase(), GOVERNANCE_LOGIC_CODE],
      [MARKET_LOGIC.toLowerCase(), MARKET_LOGIC_CODE],
      [REDEMPTION_PAYOUT.toLowerCase(), REDEMPTION_PAYOUT_CODE],
      ...FACETS.map((facet, index) => [facet.toLowerCase(), FACET_CODES[index]!] as const),
      [RELEASE_B_FACET.toLowerCase(), RELEASE_B_FACET_CODE],
      [BOARDROOM.toLowerCase(), cloneCode(KERNEL)],
      [CONTROLLER.toLowerCase(), cloneCode(CONTROLLER_LOGIC)]
    ]);
    return codes.get(input.address.toLowerCase());
  }

  async readContract(input: {
    readonly address: Address;
    readonly args?: readonly unknown[];
    readonly blockNumber: bigint;
    readonly functionName: string;
  }) {
    this.maybeFail();
    this.pinnedCalls.push(input.blockNumber);
    if (
      this.boardroomFacetRoutesUnavailable &&
      input.address.toLowerCase() === BOARDROOM.toLowerCase() &&
      ![
        "facetRegistry",
        "facetSetHash",
        "appliedStorageVersion",
        "appliedStorageLayoutHash",
        "migrationRequired"
      ].includes(input.functionName)
    ) {
      throw new Error("unknown selector");
    }
    if (
      input.address.toLowerCase() === REGISTRY.toLowerCase() &&
      (input.functionName === "facetSetRoute" || input.functionName === "route")
    ) {
      const selector = input.args?.[1] as Hex | undefined;
      const activeSelector = input.args?.[0] as Hex | undefined;
      const resolvedSelector =
        input.functionName === "route" ? activeSelector : selector;
      const index = FACET_SELECTORS.findIndex(
        (candidate) => candidate.toLowerCase() === resolvedSelector?.toLowerCase()
      );
      if (index < 0) return undefined;
      const route = {
        facet: FACETS[index],
        codeHash: keccak256(FACET_CODES[index]!),
        kind: index === 4 ? 0 : 1
      };
      return input.functionName === "route"
        ? { ...route, requiredStorageVersion: this.values.get(key(REGISTRY, "activeStorageVersion")) }
        : route;
    }
    return this.values.get(key(input.address, input.functionName));
  }

  private maybeFail() {
    if (this.rpcFailure) throw new Error("rpc unavailable");
  }
}

describe("pinned finalized Boardroom-control reads", () => {
  test("allows registry ceremony, protocol governance, and live ownership to differ", async () => {
    await expect(
      makeReader(new FakeClient()).resolveCanonicalBoardroom({
        boardroom: BOARDROOM,
        chainId: 31337
      })
    ).resolves.toMatchObject({ facetSetHash: ACTIVE_FACET_SET_HASH });
  });

  test("requires the live registry owner to remain a well-formed nonzero authority", async () => {
    const client = new FakeClient();
    client.values.set(
      key(REGISTRY, "owner"),
      "0x0000000000000000000000000000000000000000"
    );
    await expect(
      makeReader(client).resolveCanonicalBoardroom({
        boardroom: BOARDROOM,
        chainId: 31337
      })
    ).rejects.toMatchObject({ failure: "malformed-chain-result" });
  });

  test("proves canonical runtime topology and performs ERC-1271 at one block", async () => {
    const client = new FakeClient();
    const reader = makeReader(client);
    const snapshot = await reader.resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 });

    expect(snapshot).toEqual({
      appliedStorageLayoutHash: STORAGE_LAYOUT_HASH,
      appliedStorageVersion: 1n,
      blockHash: FINALIZED_HASH,
      blockNumber: 100n,
      boardroom: BOARDROOM,
      boardroomEpoch: 5n,
      chainId: 31337,
      configurationHash: CONFIGURATION_HASH,
      configurationEpoch: 7n,
      controller: CONTROLLER,
      controllerGeneration: 3n,
      facetSetHash: ACTIVE_FACET_SET_HASH
    });
    expect(client.pinnedCalls.length).toBeGreaterThan(20);
    expect(client.pinnedCalls.every((block) => block === 100n)).toBe(true);

    client.pinnedCalls.length = 0;
    const message = "exact serialized SIWE message";
    await reader.verifyControlSignature({
      expected: snapshot,
      message,
      signature: `0x${"11".repeat(65)}`
    });
    expect(client.pinnedCalls.every((block) => block === 100n)).toBe(true);
    expect(`0x${client.lastCallData?.slice(10, 74).toLowerCase()}`).toBe(
      hashMessage(message).toLowerCase()
    );
  });

  test("fails closed on malformed and invalid ERC-1271 return data", async () => {
    const malformed = new FakeClient();
    malformed.callResult = ERC1271_MAGIC_VALUE;
    await expectVerificationFailure(malformed, "malformed-chain-result");

    const invalid = new FakeClient();
    invalid.callResult = padHex("0xffffffff", { dir: "right", size: 32 });
    await expectVerificationFailure(invalid, "invalid-signature");
  });

  test("detects a finalized-block hash change before accepting proof", async () => {
    const client = new FakeClient();
    client.reorg = true;
    await expect(
      makeReader(client).resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 })
    ).rejects.toMatchObject({ failure: "reorg-uncertainty" });
  });

  test("rejects spoofed factories, stale reciprocal bindings, and malformed generations", async () => {
    const mutations: ReadonlyArray<readonly [string, string, unknown]> = [
      [key(FACTORY, "isBoardroom"), "non-canonical-boardroom", false],
      [key(BOARDROOM, "launched"), "stale-relationship", false],
      [key(BOARDROOM, "owner"), "stale-relationship", BOARDROOM],
      [key(BOARDROOM, "controllerFactory"), "stale-relationship", FACTORY],
      [key(CONTROLLER_FACTORY, "boardroomFactory"), "unsupported-release", BOARDROOM],
      [key(CONTROLLER_FACTORY, "isController"), "stale-relationship", false],
      [key(CONTROLLER_FACTORY, "boardroomOfController"), "stale-relationship", CONTROLLER],
      [key(CONTROLLER_FACTORY, "generationOfController"), "stale-relationship", 4n],
      [key(CONTROLLER, "factory"), "stale-relationship", FACTORY],
      [key(CONTROLLER, "boardroom"), "stale-relationship", CONTROLLER],
      [key(CONTROLLER, "generation"), "stale-relationship", 4n],
      [key(CONTROLLER, "configurationEpoch"), "malformed-chain-result", 0n]
    ];

    for (const [path, failure, value] of mutations) {
      const client = new FakeClient();
      client.values.set(path, value);
      await expect(
        makeReader(client).resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 })
      ).rejects.toMatchObject({ failure });
    }
  });

  test("accepts a legitimate later release and rejects stale or unmigrated Boardrooms", async () => {
    const migration = new FakeClient();
    migration.values.set(key(BOARDROOM, "migrationRequired"), true);
    await expect(
      makeReader(migration).resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 })
    ).rejects.toMatchObject({ failure: "storage-migration-required" });

    const releaseB = new FakeClient();
    const releaseBHash = `0x${"44".repeat(32)}` as Hex;
    releaseB.values.set(key(REGISTRY, "activeFacetSetHash"), releaseBHash);
    releaseB.values.set(key(REGISTRY, "activeRelease"), 2n);
    releaseB.values.set(key(REGISTRY, "facetSetMetadata"), {
      published: true,
      release: 2n,
      requiredStorageVersion: 1n,
      predecessorFacetSetHash: ACTIVE_FACET_SET_HASH,
      storageLayoutHash: STORAGE_LAYOUT_HASH,
      manifestHash: `0x${"45".repeat(32)}`,
      migrationFacet: "0x0000000000000000000000000000000000000000",
      migrationSelector: "0x00000000",
      selectorCount: 5n
    });
    releaseB.values.set(
      key(REGISTRY, "facets"),
      FACETS.map((facetAddress, index) => ({
        facetAddress: index === 4 ? RELEASE_B_FACET : facetAddress,
        functionSelectors: [FACET_SELECTORS[index]]
      }))
    );
    releaseB.values.set(key(BOARDROOM, "facetSetHash"), releaseBHash);
    const originalRead = releaseB.readContract.bind(releaseB);
    releaseB.readContract = async (input) => {
      const result = await originalRead(input);
      const selector =
        input.functionName === "route"
          ? input.args?.[0]
          : input.args?.[1];
      if (
        input.address.toLowerCase() === REGISTRY.toLowerCase() &&
        (input.functionName === "facetSetRoute" || input.functionName === "route") &&
        (selector as Hex | undefined)?.toLowerCase() === FACET_SELECTORS[4].toLowerCase()
      ) {
        return {
          facet: RELEASE_B_FACET,
          codeHash: keccak256(RELEASE_B_FACET_CODE),
          kind: 0,
          ...(input.functionName === "route"
            ? { requiredStorageVersion: 1n }
            : {})
        };
      }
      return result;
    };
    await expect(
      makeReader(releaseB).resolveCanonicalBoardroom({
        boardroom: BOARDROOM,
        chainId: 31337
      })
    ).resolves.toMatchObject({
      facetSetHash: releaseBHash,
      appliedStorageVersion: 1n
    });

    const staleBoardroom = new FakeClient();
    staleBoardroom.values.set(key(BOARDROOM, "facetSetHash"), `0x${"ee".repeat(32)}`);
    await expect(
      makeReader(staleBoardroom).resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 })
    ).rejects.toMatchObject({ failure: "stale-facet-set" });
  });

  test("authenticates an empty complete release and fails closed on absent Boardroom routes", async () => {
    const readable = new FakeClient();
    const emptyFacetSetHash = configureEmptyRelease(readable);
    await expect(
      makeReader(readable).resolveCanonicalBoardroom({
        boardroom: BOARDROOM,
        chainId: 31337
      })
    ).resolves.toMatchObject({ facetSetHash: emptyFacetSetHash });

    const inoperable = new FakeClient();
    configureEmptyRelease(inoperable);
    inoperable.boardroomFacetRoutesUnavailable = true;
    await expect(
      makeReader(inoperable).resolveCanonicalBoardroom({
        boardroom: BOARDROOM,
        chainId: 31337
      })
    ).rejects.toMatchObject({ failure: "rpc-failure" });
  });

  test("rejects incomplete facet inventories and route code-hash mismatches", async () => {
    const incomplete = new FakeClient();
    incomplete.values.set(
      key(REGISTRY, "facets"),
      FACETS.slice(0, 4).map((facetAddress, index) => ({
        facetAddress,
        functionSelectors: [FACET_SELECTORS[index]]
      }))
    );
    await expect(
      makeReader(incomplete).resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 })
    ).rejects.toMatchObject({ failure: "unsupported-release" });

    const wrongFacetCode = new FakeClient();
    const originalRead = wrongFacetCode.readContract.bind(wrongFacetCode);
    wrongFacetCode.readContract = async (input) => {
      const result = await originalRead(input);
      if (
        input.address.toLowerCase() === REGISTRY.toLowerCase() &&
        input.functionName === "facetSetRoute" &&
        (input.args?.[1] as Hex | undefined)?.toLowerCase() === FACET_SELECTORS[0]
      ) {
        return { ...(result as object), codeHash: `0x${"99".repeat(32)}` };
      }
      return result;
    };
    await expect(
      makeReader(wrongFacetCode).resolveCanonicalBoardroom({
        boardroom: BOARDROOM,
        chainId: 31337
      })
    ).rejects.toMatchObject({ failure: "unsupported-release" });
  });

  test("rejects unknown chains and all pre-protocol-v1 deployment identities", async () => {
    const client = new FakeClient();
    const unknown = makeReader(client);
    await expect(
      unknown.resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 1 })
    ).rejects.toMatchObject({ failure: "unknown-chain" });

    const unsupported = createBoardroomControlChainReader({
      chains: [chain(31337)],
      createClient: () => client,
      getDeployment: () => ({
        ...deployment(31337),
        deterministicDeploymentVersion: "pledge.cash.unsupported"
      })
    });
    await expect(
      unsupported.resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 })
    ).rejects.toMatchObject({ failure: "unsupported-release" });

    const releaseMetadataIsNotDeploymentPinned =
      createBoardroomControlChainReader({
        chains: [chain(31337)],
        createClient: () => client,
        getDeployment: () => ({
          ...deployment(31337),
          activeFacetSetHash: `0x${"ff".repeat(32)}`,
          activeRelease: 99n,
          selectorCount: 99n
        })
      });
    await expect(
      releaseMetadataIsNotDeploymentPinned.resolveCanonicalBoardroom({
        boardroom: BOARDROOM,
        chainId: 31337
      })
    ).resolves.toMatchObject({ facetSetHash: ACTIVE_FACET_SET_HASH });
  });

  test("rejects an RPC endpoint serving a different chain", async () => {
    const client = new FakeClient();
    client.rpcChainId = 1;
    await expect(
      makeReader(client).resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 })
    ).rejects.toMatchObject({ failure: "unknown-chain" });
  });

  test("keeps the same controller address chain-scoped", async () => {
    const first = new FakeClient();
    const second = new FakeClient();
    first.rpcChainId = 1;
    second.rpcChainId = 10;
    second.blockNumber = 200n;
    second.blockHash = REORG_HASH;
    const clients = new Map<number, FakeClient>([
      [1, first],
      [10, second]
    ]);
    const reader = createBoardroomControlChainReader({
      chains: [chain(1), chain(10)],
      createClient: (config) => clients.get(config.chainId) as FakeClient,
      getDeployment: (chainId) => deployment(chainId)
    });

    const one = await reader.resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 1 });
    const ten = await reader.resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 10 });
    expect(one.controller).toBe(ten.controller);
    expect(one.chainId).toBe(1);
    expect(ten.chainId).toBe(10);
    expect(one.blockHash).not.toBe(ten.blockHash);
  });

  test("turns transport failures into a closed RPC result", async () => {
    const client = new FakeClient();
    client.rpcFailure = true;
    await expect(
      makeReader(client).resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 })
    ).rejects.toMatchObject({ failure: "rpc-failure" });
  });
});

function makeReader(client: FakeClient) {
  return createBoardroomControlChainReader({
    chains: [chain(31337)],
    createClient: () => client,
    getDeployment: () => deployment(31337)
  });
}

async function expectVerificationFailure(client: FakeClient, failure: string) {
  const reader = makeReader(client);
  const snapshot = await reader.resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 });
  await expect(
    reader.verifyControlSignature({ expected: snapshot, message: "message", signature: "0x11" })
  ).rejects.toMatchObject({ failure });
}

function chain(chainId: number): SentinelChainConfig {
  return { chainId, confirmations: 0, rpcUrl: `https://rpc-${chainId}.invalid` };
}

function deployment(chainId: number): PledgeCashDeployment {
  return {
    activeFacetSetHash: ACTIVE_FACET_SET_HASH,
    activeRelease: 1n,
    authorityFacet: FACETS[0],
    authorityFacetCodeHash: keccak256(FACET_CODES[0]),
    boardroomControllerFactory: CONTROLLER_FACTORY,
    boardroomControllerFactoryCodeHash: keccak256(CONTROLLER_FACTORY_CODE),
    boardroomControllerLogic: CONTROLLER_LOGIC,
    boardroomControllerLogicCodeHash: keccak256(CONTROLLER_LOGIC_CODE),
    boardroomFactory: FACTORY,
    boardroomFactoryCodeHash: keccak256(FACTORY_CODE),
    boardroomGovernanceLogic: GOVERNANCE_LOGIC,
    boardroomGovernanceLogicCodeHash: keccak256(GOVERNANCE_LOGIC_CODE),
    boardroomKernel: KERNEL,
    boardroomKernelCodeHash: keccak256(KERNEL_CODE),
    boardroomMarketLogic: MARKET_LOGIC,
    boardroomMarketLogicCodeHash: keccak256(MARKET_LOGIC_CODE),
    boardroomRedemptionPayout: REDEMPTION_PAYOUT,
    boardroomRedemptionPayoutCodeHash: keccak256(REDEMPTION_PAYOUT_CODE),
    chainId,
    deterministicDeployment: true,
    deterministicDeploymentVersion: SUPPORTED_BOARDROOM_CONTROL_RELEASE,
    deterministicReleaseCodeHash: PROTOCOL_RELEASE_CODE_HASH,
    executionFacet: FACETS[1],
    executionFacetCodeHash: keccak256(FACET_CODES[1]),
    kernelSelectorSetHash: KERNEL_SELECTOR_SET_HASH,
    manifestHash: MANIFEST_HASH,
    marketFacet: FACETS[2],
    marketFacetCodeHash: keccak256(FACET_CODES[2]),
    protocolFacetRegistry: REGISTRY,
    protocolFacetRegistryCodeHash: keccak256(REGISTRY_CODE),
    protocolFacetRegistryOwner: REGISTRY_CEREMONY_OWNER,
    protocolGovernance: GOVERNANCE,
    protocolReleaseCodeHash: PROTOCOL_RELEASE_CODE_HASH,
    protocolVersion: SUPPORTED_BOARDROOM_CONTROL_RELEASE,
    redemptionFacet: FACETS[3],
    redemptionFacetCodeHash: keccak256(FACET_CODES[3]),
    requiredStorageLayoutHash: STORAGE_LAYOUT_HASH,
    requiredStorageVersion: 1n,
    selectorCount: 5n,
    viewFacet: FACETS[4],
    viewFacetCodeHash: keccak256(FACET_CODES[4])
  } as PledgeCashDeployment;
}

function configureEmptyRelease(client: FakeClient): Hex {
  const facetSetHash = `0x${"46".repeat(32)}` as Hex;
  client.values.set(key(REGISTRY, "activeFacetSetHash"), facetSetHash);
  client.values.set(key(REGISTRY, "activeRelease"), 2n);
  client.values.set(key(REGISTRY, "facetSetMetadata"), {
    published: true,
    release: 2n,
    requiredStorageVersion: 1n,
    predecessorFacetSetHash: ACTIVE_FACET_SET_HASH,
    storageLayoutHash: STORAGE_LAYOUT_HASH,
    manifestHash: `0x${"47".repeat(32)}`,
    migrationFacet: "0x0000000000000000000000000000000000000000",
    migrationSelector: "0x00000000",
    selectorCount: 0n
  });
  client.values.set(key(REGISTRY, "facetSetSelectors"), []);
  client.values.set(key(REGISTRY, "facets"), []);
  client.values.set(key(BOARDROOM, "facetSetHash"), facetSetHash);
  return facetSetHash;
}

function cloneCode(implementation: Address): Hex {
  return `0x3d3d3d3d363d3d37363d73${implementation.slice(2).toLowerCase()}5af43d3d93803e602a57fd5bf3`;
}

function key(address: Address, functionName: string): string {
  return `${address.toLowerCase()}:${functionName}`;
}
