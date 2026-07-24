import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import type { Address, Hex } from "viem";
import type { ResolvedIntentQuote } from "x402-hl/intents/server";
import {
  QuoteRequestError,
  requireSameParty,
  type CreateQuoteRequest,
} from "../api/dto";
import {
  HYPERCORE_TESTNET,
  HYPERCORE_USDC_ASSET,
  HYPERCORE_USDC_DECIMALS,
  HYPEREVM_USDC_DECIMALS,
  type MarketplaceQuote,
  type QuoteRepository,
} from "../domain";
import type { CanonicalMarketplaceReader } from "./canonical";
import { ceilBps, convertAtomicDecimals } from "./math";

export type MarketplaceQuotePolicy = {
  payTo: Address;
  serviceFeeBps: number;
  maxSourcePayment: bigint;
  maxSlippageBps: number;
  maxGasCost: bigint;
  quoteTtlSeconds: number;
};

export type PreparedPaymentQuote = {
  intentQuote: ResolvedIntentQuote;
  paymentRequirements: PaymentRequirements;
  paymentRequired: PaymentRequired;
  intentTemplateHash: Hex;
};

export interface PaymentQuoteBuilder {
  build(input: {
    quoteId: string;
    paymentId: string;
    payer: Address;
    recipient: Address;
    refundAddress: Address;
    sourceAmount: bigint;
    target: Address;
    callData: Hex;
    chainId: 998;
    maxGasCost: bigint;
    maxSlippageBps: number;
    deadline: number;
    kind: CreateQuoteRequest["kind"];
    metadata: Record<string, string | number | boolean>;
  }): Promise<PreparedPaymentQuote>;
}

export interface RefundInventoryReader {
  availableAtomicUsdc(): Promise<bigint>;
}

export class MarketplaceQuoteService {
  constructor(
    private readonly chain: CanonicalMarketplaceReader,
    private readonly repository: QuoteRepository,
    private readonly paymentQuotes: PaymentQuoteBuilder,
    private readonly refundInventory: RefundInventoryReader,
    private readonly policy: MarketplaceQuotePolicy,
    private readonly clock: () => number = () => Date.now(),
    private readonly id: () => string = () => crypto.randomUUID(),
  ) {}

  async create(request: CreateQuoteRequest): Promise<MarketplaceQuote> {
    requireSameParty(request);
    if (request.maxSlippageBps > this.policy.maxSlippageBps) {
      throw new QuoteRequestError(
        `Requested slippage exceeds the router maximum of ${this.policy.maxSlippageBps} bps.`,
        "slippage_above_router_limit",
      );
    }
    if (
      this.policy.quoteTtlSeconds < 30 ||
      this.policy.quoteTtlSeconds > 300
    ) {
      throw new QuoteRequestError(
        "Router quote TTL must be between 30 and 300 seconds.",
        "invalid_quote_ttl",
        503,
      );
    }

    const nowMs = this.clock();
    const nowSeconds = Math.floor(nowMs / 1_000);
    const deadline = nowSeconds + this.policy.quoteTtlSeconds;
    const canonical = await this.chain.quote(request, deadline);

    if (canonical.allowance < canonical.destinationPrincipal) {
      throw new QuoteRequestError(
        "Executor allowance is below the requested HyperEVM input.",
        "executor_allowance_low",
        503,
      );
    }
    if (canonical.availableInventory < canonical.destinationPrincipal) {
      throw new QuoteRequestError(
        "Executor inventory is below the requested HyperEVM input.",
        "executor_inventory_low",
        503,
      );
    }

    const sourcePrincipal = convertAtomicDecimals(
      canonical.destinationPrincipal,
      HYPEREVM_USDC_DECIMALS,
      HYPERCORE_USDC_DECIMALS,
    );
    const serviceFee = ceilBps(sourcePrincipal, this.policy.serviceFeeBps);
    const sourceAmount = sourcePrincipal + serviceFee;
    if (sourceAmount > this.policy.maxSourcePayment) {
      throw new QuoteRequestError(
        "The requested order exceeds the router's maximum payment.",
        "maximum_order_exceeded",
      );
    }
    const availableRefundInventory =
      await this.refundInventory.availableAtomicUsdc();
    if (availableRefundInventory < sourceAmount) {
      throw new QuoteRequestError(
        "HyperCore refund inventory is below the requested payment.",
        "refund_inventory_low",
        503,
      );
    }

    const quoteId = this.id();
    const paymentId = this.id();
    const prepared = await this.paymentQuotes.build({
      quoteId,
      paymentId,
      payer: request.payer,
      recipient: request.recipient,
      refundAddress: request.refundAddress,
      sourceAmount,
      target: canonical.execution.target,
      callData: canonical.execution.callData,
      chainId: canonical.execution.chainId,
      maxGasCost: this.policy.maxGasCost,
      maxSlippageBps: request.maxSlippageBps,
      deadline,
      kind: request.kind,
      metadata: {
        boardroom: canonical.boardroom,
        inputToken: canonical.execution.inputToken,
        inputAmount: canonical.execution.inputAmount,
        outputToken: canonical.execution.outputToken,
        minimumOutput: canonical.execution.minimumOutput,
      },
    });

    const createdAt = new Date(nowMs);
    const quote: MarketplaceQuote = {
      id: quoteId,
      paymentId,
      kind: request.kind,
      lifecycle: "quoted",
      payer: request.payer,
      recipient: request.recipient,
      refundAddress: request.refundAddress,
      boardroom: canonical.boardroom,
      canonicalTarget: canonical.canonicalTarget,
      ...(canonical.canonicalPool === undefined
        ? {}
        : { canonicalPool: canonical.canonicalPool }),
      sourcePayment: {
        network: HYPERCORE_TESTNET,
        asset: HYPERCORE_USDC_ASSET,
        symbol: "USDC",
        decimals: HYPERCORE_USDC_DECIMALS,
        amount: sourceAmount.toString(),
        principal: sourcePrincipal.toString(),
        serviceFee: serviceFee.toString(),
        payTo: this.policy.payTo,
      },
      execution: canonical.execution,
      maxGasCost: this.policy.maxGasCost.toString(),
      maxSlippageBps: request.maxSlippageBps,
      intentQuote: prepared.intentQuote,
      paymentRequirements: prepared.paymentRequirements,
      paymentRequired: prepared.paymentRequired,
      intentTemplateHash: prepared.intentTemplateHash,
      inventoryReservations: [
        {
          scope: "destination_execution",
          network: "eip155:998",
          asset: canonical.execution.inputToken.toLowerCase(),
          amount: canonical.destinationPrincipal.toString(),
        },
        {
          scope: "source_refund",
          network: HYPERCORE_TESTNET,
          asset: HYPERCORE_USDC_ASSET,
          amount: sourceAmount.toString(),
        },
      ],
      expiresAt: new Date(deadline * 1_000),
      createdAt,
    };

    return this.repository.createReserved({
      quote,
      availability: [
        {
          reservation: quote.inventoryReservations[0]!,
          maximumAvailableInventory:
            canonical.availableInventory < canonical.allowance
              ? canonical.availableInventory
              : canonical.allowance,
        },
        {
          reservation: quote.inventoryReservations[1]!,
          maximumAvailableInventory: availableRefundInventory,
        },
      ],
    });
  }
}
