import type {
  Address,
  BoardroomState,
  DiscoveredGrant,
  FixedPriceSaleState,
  GrantState,
  LockedLiquidityState,
  MigratingBondingCurveState,
} from "@pledge.cash/sdk";
import type { Hex } from "viem";

export type Tab = "direct" | "grant" | "boardroom" | "my-grants";

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
  expiry: bigint;
  settledAmount: bigint;
  settleable: bigint;
  halted: boolean;
  closed: boolean;
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
};

export type BoardroomDistributionSnapshot = {
  address: Address;
  kind: "fixed-price-sale" | "migrating-bonding-curve" | "unknown";
  state?: FixedPriceSaleState | MigratingBondingCurveState;
  error?: string;
};

export type BoardroomLockedLiquiditySnapshot = {
  address: Address;
  state?: LockedLiquidityState;
  error?: string;
};

export type BoardroomSnapshot = BoardroomState & {
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
};

export type MyGrantsSnapshot = {
  held: DiscoveredGrant[];
  issued: DiscoveredGrant[];
  loadedFor?: Address;
  fromBlock?: bigint;
  includeClosed: boolean;
};
