import { boardroomAbi } from "@pledge.cash/sdk";
import { decodeFunctionData, type Hex } from "viem";

import type { JsonValue } from "../db/schema";
import type { AddressString, DecodeStatus, RiskAssessment, RiskFinding, Severity, StoredCall } from "../types";
import { RISK_MATRIX, RULESET_VERSION, SELECTORS, type RiskRuleId } from "./matrix";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_EVALUATED_AT = new Date(0);
const SEVERITY_RANK = {
  low: 0,
  medium: 1,
  high: 2
} as const satisfies Record<Severity, number>;

export type RiskContext = {
  readonly actionId: string;
  readonly assetPolicy?: AddressString | string;
  readonly boardroom: AddressString | string;
  readonly decodeStatus: DecodeStatus;
  readonly evaluatedAt?: Date;
  readonly policyRegistry?: AddressString | string;
};

export function evaluateAction(calls: readonly StoredCall[], ctx: RiskContext): RiskAssessment {
  const findings: RiskFinding[] = [];

  if (ctx.decodeStatus === "undecoded") {
    if (calls.length === 0) {
      findings.push(undecodedFinding(null));
    } else {
      findings.push(...calls.map((call) => undecodedFinding(call.callIndex)));
    }
  }

  findings.push(...calls.flatMap((call) => evaluateCall(call, ctx)));

  if (findings.length === 0) {
    findings.push({
      callIndex: null,
      detail: "The action did not contain any decoded calls for Sentinel to classify.",
      ruleId: "unknown-selector",
      severity: "high"
    });
  }

  return {
    actionId: ctx.actionId,
    evaluatedAt: ctx.evaluatedAt ?? DEFAULT_EVALUATED_AT,
    findings,
    rulesetVersion: RULESET_VERSION,
    severity: maxSeverity(findings)
  };
}

function evaluateCall(call: StoredCall, ctx: RiskContext): RiskFinding[] {
  const findings: RiskFinding[] = [];
  const selector = selectorForCall(call);
  const targetIsBoardroom = sameAddress(call.target, ctx.boardroom);

  if (targetIsBoardroom && selector === SELECTORS.boardroom.setExecutor) {
    findings.push(callFinding(call, "set-executor", "high", "Changes the boardroom executor."));
  }

  if (targetIsBoardroom && selector === SELECTORS.boardroom.mint) {
    findings.push(callFinding(call, "mint-shares", "high", "Mints new voting shares and dilutes holders."));
  }

  if (!isZeroAddress(call.policy) && selector === SELECTORS.erc20.approve) {
    findings.push(
      callFinding(call, "external-approve", "high", "Approves a policy-mediated external spender for an asset.")
    );
  }

  if (isPolicyAdminCall(call, ctx, selector)) {
    findings.push(
      callFinding(call, "policy-admin", "high", "Changes global policy permissions outside the veto queue.")
    );
  }

  if (targetIsBoardroom && selector === SELECTORS.boardroom.exitLockedLiquidity) {
    const zeroMinOut = hasZeroExitMinOut(call);
    findings.push(
      callFinding(
        call,
        "exit-locked-liquidity",
        zeroMinOut ? "high" : "medium",
        zeroMinOut
          ? "Exits locked liquidity with a zero minimum output, allowing severe slippage."
          : "Exits a locked liquidity position during wind-down."
      )
    );
  }

  if (targetIsBoardroom && selector === SELECTORS.boardroom.registerRedeemableAsset) {
    findings.push(
      callFinding(call, "register-redeemable-asset", "medium", "Registers an asset for shareholder redemption.")
    );
  }

  if (targetIsBoardroom && selector === SELECTORS.boardroom.openRedemptions) {
    findings.push(callFinding(call, "open-redemptions", "medium", "Irreversibly opens shareholder redemptions."));
  }

  if (targetIsBoardroom && selector === SELECTORS.boardroom.burnTreasuryShares) {
    findings.push(callFinding(call, "burn-treasury-shares", "low", "Burns treasury-held shares."));
  }

  if (targetIsBoardroom && selector === SELECTORS.boardroom.wrapNativeBalance) {
    findings.push(callFinding(call, "wrap-native", "low", "Wraps the boardroom native-token balance."));
  }

  if (findings.length === 0) {
    findings.push(
      callFinding(
        call,
        "unknown-selector",
        "high",
        `No Sentinel risk rule matched selector ${selector ?? "unknown"}.`
      )
    );
  }

  return findings;
}

function isPolicyAdminCall(call: StoredCall, ctx: RiskContext, selector: Hex | undefined): boolean {
  if (selector === SELECTORS.policyRegistry.setPolicyAllowed || selector === SELECTORS.policyRegistry.setPolicyStatus) {
    return ctx.policyRegistry === undefined || sameAddress(call.target, ctx.policyRegistry);
  }

  if (selector === SELECTORS.assetPolicy.setAssetAllowed || selector === SELECTORS.assetPolicy.setApprovalSpenderAllowed) {
    return ctx.assetPolicy === undefined || sameAddress(call.target, ctx.assetPolicy);
  }

  return false;
}

function hasZeroExitMinOut(call: StoredCall): boolean {
  const decoded = decodeExitLockedLiquidity(call.data);
  if (decoded) {
    return decoded.amountAMin === 0n || decoded.amountBMin === 0n;
  }

  const args = call.decodedArgs;
  if (Array.isArray(args)) {
    return jsonBigInt(args[1]) === 0n || jsonBigInt(args[2]) === 0n;
  }

  if (isJsonRecord(args)) {
    return jsonBigInt(args.amountAMin) === 0n || jsonBigInt(args.amountBMin) === 0n;
  }

  return false;
}

function decodeExitLockedLiquidity(data: string): { amountAMin: bigint; amountBMin: bigint } | undefined {
  if (!isHex(data)) return undefined;

  try {
    const decoded = decodeFunctionData({
      abi: boardroomAbi,
      data
    });

    if (decoded.functionName !== "exitLockedLiquidity") return undefined;
    const [, amountAMin, amountBMin] = decoded.args;
    return { amountAMin, amountBMin };
  } catch {
    return undefined;
  }
}

function selectorForCall(call: StoredCall): Hex | undefined {
  return normalizedSelector(call.selector) ?? normalizedSelector(call.data.slice(0, 10));
}

function callFinding(call: StoredCall, ruleId: RiskRuleId, severity: Severity, detail: string): RiskFinding {
  return {
    callIndex: call.callIndex,
    detail,
    ruleId,
    severity
  };
}

function undecodedFinding(callIndex: number | null): RiskFinding {
  return {
    callIndex,
    detail: ruleDetail("undecoded-action"),
    ruleId: "undecoded-action",
    severity: "high"
  };
}

function ruleDetail(ruleId: RiskRuleId): string {
  return RISK_MATRIX.find((rule) => rule.id === ruleId)?.detail ?? "Sentinel risk rule matched.";
}

function maxSeverity(findings: readonly RiskFinding[]): Severity {
  return findings.reduce<Severity>(
    (max, finding) => (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[max] ? finding.severity : max),
    "low"
  );
}

function sameAddress(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizedAddress(left);
  const normalizedRight = normalizedAddress(right);
  return normalizedLeft !== undefined && normalizedLeft === normalizedRight;
}

function isZeroAddress(address: string): boolean {
  return normalizedAddress(address) === ZERO_ADDRESS;
}

function normalizedAddress(address: string | undefined): string | undefined {
  const lowered = address?.toLowerCase();
  return lowered && /^0x[0-9a-f]{40}$/.test(lowered) ? lowered : undefined;
}

function normalizedSelector(value: string): Hex | undefined {
  const lowered = value.toLowerCase();
  return /^0x[0-9a-f]{8}$/.test(lowered) ? (lowered as Hex) : undefined;
}

function isHex(value: string): value is Hex {
  return /^0x([0-9a-f][0-9a-f])*$/i.test(value);
}

function isJsonRecord(value: JsonValue | null): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonBigInt(value: JsonValue | undefined): bigint | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }

  return undefined;
}
