import { describe, expect, test } from "bun:test";
import type { GrantSettlementQuote, GrantState } from "@pledge.cash/sdk";
import {
  prepareSmartGrantSettlement,
  smartGrantSettlementPlan,
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

  test("prepares against fresh state and quotes the full currently settleable amount", async () => {
    let quotedAmount = 0n;
    const prepared = await prepareSmartGrantSettlement({
      grant: grantState.address,
      holder: grantState.holder,
      readCurrentState: async () => grantState,
      readQuote: async (amount) => {
        quotedAmount = amount;
        return quote({ amount, paymentAllowance: 5n });
      },
    });

    expect(quotedAmount).toBe(25n);
    expect(prepared.plan).toEqual({ kind: "settle", amount: 25n, settlementCost: 5n });
    expect(prepared.quote.amount).toBe(25n);
  });

  test("rejects stale grant and holder state before planning a transaction", async () => {
    await expect(prepareSmartGrantSettlement({
      grant: grantState.address,
      holder: grantState.holder,
      readCurrentState: async () => ({
        ...grantState,
        address: "0x0000000000000000000000000000000000000040",
      }),
      readQuote: async (amount) => quote({ amount }),
    })).rejects.toThrow("loaded grant changed");

    await expect(prepareSmartGrantSettlement({
      grant: grantState.address,
      holder: grantState.holder,
      readCurrentState: async () => grantState,
      readQuote: async (amount) => quote({
        amount,
        holder: "0x0000000000000000000000000000000000000040",
      }),
    })).rejects.toThrow("grant holder changed");
  });

  test("rejects an unavailable settlement before requesting a quote", async () => {
    let quoteRequested = false;
    await expect(prepareSmartGrantSettlement({
      grant: grantState.address,
      holder: grantState.holder,
      readCurrentState: async () => ({ ...grantState, settleable: 0n }),
      readQuote: async (amount) => {
        quoteRequested = true;
        return quote({ amount });
      },
    })).rejects.toThrow("No vested grant tokens");
    expect(quoteRequested).toBe(false);
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
