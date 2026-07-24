import { describe, expect, test } from "bun:test";
import {
  keccak256,
  parseTransaction,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DurableHyperEvmExecutor } from "../src/execution/hyperevm";
import type { AdapterOperationRecord } from "../src/db";
import type { QuoteRepository } from "../src/domain";

const account = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);
const target = "0x00000000000000000000000000000000000000b1" as const;
const recipient = "0x00000000000000000000000000000000000000c1" as const;
const callData = "0x12345678" as const;

function operation(
  overrides: Partial<AdapterOperationRecord> = {},
): AdapterOperationRecord {
  return {
    id: "operation-1",
    kind: "execution",
    idempotencyKey: "intent-1:execute",
    requestHash: `0x${"11".repeat(32)}`,
    network: "eip155:998",
    signer: account.address,
    status: "claimed",
    revision: 0,
    leaseToken: "lease-1",
    leaseExpiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    hasEncryptedPayload: false,
    ...overrides,
  };
}

function context() {
  return {
    idempotencyKey: "intent-1:execute",
    record: {
      quoteId: "quote-1",
      intentHash: `0x${"22".repeat(32)}`,
    },
    intent: {
      chainId: 998,
      target,
      callData,
      value: "0",
      maxGasCost: "2520000",
    },
  } as never;
}

const policy = {
  allowed: true,
  chainId: 998,
  target,
  selector: callData,
  callDataHash: keccak256(callData),
  value: "0",
  recipient,
} as const;

const simulation = {
  success: true,
  chainId: 998,
  target,
  callDataHash: keccak256(callData),
  value: "0",
  recipient,
  gasCost: "2520000",
  slippageBps: 0,
  metadata: {
    transactionType: "eip1559",
    gas: "25200",
    maxFeePerGas: "100",
    maxPriorityFeePerGas: "7",
  },
} as const;

async function sealedTransactionFixture(nonce = 7n) {
  const rawTransaction = await account.signTransaction({
    chainId: 998,
    type: "eip1559",
    to: target,
    data: callData,
    value: 0n,
    nonce: Number(nonce),
    gas: 25_200n,
    maxFeePerGas: 100n,
    maxPriorityFeePerGas: 7n,
  });
  const transactionHash = keccak256(rawTransaction);
  return {
    transactionHash,
    payload: JSON.stringify({
      rawTransaction,
      transactionHash,
      quoteId: "quote-1",
      chainId: 998,
      target,
      callDataHash: keccak256(callData),
      value: "0",
      nonce: nonce.toString(),
      gas: "25200",
      maxFeePerGas: "100",
      maxPriorityFeePerGas: "7",
    }),
  };
}

const quotes: QuoteRepository = {
  async createReserved(input) {
    return input.quote;
  },
  async get() {
    return undefined;
  },
  async bindPaymentPayload(input) {
    return { ...input, boundAt: new Date() };
  },
  async getPaymentBinding() {
    return undefined;
  },
  async listPaymentBindingsWithoutOrder() {
    return [];
  },
  async releaseExpired() {
    return 0;
  },
  async commitReservations() {},
  async finalizeExecution() {},
  async finalizeRefund() {},
  async finalizeSettlementFailure() {},
  async releaseQuotedReservations() {},
  async reservedInventory() {
    return 0n;
  },
};

describe("DurableHyperEvmExecutor", () => {
  test("atomically persists the exact simulated tuple without re-estimating", async () => {
    const calls: string[] = [];
    let signedPayload: string | undefined;
    let current = operation();
    const publicClient = {
      async getTransactionCount() {
        calls.push("getTransactionCount");
        return 7;
      },
      async estimateGas() {
        throw new Error("executor must not re-estimate gas");
      },
      async estimateFeesPerGas() {
        throw new Error("executor must not re-estimate fees");
      },
      async sendRawTransaction(input: { serializedTransaction: Hex }) {
        calls.push("sendRawTransaction");
        return keccak256(input.serializedTransaction);
      },
      async waitForTransactionReceipt() {
        calls.push("waitForTransactionReceipt");
        return { status: "success", blockNumber: 1n };
      },
    };
    const operations = {
      async claim() {
        calls.push("claim");
        return { kind: "claimed", operation: current };
      },
      async recordSignedWithSignerNonce(input: {
        createSignedPayload: (nonce: bigint) => Promise<{
          payload: string;
          transactionHash: Hex;
        }>;
      }) {
        calls.push("recordSignedWithSignerNonce");
        const signed = await input.createSignedPayload(7n);
        signedPayload = signed.payload;
        current = operation({
          signerNonce: 7n,
          transactionHash: signed.transactionHash,
          status: "signed",
          revision: 1,
          hasEncryptedPayload: true,
        });
        return { kind: "updated", operation: current };
      },
      async recordSubmitted() {
        calls.push("recordSubmitted");
        current = operation({
          signerNonce: 7n,
          transactionHash: current.transactionHash!,
          status: "submitted",
          revision: 2,
          hasEncryptedPayload: true,
        });
        return { kind: "updated", operation: current };
      },
      async recordOutcome() {
        calls.push("recordOutcome");
        current = operation({
          signerNonce: 7n,
          transactionHash: current.transactionHash!,
          status: "confirmed_success",
          revision: 3,
          hasEncryptedPayload: true,
        });
        return { kind: "updated", operation: current };
      },
      async loadPayload() {
        return signedPayload;
      },
      async markManualIntervention() {
        throw new Error("unexpected manual intervention");
      },
    };
    const finalized: string[] = [];
    const repository = {
      ...quotes,
      async finalizeExecution(id: string) {
        calls.push("finalizeExecution");
        finalized.push(id);
      },
    };
    const executor = new DurableHyperEvmExecutor(
      publicClient as never,
      account,
      operations as never,
      repository,
      2_520_000n,
      1,
      5_000,
      60_000,
    );

    const result = await executor.execute(
      context(),
      policy,
      simulation,
    );

    expect(result).toMatchObject({
      success: true,
      confirmed: true,
      network: "eip155:998",
    });
    expect(finalized).toEqual(["quote-1"]);
    expect(calls).toEqual([
      "getTransactionCount",
      "claim",
      "recordSignedWithSignerNonce",
      "sendRawTransaction",
      "recordSubmitted",
      "waitForTransactionReceipt",
      "recordOutcome",
      "finalizeExecution",
    ]);
    const stored = JSON.parse(signedPayload ?? "{}") as {
      rawTransaction: Hex;
      nonce: string;
      gas: string;
      maxFeePerGas: string;
      maxPriorityFeePerGas: string;
    };
    expect(stored).toMatchObject({
      nonce: "7",
      gas: "25200",
      maxFeePerGas: "100",
      maxPriorityFeePerGas: "7",
    });
    const parsed = parseTransaction(stored.rawTransaction);
    expect(parsed).toMatchObject({
      chainId: 998,
      nonce: 7,
      gas: 25_200n,
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 7n,
      to: target,
      data: callData,
    });
    expect(parsed.value ?? 0n).toBe(0n);
  });

  test("rejects an exact tuple above the runtime gas bound before persistence", async () => {
    let claimed = false;
    const executor = new DurableHyperEvmExecutor(
      {
        async getTransactionCount() {
          throw new Error("gas bound must be checked first");
        },
      } as never,
      account,
      {
        async claim() {
          claimed = true;
          throw new Error("must not claim");
        },
      } as never,
      quotes,
      2_519_999n,
      1,
      5_000,
      60_000,
    );
    await expect(
      executor.execute(context(), policy, simulation),
    ).resolves.toEqual({
      success: false,
      refundSafe: true,
      mayHaveSucceeded: false,
    });
    expect(claimed).toBeFalse();
  });

  test("returns refund-safe only after a signing failure is terminalized", async () => {
    let signed = false;
    const claimed = operation();
    const abandoned = operation({
      status: "manual_intervention",
      revision: 1,
      failureCode: "execution_signing_failed",
      hasEncryptedPayload: true,
    });
    const executor = new DurableHyperEvmExecutor(
      {
        async getTransactionCount() {
          return 1;
        },
      } as never,
      account,
      {
        async claim() {
          return { kind: "claimed", operation: claimed };
        },
        async recordSignedWithSignerNonce(input: {
          createSignedPayload: (nonce: bigint) => Promise<unknown>;
        }) {
          try {
            signed = true;
            await input.createSignedPayload(
              BigInt(Number.MAX_SAFE_INTEGER) + 1n,
            );
          } catch {
            return { kind: "signing_failed", operation: abandoned };
          }
          throw new Error("unsafe nonce unexpectedly signed");
        },
      } as never,
      quotes,
      2_520_000n,
      1,
      5_000,
      60_000,
    );
    await expect(
      executor.execute(context(), policy, simulation),
    ).resolves.toEqual({
      success: false,
      refundSafe: true,
      mayHaveSucceeded: false,
    });
    expect(signed).toBeTrue();
  });

  test("does not refund when atomic signed persistence has an ambiguous outcome", async () => {
    const claimed = operation();
    const executor = new DurableHyperEvmExecutor(
      {
        async getTransactionCount() {
          return 7;
        },
      } as never,
      account,
      {
        async claim() {
          return { kind: "claimed", operation: claimed };
        },
        async recordSignedWithSignerNonce(input: {
          createSignedPayload: (nonce: bigint) => Promise<unknown>;
        }) {
          await input.createSignedPayload(7n);
          throw new Error("connection lost after possible commit");
        },
      } as never,
      quotes,
      2_520_000n,
      1,
      5_000,
      60_000,
    );
    await expect(
      executor.execute(context(), policy, simulation),
    ).resolves.toEqual({
      success: false,
      refundSafe: false,
      mayHaveSucceeded: true,
    });
  });

  test("reconciles a confirmed persisted transaction without signing or resubmitting", async () => {
    const sealed = await sealedTransactionFixture();
    const submitted = operation({
      status: "submitted",
      signerNonce: 7n,
      transactionHash: sealed.transactionHash,
      revision: 2,
      hasEncryptedPayload: true,
    });
    let recordedOutcome: string | undefined;
    let finalized: string | undefined;
    const executor = new DurableHyperEvmExecutor(
      {
        async sendRawTransaction() {
          throw new Error("submitted recovery must not resubmit");
        },
        async getTransactionReceipt() {
          return {
            transactionHash: sealed.transactionHash,
            status: "success",
            blockNumber: 10n,
          };
        },
        async getBlockNumber() {
          return 11n;
        },
      } as never,
      account,
      {
        async get() {
          return submitted;
        },
        async claim() {
          return { kind: "claimed", operation: submitted };
        },
        async loadPayload() {
          return sealed.payload;
        },
        async recordOutcome(input: { outcome: string }) {
          recordedOutcome = input.outcome;
          return {
            kind: "updated",
            operation: operation({
              ...submitted,
              status: "confirmed_success",
              revision: 3,
            }),
          };
        },
      } as never,
      {
        ...quotes,
        async finalizeExecution(id: string) {
          finalized = id;
        },
      },
      2_520_000n,
      2,
      5_000,
      60_000,
    );

    await expect(
      executor.reconcileSubmitted({
        idempotencyKey: "intent-1:execute",
        quoteId: "quote-1",
      }),
    ).resolves.toEqual({
      status: "confirmed_success",
      transaction: sealed.transactionHash,
      network: "eip155:998",
    });
    expect(recordedOutcome).toBe("confirmed_success");
    expect(finalized).toBe("quote-1");
  });

  test("keeps an absent receipt pending and terminalizes a never-signed crash", async () => {
    const sealed = await sealedTransactionFixture();
    const submitted = operation({
      status: "submitted",
      signerNonce: 7n,
      transactionHash: sealed.transactionHash,
      revision: 2,
      hasEncryptedPayload: true,
    });
    const pendingExecutor = new DurableHyperEvmExecutor(
      {
        async getTransactionReceipt() {
          throw new Error("receipt not found");
        },
        async getBlockNumber() {
          return 11n;
        },
      } as never,
      account,
      {
        async get() {
          return submitted;
        },
        async claim() {
          return { kind: "claimed", operation: submitted };
        },
        async loadPayload() {
          return sealed.payload;
        },
      } as never,
      quotes,
      2_520_000n,
      1,
      5_000,
      60_000,
    );
    await expect(
      pendingExecutor.reconcileSubmitted({
        idempotencyKey: "intent-1:execute",
        quoteId: "quote-1",
      }),
    ).resolves.toEqual({ status: "pending" });

    const claimed = operation();
    const abandoned = operation({
      status: "manual_intervention",
      revision: 1,
      failureCode: "execution_not_signed",
      hasEncryptedPayload: true,
    });
    const crashExecutor = new DurableHyperEvmExecutor(
      {} as never,
      account,
      {
        async get() {
          return claimed;
        },
        async claim() {
          return { kind: "claimed", operation: claimed };
        },
        async recordUnsubmittedExecutionFailure() {
          return { kind: "updated", operation: abandoned };
        },
      } as never,
      quotes,
      2_520_000n,
      1,
      5_000,
      60_000,
    );
    await expect(
      crashExecutor.reconcileSubmitted({
        idempotencyKey: "intent-1:execute",
        quoteId: "quote-1",
      }),
    ).resolves.toEqual({ status: "confirmed_failure" });
  });

  test("turns a confirmed revert into a refund-safe reconciliation outcome", async () => {
    const sealed = await sealedTransactionFixture();
    const submitted = operation({
      status: "submitted",
      signerNonce: 7n,
      transactionHash: sealed.transactionHash,
      revision: 2,
      hasEncryptedPayload: true,
    });
    let outcome: string | undefined;
    const executor = new DurableHyperEvmExecutor(
      {
        async getTransactionReceipt() {
          return {
            transactionHash: sealed.transactionHash,
            status: "reverted",
            blockNumber: 10n,
          };
        },
        async getBlockNumber() {
          return 10n;
        },
      } as never,
      account,
      {
        async get() {
          return submitted;
        },
        async claim() {
          return { kind: "claimed", operation: submitted };
        },
        async loadPayload() {
          return sealed.payload;
        },
        async recordOutcome(input: { outcome: string }) {
          outcome = input.outcome;
          return {
            kind: "updated",
            operation: operation({
              ...submitted,
              status: "confirmed_failure",
              revision: 3,
            }),
          };
        },
      } as never,
      quotes,
      2_520_000n,
      1,
      5_000,
      60_000,
    );
    await expect(
      executor.reconcileSubmitted({
        idempotencyKey: "intent-1:execute",
        quoteId: "quote-1",
      }),
    ).resolves.toEqual({ status: "confirmed_failure" });
    expect(outcome).toBe("confirmed_failure");
  });

  test("does not broaden an ambiguous manual receipt timeout into auto-refund", async () => {
    const manual = operation({
      status: "manual_intervention",
      signerNonce: 7n,
      transactionHash: `0x${"55".repeat(32)}`,
      failureCode: "execution_receipt_uncertain",
      revision: 3,
      hasEncryptedPayload: true,
    });
    const executor = new DurableHyperEvmExecutor(
      {} as never,
      account,
      {
        async get() {
          return manual;
        },
      } as never,
      quotes,
      2_520_000n,
      1,
      5_000,
      60_000,
    );
    await expect(
      executor.reconcileSubmitted({
        idempotencyKey: "intent-1:execute",
        quoteId: "quote-1",
      }),
    ).resolves.toEqual({ status: "manual_intervention" });
  });
});
