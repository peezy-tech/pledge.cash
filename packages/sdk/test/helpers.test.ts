import { describe, expect, test } from "bun:test";
import { decodeFunctionData, encodeErrorResult, encodeFunctionData, type Address, type Hex } from "viem";
import {
  boardroomAbi,
  boardroomTokenAbi,
  buildBoardroomProtocolLiquidityBatch,
  buildBoardroomProtocolLiquidityAddBatch,
  buildBoardroomProtocolLiquidityCloseAction,
  buildBoardroomProtocolLiquidityExitTransaction,
  buildBoardroomProtocolLiquidityFeeClaimAction,
  buildBoardroomProtocolLiquidityRemoveAction,
  buildBoardroomBurnTreasurySharesTransaction,
  buildBoardroomClaimRedemptionAssetTransaction,
  buildBoardroomMintTransaction,
  buildBoardroomOpenRedemptionsTransaction,
  buildBoardroomPruneObligationTransaction,
  buildBoardroomPruneObligationsTransaction,
  buildBoardroomRedeemTransaction,
  buildBoardroomRegisterRedeemableAssetTransaction,
  buildBoardroomShareGrantIssuanceBatch,
  buildBoardroomStartWindDownTransaction,
  buildBoardroomWrapNativeBalanceTransaction,
  buildDirectGrantCreationTransaction,
  buildErc20Approval,
  decodeKnownPledgeCashError,
  discoverBoardroomProtocolLiquidity,
  discoverBoardrooms,
  discoverGrantHistory,
  erc20Abi,
  pledgeV4LiquidityFactoryAbi,
  pledgeV4LiquidityVaultAbi,
  readProtocolLiquidityPoolId,
  predictProtocolLiquidityVaultAddress,
  queryGrantsHeldByAddress,
  queryGrantsIssuedByAddress,
  readBoardroomState,
  readFactoryState,
  readGrantState,
  readProtocolLiquidityVaultState,
  tokenGrantFactoryAbi,
  type BoardroomProtocolLiquidityTerms,
  type GrantCreationTerms,
  type PledgeCashBlockReadClient,
  type PledgeCashLogClient,
  type PledgeCashReadClient,
} from "../src";

const factory = "0x0000000000000000000000000000000000000fac" as Address;
const boardroom = "0x0000000000000000000000000000000000000b0a" as Address;
const shareToken = "0x0000000000000000000000000000000000000aaa" as Address;
const rewardPool = "0x0000000000000000000000000000000000000fed" as Address;
const holder = "0x0000000000000000000000000000000000000b0b" as Address;
const issuer = "0x00000000000000000000000000000000000a11ce" as Address;
const other = "0x000000000000000000000000000000000000cafe" as Address;
const grantToken = "0x0000000000000000000000000000000000000123" as Address;
const paymentToken = "0x0000000000000000000000000000000000000456" as Address;
const assetPolicy = "0x0000000000000000000000000000000000000a55" as Address;
const sale = "0x0000000000000000000000000000000000000a1e" as Address;
const curve = "0x0000000000000000000000000000000000000c0e" as Address;
const liquidityFactory = "0x00000000000000000000000000000000000010cc" as Address;
const liquidityVault = "0x00000000000000000000000000000000000010cd" as Address;
const boardroomController = "0x000000000000000000000000000000000000c011" as Address;
const poolId = "0x5555555555555555555555555555555555555555555555555555555555555555" as Hex;
const wrappedNative = "0x00000000000000000000000000000000000000ee" as Address;
const salt = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
const expectedFacetSetHash = "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex;
const merkleRoot = "0x3333333333333333333333333333333333333333333333333333333333333333" as Hex;
const proof = ["0x4444444444444444444444444444444444444444444444444444444444444444" as Hex];

const terms = {
  holder,
  token: grantToken,
  paymentToken,
  amount: 1000n,
  price: 25n,
  expiry: 3000n,
  vestingCliff: 1000n,
  vestingEnd: 2000n,
  transferable: true,
  transferUnlockTime: 1200n,
  salt,
} satisfies GrantCreationTerms;

const shareGrantTerms = {
  holder: terms.holder,
  paymentToken: terms.paymentToken,
  amount: terms.amount,
  price: terms.price,
  expiry: terms.expiry,
  vestingCliff: terms.vestingCliff,
  vestingEnd: terms.vestingEnd,
  transferable: terms.transferable,
  transferUnlockTime: terms.transferUnlockTime,
  salt: terms.salt,
};

const protocolLiquidityTerms = {
  quoteToken: paymentToken,
  shareAmountDesired: 1000n,
  quoteAmountDesired: 2000n,
  shareAmountMin: 900n,
  quoteAmountMin: 1900n,
  sqrtPriceX96: 1n << 96n,
  deadline: 12345n,
  salt,
} satisfies BoardroomProtocolLiquidityTerms;

describe("SDK action and query helpers", () => {
  test("reads factory, grant, and Boardroom state through standard viem calls", async () => {
    const client = mockReadClient({
      owner: issuer,
      tokenGrantLogic: "0x0000000000000000000000000000000000000100",
      creationFee: 10n,
      issuer,
      holder,
      token: grantToken,
      paymentToken,
      tokenId: 123n,
      tokenDecimals: 18,
      paymentTokenDecimals: 6,
      grantSize: 1000n,
      claimable: 900n,
      price: 25n,
      vestingCliff: terms.vestingCliff,
      vestingEnd: terms.vestingEnd,
      expiry: 3000n,
      settledAmount: 100n,
      vestingIsHalted: false,
      isClosed: false,
      getSettleableAmount: 500n,
      getSettlementCost: 13n,
      getUnsettledAmount: 800n,
      transferable: true,
      transferUnlockTime: 1200n,
      transferLocked: false,
      isExpired: false,
      isQuarantined: false,
      quarantinedAmount: 0n,
      policyRegistry: "0x0000000000000000000000000000000000000777",
      wrappedNative,
      shareToken,
      rewardPool,
      redemptionExcessRecipient: issuer,
      status: 1,
      launched: true,
      controller: boardroomController,
      controllerGeneration: 1n,
      governanceEpoch: 3n,
      facetSetHash: expectedFacetSetHash,
      appliedStorageVersion: 2n,
      appliedStorageLayoutHash: merkleRoot,
      migrationRequired: false,
      windDownDelay: 172_800n,
      windDownStartedAt: 100n,
      protectionStaker: holder,
      redeemableAssetCount: 2n,
      assetSnapshotProgress: [2n, 1n, true],
      redemptionSupplyState: [700n, true],
      activeObligationCount: 4n,
      activeObligationCountByKind: 1n,
      primaryMarketMode: 2,
      bondingCurve: curve,
      primaryMarketQuoteAsset: paymentToken,
      liquidityStatus: 1,
      liquidityVault,
      liquidityPoolId: poolId,
      liquidityQuoteAsset: paymentToken,
      proposer: issuer,
      delay: 86_400n,
      gracePeriod: 604_800n,
      generation: 1n,
      configurationEpoch: 2n,
      configurationHash: salt,
      governanceEligibleSupply: 750n,
      factory,
      boardroom,
      tokenGrantFactory: factory,
      saleSupply: 1000n,
      airdropSupply: 1000n,
      claimedShares: 100n,
      remainingShares: 900n,
      merkleRoot,
      maxGrantClaims: 3,
      claimedGrantCount: 1,
      maxPerBuyer: 500n,
      startPrice: 40n,
      floorPrice: 20n,
      currentPrice: 30n,
      totalPayment: 7_500n,
      lastPurchasePrice: 31n,
      settlementPrice: 0n,
      startTime: 100n,
      endTime: 1000n,
      phaseEndsAt: 0n,
      quarantineStartedAt: 0n,
      forfeitureEligibleAt: 0n,
      forfeitureWindowEndsAt: 0n,
      saleStatus: 0,
      airdropStatus: 0,
      liquidityFactory,
      quoteToken: paymentToken,
      liquidityVault,
      liquidityPoolId: poolId,
      migrationSupply: 500n,
      remainingSaleShares: 800n,
      outstandingCurveShareLiability: 200n,
      basePrice: 25n,
      slope: 2n,
      graduationQuoteTarget: 10_000n,
      quoteToLpBps: 5_000,
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
      tokenA: shareToken,
      tokenB: paymentToken,
      poolManager: other,
      protocolFeeRecipient: issuer,
      currency0: paymentToken,
      currency1: shareToken,
      hook: assetPolicy,
      poolId,
      positionSalt: salt,
      tickLower: -887_220,
      tickUpper: 887_220,
      poolFee: 3_000,
      tickSpacing: 60,
      liquidityState: 1,
      positionLiquidity: 777n,
      totalSupply: 700n,
    });

    await expect(readFactoryState(client, factory)).resolves.toMatchObject({
      address: factory,
      owner: issuer,
      creationFee: 10n,
    });
    await expect(readGrantState(client, boardroom, 1500n)).resolves.toMatchObject({
      address: boardroom,
      factory,
      issuer,
      holder,
      tokenId: 123n,
      vestingCliff: terms.vestingCliff,
      vestingEnd: terms.vestingEnd,
      settleable: 500n,
      settlementCost: 13n,
      transferable: true,
      transferUnlockTime: 1200n,
      quarantined: false,
    });
    await expect(readBoardroomState(client, boardroom)).resolves.toMatchObject({
      address: boardroom,
      owner: issuer,
      wrappedNative,
      shareToken,
      rewardPool,
      status: 1,
      launched: true,
      controller: boardroomController,
      proposer: issuer,
      controllerDelay: 86_400n,
      controllerGracePeriod: 604_800n,
      controllerGeneration: 1n,
      controllerConfigurationEpoch: 2n,
      governanceEpoch: 3n,
      windDownDelay: 172_800n,
      windDownStartedAt: 100n,
      protectionStaker: holder,
      governanceEligibleSupply: 750n,
      redeemableAssetCount: 2n,
      snapshotAssetCount: 2n,
      snapshotCursor: 1n,
      snapshotFrozen: true,
      redemptionSupply: 700n,
      redemptionSupplyFrozen: true,
      activeObligationCount: 4n,
      primaryMarketMode: 2,
      liquidityStatus: 1,
      liquidityVault,
      liquidityPoolId: poolId,
    });
    await expect(readProtocolLiquidityVaultState(client, liquidityVault)).resolves.toMatchObject({
      address: liquidityVault,
      boardroom,
      tokenA: shareToken,
      tokenB: paymentToken,
      poolId,
      liquidityState: 1,
      positionLiquidity: 777n,
      totalSupply: 700n,
    });
  });

  test("builds direct grant and Boardroom batch transaction inputs", () => {
    const direct = buildDirectGrantCreationTransaction({ factory, terms, creationFee: 10n });

    expect(direct.address).toBe(factory);
    expect(direct.abi).toBe(tokenGrantFactoryAbi);
    expect(direct.functionName).toBe("createGrant");
    expect(direct.value).toBe(10n);
    expect(direct.args).toEqual([
      holder,
      grantToken,
      paymentToken,
      1000n,
      25n,
      3000n,
      1000n,
      2000n,
      true,
      1200n,
      salt,
    ]);

    const approval = buildErc20Approval({ token: grantToken, spender: factory, amount: 1000n });
    expect(approval.functionName).toBe("approve");
    expect(approval.args).toEqual([factory, 1000n]);

    const batch = buildBoardroomShareGrantIssuanceBatch({
      boardroom,
      expectedFacetSetHash,
      factory,
      shareToken,
      terms: shareGrantTerms,
      creationFee: 10n,
      policy: factory,
      assetPolicy,
    });

    expect(batch.address).toBe(boardroom);
    expect(batch.abi).toBe(boardroomAbi);
    expect(batch.functionName).toBe("executeBatch");
    expect(batch.value).toBe(10n);

    const calls = batch.args[1];
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ policy: assetPolicy, target: shareToken, value: 0n });
    expect(calls[0]?.data).toBe(
      encodeFunctionData({ abi: boardroomTokenAbi, functionName: "approve", args: [factory, 1000n] }),
    );
    expect(calls[1]).toMatchObject({ policy: factory, target: factory, value: 10n });
    expect(calls[1]?.data).toBe(
      encodeFunctionData({
        abi: tokenGrantFactoryAbi,
        functionName: "createGrant",
        args: [holder, shareToken, paymentToken, 1000n, 25n, 3000n, 1000n, 2000n, true, 1200n, salt],
      }),
    );
  });

  test("builds Boardroom direct transaction inputs", () => {
    expect(buildBoardroomMintTransaction({ boardroom, expectedFacetSetHash, to: holder, amount: 1000n })).toMatchObject({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "mint",
      args: [expectedFacetSetHash, holder, 1000n],
    });
    expect(buildBoardroomStartWindDownTransaction({ boardroom, expectedFacetSetHash })).toMatchObject({
      address: boardroom,
      functionName: "startWindDown",
    });
    expect(buildBoardroomWrapNativeBalanceTransaction({ boardroom, expectedFacetSetHash })).toMatchObject({
      address: boardroom,
      functionName: "wrapNativeBalance",
    });
    expect(buildBoardroomBurnTreasurySharesTransaction({ boardroom, expectedFacetSetHash })).toMatchObject({
      address: boardroom,
      functionName: "burnTreasuryShares",
    });
    expect(buildBoardroomOpenRedemptionsTransaction({ boardroom, expectedFacetSetHash })).toMatchObject({
      address: boardroom,
      functionName: "openRedemptions",
    });
    expect(buildBoardroomPruneObligationTransaction({ boardroom, expectedFacetSetHash, obligation: holder })).toMatchObject({
      address: boardroom,
      functionName: "pruneObligation",
      args: [expectedFacetSetHash, holder],
    });
    expect(buildBoardroomPruneObligationsTransaction({
      boardroom,
      expectedFacetSetHash,
      obligations: [holder, paymentToken],
    })).toMatchObject({
      address: boardroom,
      functionName: "pruneObligations",
      args: [expectedFacetSetHash, [holder, paymentToken]],
    });
    expect(() => buildBoardroomPruneObligationsTransaction({ boardroom, expectedFacetSetHash, obligations: [] })).toThrow();
    expect(buildBoardroomRegisterRedeemableAssetTransaction({
      boardroom,
      expectedFacetSetHash,
      asset: paymentToken,
    })).toMatchObject({
      address: boardroom,
      functionName: "registerRedeemableAsset",
      args: [expectedFacetSetHash, paymentToken],
    });
    expect(buildBoardroomRedeemTransaction({ boardroom, expectedFacetSetHash, shares: 10n })).toMatchObject({
      address: boardroom,
      functionName: "redeem",
      args: [expectedFacetSetHash, 10n],
    });
    expect(
      buildBoardroomClaimRedemptionAssetTransaction({
        boardroom,
        expectedFacetSetHash,
        asset: paymentToken,
        recipient: holder,
        minAmountOut: 5n,
      }),
    ).toMatchObject({
      address: boardroom,
      functionName: "claimRedemptionAsset",
      args: [expectedFacetSetHash, paymentToken, holder, 5n],
    });
  });

  test("builds Boardroom protocol-liquidity transaction inputs", () => {
    const batch = buildBoardroomProtocolLiquidityBatch({
      boardroom,
      expectedFacetSetHash,
      factory: liquidityFactory,
      shareToken,
      terms: protocolLiquidityTerms,
      policy: liquidityFactory,
      assetPolicy,
    });

    expect(batch.address).toBe(boardroom);
    expect(batch.abi).toBe(boardroomAbi);
    expect(batch.functionName).toBe("executeBatch");
    expect(batch.value).toBe(0n);

    const calls = batch.args[1];
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ policy: assetPolicy, target: shareToken, value: 0n });
    expect(calls[0]?.data).toBe(
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [liquidityFactory, protocolLiquidityTerms.shareAmountDesired],
      }),
    );
    expect(calls[1]).toMatchObject({ policy: assetPolicy, target: paymentToken, value: 0n });
    expect(calls[1]?.data).toBe(
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [liquidityFactory, protocolLiquidityTerms.quoteAmountDesired],
      }),
    );
    expect(calls[2]).toMatchObject({ policy: liquidityFactory, target: liquidityFactory, value: 0n });
    expect(calls[2]?.data).toBe(
      encodeFunctionData({
        abi: pledgeV4LiquidityFactoryAbi,
        functionName: "createProtocolLiquidity",
        args: [
          {
            tokenA: shareToken,
            tokenB: paymentToken,
            amountADesired: 1000n,
            amountBDesired: 2000n,
            amountAMin: 900n,
            amountBMin: 1900n,
            sqrtPriceX96: 1n << 96n,
            deadline: 12345n,
            salt,
          },
        ],
      }),
    );

    const add = buildBoardroomProtocolLiquidityAddBatch({
      boardroom,
      expectedFacetSetHash,
      factory: liquidityFactory,
      shareToken,
      terms: {
        ...protocolLiquidityTerms,
        shareTokenSide: "tokenA",
      },
      policy: liquidityFactory,
      assetPolicy,
    });
    expect(add.args[1]).toHaveLength(3);
    expect(add.args[1][2]).toMatchObject({ policy: liquidityFactory, target: liquidityFactory });
    expect(add.args[1][2]?.data).toBe(encodeFunctionData({
      abi: pledgeV4LiquidityFactoryAbi,
      functionName: "addProtocolLiquidity",
      args: [{
        tokenA: shareToken,
        tokenB: paymentToken,
        amountADesired: 1000n,
        amountBDesired: 2000n,
        amountAMin: 900n,
        amountBMin: 1900n,
        deadline: 12345n,
      }],
    }));

    const remove = buildBoardroomProtocolLiquidityRemoveAction({
      boardroom,
      expectedFacetSetHash,
      policy: liquidityFactory,
      factory: liquidityFactory,
      liquidity: 5n,
      amountAMin: 1n,
      amountBMin: 2n,
      deadline: 12345n,
    });
    expect(remove.args[1]).toMatchObject({ policy: liquidityFactory, target: liquidityFactory });
    expect(remove.args[1].data).toBe(encodeFunctionData({
      abi: pledgeV4LiquidityFactoryAbi,
      functionName: "removeProtocolLiquidity",
      args: [{ liquidity: 5n, amountAMin: 1n, amountBMin: 2n, deadline: 12345n }],
    }));

    const close = buildBoardroomProtocolLiquidityCloseAction({
      boardroom,
      expectedFacetSetHash,
      policy: liquidityFactory,
      factory: liquidityFactory,
    });
    expect(close.args[1]).toMatchObject({ policy: liquidityFactory, target: liquidityFactory });
    expect(close.args[1].data).toBe(
      encodeFunctionData({ abi: pledgeV4LiquidityFactoryAbi, functionName: "closeProtocolLiquidity" }),
    );

    const exit = buildBoardroomProtocolLiquidityExitTransaction({
      boardroom,
      expectedFacetSetHash,
      amountAMin: 1n,
      amountBMin: 2n,
      deadline: 12345n,
    });
    expect(exit.address).toBe(boardroom);
    expect(exit.abi).toBe(boardroomAbi);
    expect(exit.functionName).toBe("exitProtocolLiquidity");
    expect(exit.args).toEqual([expectedFacetSetHash, 1n, 2n, 12345n]);

    const claim = buildBoardroomProtocolLiquidityFeeClaimAction({
      boardroom,
      expectedFacetSetHash,
      policy: liquidityFactory,
      vault: liquidityVault,
    });
    expect(claim.address).toBe(boardroom);
    expect(claim.abi).toBe(boardroomAbi);
    expect(claim.functionName).toBe("execute");
    expect(claim.args[1]).toMatchObject({ policy: liquidityFactory, target: liquidityVault, value: 0n });
    expect(claim.args[1].data).toBe(encodeFunctionData({ abi: pledgeV4LiquidityVaultAbi, functionName: "claimFees" }));
  });

  test("requires assetPolicy for Boardroom approval batches", () => {
    const error = /assetPolicy is required for Boardroom approval calls/;

    expect(() =>
      buildBoardroomShareGrantIssuanceBatch({
        boardroom,
        expectedFacetSetHash,
        factory,
        shareToken,
        terms: shareGrantTerms,
        policy: factory,
      }),
    ).toThrow(error);

    expect(() =>
      buildBoardroomProtocolLiquidityBatch({
        boardroom,
        expectedFacetSetHash,
        factory: liquidityFactory,
        shareToken,
        terms: protocolLiquidityTerms,
        policy: liquidityFactory,
      }),
    ).toThrow(error);
  });

  test("reads canonical PoolId and predicts protocol-liquidity vault addresses", async () => {
    const client = mockReadClient({
      poolIdFor: poolId,
      predictLiquidityVaultAddress: liquidityVault,
    });

    await expect(readProtocolLiquidityPoolId(client, { factory: liquidityFactory, tokenA: shareToken, tokenB: paymentToken })).resolves.toBe(poolId);
    await expect(predictProtocolLiquidityVaultAddress(client, { factory: liquidityFactory, boardroom, salt })).resolves.toBe(liquidityVault);
  });

  test("folds creation, transfer, and close logs into issued and held grants", async () => {
    const firstGrant = "0x0000000000000000000000000000000000001001" as Address;
    const secondGrant = "0x0000000000000000000000000000000000001002" as Address;
    const client = mockLogClient({
      TokenGrantCreated: [
        createdLog(10n, 0, firstGrant, 1n, issuer, holder),
        createdLog(11n, 0, secondGrant, 2n, issuer, other),
      ],
      Transfer: [
        transferLog(10n, 1, "0x0000000000000000000000000000000000000000", holder, 1n),
        transferLog(11n, 1, "0x0000000000000000000000000000000000000000", other, 2n),
        transferLog(12n, 0, other, holder, 2n),
        transferLog(13n, 0, holder, "0x0000000000000000000000000000000000000000", 1n),
      ],
      GrantClosed: [closedLog(13n, 1, firstGrant, 1n, holder)],
    });

    const issued = await queryGrantsIssuedByAddress(client, { factory, issuer, fromBlock: 9n, includeClosed: true });
    expect(issued.map((grant) => grant.tokenId)).toEqual([2n, 1n]);
    expect(issued.find((grant) => grant.tokenId === 1n)?.closed).toBe(true);

    const heldOpen = await queryGrantsHeldByAddress(client, { factory, holder, fromBlock: 9n });
    expect(heldOpen.map((grant) => grant.grantAddress)).toEqual([secondGrant]);

    const heldWithClosed = await queryGrantsHeldByAddress(client, { factory, holder, fromBlock: 9n, includeClosed: true });
    expect(heldWithClosed.map((grant) => grant.tokenId)).toEqual([2n, 1n]);
    expect(heldWithClosed.find((grant) => grant.tokenId === 1n)?.lastHolder).toBe(holder);
  });

  test("discovers boardrooms and canonical protocol liquidity from logs", async () => {
    const client = mockLogClient({
      BoardroomCreated: [
        boardroomCreatedLog(20n, 0, boardroom, issuer),
        boardroomCreatedLog(20n, 0, boardroom, issuer),
        boardroomCreatedLog(21n, 0, other, holder),
      ],
      ProtocolLiquidityCreated: [
        protocolLiquidityCreatedLog(25n, 0, liquidityVault, boardroom),
        protocolLiquidityCreatedLog(26n, 0, other, holder),
      ],
    });

    const boardrooms = await discoverBoardrooms(client, { factory, owner: issuer, fromBlock: 19n });
    expect(boardrooms.complete).toBe(true);
    expect(boardrooms.items).toHaveLength(1);
    expect(boardrooms.items[0]).toMatchObject({ boardroom, owner: issuer, shareToken, name: "Pledge Common" });

    const vaults = await discoverBoardroomProtocolLiquidity(client, { factory: liquidityFactory, boardroom });
    expect(vaults.items).toHaveLength(1);
    expect(vaults.items[0]).toMatchObject({ vault: liquidityVault, boardroom, poolId });
  });

  test("returns partial discovery results when a chunked log range fails", async () => {
    const calls: [bigint, bigint | "latest" | undefined][] = [];
    const client: PledgeCashLogClient = {
      async getBlockNumber() {
        return 20n;
      },
      async getLogs(parameters) {
        calls.push([parameters.fromBlock as bigint, parameters.toBlock as bigint]);
        if (parameters.fromBlock === 15n) throw new Error("range too wide");
        return [boardroomCreatedLog(parameters.fromBlock as bigint, 0, boardroom, issuer)] as never;
      },
    };

    const result = await discoverBoardrooms(client, {
      factory,
      owner: issuer,
      fromBlock: 10n,
      toBlock: "latest",
      chunkSize: 5n,
    });

    expect(calls).toEqual([[10n, 14n], [15n, 19n]]);
    expect(result.complete).toBe(false);
    expect(result.lastScannedBlock).toBe(14n);
    expect(result.errors[0]?.message).toContain("Try a smaller chunk size");
    expect(result.items).toHaveLength(1);
  });

  test("applies transfer and close logs to known grants during resumed discovery", async () => {
    const knownGrant = (await queryGrantsIssuedByAddress(
      mockLogClient({ TokenGrantCreated: [createdLog(10n, 0, sale, 7n, issuer, holder)] }),
      { factory, issuer, fromBlock: 10n, includeClosed: true },
    ))[0];

    const resumed = await discoverGrantHistory(
      mockLogClient({
        Transfer: [transferLog(12n, 0, holder, other, 7n)],
        GrantClosed: [closedLog(13n, 0, sale, 7n, other)],
      }),
      { factory, fromBlock: 11n, knownGrants: [knownGrant] },
    );

    expect(resumed.items).toHaveLength(1);
    expect(resumed.items[0]).toMatchObject({
      tokenId: 7n,
      currentHolder: "0x0000000000000000000000000000000000000000",
      lastHolder: other,
      closed: true,
      updatedBlock: 13n,
    });
  });

  test("decodes known custom errors from shipped ABIs", () => {
    const data = encodeErrorResult({
      abi: tokenGrantFactoryAbi,
      errorName: "InvalidCreationFeePayment",
      args: [10n, 0n],
    });

    const decoded = decodeKnownPledgeCashError({ cause: { data } });

    expect(decoded?.name).toBe("InvalidCreationFeePayment");
    expect(decoded?.args).toEqual([10n, 0n]);
    expect(decoded?.message).toBe("Invalid creation fee payment: expected 10, received 0.");

    const factoryData = encodeErrorResult({
      abi: pledgeV4LiquidityFactoryAbi,
      errorName: "UnsafeLiquidityMinimums",
      args: [10n, 11n, 20n, 21n],
    });
    expect(decodeKnownPledgeCashError(factoryData)).toMatchObject({
      name: "UnsafeLiquidityMinimums",
      args: [10n, 11n, 20n, 21n],
    });

    const vaultData = encodeErrorResult({
      abi: pledgeV4LiquidityVaultAbi,
      errorName: "PositionNotEmpty",
      args: [33n],
    });
    expect(decodeKnownPledgeCashError(vaultData)).toMatchObject({ name: "PositionNotEmpty", args: [33n] });

  });
});

function mockReadClient(values: Record<string, unknown>): PledgeCashBlockReadClient {
  return {
    async getBlockNumber() {
      return 123n;
    },
    async readContract(parameters) {
      const functionName = parameters.functionName as string;
      if (!(functionName in values)) throw new Error(`Unexpected read: ${functionName}`);
      return values[functionName];
    },
  };
}

function mockLogClient(logs: Record<string, readonly unknown[]>): PledgeCashLogClient {
  return {
    async getLogs(parameters) {
      const eventName = (parameters.event as { name?: string }).name;
      return (eventName ? logs[eventName] ?? [] : []) as never;
    },
  };
}

function createdLog(
  blockNumber: bigint,
  logIndex: number,
  grantAddress: Address,
  tokenId: bigint,
  grantIssuer: Address,
  grantHolder: Address,
) {
  return {
    blockNumber,
    logIndex,
    transactionHash: `0x${tokenId.toString(16).padStart(64, "0")}` as Hex,
    args: {
      grantAddress,
      issuer: grantIssuer,
      holder: grantHolder,
      tokenId,
      transferable: true,
      transferUnlockTime: 1200n,
      token: grantToken,
      paymentToken,
      amount: 1000n,
      price: 25n,
      expiry: 3000n,
      vestingCliff: 1000n,
      vestingEnd: 2000n,
      salt,
    },
  };
}

function transferLog(blockNumber: bigint, logIndex: number, from: Address, to: Address, tokenId: bigint) {
  return {
    blockNumber,
    logIndex,
    args: { from, to, id: tokenId },
  };
}

function closedLog(blockNumber: bigint, logIndex: number, grantAddress: Address, tokenId: bigint, lastHolder: Address) {
  return {
    blockNumber,
    logIndex,
    args: { grantAddress, tokenId, lastHolder },
  };
}

function boardroomCreatedLog(blockNumber: bigint, logIndex: number, discoveredBoardroom: Address, owner: Address) {
  return {
    blockNumber,
    logIndex,
    transactionHash: `0x${blockNumber.toString(16).padStart(64, "0")}` as Hex,
    args: {
      boardroom: discoveredBoardroom,
      owner,
      policyRegistry: factory,
      wrappedNative,
      shareToken,
      name: "Pledge Common",
      symbol: "PLDG",
      salt,
      facetSetHash: expectedFacetSetHash,
    },
  };
}

function protocolLiquidityCreatedLog(
  blockNumber: bigint,
  logIndex: number,
  discoveredVault: Address,
  discoveredBoardroom: Address,
) {
  return {
    blockNumber,
    logIndex,
    transactionHash: `0x${(blockNumber + 200n).toString(16).padStart(64, "0")}` as Hex,
    args: {
      vault: discoveredVault,
      boardroom: discoveredBoardroom,
      poolId,
      quoteAsset: paymentToken,
      amountA: 1000n,
      amountB: 2000n,
      liquidity: 3000n,
      sqrtPriceX96: 1n << 96n,
      salt,
    },
  };
}
