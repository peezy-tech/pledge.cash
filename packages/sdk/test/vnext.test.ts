import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "viem";
import {
  boardroomAbi,
  boardroomDiamondAbi,
  buildBoardroomVNextBeginSnapshotTransaction,
  buildBoardroomVNextBurnTreasurySharesTransaction,
  buildBoardroomVNextClaimRedemptionAssetTransaction,
  buildBoardroomVNextCloseProtocolLiquidityAfterWindDownTransaction,
  buildBoardroomVNextCreateTransaction,
  buildBoardroomVNextExecuteBatchTransaction,
  buildBoardroomVNextExecuteControllerOperationTransaction,
  buildBoardroomVNextExitProtocolLiquidityTransaction,
  buildBoardroomVNextExecuteTransaction,
  buildBoardroomVNextExecuteOperationTransaction,
  buildBoardroomVNextExecuteWindDownCallTransaction,
  buildBoardroomVNextLaunchTransaction,
  buildBoardroomVNextMigrateTransaction,
  buildBoardroomVNextMintTransaction,
  buildBoardroomVNextOpenRedemptionsTransaction,
  buildBoardroomVNextMutationTransaction,
  buildBoardroomVNextPruneObligationTransaction,
  buildBoardroomVNextPruneObligationsTransaction,
  buildBoardroomVNextRegisterRedeemableAssetTransaction,
  buildBoardroomVNextRedeemTransaction,
  buildBoardroomVNextReturnProtocolLiquidityAsLpTransaction,
  buildBoardroomVNextScheduleControllerOperationTransaction,
  buildBoardroomVNextScheduleOperationTransaction,
  buildBoardroomVNextSnapshotAssetsTransaction,
  buildBoardroomVNextStartWindDownTransaction,
  buildBoardroomVNextVetoTransaction,
  buildBoardroomVNextWrapNativeBalanceTransaction,
  protocolFacetRegistryAbi,
  readBoardroomVNextControllerState,
  readBoardroomVNextState,
  readProtocolFacetRegistryState,
  readProtocolFacetRelease,
  type BoardroomVNextMutationFunctionName,
} from "../src";

const boardroom = "0x0000000000000000000000000000000000000b0a" as Address;
const registry = "0x0000000000000000000000000000000000000fac" as Address;
const facet = "0x0000000000000000000000000000000000000f01" as Address;
const asset = "0x0000000000000000000000000000000000000a55" as Address;
const recipient = "0x0000000000000000000000000000000000000b0b" as Address;
const expectedFacetSetHash =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
const manifestHash =
  "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex;
const codeHash =
  "0x3333333333333333333333333333333333333333333333333333333333333333" as Hex;
const storageLayoutHash =
  "0x4444444444444444444444444444444444444444444444444444444444444444" as Hex;
const selector = "0x12345678" as Hex;

describe("vNext Boardroom SDK", () => {
  test("keeps the v5 and vNext aggregate ABIs separate", () => {
    expect(boardroomDiamondAbi).not.toBe(boardroomAbi);
    expect(boardroomDiamondAbi.some((item) => item.type === "function" && item.name === "migrateBoardroom")).toBe(true);
    expect(protocolFacetRegistryAbi.some((item) => item.type === "function" && item.name === "facets")).toBe(true);
    expect(boardroomAbi.some((item) => item.type === "function" && item.name === "migrateBoardroom")).toBe(false);
  });

  test("requires the expected facet-set hash on every state-changing Boardroom route", () => {
    const stateChangingFunctions = boardroomDiamondAbi.filter(
      (item) =>
        item.type === "function"
        && item.stateMutability !== "view"
        && item.stateMutability !== "pure",
    );
    expect(stateChangingFunctions.length).toBeGreaterThan(0);
    for (const item of stateChangingFunctions) {
      expect(item.inputs[0]).toMatchObject({
        name: "expectedFacetSetHash",
        type: "bytes32",
      });
      expect(buildBoardroomVNextMutationTransaction({
        boardroom,
        expectedFacetSetHash,
        functionName: item.name as BoardroomVNextMutationFunctionName,
      })).toMatchObject({
        address: boardroom,
        abi: boardroomDiamondAbi,
        functionName: item.name,
        args: [expectedFacetSetHash],
      });
    }
  });

  test("builds hash-bound lifecycle, execution, redemption, and migration calls", () => {
    const call = {
      policy: asset,
      target: recipient,
      value: 7n,
      data: "0x1234" as Hex,
    };
    const launchConfig = {
      proposer: recipient,
      predictedController: asset,
      protectionStaker: recipient,
      expectedRewardPool: asset,
      expectedRedemptionExcessRecipient: recipient,
      controllerDelay: 1n,
      windDownDelay: 2n,
      gracePeriod: 3n,
      generation: 1n,
    };

    expect(buildBoardroomVNextStartWindDownTransaction({
      boardroom,
      expectedFacetSetHash,
    })).toMatchObject({
      address: boardroom,
      abi: boardroomDiamondAbi,
      functionName: "startWindDown",
      args: [expectedFacetSetHash],
    });
    expect(buildBoardroomVNextBeginSnapshotTransaction({
      boardroom,
      expectedFacetSetHash,
    }).args).toEqual([expectedFacetSetHash]);
    expect(buildBoardroomVNextMintTransaction({
      boardroom,
      expectedFacetSetHash,
      to: recipient,
      amount: 10n,
    }).args).toEqual([expectedFacetSetHash, recipient, 10n]);
    expect(buildBoardroomVNextLaunchTransaction({
      boardroom,
      expectedFacetSetHash,
      config: launchConfig,
    }).args).toEqual([expectedFacetSetHash, launchConfig]);
    expect(buildBoardroomVNextExecuteTransaction({
      boardroom,
      expectedFacetSetHash,
      call,
    })).toMatchObject({
      functionName: "execute",
      args: [expectedFacetSetHash, call],
      value: 7n,
    });
    expect(buildBoardroomVNextExecuteBatchTransaction({
      boardroom,
      expectedFacetSetHash,
      calls: [call, { ...call, value: 5n }],
    })).toMatchObject({
      functionName: "executeBatch",
      args: [expectedFacetSetHash, [call, { ...call, value: 5n }]],
      value: 12n,
    });
    expect(buildBoardroomVNextExecuteWindDownCallTransaction({
      boardroom,
      expectedFacetSetHash,
      call: { ...call, value: 0n },
    })).toMatchObject({
      functionName: "executeWindDownCall",
      args: [expectedFacetSetHash, { ...call, value: 0n }],
    });
    expect(buildBoardroomVNextPruneObligationsTransaction({
      boardroom,
      expectedFacetSetHash,
      obligations: [asset, recipient],
    }).args).toEqual([expectedFacetSetHash, [asset, recipient]]);
    expect(buildBoardroomVNextPruneObligationTransaction({
      boardroom,
      expectedFacetSetHash,
      obligation: asset,
    }).args).toEqual([expectedFacetSetHash, asset]);
    expect(buildBoardroomVNextRegisterRedeemableAssetTransaction({
      boardroom,
      expectedFacetSetHash,
      asset,
    }).args).toEqual([expectedFacetSetHash, asset]);
    expect(buildBoardroomVNextVetoTransaction({
      boardroom,
      expectedFacetSetHash,
      operationId: manifestHash,
    }).args).toEqual([expectedFacetSetHash, manifestHash]);
    expect(buildBoardroomVNextSnapshotAssetsTransaction({
      boardroom,
      expectedFacetSetHash,
      maximum: 32n,
    }).args).toEqual([expectedFacetSetHash, 32n]);
    expect(buildBoardroomVNextOpenRedemptionsTransaction({
      boardroom,
      expectedFacetSetHash,
    }).args).toEqual([expectedFacetSetHash]);
    expect(buildBoardroomVNextWrapNativeBalanceTransaction({
      boardroom,
      expectedFacetSetHash,
    }).args).toEqual([expectedFacetSetHash]);
    expect(buildBoardroomVNextBurnTreasurySharesTransaction({
      boardroom,
      expectedFacetSetHash,
    }).args).toEqual([expectedFacetSetHash]);
    expect(buildBoardroomVNextExitProtocolLiquidityTransaction({
      boardroom,
      expectedFacetSetHash,
      amountAMin: 1n,
      amountBMin: 2n,
      deadline: 3n,
    }).args).toEqual([expectedFacetSetHash, 1n, 2n, 3n]);
    expect(buildBoardroomVNextReturnProtocolLiquidityAsLpTransaction({
      boardroom,
      expectedFacetSetHash,
    }).args).toEqual([expectedFacetSetHash]);
    expect(buildBoardroomVNextCloseProtocolLiquidityAfterWindDownTransaction({
      boardroom,
      expectedFacetSetHash,
    }).args).toEqual([expectedFacetSetHash]);
    expect(buildBoardroomVNextRedeemTransaction({
      boardroom,
      expectedFacetSetHash,
      shares: 5n,
    }).args).toEqual([expectedFacetSetHash, 5n]);
    expect(buildBoardroomVNextClaimRedemptionAssetTransaction({
      boardroom,
      expectedFacetSetHash,
      asset,
      recipient,
      minAmountOut: 3n,
    }).args).toEqual([expectedFacetSetHash, asset, recipient, 3n]);
    expect(buildBoardroomVNextMigrateTransaction({
      boardroom,
      expectedFacetSetHash,
    }).args).toEqual([expectedFacetSetHash]);
    expect(buildBoardroomVNextCreateTransaction({
      factory: recipient,
      expectedFacetSetHash,
      owner: recipient,
      name: "vNext",
      symbol: "VNX",
      salt: manifestHash,
    }).args).toEqual([
      expectedFacetSetHash,
      recipient,
      "vNext",
      "VNX",
      manifestHash,
    ]);
    expect(buildBoardroomVNextScheduleOperationTransaction({
      controller: recipient,
      expectedFacetSetHash,
      calls: [call],
      salt: manifestHash,
      expectedBoardroomEpoch: 1n,
      expectedConfigurationEpoch: 2n,
    }).args).toEqual([
      expectedFacetSetHash,
      [call],
      manifestHash,
      1n,
      2n,
    ]);
    expect(buildBoardroomVNextExecuteOperationTransaction({
      controller: recipient,
      expectedFacetSetHash,
      calls: [call],
      salt: manifestHash,
      expectedBoardroomEpoch: 1n,
      expectedConfigurationEpoch: 2n,
      authority: asset,
    }).args).toEqual([
      expectedFacetSetHash,
      [call],
      manifestHash,
      1n,
      2n,
      asset,
    ]);
    expect(buildBoardroomVNextScheduleControllerOperationTransaction({
      controller: recipient,
      expectedFacetSetHash,
      data: call.data,
      salt: manifestHash,
      expectedBoardroomEpoch: 1n,
      expectedConfigurationEpoch: 2n,
    }).args).toEqual([
      expectedFacetSetHash,
      call.data,
      manifestHash,
      1n,
      2n,
    ]);
    expect(buildBoardroomVNextExecuteControllerOperationTransaction({
      controller: recipient,
      expectedFacetSetHash,
      data: call.data,
      salt: manifestHash,
      expectedBoardroomEpoch: 1n,
      expectedConfigurationEpoch: 2n,
      authority: asset,
    }).args).toEqual([
      expectedFacetSetHash,
      call.data,
      manifestHash,
      1n,
      2n,
      asset,
    ]);
  });

  test("rejects missing or malformed facet-set hashes at runtime", () => {
    expect(() => buildBoardroomVNextStartWindDownTransaction({
      boardroom,
      expectedFacetSetHash: "0x1234",
    })).toThrow("expectedFacetSetHash must be a 32-byte hex value.");
    expect(() => buildBoardroomVNextRedeemTransaction({
      boardroom,
      expectedFacetSetHash: undefined as unknown as Hex,
      shares: 1n,
    })).toThrow("expectedFacetSetHash must be a 32-byte hex value.");
    expect(() => buildBoardroomVNextExecuteBatchTransaction({
      boardroom,
      expectedFacetSetHash,
      calls: [],
    })).toThrow("Boardroom execution batches must contain between 1 and 16 calls.");
    expect(() => buildBoardroomVNextExecuteBatchTransaction({
      boardroom,
      expectedFacetSetHash,
      calls: Array.from({ length: 17 }, () => ({
        policy: asset,
        target: recipient,
        value: 0n,
        data: "0x" as Hex,
      })),
    })).toThrow("Boardroom execution batches must contain between 1 and 16 calls.");
    expect(() => buildBoardroomVNextExecuteWindDownCallTransaction({
      boardroom,
      expectedFacetSetHash,
      call: {
        policy: asset,
        target: recipient,
        value: 1n,
        data: "0x" as Hex,
      },
    })).toThrow("Wind-down calls cannot transfer native value.");
  });

  test("reads active registry, release, facet inventory, and Boardroom migration state", async () => {
    const readRequests: Array<{ functionName: string; blockNumber?: bigint }> = [];
    const values: Record<string, unknown> = {
      facetRegistry: registry,
      owner: recipient,
      shareToken: asset,
      controller: facet,
      status: 1,
      governanceEpoch: 4n,
      activeObligationCount: 3n,
      redeemableAssetCount: 2n,
      rewardPool: asset,
      liquidityLocker: facet,
      facetSetHash: expectedFacetSetHash,
      appliedStorageVersion: 1n,
      appliedStorageLayoutHash: manifestHash,
      migrationRequired: true,
      activeFacetSetHash: expectedFacetSetHash,
      activeRelease: 2n,
      activeStorageVersion: 2n,
      activeStorageLayoutHash: storageLayoutHash,
      facets: [{
        facetAddress: facet,
        functionSelectors: [selector],
      }],
      facetSetMetadata: [
        true,
        2n,
        2n,
        expectedFacetSetHash,
        storageLayoutHash,
        manifestHash,
        facet,
        selector,
        1n,
      ],
      facetSetSelectors: [selector],
      facetSetRoute: [facet, codeHash, 1],
      factory: registry,
      boardroom,
      proposer: recipient,
      delay: 86_400n,
      gracePeriod: 172_800n,
      generation: 1n,
      configurationEpoch: 2n,
      configurationHash: manifestHash,
    };
    const client = {
      getBlockNumber: async () => 123n,
      readContract: async (
        request: { functionName: string; blockNumber?: bigint },
      ) => {
        readRequests.push(request);
        return values[request.functionName];
      },
    } as never;

    await expect(readProtocolFacetRegistryState(client, registry)).resolves.toEqual({
      address: registry,
      blockNumber: 123n,
      activeFacetSetHash: expectedFacetSetHash,
      activeRelease: 2n,
      requiredStorageVersion: 2n,
      requiredStorageLayoutHash: storageLayoutHash,
      facets: [{
        facetAddress: facet,
        functionSelectors: [selector],
      }],
    });
    await expect(readProtocolFacetRelease(client, registry)).resolves.toEqual({
      registry,
      blockNumber: 123n,
      facetSetHash: expectedFacetSetHash,
      published: true,
      release: 2n,
      requiredStorageVersion: 2n,
      predecessorFacetSetHash: expectedFacetSetHash,
      storageLayoutHash,
      manifestHash,
      migrationFacet: facet,
      migrationSelector: selector,
      selectorCount: 1n,
      facets: [{
        facetAddress: facet,
        functionSelectors: [selector],
      }],
      routes: [{
        selector,
        facet,
        codeHash,
        kind: 1,
      }],
    });
    await expect(readBoardroomVNextState(client, boardroom)).resolves.toEqual({
      address: boardroom,
      blockNumber: 123n,
      owner: recipient,
      shareToken: asset,
      controller: facet,
      status: 1,
      governanceEpoch: 4n,
      activeObligationCount: 3n,
      redeemableAssetCount: 2n,
      rewardPool: asset,
      liquidityLocker: facet,
      facetRegistry: registry,
      requiredFacetSetHash: expectedFacetSetHash,
      activeRelease: 2n,
      appliedStorageVersion: 1n,
      appliedStorageLayoutHash: manifestHash,
      requiredStorageVersion: 2n,
      requiredStorageLayoutHash: storageLayoutHash,
      migrationRequired: true,
    });
    await expect(readBoardroomVNextControllerState(client, facet)).resolves.toEqual({
      address: facet,
      blockNumber: 123n,
      factory: registry,
      boardroom,
      proposer: recipient,
      delay: 86_400n,
      gracePeriod: 172_800n,
      generation: 1n,
      configurationEpoch: 2n,
      configurationHash: manifestHash,
    });
    expect(readRequests.length).toBeGreaterThan(0);
    expect(readRequests.every((request) => request.blockNumber === 123n)).toBe(true);
  });
});
