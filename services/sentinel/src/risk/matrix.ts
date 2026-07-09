import {
  assetPolicyAbi,
  boardroomAbi,
  boardroomPolicyRegistryAbi,
  erc20Abi
} from "@pledge.cash/sdk";
import { toFunctionSelector, type Abi, type AbiFunction, type Hex } from "viem";

import type { Severity } from "../types";

export const RULESET_VERSION = 1;

export type RiskRuleId =
  | "set-executor"
  | "mint-shares"
  | "external-approve"
  | "policy-admin"
  | "unknown-selector"
  | "undecoded-action"
  | "exit-locked-liquidity"
  | "register-redeemable-asset"
  | "open-redemptions"
  | "burn-treasury-shares"
  | "wrap-native";

export type RiskRuleTarget = "action" | "asset-policy" | "boardroom" | "external" | "policy-registry";

export type RiskRuleDefinition = {
  readonly detail: string;
  readonly id: RiskRuleId;
  readonly selector?: Hex;
  readonly severity: Severity;
  readonly target: RiskRuleTarget;
};

export const SELECTORS = {
  assetPolicy: {
    setApprovalSpenderAllowed: selector(assetPolicyAbi, "setApprovalSpenderAllowed", ["address", "bool"]),
    setAssetAllowed: selector(assetPolicyAbi, "setAssetAllowed", ["address", "bool"])
  },
  boardroom: {
    burnTreasuryShares: selector(boardroomAbi, "burnTreasuryShares", []),
    exitLockedLiquidity: selector(boardroomAbi, "exitLockedLiquidity", [
      "address",
      "uint256",
      "uint256",
      "uint256"
    ]),
    mint: selector(boardroomAbi, "mint", ["address", "uint256"]),
    openRedemptions: selector(boardroomAbi, "openRedemptions", []),
    registerRedeemableAsset: selector(boardroomAbi, "registerRedeemableAsset", ["address"]),
    setExecutor: selector(boardroomAbi, "setExecutor", ["address"]),
    wrapNativeBalance: selector(boardroomAbi, "wrapNativeBalance", [])
  },
  erc20: {
    approve: selector(erc20Abi, "approve", ["address", "uint256"])
  },
  policyRegistry: {
    setPolicyAllowed: selector(boardroomPolicyRegistryAbi, "setPolicyAllowed", ["address", "bool"]),
    setPolicyStatus: selector(boardroomPolicyRegistryAbi, "setPolicyStatus", ["address", "uint8"])
  }
} as const;

export const RISK_MATRIX = [
  {
    detail: "Changes the boardroom executor that can queue and execute governed actions.",
    id: "set-executor",
    selector: SELECTORS.boardroom.setExecutor,
    severity: "high",
    target: "boardroom"
  },
  {
    detail: "Mints new boardroom shares and can dilute existing shareholders.",
    id: "mint-shares",
    selector: SELECTORS.boardroom.mint,
    severity: "high",
    target: "boardroom"
  },
  {
    detail: "Approves an external spender through a policy-mediated asset call.",
    id: "external-approve",
    selector: SELECTORS.erc20.approve,
    severity: "high",
    target: "external"
  },
  {
    detail: "Changes the global policy registry immediately, outside the boardroom veto queue.",
    id: "policy-admin",
    selector: SELECTORS.policyRegistry.setPolicyAllowed,
    severity: "high",
    target: "policy-registry"
  },
  {
    detail: "Changes the global policy registry immediately, outside the boardroom veto queue.",
    id: "policy-admin",
    selector: SELECTORS.policyRegistry.setPolicyStatus,
    severity: "high",
    target: "policy-registry"
  },
  {
    detail: "Changes which assets the shared asset policy allows boardrooms to touch.",
    id: "policy-admin",
    selector: SELECTORS.assetPolicy.setAssetAllowed,
    severity: "high",
    target: "asset-policy"
  },
  {
    detail: "Changes which spenders the shared asset policy allows for approvals.",
    id: "policy-admin",
    selector: SELECTORS.assetPolicy.setApprovalSpenderAllowed,
    severity: "high",
    target: "asset-policy"
  },
  {
    detail: "Queue calldata could not be decoded and must be treated as hostile.",
    id: "undecoded-action",
    severity: "high",
    target: "action"
  },
  {
    detail: "Calls an unknown function selector, so Sentinel treats it as suspicious by default.",
    id: "unknown-selector",
    severity: "high",
    target: "action"
  },
  {
    detail: "Exits a locked liquidity position during wind-down.",
    id: "exit-locked-liquidity",
    selector: SELECTORS.boardroom.exitLockedLiquidity,
    severity: "medium",
    target: "boardroom"
  },
  {
    detail: "Registers an asset as redeemable by shareholders.",
    id: "register-redeemable-asset",
    selector: SELECTORS.boardroom.registerRedeemableAsset,
    severity: "medium",
    target: "boardroom"
  },
  {
    detail: "Irreversibly opens shareholder redemptions.",
    id: "open-redemptions",
    selector: SELECTORS.boardroom.openRedemptions,
    severity: "medium",
    target: "boardroom"
  },
  {
    detail: "Burns treasury-held shares during wind-down accounting.",
    id: "burn-treasury-shares",
    selector: SELECTORS.boardroom.burnTreasuryShares,
    severity: "low",
    target: "boardroom"
  },
  {
    detail: "Wraps the boardroom native-token balance into the configured wrapped native asset.",
    id: "wrap-native",
    selector: SELECTORS.boardroom.wrapNativeBalance,
    severity: "low",
    target: "boardroom"
  }
] as const satisfies readonly RiskRuleDefinition[];

function selector(abi: Abi, name: string, inputTypes: readonly string[]): Hex {
  const item = abi.find((entry): entry is AbiFunction => {
    if (entry.type !== "function" || entry.name !== name) return false;
    if (entry.inputs.length !== inputTypes.length) return false;
    return entry.inputs.every((input, index) => input.type === inputTypes[index]);
  });

  if (!item) {
    throw new Error(`Missing generated ABI function ${name}(${inputTypes.join(",")})`);
  }

  return toFunctionSelector(item);
}
