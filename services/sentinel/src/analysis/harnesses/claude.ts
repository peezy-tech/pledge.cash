import { existsSync } from "node:fs";
import { join } from "node:path";

import type { HarnessAdapter, HarnessRequest, HarnessResponse } from "../adapter";
import { ANALYSIS_FILENAME } from "../prompt";

type BunSubprocess = {
  readonly exited: Promise<number>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  kill(signal?: string): void;
};

type BunRuntime = {
  spawn(
    args: readonly string[],
    options: {
      readonly cwd: string;
      readonly env?: Record<string, string | undefined>;
      readonly stderr: "pipe";
      readonly stdin: "ignore";
      readonly stdout: "pipe";
    }
  ): BunSubprocess;
};

export type ClaudeHarnessOptions = {
  readonly command: string;
  readonly model: string | undefined;
};

export function createClaudeHarnessAdapter(options: ClaudeHarnessOptions): HarnessAdapter {
  return new ClaudeHarnessAdapter(options);
}

class ClaudeHarnessAdapter implements HarnessAdapter {
  readonly harness = "claude";

  constructor(private readonly options: ClaudeHarnessOptions) {}

  async run(req: HarnessRequest): Promise<HarnessResponse> {
    const bun = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;
    if (bun === undefined) {
      return { detail: "Bun runtime is unavailable.", ok: false, reason: "error" };
    }

    const outputPath = join(req.workspaceDir, ANALYSIS_FILENAME);
    const args = [
      this.options.command,
      "-p",
      req.prompt,
      "--allowedTools",
      "Read,Write",
      "--disallowedTools",
      "Bash,WebFetch,WebSearch"
    ];
    if (this.options.model !== undefined) {
      args.push("--model", this.options.model);
    }

    return runProcess({
      args,
      cwd: req.workspaceDir,
      harness: this.harness,
      model: this.options.model,
      outputPath,
      timeoutMs: req.timeoutMs,
      bun
    });
  }
}

type RunProcessInput = {
  readonly args: readonly string[];
  readonly bun: BunRuntime;
  readonly cwd: string;
  readonly harness: string;
  readonly model: string | undefined;
  readonly outputPath: string;
  readonly timeoutMs: number;
};

async function runProcess(input: RunProcessInput): Promise<HarnessResponse> {
  let timedOut = false;

  try {
    const proc = input.bun.spawn(input.args, {
      cwd: input.cwd,
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe"
    });

    const stdout = streamToText(proc.stdout);
    const stderr = streamToText(proc.stderr);
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, input.timeoutMs);

    const exitCode = await proc.exited;
    clearTimeout(timer);
    const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);

    if (timedOut) {
      return { detail: detailText(stdoutText, stderrText), ok: false, reason: "timeout" };
    }

    if (exitCode !== 0) {
      return {
        detail: detailText(stdoutText, stderrText) || `Harness exited with code ${exitCode}.`,
        ok: false,
        reason: "error"
      };
    }

    if (!existsSync(input.outputPath)) {
      return { detail: detailText(stdoutText, stderrText), ok: false, reason: "no-output" };
    }

    return withOptionalModel(
      { harness: input.harness, ok: true, outputPath: input.outputPath },
      input.model
    );
  } catch (error) {
    return { detail: error instanceof Error ? error.message : String(error), ok: false, reason: "error" };
  }
}

async function streamToText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

function detailText(stdout: string, stderr: string): string {
  return [stderr.trim(), stdout.trim()].filter((part) => part.length > 0).join("\n");
}

function withOptionalModel(
  response: { readonly harness: string; readonly ok: true; readonly outputPath: string },
  model: string | undefined
): HarnessResponse {
  return model === undefined ? response : { ...response, model };
}
