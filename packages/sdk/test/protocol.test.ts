import { describe, expect, test } from "bun:test";
import { decodeFunctionData, type Address, type Hex } from "viem";
import {
  boardroomAbi,
  buildBoardroomBeginSnapshotTransaction,
  buildBoardroomBurnTreasurySharesTransaction,
  buildBoardroomClaimRedemptionAssetTransaction,
  buildBoardroomCloseProtocolLiquidityTransaction,
  buildBoardroomCreateTransaction,
  buildBoardroomExecuteBatchTransaction,
  buildControllerExecuteConfigurationOperationTransaction,
  buildBoardroomProtocolLiquidityExitTransaction,
  buildBoardroomExecuteTransaction,
  buildControllerExecuteBoardroomOperationTransaction,
  buildBoardroomExecuteWindDownCallTransaction,
  buildBoardroomLaunchTransaction,
  buildBoardroomMigrateTransaction,
  buildBoardroomMintCall,
  buildBoardroomMintTransaction,
  buildBoardroomOpenRedemptionsTransaction,
  buildBoardroomMutationTransaction,
  buildBoardroomPruneObligationTransaction,
  buildBoardroomPruneObligationsTransaction,
  buildBoardroomRegisterRedeemableAssetCall,
  buildBoardroomRegisterRedeemableAssetTransaction,
  buildBoardroomRedeemTransaction,
  buildBoardroomReplaceControllerCall,
  buildBoardroomReturnProtocolLiquidityClaimsTransaction,
  buildControllerScheduleConfigurationOperationTransaction,
  buildControllerScheduleBoardroomOperationTransaction,
  buildBoardroomSnapshotAssetsTransaction,
  buildBoardroomStartWindDownTransaction,
  buildBoardroomVetoOperationTransaction,
  buildBoardroomWrapNativeBalanceTransaction,
  planBoardroomCallExecution,
  protocolFacetRegistryAbi,
  readBoardroomProtocolControllerState,
  readBoardroomProtocolState,
  readProtocolFacetRegistryState,
  readProtocolFacetRelease,
  type BoardroomMutationFunctionName,
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

describe("Boardroom protocol SDK", () => {
  test("exposes the diamond ABI as the only canonical Boardroom ABI", () => {
    expect(boardroomAbi.some((item) => item.type === "function" && item.name === "migrateBoardroom")).toBe(true);
    expect(protocolFacetRegistryAbi.some((item) => item.type === "function" && item.name === "facets")).toBe(true);
  });

  test("requires the expected facet-set hash on every state-changing Boardroom route", () => {
    const stateChangingFunctions = boardroomAbi.filter(
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
      expect(buildBoardroomMutationTransaction({
        boardroom,
        expectedFacetSetHash,
        functionName: item.name as BoardroomMutationFunctionName,
      })).toMatchObject({
        address: boardroom,
        abi: boardroomAbi,
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

    expect(buildBoardroomStartWindDownTransaction({
      boardroom,
      expectedFacetSetHash,
    })).toMatchObject({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "startWindDown",
      args: [expectedFacetSetHash],
    });
    expect(buildBoardroomBeginSnapshotTransaction({
      boardroom,
      expectedFacetSetHash,
    }).args).toEqual([expectedFacetSetHash]);
    expect(buildBoardroomMintTransaction({
      boardroom,
      expectedFacetSetHash,
      to: recipient,
      amount: 10n,
    }).args).toEqual([expectedFacetSetHash, recipient, 10n]);
    expect(buildBoardroomLaunchTransaction({
      boardroom,
      expectedFacetSetHash,
      config: launchConfig,
    }).args).toEqual([expectedFacetSetHash, launchConfig]);
    expect(buildBoardroomExecuteTransaction({
      boardroom,
      expectedFacetSetHash,
      call,
    })).toMatchObject({
      functionName: "execute",
      args: [expectedFacetSetHash, call],
      value: 7n,
    });
    expect(buildBoardroomExecuteBatchTransaction({
      boardroom,
      expectedFacetSetHash,
      calls: [call, { ...call, value: 5n }],
    })).toMatchObject({
      functionName: "executeBatch",
      args: [expectedFacetSetHash, [call, { ...call, value: 5n }]],
      value: 12n,
    });
    expect(buildBoardroomExecuteWindDownCallTransaction({
      boardroom,
      expectedFacetSetHash,
      call: { ...call, value: 0n },
    })).toMatchObject({
      functionName: "executeWindDownCall",
      args: [expectedFacetSetHash, { ...call, value: 0n }],
    });
    expect(buildBoardroomPruneObligationsTransaction({
      boardroom,
      expectedFacetSetHash,
      obligations: [asset, recipient],
    }).args).toEqual([expectedFacetSetHash, [asset, recipient]]);
    expect(buildBoardroomPruneObligationTransaction({
      boardroom,
      expectedFacetSetHash,
      obligation: asset,
    }).args).toEqual([expectedFacetSetHash, asset]);
    expect(buildBoardroomRegisterRedeemableAssetTransaction({
      boardroom,
      expectedFacetSetHash,
      asset,
    }).args).toEqual([expectedFacetSetHash, asset]);
    expect(buildBoardroomVetoOperationTransaction({
      boardroom,
      expectedFacetSetHash,
      operationId: manifestHash,
    }).args).toEqual([expectedFacetSetHash, manifestHash]);
    expect(buildBoardroomSnapshotAssetsTransaction({
      boardroom,
      expectedFacetSetHash,
      maximum: 32n,
    }).args).toEqual([expectedFacetSetHash, 32n]);
    expect(buildBoardroomOpenRedemptionsTransaction({
      boardroom,
      expectedFacetSetHash,
    }).args).toEqual([expectedFacetSetHash]);
    expect(buildBoardroomWrapNativeBalanceTransaction({
      boardroom,
      expectedFacetSetHash,
    }).args).toEqual([expectedFacetSetHash]);
    expect(buildBoardroomBurnTreasurySharesTransaction({
      boardroom,
      expectedFacetSetHash,
    }).args).toEqual([expectedFacetSetHash]);
    expect(buildBoardroomProtocolLiquidityExitTransaction({
      boardroom,
      expectedFacetSetHash,
      amountAMin: 1n,
      amountBMin: 2n,
      deadline: 3n,
    }).args).toEqual([expectedFacetSetHash, 1n, 2n, 3n]);
    expect(buildBoardroomReturnProtocolLiquidityClaimsTransaction({
      boardroom,
      expectedFacetSetHash,
    }).args).toEqual([expectedFacetSetHash]);
    expect(buildBoardroomCloseProtocolLiquidityTransaction({
      boardroom,
      expectedFacetSetHash,
    }).args).toEqual([expectedFacetSetHash]);
    expect(buildBoardroomRedeemTransaction({
      boardroom,
      expectedFacetSetHash,
      shares: 5n,
    }).args).toEqual([expectedFacetSetHash, 5n]);
    expect(buildBoardroomClaimRedemptionAssetTransaction({
      boardroom,
      expectedFacetSetHash,
      asset,
      recipient,
      minAmountOut: 3n,
    }).args).toEqual([expectedFacetSetHash, asset, recipient, 3n]);
    expect(buildBoardroomMigrateTransaction({
      boardroom,
      expectedFacetSetHash,
    }).args).toEqual([expectedFacetSetHash]);
    expect(buildBoardroomCreateTransaction({
      factory: recipient,
      expectedFacetSetHash,
      owner: recipient,
      name: "Boardroom",
      symbol: "VNX",
      salt: manifestHash,
    }).args).toEqual([
      expectedFacetSetHash,
      recipient,
      "Boardroom",
      "VNX",
      manifestHash,
    ]);
    expect(buildControllerScheduleBoardroomOperationTransaction({
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
    expect(buildControllerExecuteBoardroomOperationTransaction({
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
    expect(buildControllerScheduleConfigurationOperationTransaction({
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
    expect(buildControllerExecuteConfigurationOperationTransaction({
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

  test("builds hash-bound Boardroom self-calls for controller, mint, and asset workflows", () => {
    const replacement = buildBoardroomReplaceControllerCall({
      boardroom,
      expectedFacetSetHash,
      expectedCurrentController: facet,
      expectedNextController: registry,
      nextProposer: recipient,
      nextDelay: 86_400n,
      nextGracePeriod: 604_800n,
      nextGeneration: 2n,
    });
    expect(replacement).toMatchObject({
      policy: "0x0000000000000000000000000000000000000000",
      target: boardroom,
      value: 0n,
    });
    const decodedReplacement = decodeFunctionData({
      abi: boardroomAbi,
      data: replacement.data,
    });
    expect(decodedReplacement.functionName).toBe("replaceController");
    expect(decodedReplacement.args?.[0]).toBe(expectedFacetSetHash);
    expect(String(decodedReplacement.args?.[1]).toLowerCase()).toBe(facet.toLowerCase());
    expect(String(decodedReplacement.args?.[2]).toLowerCase()).toBe(registry.toLowerCase());
    expect(String(decodedReplacement.args?.[3]).toLowerCase()).toBe(recipient.toLowerCase());
    expect(decodedReplacement.args?.slice(4)).toEqual([
      86_400n,
      604_800n,
      2n,
    ]);

    const mint = buildBoardroomMintCall({
      boardroom,
      expectedFacetSetHash,
      to: recipient,
      amount: 10n,
    });
    expect(mint).toMatchObject({
      policy: "0x0000000000000000000000000000000000000000",
      target: boardroom,
      value: 0n,
    });
    const decodedMint = decodeFunctionData({
      abi: boardroomAbi,
      data: mint.data,
    });
    expect(decodedMint.functionName).toBe("mint");
    expect(decodedMint.args?.[0]).toBe(expectedFacetSetHash);
    expect(String(decodedMint.args?.[1]).toLowerCase()).toBe(recipient.toLowerCase());
    expect(decodedMint.args?.[2]).toBe(10n);

    const registration = buildBoardroomRegisterRedeemableAssetCall({
      boardroom,
      expectedFacetSetHash,
      asset,
    });
    expect(registration).toMatchObject({
      policy: "0x0000000000000000000000000000000000000000",
      target: boardroom,
      value: 0n,
    });
    const decodedRegistration = decodeFunctionData({
      abi: boardroomAbi,
      data: registration.data,
    });
    expect(decodedRegistration.functionName).toBe("registerRedeemableAsset");
    expect(decodedRegistration.args?.[0]).toBe(expectedFacetSetHash);
    expect(String(decodedRegistration.args?.[1]).toLowerCase()).toBe(asset.toLowerCase());
  });

  test("plans hash-bound prelaunch, governed, and wind-down domain execution", () => {
    const call = {
      policy: asset,
      target: recipient,
      value: 0n,
      data: "0x1234" as Hex,
    };
    expect(planBoardroomCallExecution({
      boardroom,
      expectedFacetSetHash,
      calls: [call],
      lifecycle: {
        launched: false,
        status: 0,
        migrationRequired: false,
      },
    })).toMatchObject({
      kind: "execute",
      transaction: {
        functionName: "execute",
        args: [expectedFacetSetHash, call],
      },
    });
    expect(planBoardroomCallExecution({
      boardroom,
      expectedFacetSetHash,
      calls: [call, call],
      lifecycle: {
        launched: false,
        status: 0,
        migrationRequired: false,
      },
    })).toMatchObject({
      kind: "execute",
      transaction: {
        functionName: "executeBatch",
        args: [expectedFacetSetHash, [call, call]],
      },
    });

    expect(planBoardroomCallExecution({
      boardroom,
      expectedFacetSetHash,
      calls: [call],
      lifecycle: {
        launched: true,
        status: 1,
        migrationRequired: false,
      },
    })).toMatchObject({
      kind: "windDown",
      transaction: {
        functionName: "executeWindDownCall",
        args: [expectedFacetSetHash, call],
      },
    });

    expect(() => planBoardroomCallExecution({
      boardroom,
      expectedFacetSetHash,
      calls: [call],
      lifecycle: {
        launched: true,
        status: 0,
        migrationRequired: true,
      },
    })).toThrow("must be migrated");
    expect(() => planBoardroomCallExecution({
      boardroom,
      expectedFacetSetHash,
      calls: [call],
      lifecycle: {
        launched: true,
        status: 2,
        migrationRequired: false,
      },
    })).toThrow("snapshotting");
  });

  test("rejects missing or malformed facet-set hashes at runtime", () => {
    expect(() => buildBoardroomStartWindDownTransaction({
      boardroom,
      expectedFacetSetHash: "0x1234",
    })).toThrow("expectedFacetSetHash must be a 32-byte hex value.");
    expect(() => buildBoardroomRedeemTransaction({
      boardroom,
      expectedFacetSetHash: undefined as unknown as Hex,
      shares: 1n,
    })).toThrow("expectedFacetSetHash must be a 32-byte hex value.");
    expect(() => buildBoardroomExecuteBatchTransaction({
      boardroom,
      expectedFacetSetHash,
      calls: [],
    })).toThrow("Boardroom execution batches must contain between 1 and 16 calls.");
    expect(() => buildBoardroomExecuteBatchTransaction({
      boardroom,
      expectedFacetSetHash,
      calls: Array.from({ length: 17 }, () => ({
        policy: asset,
        target: recipient,
        value: 0n,
        data: "0x" as Hex,
      })),
    })).toThrow("Boardroom execution batches must contain between 1 and 16 calls.");
    expect(() => buildBoardroomExecuteWindDownCallTransaction({
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
      liquidityVault: facet,
      liquidityPoolId: manifestHash,
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
    await expect(readBoardroomProtocolState(client, boardroom)).resolves.toEqual({
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
      liquidityVault: facet,
      liquidityPoolId: manifestHash,
      facetRegistry: registry,
      requiredFacetSetHash: expectedFacetSetHash,
      activeRelease: 2n,
      appliedStorageVersion: 1n,
      appliedStorageLayoutHash: manifestHash,
      requiredStorageVersion: 2n,
      requiredStorageLayoutHash: storageLayoutHash,
      migrationRequired: true,
    });
    await expect(readBoardroomProtocolControllerState(client, facet)).resolves.toEqual({
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
