import { CheckCircle2, ChevronDown, CircleAlert, Clock3, Loader2, ReceiptText, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import type { AppRoute } from "../../app/routing";
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
  | "cancelled"
  | "replaced";

export type TransactionRecord = {
  id: string;
  chainId: number;
  createdAt: string;
  deploymentIdentity?: string | undefined;
  error?: string | undefined;
  functionName: string;
  hash?: Hex | undefined;
  label: string;
  refreshBlocked?: boolean | undefined;
  refreshPending?: boolean | undefined;
  refreshRoute?: AppRoute | undefined;
  replacementReason?: "cancelled" | "replaced" | "repriced" | undefined;
  stage: TransactionStage;
  submittedHash?: Hex | undefined;
  target: Address | "unknown";
};

export type TransactionUpdate = Partial<Pick<
  TransactionRecord,
  | "deploymentIdentity"
  | "error"
  | "hash"
  | "refreshBlocked"
  | "refreshPending"
  | "refreshRoute"
  | "replacementReason"
  | "stage"
  | "submittedHash"
>>;

export type StoredTransactions = Record<string, readonly TransactionRecord[]>;

const STORAGE_KEY = "pledge.cash.transactions.v1";
const MAX_RECORDS = 24;
const useCommittedLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useTransactionCenter(chainId: number, account?: Address): {
  records: TransactionRecord[];
  startTransaction: (review: ContractCallReview) => string;
  updateTransaction: (id: string, update: TransactionUpdate) => void;
  updateTransactionForIdentity: (chainId: number, account: Address | undefined, id: string, update: TransactionUpdate) => void;
  clearSettled: () => void;
} {
  const identity = transactionIdentity(chainId, account);
  const [records, setRecords] = useState<TransactionRecord[]>(() => recoverInterruptedTransactions(readStoredTransactions()[identity] ?? []));
  const [loadedIdentity, setLoadedIdentity] = useState(identity);
  const currentIdentityRef = useRef(identity);
  const loadedIdentityRef = useRef(loadedIdentity);
  const recordsRef = useRef(records);
  useCommittedLayoutEffect(() => {
    currentIdentityRef.current = identity;
    loadedIdentityRef.current = loadedIdentity;
    recordsRef.current = records;
  }, [identity, loadedIdentity, records]);

  useEffect(() => {
    const nextRecords = recoverInterruptedTransactions(readStoredTransactions()[identity] ?? []);
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    loadedIdentityRef.current = identity;
    setLoadedIdentity(identity);
  }, [identity]);

  useEffect(() => {
    if (loadedIdentity !== identity) return;
    writeTransactionRecords(identity, records);
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
    const current = loadedIdentityRef.current === identity
      ? recordsRef.current
      : recoverInterruptedTransactions(readStoredTransactions()[identity] ?? []);
    const next = [nextRecord, ...current].slice(0, MAX_RECORDS);
    recordsRef.current = next;
    setRecords(next);
    writeTransactionRecords(identity, next);
    return id;
  }, [chainId, identity]);

  const updateTransaction = useCallback((id: string, update: TransactionUpdate): void => {
    const targetIdentity = currentIdentityRef.current;
    const next = updateTransactionRecords(recordsRef.current, id, update);
    recordsRef.current = next;
    setRecords(next);
    if (loadedIdentityRef.current === targetIdentity) writeTransactionRecords(targetIdentity, next);
  }, []);

  const updateTransactionForIdentity = useCallback((
    targetChainId: number,
    targetAccount: Address | undefined,
    id: string,
    update: TransactionUpdate,
  ): void => {
    const targetIdentity = transactionIdentity(targetChainId, targetAccount);
    const stored = updateStoredTransactionsForIdentity(
      readStoredTransactions(),
      targetChainId,
      targetAccount,
      id,
      update,
    );
    writeStoredTransactions(stored);
    if (currentIdentityRef.current !== targetIdentity || loadedIdentityRef.current !== targetIdentity) return;
    const next = updateTransactionRecords(recordsRef.current, id, update);
    recordsRef.current = next;
    setRecords(next);
  }, []);

  const clearSettled = useCallback((): void => {
    const targetIdentity = currentIdentityRef.current;
    const next = clearSettledTransactions(recordsRef.current);
    recordsRef.current = next;
    setRecords(next);
    if (loadedIdentityRef.current === targetIdentity) writeTransactionRecords(targetIdentity, next);
  }, []);

  return {
    records: loadedIdentity === identity ? records : [],
    startTransaction,
    updateTransaction,
    updateTransactionForIdentity,
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
    if (record.stage === "submitted" && record.hash && !record.submittedHash) {
      return { ...record, submittedHash: record.hash };
    }
    return record;
  });
}

export function updateTransactionRecords(
  records: readonly TransactionRecord[],
  id: string,
  update: TransactionUpdate,
): TransactionRecord[] {
  return records.map((record) => record.id === id ? { ...record, ...update } : record);
}

export function updateStoredTransactionsForIdentity(
  stored: Readonly<Record<string, readonly TransactionRecord[]>>,
  chainId: number,
  account: Address | undefined,
  id: string,
  update: TransactionUpdate,
): StoredTransactions {
  const identity = transactionIdentity(chainId, account);
  return {
    ...stored,
    [identity]: updateTransactionRecords(stored[identity] ?? [], id, update).slice(0, MAX_RECORDS),
  };
}

export function clearSettledTransactions(records: readonly TransactionRecord[]): TransactionRecord[] {
  return records.filter((record) => !isSettledRecord(record));
}

export function TransactionTray({
  records,
  clearSettled,
}: {
  records: TransactionRecord[];
  clearSettled: () => void;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const active = useMemo(() => records.filter((record) => !isSettledRecord(record)), [records]);
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
        <StageIcon refreshBlocked={latest.refreshBlocked} refreshPending={latest.refreshPending} stage={latest.stage} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-zinc-100">{latest.label}</span>
          <span className="block text-xs text-zinc-400" aria-live="polite">{transactionStatusLabel(latest)}</span>
        </span>
        {active.length > 1 ? <span className="text-xs text-zinc-500">{active.length} active</span> : null}
        <ChevronDown className={cn("h-4 w-4 text-zinc-500 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="border-t border-zinc-800">
          <ol className="m-0 max-h-72 list-none overflow-y-auto p-0">
            {recent.map((record) => <TransactionRow key={record.id} record={record} />)}
          </ol>
          {records.some((record) => isSettledRecord(record)) ? (
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
      <StageIcon refreshBlocked={record.refreshBlocked} refreshPending={record.refreshPending} stage={record.stage} />
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <span className="truncate text-sm font-medium text-zinc-100">{record.label}</span>
          <span className="shrink-0 text-[11px] text-zinc-500">{relativeTime(record.createdAt)}</span>
        </div>
        <p className={cn("m-0 mt-1 text-xs", record.stage === "failed" ? "text-red-300" : "text-zinc-500")}>
          {record.error ?? transactionStatusLabel(record)}
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

function StageIcon({
  refreshBlocked,
  refreshPending,
  stage,
}: {
  refreshBlocked?: boolean | undefined;
  refreshPending?: boolean | undefined;
  stage: TransactionStage;
}): React.JSX.Element {
  if (stage === "confirmed" && refreshPending && !refreshBlocked) {
    return <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-teal-300" aria-hidden="true" />;
  }
  if (stage === "confirmed") return <CheckCircle2 className="mt-0.5 h-4 w-4 text-teal-300" aria-hidden="true" />;
  if (stage === "failed") return <CircleAlert className="mt-0.5 h-4 w-4 text-red-300" aria-hidden="true" />;
  if (stage === "cancelled") return <X className="mt-0.5 h-4 w-4 text-zinc-500" aria-hidden="true" />;
  if (stage === "replaced") return <RefreshCw className="mt-0.5 h-4 w-4 text-amber-300" aria-hidden="true" />;
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
    case "replaced": return "Replaced in wallet";
  }
}

export function transactionStatusLabel(record: Pick<TransactionRecord, "refreshBlocked" | "refreshPending" | "stage">): string {
  if (record.stage === "confirmed" && record.refreshPending) {
    return record.refreshBlocked
      ? "Confirmed — refresh waiting for the matching deployment"
      : "Confirmed — refreshing workspace data";
  }
  return stageLabel(record.stage);
}

export function transactionIdentity(chainId: number, account?: Address): string {
  return `${chainId.toString()}:${account?.toLowerCase() ?? "read-only"}`;
}

function isSettledRecord(record: Pick<TransactionRecord, "refreshBlocked" | "refreshPending" | "stage">): boolean {
  if (record.stage === "confirmed" && record.refreshPending && !record.refreshBlocked) return false;
  return record.stage === "confirmed"
    || record.stage === "failed"
    || record.stage === "cancelled"
    || record.stage === "replaced";
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

function writeTransactionRecords(identity: string, records: readonly TransactionRecord[]): void {
  const stored = readStoredTransactions();
  stored[identity] = records.slice(0, MAX_RECORDS);
  writeStoredTransactions(stored);
}

function writeStoredTransactions(stored: StoredTransactions): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Transaction persistence is best effort; in-memory tracking remains live.
  }
}

function relativeTime(iso: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(iso));
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000).toString()}m`;
  return `${Math.floor(elapsed / 3_600_000).toString()}h`;
}
