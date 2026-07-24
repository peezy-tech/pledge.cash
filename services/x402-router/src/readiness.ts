import type { PublicClient } from "viem";
import type { ReadinessCheck } from "./api/server";
import type { RouterDeploymentResolution } from "./deployment";
import type { RefundInventoryReader } from "./quotes/service";

export type RouterReadinessDependencies = {
  deployment: RouterDeploymentResolution;
  publicClient: PublicClient;
  executor: `0x${string}`;
  minimumGasBalance: bigint;
  minimumRefundReserve: bigint;
  refundInventory: RefundInventoryReader;
  databasePing(): Promise<void>;
  canonicalReady(): Promise<void>;
};

export async function readRouterReadiness(
  deps: RouterReadinessDependencies,
): Promise<ReadinessCheck> {
  const checks: ReadinessCheck["checks"] = {};

  try {
    await deps.databasePing();
    checks.database = { ok: true };
  } catch {
    checks.database = { ok: false, message: "Database is unavailable." };
  }

  if (!deps.deployment.ready) {
    checks.deployment = {
      ok: false,
      message: deps.deployment.reason,
    };
  } else {
    try {
      await deps.canonicalReady();
      checks.deployment = { ok: true };
    } catch {
      checks.deployment = {
        ok: false,
        message: "Canonical deployment validation failed.",
      };
    }
  }

  try {
    const gasBalance = await deps.publicClient.getBalance({
      address: deps.executor,
    });
    checks.executorGas =
      gasBalance >= deps.minimumGasBalance
        ? { ok: true }
        : {
            ok: false,
            message: "HyperEVM executor gas reserve is below the configured minimum.",
          };
  } catch {
    checks.executorGas = {
      ok: false,
      message: "HyperEVM executor gas balance could not be read.",
    };
  }

  try {
    const refundBalance = await deps.refundInventory.availableAtomicUsdc();
    checks.refundInventory =
      refundBalance >= deps.minimumRefundReserve
        ? { ok: true }
        : {
            ok: false,
            message: "HyperCore refund reserve is below the configured minimum.",
          };
  } catch {
    checks.refundInventory = {
      ok: false,
      message: "HyperCore refund inventory could not be read.",
    };
  }

  const ready = Object.values(checks).every(check => check.ok);
  return {
    ready,
    acceptingQuotes: ready,
    checks,
  };
}
