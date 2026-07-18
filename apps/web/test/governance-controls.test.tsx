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
  GovernanceProposalComposer,
  GovernanceQueue,
  buildGovernanceExecutionRequest,
  buildGovernanceVetoRequest,
  effectiveGovernanceActionStatus,
  governanceActionView,
  governanceDelayPresets,
  executorProposalActionGuard,
  executorProposalError,
  executorProposalIdentity,
} from "../src/features/governance";
import { governanceRefreshDelay } from "../src/lib/governance-refresh";
import { assertTransactionActionCurrent, TransactionContextGuard } from "../src/lib/transaction-identity";

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

  test("blocks unbound legacy launches and explains the required contract upgrade", () => {
    expect(governanceDelayPresets(86_400n)[0]?.label).toBe("Minimum — 1 day");
    const html = renderToString(
      <GovernanceLaunchControl
        boardroom={boardroom}
        currentExecutor={executor}
        minimumDelay={86_400n}
      />,
    );

    expect(html).toContain("Secure governance launch is unavailable");
    expect(html).toContain("launch(uint256)");
    expect(html).toContain("pending owner transaction could change the executor");
    expect(html).toContain("will not submit or certify");
    expect(html).toContain(executor);
    expect(html).toContain("1 day");
    expect(html).not.toContain("<button");
  });

  test("prepares a decoded executor-rotation proposal without implying immediate authority", () => {
    expect(executorProposalError("", executor)).toContain("Enter the proposed executor");
    expect(executorProposalError(executor, executor)).toContain("other than the current executor");
    expect(executorProposalError(recipient, executor)).toBeUndefined();
    const html = renderToString(
      <GovernanceProposalComposer
        boardroom={boardroom}
        capability={{ status: "enabled" }}
        currentExecutor={executor}
        governanceDelay={86_400n}
        gracePeriod={604_800n}
        now={1_700_000_000n}
        pendingAction={undefined}
        queueExecutorChange={async () => undefined}
        runAction={async (_id, action) => action()}
      />,
    );
    expect(html).toContain("Change who can queue project decisions");
    expect(html).toContain("Current executor");
    expect(html).toContain(executor);
    expect(html).toContain("Queueing does not change authority immediately");
    expect(html).toContain("Review proposal");
    expect(html).toContain("disabled");
  });

  test("blocks a stale executor proposal after the input changes during deferred simulation", async () => {
    const initialIdentity = executorProposalIdentity({ boardroom, currentExecutor: executor, executorInput: recipient });
    const proposalGuard = new TransactionContextGuard(initialIdentity);
    const actionGuard = executorProposalActionGuard(proposalGuard, proposalGuard.capture());
    const simulation = deferred<void>();
    let walletSubmissions = 0;
    const submission = (async () => {
      assertTransactionActionCurrent(actionGuard, "simulation");
      await simulation.promise;
      assertTransactionActionCurrent(actionGuard, "submission");
      walletSubmissions += 1;
    })();

    proposalGuard.sync(executorProposalIdentity({ boardroom, currentExecutor: executor, executorInput: policy }));
    simulation.resolve();

    await expect(submission).rejects.toThrow("action details changed");
    expect(walletSubmissions).toBe(0);
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
