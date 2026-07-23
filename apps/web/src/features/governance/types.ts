import type { Address } from "@pledge.cash/sdk";
import type { ProjectCapabilityMap } from "../capabilities/project-capabilities";

export type GovernanceTransactionRequest = Record<string, unknown>;

export type GovernanceSubmitTransaction = (
  label: string,
  request: GovernanceTransactionRequest,
) => Promise<unknown>;

export type GovernanceRunAction = (
  actionId: string,
  action: () => Promise<void>,
) => Promise<void>;

export type GovernanceOperationCapabilities = Pick<
  ProjectCapabilityMap,
  "governance.executeReady" | "governance.veto"
>;

export type GovernanceLaunchCapabilities = Pick<
  ProjectCapabilityMap,
  "governance.launch"
>;

export type GovernanceControlContext = {
  account?: Address | undefined;
  pendingAction: string | undefined;
  runAction: GovernanceRunAction;
  submitTransaction: GovernanceSubmitTransaction;
};
