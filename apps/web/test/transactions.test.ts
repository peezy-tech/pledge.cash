import { describe, expect, test } from "bun:test";
import { buildBoardroomShareGrantIssuanceBatch, type Address, type Hex } from "@pledge.cash/sdk";
import { encodeFunctionData } from "viem";
import { transactionReviewCanContinue } from "../src/components/transaction-review";
import { recoverInterruptedTransactions, stageLabel, type TransactionRecord } from "../src/features/transactions/transaction-center";
import { contractCallPreview, contractCallReview, withTransactionReviewParameters } from "../src/lib/transaction-preview";
import { assertTransactionIdentity } from "../src/lib/transaction-identity";

const target = "0x1000000000000000000000000000000000000000" as const;
const holder = "0x2000000000000000000000000000000000000000" as Address;
const factory = "0x3000000000000000000000000000000000000000" as Address;
const shareToken = "0x4000000000000000000000000000000000000000" as Address;
const assetPolicy = "0x5000000000000000000000000000000000000000" as Address;
const salt = `0x${"1".repeat(64)}` as Hex;
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

  test("binds executor and a human review period into irreversible launch review", () => {
    const request = withTransactionReviewParameters({
      address: target,
      abi: [{ type: "function", name: "launch", stateMutability: "nonpayable", inputs: [{ name: "governanceDelay_", type: "uint256" }], outputs: [] }] as const,
      functionName: "launch",
      args: [259_200n] as const,
    }, [
      { name: "Governance executor", type: "address", value: holder },
      { name: "Holder review period", type: "duration", value: "3 days" },
    ]);

    const review = contractCallReview("Launch holder governance", request);
    expect(review.parameters).toEqual([
      { name: "Governance executor", type: "address", value: holder },
      { name: "Holder review period", type: "duration", value: "3 days" },
    ]);
    expect(review.parameters.some((parameter) => parameter.name.endsWith("_"))).toBe(false);
  });

  test("rejects account or chain changes made while transaction review is open", () => {
    const expected = { account: holder, chainId: 31337, deploymentIdentity: "factory-a", routeIdentity: "/projects/31337/project-a" };

    const current = { account: holder, chainId: 31337, deploymentIdentity: expected.deploymentIdentity, routeIdentity: expected.routeIdentity, walletChainId: 31337 };
    expect(() => assertTransactionIdentity(expected, current, "simulation")).not.toThrow();
    expect(() => assertTransactionIdentity(expected, { ...current, account: factory }, "simulation")).toThrow("account changed");
    expect(() => assertTransactionIdentity(expected, { ...current, walletChainId: 1 }, "submission")).toThrow("network changed");
    expect(() => assertTransactionIdentity(expected, { ...current, chainId: 1 }, "submission")).toThrow("network changed");
    expect(() => assertTransactionIdentity(expected, { ...current, routeIdentity: "/projects/31337/project-b" }, "submission")).toThrow("workspace changed");
    expect(() => assertTransactionIdentity(expected, { ...current, deploymentIdentity: "factory-b" }, "review")).toThrow("deployment changed");
  });

  test("marks hydrated pre-submission records as interrupted but resumes hashed submissions", () => {
    const base = {
      id: "tx-1",
      chainId: 31337,
      createdAt: "2026-07-10T00:00:00.000Z",
      functionName: "setValue",
      label: "Update value",
      target,
    } satisfies Omit<TransactionRecord, "stage">;
    const hash = `0x${"12".repeat(32)}` as const;
    const recovered = recoverInterruptedTransactions([
      { ...base, stage: "review" },
      { ...base, id: "tx-2", stage: "awaiting-signature" },
      { ...base, id: "tx-3", hash, stage: "submitted" },
    ]);

    expect(recovered[0]?.stage).toBe("failed");
    expect(recovered[0]?.error).toContain("interrupted");
    expect(recovered[1]?.stage).toBe("failed");
    expect(recovered[2]).toMatchObject({ hash, stage: "submitted" });
  });

  test("decodes every argument in a real Boardroom share-grant issuance batch", () => {
    const request = buildBoardroomShareGrantIssuanceBatch({
      boardroom: target,
      factory,
      shareToken,
      assetPolicy,
      terms: {
        holder,
        paymentToken: "0x0000000000000000000000000000000000000000",
        amount: 1_000_000_000_000_000_000_000n,
        price: 0n,
        expiry: 2_000_000_000n,
        vestingCliff: 1_900_000_000n,
        vestingEnd: 1_900_100_000n,
        transferable: false,
        transferUnlockTime: 0n,
        salt,
      },
    });
    const review = contractCallReview("Boardroom grant batch", request);

    expect(review.parameters[0]?.value).toBe("2 Boardroom calls — inspect every decoded argument below");
    expect(review.boardroomCalls).toHaveLength(2);
    expect(review.boardroomCalls?.[0]).toMatchObject({
      functionName: "approve",
      label: "Approve token spending",
      verification: "verified",
      parameters: [
        { name: "spender", type: "address", value: factory },
        { name: "amount", type: "uint256", value: "1000000000000000000000" },
      ],
    });
    expect(review.boardroomCalls?.[1]).toMatchObject({
      functionName: "createGrant",
      label: "Create a token grant",
      verification: "verified",
    });
    expect(review.boardroomCalls?.[1]?.parameters).toContainEqual({ name: "holder", type: "address", value: holder });
    expect(review.boardroomCalls?.[1]?.parameters).toContainEqual({ name: "amount", type: "uint256", value: "1000000000000000000000" });
    expect(review.boardroomCalls?.[1]?.parameters).toContainEqual({ name: "vestingEnd", type: "uint256", value: "1900100000" });
    expect(review.boardroomCalls?.[1]?.parameters).toContainEqual({ name: "salt", type: "bytes32", value: salt });
    expect(transactionReviewCanContinue(review, false)).toBe(true);
  });

  test("labels unknown inner calldata as unverified instead of guessing a function", () => {
    const review = contractCallReview("Unknown Boardroom action", {
      address: target,
      abi: [{
        type: "function",
        name: "execute",
        stateMutability: "payable",
        inputs: [{
          name: "call_",
          type: "tuple",
          components: [
            { name: "policy", type: "address" },
            { name: "target", type: "address" },
            { name: "value", type: "uint256" },
            { name: "data", type: "bytes" },
          ],
        }],
        outputs: [],
      }] as const,
      functionName: "execute",
      args: [{ policy: assetPolicy, target: shareToken, value: 0n, data: "0xdeadbeef" }],
    });

    expect(review.boardroomCalls?.[0]).toMatchObject({
      label: "Unverified call 0xdeadbeef",
      parameters: [],
      verification: "unverified",
    });
    expect(review.boardroomCalls?.[0]?.functionName).toBeUndefined();
    expect(review.boardroomCalls?.[0]?.verificationReason).toContain("does not match");
    expect(transactionReviewCanContinue(review, false)).toBe(false);
  });

  test("fails closed when the top-level destination or encoded call is unverifiable", () => {
    const invalidTarget = contractCallReview("Invalid destination", {
      address: "not-an-address",
      abi,
      functionName: "setValue",
      args: [42n],
    });
    const unavailableData = contractCallReview("Unknown function", {
      address: target,
      abi,
      functionName: "missingFunction",
      args: [],
    });

    expect(invalidTarget.target).toBe("unknown");
    expect(transactionReviewCanContinue(invalidTarget, false)).toBe(false);
    expect(unavailableData.data).toBe("unavailable");
    expect(transactionReviewCanContinue(unavailableData, false)).toBe(false);
  });
});
