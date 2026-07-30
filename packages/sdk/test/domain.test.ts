import { describe, expect, test } from "bun:test";
import { decodeFunctionData, type Address, type Hex } from "viem";
import {
  boardroomAbi,
  boardroomControllerAbi,
  buildAmmSwapExactTokensForTokensTransaction,
  buildBoardroomReplaceControllerCall,
  buildBoardroomVetoOperationTransaction,
  buildControllerExecuteBoardroomOperationTransaction,
  buildControllerScheduleBoardroomOperationTransaction,
  buildControllerUpdateConfigurationData,
  buildBoardroomLaunchTransaction,
  buildBoardroomMintCall,
  buildDutchAuctionBuyTransaction,
  buildFixedPriceSaleBuyTransaction,
  buildGrantRightTransferTransaction,
  buildGrantSettlementTransaction,
  buildMigratingBondingCurveBuyTransaction,
  buildMigratingBondingCurveSellTransaction,
  governanceStakerPowerThreshold,
  planBoardroomCallExecution,
  readBoardroomStakerPower,
  readDutchAuctionParticipationQuote,
  readFixedPriceSaleParticipationQuote,
  readGrantSettlementQuote,
  readMerkleAirdropClaimState,
  readMigratingBondingCurveBuyQuote,
  readMigratingBondingCurveSellQuote,
  type BoardroomCall,
  type PledgeCashBlockReadClient,
  type PledgeCashReadClient,
} from "../src";

const boardroom = "0x0000000000000000000000000000000000000b0a" as Address;
const shareToken = "0x0000000000000000000000000000000000000aaa" as Address;
const rewardPool = "0x0000000000000000000000000000000000000fed" as Address;
const paymentToken = "0x0000000000000000000000000000000000000456" as Address;
const account = "0x0000000000000000000000000000000000000b0b" as Address;
const recipient = "0x000000000000000000000000000000000000cafe" as Address;
const factory = "0x0000000000000000000000000000000000000fac" as Address;
const sale = "0x0000000000000000000000000000000000000a1e" as Address;
const curve = "0x0000000000000000000000000000000000000c0e" as Address;
const grant = "0x0000000000000000000000000000000000000123" as Address;
const policy = "0x0000000000000000000000000000000000000a55" as Address;
const salt = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
const expectedFacetSetHash = "0x3333333333333333333333333333333333333333333333333333333333333333" as Hex;
const actionHash = "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex;
const controller = "0x000000000000000000000000000000000000c011" as Address;

const call = {
  policy,
  target: shareToken,
  value: 7n,
  data: "0x12345678" as Hex,
} satisfies BoardroomCall;

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

describe("staker power", () => {
  test("uses the larger rounded-up current and prior-block threshold", async () => {
    expect(governanceStakerPowerThreshold(10_001n, 10_000n, 100n)).toBe(101n);

    const requests: { functionName: string; args?: readonly unknown[]; blockNumber?: bigint }[] = [];
    const client = {
      async getBlockNumber() {
        return 100n;
      },
      async readContract(parameters: { functionName: string; args?: readonly unknown[]; blockNumber?: bigint }) {
        requests.push(parameters);
        switch (parameters.functionName) {
          case "shareToken": return shareToken;
          case "rewardPool": return rewardPool;
          case "isEncumberedAccount": return false;
          case "balanceOf": return 1_500n;
          case "activeStakeOf": return 1_001n;
          case "getPastActiveStake": return 1_001n;
          case "governanceEligibleSupply": return 10_001n;
          case "getPastGovernanceEligibleSupply": return 10_000n;
          default: throw new Error(`Unexpected read: ${parameters.functionName}`);
        }
      },
    } as unknown as PledgeCashBlockReadClient;

    await expect(readBoardroomStakerPower(client, { boardroom, account })).resolves.toMatchObject({
      blockNumber: 100n,
      snapshotBlock: 99n,
      rewardPool,
      currentTokenBalance: 1_500n,
      currentActiveStake: 1_001n,
      pastActiveStake: 1_001n,
      currentEligibleSupply: 10_001n,
      pastEligibleSupply: 10_000n,
      vetoRequired: 101n,
      windDownRequired: 1_001n,
      canVeto: true,
      canStartWindDown: true,
    });
    expect(requests.filter((request) => request.blockNumber !== undefined).every((request) => request.blockNumber === 100n)).toBe(true);
    expect(requests.find((request) => request.functionName === "getPastActiveStake")?.args).toEqual([account, 99n]);
  });
});

describe("participation readers and builders", () => {
  test("reads fixed-sale cost, cap, balance, and allowance", async () => {
    const client = readClient((address, functionName) => {
      if (address === paymentToken && functionName === "balanceOf") return 1_000n;
      if (address === paymentToken && functionName === "allowance") return 500n;
      return {
        factory,
        boardroom,
        shareToken,
        paymentToken,
        saleSupply: 1_000n,
        remainingShares: 600n,
        price: 25n,
        maxPerBuyer: 500n,
        startTime: 100n,
        endTime: 1_000n,
        saleStatus: 0,
        isClosed: false,
        getPaymentAmount: 250n,
        purchasedBy: 450n,
      }[functionName];
    });

    await expect(readFixedPriceSaleParticipationQuote(client, { sale, buyer: account, shareAmount: 100n })).resolves.toMatchObject({
      paymentAmount: 250n,
      purchasedBy: 450n,
      remainingBuyerCapacity: 50n,
      paymentBalance: 1_000n,
      paymentAllowance: 500n,
    });
    expect(buildFixedPriceSaleBuyTransaction({ sale, shareAmount: 100n, recipient, maxPayment: 251n, deadline: 900n })).toMatchObject({
      functionName: "buy",
      args: [100n, recipient, 251n, 900n],
    });
    expect(buildAmmSwapExactTokensForTokensTransaction({
      router: factory,
      amountIn: 250n,
      amountOutMin: 99n,
      path: [paymentToken, shareToken],
      recipient,
      deadline: 900n,
    })).toMatchObject({
      address: factory,
      functionName: "swapExactTokensForTokens",
      args: [250n, 99n, [paymentToken, shareToken], recipient, 900n],
    });
  });

  test("reads Dutch-auction live cost, cap, balance, and allowance", async () => {
    const client = readClient((address, functionName) => {
      if (address === paymentToken && functionName === "balanceOf") return 1_000n;
      if (address === paymentToken && functionName === "allowance") return 500n;
      return {
        factory,
        boardroom,
        shareToken,
        paymentToken,
        saleSupply: 1_000n,
        remainingShares: 600n,
        startPrice: 40n,
        floorPrice: 20n,
        currentPrice: 30n,
        maxPerBuyer: 500n,
        totalPayment: 10_000n,
        soldShares: 400n,
        lastPurchasePrice: 31n,
        settlementPrice: 0n,
        startTime: 100n,
        endTime: 1_000n,
        saleStatus: 0,
        isClosed: false,
        getPaymentAmount: 250n,
        purchasedBy: 450n,
      }[functionName];
    });

    await expect(readDutchAuctionParticipationQuote(client, { auction: sale, buyer: account, shareAmount: 100n })).resolves.toMatchObject({
      paymentAmount: 250n,
      purchasedBy: 450n,
      remainingBuyerCapacity: 50n,
      paymentBalance: 1_000n,
      paymentAllowance: 500n,
      state: { currentPrice: 30n, totalPayment: 10_000n },
    });
    expect(buildDutchAuctionBuyTransaction({ auction: sale, shareAmount: 100n, recipient, maxPayment: 251n, deadline: 900n })).toMatchObject({
      functionName: "buy",
      args: [100n, recipient, 251n, 900n],
    });
  });

  test("reads curve buy and sell quotes with account-specific funding", async () => {
    const client = readClient((address, functionName) => {
      if (address === paymentToken && functionName === "balanceOf") return 2_000n;
      if (address === paymentToken && functionName === "allowance") return 1_500n;
      if (address === shareToken && functionName === "balanceOf") return 300n;
      if (address === shareToken && functionName === "allowance") return 250n;
      return {
        factory,
        boardroom,
        lockedLiquidityFactory: factory,
        shareToken,
        quoteToken: paymentToken,
        locker: recipient,
        pool: sale,
        saleSupply: 1_000n,
        migrationSupply: 500n,
        remainingSaleShares: 800n,
        outstandingCurveShareLiability: 200n,
        basePrice: 25n,
        slope: 2n,
        graduationQuoteTarget: 10_000n,
        quoteToLpBps: 5_000,
        startTime: 100n,
        endTime: 1_000n,
        phaseEndsAt: 0n,
        quarantineStartedAt: 0n,
        forfeitureEligibleAt: 0n,
        forfeitureWindowEndsAt: 0n,
        migrationSalt: salt,
        curveStatus: 0,
        settlementReason: 0,
        postQuarantinePhase: 0,
        soldShares: 200n,
        quoteReserve: 5_000n,
        migrationAmounts: [100n, 2_500n],
        terminalCurvePrice: 25n,
        graduationLatched: false,
        migrationReservationHeld: true,
        quoteQuarantined: false,
        forfeitureFinalized: false,
        unrecoveredQuote: 0n,
        forfeitedQuote: 0n,
        canMigrate: false,
        isClosed: false,
        getBuyQuote: 275n,
        getSellQuote: 225n,
        sellableShares: 175n,
      }[functionName];
    });

    await expect(readMigratingBondingCurveBuyQuote(client, { curve, buyer: account, shareAmount: 100n })).resolves.toMatchObject({
      quoteIn: 275n,
      quoteBalance: 2_000n,
      quoteAllowance: 1_500n,
    });
    await expect(readMigratingBondingCurveSellQuote(client, { curve, seller: account, shareAmount: 100n })).resolves.toMatchObject({
      quoteOut: 225n,
      sellableShares: 175n,
      shareBalance: 300n,
      shareAllowance: 250n,
    });
    expect(buildMigratingBondingCurveBuyTransaction({ curve, shareAmount: 100n, recipient, maxQuoteIn: 280n, deadline: 900n })).toMatchObject({
      functionName: "buy",
      args: [100n, recipient, 280n, 900n],
    });
    expect(buildMigratingBondingCurveSellTransaction({ curve, shareAmount: 100n, recipient, minQuoteOut: 220n, deadline: 900n })).toMatchObject({
      functionName: "sell",
      args: [100n, recipient, 220n, 900n],
    });
  });

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

  test("reads airdrop claim status by Merkle index", async () => {
    const client = readClient((_address, functionName) => functionName === "isClaimed" ? true : undefined);
    await expect(readMerkleAirdropClaimState(client, { airdrop: sale, index: 7n })).resolves.toEqual({
      airdrop: sale,
      index: 7n,
      claimed: true,
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
