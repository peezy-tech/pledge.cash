import { describe, expect, test } from "bun:test";
import type { GrantSettlementQuote, GrantState } from "@pledge.cash/sdk";
import { smartGrantSettlementPlan } from "../src/features/grants/smart-settlement";

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
