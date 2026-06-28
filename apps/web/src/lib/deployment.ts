import type { PledgeCashDeployment } from "@pledge.cash/sdk";

export function deploymentText(deployment: PledgeCashDeployment | undefined): string {
  if (!deployment) return "{}";
  return JSON.stringify(deployment, (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2);
}
