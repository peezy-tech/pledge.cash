import { readFactoryState, type PledgeCashDeployment } from "@pledge.cash/sdk";
import { useEffect, useState } from "react";
import { publicClient } from "../lib/contracts";
import { errorMessage } from "../lib/forms";
import type { FactorySnapshot } from "../lib/types";
import type { PushLog } from "./use-action-runner";

export function useFactorySnapshot(
  deployment: PledgeCashDeployment | undefined,
  pushLog: PushLog,
): FactorySnapshot {
  const [factorySnapshot, setFactorySnapshot] = useState<FactorySnapshot>({});

  useEffect(() => {
    let cancelled = false;

    async function loadFactory(): Promise<void> {
      if (!deployment?.tokenGrantFactory) return;

      try {
        const snapshot = await readFactoryState(publicClient, deployment.tokenGrantFactory);
        if (!cancelled) {
          setFactorySnapshot({
            owner: snapshot.owner,
            tokenGrantLogic: snapshot.tokenGrantLogic,
            creationFee: snapshot.creationFee,
          });
        }
      } catch (error) {
        pushLog(`Factory reads failed: ${errorMessage(error)}`, "error");
      }
    }

    void loadFactory();
    return () => {
      cancelled = true;
    };
  }, [deployment?.tokenGrantFactory, pushLog]);

  return factorySnapshot;
}
