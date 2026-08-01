import { boardroomAbi, pledgeV4LiquidityFactoryAbi } from "@pledge.cash/sdk";
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
  readonly bondingCurve?: AddressString | string;
  readonly controller?: AddressString | string;
  readonly decodeStatus: DecodeStatus;
  readonly distributionFactory?: AddressString | string;
  readonly evaluatedAt?: Date;
  readonly liquidityVault?: AddressString | string;
  readonly pledgeV4LiquidityFactory?: AddressString | string;
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
      detail: "The operation did not contain any decoded calls for Sentinel to classify.",
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
  const targetIsController = sameAddress(call.target, ctx.controller);
  const canonicalLiquidityFactoryCall =
    sameAddress(call.policy, ctx.pledgeV4LiquidityFactory) && sameAddress(call.target, ctx.pledgeV4LiquidityFactory);

  if (targetIsController && selector === SELECTORS.controller.updateConfiguration) {
    findings.push(
      callFinding(
        call,
        "controller-configuration",
        "high",
        "Changes the proposer, delay, or grace period and advances the controller configuration epoch."
      )
    );
  }

  if (targetIsBoardroom && selector === SELECTORS.boardroom.replaceController) {
    findings.push(
      callFinding(
        call,
        "controller-replacement",
        "high",
        "Deploys and adopts the next controller generation in one delayed Boardroom self-call."
      )
    );
  }

  if (targetIsBoardroom && selector === SELECTORS.boardroom.mint) {
    findings.push(callFinding(call, "mint-shares", "high", "Mints new voting shares and dilutes holders."));
  }

  if (targetIsBoardroom && selector === SELECTORS.boardroom.setRedemptionExcessRecipient) {
    findings.push(
      callFinding(
        call,
        "redemption-excess-recipient",
        "high",
        "Changes who receives redemption assets left after holder claims."
      )
    );
  }

  if (!isZeroAddress(call.policy) && selector === SELECTORS.erc20.approve) {
    findings.push(
      callFinding(call, "external-approve", "high", "Approves a policy-mediated external spender for an asset.")
    );
  }

  if (isPolicyAdminCall(call, ctx, selector)) {
    findings.push(
      callFinding(
        call,
        "policy-admin",
        "high",
        "Changes global policy permissions outside an individual Boardroom controller delay."
      )
    );
  }

  if (canonicalLiquidityFactoryCall && selector === SELECTORS.liquidityFactory.createProtocolLiquidity) {
    findings.push(
      callFinding(
        call,
        "create-protocol-liquidity",
        "high",
        "Creates the canonical pledge.cash vault and Uniswap v4 PoolId for protocol liquidity."
      )
    );
  }

  if (canonicalLiquidityFactoryCall && selector === SELECTORS.liquidityFactory.addProtocolLiquidity) {
    findings.push(
      callFinding(call, "add-protocol-liquidity", "medium", "Adds treasury assets to the canonical full-range Uniswap v4 position.")
    );
  }

  if (canonicalLiquidityFactoryCall && selector === SELECTORS.liquidityFactory.removeProtocolLiquidity) {
    const zeroMinOut = hasZeroExitMinOut(call);
    findings.push(
      callFinding(
        call,
        "remove-protocol-liquidity",
        zeroMinOut ? "high" : "medium",
        zeroMinOut
          ? "Removes protocol liquidity with a zero minimum output, allowing severe slippage."
          : "Removes protocol liquidity back to the Boardroom."
      )
    );
  }

  if (canonicalLiquidityFactoryCall && selector === SELECTORS.liquidityFactory.closeProtocolLiquidity) {
    findings.push(
      callFinding(call, "close-protocol-liquidity", "medium", "Irreversibly closes the empty canonical liquidity position.")
    );
  }

  if (
    sameAddress(call.policy, ctx.pledgeV4LiquidityFactory) &&
    sameAddress(call.target, ctx.liquidityVault) &&
    selector === SELECTORS.liquidityVault.claimFees
  ) {
    findings.push(
      callFinding(
        call,
        "claim-protocol-liquidity-fees",
        "low",
        "Collects v4 position fees, forwarding 95% to the Boardroom and 5% to the protocol recipient."
      )
    );
  }

  if (targetIsBoardroom && selector === SELECTORS.protocolLiquidityBoardroom.exit) {
    const zeroMinOut = hasZeroExitMinOut(call);
    findings.push(
      callFinding(
        call,
        "remove-protocol-liquidity",
        zeroMinOut ? "high" : "medium",
        zeroMinOut
          ? "Exits protocol liquidity during wind-down with a zero minimum output, allowing severe slippage."
          : "Exits the protocol-owned Uniswap v4 position to the Boardroom during wind-down."
      )
    );
  }

  if (targetIsBoardroom && selector === SELECTORS.protocolLiquidityBoardroom.returnClaims) {
    findings.push(
      callFinding(
        call,
        "release-protocol-liquidity-claims",
        "medium",
        "Releases the protocol-owned P4LP claims to the Boardroom during wind-down."
      )
    );
  }

  if (targetIsBoardroom && selector === SELECTORS.protocolLiquidityBoardroom.closeAfterWindDown) {
    findings.push(
      callFinding(call, "close-protocol-liquidity", "medium", "Closes an empty protocol-liquidity vault after wind-down.")
    );
  }

  if (
    sameAddress(call.policy, ctx.distributionFactory) &&
    sameAddress(call.target, ctx.bondingCurve) &&
    selector === SELECTORS.bondingCurve.cancel
  ) {
    findings.push(
      callFinding(
        call,
        "cancel-bonding-curve",
        "high",
        "Cancels the singleton primary sale into its bounded sell-only unwind."
      )
    );
  }

  if (targetIsBoardroom && selector === SELECTORS.boardroom.registerRedeemableAsset) {
    findings.push(
      callFinding(call, "register-redeemable-asset", "medium", "Registers an asset for shareholder redemption.")
    );
  }

  if (targetIsBoardroom && selector === SELECTORS.boardroom.beginSnapshot) {
    findings.push(
      callFinding(call, "begin-snapshot", "medium", "Freezes redemption accounting and starts snapshotting.")
    );
  }

  if (targetIsBoardroom && selector === SELECTORS.boardroom.openRedemptions) {
    findings.push(
      callFinding(
        call,
        "open-redemptions",
        "medium",
        "Irreversibly opens shareholder redemptions after snapshot completion."
      )
    );
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
  if (
    selector === SELECTORS.policyRegistry.registerModulePolicy ||
    selector === SELECTORS.policyRegistry.setPolicyAllowed ||
    selector === SELECTORS.policyRegistry.setPolicyStatus
  ) {
    return ctx.policyRegistry === undefined || sameAddress(call.target, ctx.policyRegistry);
  }

  if (selector === SELECTORS.assetPolicy.setAssetAllowed || selector === SELECTORS.assetPolicy.setApprovalSpenderAllowed) {
    return ctx.assetPolicy === undefined || sameAddress(call.target, ctx.assetPolicy);
  }

  return false;
}

function hasZeroExitMinOut(call: StoredCall): boolean {
  const decoded = decodeProtocolLiquidityExit(call.data);
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

function decodeProtocolLiquidityExit(data: string): { amountAMin: bigint; amountBMin: bigint } | undefined {
  if (!isHex(data)) return undefined;

  try {
    const decoded = decodeFunctionData({ abi: [...pledgeV4LiquidityFactoryAbi, ...boardroomAbi], data });
    if (decoded.functionName === "removeProtocolLiquidity") {
      const [params] = decoded.args;
      return { amountAMin: params.amountAMin, amountBMin: params.amountBMin };
    }
    if (decoded.functionName === "exitProtocolLiquidity") {
      const [, amountAMin, amountBMin] = decoded.args;
      return { amountAMin, amountBMin };
    }
    return undefined;
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
    detail: ruleDetail("undecoded-operation"),
    ruleId: "undecoded-operation",
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
