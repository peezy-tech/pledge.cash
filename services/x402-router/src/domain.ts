import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import type { Address, Hex } from "viem";
import type { ResolvedIntentQuote } from "x402-hl/intents/server";

export const HYPERCORE_TESTNET = "hyperliquid:testnet" as const;
export const HYPEREVM_TESTNET_CHAIN_ID = 998 as const;
export const HYPERCORE_USDC_ASSET =
  "USDC:0xeb62eee3685fc4c43992febcd9e75443" as const;
export const HYPERCORE_USDC_DECIMALS = 8 as const;
export const HYPEREVM_USDC_DECIMALS = 6 as const;

export type MarketplaceActionKind = "amm_swap" | "fixed_price_sale";
export type QuoteLifecycle = "quoted" | "paid" | "executed" | "released";

export type DestinationExecution = {
  chainId: typeof HYPEREVM_TESTNET_CHAIN_ID;
  target: Address;
  callData: Hex;
  callDataHash: Hex;
  selector: Hex;
  value: "0";
  recipient: Address;
  inputToken: Address;
  inputAmount: string;
  outputToken: Address;
  expectedOutput: string;
  minimumOutput: string;
  deadline: number;
};

export type SourcePayment = {
  network: typeof HYPERCORE_TESTNET;
  asset: typeof HYPERCORE_USDC_ASSET;
  symbol: "USDC";
  decimals: typeof HYPERCORE_USDC_DECIMALS;
  amount: string;
  principal: string;
  serviceFee: string;
  payTo: Address;
};

export type MarketplaceQuote = {
  id: string;
  paymentId: string;
  kind: MarketplaceActionKind;
  lifecycle: QuoteLifecycle;
  payer: Address;
  recipient: Address;
  refundAddress: Address;
  boardroom: Address;
  canonicalTarget: Address;
  canonicalPool?: Address;
  sourcePayment: SourcePayment;
  execution: DestinationExecution;
  maxGasCost: string;
  maxSlippageBps: number;
  intentQuote: ResolvedIntentQuote;
  paymentRequirements: PaymentRequirements;
  paymentRequired: PaymentRequired;
  intentTemplateHash: Hex;
  inventoryReservations: readonly InventoryReservation[];
  expiresAt: Date;
  createdAt: Date;
};

export type InventoryReservation = {
  scope: "destination_execution" | "source_refund";
  network: string;
  asset: string;
  amount: string;
};

export type QuotePaymentBinding = {
  quoteId: string;
  attemptId: Hex;
  paymentPayloadHash: Hex;
  paymentRequirementsHash: Hex;
  boundAt: Date;
};

export type QuotePaymentBindingInput = Omit<QuotePaymentBinding, "boundAt">;

export type PublicOrderStatus =
  | "quoted"
  | "paid"
  | "recovery_pending"
  | "payment_failed"
  | "executing"
  | "executed"
  | "refund_pending"
  | "refunded"
  | "manual_intervention";

export type PublicOrder = {
  orderId: string;
  quoteId: string;
  kind: MarketplaceActionKind;
  status: PublicOrderStatus;
  payer: Address;
  recipient: Address;
  refundAddress: Address;
  sourcePayment: SourcePayment;
  execution: Omit<DestinationExecution, "callData">;
  expiresAt: string;
  paymentTransaction?: string;
  executionTransaction?: string;
  refundTransaction?: string;
  message?: string;
};

export interface QuoteRepository {
  createReserved(input: {
    quote: MarketplaceQuote;
    availability: readonly {
      reservation: InventoryReservation;
      maximumAvailableInventory: bigint;
    }[];
  }): Promise<MarketplaceQuote>;
  get(id: string): Promise<MarketplaceQuote | undefined>;
  bindPaymentPayload(
    input: QuotePaymentBindingInput
  ): Promise<QuotePaymentBinding>;
  getPaymentBinding(id: string): Promise<QuotePaymentBinding | undefined>;
  listPaymentBindingsWithoutOrder(input: {
    before: Date;
    limit: number;
  }): Promise<readonly QuotePaymentBinding[]>;
  releaseExpired(now: Date): Promise<number>;
  commitReservations(id: string): Promise<void>;
  finalizeExecution(id: string): Promise<void>;
  finalizeRefund(id: string): Promise<void>;
  finalizeSettlementFailure(id: string): Promise<void>;
  releaseQuotedReservations(id: string): Promise<void>;
  reservedInventory(input: {
    network: string;
    asset: string;
    now: Date;
  }): Promise<bigint>;
}
