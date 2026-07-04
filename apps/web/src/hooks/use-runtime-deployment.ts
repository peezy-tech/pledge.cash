import type { PledgeCashDeployment } from "@pledge.cash/sdk";
import { useEffect, useState } from "react";
import { parseDeployment } from "../lib/deployment";

type RuntimeDeploymentState = {
  chainId: number;
  deployment: PledgeCashDeployment | undefined;
};

export function useRuntimeDeployment(
  chainId: number,
  generatedDeployment: PledgeCashDeployment | undefined,
): PledgeCashDeployment | undefined {
  const [runtimeDeploymentState, setRuntimeDeploymentState] = useState<RuntimeDeploymentState>(() => ({
    chainId,
    deployment: generatedDeployment,
  }));

  useEffect(() => {
    let cancelled = false;
    setRuntimeDeploymentState({ chainId, deployment: generatedDeployment });

    async function loadRuntimeDeployment(): Promise<void> {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}deployments/${chainId}.json`, {
          cache: "no-store",
        });
        if (!response.ok) return;

        const raw = await response.text();
        const nextDeployment = parseDeployment(raw);
        if (!cancelled && isRuntimeDeploymentForChain(nextDeployment, chainId)) {
          setRuntimeDeploymentState({ chainId, deployment: nextDeployment });
        }
      } catch {
        // The generated SDK deployment remains the fallback for SSR and package consumers.
      }
    }

    void loadRuntimeDeployment();
    return () => {
      cancelled = true;
    };
  }, [chainId, generatedDeployment]);

  if (runtimeDeploymentState.chainId !== chainId) return generatedDeployment;
  if (runtimeDeploymentState.deployment && !isRuntimeDeploymentForChain(runtimeDeploymentState.deployment, chainId)) {
    return generatedDeployment;
  }
  return runtimeDeploymentState.deployment;
}

export function isRuntimeDeploymentForChain(deployment: PledgeCashDeployment, chainId: number): boolean {
  if (deployment.chainId === chainId) return true;
  return Number.isNaN(deployment.chainId) && isStatusOnlyDeployment(deployment);
}

function isStatusOnlyDeployment(deployment: PledgeCashDeployment): boolean {
  return Boolean(deployment.status || deployment.reason || deployment.boardroomStatus || deployment.boardroomReason);
}
