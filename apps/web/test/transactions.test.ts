import { describe, expect, test } from "bun:test";
import {
  boardroomAbi,
  buildBoardroomRewardFundingCalls,
  buildBoardroomExecuteTransaction,
  buildBoardroomRewardsCreationCall,
  buildBoardroomQueueActionTransaction,
  buildBoardroomSelfCall,
  buildBoardroomShareGrantIssuanceBatch,
  buildBoardroomCall,
  tokenGrantAbi,
  type Address,
  type Hex,
} from "@pledge.cash/sdk";
import { encodeFunctionData } from "viem";
import { transactionReviewCanContinue } from "../src/components/transaction-review";
import {
  clearSettledTransactions,
  recoverInterruptedTransactions,
  stageLabel,
  transactionIdentity,
  transactionStatusLabel,
  updateStoredTransactionsForIdentity,
  type TransactionRecord,
} from "../src/features/transactions/transaction-center";
import { actionErrorWasAlreadyHandled } from "../src/hooks/use-action-runner";
import { contractCallPreview, contractCallReview } from "../src/lib/transaction-preview";
import {
  confirmedRefreshIsBlocked,
  confirmedReceiptInvalidationPlan,
  confirmedScopedRefreshNeedsRetry,
  monitorTransactionReceipt,
  receiptBackgroundRetryDelay,
  transactionReceiptMonitorKey,
  TransactionReceiptCoordinator,
  TransactionReceiptFinalizedError,
  TransactionReceiptMonitoringCancelledError,
  TransactionReceiptMonitoringDeferredError,
  type ReceiptReplacementLike,
  type ReceiptWait,
} from "../src/lib/transaction-receipts";
import {
  assertTransactionActionCurrent,
  assertTransactionIdentity,
  transactionContextIdentity,
  TransactionContextGuard,
} from "../src/lib/transaction-identity";

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
    expect(stageLabel("replaced")).toBe("Replaced in wallet");
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

  test("requires irreversible acknowledgement when queued Boardroom calldata opens redemptions", () => {
    const request = buildBoardroomQueueActionTransaction({
      boardroom: target,
      call: buildBoardroomSelfCall({
        boardroom: target,
        data: encodeFunctionData({ abi: boardroomAbi, functionName: "openRedemptions" }),
      }),
      salt,
    });
    const review = contractCallReview("Queue redemption opening", request);

    expect(review.boardroomCalls?.[0]).toMatchObject({
      functionName: "openRedemptions",
      verification: "verified",
    });
    expect(review.risk).toBe("irreversible");
    expect(transactionReviewCanContinue(review, false)).toBe(false);
    expect(transactionReviewCanContinue(review, true)).toBe(true);
  });

  test("takes the maximum risk of immediate verified Boardroom inner calls", () => {
    const grant = "0x6000000000000000000000000000000000000000" as Address;
    const request = buildBoardroomExecuteTransaction({
      boardroom: target,
      call: buildBoardroomCall({
        policy: assetPolicy,
        target: grant,
        data: encodeFunctionData({ abi: tokenGrantAbi, functionName: "stopVestingAndWithdrawUnvested" }),
      }),
    });
    const review = contractCallReview("Stop grant vesting", request);

    expect(review.boardroomCalls?.[0]).toMatchObject({
      functionName: "stopVestingAndWithdrawUnvested",
      verification: "verified",
    });
    expect(review.risk).toBe("irreversible");
    expect(transactionReviewCanContinue(review, false)).toBe(false);
  });

  test("verifies nested reward-pool creation and funding calls", () => {
    const rewardPool = "0x7000000000000000000000000000000000000000" as Address;
    const rewardAsset = "0x8000000000000000000000000000000000000000" as Address;
    const calls = [
      buildBoardroomRewardsCreationCall({ factory, cooldown: 604_800n, salt }),
      ...buildBoardroomRewardFundingCalls({
        factory,
        assetPolicy,
        rewards: rewardPool,
        asset: rewardAsset,
        amount: 1_000n,
        duration: 2_592_000n,
      }),
    ];

    const reviews = calls.map((call) => contractCallReview(
      "Review reward call",
      buildBoardroomExecuteTransaction({ boardroom: target, call }),
    ).boardroomCalls?.[0]);

    expect(reviews.map((review) => review?.functionName)).toEqual(["createRewards", "approve", "fundReward"]);
    expect(reviews.every((review) => review?.verification === "verified")).toBe(true);
  });

  test.each([
    "cancel",
    "close",
    "migrate",
    "exit",
    "quarantineAndClose",
    "withdrawExpiredTokens",
  ])("marks direct %s lifecycle calls as irreversible", (functionName) => {
    const directAbi = [{
      type: "function",
      name: functionName,
      stateMutability: "nonpayable",
      inputs: [],
      outputs: [],
    }] as const;
    const review = contractCallReview(`Direct ${functionName}`, {
      address: target,
      abi: directAbi,
      functionName,
    });

    expect(review.risk).toBe("irreversible");
    expect(transactionReviewCanContinue(review, false)).toBe(false);
  });

  test.each([
    "mint",
    "setRedemptionExcessRecipient",
    "registerRedeemableAsset",
    "cancelAction",
    "claimFees",
    "executeWindDownCall",
    "buy",
    "sell",
    "addLiquidity",
    "removeLiquidity",
    "swapExactTokensForTokens",
    "settle",
    "transfer",
  ])("marks non-irreversible asset or authority call %s as important", (functionName) => {
    const directAbi = [{
      type: "function",
      name: functionName,
      stateMutability: "nonpayable",
      inputs: [],
      outputs: [],
    }] as const;
    const review = contractCallReview(`Direct ${functionName}`, {
      address: target,
      abi: directAbi,
      functionName,
    });

    expect(review.risk).toBe("important");
  });

  test("rejects account or chain changes made while transaction review is open", () => {
    const expected = { account: holder, chainId: 31337, contextGeneration: 7, deploymentIdentity: "factory-a", routeIdentity: "/projects/31337/project-a" };

    const current = { account: holder, chainId: 31337, contextGeneration: 7, deploymentIdentity: expected.deploymentIdentity, routeIdentity: expected.routeIdentity, walletChainId: 31337 };
    expect(() => assertTransactionIdentity(expected, current, "simulation")).not.toThrow();
    expect(() => assertTransactionIdentity(expected, { ...current, contextGeneration: 9 }, "review")).toThrow("context changed");
    expect(() => assertTransactionIdentity(expected, { ...current, account: factory }, "simulation")).toThrow("account changed");
    expect(() => assertTransactionIdentity(expected, { ...current, walletChainId: 1 }, "submission")).toThrow("network changed");
    expect(() => assertTransactionIdentity(expected, { ...current, chainId: 1 }, "submission")).toThrow("network changed");
    expect(() => assertTransactionIdentity(expected, { ...current, routeIdentity: "/projects/31337/project-b" }, "submission")).toThrow("workspace changed");
    expect(() => assertTransactionIdentity(expected, { ...current, deploymentIdentity: "factory-b" }, "review")).toThrow("deployment changed");
  });

  test("rejects action context resurrection after A to B to A transitions", () => {
    const guard = new TransactionContextGuard("grant:A");
    const stale = guard.capture();

    guard.sync("grant:B");
    guard.sync("grant:A");

    expect(guard.isCurrent(stale)).toBe(false);
    expect(guard.isCurrent(guard.capture())).toBe(true);
  });

  test("includes wallet-chain and wallet-client transitions in the monotonic context", () => {
    const base = {
      account: holder,
      actionInputIdentity: "form-a",
      deploymentIdentity: "factory-a",
      routeIdentity: "/projects/31337/project-a",
      selectedChainId: 31337,
      walletChainId: 31337,
      walletClientGeneration: 1,
    };
    const guard = new TransactionContextGuard(transactionContextIdentity(base));
    const stale = guard.capture();

    guard.sync(transactionContextIdentity({ ...base, walletChainId: 1, walletClientGeneration: 2 }));
    guard.sync(transactionContextIdentity({ ...base, walletClientGeneration: 3 }));

    expect(guard.isCurrent(stale)).toBe(false);
  });

  test("does not revive a submitted action after its form changes away and back", () => {
    const base = {
      account: holder,
      actionInputIdentity: "sale-a",
      deploymentIdentity: "factory-a",
      routeIdentity: "/studio/31337/project-a/distributions",
      selectedChainId: 31337,
      walletChainId: 31337,
      walletClientGeneration: 1,
    };
    const guard = new TransactionContextGuard(transactionContextIdentity(base));
    const stale = guard.capture();

    guard.sync(transactionContextIdentity({ ...base, actionInputIdentity: "sale-b" }));
    guard.sync(transactionContextIdentity(base));

    expect(guard.isCurrent(stale)).toBe(false);
    expect(() => assertTransactionActionCurrent({ isCurrent: () => guard.isCurrent(stale) }, "submission"))
      .toThrow("action details changed");
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
    expect(recovered[2]).toMatchObject({ hash, stage: "submitted", submittedHash: hash });
  });

  test("persists a submitted hash to its origin identity after the active wallet changes", () => {
    const record = {
      id: "tx-origin-a",
      chainId: 31337,
      createdAt: "2026-07-10T00:00:00.000Z",
      functionName: "setValue",
      label: "Update value",
      stage: "awaiting-signature",
      target,
    } satisfies TransactionRecord;
    const hash = `0x${"49".repeat(32)}` as Hex;
    const originIdentity = transactionIdentity(31337, holder);
    const activeIdentity = transactionIdentity(31337, factory);
    const stored = {
      [originIdentity]: [record],
      [activeIdentity]: [],
    };

    const updated = updateStoredTransactionsForIdentity(stored, 31337, holder, record.id, {
      hash,
      stage: "submitted",
      submittedHash: hash,
    });

    expect(updated[originIdentity]?.[0]).toMatchObject({ hash, stage: "submitted", submittedHash: hash });
    expect(updated[activeIdentity]).toEqual([]);
  });

  test("does not clear a confirmed transaction while its scoped refresh is pending", () => {
    const base = {
      id: "tx-refresh",
      chainId: 31337,
      createdAt: "2026-07-10T00:00:00.000Z",
      functionName: "setValue",
      label: "Update value",
      stage: "confirmed",
      target,
    } satisfies TransactionRecord;
    const refreshing = { ...base, refreshPending: true } satisfies TransactionRecord;
    const blocked = {
      ...base,
      id: "tx-old-deployment",
      refreshBlocked: true,
      refreshPending: true,
    } satisfies TransactionRecord;
    const cleared = clearSettledTransactions([
      refreshing,
      blocked,
      { ...base, id: "tx-settled" },
      { ...base, id: "tx-failed", stage: "failed" },
    ]);

    expect(cleared).toEqual([refreshing]);
    expect(transactionStatusLabel(refreshing)).toBe("Confirmed — refreshing workspace data");
    expect(transactionStatusLabel(blocked)).toBe("Confirmed — refresh waiting for the matching deployment");
  });

  test("shares one receipt monitor between live and hydrated callers", async () => {
    const coordinator = new TransactionReceiptCoordinator();
    const hash = `0x${"34".repeat(32)}` as Hex;
    let monitors = 0;
    let invalidations = 0;
    const operation = async () => {
      monitors += 1;
      const outcome = await monitorTransactionReceipt({
        hash,
        waitForReceipt: async () => ({ status: "success", transactionHash: hash }),
      });
      if (outcome.kind === "confirmed") invalidations += 1;
      return outcome;
    };

    const [live, hydrated] = await Promise.all([
      coordinator.ensure("31337:holder:tx-1:hash", operation),
      coordinator.ensure("31337:holder:tx-1:hash", operation),
    ]);

    expect(live).toEqual({ hash, kind: "confirmed" });
    expect(hydrated).toEqual(live);
    expect(monitors).toBe(1);
    expect(invalidations).toBe(1);
  });

  test("isolates A to B to A receipt monitors by monotonic watcher version", () => {
    const hash = `0x${"48".repeat(32)}` as Hex;
    const firstA = transactionReceiptMonitorKey("31337:holder:deployment-a", 1, "tx-1", hash);
    const returnedA = transactionReceiptMonitorKey("31337:holder:deployment-a", 3, "tx-1", hash);

    expect(returnedA).not.toBe(firstA);
  });

  test("always refreshes shared caches while deferring only scoped provenance refresh", () => {
    expect(confirmedReceiptInvalidationPlan(false, false)).toEqual({
      refreshBlocked: false,
      refreshPending: false,
      shared: true,
      scoped: false,
    });
    expect(confirmedReceiptInvalidationPlan(true, false)).toEqual({
      refreshBlocked: true,
      refreshPending: true,
      shared: true,
      scoped: false,
    });
    expect(confirmedReceiptInvalidationPlan(true, true)).toEqual({
      refreshBlocked: false,
      refreshPending: true,
      shared: true,
      scoped: true,
    });
  });

  test("caps background receipt and refresh retries with exponential backoff", () => {
    expect([1, 2, 3, 4, 5].map(receiptBackgroundRetryDelay)).toEqual([
      5_000,
      10_000,
      20_000,
      30_000,
      30_000,
    ]);
  });

  test("keeps confirmed refresh pending until relevant project reads actually load", () => {
    expect(confirmedScopedRefreshNeedsRetry("failed", true)).toBe(true);
    expect(confirmedScopedRefreshNeedsRetry("stale", true)).toBe(true);
    expect(confirmedScopedRefreshNeedsRetry("loaded", true)).toBe(false);
    expect(confirmedScopedRefreshNeedsRetry("failed", false)).toBe(false);
  });

  test("reconciles an active confirmed refresh across A to B to A deployment changes", () => {
    expect(confirmedRefreshIsBlocked("deployment-a", "deployment-a", true)).toBe(false);
    expect(confirmedRefreshIsBlocked("deployment-a", "deployment-b", true)).toBe(true);
    expect(confirmedRefreshIsBlocked("deployment-a", "deployment-a", true)).toBe(false);
  });

  test("keeps a monitor retryable after observation is deferred", async () => {
    const coordinator = new TransactionReceiptCoordinator();
    const hash = `0x${"35".repeat(32)}` as Hex;
    let attempts = 0;
    const deferred = () => coordinator.ensure("tx-retry", async () => {
      attempts += 1;
      throw new TransactionReceiptMonitoringDeferredError();
    });

    await expect(deferred()).rejects.toBeInstanceOf(TransactionReceiptMonitoringDeferredError);
    const recovered = await coordinator.ensure("tx-retry", async () => {
      attempts += 1;
      return { hash, kind: "confirmed" } as const;
    });

    expect(recovered).toEqual({ hash, kind: "confirmed" });
    expect(attempts).toBe(2);
  });

  test("retries a transient receipt error without turning the submission terminal", async () => {
    const hash = `0x${"36".repeat(32)}` as Hex;
    let waits = 0;
    const monitoringErrors: number[] = [];
    const outcome = await monitorTransactionReceipt({
      hash,
      onMonitoringError: (_error, attempt) => monitoringErrors.push(attempt),
      sleep: async () => undefined,
      waitForReceipt: async () => {
        waits += 1;
        if (waits === 1) throw new Error("temporary RPC failure");
        return { status: "success", transactionHash: hash };
      },
    });

    expect(outcome).toEqual({ hash, kind: "confirmed" });
    expect(monitoringErrors).toEqual([1]);
    expect(waits).toBe(2);
  });

  test("defers receipt monitoring after bounded observation failures", async () => {
    const hash = `0x${"37".repeat(32)}` as Hex;
    await expect(monitorTransactionReceipt({
      hash,
      maxAttempts: 2,
      sleep: async () => undefined,
      waitForReceipt: async () => {
        throw new Error("RPC unavailable");
      },
    })).rejects.toBeInstanceOf(TransactionReceiptMonitoringDeferredError);
  });

  test("treats an original reverted receipt as terminal failure", async () => {
    const hash = `0x${"47".repeat(32)}` as Hex;
    const outcome = await monitorTransactionReceipt({
      hash,
      waitForReceipt: async () => ({ status: "reverted", transactionHash: hash }),
    });

    expect(outcome).toEqual({ hash, kind: "reverted" });
  });

  test("ignores a receipt that resolves after its wallet identity becomes stale", async () => {
    const hash = `0x${"38".repeat(32)}` as Hex;
    let current = true;
    await expect(monitorTransactionReceipt({
      hash,
      isCurrent: () => current,
      waitForReceipt: async () => {
        current = false;
        return { status: "success", transactionHash: hash };
      },
    })).rejects.toBeInstanceOf(TransactionReceiptMonitoringCancelledError);
  });

  test("releases receipt monitoring immediately when its identity is cancelled", async () => {
    const hash = `0x${"43".repeat(32)}` as Hex;
    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const monitoring = monitorTransactionReceipt({
      hash,
      signal: controller.signal,
      waitForReceipt: async () => {
        markStarted?.();
        return await new Promise<never>(() => undefined);
      },
    });
    await started;

    controller.abort();

    await expect(monitoring).rejects.toBeInstanceOf(TransactionReceiptMonitoringCancelledError);
  });

  test.each([
    ["cancelled", "cancelled"],
    ["replaced", "replaced"],
    ["repriced", "confirmed"],
  ] as const)("normalizes a %s wallet replacement without claiming the original hash", async (reason, kind) => {
    const originalHash = `0x${"39".repeat(32)}` as Hex;
    const replacementHash = `0x${"40".repeat(32)}` as Hex;
    const replacementReceipt = { status: "success", transactionHash: replacementHash } as const;
    const waitForReceipt: ReceiptWait = async ({ onReplaced }) => {
      onReplaced({
        reason,
        transaction: { hash: replacementHash },
        transactionReceipt: replacementReceipt,
      } satisfies ReceiptReplacementLike);
      return replacementReceipt;
    };

    const outcome = await monitorTransactionReceipt({ hash: originalHash, waitForReceipt });

    expect(outcome).toMatchObject({ hash: replacementHash, kind });
    if (reason === "repriced") expect(outcome).toMatchObject({ replacementReason: "repriced" });
  });

  test("treats a reverted repricing as a failed reviewed transaction", async () => {
    const originalHash = `0x${"41".repeat(32)}` as Hex;
    const replacementHash = `0x${"42".repeat(32)}` as Hex;
    const replacementReceipt = { status: "reverted", transactionHash: replacementHash } as const;
    const outcome = await monitorTransactionReceipt({
      hash: originalHash,
      waitForReceipt: async ({ onReplaced }) => {
        onReplaced({
          reason: "repriced",
          transaction: { hash: replacementHash },
          transactionReceipt: replacementReceipt,
        });
        return replacementReceipt;
      },
    });

    expect(outcome).toEqual({
      hash: replacementHash,
      kind: "reverted",
      replacementReason: "repriced",
    });
  });

  test.each(["cancelled", "replaced"] as const)(
    "does not call the reviewed action reverted when a %s replacement reverts",
    async (reason) => {
      const originalHash = `0x${"44".repeat(32)}` as Hex;
      const replacementHash = `0x${"45".repeat(32)}` as Hex;
      const replacementReceipt = { status: "reverted", transactionHash: replacementHash } as const;
      const outcome = await monitorTransactionReceipt({
        hash: originalHash,
        waitForReceipt: async ({ onReplaced }) => {
          onReplaced({
            reason,
            transaction: { hash: replacementHash },
            transactionReceipt: replacementReceipt,
          });
          return replacementReceipt;
        },
      });

      expect(outcome).toEqual({ hash: replacementHash, kind: reason });
    },
  );

  test("silences only receipt outcomes that already have a finalizer log", () => {
    const hash = `0x${"46".repeat(32)}` as Hex;
    expect(actionErrorWasAlreadyHandled(new TransactionReceiptFinalizedError({ hash, kind: "cancelled" }))).toBe(true);
    expect(actionErrorWasAlreadyHandled(new TransactionReceiptMonitoringCancelledError())).toBe(true);
    expect(actionErrorWasAlreadyHandled(new TransactionReceiptMonitoringDeferredError())).toBe(false);
    expect(actionErrorWasAlreadyHandled(new Error("unhandled"))).toBe(false);
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
