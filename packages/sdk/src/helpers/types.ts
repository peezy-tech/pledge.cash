import type { Address, Hex, PublicClient } from "viem";

export type PledgeCashReadClient = Pick<PublicClient, "readContract">;

export type PledgeCashLogClient = Pick<PublicClient, "getLogs">
  & Partial<Pick<PublicClient, "getBlockNumber" | "getCode">>;

export type PledgeCashBlockReadClient = Pick<PublicClient, "getBlockNumber" | "readContract">;

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

export type LiquidityLockerCreationTerms = {
  quoteAsset: Address;
  poolFee: number;
  tickSpacing: number;
  salt: Hex;
};

export type UniswapV4PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type BoardroomCall = {
  target: Address;
  value: bigint;
  data: Hex;
};

export type TokenGrantFactoryState = {
  address: Address;
  owner: Address;
  boardroomFactory: Address;
  tokenGrantLogic: Address;
  feeRecipient: Address;
  creationFee: bigint;
};

export type BoardroomFactoryState = {
  address: Address;
  boardroomImplementation: Address;
  wrappedNative: Address;
  boardroomCount: bigint;
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

export type BoardroomStatus = 0 | 1 | 2 | 3;
export type BoardroomEscrowState = 0 | 1 | 2;
export type BoardroomSnapshotStatus = 0 | 1 | 2;

export type BoardroomState = {
  address: Address;
  blockNumber: bigint;
  factory: Address;
  owner: Address;
  wrappedNative: Address;
  shareToken: Address;
  redemptionExcessRecipient: Address;
  status: BoardroomStatus;
  launched: boolean;
  windDownDelay: bigint;
  windDownStartedAt: bigint;
  totalShareSupply: bigint;
  treasuryShareBalance: bigint;
  redeemableAssetCount: bigint;
  snapshotAssetCount: bigint;
  snapshotCursor: bigint;
  snapshotFrozen: boolean;
  redemptionSupply: bigint;
  redemptionSupplyFrozen: boolean;
  openEscrowCount: bigint;
  liquidityMutationAllowed: boolean;
  lockedLiquidityExitAllowed: boolean;
};

export type BoardroomEscrowRecord = {
  address: Address;
  state: BoardroomEscrowState;
};

export type BoardroomRedemptionAssetState = {
  asset: Address;
  registered: boolean;
  snapshotStatus: BoardroomSnapshotStatus;
  snapshotBalance: bigint;
  paid: bigint;
};

export type LiquidityLockerState = {
  address: Address;
  boardroom: Address;
  shareToken: Address;
  quoteAsset: Address;
  currency0: Address;
  currency1: Address;
  protocolFeeRouter: Address;
  positionManager: Address;
  poolFee: number;
  tickSpacing: number;
  tokenId: bigint;
  pendingTokenId: bigint;
  positionRegistered: boolean;
  transferPrepared: boolean;
  closed: boolean;
  positionLiquidity?: bigint;
  positionInfo?: bigint;
};

export type LiquidityLockerFactoryState = {
  address: Address;
  boardroomFactory: Address;
  positionManager: Address;
  protocolFeeRouter: Address;
  lockerCount: bigint;
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
  wrappedNative: Address;
  shareToken: Address;
  name: string;
  symbol: string;
  salt: Hex;
  createdAtBlock: bigint;
  transactionHash: Hex;
};

export type DiscoveredLiquidityLocker = {
  locker: Address;
  boardroom: Address;
  factory: Address;
  quoteAsset: Address;
  poolFee: number;
  tickSpacing: number;
  salt: Hex;
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
