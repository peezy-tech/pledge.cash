import { readFactoryState, type PledgeCashDeployment } from "@pledge.cash/sdk";
import { useEffect, useState } from "react";
import type { PublicClient } from "viem";
import { errorMessage } from "../lib/forms";
import type { FactorySnapshot } from "../lib/types";
import type { PushLog } from "./use-action-runner";

export function useFactorySnapshot(
  client: PublicClient,
  deployment: PledgeCashDeployment | undefined,
  pushLog: PushLog,
): FactorySnapshot {
  const [factorySnapshot, setFactorySnapshot] = useState<FactorySnapshot>({});

  useEffect(() => {
    let cancelled = false;

    async function loadFactory(): Promise<void> {
      setFactorySnapshot({});
      if (!deployment?.tokenGrantFactory) return;

      try {
        const snapshot = await readFactoryState(client, deployment.tokenGrantFactory);
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
  }, [client, deployment?.tokenGrantFactory, pushLog]);

  return factorySnapshot;
}
