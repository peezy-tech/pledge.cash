import {
  decodeErrorResult,
  encodeFunctionData,
  getAbiItem,
  isHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  ammFactoryAbi,
  ammPoolAbi,
  ammRouterAbi,
  boardroomAbi,
  boardroomFactoryAbi,
  boardroomPolicyRegistryAbi,
  boardroomTokenAbi,
  distributionFactoryAbi,
  erc20Abi,
  fixedPriceSaleAbi,
  lockedLiquidityAbi,
  lockedLiquidityFactoryAbi,
  migratingBondingCurveAbi,
  poolFeesAbi,
  tokenGrantAbi,
  tokenGrantFactoryAbi,
} from "./generated";

export type PledgeCashReadClient = Pick<PublicClient, "readContract">;

export type PledgeCashLogClient = Pick<PublicClient, "getLogs">;

type RawEventLog = {
  args?: Record<string, unknown>;
  blockNumber?: bigint;
  logIndex?: number;
  transactionHash?: Hex;
};

export type GrantCreationTerms = {
  holder: Address;
  token: Address;
  paymentToken: Address;
  amount: bigint;
  price: bigint;
  expiry: bigint;
  vestingCliff: bigint;
  vestingEnd: bigint;
  transferable: boolean;
  transferUnlockTime: bigint;
  salt: Hex;
};

export type BoardroomShareGrantTerms = Omit<GrantCreationTerms, "token">;

export type FixedPriceSaleTerms = {
  shareToken: Address;
  paymentToken: Address;
  shareAmount: bigint;
  price: bigint;
  maxPerBuyer: bigint;
  startTime: bigint;
  endTime: bigint;
  salt: Hex;
};

export type BoardroomFixedPriceSaleTerms = Omit<FixedPriceSaleTerms, "shareToken">;

export type MigratingBondingCurveTerms = {
  shareToken: Address;
  quoteToken: Address;
  saleSupply: bigint;
  migrationSupply: bigint;
  basePrice: bigint;
  slope: bigint;
  graduationQuoteTarget: bigint;
  quoteToLpBps: number;
  startTime: bigint;
  endTime: bigint;
  migrationSalt: Hex;
  salt: Hex;
};

export type BoardroomMigratingBondingCurveTerms = Omit<MigratingBondingCurveTerms, "shareToken">;

export type LockedLiquidityTerms = {
  tokenA: Address;
  tokenB: Address;
  amountADesired: bigint;
  amountBDesired: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
  deadline: bigint;
  salt: Hex;
};

export type BoardroomLockedLiquidityTerms = {
  quoteToken: Address;
  shareAmountDesired: bigint;
  quoteAmountDesired: bigint;
  shareAmountMin: bigint;
  quoteAmountMin: bigint;
  deadline: bigint;
  salt: Hex;
  shareTokenSide?: "tokenA" | "tokenB";
};

export type GrantCreationArgs = readonly [
  Address,
  Address,
  Address,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  boolean,
  bigint,
  Hex,
];

export type BoardroomCall = {
  policy: Address;
  target: Address;
  value: bigint;
  data: Hex;
};

export type FixedPriceSaleState = {
  address: Address;
  factory: Address;
  boardroom: Address;
  shareToken: Address;
  paymentToken: Address;
  saleSupply: bigint;
  remainingShares: bigint;
  price: bigint;
  maxPerBuyer: bigint;
  startTime: bigint;
  endTime: bigint;
  saleStatus: number;
  closed: boolean;
};

export type MigratingBondingCurveState = {
  address: Address;
  factory: Address;
  boardroom: Address;
  lockedLiquidityFactory: Address;
  shareToken: Address;
  quoteToken: Address;
  locker: Address;
  pool: Address;
  saleSupply: bigint;
  migrationSupply: bigint;
  remainingSaleShares: bigint;
  basePrice: bigint;
  slope: bigint;
  graduationQuoteTarget: bigint;
  quoteToLpBps: number;
  startTime: bigint;
  endTime: bigint;
  migrationSalt: Hex;
  curveStatus: number;
  soldShares: bigint;
  quoteReserve: bigint;
  canMigrate: boolean;
  closed: boolean;
};

export type LockedLiquidityState = {
  address: Address;
  factory: Address;
  boardroom: Address;
  router: Address;
  tokenA: Address;
  tokenB: Address;
  pool: Address;
  seeded: boolean;
  lockedLiquidity: bigint;
};

export type FactoryState = {
  address: Address;
  owner: Address;
  tokenGrantLogic: Address;
  creationFee: bigint;
};

export type GrantState = {
  address: Address;
  issuer: Address;
  holder: Address;
  token: Address;
  paymentToken: Address;
  grantSize: bigint;
  claimable: bigint;
  price: bigint;
  expiry: bigint;
  settledAmount: bigint;
  settleable: bigint;
  halted: boolean;
  closed: boolean;
};

export type BoardroomState = {
  address: Address;
  owner: Address;
  policyRegistry: Address;
  shareToken: Address;
  status: number;
  redeemableAssets: Address[];
  issuedGrants: Address[];
  issuedDistributions: Address[];
  lockedLiquidityPositions: Address[];
};

export type GrantDiscoveryRange = {
  factory: Address;
  fromBlock?: bigint;
  toBlock?: bigint | "latest";
};

export type DiscoveredGrant = {
  grantAddress: Address;
  tokenId: bigint;
  issuer: Address;
  initialHolder: Address;
  currentHolder: Address;
  token: Address;
  paymentToken: Address;
  amount: bigint;
  price: bigint;
  expiry: bigint;
  vestingCliff: bigint;
  vestingEnd: bigint;
  transferable: boolean;
  transferUnlockTime: bigint;
  salt: Hex;
  closed: boolean;
  lastHolder?: Address;
  createdBlock?: bigint;
  updatedBlock?: bigint;
  transactionHash?: Hex;
};

export type DecodedPledgeCashError = {
  name: string;
  args: readonly unknown[];
  data: Hex;
  message: string;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;

const tokenGrantCreatedEvent = getAbiItem({ abi: tokenGrantFactoryAbi, name: "TokenGrantCreated" });
const grantClosedEvent = getAbiItem({ abi: tokenGrantFactoryAbi, name: "GrantClosed" });
const transferEvent = getAbiItem({ abi: tokenGrantFactoryAbi, name: "Transfer" });

const pledgeCashErrorAbi = [
  ...ammFactoryAbi,
  ...ammPoolAbi,
  ...ammRouterAbi,
  ...boardroomAbi,
  ...boardroomFactoryAbi,
  ...boardroomPolicyRegistryAbi,
  ...boardroomTokenAbi,
  ...distributionFactoryAbi,
  ...fixedPriceSaleAbi,
  ...lockedLiquidityAbi,
  ...lockedLiquidityFactoryAbi,
  ...migratingBondingCurveAbi,
  ...poolFeesAbi,
  ...tokenGrantAbi,
  ...tokenGrantFactoryAbi,
].filter((item) => item.type === "error") as Abi;

export function grantCreationArgs(terms: GrantCreationTerms): GrantCreationArgs {
  return [
    terms.holder,
    terms.token,
    terms.paymentToken,
    terms.amount,
    terms.price,
    terms.expiry,
    terms.vestingCliff,
    terms.vestingEnd,
    terms.transferable,
    terms.transferUnlockTime,
    terms.salt,
  ] as const;
}

export async function readFactoryState(client: PledgeCashReadClient, factory: Address): Promise<FactoryState> {
  const [owner, tokenGrantLogic, creationFee] = await Promise.all([
    client.readContract({ address: factory, abi: tokenGrantFactoryAbi, functionName: "owner" }),
    client.readContract({ address: factory, abi: tokenGrantFactoryAbi, functionName: "tokenGrantLogic" }),
    client.readContract({ address: factory, abi: tokenGrantFactoryAbi, functionName: "creationFee" }),
  ]);

  return {
    address: factory,
    owner: owner as Address,
    tokenGrantLogic: tokenGrantLogic as Address,
    creationFee: creationFee as bigint,
  };
}

export async function readGrantState(
  client: PledgeCashReadClient,
  grant: Address,
  currentTime: bigint = BigInt(Math.floor(Date.now() / 1000)),
): Promise<GrantState> {
  const [
    issuer,
    holder,
    token,
    paymentToken,
    grantSize,
    claimable,
    price,
    expiry,
    settledAmount,
    halted,
    closed,
    settleable,
  ] = await Promise.all([
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "issuer" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "holder" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "token" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "paymentToken" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "grantSize" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "claimable" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "price" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "expiry" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "settledAmount" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "vestingIsHalted" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "isClosed" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "getSettleableAmount", args: [currentTime] }),
  ]);

  return {
    address: grant,
    issuer: issuer as Address,
    holder: holder as Address,
    token: token as Address,
    paymentToken: paymentToken as Address,
    grantSize: grantSize as bigint,
    claimable: claimable as bigint,
    price: price as bigint,
    expiry: expiry as bigint,
    settledAmount: settledAmount as bigint,
    halted: halted as boolean,
    closed: closed as boolean,
    settleable: settleable as bigint,
  };
}

export async function readBoardroomState(client: PledgeCashReadClient, boardroom: Address): Promise<BoardroomState> {
  const [
    owner,
    policyRegistry,
    shareToken,
    status,
    redeemableAssets,
    issuedGrants,
    issuedDistributions,
    lockedLiquidityPositions,
  ] =
    await Promise.all([
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "owner" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "policyRegistry" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "shareToken" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "status" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "getRedeemableAssets" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "getIssuedGrants" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "getIssuedDistributions" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "getLockedLiquidityPositions" }),
    ]);

  return {
    address: boardroom,
    owner: owner as Address,
    policyRegistry: policyRegistry as Address,
    shareToken: shareToken as Address,
    status: Number(status),
    redeemableAssets: redeemableAssets as Address[],
    issuedGrants: issuedGrants as Address[],
    issuedDistributions: issuedDistributions as Address[],
    lockedLiquidityPositions: lockedLiquidityPositions as Address[],
  };
}

export async function predictGrantAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; issuer: Address; salt: Hex },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: tokenGrantFactoryAbi,
    functionName: "predictGrantAddress",
    args: [input.issuer, input.salt],
  })) as Address;
}

export async function predictDirectGrantAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; issuer: Address; salt: Hex },
): Promise<Address> {
  return await predictGrantAddress(client, input);
}

export async function predictBoardroomGrantAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; boardroom: Address; salt: Hex },
): Promise<Address> {
  return await predictGrantAddress(client, { factory: input.factory, issuer: input.boardroom, salt: input.salt });
}

export async function predictBoardroomAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; owner: Address; name: string; symbol: string; salt: Hex },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: boardroomFactoryAbi,
    functionName: "predictBoardroomAddress",
    args: [input.owner, input.name, input.symbol, input.salt],
  })) as Address;
}

export async function predictFixedPriceSaleAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; boardroom: Address; salt: Hex },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: distributionFactoryAbi,
    functionName: "predictFixedPriceSaleAddress",
    args: [input.boardroom, input.salt],
  })) as Address;
}

export async function predictMigratingBondingCurveAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; boardroom: Address; salt: Hex },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: distributionFactoryAbi,
    functionName: "predictMigratingBondingCurveAddress",
    args: [input.boardroom, input.salt],
  })) as Address;
}

export async function predictAmmPoolAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; tokenA: Address; tokenB: Address },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: ammFactoryAbi,
    functionName: "predictPoolAddress",
    args: [input.tokenA, input.tokenB],
  })) as Address;
}

export async function predictLockedLiquidityAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; boardroom: Address; salt: Hex },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: lockedLiquidityFactoryAbi,
    functionName: "predictLockedLiquidityAddress",
    args: [input.boardroom, input.salt],
  })) as Address;
}

export async function readFixedPriceSaleState(
  client: PledgeCashReadClient,
  sale: Address,
): Promise<FixedPriceSaleState> {
  const [
    factory,
    boardroom,
    shareToken,
    paymentToken,
    saleSupply,
    remainingShares,
    price,
    maxPerBuyer,
    startTime,
    endTime,
    saleStatus,
    closed,
  ] = await Promise.all([
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "factory" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "boardroom" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "shareToken" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "paymentToken" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "saleSupply" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "remainingShares" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "price" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "maxPerBuyer" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "startTime" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "endTime" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "saleStatus" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "isClosed" }),
  ]);

  return {
    address: sale,
    factory: factory as Address,
    boardroom: boardroom as Address,
    shareToken: shareToken as Address,
    paymentToken: paymentToken as Address,
    saleSupply: saleSupply as bigint,
    remainingShares: remainingShares as bigint,
    price: price as bigint,
    maxPerBuyer: maxPerBuyer as bigint,
    startTime: startTime as bigint,
    endTime: endTime as bigint,
    saleStatus: Number(saleStatus),
    closed: closed as boolean,
  };
}

export async function readMigratingBondingCurveState(
  client: PledgeCashReadClient,
  curve: Address,
): Promise<MigratingBondingCurveState> {
  const [
    factory,
    boardroom,
    lockedLiquidityFactory,
    shareToken,
    quoteToken,
    locker,
    pool,
    saleSupply,
    migrationSupply,
    remainingSaleShares,
    basePrice,
    slope,
    graduationQuoteTarget,
    quoteToLpBps,
    startTime,
    endTime,
    migrationSalt,
    curveStatus,
    soldShares,
    quoteReserve,
    canMigrate,
    closed,
  ] = await Promise.all([
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "factory" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "boardroom" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "lockedLiquidityFactory" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "shareToken" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "quoteToken" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "locker" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "pool" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "saleSupply" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "migrationSupply" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "remainingSaleShares" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "basePrice" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "slope" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "graduationQuoteTarget" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "quoteToLpBps" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "startTime" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "endTime" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "migrationSalt" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "curveStatus" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "soldShares" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "quoteReserve" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "canMigrate" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "isClosed" }),
  ]);

  return {
    address: curve,
    factory: factory as Address,
    boardroom: boardroom as Address,
    lockedLiquidityFactory: lockedLiquidityFactory as Address,
    shareToken: shareToken as Address,
    quoteToken: quoteToken as Address,
    locker: locker as Address,
    pool: pool as Address,
    saleSupply: saleSupply as bigint,
    migrationSupply: migrationSupply as bigint,
    remainingSaleShares: remainingSaleShares as bigint,
    basePrice: basePrice as bigint,
    slope: slope as bigint,
    graduationQuoteTarget: graduationQuoteTarget as bigint,
    quoteToLpBps: Number(quoteToLpBps),
    startTime: startTime as bigint,
    endTime: endTime as bigint,
    migrationSalt: migrationSalt as Hex,
    curveStatus: Number(curveStatus),
    soldShares: soldShares as bigint,
    quoteReserve: quoteReserve as bigint,
    canMigrate: canMigrate as boolean,
    closed: closed as boolean,
  };
}

export async function readLockedLiquidityState(
  client: PledgeCashReadClient,
  locker: Address,
): Promise<LockedLiquidityState> {
  const [
    factory,
    boardroom,
    router,
    tokenA,
    tokenB,
    pool,
    seeded,
    lockedLiquidity,
  ] = await Promise.all([
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "factory" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "boardroom" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "router" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "tokenA" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "tokenB" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "pool" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "seeded" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "lockedLiquidity" }),
  ]);

  return {
    address: locker,
    factory: factory as Address,
    boardroom: boardroom as Address,
    router: router as Address,
    tokenA: tokenA as Address,
    tokenB: tokenB as Address,
    pool: pool as Address,
    seeded: seeded as boolean,
    lockedLiquidity: lockedLiquidity as bigint,
  };
}

export function buildErc20Approval(input: { token: Address; spender: Address; amount: bigint }) {
  return {
    address: input.token,
    abi: erc20Abi,
    functionName: "approve",
    args: [input.spender, input.amount] as const,
  };
}

export function buildDirectGrantCreationTransaction(input: {
  factory: Address;
  terms: GrantCreationTerms;
  creationFee?: bigint;
}) {
  return {
    address: input.factory,
    abi: tokenGrantFactoryAbi,
    functionName: "createGrant",
    args: grantCreationArgs(input.terms),
    value: input.creationFee ?? 0n,
  };
}

export function buildBoardroomMintTransaction(input: { boardroom: Address; to: Address; amount: bigint }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "mint",
    args: [input.to, input.amount] as const,
  };
}

export function buildBoardroomStartWindDownTransaction(input: { boardroom: Address }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "startWindDown",
  };
}

export function buildBoardroomBurnTreasurySharesTransaction(input: { boardroom: Address }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "burnTreasuryShares",
  };
}

export function buildBoardroomOpenRedemptionsTransaction(input: { boardroom: Address }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "openRedemptions",
  };
}

export function buildBoardroomRegisterRedeemableAssetTransaction(input: { boardroom: Address; asset: Address }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "registerRedeemableAsset",
    args: [input.asset] as const,
  };
}

export function buildBoardroomRedeemTransaction(input: {
  boardroom: Address;
  shares: bigint;
  recipient: Address;
  minAmountsOut: readonly bigint[];
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "redeem",
    args: [input.shares, input.recipient, input.minAmountsOut] as const,
  };
}

export function buildBoardroomCall(input: {
  policy: Address;
  target: Address;
  data: Hex;
  value?: bigint;
}): BoardroomCall {
  return {
    policy: input.policy,
    target: input.target,
    value: input.value ?? 0n,
    data: input.data,
  };
}

export function buildBoardroomExecuteTransaction(input: { boardroom: Address; call: BoardroomCall; value?: bigint }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "execute",
    args: [input.call] as const,
    value: input.value ?? input.call.value,
  };
}

export function buildBoardroomExecuteBatchTransaction(input: {
  boardroom: Address;
  calls: readonly BoardroomCall[];
  value?: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "executeBatch",
    args: [input.calls] as const,
    value: input.value ?? input.calls.reduce((total, call) => total + call.value, 0n),
  };
}

export function buildBoardroomGrantApprovalCall(input: {
  policy: Address;
  shareToken: Address;
  factory: Address;
  amount: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.shareToken,
    data: encodeFunctionData({
      abi: boardroomTokenAbi,
      functionName: "approve",
      args: [input.factory, input.amount],
    }),
  });
}

export function fixedPriceSaleArgs(terms: FixedPriceSaleTerms) {
  return [
    {
      shareToken: terms.shareToken,
      paymentToken: terms.paymentToken,
      shareAmount: terms.shareAmount,
      price: terms.price,
      maxPerBuyer: terms.maxPerBuyer,
      startTime: terms.startTime,
      endTime: terms.endTime,
      salt: terms.salt,
    },
  ] as const;
}

export function migratingBondingCurveArgs(terms: MigratingBondingCurveTerms) {
  return [
    {
      shareToken: terms.shareToken,
      quoteToken: terms.quoteToken,
      saleSupply: terms.saleSupply,
      migrationSupply: terms.migrationSupply,
      basePrice: terms.basePrice,
      slope: terms.slope,
      graduationQuoteTarget: terms.graduationQuoteTarget,
      quoteToLpBps: terms.quoteToLpBps,
      startTime: terms.startTime,
      endTime: terms.endTime,
      migrationSalt: terms.migrationSalt,
      salt: terms.salt,
    },
  ] as const;
}

export function lockedLiquidityArgs(terms: LockedLiquidityTerms) {
  return [
    {
      tokenA: terms.tokenA,
      tokenB: terms.tokenB,
      amountADesired: terms.amountADesired,
      amountBDesired: terms.amountBDesired,
      amountAMin: terms.amountAMin,
      amountBMin: terms.amountBMin,
      deadline: terms.deadline,
      salt: terms.salt,
    },
  ] as const;
}

export function buildBoardroomFixedPriceSaleApprovalCall(input: {
  policy: Address;
  shareToken: Address;
  factory: Address;
  amount: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.shareToken,
    data: encodeFunctionData({
      abi: boardroomTokenAbi,
      functionName: "approve",
      args: [input.factory, input.amount],
    }),
  });
}

export function buildBoardroomFixedPriceSaleCreationCall(input: {
  policy: Address;
  factory: Address;
  terms: FixedPriceSaleTerms;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.factory,
    data: encodeFunctionData({
      abi: distributionFactoryAbi,
      functionName: "createFixedPriceSale",
      args: fixedPriceSaleArgs(input.terms),
    }),
  });
}

export function buildBoardroomFixedPriceSaleBatch(input: {
  boardroom: Address;
  factory: Address;
  shareToken: Address;
  terms: BoardroomFixedPriceSaleTerms;
  policy?: Address;
}) {
  const policy = input.policy ?? input.factory;
  const terms = { ...input.terms, shareToken: input.shareToken } satisfies FixedPriceSaleTerms;
  const calls = [
    buildBoardroomFixedPriceSaleApprovalCall({
      policy,
      shareToken: input.shareToken,
      factory: input.factory,
      amount: input.terms.shareAmount,
    }),
    buildBoardroomFixedPriceSaleCreationCall({
      policy,
      factory: input.factory,
      terms,
    }),
  ] as const;

  return buildBoardroomExecuteBatchTransaction({
    boardroom: input.boardroom,
    calls,
  });
}

export function buildBoardroomFixedPriceSaleCloseAction(input: {
  boardroom: Address;
  policy: Address;
  sale: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.sale,
      data: encodeFunctionData({ abi: fixedPriceSaleAbi, functionName: "close" }),
    }),
  });
}

export function buildBoardroomFixedPriceSaleCancelAction(input: {
  boardroom: Address;
  policy: Address;
  sale: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.sale,
      data: encodeFunctionData({ abi: fixedPriceSaleAbi, functionName: "cancel" }),
    }),
  });
}

export function buildBoardroomMigratingCurveApprovalCall(input: {
  policy: Address;
  shareToken: Address;
  factory: Address;
  saleSupply: bigint;
  migrationSupply: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.shareToken,
    data: encodeFunctionData({
      abi: boardroomTokenAbi,
      functionName: "approve",
      args: [input.factory, input.saleSupply + input.migrationSupply],
    }),
  });
}

export function buildBoardroomMigratingCurveCreationCall(input: {
  policy: Address;
  factory: Address;
  terms: MigratingBondingCurveTerms;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.factory,
    data: encodeFunctionData({
      abi: distributionFactoryAbi,
      functionName: "createMigratingBondingCurve",
      args: migratingBondingCurveArgs(input.terms),
    }),
  });
}

export function buildBoardroomMigratingCurveBatch(input: {
  boardroom: Address;
  factory: Address;
  shareToken: Address;
  terms: BoardroomMigratingBondingCurveTerms;
  policy?: Address;
}) {
  const policy = input.policy ?? input.factory;
  const terms = { ...input.terms, shareToken: input.shareToken } satisfies MigratingBondingCurveTerms;
  const calls = [
    buildBoardroomMigratingCurveApprovalCall({
      policy,
      shareToken: input.shareToken,
      factory: input.factory,
      saleSupply: input.terms.saleSupply,
      migrationSupply: input.terms.migrationSupply,
    }),
    buildBoardroomMigratingCurveCreationCall({
      policy,
      factory: input.factory,
      terms,
    }),
  ] as const;

  return buildBoardroomExecuteBatchTransaction({
    boardroom: input.boardroom,
    calls,
  });
}

export function buildBoardroomMigratingCurveCancelAction(input: {
  boardroom: Address;
  policy: Address;
  curve: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.curve,
      data: encodeFunctionData({ abi: migratingBondingCurveAbi, functionName: "cancel" }),
    }),
  });
}

export function buildBoardroomMigratingCurveMigrationAction(input: {
  boardroom: Address;
  policy: Address;
  curve: Address;
  minShareLiquidity: bigint;
  minQuoteLiquidity: bigint;
  deadline: bigint;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.curve,
      data: encodeFunctionData({
        abi: migratingBondingCurveAbi,
        functionName: "migrate",
        args: [input.minShareLiquidity, input.minQuoteLiquidity, input.deadline],
      }),
    }),
  });
}

export function buildBoardroomLockedLiquidityApprovalCall(input: {
  policy: Address;
  token: Address;
  factory: Address;
  amount: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.token,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [input.factory, input.amount],
    }),
  });
}

export function buildBoardroomLockedLiquidityCreationCall(input: {
  policy: Address;
  factory: Address;
  terms: LockedLiquidityTerms;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.factory,
    data: encodeFunctionData({
      abi: lockedLiquidityFactoryAbi,
      functionName: "createLockedLiquidity",
      args: lockedLiquidityArgs(input.terms),
    }),
  });
}

export function buildBoardroomLockedLiquidityBatch(input: {
  boardroom: Address;
  factory: Address;
  shareToken: Address;
  terms: BoardroomLockedLiquidityTerms;
  policy?: Address;
}) {
  const policy = input.policy ?? input.factory;
  const shareTokenSide = input.terms.shareTokenSide ?? "tokenA";
  const terms =
    shareTokenSide === "tokenA"
      ? ({
          tokenA: input.shareToken,
          tokenB: input.terms.quoteToken,
          amountADesired: input.terms.shareAmountDesired,
          amountBDesired: input.terms.quoteAmountDesired,
          amountAMin: input.terms.shareAmountMin,
          amountBMin: input.terms.quoteAmountMin,
          deadline: input.terms.deadline,
          salt: input.terms.salt,
        } satisfies LockedLiquidityTerms)
      : ({
          tokenA: input.terms.quoteToken,
          tokenB: input.shareToken,
          amountADesired: input.terms.quoteAmountDesired,
          amountBDesired: input.terms.shareAmountDesired,
          amountAMin: input.terms.quoteAmountMin,
          amountBMin: input.terms.shareAmountMin,
          deadline: input.terms.deadline,
          salt: input.terms.salt,
        } satisfies LockedLiquidityTerms);
  const calls = [
    buildBoardroomLockedLiquidityApprovalCall({
      policy,
      token: input.shareToken,
      factory: input.factory,
      amount: input.terms.shareAmountDesired,
    }),
    buildBoardroomLockedLiquidityApprovalCall({
      policy,
      token: input.terms.quoteToken,
      factory: input.factory,
      amount: input.terms.quoteAmountDesired,
    }),
    buildBoardroomLockedLiquidityCreationCall({
      policy,
      factory: input.factory,
      terms,
    }),
  ] as const;

  return buildBoardroomExecuteBatchTransaction({
    boardroom: input.boardroom,
    calls,
  });
}

export function buildBoardroomLockedLiquidityExitTransaction(input: {
  boardroom: Address;
  locker: Address;
  amountAMin: bigint;
  amountBMin: bigint;
  deadline: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "exitLockedLiquidity",
    args: [input.locker, input.amountAMin, input.amountBMin, input.deadline] as const,
  };
}

export function buildBoardroomLockedLiquidityFeeClaimAction(input: {
  boardroom: Address;
  policy: Address;
  locker: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.locker,
      data: encodeFunctionData({ abi: lockedLiquidityAbi, functionName: "claimFees" }),
    }),
  });
}

export function buildBoardroomGrantCreationCall(input: {
  policy: Address;
  factory: Address;
  terms: GrantCreationTerms;
  creationFee?: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.factory,
    value: input.creationFee ?? 0n,
    data: encodeFunctionData({
      abi: tokenGrantFactoryAbi,
      functionName: "createGrant",
      args: grantCreationArgs(input.terms),
    }),
  });
}

export function buildBoardroomShareGrantIssuanceBatch(input: {
  boardroom: Address;
  factory: Address;
  shareToken: Address;
  terms: BoardroomShareGrantTerms;
  creationFee?: bigint;
  policy?: Address;
}) {
  const policy = input.policy ?? input.factory;
  const terms = { ...input.terms, token: input.shareToken } satisfies GrantCreationTerms;
  const calls = [
    buildBoardroomGrantApprovalCall({
      policy,
      shareToken: input.shareToken,
      factory: input.factory,
      amount: input.terms.amount,
    }),
    buildBoardroomGrantCreationCall({
      policy,
      factory: input.factory,
      terms,
      creationFee: input.creationFee ?? 0n,
    }),
  ] as const;

  return buildBoardroomExecuteBatchTransaction({
    boardroom: input.boardroom,
    calls,
    value: input.creationFee ?? 0n,
  });
}

export function buildGrantIssuerBoardroomAction(input: {
  boardroom: Address;
  policy: Address;
  grant: Address;
  functionName: "stopVestingAndWithdrawUnvested" | "withdrawExpiredTokens";
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.grant,
      data: encodeFunctionData({ abi: tokenGrantAbi, functionName: input.functionName }),
    }),
  });
}

export async function queryGrantHistory(
  client: PledgeCashLogClient,
  range: GrantDiscoveryRange,
): Promise<DiscoveredGrant[]> {
  const [createdLogs, transferLogs, closedLogs] = await Promise.all([
    getLogs(client, range, tokenGrantCreatedEvent),
    getLogs(client, range, transferEvent),
    getLogs(client, range, grantClosedEvent),
  ]);

  const grants = new Map<string, DiscoveredGrant>();

  for (const log of [...createdLogs].sort(compareLogs)) {
    const args = log.args ?? {};
    const grantAddress = addressArg(args, "grantAddress");
    const tokenId = bigintArg(args, "tokenId");
    if (!grantAddress || tokenId === undefined) continue;

    const discovered: DiscoveredGrant = {
      grantAddress,
      tokenId,
      issuer: addressArg(args, "issuer") ?? ZERO_ADDRESS,
      initialHolder: addressArg(args, "holder") ?? ZERO_ADDRESS,
      currentHolder: addressArg(args, "holder") ?? ZERO_ADDRESS,
      token: addressArg(args, "token") ?? ZERO_ADDRESS,
      paymentToken: addressArg(args, "paymentToken") ?? ZERO_ADDRESS,
      amount: bigintArg(args, "amount") ?? 0n,
      price: bigintArg(args, "price") ?? 0n,
      expiry: bigintArg(args, "expiry") ?? 0n,
      vestingCliff: bigintArg(args, "vestingCliff") ?? 0n,
      vestingEnd: bigintArg(args, "vestingEnd") ?? 0n,
      transferable: booleanArg(args, "transferable") ?? false,
      transferUnlockTime: bigintArg(args, "transferUnlockTime") ?? 0n,
      salt: hexArg(args, "salt") ?? "0x",
      closed: false,
    };
    if (log.blockNumber !== undefined) {
      discovered.createdBlock = log.blockNumber;
      discovered.updatedBlock = log.blockNumber;
    }
    if (log.transactionHash) {
      discovered.transactionHash = log.transactionHash;
    }

    grants.set(tokenKey(tokenId), discovered);
  }

  for (const log of [...transferLogs].sort(compareLogs)) {
    const args = log.args ?? {};
    const tokenId = bigintArg(args, "id") ?? bigintArg(args, "tokenId");
    if (tokenId === undefined) continue;
    const grant = grants.get(tokenKey(tokenId));
    if (!grant) continue;

    const to = addressArg(args, "to");
    if (to) {
      grant.currentHolder = to;
      if (log.blockNumber !== undefined) {
        grant.updatedBlock = log.blockNumber;
      }
    }
  }

  for (const log of [...closedLogs].sort(compareLogs)) {
    const tokenId = bigintArg(log.args ?? {}, "tokenId");
    if (tokenId === undefined) continue;
    const grant = grants.get(tokenKey(tokenId));
    if (!grant) continue;

    grant.closed = true;
    grant.currentHolder = ZERO_ADDRESS;
    const lastHolder = addressArg(log.args ?? {}, "lastHolder");
    if (lastHolder) {
      grant.lastHolder = lastHolder;
    }
    if (log.blockNumber !== undefined) {
      grant.updatedBlock = log.blockNumber;
    }
  }

  return [...grants.values()].sort((left, right) => compareBlockDesc(left.createdBlock, right.createdBlock));
}

export async function queryGrantsIssuedByAddress(
  client: PledgeCashLogClient,
  input: GrantDiscoveryRange & { issuer: Address; includeClosed?: boolean },
): Promise<DiscoveredGrant[]> {
  const grants = await queryGrantHistory(client, input);
  return grants.filter(
    (grant) => sameAddress(grant.issuer, input.issuer) && (input.includeClosed || !grant.closed),
  );
}

export async function queryGrantsHeldByAddress(
  client: PledgeCashLogClient,
  input: GrantDiscoveryRange & { holder: Address; includeClosed?: boolean },
): Promise<DiscoveredGrant[]> {
  const grants = await queryGrantHistory(client, input);
  return grants.filter((grant) => {
    if (sameAddress(grant.currentHolder, input.holder) && (input.includeClosed || !grant.closed)) return true;
    return Boolean(input.includeClosed && grant.closed && grant.lastHolder && sameAddress(grant.lastHolder, input.holder));
  });
}

export function decodeKnownPledgeCashError(input: unknown): DecodedPledgeCashError | undefined {
  const data = extractHexData(input);
  if (!data) return undefined;

  try {
    const decoded = decodeErrorResult({ abi: pledgeCashErrorAbi, data });
    const args = decoded.args ?? [];
    return {
      name: decoded.errorName,
      args,
      data,
      message: humanErrorMessage(decoded.errorName, args),
    };
  } catch {
    return undefined;
  }
}

export function pledgeCashErrorMessage(input: unknown): string {
  const decoded = decodeKnownPledgeCashError(input);
  if (decoded) return decoded.message;
  if (input instanceof Error) return input.message;
  return String(input);
}

async function getLogs(client: PledgeCashLogClient, range: GrantDiscoveryRange, event: unknown): Promise<readonly RawEventLog[]> {
  return (await client.getLogs({
    address: range.factory,
    event,
    fromBlock: range.fromBlock ?? 0n,
    toBlock: range.toBlock,
  } as never)) as readonly RawEventLog[];
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function compareLogs(left: RawEventLog, right: RawEventLog): number {
  const blockOrder = compareBlockAsc(left.blockNumber, right.blockNumber);
  if (blockOrder !== 0) return blockOrder;
  return (left.logIndex ?? 0) - (right.logIndex ?? 0);
}

function compareBlockAsc(left: bigint | undefined, right: bigint | undefined): number {
  const leftBlock = left ?? 0n;
  const rightBlock = right ?? 0n;
  if (leftBlock < rightBlock) return -1;
  if (leftBlock > rightBlock) return 1;
  return 0;
}

function compareBlockDesc(left: bigint | undefined, right: bigint | undefined): number {
  return compareBlockAsc(right, left);
}

function tokenKey(tokenId: bigint): string {
  return tokenId.toString();
}

function addressArg(args: Record<string, unknown>, name: string): Address | undefined {
  const value = args[name];
  return typeof value === "string" ? (value as Address) : undefined;
}

function hexArg(args: Record<string, unknown>, name: string): Hex | undefined {
  const value = args[name];
  return typeof value === "string" && isHex(value) ? value : undefined;
}

function bigintArg(args: Record<string, unknown>, name: string): bigint | undefined {
  const value = args[name];
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  return undefined;
}

function booleanArg(args: Record<string, unknown>, name: string): boolean | undefined {
  const value = args[name];
  return typeof value === "boolean" ? value : undefined;
}

function extractHexData(input: unknown, seen = new Set<unknown>()): Hex | undefined {
  if (typeof input === "string") return isHex(input) ? input : undefined;
  if (!input || typeof input !== "object" || seen.has(input)) return undefined;
  seen.add(input);

  const record = input as Record<string, unknown>;
  for (const key of ["data", "cause", "error", "details"]) {
    const value = record[key];
    const found = extractHexData(value, seen);
    if (found) return found;
  }

  return undefined;
}

function humanErrorMessage(name: string, args: readonly unknown[]): string {
  switch (name) {
    case "InvalidCreationFeePayment":
      return `Invalid creation fee payment: expected ${argString(args[0])}, received ${argString(args[1])}.`;
    case "UnexpectedTokenBalanceChange":
      return `Unexpected token balance change for ${argString(args[0])}: expected ${argString(
        args[1],
      )}, received ${argString(args[2])}.`;
    case "OnlyHolder":
      return "Only the current grant holder can perform this action.";
    case "OnlyIssuer":
      return "Only the grant issuer can perform this action.";
    case "GrantClosed":
      return "This grant is already closed.";
    case "GrantExpired":
      return "This grant is expired.";
    case "NotYetExpired":
      return "This grant has not expired yet.";
    case "NonTransferableGrant":
      return `Grant right ${argString(args[0])} is not transferable.`;
    case "GrantTransferLocked":
      return `Grant right ${argString(args[0])} is temporarily transfer locked.`;
    case "GrantTransferNotUnlocked":
      return `Grant right ${argString(args[0])} unlocks at ${argString(args[1])}.`;
    case "InsufficientVestedAmount":
      return `Insufficient vested amount: requested ${argString(args[0])}, available ${argString(args[1])}.`;
    case "AmountExceedsTotal":
      return `Amount exceeds grant total: requested ${argString(args[0])}, available ${argString(args[1])}.`;
    case "PolicyNotAllowed":
      return `Boardroom policy ${argString(args[0])} is not allowed.`;
    case "CallNotAllowed":
      return `Boardroom policy rejected call to ${argString(args[1])} with selector ${argString(args[2])}.`;
    case "CallFailed":
      return `Boardroom call to ${argString(args[0])} failed.`;
    case "EmptyBatch":
      return "Boardroom batch is empty.";
    case "TooManyCalls":
      return `Boardroom batch has ${argString(args[0])} calls; maximum is ${argString(args[1])}.`;
    case "InvalidAddress":
      return "One of the addresses is invalid.";
    case "InvalidAmount":
      return "Amount must be greater than zero.";
    case "InvalidPaymentToken":
      return "Payment token does not match the grant pricing mode.";
    case "InvalidVestingSchedule":
      return "Vesting cliff must be before or equal to vesting end.";
    case "InvalidExpiry":
      return "Expiry must be in the future and at or after vesting end.";
    default:
      return `${name}${args.length > 0 ? `(${args.map(argString).join(", ")})` : ""}`;
  }
}

function argString(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map(argString).join(", ")}]`;
  return String(value);
}
