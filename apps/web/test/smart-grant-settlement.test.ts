import { describe, expect, test } from "bun:test";
import type { GrantSettlementQuote, GrantState } from "@pledge.cash/sdk";
import {
  prepareSmartGrantSettlement,
  smartGrantSettlementPlan,
  submitPreparedGrantSettlement,
} from "../src/features/grants/smart-settlement";

const grantState = {
  address: "0x0000000000000000000000000000000000000010",
  holder: "0x0000000000000000000000000000000000000020",
  paymentToken: "0x0000000000000000000000000000000000000030",
  settleable: 25n,
} as GrantState;

describe("smart grant settlement", () => {
  test("chooses an exact approval before settlement when allowance is short", () => {
    expect(smartGrantSettlementPlan(quote({ paymentAllowance: 2n }))).toEqual({
      kind: "approve",
      amount: 5n,
      settlementAmount: 25n,
      settlementCost: 5n,
    });
  });

  test("settles the full available amount when payment is ready", () => {
    expect(smartGrantSettlementPlan(quote({ paymentAllowance: 5n }))).toEqual({
      kind: "settle",
      amount: 25n,
      settlementCost: 5n,
    });
  });

  test("fails before transaction review when balance or live availability is insufficient", () => {
    expect(() => smartGrantSettlementPlan(quote({ paymentBalance: 4n }))).toThrow("does not have enough payment tokens");
    expect(() => smartGrantSettlementPlan(quote({ amount: 26n }))).toThrow("no longer fully settleable");
  });

  test("settles the approved amount when vesting advances between approval and settlement", async () => {
    const approval = await prepareSmartGrantSettlement({
      chainId: 31337,
      grant: grantState.address,
      holder: grantState.holder,
      readCurrentState: async () => grantState,
      readQuote: async (amount) => quote({ amount, paymentAllowance: 0n }),
    });

    expect(approval.plan).toMatchObject({
      kind: "approve",
      amount: 5n,
      settlementAmount: 25n,
    });
    expect(approval.ticket).toMatchObject({
      amount: 25n,
      chainId: 31337,
      grant: grantState.address,
      holder: grantState.holder,
      paymentToken: grantState.paymentToken,
      settlementCost: 5n,
    });

    const settlement = await prepareSmartGrantSettlement({
      chainId: 31337,
      grant: grantState.address,
      holder: grantState.holder,
      readCurrentState: async () => {
        throw new Error("must not reselect a newly vested amount");
      },
      readQuote: async (amount) => quote({
        amount,
        paymentAllowance: 5n,
        state: { ...grantState, settleable: 30n },
      }),
      ticket: approval.ticket,
    });

    expect(settlement.plan).toEqual({ kind: "settle", amount: 25n, settlementCost: 5n });
    expect(settlement.quote.state.settleable).toBe(30n);
  });

  test("binds an approved ticket to its exact grant, holder, amount, cost, and payment token", async () => {
    const approval = await prepareSmartGrantSettlement({
      chainId: 31337,
      grant: grantState.address,
      holder: grantState.holder,
      readCurrentState: async () => grantState,
      readQuote: async (amount) => quote({ amount }),
    });

    const changedQuotes: GrantSettlementQuote[] = [
      quote({ amount: 24n, paymentAllowance: 5n }),
      quote({ holder: "0x0000000000000000000000000000000000000040", paymentAllowance: 5n }),
      quote({ settlementCost: 6n, paymentAllowance: 6n }),
      quote({
        paymentAllowance: 5n,
        state: { ...grantState, address: "0x0000000000000000000000000000000000000040" },
      }),
      quote({
        paymentAllowance: 5n,
        state: { ...grantState, paymentToken: "0x0000000000000000000000000000000000000040" },
      }),
    ];
    for (const changedQuote of changedQuotes) {
      await expect(prepareSmartGrantSettlement({
        chainId: 31337,
        grant: grantState.address,
        holder: grantState.holder,
        readCurrentState: async () => grantState,
        readQuote: async () => changedQuote,
        ticket: approval.ticket,
      })).rejects.toThrow("settlement terms changed");
    }
  });

  test("updates displayed amounts only after the prepared transaction resolves", async () => {
    const prepared = await prepareSmartGrantSettlement({
      chainId: 31337,
      grant: grantState.address,
      holder: grantState.holder,
      readCurrentState: async () => grantState,
      readQuote: async (amount) => quote({ amount }),
    });
    const submission = deferred<string>();
    let displayedAmount = "unchanged";
    let displayedCost = "unchanged";

    const pending = submitPreparedGrantSettlement(
      prepared,
      async () => submission.promise,
      ({ ticket }) => {
        displayedAmount = ticket.amount.toString();
        displayedCost = ticket.settlementCost.toString();
      },
    );
    await Promise.resolve();

    expect(displayedAmount).toBe("unchanged");
    expect(displayedCost).toBe("unchanged");

    submission.resolve("0xconfirmed");
    await expect(pending).resolves.toBe("0xconfirmed");
    expect(displayedAmount).toBe("25");
    expect(displayedCost).toBe("5");
  });

  test("does not commit displayed amounts when submission fails", async () => {
    const prepared = await prepareSmartGrantSettlement({
      chainId: 31337,
      grant: grantState.address,
      holder: grantState.holder,
      readCurrentState: async () => grantState,
      readQuote: async (amount) => quote({ amount }),
    });
    let committed = false;

    await expect(submitPreparedGrantSettlement(
      prepared,
      async () => { throw new Error("wallet rejected"); },
      () => { committed = true; },
    )).rejects.toThrow("wallet rejected");
    expect(committed).toBe(false);
  });
});

function quote(overrides: Partial<GrantSettlementQuote> = {}): GrantSettlementQuote {
  return {
    state: grantState,
    holder: grantState.holder,
    amount: 25n,
    settlementCost: 5n,
    paymentBalance: 10n,
    paymentAllowance: 0n,
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
