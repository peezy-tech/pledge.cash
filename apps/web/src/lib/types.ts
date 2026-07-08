import type {
  Address,
  BoardroomState,
  DiscoveredBoardroom,
  DiscoveredDistribution,
  DiscoveredGrant,
  DiscoveredLockedLiquidity,
  DiscoveredPool,
  FixedPriceSaleState,
  GrantState,
  LockedLiquidityState,
  MerkleAirdropState,
  MigratingBondingCurveState,
} from "@pledge.cash/sdk";
import type { Hex } from "viem";
import type { TokenMetadata } from "./token-amounts";

export type Tab = "direct" | "grant" | "boardroom" | "discovery";

export type WalletState = {
  account?: Address;
  chainId?: number;
};

export type FactorySnapshot = {
  owner?: Address;
  tokenGrantLogic?: Address;
  creationFee?: bigint;
};

export type GrantForm = {
  holder: string;
  token: string;
  paymentToken: string;
  amount: string;
  price: string;
  vestingCliff: string;
  vestingEnd: string;
  expiry: string;
  transferable: boolean;
  transferUnlockTime: string;
  salt: string;
};

export type GrantSnapshot = {
  address: Address;
  issuer: Address;
  holder: Address;
  token: Address;
  paymentToken: Address;
  grantSize: bigint;
  claimable: bigint;
  price: bigint;
  vestingCliff: bigint;
  vestingEnd: bigint;
  expiry: bigint;
  settledAmount: bigint;
  settleable: bigint;
  halted: boolean;
  closed: boolean;
  tokenMetadata?: TokenMetadata | undefined;
  paymentTokenMetadata?: TokenMetadata | undefined;
};

export type BoardroomForm = {
  owner: string;
  name: string;
  symbol: string;
  salt: string;
};

export type BoardroomGrantSnapshot = {
  address: Address;
  state?: GrantState;
  error?: string;
  tokenMetadata?: TokenMetadata | undefined;
  paymentTokenMetadata?: TokenMetadata | undefined;
};

export type BoardroomDistributionSnapshot = {
  address: Address;
  kind: "fixed-price-sale" | "migrating-bonding-curve" | "merkle-airdrop" | "unknown";
  state?: FixedPriceSaleState | MigratingBondingCurveState | MerkleAirdropState;
  error?: string;
  shareTokenMetadata?: TokenMetadata | undefined;
  paymentTokenMetadata?: TokenMetadata | undefined;
  quoteTokenMetadata?: TokenMetadata | undefined;
};

export type BoardroomLockedLiquiditySnapshot = {
  address: Address;
  state?: LockedLiquidityState;
  error?: string;
  claimableA?: bigint | undefined;
  claimableB?: bigint | undefined;
  tokenAMetadata?: TokenMetadata | undefined;
  tokenBMetadata?: TokenMetadata | undefined;
  liquidityMetadata?: TokenMetadata | undefined;
};

export type BoardroomSnapshot = BoardroomState & {
  shareTokenMetadata?: TokenMetadata | undefined;
  grantSummaries: BoardroomGrantSnapshot[];
  distributionSummaries: BoardroomDistributionSnapshot[];
  lockedLiquiditySummaries: BoardroomLockedLiquiditySnapshot[];
};

export type BoardroomGrantForm = {
  holder: string;
  paymentToken: string;
  amount: string;
  price: string;
  vestingCliff: string;
  vestingEnd: string;
  expiry: string;
  transferable: boolean;
  transferUnlockTime: string;
  salt: string;
};

export type FixedPriceSaleForm = {
  paymentToken: string;
  shareAmount: string;
  price: string;
  maxPerBuyer: string;
  startTime: string;
  endTime: string;
  salt: string;
};

export type MerkleAirdropForm = {
  shareAmount: string;
  merkleRoot: string;
  startTime: string;
  endTime: string;
  maxGrantClaims: string;
  salt: string;
};

export type MigratingCurveForm = {
  quoteToken: string;
  saleSupply: string;
  migrationSupply: string;
  basePrice: string;
  slope: string;
  graduationQuoteTarget: string;
  quoteToLpBps: string;
  startTime: string;
  endTime: string;
  migrationSalt: string;
  salt: string;
};

export type LockedLiquidityForm = {
  quoteToken: string;
  shareAmountDesired: string;
  quoteAmountDesired: string;
  shareAmountMin: string;
  quoteAmountMin: string;
  deadline: string;
  salt: string;
  shareTokenSide: "tokenA" | "tokenB";
};

export type CurveMigrationForm = {
  minShareLiquidity: string;
  minQuoteLiquidity: string;
  deadline: string;
};

export type LockedLiquidityExitForm = {
  amountAMin: string;
  amountBMin: string;
  deadline: string;
};

export type WindDownForm = {
  redeemableAsset: string;
  redeemShares: string;
  redeemRecipient: string;
  minAmountsOut: string;
};

export type LogEntry = {
  id: string;
  level: "info" | "error" | "success";
  message: string;
  time: string;
  txHash?: Hex;
  txChainId?: number;
};

export type DiscoveryForm = {
  fromBlock: string;
  toBlock: string;
  chunkSize: string;
  includeClosedGrants: boolean;
};

export type DiscoverySnapshot = {
  chainId?: number;
  loadedFor?: Address;
  fromBlock?: bigint;
  toBlock?: bigint | "latest";
  chunkSize?: bigint;
  rangeMode?: "deployment" | "recent" | "manual";
  lastScannedBlock?: bigint;
  complete: boolean;
  errors: string[];
  boardroomsByAddress: Record<string, DiscoveredBoardroom>;
  grantsByAddress: Record<string, DiscoveredGrant>;
  distributionsByAddress: Record<string, DiscoveredDistribution>;
  lockersByAddress: Record<string, DiscoveredLockedLiquidity>;
  poolsByAddress: Record<string, DiscoveredPool>;
};
