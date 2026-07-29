import { describe, expect, test } from "bun:test";
import { encodeErrorResult, keccak256, type Address, type Hex } from "viem";

import {
  assertLiveBoardroomVNextControlRelease,
  boardroomKernelAbi,
  boardroomVNextReleaseSupport,
  decodeKnownPledgeCashError,
  discoverBoardroomsVNext,
  type BoardroomVNextReleaseAttestation,
  type PledgeCashLogClient,
} from "../src";

const registry = "0x0000000000000000000000000000000000000101" as Address;
const factory = "0x0000000000000000000000000000000000000102" as Address;
const kernel = "0x0000000000000000000000000000000000000103" as Address;
const controllerFactory = "0x0000000000000000000000000000000000000104" as Address;
const controllerImplementation = "0x0000000000000000000000000000000000000105" as Address;
const legacyLogic = "0x0000000000000000000000000000000000000106" as Address;
const facet = "0x0000000000000000000000000000000000000107" as Address;
const boardroom = "0x0000000000000000000000000000000000000108" as Address;
const shareToken = "0x0000000000000000000000000000000000000109" as Address;
const owner = "0x000000000000000000000000000000000000010a" as Address;
const governanceLogic = "0x000000000000000000000000000000000000010b" as Address;
const marketLogic = "0x000000000000000000000000000000000000010c" as Address;
const redemptionPayoutLogic = "0x000000000000000000000000000000000000010d" as Address;
const zeroAddress = "0x0000000000000000000000000000000000000000" as Address;
const facetSetHash = `0x${"11".repeat(32)}` as Hex;
const storageLayoutHash = `0x${"22".repeat(32)}` as Hex;
const selector = "0x12345678" as Hex;
const runtime = "0x6000" as Hex;
const runtimeHash = keccak256(runtime);

const attestation: BoardroomVNextReleaseAttestation = {
  registryOwner: owner,
  facetRegistry: registry,
  facetRegistryCodeHash: runtimeHash,
  factory,
  factoryCodeHash: runtimeHash,
  kernel,
  kernelCodeHash: runtimeHash,
  controllerFactory,
  controllerFactoryCodeHash: runtimeHash,
  controllerImplementation,
  controllerImplementationCodeHash: runtimeHash,
  legacyBoardroomLogic: legacyLogic,
  legacyBoardroomLogicCodeHash: runtimeHash,
  governanceLogic,
  governanceLogicCodeHash: runtimeHash,
  marketLogic,
  marketLogicCodeHash: runtimeHash,
  redemptionPayoutLogic,
  redemptionPayoutLogicCodeHash: runtimeHash,
  activeFacetSetHash: facetSetHash,
  activeRelease: 2n,
  requiredStorageVersion: 2n,
  requiredStorageLayoutHash: storageLayoutHash,
  facets: [{
    facetAddress: facet,
    codeHash: runtimeHash,
    functionSelectors: [selector],
  }],
};

describe("vNext ecosystem helpers", () => {
  test("discovers vNext Boardrooms from their dedicated creation event", async () => {
    const client: PledgeCashLogClient = {
      async getLogs() {
        return [{
          args: {
            boardroom,
            owner,
            policyRegistry: registry,
            wrappedNative: legacyLogic,
            shareToken,
            name: "vNext Boardroom",
            symbol: "VNX",
            salt: storageLayoutHash,
            facetSetHash,
          },
          blockNumber: 42n,
          logIndex: 3,
          transactionHash: `0x${"33".repeat(32)}`,
        }] as never;
      },
    };

    await expect(discoverBoardroomsVNext(client, {
      factory,
      owner,
      fromBlock: 40n,
      toBlock: 50n,
    })).resolves.toMatchObject({
      complete: true,
      items: [{
        boardroom,
        owner,
        policyRegistry: registry,
        wrappedNative: legacyLogic,
        shareToken,
        name: "vNext Boardroom",
        symbol: "VNX",
        salt: storageLayoutHash,
        facetSetHash,
        createdAtBlock: 42n,
      }],
    });
  });

  test("decodes stale-hash and migration failures from the kernel ABI", () => {
    const data = encodeErrorResult({
      abi: boardroomKernelAbi,
      errorName: "FacetSetHashMismatch",
      args: [facetSetHash, storageLayoutHash],
    });
    expect(decodeKnownPledgeCashError(data)).toMatchObject({
      name: "FacetSetHashMismatch",
      args: [facetSetHash, storageLayoutHash],
    });
  });

  test("fails closed on malformed release attestations", () => {
    expect(boardroomVNextReleaseSupport(attestation)).toEqual({ supported: true });
    expect(boardroomVNextReleaseSupport({
      ...attestation,
      activeFacetSetHash: `0x${"00".repeat(32)}`,
    }).supported).toBe(false);
    expect(boardroomVNextReleaseSupport({
      ...attestation,
      facets: [...attestation.facets, attestation.facets[0]!],
    }).supported).toBe(false);
  });

  test("proves a pinned prelaunch registry, facet, factory, kernel, and Boardroom graph", async () => {
    const values = new Map<string, unknown>([
      [`${registry}:owner`, owner],
      [`${registry}:activeFacetSetHash`, facetSetHash],
      [`${registry}:activeRelease`, 2n],
      [`${registry}:activeStorageVersion`, 2n],
      [`${registry}:activeStorageLayoutHash`, storageLayoutHash],
      [`${registry}:facets`, [{ facetAddress: facet, functionSelectors: [selector] }]],
      [`${factory}:facetRegistry`, registry],
      [`${factory}:boardroomKernelLogic`, kernel],
      [`${factory}:controllerFactory`, controllerFactory],
      [`${factory}:legacyBoardroomLogic`, legacyLogic],
      [`${factory}:governanceLogic`, governanceLogic],
      [`${factory}:marketLogic`, marketLogic],
      [`${factory}:redemptionPayoutLogic`, redemptionPayoutLogic],
      [`${factory}:isBoardroom`, true],
      [`${factory}:isShareToken`, true],
      [`${kernel}:facetRegistry`, registry],
      [`${boardroom}:shareToken`, shareToken],
      [`${boardroom}:facetRegistry`, registry],
      [`${boardroom}:facetSetHash`, facetSetHash],
      [`${boardroom}:appliedStorageVersion`, 2n],
      [`${boardroom}:appliedStorageLayoutHash`, storageLayoutHash],
      [`${boardroom}:migrationRequired`, false],
      [`${boardroom}:launched`, false],
      [`${boardroom}:owner`, owner],
      [`${boardroom}:controller`, zeroAddress],
      [`${boardroom}:controllerGeneration`, 0n],
      [`${boardroom}:controllerFactory`, controllerFactory],
      [`${boardroom}:governanceLogic`, governanceLogic],
      [`${boardroom}:marketLogic`, marketLogic],
      [`${boardroom}:redemptionPayoutLogic`, redemptionPayoutLogic],
      [`${controllerFactory}:boardroomFactory`, factory],
      [`${controllerFactory}:controllerImplementation`, controllerImplementation],
    ]);
    const client = {
      async getBlockNumber() {
        return 99n;
      },
      async getCode() {
        return runtime;
      },
      async readContract(request: { address: Address; functionName: string }) {
        const key = `${request.address}:${request.functionName}`;
        if (!values.has(key)) throw new Error(`Unexpected read: ${key}`);
        return values.get(key);
      },
    } as never;

    await expect(assertLiveBoardroomVNextControlRelease(client, attestation, boardroom)).resolves.toEqual({
      blockNumber: 99n,
      facetSetHash,
      activeRelease: 2n,
      appliedStorageVersion: 2n,
      appliedStorageLayoutHash: storageLayoutHash,
      migrationRequired: false,
      launched: false,
      controller: zeroAddress,
      controllerGeneration: 0n,
    });
  });
});
