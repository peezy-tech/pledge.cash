import type { Address, Hex } from "viem";
import type { JsonRecord } from "../db/schema";

export const SUPPORT_CHAIN_ID = 998 as const;
export const SUPPORT_CADENCE = "monthly" as const;

export type SupportAuthorityMode =
  | "prelaunch_owner"
  | "launched_controller";

export type SupportAuthorityIdentity = {
  authority: Address;
  blockHash: Hex;
  blockNumber: bigint;
  boardroom: Address;
  chainId: typeof SUPPORT_CHAIN_ID;
  configurationEpoch: bigint;
  controllerGeneration: bigint;
  facetSetHash: Hex;
  mode: SupportAuthorityMode;
  signer?: Address;
};

export type SupportChallengeAction =
  | "plan_create"
  | "plan_retire"
  | "subscription_create"
  | "subscription_cancel";

export type SupportChallenge = {
  id: string;
  action: SupportChallengeAction;
  actor: Address;
  authority?: Address;
  authorityMode?: SupportAuthorityMode;
  boardroom: Address;
  chainId: typeof SUPPORT_CHAIN_ID;
  configurationEpoch: bigint;
  controllerGeneration: bigint;
  facetSetHash: Hex;
  planId: string;
  payload: JsonRecord;
  payloadHash: Hex;
  message: string;
  issuedBlock: bigint;
  issuedBlockHash: Hex;
  expiresAt: Date;
  consumedAt?: Date;
  createdAt: Date;
};

export type SupportPlan = {
  id: string;
  chainId: typeof SUPPORT_CHAIN_ID;
  boardroom: Address;
  asset: Address;
  amount: string;
  cadence: typeof SUPPORT_CADENCE;
  title: string;
  description: string;
  termsHash: Hex;
  status: "active" | "retired";
  authority: Address;
  authorityMode: SupportAuthorityMode;
  controllerGeneration: bigint;
  configurationEpoch: bigint;
  facetSetHash: Hex;
  verifiedBlock: bigint;
  verifiedBlockHash: Hex;
  createdAt: Date;
  retiredAt?: Date;
};

export type SupportSubscription = {
  id: string;
  planId: string;
  payer: Address;
  status: "active" | "cancelled";
  startedAt: Date;
  createdAt: Date;
  cancelledAt?: Date;
};

export type SupportInvoice = {
  id: string;
  subscriptionId: string;
  planId: string;
  activeQuoteId?: string;
  periodIndex: number;
  periodStart: Date;
  periodEnd: Date;
  dueAt: Date;
  payer: Address;
  boardroom: Address;
  asset: Address;
  amount: string;
  status: "open" | "cancelled";
  createdAt: Date;
  cancelledAt?: Date;
};

export type SupportInvoiceQuote = {
  invoiceId: string;
  quoteId: string;
  createdAt: Date;
};

export type SupportInvoicePublicStatus =
  | "open"
  | "payment_pending"
  | "paid"
  | "cancelled"
  | "manual_intervention";

export type SupportInvoiceView = SupportInvoice & {
  publicStatus: SupportInvoicePublicStatus;
  latestQuoteId?: string;
  lastAttemptStatus?: "refunded" | "payment_failed";
};

export type SupportSubscriptionView = {
  plan: SupportPlan;
  subscription: SupportSubscription;
  invoice?: SupportInvoiceView;
};

export interface SupportAuthorityReader {
  resolve(boardroom: Address): Promise<SupportAuthorityIdentity>;
  assertCurrent(expected: SupportAuthorityIdentity): Promise<void>;
  verifyAuthoritySignature(input: {
    expected: SupportAuthorityIdentity;
    message: string;
    signature: Hex;
  }): Promise<SupportAuthorityIdentity>;
  verifyAddressSignature(input: {
    address: Address;
    message: string;
    signature: Hex;
  }): Promise<{ blockHash: Hex; blockNumber: bigint }>;
}

export interface SupportRepository {
  createChallenge(challenge: SupportChallenge): Promise<void>;
  getChallenge(id: string): Promise<SupportChallenge | undefined>;
  createPlanFromChallenge(input: {
    challenge: SupportChallenge;
    plan: SupportPlan;
    signatureHash: Hex;
  }): Promise<SupportPlan>;
  retirePlanFromChallenge(input: {
    challenge: SupportChallenge;
    retiredAt: Date;
    signatureHash: Hex;
    verified: SupportAuthorityIdentity;
  }): Promise<SupportPlan>;
  createSubscriptionFromChallenge(input: {
    challenge: SupportChallenge;
    invoice: SupportInvoice;
    signatureHash: Hex;
    subscription: SupportSubscription;
    verifiedBlock: bigint;
    verifiedBlockHash: Hex;
  }): Promise<SupportSubscription>;
  cancelSubscriptionFromChallenge(input: {
    cancelledAt: Date;
    challenge: SupportChallenge;
    signatureHash: Hex;
    verifiedBlock: bigint;
    verifiedBlockHash: Hex;
  }): Promise<SupportSubscription>;
  listPlans(
    boardroom: Address,
    limit: number,
    payer?: Address,
  ): Promise<readonly SupportPlan[]>;
  getPlan(id: string): Promise<SupportPlan | undefined>;
  getSubscription(id: string): Promise<SupportSubscription | undefined>;
  getInvoice(id: string): Promise<SupportInvoice | undefined>;
  getLatestInvoice(
    subscriptionId: string,
  ): Promise<SupportInvoice | undefined>;
  getBlockingSubscriptionInvoice(
    subscriptionId: string,
  ): Promise<SupportInvoice | undefined>;
  getOrCreateInvoice(invoice: SupportInvoice): Promise<SupportInvoice>;
  listInvoiceQuotes(
    invoiceId: string,
  ): Promise<readonly SupportInvoiceQuote[]>;
  linkInvoiceQuote(link: SupportInvoiceQuote): Promise<void>;
  hasBlockingPayerBoardroomPayment(
    boardroom: Address,
    payer: Address,
    exceptInvoiceId: string,
  ): Promise<boolean>;
  withInvoiceLock<T>(invoiceId: string, action: () => Promise<T>): Promise<T>;
}

export class SupportError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 422,
  ) {
    super(message);
    this.name = "SupportError";
  }
}
