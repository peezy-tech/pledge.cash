import {
  isZeroAddress,
  type Address,
  type GrantSettlementQuote,
  type GrantState,
} from "@pledge.cash/sdk";

export type SmartGrantSettlementPlan =
  | { kind: "approve"; amount: bigint; settlementAmount: bigint; settlementCost: bigint }
  | { kind: "settle"; amount: bigint; settlementCost: bigint };

export type GrantSettlementTicket = Readonly<{
  amount: bigint;
  chainId: number;
  grant: Address;
  holder: Address;
  paymentToken: Address;
  settlementCost: bigint;
}>;

export type PreparedSmartGrantSettlement = Readonly<{
  plan: SmartGrantSettlementPlan;
  quote: GrantSettlementQuote;
  ticket: GrantSettlementTicket;
}>;

type PrepareSmartGrantSettlementOptions = {
  chainId: number;
  grant: Address;
  holder: Address;
  readCurrentState: () => Promise<GrantState>;
  readQuote: (amount: bigint) => Promise<GrantSettlementQuote>;
  ticket?: GrantSettlementTicket | undefined;
};

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
  options: PrepareSmartGrantSettlementOptions,
): Promise<PreparedSmartGrantSettlement> {
  const { chainId, grant, holder, readCurrentState, readQuote, ticket } = options;
  let quote: GrantSettlementQuote;

  if (ticket) {
    assertTicketScope(ticket, { chainId, grant, holder });
    quote = await readQuote(ticket.amount);
    assertTicketQuote(ticket, quote);
  } else {
    const current = await readCurrentState();
    if (!sameAddress(current.address, grant)) throw new Error("The loaded grant changed while settlement was being prepared.");
    if (!sameAddress(current.holder, holder)) throw new Error("Only the current grant holder can settle this grant.");
    if (current.settleable <= 0n) throw new Error("No vested grant tokens are available to settle.");
    quote = await readQuote(current.settleable);
    if (!sameAddress(quote.holder, holder)) throw new Error("The grant holder changed while settlement was being prepared.");
  }

  const plan = smartGrantSettlementPlan(quote);
  const nextTicket = ticket ?? ticketFromQuote(chainId, grant, quote);
  if (ticket && plan.kind !== "settle") {
    throw new Error("The exact settlement approval is no longer sufficient. Prepare a new settlement.");
  }
  return { plan, quote, ticket: nextTicket };
}

export async function submitPreparedGrantSettlement<Result>(
  prepared: PreparedSmartGrantSettlement,
  submit: (prepared: PreparedSmartGrantSettlement) => Promise<Result>,
  onConfirmed: (prepared: PreparedSmartGrantSettlement) => void,
): Promise<Result> {
  const result = await submit(prepared);
  onConfirmed(prepared);
  return result;
}

function ticketFromQuote(
  chainId: number,
  grant: Address,
  quote: GrantSettlementQuote,
): GrantSettlementTicket {
  return {
    amount: quote.amount,
    chainId,
    grant,
    holder: quote.holder,
    paymentToken: quote.state.paymentToken,
    settlementCost: quote.settlementCost,
  };
}

function assertTicketScope(
  ticket: GrantSettlementTicket,
  scope: { chainId: number; grant: Address; holder: Address },
): void {
  if (ticket.chainId !== scope.chainId
    || !sameAddress(ticket.grant, scope.grant)
    || !sameAddress(ticket.holder, scope.holder)) {
    throw new Error("The prepared settlement belongs to a different chain, grant, or holder. Prepare it again.");
  }
}

function assertTicketQuote(ticket: GrantSettlementTicket, quote: GrantSettlementQuote): void {
  if (!sameAddress(quote.state.address, ticket.grant)
    || !sameAddress(quote.holder, ticket.holder)
    || !sameAddress(quote.state.paymentToken, ticket.paymentToken)
    || quote.amount !== ticket.amount
    || quote.settlementCost !== ticket.settlementCost) {
    throw new Error("The prepared settlement terms changed. Prepare a new settlement.");
  }
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
