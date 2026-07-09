import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

import type { Config, HarnessName } from "../config";
import { createClaudeHarnessAdapter } from "./harnesses/claude";
import { createCodexHarnessAdapter } from "./harnesses/codex";

export type HarnessRequest = {
  readonly prompt: string;
  readonly timeoutMs: number;
  readonly workspaceDir: string;
};

export type HarnessResponse =
  | { readonly harness: string; readonly model?: string; readonly ok: true; readonly outputPath: string }
  | { readonly detail: string; readonly ok: false; readonly reason: "error" | "timeout" | "no-output" };

export interface HarnessAdapter {
  readonly harness: string;
  run(req: HarnessRequest): Promise<HarnessResponse>;
}

export function createHarnessAdapter(config: Config): HarnessAdapter | undefined {
  if (config.harness.name === "none") {
    return undefined;
  }

  const command = config.harness.cmd ?? defaultHarnessCommand(config.harness.name);
  if (!commandExists(command)) {
    return undefined;
  }

  if (config.harness.name === "claude") {
    return createClaudeHarnessAdapter({ command, model: config.harness.model });
  }

  return createCodexHarnessAdapter({ command, model: config.harness.model });
}

function defaultHarnessCommand(name: Exclude<HarnessName, "none">): string {
  return name;
}

function commandExists(command: string): boolean {
  if (command.includes("/") || command.startsWith(".")) {
    return canExecute(command);
  }

  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter((pathEntry) => pathEntry.length > 0)
    .some((pathEntry) => canExecute(join(pathEntry, command)));
}

function canExecute(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
