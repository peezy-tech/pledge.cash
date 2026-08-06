import type { Address, DiscoveredBoardroom, DiscoveredGrant, DiscoveredLiquidityLocker } from "@pledge.cash/sdk";
import type { Hex } from "viem";
import type { TokenMetadata } from "./token-amounts";

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
  settlementCost: bigint;
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

export type BoardroomGrantForm = {
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

export type LiquidityLockerForm = {
  quoteAsset: string;
  poolFee: string;
  tickSpacing: string;
  salt: string;
};

export type LiquidityPositionForm = {
  tokenId: string;
};

export type LiquidityExitForm = {
  amount0Min: string;
  amount1Min: string;
  deadline: string;
};

export type WindDownForm = {
  asset: string;
  shares: string;
  recipient: string;
  minAmount: string;
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
  lockersByAddress: Record<string, DiscoveredLiquidityLocker>;
};
