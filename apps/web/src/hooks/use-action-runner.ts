import { useCallback, useState } from "react";
import type { Hex } from "viem";
import { errorMessage } from "../lib/forms";
import type { LogEntry } from "../lib/types";

export type PushLog = (message: string, level?: LogEntry["level"], txHash?: Hex, txChainId?: number) => void;

export function useActionRunner(): {
  clearLogs: () => void;
  logs: LogEntry[];
  pendingAction: string | undefined;
  pushLog: PushLog;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
} {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pendingAction, setPendingAction] = useState<string>();

  const pushLog = useCallback<PushLog>((message, level = "info", txHash, txChainId) => {
    const entry = {
      id: `${Date.now()}-${Math.random()}`,
      level,
      message,
      time: new Date().toISOString().replace(".000Z", "Z"),
      ...(txHash ? { txHash } : {}),
      ...(txHash && txChainId !== undefined ? { txChainId } : {}),
    };
    setLogs((current) => [entry, ...current].slice(0, 80));
  }, []);

  const runAction = useCallback(
    async (label: string, action: () => Promise<void>): Promise<void> => {
      setPendingAction(label);
      try {
        await action();
      } catch (error) {
        pushLog(errorMessage(error), "error");
      } finally {
        setPendingAction(undefined);
      }
    },
    [pushLog],
  );

  const clearLogs = useCallback((): void => setLogs([]), []);

  return { clearLogs, logs, pendingAction, pushLog, runAction };
}
