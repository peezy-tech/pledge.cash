import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assetPolicyAbi,
  boardroomAbi,
  boardroomPolicyRegistryAbi,
  boardroomTokenAbi,
  distributionFactoryAbi,
  erc20Abi,
  lockedLiquidityFactoryAbi,
  tokenGrantFactoryAbi
} from "@pledge.cash/sdk";

import type { AnalyzeActionInput } from "./analyze";
import { ANALYSIS_INSTRUCTIONS, INPUT_FILENAME, INSTRUCTIONS_FILENAME } from "./prompt";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export type PreparedAnalysisWorkspace = {
  readonly abiExcerptsPath: string;
  readonly docsDir: string;
  readonly inputPath: string;
  readonly instructionsPath: string;
  readonly workspaceDir: string;
};

export type PrepareAnalysisWorkspaceOptions = {
  readonly baseDir: string;
};

export async function prepareAnalysisWorkspace(
  input: AnalyzeActionInput,
  options: PrepareAnalysisWorkspaceOptions
): Promise<PreparedAnalysisWorkspace> {
  const workspaceDir = join(options.baseDir, workspaceName(input));
  const docsDir = join(workspaceDir, "docs");
  const inputPath = join(workspaceDir, INPUT_FILENAME);
  const instructionsPath = join(workspaceDir, INSTRUCTIONS_FILENAME);
  const abiExcerptsPath = join(docsDir, "abi-excerpts.json");

  await rm(workspaceDir, { force: true, recursive: true });
  await mkdir(docsDir, { recursive: true });
  await Promise.all([
    writeFile(inputPath, `${JSON.stringify(toWorkspaceInput(input), jsonReplacer, 2)}\n`),
    writeFile(instructionsPath, ANALYSIS_INSTRUCTIONS),
    writeFile(abiExcerptsPath, `${JSON.stringify(abiExcerpts(), null, 2)}\n`),
    copyProtocolDoc(join(docsDir, "boardroom-protocol.md"))
  ]);

  return { abiExcerptsPath, docsDir, inputPath, instructionsPath, workspaceDir };
}

export async function cleanupAnalysisWorkspace(workspaceDir: string): Promise<void> {
  await rm(workspaceDir, { force: true, recursive: true });
}

function workspaceName(input: AnalyzeActionInput): string {
  return `${input.action.chainId}-${input.action.actionHash}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function toWorkspaceInput(input: AnalyzeActionInput): unknown {
  return {
    action: input.action,
    boardroom: input.boardroom ?? null,
    calls: input.calls,
    harness: input.harness ?? null,
    risk: {
      findings: input.risk.findings,
      rulesetVersion: input.risk.rulesetVersion,
      severity: input.risk.severity
    }
  };
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

async function copyProtocolDoc(targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(join(repoRoot, "docs/boardroom-protocol.md"), targetPath);
}

type AbiItem = {
  readonly name?: string;
  readonly type?: string;
};

function abiExcerpts(): Record<string, readonly unknown[]> {
  return {
    AssetPolicy: selectAbi(assetPolicyAbi, ["canCall", "setApprovalSpenderAllowed", "setAssetAllowed"]),
    Boardroom: selectAbi(boardroomAbi, [
      "BoardroomActionCancelled",
      "BoardroomActionExecuted",
      "BoardroomActionQueued",
      "BoardroomLaunched",
      "BoardroomRedemptionsOpened",
      "ExecutorSet",
      "RedeemableAssetRegistered",
      "RedemptionAssetClaimFailed",
      "RedemptionAssetClaimed",
      "SharesRedeemed",
      "cancelAction",
      "claimRedemptionAsset",
      "execute",
      "executeBatch",
      "executeQueuedAction",
      "executeQueuedBatch",
      "mint",
      "queueAction",
      "queueBatch",
      "redeem",
      "registerRedeemableAsset",
      "setExecutor",
      "startWindDown"
    ]),
    BoardroomPolicyRegistry: selectAbi(boardroomPolicyRegistryAbi, [
      "ModulePolicyRegistered",
      "isModulePolicy",
      "isPolicyAllowed",
      "registerModulePolicy",
      "setPolicyAllowed",
      "setPolicyStatus"
    ]),
    BoardroomToken: selectAbi(boardroomTokenAbi, ["approve", "burn", "mint", "transfer", "transferFrom"]),
    DistributionFactory: selectAbi(distributionFactoryAbi, [
      "createFixedPriceSale",
      "createMerkleAirdrop",
      "createMigratingBondingCurve",
      "isDistribution",
      "pruneClosedDistributions"
    ]),
    ERC20: selectAbi(erc20Abi, ["approve", "transfer", "transferFrom"]),
    LockedLiquidityFactory: selectAbi(lockedLiquidityFactoryAbi, ["createLockedLiquidityForBoardroom"]),
    TokenGrantFactory: selectAbi(tokenGrantFactoryAbi, [
      "createGrant",
      "createGrantFromDistribution",
      "setCreationFee",
      "transferOwnership"
    ])
  };
}

function selectAbi(abi: readonly unknown[], names: readonly string[]): readonly unknown[] {
  const allowed = new Set(names);
  return abi.filter((item): boolean => {
    const abiItem = item as AbiItem;
    return abiItem.name !== undefined && allowed.has(abiItem.name);
  });
}
