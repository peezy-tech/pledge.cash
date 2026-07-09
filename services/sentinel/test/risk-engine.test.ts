import { describe, expect, test } from "bun:test";
import {
  assetPolicyAbi,
  boardroomAbi,
  boardroomPolicyRegistryAbi,
  erc20Abi
} from "@pledge.cash/sdk";
import { encodeFunctionData, type Address, type Hex } from "viem";

import { evaluateAction, type RiskContext } from "../src/risk/engine";
import { RISK_MATRIX, RULESET_VERSION, type RiskRuleId } from "../src/risk/matrix";
import type { RiskAssessment, Severity, StoredCall } from "../src/types";

const actionId = "00000000-0000-0000-0000-000000000001";
const boardroom = "0x0000000000000000000000000000000000000b0a" as Address;
const executor = "0x0000000000000000000000000000000000000e0a" as Address;
const holder = "0x0000000000000000000000000000000000000123" as Address;
const policy = "0x0000000000000000000000000000000000000a55" as Address;
const token = "0x0000000000000000000000000000000000000aaa" as Address;
const spender = "0x0000000000000000000000000000000000000b0b" as Address;
const locker = "0x00000000000000000000000000000000000010cc" as Address;
const policyRegistry = "0x0000000000000000000000000000000000000c01" as Address;
const assetPolicy = "0x0000000000000000000000000000000000000a50" as Address;
const zeroAddress = "0x0000000000000000000000000000000000000000" as Address;

const ctx = {
  actionId,
  assetPolicy,
  boardroom,
  decodeStatus: "decoded",
  policyRegistry
} satisfies RiskContext;

describe("risk matrix", () => {
  test("declares ruleset version 1 and all WP3 rule ids", () => {
    expect(RULESET_VERSION).toBe(1);
    expect(new Set(RISK_MATRIX.map((rule) => rule.id))).toEqual(
      new Set<RiskRuleId>([
        "set-executor",
        "mint-shares",
        "external-approve",
        "policy-admin",
        "unknown-selector",
        "undecoded-action",
        "exit-locked-liquidity",
        "register-redeemable-asset",
        "open-redemptions",
        "burn-treasury-shares",
        "wrap-native"
      ])
    );
  });
});

describe("evaluateAction", () => {
  const ruleCases = [
    {
      call: storedCall({
        data: encodeFunctionData({ abi: boardroomAbi, functionName: "setExecutor", args: [executor] })
      }),
      ruleId: "set-executor",
      severity: "high"
    },
    {
      call: storedCall({
        data: encodeFunctionData({ abi: boardroomAbi, functionName: "mint", args: [holder, 1_000n] })
      }),
      ruleId: "mint-shares",
      severity: "high"
    },
    {
      call: storedCall({
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, 1_000n] }),
        policy,
        target: token
      }),
      ruleId: "external-approve",
      severity: "high"
    },
    {
      call: storedCall({
        data: encodeFunctionData({
          abi: boardroomPolicyRegistryAbi,
          functionName: "setPolicyAllowed",
          args: [policy, true]
        }),
        target: policyRegistry
      }),
      ruleId: "policy-admin",
      severity: "high"
    },
    {
      call: storedCall({
        data: encodeFunctionData({
          abi: boardroomPolicyRegistryAbi,
          functionName: "setPolicyStatus",
          args: [policy, 1]
        }),
        target: policyRegistry
      }),
      ruleId: "policy-admin",
      severity: "high"
    },
    {
      call: storedCall({
        data: encodeFunctionData({
          abi: assetPolicyAbi,
          functionName: "setAssetAllowed",
          args: [token, true]
        }),
        target: assetPolicy
      }),
      ruleId: "policy-admin",
      severity: "high"
    },
    {
      call: storedCall({
        data: encodeFunctionData({
          abi: assetPolicyAbi,
          functionName: "setApprovalSpenderAllowed",
          args: [spender, true]
        }),
        target: assetPolicy
      }),
      ruleId: "policy-admin",
      severity: "high"
    },
    {
      call: storedCall({
        data: encodeFunctionData({
          abi: boardroomAbi,
          functionName: "registerRedeemableAsset",
          args: [token]
        })
      }),
      ruleId: "register-redeemable-asset",
      severity: "medium"
    },
    {
      call: storedCall({
        data: encodeFunctionData({ abi: boardroomAbi, functionName: "openRedemptions" })
      }),
      ruleId: "open-redemptions",
      severity: "medium"
    },
    {
      call: storedCall({
        data: encodeFunctionData({ abi: boardroomAbi, functionName: "burnTreasuryShares" })
      }),
      ruleId: "burn-treasury-shares",
      severity: "low"
    },
    {
      call: storedCall({
        data: encodeFunctionData({ abi: boardroomAbi, functionName: "wrapNativeBalance" })
      }),
      ruleId: "wrap-native",
      severity: "low"
    }
  ] as const;

  for (const { call, ruleId, severity } of ruleCases) {
    test(`classifies ${ruleId} as ${severity}`, () => {
      const assessment = evaluateAction([call], ctx);

      expect(assessment.rulesetVersion).toBe(RULESET_VERSION);
      expect(assessment.severity).toBe(severity);
      expectFinding(assessment, ruleId, severity, 0);
    });
  }

  test("classifies unknown selectors as high", () => {
    const assessment = evaluateAction([storedCall({ data: "0x12345678", target: token })], ctx);

    expect(assessment.severity).toBe("high");
    expectFinding(assessment, "unknown-selector", "high", 0);
  });

  test("classifies undecoded actions as high even without calls", () => {
    const assessment = evaluateAction([], { ...ctx, decodeStatus: "undecoded" });

    expect(assessment.severity).toBe("high");
    expectFinding(assessment, "undecoded-action", "high", null);
  });

  test("keeps exitLockedLiquidity medium when min-out args are nonzero", () => {
    const assessment = evaluateAction(
      [
        storedCall({
          data: encodeFunctionData({
            abi: boardroomAbi,
            functionName: "exitLockedLiquidity",
            args: [locker, 1n, 2n, 9_999n]
          })
        })
      ],
      ctx
    );

    expect(assessment.severity).toBe("medium");
    expectFinding(assessment, "exit-locked-liquidity", "medium", 0);
  });

  test("escalates exitLockedLiquidity to high when either min-out arg is zero", () => {
    for (const args of [
      [locker, 0n, 2n, 9_999n],
      [locker, 1n, 0n, 9_999n]
    ] as const) {
      const assessment = evaluateAction(
        [
          storedCall({
            data: encodeFunctionData({
              abi: boardroomAbi,
              functionName: "exitLockedLiquidity",
              args
            })
          })
        ],
        ctx
      );

      expect(assessment.severity).toBe("high");
      expectFinding(assessment, "exit-locked-liquidity", "high", 0);
    }
  });

  test("uses max severity across a batch and gives every call a finding", () => {
    const calls = [
      storedCall({
        callIndex: 0,
        data: encodeFunctionData({ abi: boardroomAbi, functionName: "burnTreasuryShares" })
      }),
      storedCall({
        callIndex: 1,
        data: encodeFunctionData({ abi: boardroomAbi, functionName: "openRedemptions" })
      }),
      storedCall({
        callIndex: 2,
        data: encodeFunctionData({ abi: boardroomAbi, functionName: "setExecutor", args: [executor] })
      })
    ];

    const assessment = evaluateAction(calls, ctx);

    expect(assessment.severity).toBe("high");
    expect(assessment.findings.map((finding) => finding.callIndex).sort()).toEqual([0, 1, 2]);
  });

  test("does not classify zero-policy ERC20 approve as the external-approve rule", () => {
    const assessment = evaluateAction(
      [
        storedCall({
          data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, 1_000n] }),
          policy: zeroAddress,
          target: token
        })
      ],
      ctx
    );

    expect(assessment.severity).toBe("high");
    expectFinding(assessment, "unknown-selector", "high", 0);
    expect(assessment.findings.some((finding) => finding.ruleId === "external-approve")).toBe(false);
  });
});

function storedCall(input: {
  readonly callIndex?: number;
  readonly data: Hex;
  readonly decodedArgs?: StoredCall["decodedArgs"];
  readonly policy?: Address;
  readonly selector?: Hex;
  readonly target?: Address;
}): StoredCall {
  return {
    actionId,
    callIndex: input.callIndex ?? 0,
    data: input.data,
    decodedArgs: input.decodedArgs ?? null,
    decodedFunction: null,
    policy: input.policy ?? zeroAddress,
    selector: input.selector ?? (input.data.slice(0, 10) as Hex),
    target: input.target ?? boardroom,
    value: "0"
  };
}

function expectFinding(
  assessment: RiskAssessment,
  ruleId: RiskRuleId,
  severity: Severity,
  callIndex: number | null
): void {
  const finding = assessment.findings.find(
    (candidate) => candidate.ruleId === ruleId && candidate.callIndex === callIndex
  );

  expect(finding).toBeDefined();
  expect(finding?.severity).toBe(severity);
}
