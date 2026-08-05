import { describe, expect, test } from "bun:test";
import { decodeFunctionData, type Address, type Hex } from "viem";
import {
  boardroomAbi,
  boardroomControllerAbi,
  buildBoardroomReplaceControllerCall,
  buildBoardroomVetoOperationTransaction,
  buildControllerExecuteBoardroomOperationTransaction,
  buildControllerScheduleBoardroomOperationTransaction,
  buildControllerUpdateConfigurationData,
  deriveUniswapV4SqrtPriceX96,
  buildBoardroomLaunchTransaction,
  buildBoardroomMintCall,
  buildGrantRightTransferTransaction,
  buildGrantSettlementTransaction,
  planBoardroomCallExecution,
  readGrantSettlementQuote,
  type BoardroomCall,
  type PledgeCashReadClient,
} from "../src";

const boardroom = "0x0000000000000000000000000000000000000b0a" as Address;
const shareToken = "0x0000000000000000000000000000000000000aaa" as Address;
const rewardPool = "0x0000000000000000000000000000000000000fed" as Address;
const paymentToken = "0x0000000000000000000000000000000000000456" as Address;
const account = "0x0000000000000000000000000000000000000b0b" as Address;
const recipient = "0x000000000000000000000000000000000000cafe" as Address;
const factory = "0x0000000000000000000000000000000000000fac" as Address;
const grant = "0x0000000000000000000000000000000000000123" as Address;
const policy = "0x0000000000000000000000000000000000000a55" as Address;
const salt = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
const expectedFacetSetHash = "0x3333333333333333333333333333333333333333333333333333333333333333" as Hex;
const actionHash = "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex;
const controller = "0x000000000000000000000000000000000000c011" as Address;
const Q96 = 1n << 96n;

const call = {
  policy,
  target: shareToken,
  value: 7n,
  data: "0x12345678" as Hex,
} satisfies BoardroomCall;

describe("Uniswap v4 price derivation", () => {
  test("derives the same currency-ordered price from either token input order", () => {
    expect(deriveUniswapV4SqrtPriceX96({
      tokenA: paymentToken,
      tokenB: shareToken,
      amountA: 1n,
      amountB: 4n,
    })).toBe(2n * Q96);
    expect(deriveUniswapV4SqrtPriceX96({
      tokenA: shareToken,
      tokenB: paymentToken,
      amountA: 4n,
      amountB: 1n,
    })).toBe(2n * Q96);
  });
});

describe("governance transaction planning", () => {
  test("builds launch, schedule, execution, and veto envelopes for the external controller", () => {
    const launchConfig = {
      proposer: account,
      predictedController: controller,
      protectionStaker: account,
      expectedRewardPool: rewardPool,
      expectedRedemptionExcessRecipient: recipient,
      controllerDelay: 86_400n,
      windDownDelay: 172_800n,
      gracePeriod: 604_800n,
      generation: 1n,
    } as const;
    expect(buildBoardroomLaunchTransaction({ boardroom, expectedFacetSetHash, config: launchConfig })).toMatchObject({
      address: boardroom,
      functionName: "launch",
      args: [expectedFacetSetHash, launchConfig],
    });
    expect(buildBoardroomVetoOperationTransaction({ boardroom, expectedFacetSetHash, operationId: actionHash })).toMatchObject({
      functionName: "veto",
      args: [expectedFacetSetHash, actionHash],
    });

    const scheduled = buildControllerScheduleBoardroomOperationTransaction({
      controller,
      expectedFacetSetHash,
      calls: [call],
      salt,
      expectedBoardroomEpoch: 3n,
      expectedConfigurationEpoch: 2n,
    });
    expect(scheduled).toMatchObject({
      address: controller,
      functionName: "scheduleBoardroomOperation",
      args: [expectedFacetSetHash, [call], salt, 3n, 2n],
    });
    expect(buildControllerExecuteBoardroomOperationTransaction({
      controller,
      expectedFacetSetHash,
      calls: [call],
      salt,
      expectedBoardroomEpoch: 3n,
      expectedConfigurationEpoch: 2n,
      authority: account,
    })).toMatchObject({
      address: controller,
      functionName: "executeBoardroomOperation",
      args: [expectedFacetSetHash, [call], salt, 3n, 2n, account],
    });
  });

  test("selects prelaunch execution, launched scheduling, and wind-down cleanup", () => {
    expect(planBoardroomCallExecution({
      boardroom,
      expectedFacetSetHash,
      calls: [call],
      lifecycle: { launched: false, status: 0, migrationRequired: false },
    })).toMatchObject({
      kind: "execute",
      transaction: { functionName: "execute", value: 7n },
    });
    expect(planBoardroomCallExecution({
      boardroom,
      expectedFacetSetHash,
      calls: [call],
      lifecycle: {
        launched: true,
        status: 0,
        migrationRequired: false,
        controller,
        governanceEpoch: 3n,
        controllerConfigurationEpoch: 2n,
        proposer: account,
      },
      salt,
    })).toMatchObject({ kind: "schedule", transaction: { functionName: "scheduleBoardroomOperation" } });
    expect(
      planBoardroomCallExecution({
        boardroom,
        expectedFacetSetHash,
        calls: [{ ...call, value: 0n }],
        lifecycle: { launched: true, status: 1, migrationRequired: false },
      }),
    ).toMatchObject({ kind: "windDown", transaction: { functionName: "executeWindDownCall" } });

    expect(() => planBoardroomCallExecution({
      boardroom,
      expectedFacetSetHash,
      calls: [call],
      lifecycle: { launched: true, status: 0, migrationRequired: false },
    })).toThrow(
      "governance salt",
    );
    expect(() => planBoardroomCallExecution({
      boardroom,
      expectedFacetSetHash,
      calls: [call],
      lifecycle: { launched: true, status: 2, migrationRequired: false },
    })).toThrow(
      "snapshotting",
    );
  });

  test("builds delayed configuration data and atomic controller replacement self-calls", () => {
    const configData = buildControllerUpdateConfigurationData({ proposer: recipient, delay: 172_800n, gracePeriod: 604_800n });
    const decodedConfiguration = decodeFunctionData({ abi: boardroomControllerAbi, data: configData });
    expect(decodedConfiguration.functionName).toBe("updateConfiguration");
    expect(String(decodedConfiguration.args?.[0]).toLowerCase()).toBe(recipient.toLowerCase());
    expect(decodedConfiguration.args?.slice(1)).toEqual([172_800n, 604_800n]);
    const replacement = buildBoardroomReplaceControllerCall({
      boardroom,
      expectedFacetSetHash,
      expectedCurrentController: controller,
      expectedNextController: recipient,
      nextProposer: account,
      nextDelay: 172_800n,
      nextGracePeriod: 604_800n,
      nextGeneration: 2n,
    });
    expect(replacement).toMatchObject({
      policy: "0x0000000000000000000000000000000000000000",
      target: boardroom,
      value: 0n,
    });
    expect(decodeFunctionData({ abi: boardroomAbi, data: replacement.data }).functionName).toBe("replaceController");
    const decodedMint = decodeFunctionData({
      abi: boardroomAbi,
      data: buildBoardroomMintCall({ boardroom, expectedFacetSetHash, to: account, amount: 10n }).data,
    });
    expect(decodedMint.functionName).toBe("mint");
    expect(decodedMint.args?.[0]).toBe(expectedFacetSetHash);
    expect(String(decodedMint.args?.[1]).toLowerCase()).toBe(account.toLowerCase());
    expect(decodedMint.args?.[2]).toBe(10n);
  });
});

describe("participation readers and builders", () => {
  test("reads arbitrary grant settlement cost and payment funding", async () => {
    const client = readClient((address, functionName, args) => {
      if (address === paymentToken && functionName === "balanceOf") return 1_000n;
      if (address === paymentToken && functionName === "allowance") return 500n;
      if (functionName === "getSettlementCost") return args?.[0] === 200n ? 5n : 13n;
      return {
        factory,
        issuer: boardroom,
        holder: account,
        token: shareToken,
        paymentToken,
        tokenId: 123n,
        tokenDecimals: 18,
        paymentTokenDecimals: 6,
        grantSize: 1_000n,
        claimable: 900n,
        price: 25n,
        vestingCliff: 100n,
        vestingEnd: 1_000n,
        expiry: 2_000n,
        settledAmount: 100n,
        vestingIsHalted: false,
        isClosed: false,
        getSettleableAmount: 500n,
        getUnsettledAmount: 800n,
        transferable: true,
        transferUnlockTime: 150n,
        transferLocked: false,
        isExpired: false,
        isQuarantined: false,
        quarantinedAmount: 0n,
      }[functionName];
    });

    await expect(readGrantSettlementQuote(client, grant, 200n, 500n)).resolves.toMatchObject({
      amount: 200n,
      settlementCost: 5n,
      paymentBalance: 1_000n,
      paymentAllowance: 500n,
      state: { settlementCost: 13n, transferable: true },
    });
    expect(buildGrantSettlementTransaction({ grant, amount: 200n })).toMatchObject({ functionName: "settle", args: [200n] });
    expect(buildGrantRightTransferTransaction({ factory, from: account, to: recipient, tokenId: 123n })).toMatchObject({
      functionName: "safeTransferFrom",
      args: [account, recipient, 123n],
    });
  });


});

function readClient(
  value: (address: Address, functionName: string, args: readonly unknown[] | undefined) => unknown,
): PledgeCashReadClient {
  return {
    async readContract(parameters) {
      const address = parameters.address as Address;
      const functionName = parameters.functionName as string;
      const result = value(address, functionName, parameters.args as readonly unknown[] | undefined);
      if (result === undefined) throw new Error(`Unexpected read: ${address}.${functionName}`);
      return result as never;
    },
  };
}
