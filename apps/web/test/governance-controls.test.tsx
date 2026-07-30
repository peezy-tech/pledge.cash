import { describe, expect, test } from "bun:test";
import {
  boardroomAbi,
  type BoardroomCall,
  type ScheduledBoardroomOperation,
} from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  GovernanceLaunchControl,
  GovernanceOperations,
  GovernanceProposalComposer,
  buildGovernanceExecutionRequest,
  buildGovernanceVetoRequest,
  controllerConfigurationProposalActionGuard,
  controllerConfigurationProposalIdentity,
  controllerDurationError,
  effectiveGovernanceOperationStatus,
  governanceLaunchIdentity,
  governanceOperationView,
  launchDurationError,
} from "../src/features/governance";
import { governanceRefreshDelay } from "../src/lib/governance-refresh";
import { assertTransactionActionCurrent, TransactionContextGuard } from "../src/lib/transaction-identity";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const proposer = "0x2000000000000000000000000000000000000000" as Address;
const controller = "0x3000000000000000000000000000000000000000" as Address;
const policy = "0x4000000000000000000000000000000000000000" as Address;
const recipient = "0x5000000000000000000000000000000000000000" as Address;
const operationId = `0x${"a".repeat(64)}` as Hex;
const salt = `0x${"b".repeat(64)}` as Hex;
const transactionHash = `0x${"c".repeat(64)}` as Hex;
const facetSetHash = `0x${"d".repeat(64)}` as Hex;

const mintCall: BoardroomCall = {
  policy,
  target: boardroom,
  value: 0n,
  data: encodeFunctionData({
    abi: boardroomAbi,
    functionName: "mint",
    args: [facetSetHash, recipient, 1_000n],
  }),
};

const readyOperation: ScheduledBoardroomOperation = {
  boardroom,
  controller,
  operationId,
  proposer,
  eta: 1_700_000_000n,
  expiresAt: 1_700_604_800n,
  boardroomEpoch: 2n,
  controllerGeneration: 1n,
  configurationEpoch: 3n,
  currentBoardroomEpoch: 2n,
  currentConfigurationEpoch: 3n,
  operationStatus: 1,
  salt,
  scheduleBlockNumber: 100n,
  scheduleTransactionHash: transactionHash,
  status: "ready",
  facetSetHash,
  currentFacetSetHash: facetSetHash,
  kind: "boardroomOperation",
  calls: [mintCall],
};

const operationCapabilities = {
  "governance.executeReady": { status: "enabled" as const },
  "governance.veto": { status: "enabled" as const },
};

describe("external controller governance controls", () => {
  test("decodes and presents a ready operation before exposing execution", () => {
    const view = governanceOperationView(readyOperation, 1_700_100_000n);
    expect(view.title).toBe("Mint project shares");
    expect(view.statusLabel).toBe("Ready to execute");
    expect(view.calls[0]).toMatchObject({
      functionName: "mint",
      signature: "mint(bytes32,address,uint256)",
      verification: "verified",
    });

    const html = renderToString(
      <GovernanceOperations
        account={proposer}
        operations={[readyOperation]}
        capabilities={operationCapabilities}
        now={1_700_100_000n}
        pendingAction={undefined}
        runAction={async (_id, action) => action()}
        submitTransaction={async () => undefined}
      />,
    );

    expect(html).toContain("Mint project shares");
    expect(html).toContain("Verified decode");
    expect(html).toContain("Boardroom epoch");
    expect(html).toContain("Configuration epoch");
    expect(html).toContain("Veto operation");
    expect(html).toContain("Execute now");
  });

  test("executes through the controller while preserving the scheduled proposer as authority", () => {
    const request = buildGovernanceExecutionRequest(readyOperation, 1_700_100_000n);
    expect(request).toMatchObject({
      address: controller,
      functionName: "executeBoardroomOperation",
    });
    expect(request.args).toEqual([facetSetHash, [mintCall], salt, 2n, 3n, proposer]);
    expect(buildGovernanceVetoRequest(readyOperation, 1_700_100_000n)).toMatchObject({
      address: boardroom,
      functionName: "veto",
      args: [facetSetHash, operationId],
    });
  });

  test("does not expose execution when scheduled calldata is unverified", () => {
    const unverified: ScheduledBoardroomOperation = {
      ...readyOperation,
      calls: undefined,
      kind: undefined,
      payloadError: "Scheduled calldata could not be decoded.",
    };
    const html = renderToString(
      <GovernanceOperations
        operations={[unverified]}
        capabilities={operationCapabilities}
        now={1_700_100_000n}
        pendingAction={undefined}
        runAction={async (_id, action) => action()}
        submitTransaction={async () => undefined}
      />,
    );
    expect(html).toContain("Scheduled calldata verification failed");
    expect(html).toContain("disabled");
  });

  test("labels an unknown inner call as unverified and disables execution", () => {
    const unknown: ScheduledBoardroomOperation = {
      ...readyOperation,
      calls: [{ ...mintCall, target: recipient, data: "0xdeadbeef" }],
    };
    const html = renderToString(
      <GovernanceOperations
        operations={[unknown]}
        capabilities={operationCapabilities}
        now={1_700_100_000n}
        pendingAction={undefined}
        runAction={async (_id, action) => action()}
        submitTransaction={async () => undefined}
      />,
    );
    expect(html).toContain("Unverified call 0xdeadbeef");
    expect(html).toContain("will not offer execution");
  });

  test("refreshes at ETA and expiry boundaries", () => {
    const waiting = { ...readyOperation, status: "waiting", eta: 1_010n } as ScheduledBoardroomOperation;
    const ready = { ...readyOperation, status: "ready", expiresAt: 1_020n } as ScheduledBoardroomOperation;
    expect(governanceRefreshDelay([waiting], 1_000_000)).toBe(11_000);
    expect(governanceRefreshDelay([ready], 1_000_000)).toBe(21_000);
    expect(governanceRefreshDelay([], 1_000_000)).toBe(30_000);
  });

  test("derives operation status locally and blocks expired operations", () => {
    const stale = { ...readyOperation, eta: 100n, expiresAt: 200n } as ScheduledBoardroomOperation;
    expect(effectiveGovernanceOperationStatus({ ...stale, status: "waiting" }, 150n)).toBe("ready");
    expect(effectiveGovernanceOperationStatus(stale, 201n)).toBe("expired");
    expect(() => buildGovernanceExecutionRequest(stale, 201n)).toThrow("expired");
    expect(() => buildGovernanceVetoRequest(stale, 201n)).toThrow("no longer available");
  });

  test("renders the generation-1 launch binding without choosing timing defaults", () => {
    expect(launchDurationError(86_400n, 86_400n, 86_400n)).toBeUndefined();
    expect(launchDurationError(undefined, 86_400n, 86_400n)).toContain("each launch duration");
    const html = renderToString(
      <GovernanceLaunchControl
        account={proposer}
        boardroom={boardroom}
        capability={{ status: "enabled" }}
        pendingAction={undefined}
        predictedController={controller}
        redemptionExcessRecipient={recipient}
        rewardPool={policy}
        runAction={async (_id, action) => action()}
        submitLaunch={async () => undefined}
      />,
    );
    expect(html).toContain("Launch generation-1 controller");
    expect(html).toContain("Protection staker");
    expect(html).toContain("ERC-1271 contract such as a Safe");
    expect(html).toContain("No administrator or emergency-delay bypass");
    expect(html).toContain("disabled");
  });

  test("prepares delayed controller configuration self-governance", () => {
    expect(controllerDurationError(86_400n, 604_800n)).toBeUndefined();
    const html = renderToString(
      <GovernanceProposalComposer
        boardroom={boardroom}
        capability={{ status: "enabled" }}
        configurationEpoch={3n}
        controller={controller}
        controllerDelay={86_400n}
        controllerGeneration={1n}
        currentProposer={proposer}
        governanceEpoch={2n}
        gracePeriod={604_800n}
        now={1_700_000_000n}
        pendingAction={undefined}
        predictedNextController={recipient}
        scheduleConfigurationChange={async () => undefined}
        scheduleControllerReplacement={async () => undefined}
        runAction={async (_id, action) => action()}
      />,
    );
    expect(html).toContain("Change the proposer or controller timing");
    expect(html).toContain("Current proposer");
    expect(html).toContain("Predicted generation 2");
    expect(html).toContain("Replace with generation 2");
    expect(html).toContain("deploys the next controller atomically");
    expect(html).toContain("Scheduling does not change authority immediately");
  });

  test("blocks a stale configuration proposal after its inputs change", async () => {
    const initialIdentity = controllerConfigurationProposalIdentity({
      boardroom,
      configurationEpoch: 3n,
      controller,
      currentProposer: proposer,
      delayInput: "86400",
      governanceEpoch: 2n,
      graceInput: "604800",
      proposerInput: recipient,
    });
    const guard = new TransactionContextGuard(initialIdentity);
    const actionGuard = controllerConfigurationProposalActionGuard(guard, guard.capture());
    const simulation = deferred<void>();
    const submission = (async () => {
      assertTransactionActionCurrent(actionGuard, "simulation");
      await simulation.promise;
      assertTransactionActionCurrent(actionGuard, "submission");
    })();
    guard.sync(governanceLaunchIdentity({
      boardroom,
      controllerDelayInput: "86400",
      gracePeriodInput: "604800",
      predictedController: controller,
      proposerInput: policy,
      protectionStakerInput: proposer,
      redemptionExcessRecipient: recipient,
      rewardPool: policy,
      windDownDelayInput: "86400",
    }));
    simulation.resolve();
    await expect(submission).rejects.toThrow("action details changed");
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
