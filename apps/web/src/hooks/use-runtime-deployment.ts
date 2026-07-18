import type { PledgeCashDeployment } from "@pledge.cash/sdk";
import { useEffect, useState } from "react";
import { parseDeployment } from "../lib/deployment";

export type RuntimeDeploymentAvailabilityStatus = "loading" | "ready" | "pending" | "missing" | "error";
export type RuntimeDeploymentSource = "runtime" | "generated";

export type RuntimeDeploymentAvailability = {
  chainId: number;
  status: RuntimeDeploymentAvailabilityStatus;
  deployment: PledgeCashDeployment | undefined;
  source: RuntimeDeploymentSource | undefined;
  reason: string | undefined;
};

export type RuntimeDeploymentResult =
  | { kind: "loading" }
  | { kind: "deployment"; deployment: PledgeCashDeployment }
  | { kind: "missing"; reason?: string | undefined }
  | { kind: "error"; reason: string };

type RuntimeDeploymentState = {
  chainId: number;
  result: RuntimeDeploymentResult;
};

type RuntimeDeploymentEventTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;
type RuntimeDeploymentDocumentTarget = RuntimeDeploymentEventTarget & {
  readonly visibilityState?: DocumentVisibilityState | undefined;
};
type RuntimeDeploymentTimer = ReturnType<typeof setTimeout>;

export type RuntimeDeploymentRecoveryOptions = {
  chainId: number;
  onResult: (result: RuntimeDeploymentResult) => void;
  fetchDeployment?: ((chainId: number) => Promise<RuntimeDeploymentResult>) | undefined;
  retryDelaysMs?: readonly number[] | undefined;
  windowTarget?: RuntimeDeploymentEventTarget | undefined;
  documentTarget?: RuntimeDeploymentDocumentTarget | undefined;
  setTimeoutFn?: ((callback: () => void, delayMs: number) => RuntimeDeploymentTimer) | undefined;
  clearTimeoutFn?: ((timer: RuntimeDeploymentTimer) => void) | undefined;
};

export const RUNTIME_DEPLOYMENT_RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000] as const;

/**
 * Compatibility hook for the existing application coordinator.
 *
 * New surfaces should prefer useRuntimeDeploymentAvailability so loading,
 * pending, missing, and error states are not flattened into an address object.
 */
export function useRuntimeDeployment(
  chainId: number,
  generatedDeployment: PledgeCashDeployment | undefined,
): PledgeCashDeployment | undefined {
  return useRuntimeDeploymentAvailability(chainId, generatedDeployment).deployment;
}

export function useRuntimeDeploymentAvailability(
  chainId: number,
  generatedDeployment: PledgeCashDeployment | undefined,
): RuntimeDeploymentAvailability {
  const [runtimeDeploymentState, setRuntimeDeploymentState] = useState<RuntimeDeploymentState>(() => ({
    chainId,
    result: { kind: "loading" },
  }));

  useEffect(() => {
    setRuntimeDeploymentState({ chainId, result: { kind: "loading" } });
    return startRuntimeDeploymentRecovery({
      chainId,
      onResult: (result) => setRuntimeDeploymentState({ chainId, result }),
    });
  }, [chainId]);

  const result = runtimeDeploymentState.chainId === chainId
    ? runtimeDeploymentState.result
    : { kind: "loading" } as const;
  return selectRuntimeDeploymentAvailability(chainId, generatedDeployment, result);
}

export function startRuntimeDeploymentRecovery({
  chainId,
  onResult,
  fetchDeployment = fetchRuntimeDeployment,
  retryDelaysMs = RUNTIME_DEPLOYMENT_RETRY_DELAYS_MS,
  windowTarget = typeof window === "undefined" ? undefined : window,
  documentTarget = typeof document === "undefined" ? undefined : document,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}: RuntimeDeploymentRecoveryOptions): () => void {
  let stopped = false;
  let requestInFlight = false;
  let queuedRecovery = false;
  let retryIndex = 0;
  let retryTimer: RuntimeDeploymentTimer | undefined;

  const clearRetryTimer = (): void => {
    if (retryTimer === undefined) return;
    clearTimeoutFn(retryTimer);
    retryTimer = undefined;
  };

  const scheduleRetry = (result: RuntimeDeploymentResult): void => {
    if (!shouldRetryRuntimeDeployment(chainId, result) || retryIndex >= retryDelaysMs.length) return;
    const delayMs = retryDelaysMs[retryIndex]!;
    retryIndex += 1;
    retryTimer = setTimeoutFn(() => {
      retryTimer = undefined;
      requestLoad(false);
    }, delayMs);
  };

  const requestLoad = (resetRetryBudget: boolean): void => {
    if (stopped) return;
    if (resetRetryBudget) retryIndex = 0;
    clearRetryTimer();
    if (requestInFlight) {
      queuedRecovery = true;
      return;
    }

    requestInFlight = true;
    void fetchDeployment(chainId)
      .catch((error: unknown): RuntimeDeploymentResult => ({
        kind: "error",
        reason: runtimeDeploymentErrorMessage(error),
      }))
      .then((result) => {
        requestInFlight = false;
        if (stopped) return;
        onResult(result);
        if (queuedRecovery) {
          queuedRecovery = false;
          requestLoad(false);
          return;
        }
        scheduleRetry(result);
      });
  };

  const handleOnline = (): void => requestLoad(true);
  const handleVisibilityChange = (): void => {
    if (documentTarget?.visibilityState === "visible") requestLoad(true);
  };

  windowTarget?.addEventListener("online", handleOnline);
  documentTarget?.addEventListener("visibilitychange", handleVisibilityChange);
  requestLoad(true);

  return () => {
    stopped = true;
    queuedRecovery = false;
    clearRetryTimer();
    windowTarget?.removeEventListener("online", handleOnline);
    documentTarget?.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}

export function selectRuntimeDeploymentAvailability(
  chainId: number,
  generatedDeployment: PledgeCashDeployment | undefined,
  result: RuntimeDeploymentResult,
): RuntimeDeploymentAvailability {
  const generatedFallback = isRuntimeDeploymentForChainOrUndefined(generatedDeployment, chainId)
    ? generatedDeployment
    : undefined;

  if (result.kind === "loading") {
    return availability(chainId, "loading", generatedFallback, generatedFallback ? "generated" : undefined);
  }

  if (result.kind === "missing") {
    return availability(
      chainId,
      "missing",
      generatedFallback,
      generatedFallback ? "generated" : undefined,
      result.reason ?? "No deployment artifact is published for this network.",
    );
  }

  if (result.kind === "error") {
    return availability(
      chainId,
      "error",
      generatedFallback,
      generatedFallback ? "generated" : undefined,
      result.reason,
    );
  }

  const runtimeDeployment = result.deployment;
  if (!isRuntimeDeploymentForChain(runtimeDeployment, chainId)) {
    return availability(
      chainId,
      "error",
      generatedFallback,
      generatedFallback ? "generated" : undefined,
      `The runtime deployment artifact targets chain ${displayChainId(runtimeDeployment.chainId)}, not chain ${chainId.toString()}.`,
    );
  }

  const runtimeStatus = deploymentAvailabilityStatus(runtimeDeployment);
  if (runtimeStatus === "ready") {
    return availability(chainId, "ready", runtimeDeployment, "runtime");
  }

  const deployment = generatedFallback ?? runtimeDeployment;
  const source = generatedFallback ? "generated" : "runtime";
  if (runtimeStatus === "pending") {
    return availability(chainId, "pending", deployment, source, pendingDeploymentReason(runtimeDeployment));
  }

  return availability(
    chainId,
    runtimeStatus,
    generatedFallback,
    generatedFallback ? "generated" : undefined,
    deploymentStatusReason(runtimeDeployment, runtimeStatus),
  );
}

export function deploymentAvailabilityStatus(
  deployment: PledgeCashDeployment,
): Extract<RuntimeDeploymentAvailabilityStatus, "ready" | "pending" | "missing" | "error"> {
  const statuses = [deployment.status, deployment.boardroomStatus]
    .map(normalizedStatus)
    .filter((status): status is string => status !== undefined);

  if (statuses.includes("pending")) return "pending";
  if (statuses.some((status) => status === "missing" || status === "not-found" || status === "unavailable")) {
    return "missing";
  }
  if (statuses.some((status) => status === "error" || status === "failed" || status === "failure")) {
    return "error";
  }
  return "ready";
}

export function pendingDeploymentReason(deployment: PledgeCashDeployment | undefined): string {
  const reason = deployment?.status?.trim().toLowerCase() === "pending"
    ? deployment.reason
    : deployment?.boardroomStatus?.trim().toLowerCase() === "pending"
      ? deployment.boardroomReason ?? deployment.reason
      : deployment?.reason ?? deployment?.boardroomReason;
  return reason?.trim() || "The deployment is still being prepared for this network.";
}

export function isRuntimeDeploymentForChain(deployment: PledgeCashDeployment, chainId: number): boolean {
  if (deployment.chainId === chainId) return true;
  return Number.isNaN(deployment.chainId) && isStatusOnlyDeployment(deployment);
}

function shouldRetryRuntimeDeployment(chainId: number, result: RuntimeDeploymentResult): boolean {
  return selectRuntimeDeploymentAvailability(chainId, undefined, result).status !== "ready";
}

async function fetchRuntimeDeployment(chainId: number): Promise<RuntimeDeploymentResult> {
  try {
    const response = await fetch(runtimeDeploymentUrl(chainId), { cache: "no-store" });
    if (response.status === 404 || response.status === 410 || response.status === 204) {
      return { kind: "missing" };
    }
    if (!response.ok) {
      return { kind: "error", reason: `Deployment request failed with status ${response.status.toString()}.` };
    }

    const raw = await response.text();
    if (!raw.trim()) return { kind: "missing" };
    return { kind: "deployment", deployment: parseDeployment(raw) };
  } catch (error) {
    return { kind: "error", reason: runtimeDeploymentErrorMessage(error) };
  }
}

function availability(
  chainId: number,
  status: RuntimeDeploymentAvailabilityStatus,
  deployment: PledgeCashDeployment | undefined,
  source: RuntimeDeploymentSource | undefined,
  reason?: string | undefined,
): RuntimeDeploymentAvailability {
  return { chainId, status, deployment, source, reason };
}

function isRuntimeDeploymentForChainOrUndefined(
  deployment: PledgeCashDeployment | undefined,
  chainId: number,
): deployment is PledgeCashDeployment {
  return deployment !== undefined && isRuntimeDeploymentForChain(deployment, chainId);
}

function deploymentStatusReason(
  deployment: PledgeCashDeployment,
  status: "missing" | "error",
): string {
  const reason = deployment.reason ?? deployment.boardroomReason;
  if (reason?.trim()) return reason.trim();
  return status === "missing"
    ? "No deployment artifact is published for this network."
    : "The deployment artifact reports an error.";
}

function normalizedStatus(status: string | undefined): string | undefined {
  const normalized = status?.trim().toLowerCase();
  return normalized || undefined;
}

function runtimeDeploymentErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return `Unable to load the deployment artifact: ${error.message.trim()}`;
  return "Unable to load the deployment artifact.";
}

function displayChainId(chainId: number): string {
  return Number.isNaN(chainId) ? "an unspecified chain" : chainId.toString();
}

function runtimeDeploymentUrl(chainId: number): string {
  return `${import.meta.env.BASE_URL}deployments/${chainId}.json`;
}

function isStatusOnlyDeployment(deployment: PledgeCashDeployment): boolean {
  return Boolean(deployment.status || deployment.reason || deployment.boardroomStatus || deployment.boardroomReason);
}
