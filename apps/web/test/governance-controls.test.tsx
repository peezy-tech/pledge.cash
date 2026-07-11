import { describe, expect, test } from "bun:test";
import {
  boardroomAbi,
  type BoardroomCall,
  type QueuedBoardroomAction,
} from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  GovernanceLaunchControl,
  GovernanceQueue,
  buildGovernanceExecutionRequest,
  buildGovernanceLaunchSteps,
  buildGovernanceVetoRequest,
  effectiveGovernanceActionStatus,
  governanceActionView,
  governanceDelayPresets,
} from "../src/features/governance";
import { governanceRefreshDelay } from "../src/lib/governance-refresh";
import { contractCallReview } from "../src/lib/transaction-preview";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const owner = "0x2000000000000000000000000000000000000000" as Address;
const executor = "0x3000000000000000000000000000000000000000" as Address;
const policy = "0x4000000000000000000000000000000000000000" as Address;
const recipient = "0x5000000000000000000000000000000000000000" as Address;
const actionHash = `0x${"a".repeat(64)}` as Hex;
const salt = `0x${"b".repeat(64)}` as Hex;
const transactionHash = `0x${"c".repeat(64)}` as Hex;

const mintCall: BoardroomCall = {
  policy,
  target: boardroom,
  value: 0n,
  data: encodeFunctionData({ abi: boardroomAbi, functionName: "mint", args: [recipient, 1_000n] }),
};

const readyAction: QueuedBoardroomAction = {
  boardroom,
  actionHash,
  executor,
  eta: 1_700_000_000n,
  expiresAt: 1_700_604_800n,
  epoch: 2n,
  currentEpoch: 2n,
  actionStatus: 1,
  salt,
  queueBlockNumber: 100n,
  queueTransactionHash: transactionHash,
  status: "ready",
  kind: "queueAction",
  calls: [mintCall],
};

const queueCapabilities = {
  "governance.executeReady": { status: "enabled" as const },
  "governance.veto": { status: "enabled" as const },
};

describe("governance controls", () => {
  test("decodes and presents a ready action before exposing execution", () => {
    const view = governanceActionView(readyAction, 1_700_100_000n);
    expect(view.title).toBe("Mint project shares");
    expect(view.statusLabel).toBe("Ready to execute");
    expect(view.calls[0]).toMatchObject({
      functionName: "mint",
      signature: "mint(address,uint256)",
      verification: "verified",
      parameters: [
        { name: "to", type: "address", value: recipient },
        { name: "amount", type: "uint256", value: "1000" },
      ],
    });

    const html = renderToString(
      <GovernanceQueue
        account={owner}
        actions={[readyAction]}
        capabilities={queueCapabilities}
        now={1_700_100_000n}
        pendingAction={undefined}
        runAction={async (_id, action) => action()}
        submitTransaction={async () => undefined}
      />,
    );

    expect(html).toContain("Mint project shares");
    expect(html).toContain("Ready to execute");
    expect(html).toContain("Function selector");
    expect(html).toContain("Verified decode");
    expect(html).toContain(recipient);
    expect(html).toContain("amount");
    expect(html).toContain("1000");
    expect(html).toContain("Raw calldata");
    expect(html).toContain("Veto action");
    expect(html).toContain("Execute now");
  });

  test("preserves queueAction versus queueBatch execution semantics", () => {
    expect(buildGovernanceExecutionRequest(readyAction, 1_700_100_000n).functionName).toBe("executeQueuedAction");

    const batch: QueuedBoardroomAction = {
      ...readyAction,
      kind: "queueBatch",
      calls: [mintCall, mintCall],
    };
    expect(buildGovernanceExecutionRequest(batch, 1_700_100_000n).functionName).toBe("executeQueuedBatch");
  });

  test("does not expose execution when the original calldata is unverified", () => {
    const unverified: QueuedBoardroomAction = {
      ...readyAction,
      calls: undefined,
      kind: undefined,
      payloadError: "Queue calldata could not be decoded.",
    };
    const html = renderToString(
      <GovernanceQueue
        actions={[unverified]}
        capabilities={queueCapabilities}
        now={1_700_100_000n}
        pendingAction={undefined}
        runAction={async (_id, action) => action()}
        submitTransaction={async () => undefined}
      />,
    );

    expect(html).toContain("Calldata verification failed");
    expect(html).toContain("Execution is disabled until the original queue calldata is verified");
    expect(html).toContain("disabled");
  });

  test("labels an unknown inner call as unverified and disables execution", () => {
    const unknown: QueuedBoardroomAction = {
      ...readyAction,
      calls: [{ ...mintCall, target: recipient, data: "0xdeadbeef" }],
    };
    const html = renderToString(
      <GovernanceQueue
        actions={[unknown]}
        capabilities={queueCapabilities}
        now={1_700_100_000n}
        pendingAction={undefined}
        runAction={async (_id, action) => action()}
        submitTransaction={async () => undefined}
      />,
    );

    expect(html).toContain("Unverified call 0xdeadbeef");
    expect(html).toContain("Unverified call");
    expect(html).toContain("will not offer execution");
    expect(html).toContain("every inner call is decoded");
    expect(html).toContain("disabled");
  });

  test("requires an executor checkpoint before building the irreversible launch", () => {
    const steps = buildGovernanceLaunchSteps({
      boardroom,
      currentExecutor: owner,
      governanceDelay: 86_400n,
      nextExecutor: executor,
    });
    expect(steps.map((step) => step.kind)).toEqual(["setExecutor"]);
    expect(steps.map((step) => step.request.functionName)).toEqual(["setExecutor"]);

    const unchanged = buildGovernanceLaunchSteps({
      boardroom,
      currentExecutor: executor,
      governanceDelay: 86_400n,
      nextExecutor: executor,
    });
    expect(unchanged.map((step) => step.kind)).toEqual(["launch"]);
    const launchReview = contractCallReview(unchanged[0]!.label, unchanged[0]!.request);
    expect(launchReview.parameters).toEqual([
      { name: "Required current executor (rechecked)", type: "address", value: executor },
      { name: "Holder review period", type: "duration", value: "1 day" },
    ]);
  });

  test("polls for external queue changes while refreshing sooner at ETA and expiry boundaries", () => {
    const waiting = { ...readyAction, status: "waiting", eta: 1_010n } as QueuedBoardroomAction;
    const ready = { ...readyAction, status: "ready", expiresAt: 1_020n } as QueuedBoardroomAction;
    const distant = { ...readyAction, status: "waiting", eta: 2_000n } as QueuedBoardroomAction;

    expect(governanceRefreshDelay([waiting], 1_000_000)).toBe(11_000);
    expect(governanceRefreshDelay([ready], 1_000_000)).toBe(21_000);
    expect(governanceRefreshDelay([distant], 1_000_000)).toBe(30_000);
    expect(governanceRefreshDelay([waiting], 1_020_000)).toBe(30_000);
    expect(governanceRefreshDelay([{ ...ready, eta: 1_000n, status: "waiting" }], 1_010_000)).toBe(11_000);
    expect(governanceRefreshDelay([ready], 1_021_000)).toBe(30_000);
    expect(governanceRefreshDelay([], 1_000_000)).toBe(30_000);
  });

  test("derives queue status at render and blocks expired actions locally", () => {
    const staleReady = { ...readyAction, eta: 100n, expiresAt: 200n, status: "ready" } as QueuedBoardroomAction;
    const staleWaiting = { ...staleReady, status: "waiting" } as QueuedBoardroomAction;

    expect(effectiveGovernanceActionStatus(staleWaiting, 150n)).toBe("ready");
    expect(effectiveGovernanceActionStatus(staleReady, 201n)).toBe("expired");
    expect(() => buildGovernanceExecutionRequest(staleReady, 201n)).toThrow("expired");
    expect(() => buildGovernanceVetoRequest(staleReady, 201n)).toThrow("no longer available");

    const html = renderToString(
      <GovernanceQueue
        actions={[staleReady]}
        capabilities={queueCapabilities}
        now={201n}
        pendingAction={undefined}
        runAction={async (_id, action) => action()}
        submitTransaction={async () => undefined}
      />,
    );
    expect(html).toContain("Expired");
    expect(html).not.toContain("Execute now");
    expect(html).not.toContain("Veto action");
  });

  test("renders a confirmed one-way launch workflow with human delay presets", () => {
    expect(governanceDelayPresets(86_400n)[0]?.label).toBe("Minimum — 1 day");
    const html = renderToString(
      <GovernanceLaunchControl
        account={owner}
        boardroom={boardroom}
        capabilities={{ "governance.launch": { status: "enabled" } }}
        currentExecutor={executor}
        minimumDelay={86_400n}
        pendingAction={undefined}
        runAction={async (_id, action) => action()}
        submitTransaction={async () => undefined}
      />,
    );

    expect(html).toContain("Governance executor");
    expect(html).toContain("Minimum — 1 day");
    expect(html).toContain("Custom");
    expect(html).toContain("Launching is permanent");
    expect(html).toContain("owner authority cannot be restored");
    expect(html).toContain("contract-executor queues cannot currently be reconstructed");
    expect(html).toContain("Launch governance");
    expect(html).toContain("disabled");
  });
});
