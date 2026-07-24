import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

import { X402_MINIMUM_SAFE_HL_VERSION } from "./constants";

export interface X402ReleaseSafety {
  readonly installedVersion: string;
  readonly minimumSafeVersion: typeof X402_MINIMUM_SAFE_HL_VERSION;
  readonly fundedSettlementEnabled: boolean;
  readonly reason?: string;
}

export class UnsafeX402RuntimeError extends Error {
  readonly code = "unsafe_x402_hl_runtime";
  readonly installedVersion: string;
  readonly minimumSafeVersion = X402_MINIMUM_SAFE_HL_VERSION;

  constructor(installedVersion: string) {
    super(
      `Funded x402 settlement is disabled: x402-hl@${installedVersion} does not satisfy >=${X402_MINIMUM_SAFE_HL_VERSION}`
    );
    this.name = "UnsafeX402RuntimeError";
    this.installedVersion = installedVersion;
  }
}

interface ParsedStableVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export function assessX402HlRelease(installedVersion: string): X402ReleaseSafety {
  const installed = parseStableVersion(installedVersion);
  const minimum = parseStableVersion(X402_MINIMUM_SAFE_HL_VERSION);
  const fundedSettlementEnabled = installed !== undefined && compareVersions(installed, minimum!) >= 0;

  return {
    installedVersion,
    minimumSafeVersion: X402_MINIMUM_SAFE_HL_VERSION,
    fundedSettlementEnabled,
    ...(fundedSettlementEnabled
      ? {}
      : {
          reason: `x402-hl@${installedVersion} is construction/test-only; funded settlement requires >=${X402_MINIMUM_SAFE_HL_VERSION}`
        })
  };
}

export function assertFundedX402SettlementEnabled(safety: X402ReleaseSafety): void {
  if (!safety.fundedSettlementEnabled) {
    throw new UnsafeX402RuntimeError(safety.installedVersion);
  }
}

export function detectInstalledX402HlVersion(): string {
  const entry = fileURLToPath(import.meta.resolve("x402-hl"));
  let current = dirname(entry);
  const root = parse(current).root;

  while (current !== root) {
    const packageJsonPath = join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        readonly name?: unknown;
        readonly version?: unknown;
      };
      if (parsed.name === "x402-hl" && typeof parsed.version === "string") {
        return parsed.version;
      }
    }
    current = dirname(current);
  }

  throw new Error(`Unable to locate the x402-hl package metadata from ${entry}`);
}

function parseStableVersion(value: string): ParsedStableVersion | undefined {
  // Prereleases deliberately fail closed. npm's normal >= range matching does
  // not include prereleases unless they are explicitly requested.
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function compareVersions(left: ParsedStableVersion, right: ParsedStableVersion): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}
