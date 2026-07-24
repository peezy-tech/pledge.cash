import type { PaymentSaga } from "../api/server";
import type { MarketplaceQuote } from "../domain";
import {
  persistedX402QuoteFromMarketplaceQuote
} from "./payment-quote-builder";
import type { X402ServerLayer } from "./types";

/**
 * Narrow adapter for the Hono API. All trusted quote data still comes from the
 * repository-owned MarketplaceQuote; no execution field is read from the paid
 * request.
 */
export class X402MarketplacePaymentSaga implements PaymentSaga {
  constructor(private readonly layer: X402ServerLayer) {}

  get fundedSettlementEnabled(): boolean {
    return this.layer.releaseSafety.fundedSettlementEnabled;
  }

  get minimumSafeVersion(): string {
    return this.layer.releaseSafety.minimumSafeVersion;
  }

  get installedVersion(): string {
    return this.layer.releaseSafety.installedVersion;
  }

  paymentRequired(quote: MarketplaceQuote) {
    return this.layer.paymentRequired(
      persistedX402QuoteFromMarketplaceQuote(quote, domainFromQuote(quote))
    );
  }

  paymentAttempt(quoteId: string) {
    return this.layer.paymentAttempt({ quoteId });
  }

  async settleAndExecute(
    input: Parameters<PaymentSaga["settleAndExecute"]>[0]
  ): ReturnType<PaymentSaga["settleAndExecute"]> {
    const result = await this.layer.settleAndExecute({
      quote: persistedX402QuoteFromMarketplaceQuote(
        input.quote,
        domainFromQuote(input.quote)
      ),
      paymentPayload: input.paymentPayload
    });
    return {
      settlement: result.settlement,
      execution: result.execution
    };
  }
}

function domainFromQuote(quote: MarketplaceQuote) {
  return {
    application: quote.intentQuote.intent.application,
    gateway: quote.intentQuote.intent.gateway
  };
}
