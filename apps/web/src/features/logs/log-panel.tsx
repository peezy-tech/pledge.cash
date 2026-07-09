import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Panel, TransactionLink } from "../../components/shell";
import { Button } from "../../components/ui/button";
import type { LogEntry } from "../../lib/types";

type LogPanelProps = {
  logs: LogEntry[];
  clearLogs: () => void;
};

export function LogPanel({ logs, clearLogs }: LogPanelProps): React.JSX.Element {
  const hasLogEntries = logs.length > 0;

  return (
    <Panel title="Log" action={<Button variant="ghost" size="sm" onClick={clearLogs}>Clear</Button>}>
      <div className="max-h-[320px] overflow-auto border-t border-zinc-800">
        {hasLogEntries ? <LogList logs={logs} /> : <EmptyLogState />}
      </div>
    </Panel>
  );
}

function EmptyLogState(): React.JSX.Element {
  return <p className="m-0 p-4 text-sm text-zinc-500">No entries</p>;
}

function LogList({ logs }: { logs: LogEntry[] }): React.JSX.Element {
  return (
    <ol className="grid gap-px bg-zinc-800">
      {logs.map((entry) => (
        <LogListItem entry={entry} key={entry.id} />
      ))}
    </ol>
  );
}

function LogListItem({ entry }: { entry: LogEntry }): React.JSX.Element {
  const hasTransactionLink = Boolean(entry.txHash);

  return (
    <li className="bg-zinc-950 p-3">
      <LogMetadata entry={entry} />
      <p className="m-0 break-words text-sm text-zinc-200">{entry.message}</p>
      {hasTransactionLink ? <TransactionMetadata entry={entry} /> : null}
    </li>
  );
}

function LogMetadata({ entry }: { entry: LogEntry }): React.JSX.Element {
  return (
    <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
      <LogLevelIcon level={entry.level} />
      <span>{entry.time}</span>
    </div>
  );
}

function LogLevelIcon({ level }: { level: LogEntry["level"] }): React.JSX.Element | null {
  if (level === "error") {
    return <AlertTriangle className="h-3.5 w-3.5 text-red-300" />;
  }

  if (level === "success") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-lime-300" />;
  }

  return null;
}

function TransactionMetadata({ entry }: { entry: LogEntry }): React.JSX.Element | null {
  if (!entry.txHash) return null;

  return (
    <p className="m-0 mt-1 text-xs text-zinc-500">
      Explorer: <TransactionLink chainId={entry.txChainId} hash={entry.txHash} />
    </p>
  );
}
