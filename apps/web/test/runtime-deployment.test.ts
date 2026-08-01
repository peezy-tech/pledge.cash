import { describe, expect, test } from "bun:test";
import {
  deploymentAvailabilityStatus,
  isRuntimeDeploymentForChain,
  pendingDeploymentReason,
  selectRuntimeDeploymentAvailability,
  startRuntimeDeploymentRecovery,
  type RuntimeDeploymentResult,
} from "../src/hooks/use-runtime-deployment";
import {
  boardroomControlReleaseSupport,
  deploymentRuntimeIdentity,
  parseDeployment,
} from "../src/lib/deployment";

describe("runtime deployment artifacts", () => {
  test("fails closed for incomplete and unknown canonical protocol releases", () => {
    const incomplete = boardroomControlReleaseSupport({
      chainId: 31_337,
      protocolVersion: "pledge.cash.protocol.v1",
      boardroomFactory: "0x1000000000000000000000000000000000000001",
    });
    const unknown = boardroomControlReleaseSupport({ chainId: 31_337 });

    expect(incomplete.supported).toBe(false);
    expect(incomplete.reason).toContain("missing canonical Boardroom release evidence");
    expect(unknown.supported).toBe(false);
  });

  test("supports runtime proof from permanent roots without requiring genesis release evidence", () => {
    const codeHash = `0x${"11".repeat(32)}` as const;
    const complete = {
      chainId: 31_337,
      protocolVersion: "pledge.cash.protocol.v1",
      protocolReleaseCodeHash: codeHash,
      protocolFacetRegistryOwner: "0x1000000000000000000000000000000000000010" as const,
      protocolFacetRegistry: "0x1000000000000000000000000000000000000011" as const,
      protocolFacetRegistryCodeHash: codeHash,
      boardroomFactory: "0x1000000000000000000000000000000000000001" as const,
      boardroomFactoryCodeHash: codeHash,
      boardroomKernel: "0x1000000000000000000000000000000000000012" as const,
      boardroomKernelCodeHash: codeHash,
      boardroomControllerFactory: "0x1000000000000000000000000000000000000002" as const,
      boardroomControllerFactoryCodeHash: codeHash,
      boardroomControllerLogic: "0x1000000000000000000000000000000000000003" as const,
      boardroomControllerLogicCodeHash: codeHash,
      boardroomGovernanceLogic: "0x1000000000000000000000000000000000000004" as const,
      boardroomGovernanceLogicCodeHash: codeHash,
      boardroomMarketLogic: "0x1000000000000000000000000000000000000005" as const,
      boardroomMarketLogicCodeHash: codeHash,
      boardroomRedemptionPayout: "0x1000000000000000000000000000000000000006" as const,
      boardroomRedemptionPayoutCodeHash: codeHash,
      authorityFacet: "0x1000000000000000000000000000000000000021" as const,
      authorityFacetCodeHash: codeHash,
      executionFacet: "0x1000000000000000000000000000000000000022" as const,
      executionFacetCodeHash: codeHash,
      marketFacet: "0x1000000000000000000000000000000000000023" as const,
      marketFacetCodeHash: codeHash,
      redemptionFacet: "0x1000000000000000000000000000000000000024" as const,
      redemptionFacetCodeHash: codeHash,
      viewFacet: "0x1000000000000000000000000000000000000025" as const,
      viewFacetCodeHash: codeHash,
      activeFacetSetHash: codeHash,
      activeRelease: 1n,
      requiredStorageVersion: 1n,
      requiredStorageLayoutHash: codeHash,
      manifestHash: codeHash,
      kernelSelectorSetHash: codeHash,
      selectorCount: 97n,
    };

    expect(boardroomControlReleaseSupport(complete)).toEqual({ supported: true });
    expect(boardroomControlReleaseSupport({ ...complete, boardroomControllerLogic: undefined }).supported).toBe(false);
    expect(boardroomControlReleaseSupport({
      ...complete,
      protocolFacetRegistryOwner: undefined,
      authorityFacet: undefined,
      authorityFacetCodeHash: undefined,
      executionFacet: undefined,
      executionFacetCodeHash: undefined,
      marketFacet: undefined,
      marketFacetCodeHash: undefined,
      redemptionFacet: undefined,
      redemptionFacetCodeHash: undefined,
      viewFacet: undefined,
      viewFacetCodeHash: undefined,
      activeFacetSetHash: undefined,
      activeRelease: undefined,
      requiredStorageVersion: undefined,
      requiredStorageLayoutHash: undefined,
      manifestHash: undefined,
      selectorCount: undefined,
    })).toEqual({ supported: true });
    expect(boardroomControlReleaseSupport({ ...complete, boardroomControllerLogicCodeHash: undefined }).supported).toBe(false);
  });

  test("preserves canonical registry, kernel, controller, and facet attestations", () => {
    const deployment = parseDeployment(`{
      "chainId": 31337,
      "protocolFacetRegistry": "0x1000000000000000000000000000000000000001",
      "boardroomKernel": "0x1000000000000000000000000000000000000002",
      "boardroomControllerFactory": "0x1000000000000000000000000000000000000002",
      "boardroomControllerLogic": "0x1000000000000000000000000000000000000003",
      "boardroomMarketLogic": "0x1000000000000000000000000000000000000004",
      "authorityFacet": "0x1000000000000000000000000000000000000005",
      "protocolFacetRegistryCodeHash": "0xregistry",
      "boardroomKernelCodeHash": "0xkernel",
      "boardroomControllerFactoryCodeHash": "0xcontrollerfactory",
      "boardroomControllerLogicCodeHash": "0xcontroller",
      "authorityFacetCodeHash": "0xauthority",
      "boardroomMarketLogicCodeHash": "0xmarket"
    }`);

    expect(deployment.protocolFacetRegistry).toBe("0x1000000000000000000000000000000000000001");
    expect(deployment.boardroomKernel).toBe("0x1000000000000000000000000000000000000002");
    expect(deployment.boardroomControllerFactory).toBe("0x1000000000000000000000000000000000000002");
    expect(deployment.boardroomControllerLogic).toBe("0x1000000000000000000000000000000000000003");
    expect(deployment.boardroomMarketLogic).toBe("0x1000000000000000000000000000000000000004");
    expect(deployment.authorityFacet).toBe("0x1000000000000000000000000000000000000005");
    expect(deployment.boardroomControllerFactoryCodeHash).toBe("0xcontrollerfactory");
    expect(deployment.boardroomControllerLogicCodeHash).toBe("0xcontroller");
    expect(deployment.boardroomMarketLogicCodeHash).toBe("0xmarket");
  });

  test("accepts status-only placeholders for the requested deployment path", () => {
    const deployment = parseDeployment('{"status":"pending","reason":"Broadcast artifact not published yet"}');

    expect(isRuntimeDeploymentForChain(deployment, 998)).toBe(true);
  });

  test("rejects chain-specific artifacts from a different chain", () => {
    const deployment = parseDeployment('{"chainId":998,"tokenGrantFactory":"0x1000000000000000000000000000000000000000"}');

    expect(isRuntimeDeploymentForChain(deployment, 10143)).toBe(false);
  });

  test("parses ready, pending, missing, and error artifact statuses", () => {
    expect(deploymentAvailabilityStatus({ chainId: 998 })).toBe("ready");
    expect(deploymentAvailabilityStatus({ chainId: 998, status: "pending" })).toBe("pending");
    expect(deploymentAvailabilityStatus({ chainId: 998, status: "unavailable" })).toBe("missing");
    expect(deploymentAvailabilityStatus({ chainId: 998, status: "failed" })).toBe("error");
    expect(pendingDeploymentReason({ chainId: 998, status: "pending", reason: "Awaiting broadcast" })).toBe("Awaiting broadcast");
  });

  test("keeps a chain-valid generated deployment as the runtime fallback", () => {
    const generated = {
      chainId: 998,
      tokenGrantFactory: "0x1000000000000000000000000000000000000000" as const,
    };
    const pending = selectRuntimeDeploymentAvailability(998, generated, {
      kind: "deployment",
      deployment: { chainId: 998, status: "pending", reason: "Awaiting broadcast" },
    });
    const missing = selectRuntimeDeploymentAvailability(998, generated, { kind: "missing" });
    const failed = selectRuntimeDeploymentAvailability(998, generated, { kind: "error", reason: "Network offline" });

    expect(pending).toEqual({
      chainId: 998,
      status: "pending",
      deployment: generated,
      source: "generated",
      reason: "Awaiting broadcast",
    });
    expect(missing.deployment).toBe(generated);
    expect(missing.status).toBe("missing");
    expect(failed.deployment).toBe(generated);
    expect(failed.reason).toBe("Network offline");
  });

  test("does not select mismatched runtime or generated artifacts", () => {
    const availability = selectRuntimeDeploymentAvailability(
      10143,
      { chainId: 998 },
      { kind: "deployment", deployment: { chainId: 998 } },
    );

    expect(availability.status).toBe("error");
    expect(availability.deployment).toBeUndefined();
    expect(availability.reason).toContain("not chain 10143");
  });

  test("preserves Uniswap v4 execution roots and protocol-liquidity identity", () => {
    const deployment = parseDeployment(`{
      "chainId": 998,
      "uniswapV4PoolManager": "0x1000000000000000000000000000000000000001",
      "uniswapUniversalRouter": "0x1000000000000000000000000000000000000002",
      "uniswapV4Quoter": "0x1000000000000000000000000000000000000003",
      "uniswapV4StateView": "0x1000000000000000000000000000000000000004",
      "permit2": "0x1000000000000000000000000000000000000005",
      "pledgeV4LiquidityFactory": "0x1000000000000000000000000000000000000006"
    }`);

    expect(deployment.uniswapV4PoolManager).toBe("0x1000000000000000000000000000000000000001");
    expect(deployment.uniswapUniversalRouter).toBe("0x1000000000000000000000000000000000000002");
    expect(deployment.uniswapV4Quoter).toBe("0x1000000000000000000000000000000000000003");
    expect(deployment.uniswapV4StateView).toBe("0x1000000000000000000000000000000000000004");
    expect(deployment.permit2).toBe("0x1000000000000000000000000000000000000005");
    expect(deployment.pledgeV4LiquidityFactory).toBe("0x1000000000000000000000000000000000000006");
  });

  test("preserves Boardroom reward deployment roots and attestations", () => {
    const deployment = parseDeployment(`{
      "chainId": 998,
      "boardroomRewardsFactory": "0x1000000000000000000000000000000000000004",
      "boardroomRewardsFactoryCodeHash": "0xabc456"
    }`);

    expect(deployment.boardroomRewardsFactory).toBe("0x1000000000000000000000000000000000000004");
    expect(deployment.boardroomRewardsFactoryCodeHash).toBe("0xabc456");
  });

  test("preserves bond-market deployment provenance", () => {
    const deployment = parseDeployment(`{
      "chainId": 998,
      "bondMarketFactory": "0x1000000000000000000000000000000000000001",
      "bondMarketLogic": "0x1000000000000000000000000000000000000002",
      "bondMarketFactoryCodeHash": "0xabc123"
    }`);

    expect(deployment.bondMarketFactory).toBe("0x1000000000000000000000000000000000000001");
    expect(deployment.bondMarketLogic).toBe("0x1000000000000000000000000000000000000002");
    expect(deployment.bondMarketFactoryCodeHash).toBe("0xabc123");
  });

  test("preserves Boardroom kernel, registry, and helper roots", () => {
    const deployment = parseDeployment(`{
      "chainId": 998,
      "boardroomGovernanceLogic": "0x1000000000000000000000000000000000000001",
      "boardroomRedemptionPayout": "0x1000000000000000000000000000000000000002",
      "boardroomKernel": "0x1000000000000000000000000000000000000003",
      "protocolFacetRegistry": "0x1000000000000000000000000000000000000004"
    }`);

    expect(deployment.boardroomGovernanceLogic).toBe("0x1000000000000000000000000000000000000001");
    expect(deployment.boardroomRedemptionPayout).toBe("0x1000000000000000000000000000000000000002");
    expect(deployment.boardroomKernel).toBe("0x1000000000000000000000000000000000000003");
    expect(deployment.protocolFacetRegistry).toBe("0x1000000000000000000000000000000000000004");
  });

  test("uses every write-critical artifact value in the runtime identity", () => {
    const base = {
      chainId: 998,
      boardroomFactory: "0x1000000000000000000000000000000000000001" as const,
      tokenGrantFactory: "0x1000000000000000000000000000000000000002" as const,
      uniswapUniversalRouter: "0x1000000000000000000000000000000000000003" as const,
      assetPolicy: "0x1000000000000000000000000000000000000004" as const,
      wrappedNative: "0x1000000000000000000000000000000000000005" as const,
      creationFee: 1n,
    };
    const identity = deploymentRuntimeIdentity(base);

    expect(deploymentRuntimeIdentity({ ...base, uniswapUniversalRouter: "0x2000000000000000000000000000000000000003" })).not.toBe(identity);
    expect(deploymentRuntimeIdentity({ ...base, assetPolicy: "0x2000000000000000000000000000000000000004" })).not.toBe(identity);
    expect(deploymentRuntimeIdentity({ ...base, wrappedNative: "0x2000000000000000000000000000000000000005" })).not.toBe(identity);
    expect(deploymentRuntimeIdentity({ ...base, creationFee: 2n })).not.toBe(identity);
  });

  test("keeps runtime identity stable across artifact property order", () => {
    expect(deploymentRuntimeIdentity({
      chainId: 998,
      creationFee: 5n,
      uniswapUniversalRouter: "0x1000000000000000000000000000000000000003",
    })).toBe(deploymentRuntimeIdentity({
      uniswapUniversalRouter: "0x1000000000000000000000000000000000000003",
      creationFee: 5n,
      chainId: 998,
    }));
  });

  test("preserves deterministic provenance and code hashes from runtime artifacts", () => {
    const deployment = parseDeployment(`{
      "chainId": 998,
      "sourceCommit": "fd145b60a72fcd949d8c4000ad3f24311eec73c8",
      "deploymentBlock": 59834000,
      "deterministicDeployment": true,
      "deterministicDeploymentVersion": "v2",
      "deterministicDeployer": "0x1000000000000000000000000000000000000001",
      "create2Factory": "0x1000000000000000000000000000000000000002",
      "uniswapUniversalRouterCodeHash": "0xabc123"
    }`);

    expect(deployment.sourceCommit).toBe("fd145b60a72fcd949d8c4000ad3f24311eec73c8");
    expect(deployment.deploymentBlock).toBe(59834000n);
    expect(deployment.deterministicDeployment).toBe(true);
    expect(deployment.deterministicDeploymentVersion).toBe("v2");
    expect(deployment.deterministicDeployer).toBe("0x1000000000000000000000000000000000000001");
    expect(deployment.create2Factory).toBe("0x1000000000000000000000000000000000000002");
    expect(deployment.uniswapUniversalRouterCodeHash).toBe("0xabc123");
  });
});

describe("runtime deployment recovery", () => {
  test("polls a pending deployment until it becomes ready", async () => {
    const timers = new FakeTimers();
    const results: RuntimeDeploymentResult[] = [];
    const responses: RuntimeDeploymentResult[] = [
      { kind: "deployment", deployment: { chainId: 998, status: "pending" } },
      { kind: "deployment", deployment: { chainId: 998 } },
    ];
    let fetchCount = 0;
    const stop = startRuntimeDeploymentRecovery({
      chainId: 998,
      fetchDeployment: async () => responses[fetchCount++]!,
      onResult: (result) => results.push(result),
      retryDelaysMs: [1_000],
      setTimeoutFn: timers.setTimeout,
      clearTimeoutFn: timers.clearTimeout,
      windowTarget: undefined,
      documentTarget: undefined,
    });

    await flushMicrotasks();
    expect(results[0]).toMatchObject({ kind: "deployment", deployment: { status: "pending" } });
    expect(timers.activeCount).toBe(1);

    timers.advanceBy(1_000);
    await flushMicrotasks();
    expect(fetchCount).toBe(2);
    expect(results[1]).toEqual({ kind: "deployment", deployment: { chainId: 998 } });
    expect(timers.activeCount).toBe(0);

    timers.advanceBy(60_000);
    await flushMicrotasks();
    expect(fetchCount).toBe(2);
    stop();
  });

  test("recovers from a transient request error on the next retry", async () => {
    const timers = new FakeTimers();
    const results: RuntimeDeploymentResult[] = [];
    let fetchCount = 0;
    const stop = startRuntimeDeploymentRecovery({
      chainId: 998,
      fetchDeployment: async () => {
        fetchCount += 1;
        if (fetchCount === 1) throw new Error("temporarily offline");
        return { kind: "deployment", deployment: { chainId: 998 } };
      },
      onResult: (result) => results.push(result),
      retryDelaysMs: [2_000],
      setTimeoutFn: timers.setTimeout,
      clearTimeoutFn: timers.clearTimeout,
      windowTarget: undefined,
      documentTarget: undefined,
    });

    await flushMicrotasks();
    expect(results[0]).toEqual({
      kind: "error",
      reason: "Unable to load the deployment artifact: temporarily offline",
    });
    expect(timers.activeCount).toBe(1);

    timers.advanceBy(2_000);
    await flushMicrotasks();
    expect(results[1]).toEqual({ kind: "deployment", deployment: { chainId: 998 } });
    expect(timers.activeCount).toBe(0);
    stop();
  });

  test("does not poll after a ready deployment", async () => {
    const timers = new FakeTimers();
    let fetchCount = 0;
    const stop = startRuntimeDeploymentRecovery({
      chainId: 998,
      fetchDeployment: async () => {
        fetchCount += 1;
        return { kind: "deployment", deployment: { chainId: 998 } };
      },
      onResult: () => undefined,
      retryDelaysMs: [1_000, 2_000],
      setTimeoutFn: timers.setTimeout,
      clearTimeoutFn: timers.clearTimeout,
      windowTarget: undefined,
      documentTarget: undefined,
    });

    await flushMicrotasks();
    expect(fetchCount).toBe(1);
    expect(timers.activeCount).toBe(0);
    timers.advanceBy(60_000);
    await flushMicrotasks();
    expect(fetchCount).toBe(1);
    stop();
  });

  test("refetches on online and visible restoration without stacking timers", async () => {
    const timers = new FakeTimers();
    const windowTarget = new EventTarget();
    const documentTarget = new TestDocumentTarget();
    const responses: RuntimeDeploymentResult[] = [
      { kind: "missing" },
      { kind: "deployment", deployment: { chainId: 998, status: "pending" } },
      { kind: "deployment", deployment: { chainId: 998 } },
    ];
    let fetchCount = 0;
    const stop = startRuntimeDeploymentRecovery({
      chainId: 998,
      fetchDeployment: async () => responses[fetchCount++]!,
      onResult: () => undefined,
      retryDelaysMs: [5_000],
      setTimeoutFn: timers.setTimeout,
      clearTimeoutFn: timers.clearTimeout,
      windowTarget,
      documentTarget,
    });

    await flushMicrotasks();
    expect(timers.activeCount).toBe(1);

    windowTarget.dispatchEvent(new Event("online"));
    await flushMicrotasks();
    expect(fetchCount).toBe(2);
    expect(timers.activeCount).toBe(1);

    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await flushMicrotasks();
    expect(fetchCount).toBe(3);
    expect(timers.activeCount).toBe(0);
    stop();
  });

  test("cleans up scheduled work and ignores stale-chain results", async () => {
    const timers = new FakeTimers();
    const windowTarget = new EventTarget();
    const documentTarget = new TestDocumentTarget();
    const oldRequest = deferred<RuntimeDeploymentResult>();
    const oldResults: RuntimeDeploymentResult[] = [];
    let oldFetchCount = 0;
    const stopOld = startRuntimeDeploymentRecovery({
      chainId: 998,
      fetchDeployment: async () => {
        oldFetchCount += 1;
        return await oldRequest.promise;
      },
      onResult: (result) => oldResults.push(result),
      retryDelaysMs: [1_000],
      setTimeoutFn: timers.setTimeout,
      clearTimeoutFn: timers.clearTimeout,
      windowTarget,
      documentTarget,
    });

    stopOld();
    oldRequest.resolve({ kind: "deployment", deployment: { chainId: 998, status: "pending" } });
    await flushMicrotasks();
    expect(oldResults).toEqual([]);
    expect(timers.activeCount).toBe(0);

    let currentFetchCount = 0;
    const currentResults: RuntimeDeploymentResult[] = [];
    const stopCurrent = startRuntimeDeploymentRecovery({
      chainId: 10143,
      fetchDeployment: async () => {
        currentFetchCount += 1;
        return { kind: "missing" };
      },
      onResult: (result) => currentResults.push(result),
      retryDelaysMs: [1_000],
      setTimeoutFn: timers.setTimeout,
      clearTimeoutFn: timers.clearTimeout,
      windowTarget,
      documentTarget,
    });

    await flushMicrotasks();
    expect(currentResults).toEqual([{ kind: "missing" }]);
    expect(timers.activeCount).toBe(1);
    stopCurrent();
    windowTarget.dispatchEvent(new Event("online"));
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    timers.advanceBy(10_000);
    await flushMicrotasks();
    expect(oldFetchCount).toBe(1);
    expect(currentFetchCount).toBe(1);
    expect(timers.activeCount).toBe(0);
  });

  test("stops automatic retries after the configured budget", async () => {
    const timers = new FakeTimers();
    let fetchCount = 0;
    const stop = startRuntimeDeploymentRecovery({
      chainId: 998,
      fetchDeployment: async () => {
        fetchCount += 1;
        return { kind: "missing" };
      },
      onResult: () => undefined,
      retryDelaysMs: [1_000, 2_000],
      setTimeoutFn: timers.setTimeout,
      clearTimeoutFn: timers.clearTimeout,
      windowTarget: undefined,
      documentTarget: undefined,
    });

    await flushMicrotasks();
    timers.advanceBy(1_000);
    await flushMicrotasks();
    timers.advanceBy(2_000);
    await flushMicrotasks();
    timers.advanceBy(60_000);
    await flushMicrotasks();
    expect(fetchCount).toBe(3);
    expect(timers.activeCount).toBe(0);
    stop();
  });
});

class FakeTimers {
  private now = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { callback: () => void; runAt: number }>();

  readonly setTimeout = (callback: () => void, delayMs: number): ReturnType<typeof setTimeout> => {
    const id = this.nextId++;
    this.timers.set(id, { callback, runAt: this.now + delayMs });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  readonly clearTimeout = (timer: ReturnType<typeof setTimeout>): void => {
    this.timers.delete(timer as unknown as number);
  };

  get activeCount(): number {
    return this.timers.size;
  }

  advanceBy(durationMs: number): void {
    const target = this.now + durationMs;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.runAt <= target)
        .sort((left, right) => left[1].runAt - right[1].runAt)[0];
      if (!next) break;
      const [id, timer] = next;
      this.timers.delete(id);
      this.now = timer.runAt;
      timer.callback();
    }
    this.now = target;
  }
}

class TestDocumentTarget extends EventTarget {
  visibilityState: DocumentVisibilityState = "hidden";
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
