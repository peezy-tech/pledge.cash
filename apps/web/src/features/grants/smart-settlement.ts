import { isZeroAddress, type GrantSettlementQuote } from "@pledge.cash/sdk";

export type SmartGrantSettlementPlan =
  | { kind: "approve"; amount: bigint; settlementAmount: bigint; settlementCost: bigint }
  | { kind: "settle"; amount: bigint; settlementCost: bigint };

export function smartGrantSettlementPlan(quote: GrantSettlementQuote): SmartGrantSettlementPlan {
  if (quote.amount <= 0n) throw new Error("No vested grant tokens are available to settle.");
  if (quote.amount > quote.state.settleable) throw new Error("The requested amount is no longer fully settleable.");
  if (!isZeroAddress(quote.state.paymentToken)) {
    if (quote.paymentBalance === undefined || quote.paymentBalance < quote.settlementCost) {
      throw new Error("The holder wallet does not have enough payment tokens for the available settlement.");
    }
    if (quote.paymentAllowance === undefined || quote.paymentAllowance < quote.settlementCost) {
      return {
        kind: "approve",
        amount: quote.settlementCost,
        settlementAmount: quote.amount,
        settlementCost: quote.settlementCost,
      };
    }
  }
  return { kind: "settle", amount: quote.amount, settlementCost: quote.settlementCost };
}
