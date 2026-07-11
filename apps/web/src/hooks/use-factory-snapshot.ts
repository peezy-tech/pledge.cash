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
  const [factorySnapshot, setFactorySnapshot] = useState<ScopedFactorySnapshot>({});

  useEffect(() => {
    let cancelled = false;
    const factoryAddress = deployment?.tokenGrantFactory;

    async function loadFactory(): Promise<void> {
      setFactorySnapshot({});
      if (!factoryAddress) return;

      try {
        const snapshot = await readFactoryState(client, factoryAddress);
        if (cancelled) return;

        setFactorySnapshot({
          ...factoryStateSnapshot(snapshot),
          client,
          factoryAddress,
        });
      } catch (error) {
        pushLog(`Factory reads failed: ${errorMessage(error)}`, "error");
      }
    }

    void loadFactory();
    return () => {
      cancelled = true;
    };
  }, [client, deployment?.tokenGrantFactory, pushLog]);

  return factorySnapshot.client === client
    && factorySnapshot.factoryAddress?.toLowerCase() === deployment?.tokenGrantFactory?.toLowerCase()
    ? factorySnapshot
    : {};
}

type ScopedFactorySnapshot = FactorySnapshot & {
  client?: PublicClient | undefined;
  factoryAddress?: `0x${string}` | undefined;
};

type ReadFactoryState = Awaited<ReturnType<typeof readFactoryState>>;

function factoryStateSnapshot(snapshot: ReadFactoryState): FactorySnapshot {
  return {
    owner: snapshot.owner,
    tokenGrantLogic: snapshot.tokenGrantLogic,
    creationFee: snapshot.creationFee,
  };
}
