import {
  assetPolicyAbi,
  boardroomAbi,
  boardroomControllerAbi,
  boardroomPolicyRegistryAbi,
  erc20Abi,
  migratingBondingCurveAbi,
  pledgeV4LiquidityFactoryAbi,
  pledgeV4LiquidityVaultAbi
} from "@pledge.cash/sdk";
import { toFunctionSelector, type Abi, type AbiFunction, type Hex } from "viem";

import type { Severity } from "../types";

export const RULESET_VERSION = 8;

export type RiskRuleId =
  | "controller-configuration"
  | "controller-replacement"
  | "mint-shares"
  | "redemption-excess-recipient"
  | "external-approve"
  | "policy-admin"
  | "unknown-selector"
  | "undecoded-operation"
  | "create-protocol-liquidity"
  | "add-protocol-liquidity"
  | "close-protocol-liquidity"
  | "claim-protocol-liquidity-fees"
  | "release-protocol-liquidity-claims"
  | "remove-protocol-liquidity"
  | "cancel-bonding-curve"
  | "register-redeemable-asset"
  | "begin-snapshot"
  | "open-redemptions"
  | "burn-treasury-shares"
  | "wrap-native";

export type RiskRuleTarget =
  | "action"
  | "asset-policy"
  | "boardroom"
  | "controller"
  | "external"
  | "bonding-curve"
  | "liquidity-factory"
  | "liquidity-vault"
  | "policy-registry";

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
    beginSnapshot: selector(boardroomAbi, "beginSnapshot", ["bytes32"]),
    burnTreasuryShares: selector(boardroomAbi, "burnTreasuryShares", ["bytes32"]),
    mint: selector(boardroomAbi, "mint", ["bytes32", "address", "uint256"]),
    openRedemptions: selector(boardroomAbi, "openRedemptions", ["bytes32"]),
    registerRedeemableAsset: selector(boardroomAbi, "registerRedeemableAsset", ["bytes32", "address"]),
    replaceController: selector(boardroomAbi, "replaceController", [
      "bytes32",
      "address",
      "address",
      "address",
      "uint64",
      "uint64",
      "uint64"
    ]),
    setRedemptionExcessRecipient: selector(boardroomAbi, "setRedemptionExcessRecipient", [
      "bytes32",
      "address"
    ]),
    wrapNativeBalance: selector(boardroomAbi, "wrapNativeBalance", ["bytes32"])
  },
  controller: {
    updateConfiguration: selector(boardroomControllerAbi, "updateConfiguration", ["address", "uint64", "uint64"])
  },
  erc20: {
    approve: selector(erc20Abi, "approve", ["address", "uint256"])
  },
  liquidityFactory: {
    addProtocolLiquidity: selector(pledgeV4LiquidityFactoryAbi, "addProtocolLiquidity", ["tuple"]),
    closeProtocolLiquidity: selector(pledgeV4LiquidityFactoryAbi, "closeProtocolLiquidity", []),
    createProtocolLiquidity: selector(pledgeV4LiquidityFactoryAbi, "createProtocolLiquidity", ["tuple"]),
    removeProtocolLiquidity: selector(pledgeV4LiquidityFactoryAbi, "removeProtocolLiquidity", ["tuple"])
  },
  liquidityVault: {
    claimFees: selector(pledgeV4LiquidityVaultAbi, "claimFees", [])
  },
  protocolLiquidityBoardroom: {
    closeAfterWindDown: selector(boardroomAbi, "closeProtocolLiquidityAfterWindDown", ["bytes32"]),
    exit: selector(boardroomAbi, "exitProtocolLiquidity", ["bytes32", "uint256", "uint256", "uint256"]),
    returnClaims: selector(boardroomAbi, "returnProtocolLiquidityClaims", ["bytes32"])
  },
  bondingCurve: {
    cancel: selector(migratingBondingCurveAbi, "cancel", [])
  },
  policyRegistry: {
    registerModulePolicy: selector(boardroomPolicyRegistryAbi, "registerModulePolicy", ["address"]),
    setPolicyAllowed: selector(boardroomPolicyRegistryAbi, "setPolicyAllowed", ["address", "bool"]),
    setPolicyStatus: selector(boardroomPolicyRegistryAbi, "setPolicyStatus", ["address", "uint8"])
  }
} as const;

export const RISK_MATRIX = [
  {
    detail: "Changes the controller proposer, delay, or grace period through delayed controller self-governance.",
    id: "controller-configuration",
    selector: SELECTORS.controller.updateConfiguration,
    severity: "high",
    target: "controller"
  },
  {
    detail: "Atomically deploys and adopts the next Boardroom controller generation.",
    id: "controller-replacement",
    selector: SELECTORS.boardroom.replaceController,
    severity: "high",
    target: "boardroom"
  },
  {
    detail: "Mints new Boardroom shares and can dilute existing shareholders.",
    id: "mint-shares",
    selector: SELECTORS.boardroom.mint,
    severity: "high",
    target: "boardroom"
  },
  {
    detail: "Changes the recipient of redemption assets left after holder claims.",
    id: "redemption-excess-recipient",
    selector: SELECTORS.boardroom.setRedemptionExcessRecipient,
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
    detail: "Changes global policy permissions outside an individual Boardroom controller delay.",
    id: "policy-admin",
    selector: SELECTORS.policyRegistry.registerModulePolicy,
    severity: "high",
    target: "policy-registry"
  },
  {
    detail: "Changes global policy permissions outside an individual Boardroom controller delay.",
    id: "policy-admin",
    selector: SELECTORS.policyRegistry.setPolicyAllowed,
    severity: "high",
    target: "policy-registry"
  },
  {
    detail: "Changes global policy permissions outside an individual Boardroom controller delay.",
    id: "policy-admin",
    selector: SELECTORS.policyRegistry.setPolicyStatus,
    severity: "high",
    target: "policy-registry"
  },
  {
    detail: "Changes which assets the shared asset policy allows Boardrooms to touch.",
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
    detail: "Controller schedule calldata could not be decoded and must be treated as hostile.",
    id: "undecoded-operation",
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
    detail: "Creates the canonical pledge.cash vault and Uniswap v4 PoolId for permanent protocol liquidity.",
    id: "create-protocol-liquidity",
    selector: SELECTORS.liquidityFactory.createProtocolLiquidity,
    severity: "high",
    target: "liquidity-factory"
  },
  {
    detail: "Adds Boardroom assets to the canonical full-range Uniswap v4 position.",
    id: "add-protocol-liquidity",
    selector: SELECTORS.liquidityFactory.addProtocolLiquidity,
    severity: "medium",
    target: "liquidity-factory"
  },
  {
    detail: "Explicitly and irreversibly closes an empty canonical protocol-liquidity position.",
    id: "close-protocol-liquidity",
    selector: SELECTORS.liquidityFactory.closeProtocolLiquidity,
    severity: "medium",
    target: "liquidity-factory"
  },
  {
    detail: "Removes some or all protocol-owned Uniswap v4 liquidity back to the Boardroom.",
    id: "remove-protocol-liquidity",
    selector: SELECTORS.liquidityFactory.removeProtocolLiquidity,
    severity: "medium",
    target: "liquidity-factory"
  },
  {
    detail: "Collects the canonical v4 position fees, forwarding 95% to the Boardroom and 5% to the protocol recipient.",
    id: "claim-protocol-liquidity-fees",
    selector: SELECTORS.liquidityVault.claimFees,
    severity: "low",
    target: "liquidity-vault"
  },
  {
    detail: "Releases the protocol-owned P4LP claims to the Boardroom during wind-down without immediately removing the position.",
    id: "release-protocol-liquidity-claims",
    selector: SELECTORS.protocolLiquidityBoardroom.returnClaims,
    severity: "medium",
    target: "boardroom"
  },
  {
    detail: "Exits the protocol-owned Uniswap v4 position to the Boardroom during wind-down.",
    id: "remove-protocol-liquidity",
    selector: SELECTORS.protocolLiquidityBoardroom.exit,
    severity: "medium",
    target: "boardroom"
  },
  {
    detail: "Closes an empty protocol-liquidity vault after wind-down.",
    id: "close-protocol-liquidity",
    selector: SELECTORS.protocolLiquidityBoardroom.closeAfterWindDown,
    severity: "medium",
    target: "boardroom"
  },
  {
    detail: "Cancels the singleton primary sale into its bounded sell-only unwind.",
    id: "cancel-bonding-curve",
    selector: SELECTORS.bondingCurve.cancel,
    severity: "high",
    target: "bonding-curve"
  },
  {
    detail: "Registers an asset as redeemable by shareholders.",
    id: "register-redeemable-asset",
    selector: SELECTORS.boardroom.registerRedeemableAsset,
    severity: "medium",
    target: "boardroom"
  },
  {
    detail: "Freezes redemption accounting and begins paginated asset snapshotting.",
    id: "begin-snapshot",
    selector: SELECTORS.boardroom.beginSnapshot,
    severity: "medium",
    target: "boardroom"
  },
  {
    detail: "Irreversibly opens shareholder redemptions after snapshot completion.",
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
    detail: "Wraps the Boardroom native-token balance into the configured wrapped native asset.",
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
