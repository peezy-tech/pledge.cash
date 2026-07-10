import { describe, expect, test } from "bun:test";
import { encodeFunctionData } from "viem";
import { stageLabel } from "../src/features/transactions/transaction-center";
import { contractCallPreview, contractCallReview } from "../src/lib/transaction-preview";

const target = "0x1000000000000000000000000000000000000000" as const;
const abi = [{
  type: "function",
  name: "setValue",
  stateMutability: "nonpayable",
  inputs: [{ name: "nextValue", type: "uint256" }],
  outputs: [],
}] as const;

describe("transaction review", () => {
  test("describes and encodes the exact call shown before submission", () => {
    const request = { address: target, abi, functionName: "setValue", args: [42n] as const };
    const review = contractCallReview("Update value", request);

    expect(review).toEqual({
      data: encodeFunctionData({ abi, functionName: "setValue", args: [42n] }),
      functionName: "setValue",
      label: "Update value",
      parameters: [{ name: "nextValue", type: "uint256", value: "42" }],
      risk: "routine",
      target,
      value: 0n,
    });
    expect(contractCallPreview("Update value", request)).toContain(`target=${target}`);
    expect(contractCallPreview("Update value", request)).toContain("function=setValue");
  });

  test("uses plain-language status labels for every stage", () => {
    expect(stageLabel("review")).toBe("Waiting for your review");
    expect(stageLabel("simulating")).toBe("Checking the transaction onchain");
    expect(stageLabel("awaiting-signature")).toBe("Waiting for wallet signature");
    expect(stageLabel("submitted")).toContain("waiting for confirmation");
    expect(stageLabel("confirmed")).toBe("Confirmed onchain");
    expect(stageLabel("failed")).toBe("Needs attention");
    expect(stageLabel("cancelled")).toBe("Cancelled");
  });

  test("marks one-way lifecycle calls as irreversible", () => {
    const review = contractCallReview("Launch project", {
      address: target,
      abi: [{ type: "function", name: "launch", stateMutability: "nonpayable", inputs: [{ name: "delay", type: "uint256" }], outputs: [] }] as const,
      functionName: "launch",
      args: [86_400n] as const,
    });

    expect(review.risk).toBe("irreversible");
    expect(review.parameters).toEqual([{ name: "delay", type: "uint256", value: "86400" }]);
  });
});
