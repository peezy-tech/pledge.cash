import { describe, expect, test } from "bun:test";
import type { Address, PledgeCashReadClient } from "@pledge.cash/sdk";
import { assertGovernanceLaunchPrecondition } from "../src/lib/governance-launch-integrity";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const executor = "0x2000000000000000000000000000000000000000" as Address;
const replacement = "0x3000000000000000000000000000000000000000" as Address;

describe("governance launch integrity", () => {
  test("accepts only an unlaunched Boardroom with the reviewed executor", async () => {
    await expect(assertGovernanceLaunchPrecondition(readClient(executor, false), boardroom, executor, "review"))
      .resolves.toBeUndefined();
    await expect(assertGovernanceLaunchPrecondition(readClient(replacement, false), boardroom, executor, "simulation"))
      .rejects.toThrow("executor changed before transaction simulation");
    await expect(assertGovernanceLaunchPrecondition(readClient(executor, true), boardroom, executor, "submission"))
      .rejects.toThrow("already launched before transaction submission");
  });
});

function readClient(currentExecutor: Address, launched: boolean): PledgeCashReadClient {
  return {
    readContract: async (request: { functionName?: string }) => (
      request.functionName === "executor" ? currentExecutor : launched
    ),
  } as unknown as PledgeCashReadClient;
}
