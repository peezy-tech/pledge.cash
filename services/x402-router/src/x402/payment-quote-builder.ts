import { getAddress } from "viem";
import type { Address } from "viem";
import {
  hashPaymentRequirements,
  type ExecutionIntentDomain
} from "x402-hl/intents";

import type { MarketplaceQuote } from "../domain";
import type {
  PaymentQuoteBuilder,
  PreparedPaymentQuote
} from "../quotes/service";
import { createPersistedX402Quote, X402QuoteInvariantError } from "./quote";
import type { PersistedX402Quote } from "./types";

export interface X402PaymentQuoteBuilderConfig {
  readonly domain: ExecutionIntentDomain;
  readonly paymentPayTo: Address | string;
  readonly executeResourceUrl: (quoteId: string) => string;
  readonly serviceName?: string;
  readonly now?: () => number;
}

/**
 * Adapter consumed by MarketplaceQuoteService. The marketplace service owns
 * economic quoting; this adapter owns the exact x402/intent commitment.
 */
export class X402PaymentQuoteBuilder implements PaymentQuoteBuilder {
  private readonly now: () => number;

  constructor(private readonly config: X402PaymentQuoteBuilderConfig) {
    this.now = config.now ?? (() => Math.floor(Date.now() / 1_000));
  }

  async build(
    input: Parameters<PaymentQuoteBuilder["build"]>[0]
  ): Promise<PreparedPaymentQuote> {
    const payer = getAddress(input.payer);
    if (
      getAddress(input.recipient) !== payer ||
      getAddress(input.refundAddress) !== payer
    ) {
      throw new X402QuoteInvariantError(
        "Quote payer, recipient, and refund address must be identical"
      );
    }
    if (input.chainId !== 998) {
      throw new X402QuoteInvariantError(
        "The v1 x402 rail only executes on HyperEVM testnet"
      );
    }

    const now = this.now();
    const timeout = input.deadline - now;
    if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 300) {
      throw new X402QuoteInvariantError(
        "Quote deadline must be from 1 to 300 seconds in the future"
      );
    }

    const persisted = createPersistedX402Quote(
      {
        domain: this.config.domain,
        paymentPayTo: this.config.paymentPayTo,
        now
      },
      {
        id: input.quoteId,
        paymentId: input.paymentId,
        payer,
        resourceUrl: this.config.executeResourceUrl(input.quoteId),
        target: input.target,
        callData: input.callData,
        paymentAmountAtomic: input.sourceAmount.toString(),
        maxGasCost: input.maxGasCost.toString(),
        maxSlippageBps: input.maxSlippageBps,
        deadline: input.deadline,
        nonce: `${input.quoteId}:intent`,
        maxTimeoutSeconds: timeout,
        description: `Pledge ${input.kind} marketplace execution`,
        ...(this.config.serviceName === undefined
          ? {}
          : { serviceName: this.config.serviceName }),
        metadata: {
          ...input.metadata,
          operation: input.kind
        }
      }
    );

    return {
      intentQuote: persisted.intentQuote,
      paymentRequirements: persisted.paymentRequirements,
      paymentRequired: persisted.paymentRequired,
      intentTemplateHash: persisted.intentTemplateHash
    };
  }
}

/**
 * MarketplaceQuote persists the original resolved intent and finalized x402
 * wire objects. This lossless view lets the settlement layer re-validate them
 * without asking the request to supply any trusted fields.
 */
export function persistedX402QuoteFromMarketplaceQuote(
  quote: MarketplaceQuote,
  domain: ExecutionIntentDomain
): PersistedX402Quote {
  return {
    schemaVersion: 1,
    id: quote.id,
    paymentId: quote.paymentId,
    domain,
    intentQuote: quote.intentQuote,
    intent: quote.intentQuote.intent,
    intentTemplateHash: quote.intentTemplateHash,
    paymentRequirements: quote.paymentRequirements,
    paymentRequirementsHash: hashPaymentRequirements(
      quote.paymentRequirements
    ),
    paymentRequired: quote.paymentRequired,
    createdAt: quote.createdAt.toISOString(),
    expiresAt: quote.expiresAt.toISOString()
  };
}
