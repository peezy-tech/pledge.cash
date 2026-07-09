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
  const [runtimeDeploymentState, setRuntimeDeploymentState] = useState<RuntimeDeploymentState>(() =>
    generatedDeploymentState(chainId, generatedDeployment),
  );

  useEffect(() => {
    let cancelled = false;
    setRuntimeDeploymentState(generatedDeploymentState(chainId, generatedDeployment));

    async function loadRuntimeDeployment(): Promise<void> {
      try {
        const nextDeployment = await fetchRuntimeDeployment(chainId);
        if (!nextDeployment) return;
        if (cancelled) return;
        if (!isRuntimeDeploymentForChain(nextDeployment, chainId)) return;

        setRuntimeDeploymentState({ chainId, deployment: nextDeployment });
      } catch {
        // The generated SDK deployment remains the fallback for SSR and package consumers.
      }
    }

    void loadRuntimeDeployment();
    return () => {
      cancelled = true;
    };
  }, [chainId, generatedDeployment]);

  return selectedDeployment(runtimeDeploymentState, chainId, generatedDeployment);
}

export function isRuntimeDeploymentForChain(deployment: PledgeCashDeployment, chainId: number): boolean {
  if (deployment.chainId === chainId) return true;
  return Number.isNaN(deployment.chainId) && isStatusOnlyDeployment(deployment);
}

function generatedDeploymentState(
  chainId: number,
  generatedDeployment: PledgeCashDeployment | undefined,
): RuntimeDeploymentState {
  return { chainId, deployment: generatedDeployment };
}

async function fetchRuntimeDeployment(chainId: number): Promise<PledgeCashDeployment | undefined> {
  const response = await fetch(runtimeDeploymentUrl(chainId), { cache: "no-store" });
  if (!response.ok) return undefined;

  return parseDeployment(await response.text());
}

function runtimeDeploymentUrl(chainId: number): string {
  return `${import.meta.env.BASE_URL}deployments/${chainId}.json`;
}

function selectedDeployment(
  state: RuntimeDeploymentState,
  chainId: number,
  generatedDeployment: PledgeCashDeployment | undefined,
): PledgeCashDeployment | undefined {
  if (state.chainId !== chainId) return generatedDeployment;
  if (state.deployment && !isRuntimeDeploymentForChain(state.deployment, chainId)) return generatedDeployment;

  return state.deployment;
}

function isStatusOnlyDeployment(deployment: PledgeCashDeployment): boolean {
  return Boolean(deployment.status || deployment.reason || deployment.boardroomStatus || deployment.boardroomReason);
}
