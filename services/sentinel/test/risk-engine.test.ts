import { describe, expect, test } from "bun:test";
import {
  assetPolicyAbi,
  boardroomAbi,
  boardroomControllerAbi,
  boardroomPolicyRegistryAbi,
  erc20Abi,
  lockedLiquidityAbi,
  lockedLiquidityFactoryAbi,
  migratingBondingCurveAbi
} from "@pledge.cash/sdk";
import { encodeFunctionData, type Address, type Hex } from "viem";

import { evaluateAction, type RiskContext } from "../src/risk/engine";
import { RISK_MATRIX, RULESET_VERSION, type RiskRuleId } from "../src/risk/matrix";
import type { RiskAssessment, Severity, StoredCall } from "../src/types";

const actionId = "00000000-0000-0000-0000-000000000001";
const boardroom = "0x0000000000000000000000000000000000000b0a" as Address;
const controller = "0x0000000000000000000000000000000000000e0a" as Address;
const nextController = "0x0000000000000000000000000000000000000e0b" as Address;
const holder = "0x0000000000000000000000000000000000000123" as Address;
const policy = "0x0000000000000000000000000000000000000a55" as Address;
const token = "0x0000000000000000000000000000000000000aaa" as Address;
const spender = "0x0000000000000000000000000000000000000b0b" as Address;
const policyRegistry = "0x0000000000000000000000000000000000000c01" as Address;
const assetPolicy = "0x0000000000000000000000000000000000000a50" as Address;
const distributionFactory = "0x0000000000000000000000000000000000000d15" as Address;
const lockedLiquidityFactory = "0x00000000000000000000000000000000000010cc" as Address;
const bondingCurve = "0x000000000000000000000000000000000000c011" as Address;
const liquidityLocker = "0x00000000000000000000000000000000000010c0" as Address;
const zeroAddress = "0x0000000000000000000000000000000000000000" as Address;

const ctx = {
  actionId,
  assetPolicy,
  boardroom,
  bondingCurve,
  controller,
  decodeStatus: "decoded",
  distributionFactory,
  liquidityLocker,
  lockedLiquidityFactory,
  policyRegistry
} satisfies RiskContext;

describe("risk matrix", () => {
  test("declares ruleset version 6 and canonical scheduled-market rule ids", () => {
    expect(RULESET_VERSION).toBe(6);
    expect(new Set(RISK_MATRIX.map((rule) => rule.id))).toEqual(
      new Set<RiskRuleId>([
        "controller-configuration",
        "controller-replacement",
        "mint-shares",
        "redemption-excess-recipient",
        "external-approve",
        "policy-admin",
        "unknown-selector",
        "undecoded-operation",
        "create-protocol-liquidity",
        "add-protocol-liquidity",
        "close-protocol-liquidity",
        "claim-protocol-liquidity-fees",
        "remove-protocol-liquidity",
        "cancel-bonding-curve",
        "register-redeemable-asset",
        "begin-snapshot",
        "open-redemptions",
        "burn-treasury-shares",
        "wrap-native"
      ])
    );

    expect(RISK_MATRIX.find((rule) => rule.id === "controller-configuration")?.detail).toBe(
      "Changes the controller proposer, delay, or grace period through delayed controller self-governance."
    );
  });
});

describe("evaluateAction", () => {
  const ruleCases = [
    {
      call: storedCall({
        data: encodeFunctionData({
          abi: boardroomControllerAbi,
          functionName: "updateConfiguration",
          args: [holder, 86_400n, 604_800n]
        }),
        target: controller
      }),
      ruleId: "controller-configuration",
      severity: "high"
    },
    {
      call: storedCall({
        data: encodeFunctionData({
          abi: boardroomAbi,
          functionName: "replaceController",
          args: [controller, nextController, holder, 86_400n, 604_800n, 2n]
        })
      }),
      ruleId: "controller-replacement",
      severity: "high"
    },
    {
      call: storedCall({
        data: encodeFunctionData({
          abi: boardroomAbi,
          functionName: "setRedemptionExcessRecipient",
          args: [holder]
        })
      }),
      ruleId: "redemption-excess-recipient",
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
        data: encodeFunctionData({ abi: boardroomAbi, functionName: "beginSnapshot" })
      }),
      ruleId: "begin-snapshot",
      severity: "medium"
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
          functionName: "registerModulePolicy",
          args: [policy]
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

  test("classifies undecoded operations as high even without calls", () => {
    const assessment = evaluateAction([], { ...ctx, decodeStatus: "undecoded" });

    expect(assessment.severity).toBe("high");
    expectFinding(assessment, "undecoded-operation", "high", null);
  });

  test("classifies canonical liquidity create, add, remove, close, and fee-claim calls", () => {
    const create = evaluateAction([storedCall({
      data: encodeFunctionData({
        abi: lockedLiquidityFactoryAbi,
        functionName: "createLockedLiquidity",
        args: [{
          tokenA: token,
          tokenB: holder,
          amountADesired: 10n,
          amountBDesired: 20n,
          amountAMin: 9n,
          amountBMin: 19n,
          deadline: 9_999n,
          salt: `0x${"01".repeat(32)}`
        }]
      }),
      policy: lockedLiquidityFactory,
      target: lockedLiquidityFactory
    })], ctx);
    expectFinding(create, "create-protocol-liquidity", "high", 0);

    const add = evaluateAction([storedCall({
      data: encodeFunctionData({
        abi: lockedLiquidityFactoryAbi,
        functionName: "addLockedLiquidity",
        args: [{
          tokenA: token,
          tokenB: holder,
          amountADesired: 10n,
          amountBDesired: 20n,
          amountAMin: 9n,
          amountBMin: 19n,
          deadline: 9_999n
        }]
      }),
      policy: lockedLiquidityFactory,
      target: lockedLiquidityFactory
    })], ctx);
    expectFinding(add, "add-protocol-liquidity", "medium", 0);

    const remove = evaluateAction([storedCall({
      data: encodeFunctionData({
        abi: lockedLiquidityFactoryAbi,
        functionName: "removeLockedLiquidity",
        args: [{ liquidity: 10n, amountAMin: 9n, amountBMin: 19n, deadline: 9_999n }]
      }),
      policy: lockedLiquidityFactory,
      target: lockedLiquidityFactory
    })], ctx);
    expectFinding(remove, "remove-protocol-liquidity", "medium", 0);

    const unsafeRemove = evaluateAction([storedCall({
      data: encodeFunctionData({
        abi: lockedLiquidityFactoryAbi,
        functionName: "removeLockedLiquidity",
        args: [{ liquidity: 10n, amountAMin: 0n, amountBMin: 19n, deadline: 9_999n }]
      }),
      policy: lockedLiquidityFactory,
      target: lockedLiquidityFactory
    })], ctx);
    expectFinding(unsafeRemove, "remove-protocol-liquidity", "high", 0);

    const close = evaluateAction([storedCall({
      data: encodeFunctionData({ abi: lockedLiquidityFactoryAbi, functionName: "closeLockedLiquidity" }),
      policy: lockedLiquidityFactory,
      target: lockedLiquidityFactory
    })], ctx);
    expectFinding(close, "close-protocol-liquidity", "medium", 0);

    const claim = evaluateAction([storedCall({
      data: encodeFunctionData({ abi: lockedLiquidityAbi, functionName: "claimFees" }),
      policy: lockedLiquidityFactory,
      target: liquidityLocker
    })], ctx);
    expectFinding(claim, "claim-protocol-liquidity-fees", "low", 0);

    const cancel = evaluateAction([storedCall({
      data: encodeFunctionData({ abi: migratingBondingCurveAbi, functionName: "cancel" }),
      policy: distributionFactory,
      target: bondingCurve
    })], ctx);
    expectFinding(cancel, "cancel-bonding-curve", "high", 0);
  });

  test("fails closed on selector collisions and noncanonical market topology", () => {
    const cases = [
      storedCall({
        data: encodeFunctionData({ abi: migratingBondingCurveAbi, functionName: "cancel" }),
        policy: distributionFactory,
        target: token
      }),
      storedCall({
        data: encodeFunctionData({ abi: lockedLiquidityAbi, functionName: "claimFees" }),
        policy: lockedLiquidityFactory,
        target: token
      }),
      storedCall({
        data: encodeFunctionData({ abi: lockedLiquidityFactoryAbi, functionName: "closeLockedLiquidity" }),
        policy,
        target: lockedLiquidityFactory
      })
    ];
    for (const call of cases) {
      const assessment = evaluateAction([call], ctx);
      expectFinding(assessment, "unknown-selector", "high", 0);
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
        data: encodeFunctionData({
          abi: boardroomControllerAbi,
          functionName: "updateConfiguration",
          args: [holder, 86_400n, 604_800n]
        }),
        target: controller
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
