import { describe, expect, test } from "bun:test";
import {
  deploymentAvailabilityStatus,
  isRuntimeDeploymentForChain,
  pendingDeploymentReason,
  selectRuntimeDeploymentAvailability,
  startRuntimeDeploymentRecovery,
  type RuntimeDeploymentResult,
} from "../src/hooks/use-runtime-deployment";
import { parseDeployment } from "../src/lib/deployment";

const address = (digit: string): `0x${string}` => `0x${digit.repeat(40)}`;

describe("lean runtime deployment artifacts", () => {
  test("parses the Boardroom, grant, locker, fee-router, and v4 roots", () => {
    const deployment = parseDeployment(JSON.stringify({
      chainId: 31337,
      boardroomFactory: address("1"),
      boardroomImplementation: address("2"),
      tokenGrantFactory: address("3"),
      tokenGrantLogic: address("4"),
      liquidityLockerFactory: address("5"),
      protocolFeeRouter: address("6"),
      protocolTreasury: address("7"),
      uniswapV4PoolManager: address("8"),
      uniswapV4PositionManager: address("9"),
      uniswapUniversalRouter: address("a"),
      uniswapV4Quoter: address("b"),
      uniswapV4StateView: address("c"),
      permit2: address("d"),
      wrappedNative: address("e"),
      creationFee: "12",
      deploymentBlock: 42,
    }));

    expect(deployment.boardroomFactory).toBe(address("1"));
    expect(deployment.boardroomImplementation).toBe(address("2"));
    expect(deployment.liquidityLockerFactory).toBe(address("5"));
    expect(deployment.protocolTreasury).toBe(address("7"));
    expect(deployment.uniswapV4PositionManager).toBe(address("9"));
    expect(deployment.creationFee).toBe(12n);
    expect(deployment.deploymentBlock).toBe(42n);
  });

  test("accepts status-only placeholders and rejects wrong-chain artifacts", () => {
    expect(isRuntimeDeploymentForChain(parseDeployment('{"status":"pending"}'), 998)).toBe(true);
    expect(isRuntimeDeploymentForChain(parseDeployment('{"chainId":998}'), 8453)).toBe(false);
  });

  test("classifies ready, pending, missing, and error status", () => {
    expect(deploymentAvailabilityStatus({ chainId: 998 })).toBe("ready");
    expect(deploymentAvailabilityStatus({ chainId: 998, status: "pending" })).toBe("pending");
    expect(deploymentAvailabilityStatus({ chainId: 998, status: "unavailable" })).toBe("missing");
    expect(deploymentAvailabilityStatus({ chainId: 998, status: "failed" })).toBe("error");
    expect(pendingDeploymentReason({ chainId: 998, status: "pending", reason: "Awaiting broadcast" })).toBe("Awaiting broadcast");
  });

  test("uses only runtime artifacts and keeps non-ready states fail-closed", () => {
    const readyDeployment = { chainId: 998, boardroomFactory: address("1") };
    const pendingDeployment = { chainId: 998, status: "pending", reason: "Awaiting broadcast" };
    const ready = selectRuntimeDeploymentAvailability(998, {
      kind: "deployment",
      deployment: readyDeployment,
    });
    const pending = selectRuntimeDeploymentAvailability(998, {
      kind: "deployment",
      deployment: pendingDeployment,
    });
    const missing = selectRuntimeDeploymentAvailability(998, { kind: "missing" });
    const failed = selectRuntimeDeploymentAvailability(998, { kind: "error", reason: "Offline" });

    expect(ready).toEqual({ chainId: 998, status: "ready", deployment: readyDeployment, reason: undefined });
    expect(pending).toEqual({
      chainId: 998,
      status: "pending",
      deployment: pendingDeployment,
      reason: "Awaiting broadcast",
    });
    expect(missing).toEqual({
      chainId: 998,
      status: "missing",
      deployment: undefined,
      reason: "No deployment artifact is published for this network.",
    });
    expect(failed).toEqual({ chainId: 998, status: "error", deployment: undefined, reason: "Offline" });
  });

  test("rejects mismatched runtime artifacts", () => {
    const availability = selectRuntimeDeploymentAvailability(8453, {
      kind: "deployment",
      deployment: { chainId: 998 },
    });
    expect(availability.status).toBe("error");
    expect(availability.deployment).toBeUndefined();
    expect(availability.reason).toContain("not chain 8453");
  });

  test("retries non-ready results and stops cleanly", async () => {
    const results: RuntimeDeploymentResult[] = [];
    const scheduled: (() => void)[] = [];
    const responses: RuntimeDeploymentResult[] = [
      { kind: "missing" },
      { kind: "deployment", deployment: { chainId: 998 } },
    ];
    const stop = startRuntimeDeploymentRecovery({
      chainId: 998,
      onResult: (result) => results.push(result),
      fetchDeployment: async () => responses.shift() ?? { kind: "missing" },
      retryDelaysMs: [1],
      windowTarget: undefined,
      documentTarget: undefined,
      setTimeoutFn: (callback) => { scheduled.push(callback); return 1 as never; },
      clearTimeoutFn: () => undefined,
    });
    await drainMicrotasks();
    expect(results[0]).toEqual({ kind: "missing" });
    scheduled.shift()?.();
    await drainMicrotasks();
    expect(results[1]).toEqual({ kind: "deployment", deployment: { chainId: 998 } });
    stop();
  });
});

async function drainMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
