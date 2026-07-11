import type { Address, PledgeCashReadClient } from "@pledge.cash/sdk";
import { boardroomAbi } from "@pledge.cash/sdk";

export type GovernanceLaunchCheckPhase = "review" | "simulation" | "submission";

export async function assertGovernanceLaunchPrecondition(
  client: PledgeCashReadClient,
  boardroom: Address,
  expectedExecutor: Address,
  phase: GovernanceLaunchCheckPhase,
): Promise<void> {
  const [executor, launched] = await Promise.all([
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "executor" }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "launched" }),
  ]);

  if (launched) {
    throw new Error(`Governance was already launched before transaction ${phase}. Reload the project before continuing.`);
  }
  if (!sameAddress(executor, expectedExecutor)) {
    throw new Error(`The governance executor changed before transaction ${phase}. Reload and review the permanent launch again.`);
  }
}

function sameAddress(first: Address, second: Address): boolean {
  return first.toLowerCase() === second.toLowerCase();
}
