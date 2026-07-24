import type { MarketplaceQuote } from "../domain";
import {
  SUPPORT_CHAIN_ID,
  SupportError,
  type SupportAuthorityReader,
  type SupportPlan,
  type SupportRepository,
} from "./domain";

export interface RecurringSupportExecutionValidator {
  assertPayable(quote: MarketplaceQuote): Promise<void>;
}

export class RecurringSupportExecutionGuard
  implements RecurringSupportExecutionValidator
{
  constructor(
    private readonly repository: SupportRepository,
    private readonly authority: SupportAuthorityReader,
  ) {}

  async assertPayable(quote: MarketplaceQuote): Promise<void> {
    if (
      quote.kind !== "recurring_support"
      || quote.supportInvoiceId === undefined
    ) {
      throw new SupportError(
        "The quote is not bound to a recurring-support invoice.",
        "support_quote_invalid",
        409,
      );
    }
    const invoice = await this.repository.getInvoice(quote.supportInvoiceId);
    if (!invoice) {
      throw new SupportError(
        "The support invoice was not found.",
        "support_invoice_not_found",
        404,
      );
    }
    const [subscription, plan, links, hasBlockingPayment] = await Promise.all([
      this.repository.getSubscription(invoice.subscriptionId),
      this.repository.getPlan(invoice.planId),
      this.repository.listInvoiceQuotes(invoice.id),
      this.repository.hasBlockingPayerBoardroomPayment(
        invoice.boardroom,
        invoice.payer,
        invoice.id,
      ),
    ]);
    if (
      !subscription
      || !plan
      || hasBlockingPayment
      || invoice.status !== "open"
      || subscription.status !== "active"
      || plan.status !== "active"
      || invoice.activeQuoteId !== quote.id
      || !links.some(link => link.quoteId === quote.id)
      || subscription.id !== invoice.subscriptionId
      || subscription.planId !== plan.id
      || invoice.planId !== plan.id
      || invoice.payer.toLowerCase() !== subscription.payer.toLowerCase()
      || invoice.boardroom.toLowerCase() !== plan.boardroom.toLowerCase()
      || invoice.asset.toLowerCase() !== plan.asset.toLowerCase()
      || invoice.amount !== plan.amount
      || quote.payer.toLowerCase() !== invoice.payer.toLowerCase()
      || quote.recipient.toLowerCase() !== invoice.payer.toLowerCase()
      || quote.refundAddress.toLowerCase() !== invoice.payer.toLowerCase()
      || quote.boardroom.toLowerCase() !== invoice.boardroom.toLowerCase()
      || quote.canonicalTarget.toLowerCase() !== invoice.boardroom.toLowerCase()
      || quote.execution.chainId !== SUPPORT_CHAIN_ID
      || quote.execution.target.toLowerCase() !== invoice.boardroom.toLowerCase()
      || quote.execution.recipient.toLowerCase() !== invoice.payer.toLowerCase()
      || quote.execution.inputToken.toLowerCase() !== invoice.asset.toLowerCase()
      || quote.execution.outputToken.toLowerCase() !== invoice.asset.toLowerCase()
      || quote.execution.inputAmount !== invoice.amount
      || quote.execution.expectedOutput !== invoice.amount
      || quote.execution.minimumOutput !== invoice.amount
      || quote.maxSlippageBps !== 0
    ) {
      throw new SupportError(
        "The support quote is no longer the exact payable attempt for this invoice.",
        "support_quote_not_payable",
        409,
      );
    }
    await this.authority.assertCurrent(authorityFromPlan(plan));
  }
}

function authorityFromPlan(plan: SupportPlan) {
  return {
    authority: plan.authority,
    blockHash: plan.verifiedBlockHash,
    blockNumber: plan.verifiedBlock,
    boardroom: plan.boardroom,
    chainId: SUPPORT_CHAIN_ID,
    configurationEpoch: plan.configurationEpoch,
    controllerGeneration: plan.controllerGeneration,
    mode: plan.authorityMode,
  } as const;
}
