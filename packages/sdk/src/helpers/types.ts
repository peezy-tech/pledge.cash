import type { Address, Hex, PublicClient } from "viem";

export type PledgeCashReadClient = Pick<PublicClient, "readContract">;

export type PledgeCashLogClient = Pick<PublicClient, "getLogs"> & Partial<Pick<PublicClient, "getBlockNumber">>;

export type DiscoveryRange = {
  fromBlock?: bigint;
  toBlock?: bigint | "latest";
  chunkSize?: bigint;
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
  wrappedNative: Address;
  shareToken: Address;
  status: number;
  redeemableAssets: Address[];
  issuedGrants: Address[];
  issuedDistributions: Address[];
  lockedLiquidityPositions: Address[];
};

export type GrantDiscoveryRange = DiscoveryRange & {
  factory: Address;
  knownGrants?: readonly DiscoveredGrant[];
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

export type DiscoveredBoardroom = {
  boardroom: Address;
  owner: Address;
  policyRegistry: Address;
  wrappedNative: Address;
  shareToken: Address;
  name: string;
  symbol: string;
  salt: Hex;
  createdAtBlock: bigint;
  transactionHash: Hex;
};

export type DiscoveredDistribution = {
  distribution: Address;
  boardroom: Address;
  factory: Address;
  kind: "fixed-price-sale" | "migrating-bonding-curve" | "unknown";
  shareToken: Address;
  paymentToken: Address;
  shareAmount: bigint;
  salt: Hex;
  createdAtBlock: bigint;
  transactionHash: Hex;
};

export type DiscoveredLockedLiquidity = {
  locker: Address;
  boardroom: Address;
  factory: Address;
  pool: Address;
  tokenA: Address;
  tokenB: Address;
  amountA: bigint;
  amountB: bigint;
  liquidity: bigint;
  salt: Hex;
  createdAtBlock: bigint;
  transactionHash: Hex;
};

export type DiscoveredPool = {
  pool: Address;
  factory: Address;
  token0: Address;
  token1: Address;
  poolCount: bigint;
  createdAtBlock: bigint;
  transactionHash: Hex;
};

export type DiscoveryError = {
  fromBlock: bigint;
  toBlock: bigint | "latest" | undefined;
  message: string;
};

export type DiscoveryResult<T> = {
  items: T[];
  fromBlock: bigint;
  toBlock: bigint | "latest" | undefined;
  lastScannedBlock?: bigint;
  complete: boolean;
  errors: DiscoveryError[];
};

export type EnrichedDiscovery<T, State> = T & {
  state?: State;
  stale: boolean;
  error?: string;
};

export type DecodedPledgeCashError = {
  name: string;
  args: readonly unknown[];
  data: Hex;
  message: string;
};
