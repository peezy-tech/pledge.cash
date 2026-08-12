import { describe, expect, test } from "bun:test";
import { ZERO_ADDRESS } from "@pledge.cash/sdk";
import {
  defaultBoardroomForm,
  defaultBoardroomGrantForm,
  defaultGrantForm,
  defaultLiquidityExitForm,
  defaultLiquidityLockerForm,
  defaultLiquidityPositionForm,
  defaultWindDownForm,
  requireAddress,
  requireBytes32,
  uintInput,
} from "../src/lib/forms";

describe("lean protocol forms", () => {
  test("creates fresh Boardroom and direct-grant forms", () => {
    const boardroom = defaultBoardroomForm("0x1000000000000000000000000000000000000000");
    const direct = defaultGrantForm();
    const treasury = defaultBoardroomGrantForm();

    expect(boardroom.owner).toBe("0x1000000000000000000000000000000000000000");
    expect(boardroom.salt).toMatch(/^0x[0-9a-f]{64}$/);
    expect(direct.paymentToken).toBe(ZERO_ADDRESS);
    expect(treasury.token).toBe("");
    expect(BigInt(direct.vestingCliff)).toBeLessThan(BigInt(direct.vestingEnd));
    expect(BigInt(direct.vestingEnd)).toBeLessThan(BigInt(direct.expiry));
  });

  test("keeps liquidity and redemption defaults bounded", () => {
    expect(defaultLiquidityLockerForm()).toMatchObject({ poolFee: "3000", tickSpacing: "60" });
    expect(defaultLiquidityPositionForm()).toEqual({ tokenId: "" });
    expect(defaultLiquidityExitForm().deadline).toMatch(/^\d+$/);
    expect(defaultWindDownForm()).toEqual({ asset: "", shares: "0", recipient: "", minAmount: "0" });
  });

  test("validates addresses, bytes32 salts, and unsigned integers", () => {
    expect(requireAddress("0x1000000000000000000000000000000000000000", "Owner")).toBe("0x1000000000000000000000000000000000000000");
    expect(requireBytes32(`0x${"11".repeat(32)}`, "Salt")).toBe(`0x${"11".repeat(32)}`);
    expect(uintInput("42", "Amount")).toBe(42n);
    expect(() => uintInput("-1", "Amount")).toThrow("unsigned integer");
  });
});
