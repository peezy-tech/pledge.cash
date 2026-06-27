import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Panel } from "../../components/shell";
import { Button } from "../../components/ui/button";
import type { LogEntry } from "../../lib/types";

type LogPanelProps = {
  logs: LogEntry[];
  clearLogs: () => void;
};

export function LogPanel({ logs, clearLogs }: LogPanelProps): React.JSX.Element {
  return (
    <Panel title="Log" action={<Button variant="ghost" size="sm" onClick={clearLogs}>Clear</Button>}>
      <div className="max-h-[320px] overflow-auto border-t border-zinc-800">
        {logs.length === 0 ? (
          <p className="m-0 p-4 text-sm text-zinc-500">No entries</p>
        ) : (
          <ol className="grid gap-px bg-zinc-800">
            {logs.map((entry) => (
              <li className="bg-zinc-950 p-3" key={entry.id}>
                <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                  {entry.level === "error" ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-red-300" />
                  ) : entry.level === "success" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-lime-300" />
                  ) : null}
                  <span>{entry.time}</span>
                </div>
                <p className="m-0 break-words text-sm text-zinc-200">{entry.message}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}
