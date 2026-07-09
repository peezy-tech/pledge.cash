import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Hex } from "viem";
import { errorMessage } from "../lib/forms";
import type { LogEntry } from "../lib/types";

export type PushLog = (message: string, level?: LogEntry["level"], txHash?: Hex, txChainId?: number) => void;

const MAX_LOG_ENTRIES = 80;

export function useActionRunner(): {
  clearLogs: () => void;
  logs: LogEntry[];
  pendingAction: string | undefined;
  pushLog: PushLog;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
} {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pendingAction, setPendingAction] = useState<string>();
  const pendingActionRef = useRef<string | undefined>(undefined);

  const pushLog = useCallback<PushLog>((message, level = "info", txHash, txChainId) => {
    setLogs((current) =>
      [createLogEntry(message, level, txHash, txChainId), ...current].slice(0, MAX_LOG_ENTRIES),
    );
  }, []);

  const runAction = useCallback(
    async (label: string, action: () => Promise<void>): Promise<void> => {
      const activeAction = pendingActionRef.current;
      if (activeAction) {
        pushLog(`Wait for ${activeAction} to finish before starting ${label}.`, "error");
        return;
      }

      startAction(label, pendingActionRef, setPendingAction);
      try {
        await action();
      } catch (error) {
        pushLog(errorMessage(error), "error");
      } finally {
        finishAction(label, pendingActionRef, setPendingAction);
      }
    },
    [pushLog],
  );

  const clearLogs = useCallback((): void => setLogs([]), []);

  return { clearLogs, logs, pendingAction, pushLog, runAction };
}

function createLogEntry(
  message: string,
  level: LogEntry["level"],
  txHash: Hex | undefined,
  txChainId: number | undefined,
): LogEntry {
  return {
    id: `${Date.now()}-${Math.random()}`,
    level,
    message,
    time: new Date().toISOString().replace(".000Z", "Z"),
    ...(txHash ? { txHash } : {}),
    ...(txHash && txChainId !== undefined ? { txChainId } : {}),
  };
}

function startAction(
  label: string,
  pendingActionRef: MutableRefObject<string | undefined>,
  setPendingAction: Dispatch<SetStateAction<string | undefined>>,
): void {
  pendingActionRef.current = label;
  setPendingAction(label);
}

function finishAction(
  label: string,
  pendingActionRef: MutableRefObject<string | undefined>,
  setPendingAction: Dispatch<SetStateAction<string | undefined>>,
): void {
  if (pendingActionRef.current !== label) return;

  pendingActionRef.current = undefined;
  setPendingAction(undefined);
}
