import type { Address, Hex, PublicClient } from "viem";

export type PledgeCashReadClient = Pick<PublicClient, "readContract">;

export type PledgeCashLogClient = Pick<PublicClient, "getLogs">
  & Partial<Pick<PublicClient, "getBlockNumber" | "getCode">>;

export type PledgeCashBlockReadClient = Pick<PublicClient, "getBlockNumber" | "readContract">;

export type PledgeCashGovernanceClient = Pick<PublicClient, "getLogs" | "getTransaction" | "readContract">
  & Partial<Pick<PublicClient, "getBlockNumber" | "getCode" | "getTransactionReceipt">>;

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

export type MerkleAirdropTerms = {
  shareToken: Address;
  shareAmount: bigint;
  merkleRoot: Hex;
  startTime: bigint;
  endTime: bigint;
  maxGrantClaims: number;
  salt: Hex;
};

export type BoardroomMerkleAirdropTerms = Omit<MerkleAirdropTerms, "shareToken">;

export type BondMarketTerms = {
  quoteToken: Address;
  kind: 0 | 1;
  capacity: bigint;
  initialPrice: bigint;
  minimumPrice: bigint;
  debtBuffer: number;
  vesting: number;
  start: number;
  duration: number;
  depositInterval: number;
  salt: Hex;
};

export type BondPositionState = {
  market: Address;
  positionId: bigint;
  owner: Address;
  payout: bigint;
  maturity: number;
  redeemed: boolean;
};

export type BondMarketState = {
  address: Address;
  factory: Address;
  boardroom: Address;
  shareToken: Address;
  quoteToken: Address;
  kind: number;
  status: number;
  initialCapacity: bigint;
  capacity: bigint;
  minimumPrice: bigint;
  currentPrice: bigint;
  maximumPayout: bigint;
  purchased: bigint;
  sold: bigint;
  outstandingPayout: bigint;
  returnedPayout: bigint;
  startTime: number;
  conclusion: number;
  vestingTerm: number;
  nextPositionId: bigint;
  live: boolean;
  closed: boolean;
};

export type BondPurchaseQuote = {
  state: BondMarketState;
  buyer: Address;
  quoteAmount: bigint;
  payout: bigint;
  quoteBalance: bigint;
  quoteAllowance: bigint;
};

export type MerkleAirdropGrantClaimTerms = {
  paymentToken: Address;
  price: bigint;
  expiry: bigint;
  vestingCliff: bigint;
  vestingEnd: bigint;
  transferable: boolean;
  transferUnlockTime: bigint;
  salt: Hex;
};

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

export type FixedPriceSaleParticipationQuote = {
  state: FixedPriceSaleState;
  buyer: Address;
  shareAmount: bigint;
  paymentAmount: bigint;
  purchasedBy: bigint;
  remainingBuyerCapacity: bigint;
  paymentBalance: bigint;
  paymentAllowance: bigint;
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
  graduationLatched: boolean;
  canMigrate: boolean;
  closed: boolean;
};

export type MigratingBondingCurveBuyQuote = {
  state: MigratingBondingCurveState;
  buyer: Address;
  shareAmount: bigint;
  quoteIn: bigint;
  quoteBalance: bigint;
  quoteAllowance: bigint;
};

export type MigratingBondingCurveSellQuote = {
  state: MigratingBondingCurveState;
  seller: Address;
  shareAmount: bigint;
  quoteOut: bigint;
  sellableShares: bigint;
  shareBalance: bigint;
  shareAllowance: bigint;
};

export type MerkleAirdropState = {
  address: Address;
  factory: Address;
  boardroom: Address;
  shareToken: Address;
  tokenGrantFactory: Address;
  airdropSupply: bigint;
  claimedShares: bigint;
  remainingShares: bigint;
  merkleRoot: Hex;
  startTime: bigint;
  endTime: bigint;
  maxGrantClaims: number;
  claimedGrantCount: number;
  airdropStatus: number;
  closed: boolean;
};

export type MerkleAirdropClaimState = {
  airdrop: Address;
  index: bigint;
  claimed: boolean;
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
  factory: Address;
  issuer: Address;
  holder: Address;
  token: Address;
  paymentToken: Address;
  tokenId: bigint;
  tokenDecimals: number;
  paymentTokenDecimals: number;
  grantSize: bigint;
  claimable: bigint;
  price: bigint;
  vestingCliff: bigint;
  vestingEnd: bigint;
  expiry: bigint;
  settledAmount: bigint;
  settleable: bigint;
  settlementCost: bigint;
  unsettledAmount: bigint;
  transferable: boolean;
  transferUnlockTime: bigint;
  transferLocked: boolean;
  expired: boolean;
  halted: boolean;
  quarantined: boolean;
  quarantinedAmount: bigint;
  closed: boolean;
};

export type GrantSettlementQuote = {
  state: GrantState;
  holder: Address;
  amount: bigint;
  settlementCost: bigint;
  paymentBalance?: bigint;
  paymentAllowance?: bigint;
};

export type BoardroomGovernanceConfig = {
  minimumDelay: bigint;
  actionGracePeriod: bigint;
  vetoBps: bigint;
  windDownBps: bigint;
};

export type BoardroomState = {
  address: Address;
  owner: Address;
  policyRegistry: Address;
  wrappedNative: Address;
  shareToken: Address;
  status: number;
  launched: boolean;
  executor: Address;
  governanceDelay: bigint;
  governanceEpoch: bigint;
  governanceEligibleSupply: bigint;
  governanceConfig: BoardroomGovernanceConfig;
  redeemableAssets: Address[];
  issuedGrants: Address[];
  issuedDistributions: Address[];
  lockedLiquidityPositions: Address[];
};

export type BoardroomHolderPower = {
  boardroom: Address;
  shareToken: Address;
  account: Address;
  blockNumber: bigint;
  snapshotBlock: bigint;
  encumbered: boolean;
  currentBalance: bigint;
  pastBalance: bigint;
  currentEligibleSupply: bigint;
  pastEligibleSupply: bigint;
  vetoRequired: bigint;
  windDownRequired: bigint;
  canVeto: boolean;
  canStartWindDown: boolean;
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
  kind: "fixed-price-sale" | "migrating-bonding-curve" | "merkle-airdrop" | "unknown";
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
