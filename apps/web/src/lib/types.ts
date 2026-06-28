import type { Address } from "@pledge.cash/sdk";

export type Tab = "direct" | "grant" | "boardroom";

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

export type BoardroomSnapshot = {
  address: Address;
  owner: Address;
  policyRegistry: Address;
  shareToken: Address;
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

export type LogEntry = {
  id: string;
  level: "info" | "error" | "success";
  message: string;
  time: string;
};
