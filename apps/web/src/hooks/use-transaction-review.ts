import { useCallback, useEffect, useRef, useState } from "react";
import type { ContractCallReview } from "../lib/transaction-preview";

export class TransactionReviewCancelledError extends Error {
  constructor() {
    super("Transaction review cancelled.");
    this.name = "TransactionReviewCancelledError";
  }
}

type ReviewResolver = {
  reject: (error: Error) => void;
  resolve: () => void;
};

export function useTransactionReview(): {
  approveReview: () => void;
  cancelReview: () => void;
  requestReview: (review: ContractCallReview) => Promise<void>;
  review: ContractCallReview | undefined;
} {
  const [review, setReview] = useState<ContractCallReview>();
  const resolverRef = useRef<ReviewResolver | undefined>(undefined);

  const finish = useCallback((outcome: "approve" | "cancel"): void => {
    const resolver = resolverRef.current;
    resolverRef.current = undefined;
    setReview(undefined);
    if (!resolver) return;
    if (outcome === "approve") resolver.resolve();
    else resolver.reject(new TransactionReviewCancelledError());
  }, []);

  const approveReview = useCallback((): void => finish("approve"), [finish]);
  const cancelReview = useCallback((): void => finish("cancel"), [finish]);

  const requestReview = useCallback(async (nextReview: ContractCallReview): Promise<void> => {
    if (resolverRef.current) {
      resolverRef.current.reject(new TransactionReviewCancelledError());
    }
    setReview(nextReview);
    await new Promise<void>((resolve, reject) => {
      resolverRef.current = { reject, resolve };
    });
  }, []);

  useEffect(() => () => {
    resolverRef.current?.reject(new TransactionReviewCancelledError());
    resolverRef.current = undefined;
  }, []);

  return { approveReview, cancelReview, requestReview, review };
}
