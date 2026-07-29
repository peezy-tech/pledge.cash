import { describe, expect, test } from "bun:test";
import { keccak256, type Address, type Hex } from "viem";

import {
  assertLiveBoardroomVNextControlRelease,
  boardroomVNextReleaseSupport,
  BoardroomVNextControlReleaseProofError,
  type BoardroomVNextControlProofClient,
  type BoardroomVNextReleaseAttestation,
} from "../src";

const liveCode = "0x6000" as Hex;
const liveCodeHash = keccak256(liveCode);
const activeFacetSetHash = `0x${"11".repeat(32)}` as Hex;
const storageLayoutHash = `0x${"22".repeat(32)}` as Hex;
const registryOwner = "0x1000000000000000000000000000000000000001" as Address;
const facetRegistry = "0x1000000000000000000000000000000000000002" as Address;
const factory = "0x1000000000000000000000000000000000000003" as Address;
const kernel = "0x1000000000000000000000000000000000000004" as Address;
const controllerFactory = "0x1000000000000000000000000000000000000005" as Address;
const controllerImplementation = "0x1000000000000000000000000000000000000006" as Address;
const legacyBoardroomLogic = "0x1000000000000000000000000000000000000007" as Address;
const facet = "0x1000000000000000000000000000000000000008" as Address;
const governanceLogic = "0x1000000000000000000000000000000000000009" as Address;
const marketLogic = "0x100000000000000000000000000000000000000a" as Address;
const redemptionPayoutLogic = "0x100000000000000000000000000000000000000b" as Address;
const boardroom = "0x2000000000000000000000000000000000000001" as Address;
const shareToken = "0x2000000000000000000000000000000000000002" as Address;
const prelaunchOwner = "0x2000000000000000000000000000000000000003" as Address;
const zeroAddress = "0x0000000000000000000000000000000000000000" as Address;

function attestation(
  overrides: Partial<BoardroomVNextReleaseAttestation> = {},
): BoardroomVNextReleaseAttestation {
  return {
    registryOwner,
    facetRegistry,
    facetRegistryCodeHash: liveCodeHash,
    factory,
    factoryCodeHash: liveCodeHash,
    kernel,
    kernelCodeHash: liveCodeHash,
    controllerFactory,
    controllerFactoryCodeHash: liveCodeHash,
    controllerImplementation,
    controllerImplementationCodeHash: liveCodeHash,
    legacyBoardroomLogic,
    legacyBoardroomLogicCodeHash: liveCodeHash,
    governanceLogic,
    governanceLogicCodeHash: liveCodeHash,
    marketLogic,
    marketLogicCodeHash: liveCodeHash,
    redemptionPayoutLogic,
    redemptionPayoutLogicCodeHash: liveCodeHash,
    activeFacetSetHash,
    activeRelease: 2n,
    requiredStorageVersion: 2n,
    requiredStorageLayoutHash: storageLayoutHash,
    facets: [{ facetAddress: facet, codeHash: liveCodeHash, functionSelectors: ["0x12345678"] }],
    ...overrides,
  };
}

describe("vNext Boardroom release proof", () => {
  test("fails closed on absent or malformed release attestations", () => {
    expect(boardroomVNextReleaseSupport(undefined).supported).toBe(false);
    expect(boardroomVNextReleaseSupport(attestation())).toEqual({ supported: true });
    expect(
      boardroomVNextReleaseSupport(
        attestation({
          facets: [
            { facetAddress: facet, codeHash: liveCodeHash, functionSelectors: ["0x12345678"] },
            { facetAddress: facet, codeHash: liveCodeHash, functionSelectors: ["0x87654321"] },
          ],
        }),
      ).supported,
    ).toBe(false);
  });

  test("pins one block and proves prelaunch registry, release, code, and reciprocal factory identity", async () => {
    const release = attestation();
    const values: Record<string, unknown> = {
      [`${facetRegistry}:owner`]: registryOwner,
      [`${facetRegistry}:activeFacetSetHash`]: activeFacetSetHash,
      [`${facetRegistry}:activeRelease`]: 2n,
      [`${facetRegistry}:activeStorageVersion`]: 2n,
      [`${facetRegistry}:activeStorageLayoutHash`]: storageLayoutHash,
      [`${facetRegistry}:facets`]: [{ facetAddress: facet, functionSelectors: ["0x12345678"] }],
      [`${factory}:facetRegistry`]: facetRegistry,
      [`${factory}:boardroomKernelLogic`]: kernel,
      [`${factory}:controllerFactory`]: controllerFactory,
      [`${factory}:legacyBoardroomLogic`]: legacyBoardroomLogic,
      [`${factory}:governanceLogic`]: governanceLogic,
      [`${factory}:marketLogic`]: marketLogic,
      [`${factory}:redemptionPayoutLogic`]: redemptionPayoutLogic,
      [`${factory}:isBoardroom`]: true,
      [`${factory}:isShareToken`]: true,
      [`${kernel}:facetRegistry`]: facetRegistry,
      [`${boardroom}:shareToken`]: shareToken,
      [`${boardroom}:facetRegistry`]: facetRegistry,
      [`${boardroom}:facetSetHash`]: activeFacetSetHash,
      [`${boardroom}:appliedStorageVersion`]: 2n,
      [`${boardroom}:appliedStorageLayoutHash`]: storageLayoutHash,
      [`${boardroom}:migrationRequired`]: false,
      [`${boardroom}:launched`]: false,
      [`${boardroom}:owner`]: prelaunchOwner,
      [`${boardroom}:controller`]: zeroAddress,
      [`${boardroom}:controllerGeneration`]: 0n,
      [`${boardroom}:controllerFactory`]: controllerFactory,
      [`${boardroom}:governanceLogic`]: governanceLogic,
      [`${boardroom}:marketLogic`]: marketLogic,
      [`${boardroom}:redemptionPayoutLogic`]: redemptionPayoutLogic,
      [`${controllerFactory}:boardroomFactory`]: factory,
      [`${controllerFactory}:controllerImplementation`]: controllerImplementation,
    };
    const client: BoardroomVNextControlProofClient = {
      getBlockNumber: async () => 77n,
      getCode: async ({ blockNumber }) => {
        expect(blockNumber).toBe(77n);
        return liveCode;
      },
      readContract: async ({ address, functionName, blockNumber }) => {
        expect(blockNumber).toBe(77n);
        const key = `${address}:${String(functionName)}`;
        if (!(key in values)) throw new Error(`Unexpected proof read ${key}`);
        return values[key] as never;
      },
    } as BoardroomVNextControlProofClient;

    await expect(assertLiveBoardroomVNextControlRelease(client, release, boardroom)).resolves.toEqual({
      blockNumber: 77n,
      facetSetHash: activeFacetSetHash,
      activeRelease: 2n,
      appliedStorageVersion: 2n,
      appliedStorageLayoutHash: storageLayoutHash,
      migrationRequired: false,
      launched: false,
      controller: zeroAddress,
      controllerGeneration: 0n,
    });
  });

  test("rejects a live code hash that differs from the attestation", async () => {
    const client = {
      getBlockNumber: async () => 77n,
      getCode: async () => "0x6001" as Hex,
      readContract: async () => {
        throw new Error("reads must not run after a code mismatch");
      },
    } as unknown as BoardroomVNextControlProofClient;

    await expect(
      assertLiveBoardroomVNextControlRelease(client, attestation(), boardroom),
    ).rejects.toBeInstanceOf(BoardroomVNextControlReleaseProofError);
  });
});
