import { describe, expect, test } from "bun:test";
import {
  dateString,
  defaultBondMarketForm,
  defaultCurveMigrationForm,
  defaultGrantForm,
  defaultLockedLiquidityForm,
  defaultWindDownForm,
} from "../src/lib/forms";

describe("form presentation helpers", () => {
  test("shows contract timestamps with relative timing and exact values", () => {
    const now = 1_700_000_000_000;

    expect(dateString(1_700_007_200n, now)).toContain("in 2 hours (1700007200,");
    expect(dateString(1_699_913_600n, now)).toContain("yesterday (1699913600,");
  });

  test("does not default locked or migrated liquidity to unbounded slippage", () => {
    expect(defaultLockedLiquidityForm()).toMatchObject({
      shareAmountDesired: "1",
      quoteAmountDesired: "1",
      shareAmountMin: "0.95",
      quoteAmountMin: "0.95",
    });
    expect(defaultCurveMigrationForm()).toMatchObject({ minShareLiquidity: "", minQuoteLiquidity: "" });
  });

  test("uses the contract's immediate-start sentinel for new bond markets", () => {
    expect(defaultBondMarketForm().start).toBe("0");
  });

  test("defaults grants to at least one day of post-vesting settlement time", () => {
    const grant = defaultGrantForm();
    expect(BigInt(grant.expiry) - BigInt(grant.vestingEnd)).toBeGreaterThanOrEqual(86_400n);
  });

  test("defaults retryable redemption claims to a zero minimum", () => {
    expect(defaultWindDownForm()).toMatchObject({ claimAsset: "", claimRecipient: "", claimMinAmount: "0" });
  });
});
