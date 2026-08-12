import {
  isZeroAddress,
  type Address,
  type GrantSettlementQuote,
  type GrantState,
} from "@pledge.cash/sdk";

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

export async function prepareSmartGrantSettlement(
  options: {
    grant: Address;
    holder: Address;
    readCurrentState: () => Promise<GrantState>;
    readQuote: (amount: bigint) => Promise<GrantSettlementQuote>;
  },
) {
  const { grant, holder, readCurrentState, readQuote } = options;
  const current = await readCurrentState();
  if (!sameAddress(current.address, grant)) throw new Error("The loaded grant changed while settlement was being prepared.");
  if (!sameAddress(current.holder, holder)) throw new Error("Only the current grant holder can settle this grant.");
  if (current.settleable <= 0n) throw new Error("No vested grant tokens are available to settle.");

  const quote = await readQuote(current.settleable);
  if (!sameAddress(quote.holder, holder)) throw new Error("The grant holder changed while settlement was being prepared.");

  const plan = smartGrantSettlementPlan(quote);
  return { plan, quote };
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
