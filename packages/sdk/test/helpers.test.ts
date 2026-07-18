import { describe, expect, test } from "bun:test";
import { decodeFunctionData, encodeErrorResult, encodeFunctionData, type Address, type Hex } from "viem";
import {
  ammPoolAbi,
  ammRouterAbi,
  boardroomAbi,
  boardroomTokenAbi,
  boardroomRewardsAbi,
  boardroomRewardsFactoryAbi,
  bondMarketAbi,
  bondMarketFactoryAbi,
  buildBoardroomBondMarketBatch,
  buildBoardroomBondMarketCloseAction,
  buildBondFinalizeTransaction,
  buildBondPurchaseTransaction,
  buildBondRedeemTransaction,
  buildBoardroomFixedPriceSaleCancelAction,
  buildBoardroomFixedPriceSaleCloseAction,
  buildBoardroomFixedPriceSaleBatch,
  buildBoardroomLockedLiquidityBatch,
  buildBoardroomLockedLiquidityExitTransaction,
  buildBoardroomLockedLiquidityFeeClaimAction,
  buildBoardroomMerkleAirdropBatch,
  buildBoardroomMerkleAirdropCancelAction,
  buildBoardroomMerkleAirdropCloseAction,
  buildBoardroomBurnTreasurySharesTransaction,
  buildBoardroomClaimRedemptionAssetTransaction,
  buildBoardroomMintTransaction,
  buildBoardroomMigratingCurveBatch,
  buildBoardroomMigratingCurveCancelAction,
  buildBoardroomMigratingCurveMigrationAction,
  buildBoardroomOpenRedemptionsTransaction,
  buildBoardroomRedeemTransaction,
  buildBoardroomRegisterRedeemableAssetTransaction,
  buildBoardroomRewardFundingBatch,
  buildBoardroomRewardsClaimTransaction,
  buildBoardroomRewardsCompleteUnstakeTransaction,
  buildBoardroomRewardsCreationTransaction,
  buildBoardroomRewardsStakeTransaction,
  buildBoardroomRewardsTerminalizeTransaction,
  buildBoardroomRewardsUnstakeRequestTransaction,
  buildBoardroomShareGrantIssuanceBatch,
  buildBoardroomStartWindDownTransaction,
  buildBoardroomWrapNativeBalanceTransaction,
  buildDirectGrantCreationTransaction,
  buildErc20Approval,
  buildMerkleAirdropClaimTransaction,
  buildMerkleAirdropGrantClaimTransaction,
  decodeKnownPledgeCashError,
  discoverBoardroomDistributions,
  discoverBoardroomLockedLiquidity,
  discoverBoardrooms,
  discoverGrantHistory,
  discoverPools,
  distributionFactoryAbi,
  erc20Abi,
  fixedPriceSaleAbi,
  lockedLiquidityAbi,
  lockedLiquidityFactoryAbi,
  merkleAirdropAbi,
  migratingBondingCurveAbi,
  poolFeesAbi,
  predictBondMarketAddress,
  predictAmmPoolAddress,
  predictLockedLiquidityAddress,
  predictMerkleAirdropAddress,
  predictMigratingBondingCurveAddress,
  queryGrantsHeldByAddress,
  queryGrantsIssuedByAddress,
  readBoardroomState,
  readBoardroomRewardsAccountState,
  readBoardroomRewardsState,
  readBondMarketState,
  readFactoryState,
  readFixedPriceSaleState,
  readGrantState,
  readLockedLiquidityState,
  readMerkleAirdropState,
  readMigratingBondingCurveState,
  tokenGrantFactoryAbi,
  type BoardroomLockedLiquidityTerms,
  type BondMarketTerms,
  type BoardroomFixedPriceSaleTerms,
  type BoardroomMerkleAirdropTerms,
  type BoardroomMigratingBondingCurveTerms,
  type GrantCreationTerms,
  type MerkleAirdropGrantClaimTerms,
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
const distributionFactory = "0x0000000000000000000000000000000000000d15" as Address;
const bondMarketFactory = "0x0000000000000000000000000000000000000b0d" as Address;
const bondMarket = "0x000000000000000000000000000000000000b0a1" as Address;
const assetPolicy = "0x0000000000000000000000000000000000000a55" as Address;
const sale = "0x0000000000000000000000000000000000000a1e" as Address;
const airdrop = "0x0000000000000000000000000000000000000a1d" as Address;
const curve = "0x0000000000000000000000000000000000000c0e" as Address;
const ammFactory = "0x0000000000000000000000000000000000000aee" as Address;
const lockedLiquidityFactory = "0x00000000000000000000000000000000000010cc" as Address;
const locker = "0x00000000000000000000000000000000000010cd" as Address;
const pool = "0x0000000000000000000000000000000000000a00" as Address;
const wrappedNative = "0x00000000000000000000000000000000000000ee" as Address;
const salt = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
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

const saleTerms = {
  paymentToken,
  shareAmount: 1000n,
  price: 25n,
  maxPerBuyer: 500n,
  startTime: 100n,
  endTime: 1000n,
  salt,
} satisfies BoardroomFixedPriceSaleTerms;

const curveTerms = {
  quoteToken: paymentToken,
  saleSupply: 1000n,
  migrationSupply: 500n,
  basePrice: 25n,
  slope: 2n,
  graduationQuoteTarget: 10_000n,
  quoteToLpBps: 5_000,
  startTime: 100n,
  endTime: 1000n,
  migrationSalt: "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
  salt,
} satisfies BoardroomMigratingBondingCurveTerms;

const airdropTerms = {
  shareAmount: 1000n,
  merkleRoot,
  startTime: 100n,
  endTime: 1000n,
  maxGrantClaims: 1,
  salt,
} satisfies BoardroomMerkleAirdropTerms;

const airdropGrantTerms = {
  paymentToken: "0x0000000000000000000000000000000000000000" as Address,
  price: 0n,
  expiry: 3000n,
  vestingCliff: 1000n,
  vestingEnd: 2000n,
  transferable: false,
  transferUnlockTime: 0n,
  salt,
} satisfies MerkleAirdropGrantClaimTerms;

const lockedLiquidityTerms = {
  quoteToken: paymentToken,
  shareAmountDesired: 1000n,
  quoteAmountDesired: 2000n,
  shareAmountMin: 900n,
  quoteAmountMin: 1900n,
  deadline: 12345n,
  salt,
} satisfies BoardroomLockedLiquidityTerms;

const bondTerms = {
  quoteToken: paymentToken,
  kind: 0,
  capacity: 1000n,
  initialPrice: 25n,
  minimumPrice: 10n,
  debtBuffer: 25_000,
  vesting: 604_800,
  start: 100,
  duration: 2_592_000,
  depositInterval: 86_400,
  salt,
} satisfies BondMarketTerms;

describe("SDK action and query helpers", () => {
  test("reads and predicts bond markets", async () => {
    const client = mockReadClient({
      factory: bondMarketFactory,
      boardroom,
      shareToken,
      quoteToken: paymentToken,
      marketKind: 0,
      marketStatus: 0,
      initialCapacity: 1000n,
      capacity: 900n,
      minimumPrice: 10n,
      marketPrice: 25n,
      maxPayout: 100n,
      purchased: 250n,
      sold: 100n,
      outstandingPayout: 100n,
      returnedPayout: 0n,
      startTime: 100,
      conclusion: 1000,
      vestingTerm: 604_800,
      nextPositionId: 1n,
      isLive: true,
      isClosed: false,
      predictBondMarketAddress: bondMarket,
    });

    await expect(readBondMarketState(client, bondMarket)).resolves.toMatchObject({
      address: bondMarket,
      factory: bondMarketFactory,
      boardroom,
      capacity: 900n,
      currentPrice: 25n,
      live: true,
    });
    await expect(predictBondMarketAddress(client, { factory: bondMarketFactory, boardroom, salt })).resolves.toBe(bondMarket);
  });

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
      status: 1,
      launched: true,
      executor: issuer,
      governanceDelay: 86_400n,
      governanceConfig: [86_400n, 604_800n, 100n, 1_000n],
      governanceState: [3n, 0n, 0n, 0n, 0],
      governanceEligibleSupply: 750n,
      getRedeemableAssets: [paymentToken],
      getIssuedGrants: [boardroom],
      getIssuedDistributions: [sale],
      getLockedLiquidityPositions: [locker],
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
      startTime: 100n,
      endTime: 1000n,
      saleStatus: 0,
      airdropStatus: 0,
      lockedLiquidityFactory,
      quoteToken: paymentToken,
      locker,
      pool: "0x0000000000000000000000000000000000000a00",
      migrationSupply: 500n,
      remainingSaleShares: 800n,
      basePrice: 25n,
      slope: 2n,
      graduationQuoteTarget: 10_000n,
      quoteToLpBps: 5_000,
      migrationSalt: curveTerms.migrationSalt,
      curveStatus: 0,
      soldShares: 200n,
      quoteReserve: 5_000n,
      graduationLatched: false,
      canMigrate: false,
      router: "0x0000000000000000000000000000000000000a0a",
      tokenA: shareToken,
      tokenB: paymentToken,
      seeded: true,
      lockedLiquidity: 777n,
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
      executor: issuer,
      governanceDelay: 86_400n,
      governanceEpoch: 3n,
      governanceEligibleSupply: 750n,
      governanceConfig: { minimumDelay: 86_400n, actionGracePeriod: 604_800n, vetoBps: 100n, windDownBps: 1_000n },
      redeemableAssets: [paymentToken],
      issuedDistributions: [sale],
      lockedLiquidityPositions: [locker],
    });
    await expect(readFixedPriceSaleState(client, sale)).resolves.toMatchObject({
      address: sale,
      boardroom,
      shareToken,
      paymentToken,
      remainingShares: 900n,
      closed: false,
    });
    await expect(readMerkleAirdropState(client, airdrop)).resolves.toMatchObject({
      address: airdrop,
      boardroom,
      shareToken,
      tokenGrantFactory: factory,
      airdropSupply: 1000n,
      claimedShares: 100n,
      remainingShares: 900n,
      merkleRoot,
      maxGrantClaims: 3,
      claimedGrantCount: 1,
      closed: false,
    });
    await expect(readMigratingBondingCurveState(client, curve)).resolves.toMatchObject({
      address: curve,
      boardroom,
      shareToken,
      quoteToken: paymentToken,
      remainingSaleShares: 800n,
      quoteToLpBps: 5000,
      graduationLatched: false,
      canMigrate: false,
      closed: false,
    });
    await expect(readLockedLiquidityState(client, locker)).resolves.toMatchObject({
      address: locker,
      boardroom,
      tokenA: shareToken,
      tokenB: paymentToken,
      pool: "0x0000000000000000000000000000000000000a00",
      seeded: true,
      lockedLiquidity: 777n,
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

    const calls = batch.args[0];
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

  test("reads Boardroom reward pool and account staking state", async () => {
    const client = {
      async readContract(parameters: { functionName: string; args?: readonly unknown[] }) {
        switch (parameters.functionName) {
          case "factory": return factory;
          case "boardroom": return boardroom;
          case "shareToken": return shareToken;
          case "cooldown": return 86_400n;
          case "terminalized": return false;
          case "totalActiveStake": return 1_000n;
          case "getRewardAssets": return [paymentToken];
          case "rewardState": return [1_000n, 100n, 2n, 3n, 4n];
          case "activeStakeOf": return 100n;
          case "lockedStakeOf": return 120n;
          case "MAX_PENDING_UNSTAKES": return 2n;
          case "transferableBalanceOf": return 880n;
          case "unstakeRequest": return parameters.args?.[1] === 0n ? [20n, 500n] : [0n, 0n];
          case "earned": return 7n;
          default: throw new Error(`Unexpected read: ${parameters.functionName}`);
        }
      },
    } as unknown as PledgeCashReadClient;

    await expect(readBoardroomRewardsState(client, rewardPool)).resolves.toMatchObject({
      address: rewardPool,
      factory,
      boardroom,
      shareToken,
      cooldown: 86_400n,
      totalActiveStake: 1_000n,
      rewardAssets: [{ asset: paymentToken, rewardRate: 2n, unallocated: 4n }],
    });
    await expect(readBoardroomRewardsAccountState(client, { rewards: rewardPool, account: holder })).resolves.toMatchObject({
      rewards: rewardPool,
      account: holder,
      activeStake: 100n,
      lockedStake: 120n,
      transferableBalance: 880n,
      pendingUnstakes: [{ slot: 0, amount: 20n, unlockAt: 500n }],
      earned: [{ asset: paymentToken, amount: 7n }],
    });
  });

  test("builds reward pool creation, funding, staking, cooldown, and claim inputs", () => {
    const creation = buildBoardroomRewardsCreationTransaction({
      boardroom,
      factory,
      cooldown: 86_400n,
      salt,
    });
    expect(creation).toMatchObject({ address: boardroom, functionName: "execute" });
    const creationCall = creation.args[0];
    expect(creationCall).toMatchObject({ policy: factory, target: factory, value: 0n });
    expect(decodeFunctionData({ abi: boardroomRewardsFactoryAbi, data: creationCall.data })).toMatchObject({
      functionName: "createRewards",
      args: [86_400n, salt],
    });

    const funding = buildBoardroomRewardFundingBatch({
      boardroom,
      factory,
      assetPolicy,
      rewards: rewardPool,
      asset: paymentToken,
      amount: 1_000n,
      duration: 604_800n,
    });
    expect(funding).toMatchObject({ address: boardroom, functionName: "executeBatch" });
    const fundingCalls = funding.args[0];
    expect(fundingCalls).toHaveLength(2);
    const decodedFunding = decodeFunctionData({ abi: boardroomRewardsFactoryAbi, data: fundingCalls[1]!.data });
    expect(decodedFunding.functionName).toBe("fundReward");
    expect(String(decodedFunding.args?.[0]).toLowerCase()).toBe(rewardPool.toLowerCase());
    expect(String(decodedFunding.args?.[1]).toLowerCase()).toBe(paymentToken.toLowerCase());
    expect(decodedFunding.args?.slice(2)).toEqual([1_000n, 604_800n]);

    expect(buildBoardroomRewardsStakeTransaction({ rewards: rewardPool, amount: 100n })).toMatchObject({
      abi: boardroomRewardsAbi,
      functionName: "stake",
      args: [100n],
    });
    expect(buildBoardroomRewardsUnstakeRequestTransaction({ rewards: rewardPool, amount: 20n })).toMatchObject({
      functionName: "requestUnstake",
      args: [20n],
    });
    expect(buildBoardroomRewardsCompleteUnstakeTransaction({ rewards: rewardPool, account: holder, slot: 0n })).toMatchObject({
      functionName: "completeUnstake",
      args: [holder, 0n],
    });
    expect(buildBoardroomRewardsClaimTransaction({ rewards: rewardPool, asset: paymentToken, recipient: holder })).toMatchObject({
      functionName: "claim",
      args: [paymentToken, holder],
    });
    expect(buildBoardroomRewardsTerminalizeTransaction({ rewards: rewardPool })).toMatchObject({
      functionName: "terminalize",
    });
  });

  test("builds Boardroom direct transaction inputs", () => {
    expect(buildBoardroomMintTransaction({ boardroom, to: holder, amount: 1000n })).toMatchObject({
      address: boardroom,
      abi: boardroomAbi,
      functionName: "mint",
      args: [holder, 1000n],
    });
    expect(buildBoardroomStartWindDownTransaction({ boardroom })).toMatchObject({
      address: boardroom,
      functionName: "startWindDown",
    });
    expect(buildBoardroomWrapNativeBalanceTransaction({ boardroom })).toMatchObject({
      address: boardroom,
      functionName: "wrapNativeBalance",
    });
    expect(buildBoardroomBurnTreasurySharesTransaction({ boardroom })).toMatchObject({
      address: boardroom,
      functionName: "burnTreasuryShares",
    });
    expect(buildBoardroomOpenRedemptionsTransaction({ boardroom })).toMatchObject({
      address: boardroom,
      functionName: "openRedemptions",
    });
    expect(buildBoardroomRegisterRedeemableAssetTransaction({ boardroom, asset: paymentToken })).toMatchObject({
      address: boardroom,
      functionName: "registerRedeemableAsset",
      args: [paymentToken],
    });
    expect(buildBoardroomRedeemTransaction({ boardroom, shares: 10n, recipient: holder, minAmountsOut: [1n, 2n] })).toMatchObject({
      address: boardroom,
      functionName: "redeem",
      args: [10n, holder, [1n, 2n]],
    });
    expect(
      buildBoardroomClaimRedemptionAssetTransaction({
        boardroom,
        asset: paymentToken,
        recipient: holder,
        minAmountOut: 5n,
      }),
    ).toMatchObject({
      address: boardroom,
      functionName: "claimRedemptionAsset",
      args: [paymentToken, holder, 5n],
    });
  });

  test("builds Boardroom fixed-price sale batch transaction inputs", () => {
    const batch = buildBoardroomFixedPriceSaleBatch({
      boardroom,
      factory: distributionFactory,
      shareToken,
      terms: saleTerms,
      policy: distributionFactory,
      assetPolicy,
    });

    expect(batch.address).toBe(boardroom);
    expect(batch.abi).toBe(boardroomAbi);
    expect(batch.functionName).toBe("executeBatch");
    expect(batch.value).toBe(0n);

    const calls = batch.args[0];
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ policy: assetPolicy, target: shareToken, value: 0n });
    expect(calls[0]?.data).toBe(
      encodeFunctionData({
        abi: boardroomTokenAbi,
        functionName: "approve",
        args: [distributionFactory, saleTerms.shareAmount],
      }),
    );
    expect(calls[1]).toMatchObject({ policy: distributionFactory, target: distributionFactory, value: 0n });
    expect(calls[1]?.data).toBe(
      encodeFunctionData({
        abi: distributionFactoryAbi,
        functionName: "createFixedPriceSale",
        args: [
          {
            shareToken,
            paymentToken,
            shareAmount: 1000n,
            price: 25n,
            maxPerBuyer: 500n,
            startTime: 100n,
            endTime: 1000n,
            salt,
          },
        ],
      }),
    );

    const close = buildBoardroomFixedPriceSaleCloseAction({
      boardroom,
      policy: distributionFactory,
      sale,
    });
    expect(close.address).toBe(boardroom);
    expect(close.abi).toBe(boardroomAbi);
    expect(close.functionName).toBe("execute");
    expect(close.args[0]).toMatchObject({ policy: distributionFactory, target: sale, value: 0n });
    expect(close.args[0].data).toBe(encodeFunctionData({ abi: fixedPriceSaleAbi, functionName: "close" }));

    const cancel = buildBoardroomFixedPriceSaleCancelAction({
      boardroom,
      policy: distributionFactory,
      sale,
    });
    expect(cancel.address).toBe(boardroom);
    expect(cancel.abi).toBe(boardroomAbi);
    expect(cancel.functionName).toBe("execute");
    expect(cancel.args[0]).toMatchObject({ policy: distributionFactory, target: sale, value: 0n });
    expect(cancel.args[0].data).toBe(encodeFunctionData({ abi: fixedPriceSaleAbi, functionName: "cancel" }));
  });

  test("builds non-transferable bond market transactions", () => {
    const batch = buildBoardroomBondMarketBatch({
      boardroom,
      factory: bondMarketFactory,
      shareToken,
      terms: bondTerms,
      policy: bondMarketFactory,
      assetPolicy,
    });

    expect(batch.address).toBe(boardroom);
    expect(batch.functionName).toBe("executeBatch");
    expect(batch.args[0][0]?.data).toBe(encodeFunctionData({
      abi: boardroomTokenAbi,
      functionName: "approve",
      args: [bondMarketFactory, bondTerms.capacity],
    }));
    expect(batch.args[0][1]?.data).toBe(encodeFunctionData({
      abi: bondMarketFactoryAbi,
      functionName: "createBondMarket",
      args: [{
        quoteToken: bondTerms.quoteToken,
        kind: bondTerms.kind,
        capacity: bondTerms.capacity,
        initialPrice: bondTerms.initialPrice,
        minimumPrice: bondTerms.minimumPrice,
        debtBuffer: bondTerms.debtBuffer,
        vesting: bondTerms.vesting,
        start: bondTerms.start,
        duration: bondTerms.duration,
        depositInterval: bondTerms.depositInterval,
        salt: bondTerms.salt,
      }],
    }));

    const close = buildBoardroomBondMarketCloseAction({ boardroom, policy: bondMarketFactory, market: bondMarket });
    expect(close.args[0]).toMatchObject({ policy: bondMarketFactory, target: bondMarket, value: 0n });
    expect(close.args[0].data).toBe(encodeFunctionData({ abi: bondMarketAbi, functionName: "close" }));
    expect(buildBondPurchaseTransaction({ market: bondMarket, quoteAmount: 25n, minimumPayout: 9n, deadline: 999n }))
      .toMatchObject({ address: bondMarket, functionName: "purchase", args: [25n, 9n, 999n] });
    expect(buildBondRedeemTransaction({ market: bondMarket, positionId: 7n }))
      .toMatchObject({ address: bondMarket, functionName: "redeem", args: [7n] });
    expect(buildBondFinalizeTransaction({ market: bondMarket }))
      .toMatchObject({ address: bondMarket, functionName: "finalize" });
  });

  test("builds Boardroom migrating bonding curve transaction inputs", () => {
    const batch = buildBoardroomMigratingCurveBatch({
      boardroom,
      factory: distributionFactory,
      shareToken,
      terms: curveTerms,
      policy: distributionFactory,
      assetPolicy,
    });

    expect(batch.address).toBe(boardroom);
    expect(batch.abi).toBe(boardroomAbi);
    expect(batch.functionName).toBe("executeBatch");
    expect(batch.value).toBe(0n);

    const calls = batch.args[0];
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ policy: assetPolicy, target: shareToken, value: 0n });
    expect(calls[0]?.data).toBe(
      encodeFunctionData({
        abi: boardroomTokenAbi,
        functionName: "approve",
        args: [distributionFactory, curveTerms.saleSupply + curveTerms.migrationSupply],
      }),
    );
    expect(calls[1]).toMatchObject({ policy: distributionFactory, target: distributionFactory, value: 0n });
    expect(calls[1]?.data).toBe(
      encodeFunctionData({
        abi: distributionFactoryAbi,
        functionName: "createMigratingBondingCurve",
        args: [
          {
            shareToken,
            quoteToken: paymentToken,
            saleSupply: 1000n,
            migrationSupply: 500n,
            basePrice: 25n,
            slope: 2n,
            graduationQuoteTarget: 10_000n,
            quoteToLpBps: 5_000,
            startTime: 100n,
            endTime: 1000n,
            migrationSalt: curveTerms.migrationSalt,
            salt,
          },
        ],
      }),
    );

    const cancel = buildBoardroomMigratingCurveCancelAction({
      boardroom,
      policy: distributionFactory,
      curve,
    });
    expect(cancel.address).toBe(boardroom);
    expect(cancel.abi).toBe(boardroomAbi);
    expect(cancel.functionName).toBe("execute");
    expect(cancel.args[0]).toMatchObject({ policy: distributionFactory, target: curve, value: 0n });
    expect(cancel.args[0].data).toBe(encodeFunctionData({ abi: migratingBondingCurveAbi, functionName: "cancel" }));

    const migrate = buildBoardroomMigratingCurveMigrationAction({
      boardroom,
      policy: distributionFactory,
      curve,
      minShareLiquidity: 1n,
      minQuoteLiquidity: 2n,
      deadline: 12345n,
    });
    expect(migrate.address).toBe(boardroom);
    expect(migrate.abi).toBe(boardroomAbi);
    expect(migrate.functionName).toBe("execute");
    expect(migrate.args[0]).toMatchObject({ policy: distributionFactory, target: curve, value: 0n });
    expect(migrate.args[0].data).toBe(
      encodeFunctionData({
        abi: migratingBondingCurveAbi,
        functionName: "migrate",
        args: [1n, 2n, 12345n],
      }),
    );
  });

  test("builds Boardroom Merkle airdrop and claim transaction inputs", () => {
    const batch = buildBoardroomMerkleAirdropBatch({
      boardroom,
      factory: distributionFactory,
      shareToken,
      terms: airdropTerms,
      policy: distributionFactory,
      assetPolicy,
    });

    expect(batch.address).toBe(boardroom);
    expect(batch.abi).toBe(boardroomAbi);
    expect(batch.functionName).toBe("executeBatch");
    expect(batch.value).toBe(0n);

    const calls = batch.args[0];
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ policy: assetPolicy, target: shareToken, value: 0n });
    expect(calls[0]?.data).toBe(
      encodeFunctionData({
        abi: boardroomTokenAbi,
        functionName: "approve",
        args: [distributionFactory, airdropTerms.shareAmount],
      }),
    );
    expect(calls[1]).toMatchObject({ policy: distributionFactory, target: distributionFactory, value: 0n });
    expect(calls[1]?.data).toBe(
      encodeFunctionData({
        abi: distributionFactoryAbi,
        functionName: "createMerkleAirdrop",
        args: [
          {
            shareToken,
            shareAmount: 1000n,
            merkleRoot,
            startTime: 100n,
            endTime: 1000n,
            maxGrantClaims: 1,
            salt,
          },
        ],
      }),
    );

    const close = buildBoardroomMerkleAirdropCloseAction({ boardroom, policy: distributionFactory, airdrop });
    expect(close.args[0]).toMatchObject({ policy: distributionFactory, target: airdrop, value: 0n });
    expect(close.args[0].data).toBe(encodeFunctionData({ abi: merkleAirdropAbi, functionName: "close" }));

    const cancel = buildBoardroomMerkleAirdropCancelAction({ boardroom, policy: distributionFactory, airdrop });
    expect(cancel.args[0]).toMatchObject({ policy: distributionFactory, target: airdrop, value: 0n });
    expect(cancel.args[0].data).toBe(encodeFunctionData({ abi: merkleAirdropAbi, functionName: "cancel" }));

    expect(buildMerkleAirdropClaimTransaction({ airdrop, index: 1n, account: holder, amount: 100n, proof })).toMatchObject({
      address: airdrop,
      abi: merkleAirdropAbi,
      functionName: "claim",
      args: [1n, holder, 100n, proof],
    });

    expect(
      buildMerkleAirdropGrantClaimTransaction({
        airdrop,
        index: 2n,
        account: holder,
        amount: 250n,
        terms: airdropGrantTerms,
        proof,
      }),
    ).toMatchObject({
      address: airdrop,
      abi: merkleAirdropAbi,
      functionName: "claimGrant",
      args: [2n, holder, 250n, airdropGrantTerms, proof],
    });
  });

  test("builds Boardroom locked-liquidity transaction inputs", () => {
    const batch = buildBoardroomLockedLiquidityBatch({
      boardroom,
      factory: lockedLiquidityFactory,
      shareToken,
      terms: lockedLiquidityTerms,
      policy: lockedLiquidityFactory,
      assetPolicy,
    });

    expect(batch.address).toBe(boardroom);
    expect(batch.abi).toBe(boardroomAbi);
    expect(batch.functionName).toBe("executeBatch");
    expect(batch.value).toBe(0n);

    const calls = batch.args[0];
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ policy: assetPolicy, target: shareToken, value: 0n });
    expect(calls[0]?.data).toBe(
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [lockedLiquidityFactory, lockedLiquidityTerms.shareAmountDesired],
      }),
    );
    expect(calls[1]).toMatchObject({ policy: assetPolicy, target: paymentToken, value: 0n });
    expect(calls[1]?.data).toBe(
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [lockedLiquidityFactory, lockedLiquidityTerms.quoteAmountDesired],
      }),
    );
    expect(calls[2]).toMatchObject({ policy: lockedLiquidityFactory, target: lockedLiquidityFactory, value: 0n });
    expect(calls[2]?.data).toBe(
      encodeFunctionData({
        abi: lockedLiquidityFactoryAbi,
        functionName: "createLockedLiquidity",
        args: [
          {
            tokenA: shareToken,
            tokenB: paymentToken,
            amountADesired: 1000n,
            amountBDesired: 2000n,
            amountAMin: 900n,
            amountBMin: 1900n,
            deadline: 12345n,
            salt,
          },
        ],
      }),
    );

    const exit = buildBoardroomLockedLiquidityExitTransaction({
      boardroom,
      locker,
      amountAMin: 1n,
      amountBMin: 2n,
      deadline: 12345n,
    });
    expect(exit.address).toBe(boardroom);
    expect(exit.abi).toBe(boardroomAbi);
    expect(exit.functionName).toBe("exitLockedLiquidity");
    expect(exit.args).toEqual([locker, 1n, 2n, 12345n]);

    const claim = buildBoardroomLockedLiquidityFeeClaimAction({
      boardroom,
      policy: lockedLiquidityFactory,
      locker,
    });
    expect(claim.address).toBe(boardroom);
    expect(claim.abi).toBe(boardroomAbi);
    expect(claim.functionName).toBe("execute");
    expect(claim.args[0]).toMatchObject({ policy: lockedLiquidityFactory, target: locker, value: 0n });
    expect(claim.args[0].data).toBe(encodeFunctionData({ abi: lockedLiquidityAbi, functionName: "claimFees" }));
  });

  test("requires assetPolicy for Boardroom approval batches", () => {
    const error = /assetPolicy is required for Boardroom approval calls/;

    expect(() =>
      buildBoardroomShareGrantIssuanceBatch({
        boardroom,
        factory,
        shareToken,
        terms: shareGrantTerms,
        policy: factory,
      }),
    ).toThrow(error);

    expect(() =>
      buildBoardroomFixedPriceSaleBatch({
        boardroom,
        factory: distributionFactory,
        shareToken,
        terms: saleTerms,
        policy: distributionFactory,
      }),
    ).toThrow(error);

    expect(() =>
      buildBoardroomBondMarketBatch({
        boardroom,
        factory: bondMarketFactory,
        shareToken,
        terms: bondTerms,
        policy: bondMarketFactory,
      }),
    ).toThrow(error);

    expect(() =>
      buildBoardroomMigratingCurveBatch({
        boardroom,
        factory: distributionFactory,
        shareToken,
        terms: curveTerms,
        policy: distributionFactory,
      }),
    ).toThrow(error);

    expect(() =>
      buildBoardroomLockedLiquidityBatch({
        boardroom,
        factory: lockedLiquidityFactory,
        shareToken,
        terms: lockedLiquidityTerms,
        policy: lockedLiquidityFactory,
      }),
    ).toThrow(error);
  });

  test("predicts AMM pool and locked-liquidity addresses", async () => {
    const pool = "0x0000000000000000000000000000000000000a00" as Address;
    const client = mockReadClient({
      predictPoolAddress: pool,
      predictLockedLiquidityAddress: locker,
      predictMigratingBondingCurveAddress: curve,
      predictMerkleAirdropAddress: airdrop,
    });

    await expect(predictAmmPoolAddress(client, { factory: ammFactory, tokenA: shareToken, tokenB: paymentToken })).resolves.toBe(pool);
    await expect(predictLockedLiquidityAddress(client, { factory: lockedLiquidityFactory, boardroom, salt })).resolves.toBe(locker);
    await expect(predictMigratingBondingCurveAddress(client, { factory: distributionFactory, boardroom, salt })).resolves.toBe(curve);
    await expect(predictMerkleAirdropAddress(client, { factory: distributionFactory, boardroom, salt })).resolves.toBe(airdrop);
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

  test("discovers boardrooms, distributions, lockers, and pools from logs", async () => {
    const client = mockLogClient({
      BoardroomCreated: [
        boardroomCreatedLog(20n, 0, boardroom, issuer),
        boardroomCreatedLog(20n, 0, boardroom, issuer),
        boardroomCreatedLog(21n, 0, other, holder),
      ],
      DistributionCreated: [
        distributionCreatedLog(22n, 0, sale, boardroom, 0n),
        distributionCreatedLog(23n, 0, curve, boardroom, 1n),
        distributionCreatedLog(24n, 0, airdrop, boardroom, 2n),
        distributionCreatedLog(24n, 0, other, holder, 1n),
      ],
      LockedLiquidityCreated: [
        lockedLiquidityCreatedLog(25n, 0, locker, boardroom),
        lockedLiquidityCreatedLog(26n, 0, other, holder),
      ],
      PoolCreated: [
        poolCreatedLog(19n, 0, pool, shareToken, paymentToken),
        poolCreatedLog(27n, 0, other, grantToken, paymentToken),
      ],
    });

    const boardrooms = await discoverBoardrooms(client, { factory, owner: issuer, fromBlock: 19n });
    expect(boardrooms.complete).toBe(true);
    expect(boardrooms.items).toHaveLength(1);
    expect(boardrooms.items[0]).toMatchObject({ boardroom, owner: issuer, shareToken, name: "Pledge Common" });

    const distributions = await discoverBoardroomDistributions(client, { factory: distributionFactory, boardroom });
    expect(distributions.items.map((item) => item.kind)).toEqual(["merkle-airdrop", "migrating-bonding-curve", "fixed-price-sale"]);
    expect(distributions.items.map((item) => item.distribution)).toEqual([airdrop, curve, sale]);

    const lockers = await discoverBoardroomLockedLiquidity(client, { factory: lockedLiquidityFactory, boardroom });
    expect(lockers.items).toHaveLength(1);
    expect(lockers.items[0]).toMatchObject({ locker, boardroom, pool });

    const pools = await discoverPools(client, { factory: ammFactory, token: shareToken });
    expect(pools.items).toHaveLength(1);
    expect(pools.items[0]).toMatchObject({ pool, token0: shareToken, token1: paymentToken });
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

    const routerData = encodeErrorResult({
      abi: ammRouterAbi,
      errorName: "TransferAmountMismatch",
      args: [paymentToken, 10n, 9n],
    });
    expect(decodeKnownPledgeCashError(routerData)).toMatchObject({
      name: "TransferAmountMismatch",
      args: [paymentToken, 10n, 9n],
    });

    const poolData = encodeErrorResult({
      abi: ammPoolAbi,
      errorName: "TooManySamplePoints",
      args: [33n, 32n],
    });
    expect(decodeKnownPledgeCashError(poolData)).toMatchObject({
      name: "TooManySamplePoints",
      args: [33n, 32n],
    });

    const feeVaultData = encodeErrorResult({ abi: poolFeesAbi, errorName: "OnlyPool" });
    expect(decodeKnownPledgeCashError(feeVaultData)).toMatchObject({ name: "OnlyPool", args: [] });

    const curveData = encodeErrorResult({
      abi: migratingBondingCurveAbi,
      errorName: "MigrationNotReady",
      args: [1n, 2n, 3n],
    });
    expect(decodeKnownPledgeCashError(curveData)).toMatchObject({
      name: "MigrationNotReady",
      args: [1n, 2n, 3n],
    });
  });
});

function mockReadClient(values: Record<string, unknown>): PledgeCashReadClient {
  return {
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
    },
  };
}

function distributionCreatedLog(
  blockNumber: bigint,
  logIndex: number,
  distribution: Address,
  distributionBoardroom: Address,
  kind: bigint,
) {
  return {
    blockNumber,
    logIndex,
    transactionHash: `0x${(blockNumber + 100n).toString(16).padStart(64, "0")}` as Hex,
    args: {
      distribution,
      boardroom: distributionBoardroom,
      kind,
      shareToken,
      paymentToken,
      shareAmount: 1000n,
      salt,
    },
  };
}

function lockedLiquidityCreatedLog(
  blockNumber: bigint,
  logIndex: number,
  discoveredLocker: Address,
  discoveredBoardroom: Address,
) {
  return {
    blockNumber,
    logIndex,
    transactionHash: `0x${(blockNumber + 200n).toString(16).padStart(64, "0")}` as Hex,
    args: {
      locker: discoveredLocker,
      boardroom: discoveredBoardroom,
      pool,
      tokenA: shareToken,
      tokenB: paymentToken,
      amountA: 1000n,
      amountB: 2000n,
      liquidity: 3000n,
      salt,
    },
  };
}

function poolCreatedLog(blockNumber: bigint, logIndex: number, discoveredPool: Address, token0: Address, token1: Address) {
  return {
    blockNumber,
    logIndex,
    transactionHash: `0x${(blockNumber + 300n).toString(16).padStart(64, "0")}` as Hex,
    args: {
      pool: discoveredPool,
      token0,
      token1,
      poolCount: 1n,
    },
  };
}
