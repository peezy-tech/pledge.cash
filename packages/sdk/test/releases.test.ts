import { describe, expect, test } from "bun:test";
import { keccak256, type Address, type Hex } from "viem";

import {
  assertLiveBoardroomControlRelease,
  boardroomControlReleaseSupport,
  BoardroomControlReleaseProofError,
  SECURE_BOARDROOM_RELEASE_VERSION,
  type BoardroomControlProofClient,
  type PledgeCashDeployment,
} from "../src";

const hash = `0x${"11".repeat(32)}`;
const liveCode = "0x6000" as Hex;
const liveHash = keccak256(liveCode);
const boardroom = "0x2000000000000000000000000000000000000001" as Address;
const shareToken = "0x2000000000000000000000000000000000000002" as Address;
const controller = "0x2000000000000000000000000000000000000003" as Address;

function release(overrides: Partial<PledgeCashDeployment> = {}): PledgeCashDeployment {
  return {
    chainId: 31337,
    deterministicDeployment: true,
    deterministicDeploymentVersion: SECURE_BOARDROOM_RELEASE_VERSION,
    deterministicReleaseCodeHash: hash,
    boardroomFactory: "0x1000000000000000000000000000000000000001",
    boardroomControllerFactory: "0x1000000000000000000000000000000000000002",
    boardroomControllerLogic: "0x1000000000000000000000000000000000000003",
    boardroomGovernanceLogic: "0x1000000000000000000000000000000000000004",
    boardroomMarketLogic: "0x1000000000000000000000000000000000000005",
    boardroomRedemptionPayout: "0x1000000000000000000000000000000000000006",
    boardroomLogic: "0x1000000000000000000000000000000000000007",
    boardroomFactoryCodeHash: hash,
    boardroomControllerFactoryCodeHash: hash,
    boardroomControllerCodeHash: hash,
    boardroomGovernanceLogicCodeHash: hash,
    boardroomMarketLogicCodeHash: hash,
    boardroomRedemptionPayoutCodeHash: hash,
    boardroomLogicCodeHash: hash,
    ...overrides,
  };
}

describe("Boardroom release support", () => {
  test("requires deterministic v5 addresses and nonzero code-hash attestations", () => {
    expect(boardroomControlReleaseSupport(release())).toEqual({ supported: true });
    expect(boardroomControlReleaseSupport(release({ deterministicDeployment: false })).supported).toBe(false);
    expect(boardroomControlReleaseSupport(release({ boardroomControllerFactory: undefined })).supported).toBe(false);
    expect(boardroomControlReleaseSupport(release({ boardroomControllerCodeHash: undefined })).supported).toBe(false);
    expect(boardroomControlReleaseSupport(release({ boardroomLogicCodeHash: `0x${"00".repeat(32)}` })).supported).toBe(false);
  });

  test("keeps legacy and unknown releases read-only", () => {
    expect(boardroomControlReleaseSupport(release({ deterministicDeploymentVersion: "pledge.cash.deterministic.v4" })).supported).toBe(false);
    expect(boardroomControlReleaseSupport({ chainId: 31337 }).supported).toBe(false);
  });

  test("pins and proves every live release root plus reciprocal launched controller identity", async () => {
    const deployment = releaseWithLiveHashes();
    const client = proofClient(deployment, { launched: true });

    await expect(assertLiveBoardroomControlRelease(client, deployment, boardroom)).resolves.toEqual({
      blockNumber: 77n,
      controller,
      controllerGeneration: 2n,
      launched: true,
    });
  });

  test("accepts canonical prelaunch state and fails closed on stale reciprocal controller state", async () => {
    const deployment = releaseWithLiveHashes();
    await expect(
      assertLiveBoardroomControlRelease(proofClient(deployment, { launched: false }), deployment, boardroom),
    ).resolves.toMatchObject({ controllerGeneration: 0n, launched: false });
    await expect(
      assertLiveBoardroomControlRelease(
        proofClient(deployment, { launched: true, mappedGeneration: 1n }),
        deployment,
        boardroom,
      ),
    ).rejects.toBeInstanceOf(BoardroomControlReleaseProofError);
  });
});

function releaseWithLiveHashes(): PledgeCashDeployment {
  return release({
    boardroomFactoryCodeHash: liveHash,
    boardroomControllerFactoryCodeHash: liveHash,
    boardroomControllerCodeHash: liveHash,
    boardroomGovernanceLogicCodeHash: liveHash,
    boardroomMarketLogicCodeHash: liveHash,
    boardroomRedemptionPayoutCodeHash: liveHash,
    boardroomLogicCodeHash: liveHash,
  });
}

function proofClient(
  deployment: PledgeCashDeployment,
  options: { launched: boolean; mappedGeneration?: bigint },
): BoardroomControlProofClient {
  const factory = deployment.boardroomFactory!;
  const controllerFactory = deployment.boardroomControllerFactory!;
  const values: Record<string, unknown> = {
    [`${factory}:isBoardroom`]: true,
    [`${factory}:isShareToken`]: true,
    [`${factory}:controllerFactory`]: controllerFactory,
    [`${factory}:boardroomLogic`]: deployment.boardroomLogic,
    [`${factory}:governanceLogic`]: deployment.boardroomGovernanceLogic,
    [`${factory}:marketLogic`]: deployment.boardroomMarketLogic,
    [`${factory}:redemptionPayoutLogic`]: deployment.boardroomRedemptionPayout,
    [`${controllerFactory}:boardroomFactory`]: factory,
    [`${controllerFactory}:controllerImplementation`]: deployment.boardroomControllerLogic,
    [`${controllerFactory}:isController`]: true,
    [`${controllerFactory}:boardroomOfController`]: boardroom,
    [`${controllerFactory}:generationOfController`]: options.mappedGeneration ?? 2n,
    [`${controllerFactory}:predictControllerAddress`]: controller,
    [`${boardroom}:controllerFactory`]: controllerFactory,
    [`${boardroom}:governanceLogic`]: deployment.boardroomGovernanceLogic,
    [`${boardroom}:marketLogic`]: deployment.boardroomMarketLogic,
    [`${boardroom}:redemptionPayoutLogic`]: deployment.boardroomRedemptionPayout,
    [`${boardroom}:shareToken`]: shareToken,
    [`${boardroom}:launched`]: options.launched,
    [`${boardroom}:owner`]: options.launched ? controller : "0x3000000000000000000000000000000000000001",
    [`${boardroom}:controller`]: options.launched ? controller : "0x0000000000000000000000000000000000000000",
    [`${boardroom}:controllerGeneration`]: options.launched ? 2n : 0n,
    [`${controller}:factory`]: controllerFactory,
    [`${controller}:boardroom`]: boardroom,
    [`${controller}:generation`]: 2n,
  };
  return {
    getBlockNumber: async () => 77n,
    getCode: async ({ blockNumber }) => {
      expect(blockNumber).toBe(77n);
      return liveCode;
    },
    readContract: async ({ address, functionName, blockNumber }) => {
      expect(blockNumber).toBe(77n);
      const key = `${address}:${String(functionName)}`;
      if (!(key in values)) throw new Error(`Unexpected proof read ${key}`);
      return values[key];
    },
  } as unknown as BoardroomControlProofClient;
}
