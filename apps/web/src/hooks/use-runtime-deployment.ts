import type { PledgeCashDeployment } from "@pledge.cash/sdk";
import { useEffect, useState } from "react";
import { parseDeployment } from "../lib/deployment";

export function useRuntimeDeployment(
  chainId: number,
  generatedDeployment: PledgeCashDeployment | undefined,
): PledgeCashDeployment | undefined {
  const [runtimeDeployment, setRuntimeDeployment] = useState<PledgeCashDeployment | undefined>(generatedDeployment);

  useEffect(() => {
    let cancelled = false;
    setRuntimeDeployment(generatedDeployment);

    async function loadRuntimeDeployment(): Promise<void> {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}deployments/${chainId}.json`, {
          cache: "no-store",
        });
        if (!response.ok) return;

        const raw = await response.text();
        if (!cancelled) {
          setRuntimeDeployment(parseDeployment(raw));
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

  return runtimeDeployment;
}
