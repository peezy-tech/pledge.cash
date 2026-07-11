import type { Hex } from "viem";

export type ReceiptReplacementReason = "cancelled" | "replaced" | "repriced";

export type ReceiptLike = {
  status: "reverted" | "success";
  transactionHash: Hex;
};

export type ReceiptReplacementLike = {
  reason: ReceiptReplacementReason;
  transaction: { hash: Hex };
  transactionReceipt: ReceiptLike;
};

export type ReceiptWaitParameters = {
  hash: Hex;
  onReplaced: (replacement: ReceiptReplacementLike) => void;
};

export type ReceiptWait = (parameters: ReceiptWaitParameters) => Promise<ReceiptLike>;

export type TransactionReceiptOutcome =
  | { hash: Hex; kind: "cancelled" }
  | { hash: Hex; kind: "confirmed"; replacementReason?: "repriced" }
  | { hash: Hex; kind: "replaced" }
  | { hash: Hex; kind: "reverted"; replacementReason?: ReceiptReplacementReason };

export class TransactionReceiptMonitoringDeferredError extends Error {
  constructor(cause?: unknown) {
    super("Confirmation tracking was interrupted. The transaction is still submitted and will be checked again automatically.", {
      cause,
    });
    this.name = "TransactionReceiptMonitoringDeferredError";
  }
}

export class TransactionReceiptMonitoringCancelledError extends Error {
  constructor() {
    super("Transaction receipt monitoring moved to another wallet or network context.");
    this.name = "TransactionReceiptMonitoringCancelledError";
  }
}

export class TransactionReceiptFinalizedError extends Error {
  readonly outcome: Exclude<TransactionReceiptOutcome, { kind: "confirmed" }>;

  constructor(outcome: Exclude<TransactionReceiptOutcome, { kind: "confirmed" }>) {
    const message = outcome.kind === "cancelled"
      ? "The transaction was cancelled in the wallet."
      : outcome.kind === "replaced"
        ? "The transaction was replaced by a different wallet transaction."
        : "The transaction reverted after submission.";
    super(message);
    this.name = "TransactionReceiptFinalizedError";
    this.outcome = outcome;
  }
}

export class TransactionReceiptCoordinator {
  readonly #monitors = new Map<string, Promise<TransactionReceiptOutcome>>();

  ensure(key: string, operation: () => Promise<TransactionReceiptOutcome>): Promise<TransactionReceiptOutcome> {
    const existing = this.#monitors.get(key);
    if (existing) return existing;

    const monitor = Promise.resolve()
      .then(operation)
      .catch((error: unknown) => {
        if (this.#monitors.get(key) === monitor) this.#monitors.delete(key);
        throw error;
      });
    this.#monitors.set(key, monitor);
    return monitor;
  }
}

export function transactionReceiptMonitorKey(
  watcherIdentity: string,
  watcherVersion: number,
  transactionId: string,
  submittedHash: Hex,
): string {
  return `${watcherIdentity}:${watcherVersion.toString()}:${transactionId}:${submittedHash.toLowerCase()}`;
}

export function confirmedReceiptInvalidationPlan(
  hasRefreshRoute: boolean,
  allowScopedInvalidation: boolean,
): { refreshPending: boolean; shared: true; scoped: boolean } {
  return {
    refreshPending: hasRefreshRoute,
    shared: true,
    scoped: hasRefreshRoute && allowScopedInvalidation,
  };
}

export async function monitorTransactionReceipt({
  hash,
  isCurrent = () => true,
  maxAttempts = 2,
  onMonitoringError = () => undefined,
  signal,
  sleep = defaultSleep,
  waitForReceipt,
}: {
  hash: Hex;
  isCurrent?: () => boolean;
  maxAttempts?: number;
  onMonitoringError?: (error: unknown, attempt: number) => void;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  waitForReceipt: ReceiptWait;
}): Promise<TransactionReceiptOutcome> {
  let lastError: unknown;
  const attempts = Math.max(1, maxAttempts);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    assertReceiptMonitorCurrent(isCurrent, signal);
    try {
      const outcome = await raceReceiptMonitorCancellation(waitForReceiptOutcome(hash, waitForReceipt), signal);
      assertReceiptMonitorCurrent(isCurrent, signal);
      return outcome;
    } catch (error) {
      if (error instanceof TransactionReceiptMonitoringCancelledError) throw error;
      assertReceiptMonitorCurrent(isCurrent, signal);
      lastError = error;
      onMonitoringError(error, attempt);
      if (attempt < attempts) {
        await raceReceiptMonitorCancellation(sleep(receiptAttemptDelay(attempt)), signal);
      }
    }
  }

  throw new TransactionReceiptMonitoringDeferredError(lastError);
}

export function receiptAttemptDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 15_000);
}

export function receiptBackgroundRetryDelay(attempt: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempt - 1), 30_000);
}

async function waitForReceiptOutcome(hash: Hex, waitForReceipt: ReceiptWait): Promise<TransactionReceiptOutcome> {
  let replacement: ReceiptReplacementLike | undefined;
  const receipt = await waitForReceipt({
    hash,
    onReplaced: (nextReplacement) => {
      replacement = nextReplacement;
    },
  });

  if (replacement) {
    const replacementHash = replacement.transaction.hash;
    if (replacement.reason === "cancelled") return { hash: replacementHash, kind: "cancelled" };
    if (replacement.reason === "replaced") return { hash: replacementHash, kind: "replaced" };
    if (replacement.reason === "repriced") {
      return replacement.transactionReceipt.status === "success"
        ? { hash: replacementHash, kind: "confirmed", replacementReason: "repriced" }
        : { hash: replacementHash, kind: "reverted", replacementReason: "repriced" };
    }
    return { hash: replacementHash, kind: "replaced" };
  }

  return receipt.status === "success"
    ? { hash: receipt.transactionHash, kind: "confirmed" }
    : { hash: receipt.transactionHash, kind: "reverted" };
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function assertReceiptMonitorCurrent(isCurrent: () => boolean, signal: AbortSignal | undefined): void {
  if (!isCurrent() || signal?.aborted) throw new TransactionReceiptMonitoringCancelledError();
}

async function raceReceiptMonitorCancellation<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return await operation;
  if (signal.aborted) throw new TransactionReceiptMonitoringCancelledError();

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => finish(() => reject(new TransactionReceiptMonitoringCancelledError()));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
