import {
  getAddress,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  stringToBytes,
  type Hex,
  type PrivateKeyAccount,
  type PublicClient,
} from "viem";
import {
  stableJson,
} from "x402-hl/intents";
import type {
  IntentExecutionContext,
  IntentExecutionResult,
  IntentPolicyDecision,
  IntentSimulationResult,
} from "x402-hl/intents/server";
import type {
  AdapterOperationRecord,
  PostgresAdapterOperationStore,
} from "../db";
import type { QuoteRepository } from "../domain";
import {
  readSimulationTransactionEnvelope,
  type Eip1559TransactionEnvelope,
} from "./transaction-envelope";

type StoredEvmTransaction = {
  rawTransaction: Hex;
  transactionHash: Hex;
  quoteId: string;
  chainId: number;
  target: string;
  callDataHash: Hex;
  value: string;
  nonce: string;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
};

const MAX_SAFE_SIGNER_NONCE = BigInt(Number.MAX_SAFE_INTEGER);
const DEFINITELY_UNSUBMITTED_FAILURES = new Set([
  "execution_not_signed",
  "execution_signing_failed",
]);

export type HyperEvmReconciliationResult =
  | {
      status: "confirmed_success";
      transaction: string;
      network: string;
    }
  | { status: "confirmed_failure" }
  | { status: "pending" }
  | { status: "manual_intervention" };

export class DurableHyperEvmExecutor {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly account: PrivateKeyAccount,
    private readonly operations: PostgresAdapterOperationStore,
    private readonly quotes: QuoteRepository,
    private readonly maximumGasCost: bigint,
    private readonly confirmations: number,
    private readonly receiptTimeoutMs: number,
    private readonly leaseMs: number,
  ) {}

  readonly execute = async (
    context: IntentExecutionContext,
    policy: Extract<IntentPolicyDecision, { allowed: true }>,
    simulation: Extract<IntentSimulationResult, { success: true }>,
  ): Promise<IntentExecutionResult> => {
    let transaction: Eip1559TransactionEnvelope;
    let pendingNonce: bigint;
    try {
      transaction = readSimulationTransactionEnvelope(simulation);
      assertGasCostBound(
        transaction,
        BigInt(context.intent.maxGasCost),
        this.maximumGasCost,
      );
      // This is the final fallible RPC operation before the atomic
      // nonce-plus-signed-payload transaction.
      pendingNonce = BigInt(
        await this.publicClient.getTransactionCount({
          address: this.account.address,
          blockTag: "pending",
        }),
      );
      assertSafeSignerNonce(pendingNonce);
      // Validate all transaction fields before creating the operation record.
      getAddress(context.intent.target);
      BigInt(context.intent.value);
    } catch {
      return definitePreSubmissionFailure();
    }

    const requestHash = executionRequestHash(
      context,
      policy,
      simulation,
      transaction,
    );
    const claim = await this.operations.claim({
      kind: "execution",
      idempotencyKey: context.idempotencyKey,
      requestHash,
      network: `eip155:${context.intent.chainId}`,
      signer: this.account.address,
      leaseMs: this.leaseMs,
    });
    if (claim.kind === "conflict") {
      return { success: false, refundSafe: false, mayHaveSucceeded: true };
    }

    let operation = claim.operation;
    const terminal = await this.terminalResult(operation, context.record.quoteId);
    if (terminal) return terminal;

    if (operation.status === "claimed") {
      if (claim.kind !== "claimed") {
        return { success: false, refundSafe: false, mayHaveSucceeded: true };
      }
      let signed;
      try {
        signed = await this.operations.recordSignedWithSignerNonce({
          kind: "execution",
          idempotencyKey: context.idempotencyKey,
          expectedRevision: operation.revision,
          leaseToken: operation.leaseToken,
          minimumNonce: pendingNonce,
          signingFailureCode: "execution_signing_failed",
          createSignedPayload: async signerNonce => {
            assertSafeSignerNonce(signerNonce);
            // Recheck immediately before signing and atomic persistence.
            assertGasCostBound(
              transaction,
              BigInt(context.intent.maxGasCost),
              this.maximumGasCost,
            );
            const stored = await this.signTransaction(
              context,
              signerNonce,
              transaction,
            );
            return {
              payload: JSON.stringify(stored),
              transactionHash: stored.transactionHash,
            };
          },
        });
      } catch {
        // The transaction may have committed before the connection failed.
        // Treat every thrown store outcome as ambiguous and reconcile it.
        return { success: false, refundSafe: false, mayHaveSucceeded: true };
      }
      if (signed.kind === "signing_failed") {
        return definitePreSubmissionFailure();
      }
      if (
        signed.kind !== "updated" ||
        signed.operation.signerNonce === undefined
      ) {
        return { success: false, refundSafe: false, mayHaveSucceeded: true };
      }
      operation = signed.operation;
    }

    const encoded = await this.operations.loadPayload(
      "execution",
      context.idempotencyKey,
    );
    if (!encoded) {
      return { success: false, refundSafe: false, mayHaveSucceeded: true };
    }
    const stored = JSON.parse(encoded) as StoredEvmTransaction;

    if (!executionPayloadMatches(stored, context, operation, transaction)) {
      await this.markManual(
        operation,
        context.idempotencyKey,
        "execution_payload_mismatch",
      );
      return { success: false, refundSafe: false, mayHaveSucceeded: true };
    }

    if (operation.status === "signed") {
      try {
        const submittedHash = await this.publicClient.sendRawTransaction({
          serializedTransaction: stored.rawTransaction,
        });
        if (submittedHash.toLowerCase() !== stored.transactionHash.toLowerCase()) {
          throw new Error("RPC returned a different transaction hash");
        }
      } catch {
        // Submission errors are ambiguous. Persist submitted before
        // reconciliation so no retry can ever sign a different transaction.
      }
      const submitted = await this.operations.recordSubmitted({
        kind: "execution",
        idempotencyKey: context.idempotencyKey,
        expectedRevision: operation.revision,
        leaseToken: operation.leaseToken,
        transactionHash: stored.transactionHash,
      });
      if (submitted.kind !== "updated") {
        return { success: false, refundSafe: false, mayHaveSucceeded: true };
      }
      operation = submitted.operation;
    }

    let receipt;
    try {
      receipt = await this.publicClient.waitForTransactionReceipt({
        hash: stored.transactionHash,
        confirmations: this.confirmations,
        timeout: this.receiptTimeoutMs,
      });
    } catch {
      await this.markManual(
        operation,
        context.idempotencyKey,
        "execution_receipt_uncertain",
      );
      return { success: false, refundSafe: false, mayHaveSucceeded: true };
    }

    const success = receipt.status === "success";
    const outcome = await this.operations.recordOutcome({
      kind: "execution",
      idempotencyKey: context.idempotencyKey,
      expectedRevision: operation.revision,
      leaseToken: operation.leaseToken,
      outcome: success ? "confirmed_success" : "confirmed_failure",
      transactionHash: stored.transactionHash,
      receipt: jsonObject(receipt),
      ...(!success ? { failureCode: "evm_transaction_reverted" } : {}),
    });
    if (outcome.kind !== "updated") {
      return { success: false, refundSafe: false, mayHaveSucceeded: true };
    }
    if (!success) {
      return { success: false, refundSafe: true, mayHaveSucceeded: false };
    }

    await this.quotes.finalizeExecution(context.record.quoteId);
    return {
      success: true,
      confirmed: true,
      transaction: stored.transactionHash,
      network: `eip155:${context.intent.chainId}`,
    };
  };

  /**
   * Reconciles only the exact raw transaction already sealed in the operation
   * journal. It never estimates, signs, or substitutes a transaction.
   */
  readonly reconcileSubmitted = async (input: {
    idempotencyKey: string;
    quoteId: string;
  }): Promise<HyperEvmReconciliationResult> => {
    const existing = await this.operations.get(
      "execution",
      input.idempotencyKey,
    );
    if (!existing) {
      // Broadcast is impossible without first creating and sealing an
      // operation, so absence is a definitive pre-submission failure.
      return { status: "confirmed_failure" };
    }
    const existingTerminal = await this.reconciliationTerminal(
      existing,
      input.quoteId,
    );
    if (existingTerminal) return existingTerminal;

    const claim = await this.operations.claim({
      kind: "execution",
      idempotencyKey: input.idempotencyKey,
      requestHash: existing.requestHash,
      network: existing.network,
      signer: existing.signer,
      leaseMs: this.leaseMs,
    });
    if (claim.kind === "conflict") {
      return { status: "manual_intervention" };
    }
    if (claim.kind === "existing") {
      const terminal = await this.reconciliationTerminal(
        claim.operation,
        input.quoteId,
      );
      return terminal ?? { status: "pending" };
    }

    let operation = claim.operation;
    const terminal = await this.reconciliationTerminal(
      operation,
      input.quoteId,
    );
    if (terminal) return terminal;

    if (operation.status === "claimed") {
      const failed =
        await this.operations.recordUnsubmittedExecutionFailure({
          idempotencyKey: input.idempotencyKey,
          expectedRevision: operation.revision,
          leaseToken: operation.leaseToken,
          failureCode: "execution_not_signed",
        });
      return failed.kind === "updated"
        ? { status: "confirmed_failure" }
        : { status: "pending" };
    }
    if (operation.status !== "signed" && operation.status !== "submitted") {
      return { status: "manual_intervention" };
    }

    let stored: StoredEvmTransaction;
    try {
      const encoded = await this.operations.loadPayload(
        "execution",
        input.idempotencyKey,
      );
      if (!encoded) throw new Error("missing signed payload");
      stored = JSON.parse(encoded) as StoredEvmTransaction;
      if (
        !(await recoveryPayloadMatches(
          stored,
          operation,
          input.quoteId,
          this.account.address,
        ))
      ) {
        throw new Error("signed payload binding mismatch");
      }
    } catch {
      await this.markManual(
        operation,
        input.idempotencyKey,
        "execution_recovery_payload_mismatch",
      );
      return { status: "manual_intervention" };
    }

    if (operation.status === "signed") {
      try {
        const submittedHash = await this.publicClient.sendRawTransaction({
          serializedTransaction: stored.rawTransaction,
        });
        if (
          submittedHash.toLowerCase() !== stored.transactionHash.toLowerCase()
        ) {
          await this.markManual(
            operation,
            input.idempotencyKey,
            "execution_recovery_hash_mismatch",
          );
          return { status: "manual_intervention" };
        }
      } catch {
        // Submission errors are ambiguous. Persist the known hash and inspect
        // it without ever signing another transaction.
      }
      const submitted = await this.operations.recordSubmitted({
        kind: "execution",
        idempotencyKey: input.idempotencyKey,
        expectedRevision: operation.revision,
        leaseToken: operation.leaseToken,
        transactionHash: stored.transactionHash,
      });
      if (submitted.kind !== "updated") return { status: "pending" };
      operation = submitted.operation;
    }

    let receipt;
    let blockNumber: bigint;
    try {
      [receipt, blockNumber] = await Promise.all([
        this.publicClient.getTransactionReceipt({
          hash: stored.transactionHash,
        }),
        this.publicClient.getBlockNumber(),
      ]);
    } catch {
      return { status: "pending" };
    }
    if (
      receipt.transactionHash.toLowerCase() !==
        stored.transactionHash.toLowerCase() ||
      blockNumber < receipt.blockNumber ||
      blockNumber - receipt.blockNumber + 1n < BigInt(this.confirmations)
    ) {
      return { status: "pending" };
    }

    const success = receipt.status === "success";
    const outcome = await this.operations.recordOutcome({
      kind: "execution",
      idempotencyKey: input.idempotencyKey,
      expectedRevision: operation.revision,
      leaseToken: operation.leaseToken,
      outcome: success ? "confirmed_success" : "confirmed_failure",
      transactionHash: stored.transactionHash,
      receipt: jsonObject(receipt),
      ...(!success ? { failureCode: "evm_transaction_reverted" } : {}),
    });
    if (outcome.kind !== "updated") return { status: "pending" };
    if (!success) return { status: "confirmed_failure" };

    await this.quotes.finalizeExecution(input.quoteId);
    return {
      status: "confirmed_success",
      transaction: stored.transactionHash,
      network: operation.network,
    };
  };

  private async signTransaction(
    context: IntentExecutionContext,
    nonce: bigint,
    transaction: Eip1559TransactionEnvelope,
  ): Promise<StoredEvmTransaction> {
    assertSafeSignerNonce(nonce);
    const target = getAddress(context.intent.target);
    const callData = context.intent.callData as Hex;
    const value = BigInt(context.intent.value);
    const rawTransaction = await this.account.signTransaction({
      chainId: context.intent.chainId,
      type: "eip1559",
      to: target,
      data: callData,
      value,
      nonce: Number(nonce),
      gas: transaction.gas,
      maxFeePerGas: transaction.maxFeePerGas,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
    });
    return {
      rawTransaction,
      transactionHash: keccak256(rawTransaction),
      quoteId: context.record.quoteId,
      chainId: context.intent.chainId,
      target,
      callDataHash: keccak256(callData),
      value: value.toString(),
      nonce: nonce.toString(),
      gas: transaction.gas.toString(),
      maxFeePerGas: transaction.maxFeePerGas.toString(),
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas.toString(),
    };
  }

  private async terminalResult(
    operation: AdapterOperationRecord,
    quoteId: string,
  ): Promise<IntentExecutionResult | undefined> {
    if (operation.status === "confirmed_success" && operation.transactionHash) {
      await this.quotes.finalizeExecution(quoteId);
      return {
        success: true,
        confirmed: true,
        transaction: operation.transactionHash,
        network: operation.network,
      };
    }
    if (operation.status === "confirmed_failure") {
      return { success: false, refundSafe: true, mayHaveSucceeded: false };
    }
    if (operation.status === "manual_intervention") {
      return { success: false, refundSafe: false, mayHaveSucceeded: true };
    }
    return undefined;
  }

  private async reconciliationTerminal(
    operation: AdapterOperationRecord,
    quoteId: string,
  ): Promise<HyperEvmReconciliationResult | undefined> {
    if (operation.status === "confirmed_success" && operation.transactionHash) {
      await this.quotes.finalizeExecution(quoteId);
      return {
        status: "confirmed_success",
        transaction: operation.transactionHash,
        network: operation.network,
      };
    }
    if (operation.status === "confirmed_failure") {
      return { status: "confirmed_failure" };
    }
    if (operation.status === "manual_intervention") {
      return DEFINITELY_UNSUBMITTED_FAILURES.has(operation.failureCode ?? "") &&
        operation.signerNonce === undefined &&
        operation.transactionHash === undefined
        ? { status: "confirmed_failure" }
        : { status: "manual_intervention" };
    }
    return undefined;
  }

  private async markManual(
    operation: AdapterOperationRecord,
    idempotencyKey: string,
    failureCode: string,
  ): Promise<void> {
    if (
      operation.status !== "claimed" &&
      operation.status !== "signed" &&
      operation.status !== "submitted"
    ) {
      return;
    }
    await this.operations.markManualIntervention({
      kind: "execution",
      idempotencyKey,
      expectedRevision: operation.revision,
      leaseToken: operation.leaseToken,
      from: operation.status,
      failureCode,
      ...(operation.transactionHash
        ? { transactionHash: operation.transactionHash }
        : {}),
    });
  }
}

function executionRequestHash(
  context: IntentExecutionContext,
  policy: Extract<IntentPolicyDecision, { allowed: true }>,
  simulation: Extract<IntentSimulationResult, { success: true }>,
  transaction: Eip1559TransactionEnvelope,
): Hex {
  return keccak256(
    stringToBytes(
      stableJson({
        intentHash: context.record.intentHash,
        quoteId: context.record.quoteId,
        target: policy.target,
        callDataHash: policy.callDataHash,
        value: policy.value,
        chainId: policy.chainId,
        recipient: policy.recipient,
        gasCost: simulation.gasCost,
        slippageBps: simulation.slippageBps,
        gas: transaction.gas.toString(),
        maxFeePerGas: transaction.maxFeePerGas.toString(),
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas.toString(),
      }),
    ),
  );
}

function executionPayloadMatches(
  stored: StoredEvmTransaction,
  context: IntentExecutionContext,
  operation: AdapterOperationRecord,
  transaction: Eip1559TransactionEnvelope,
): boolean {
  return (
    stored.quoteId === context.record.quoteId &&
    stored.chainId === context.intent.chainId &&
    stored.target.toLowerCase() === context.intent.target.toLowerCase() &&
    stored.callDataHash.toLowerCase() ===
      keccak256(context.intent.callData as Hex).toLowerCase() &&
    stored.value === BigInt(context.intent.value).toString() &&
    stored.nonce === operation.signerNonce?.toString() &&
    stored.gas === transaction.gas.toString() &&
    stored.maxFeePerGas === transaction.maxFeePerGas.toString() &&
    stored.maxPriorityFeePerGas ===
      transaction.maxPriorityFeePerGas.toString() &&
    keccak256(stored.rawTransaction).toLowerCase() ===
      stored.transactionHash.toLowerCase() &&
    operation.transactionHash?.toLowerCase() ===
      stored.transactionHash.toLowerCase()
  );
}

async function recoveryPayloadMatches(
  stored: StoredEvmTransaction,
  operation: AdapterOperationRecord,
  quoteId: string,
  expectedSigner: string,
): Promise<boolean> {
  try {
    if (!stored.rawTransaction.startsWith("0x02")) return false;
    const serialized = stored.rawTransaction as `0x02${string}`;
    const parsed = parseTransaction(serialized);
    const recoveredSigner = await recoverTransactionAddress({
      serializedTransaction: serialized,
    });
    const parsedData = parsed.data ?? "0x";
    const parsedValue = parsed.value ?? 0n;
    return (
      stored.quoteId === quoteId &&
      operation.signerNonce !== undefined &&
      operation.network === `eip155:${stored.chainId}` &&
      operation.signer.toLowerCase() === expectedSigner.toLowerCase() &&
      recoveredSigner.toLowerCase() === expectedSigner.toLowerCase() &&
      stored.transactionHash.toLowerCase() ===
        keccak256(stored.rawTransaction).toLowerCase() &&
      operation.transactionHash?.toLowerCase() ===
        stored.transactionHash.toLowerCase() &&
      parsed.chainId === stored.chainId &&
      parsed.nonce !== undefined &&
      BigInt(parsed.nonce) === operation.signerNonce &&
      stored.nonce === operation.signerNonce.toString() &&
      parsed.to?.toLowerCase() === stored.target.toLowerCase() &&
      keccak256(parsedData).toLowerCase() ===
        stored.callDataHash.toLowerCase() &&
      parsedValue.toString() === stored.value &&
      parsed.gas?.toString() === stored.gas &&
      parsed.maxFeePerGas?.toString() === stored.maxFeePerGas &&
      parsed.maxPriorityFeePerGas?.toString() ===
        stored.maxPriorityFeePerGas
    );
  } catch {
    return false;
  }
}

function assertGasCostBound(
  transaction: Eip1559TransactionEnvelope,
  intentMaximum: bigint,
  configuredMaximum: bigint,
): void {
  if (
    intentMaximum < 0n ||
    configuredMaximum <= 0n ||
    transaction.gasCost > intentMaximum ||
    transaction.gasCost > configuredMaximum
  ) {
    throw new Error("The exact destination transaction exceeds its gas-cost bound.");
  }
}

function assertSafeSignerNonce(nonce: bigint): void {
  if (nonce < 0n || nonce > MAX_SAFE_SIGNER_NONCE) {
    throw new Error("The signer nonce cannot be represented safely.");
  }
}

function definitePreSubmissionFailure(): IntentExecutionResult {
  return {
    success: false,
    refundSafe: true,
    mayHaveSucceeded: false,
  };
}

function jsonObject(value: unknown) {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as Record<string, string | number | boolean | null>;
}
