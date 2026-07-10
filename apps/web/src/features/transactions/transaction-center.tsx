import { CheckCircle2, ChevronDown, CircleAlert, Clock3, Loader2, ReceiptText, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { transactionUrl } from "../../lib/contracts";
import { shortAddress } from "../../lib/forms";
import type { ContractCallReview } from "../../lib/transaction-preview";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";

export type TransactionStage =
  | "review"
  | "simulating"
  | "awaiting-signature"
  | "submitted"
  | "confirmed"
  | "failed"
  | "cancelled";

export type TransactionRecord = {
  id: string;
  chainId: number;
  createdAt: string;
  error?: string | undefined;
  functionName: string;
  hash?: Hex | undefined;
  label: string;
  stage: TransactionStage;
  target: Address | "unknown";
};

type StoredTransactions = Record<string, TransactionRecord[]>;

const STORAGE_KEY = "pledge.cash.transactions.v1";
const MAX_RECORDS = 24;

export function useTransactionCenter(chainId: number, account?: Address): {
  records: TransactionRecord[];
  startTransaction: (review: ContractCallReview) => string;
  updateTransaction: (id: string, update: Partial<Pick<TransactionRecord, "error" | "hash" | "stage">>) => void;
  clearSettled: () => void;
} {
  const identity = transactionIdentity(chainId, account);
  const [records, setRecords] = useState<TransactionRecord[]>(() => recoverInterruptedTransactions(readStoredTransactions()[identity] ?? []));
  const [loadedIdentity, setLoadedIdentity] = useState(identity);

  useEffect(() => {
    setRecords(recoverInterruptedTransactions(readStoredTransactions()[identity] ?? []));
    setLoadedIdentity(identity);
  }, [identity]);

  useEffect(() => {
    if (typeof window === "undefined" || loadedIdentity !== identity) return;
    const stored = readStoredTransactions();
    stored[identity] = records.slice(0, MAX_RECORDS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }, [identity, loadedIdentity, records]);

  const startTransaction = useCallback((review: ContractCallReview): string => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const nextRecord: TransactionRecord = {
      id,
      chainId,
      createdAt: new Date().toISOString(),
      functionName: review.functionName,
      label: review.label,
      stage: "review",
      target: review.target,
    };
    setRecords((current) => [nextRecord, ...current].slice(0, MAX_RECORDS));
    return id;
  }, [chainId]);

  const updateTransaction = useCallback((id: string, update: Partial<Pick<TransactionRecord, "error" | "hash" | "stage">>): void => {
    setRecords((current) => current.map((record) => record.id === id ? { ...record, ...update } : record));
  }, []);

  const clearSettled = useCallback((): void => {
    setRecords((current) => current.filter((record) => !isSettledStage(record.stage)));
  }, []);

  return {
    records: loadedIdentity === identity ? records : [],
    startTransaction,
    updateTransaction,
    clearSettled,
  };
}

export function recoverInterruptedTransactions(records: readonly TransactionRecord[]): TransactionRecord[] {
  return records.map((record) => {
    if (record.stage === "review" || record.stage === "simulating" || record.stage === "awaiting-signature") {
      return {
        ...record,
        error: "This transaction was interrupted before submission. Review and start it again.",
        stage: "failed",
      };
    }
    if (record.stage === "submitted" && !record.hash) {
      return {
        ...record,
        error: "This submitted transaction has no receipt hash and cannot be resumed.",
        stage: "failed",
      };
    }
    return record;
  });
}

export function TransactionTray({
  records,
  clearSettled,
}: {
  records: TransactionRecord[];
  clearSettled: () => void;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const active = useMemo(() => records.filter((record) => !isSettledStage(record.stage)), [records]);
  const recent = records.slice(0, 5);

  if (records.length === 0) return null;

  const latest = records[0];
  if (!latest) return null;

  return (
    <aside
      aria-label="Transaction activity"
      className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 ml-auto max-w-[420px] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950/96 shadow-2xl shadow-black/50 backdrop-blur md:bottom-5 md:right-5 md:left-auto md:w-[390px]"
    >
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <StageIcon stage={latest.stage} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-zinc-100">{latest.label}</span>
          <span className="block text-xs text-zinc-400" aria-live="polite">{stageLabel(latest.stage)}</span>
        </span>
        {active.length > 1 ? <span className="text-xs text-zinc-500">{active.length} active</span> : null}
        <ChevronDown className={cn("h-4 w-4 text-zinc-500 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="border-t border-zinc-800">
          <ol className="m-0 max-h-72 list-none overflow-y-auto p-0">
            {recent.map((record) => <TransactionRow key={record.id} record={record} />)}
          </ol>
          {records.some((record) => isSettledStage(record.stage)) ? (
            <div className="flex justify-end border-t border-zinc-800 px-3 py-2">
              <Button size="sm" variant="ghost" onClick={clearSettled}>
                <X className="h-3.5 w-3.5" />
                Clear finished
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function TransactionRow({ record }: { record: TransactionRecord }): React.JSX.Element {
  const explorer = record.hash ? transactionUrl(record.hash, record.chainId) : undefined;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-b border-zinc-800 px-4 py-3 last:border-b-0">
      <StageIcon stage={record.stage} />
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <span className="truncate text-sm font-medium text-zinc-100">{record.label}</span>
          <span className="shrink-0 text-[11px] text-zinc-500">{relativeTime(record.createdAt)}</span>
        </div>
        <p className={cn("m-0 mt-1 text-xs", record.stage === "failed" ? "text-red-300" : "text-zinc-500")}>
          {record.error ?? stageLabel(record.stage)}
        </p>
        {record.hash ? (
          explorer ? (
            <a className="mt-1 inline-block text-xs text-lime-200 hover:text-lime-100" href={explorer} rel="noreferrer" target="_blank">
              Receipt {shortAddress(record.hash)}
            </a>
          ) : <span className="mt-1 block text-xs text-zinc-500">Receipt {shortAddress(record.hash)}</span>
        ) : null}
      </div>
    </li>
  );
}

function StageIcon({ stage }: { stage: TransactionStage }): React.JSX.Element {
  if (stage === "confirmed") return <CheckCircle2 className="mt-0.5 h-4 w-4 text-teal-300" aria-hidden="true" />;
  if (stage === "failed") return <CircleAlert className="mt-0.5 h-4 w-4 text-red-300" aria-hidden="true" />;
  if (stage === "cancelled") return <X className="mt-0.5 h-4 w-4 text-zinc-500" aria-hidden="true" />;
  if (stage === "submitted") return <ReceiptText className="mt-0.5 h-4 w-4 text-sky-300" aria-hidden="true" />;
  if (stage === "review") return <Clock3 className="mt-0.5 h-4 w-4 text-amber-300" aria-hidden="true" />;
  return <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-lime-300" aria-hidden="true" />;
}

export function stageLabel(stage: TransactionStage): string {
  switch (stage) {
    case "review": return "Waiting for your review";
    case "simulating": return "Checking the transaction onchain";
    case "awaiting-signature": return "Waiting for wallet signature";
    case "submitted": return "Submitted — waiting for confirmation";
    case "confirmed": return "Confirmed onchain";
    case "failed": return "Needs attention";
    case "cancelled": return "Cancelled";
  }
}

function transactionIdentity(chainId: number, account?: Address): string {
  return `${chainId.toString()}:${account?.toLowerCase() ?? "read-only"}`;
}

function isSettledStage(stage: TransactionStage): boolean {
  return stage === "confirmed" || stage === "failed" || stage === "cancelled";
}

function readStoredTransactions(): StoredTransactions {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" ? parsed as StoredTransactions : {};
  } catch {
    return {};
  }
}

function relativeTime(iso: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(iso));
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000).toString()}m`;
  return `${Math.floor(elapsed / 3_600_000).toString()}h`;
}
