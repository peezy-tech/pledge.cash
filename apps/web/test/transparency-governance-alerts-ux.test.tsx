import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import { GovernancePage } from "../src/app/pages/governance-page";
import { TransparencyPage } from "../src/app/pages/transparency-page";
import { GovernanceProposalComposer, executorProposalError } from "../src/features/governance/governance-proposal-composer";
import { DeliveryActivity } from "../src/features/notifications/delivery-activity";
import {
  SubscriptionSettings,
  alertRulePendingPresentation,
  boardroomDraftError,
} from "../src/features/notifications/subscription-settings";
import type { ProductBoardroomDashboardState } from "../src/lib/product-boardroom";
import type { SentinelClient } from "../src/lib/sentinel";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const owner = "0x2000000000000000000000000000000000000000" as Address;
const shareToken = "0x3000000000000000000000000000000000000000" as Address;
const paymentToken = "0x4000000000000000000000000000000000000000" as Address;
const sale = "0x5000000000000000000000000000000000000000" as Address;
const grant = "0x6000000000000000000000000000000000000000" as Address;
const pool = "0x7000000000000000000000000000000000000000" as Address;
const executor = "0x8000000000000000000000000000000000000000" as Address;
const recipient = "0x9000000000000000000000000000000000000000" as Address;
const zero = "0x0000000000000000000000000000000000000000" as Address;

const dashboard: ProductBoardroomDashboardState = {
  address: boardroom,
  catalog: [{
    address: boardroom,
    distribution: sale,
    distributionKind: "fixed-price-sale",
    name: "Atlas Cooperative",
    path: "Fixed-price launch",
    shareToken,
    status: "Active",
  }],
  currentStateCoverage: {
    distributions: { complete: true, shown: 1, total: 1 },
    grants: { complete: true, shown: 1, total: 1 },
    lockedLiquidity: { complete: false, shown: 0, total: 1 },
    redeemableAssets: { complete: true, shown: 1, total: 1 },
  },
  histories: [{
    amm: {
      amount0In: 1n,
      amount0Out: 2n,
      amount1In: 3n,
      amount1Out: 4n,
      swapCount: 5,
      traderCount: 3,
    },
    completeness: "complete",
    distribution: sale,
    pool,
    soldShares: 2_000_000_000_000_000_000n,
  }],
  nativeBalance: 1_000_000_000_000_000_000n,
  snapshot: {
    address: boardroom,
    distributionSummaries: [{
      address: sale,
      kind: "fixed-price-sale",
      paymentTokenMetadata: { address: paymentToken, decimals: 6, symbol: "USDC" },
      shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "ATLAS" },
      state: {
        address: sale,
        boardroom,
        closed: false,
        endTime: 9_999_999_999n,
        factory: recipient,
        maxPerBuyer: 2_000_000_000_000_000_000n,
        paymentToken,
        price: 3_000_000n,
        remainingShares: 8_000_000_000_000_000_000n,
        saleStatus: 0,
        saleSupply: 10_000_000_000_000_000_000n,
        shareToken,
        startTime: 1n,
      },
    }],
    executor,
    governanceConfig: {
      actionGracePeriod: 604_800n,
      minimumDelay: 86_400n,
      vetoBps: 2_000n,
      windDownBps: 3_000n,
    },
    governanceDelay: 86_400n,
    governanceEligibleSupply: 8_000_000_000_000_000_000n,
    governanceEpoch: 2n,
    grantSummaries: [{
      address: grant,
      state: {
        address: grant,
        claimable: 500_000_000_000_000_000n,
        closed: false,
        expired: false,
        expiry: 0n,
        factory: recipient,
        grantSize: 1_000_000_000_000_000_000n,
        halted: false,
        holder: owner,
        issuer: boardroom,
        paymentToken: zero,
        paymentTokenDecimals: 18,
        price: 0n,
        quarantined: false,
        quarantinedAmount: 0n,
        settleable: 500_000_000_000_000_000n,
        settledAmount: 250_000_000_000_000_000n,
        token: shareToken,
        tokenDecimals: 18,
        tokenId: 1n,
        transferLocked: true,
        transferUnlockTime: 0n,
        transferable: false,
        unsettledAmount: 750_000_000_000_000_000n,
        vestingCliff: 0n,
        vestingEnd: 0n,
      },
      tokenMetadata: { address: shareToken, decimals: 18, symbol: "ATLAS" },
    }],
    issuedDistributions: [sale],
    issuedGrants: [grant],
    launched: true,
    lockedLiquidityPositions: [pool],
    lockedLiquiditySummaries: [],
    owner,
    policyRegistry: recipient,
    redeemableAssets: [paymentToken],
    shareToken,
    shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "ATLAS" },
    status: 0,
    wrappedNative: recipient,
  },
  treasuryAssets: [
    { address: shareToken, balance: 12_000_000_000_000_000_000n, decimals: 18, label: "Treasury shares", symbol: "ATLAS", totalSupply: 100_000_000_000_000_000_000n },
    { address: paymentToken, balance: 6_000_000n, decimals: 6, label: "Cash / quote", symbol: "USDC", totalSupply: 1_000_000_000n },
  ],
};

const sentinelClient = {
  listNotificationDeliveries: async () => ({ items: [], page: { limit: 10, nextCursor: null } }),
  putSubscription: async () => ({ boardrooms: [], minSeverity: "medium", mode: "holdings" }),
} as unknown as SentinelClient;

describe("transparency evidence semantics", () => {
  test("separates current state from lifetime history and scopes evidence tables", () => {
    const html = renderToString(<TransparencyPage dashboard={dashboard} loading={false} />);

    expect(html).toContain("Current state");
    expect(html).toContain("Current treasury, supply, commitments, liquidity, and coverage summary");
    expect(html).toContain("Evidence coverage");
    expect(html).toContain("Missing records remain unknown");
    expect(html).toContain("Lifetime participation history");
    expect(html).toContain("24h market data is not indexed");
    expect(html).toContain("Current liquidity positions");
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain("sm:grid-cols-2 xl:grid-cols-5");
  });
});

describe("governance authority and proposal semantics", () => {
  test("keeps authority, queue coverage, and optional alerts unavailability explicit", () => {
    const html = renderToString(
      <GovernancePage
        alertsAction={<a href="/settings/alerts">Review alert setup</a>}
        alertsUnavailable
        dashboard={dashboard}
        loading={false}
        warning="One queued decision could not be verified."
      />,
    );

    expect(html).toContain("Current authority");
    expect(html).toContain("Governance delay");
    expect(html).toContain("Queue coverage");
    expect(html).toContain("Partial");
    expect(html).toContain("Governance alerts unavailable");
    expect(html).toContain("Alert sign-in is an offchain notification identity and never authorizes transactions");
    expect(html).toContain('href="/settings/alerts"');
    expect(html).toContain("Protocol identifiers");
  });

  test("uses a described semantic form and concise pending label for executor proposals", () => {
    const ready = renderToString(
      <GovernanceProposalComposer
        boardroom={boardroom}
        capability={{ status: "enabled" }}
        currentExecutor={executor}
        governanceDelay={86_400n}
        gracePeriod={604_800n}
        pendingAction={undefined}
        queueExecutorChange={async () => undefined}
        runAction={async (_id, action) => action()}
      />,
    );
    const pending = renderToString(
      <GovernanceProposalComposer
        boardroom={boardroom}
        capability={{ status: "enabled" }}
        currentExecutor={executor}
        governanceDelay={86_400n}
        gracePeriod={604_800n}
        pendingAction="governance-queue-executor-change"
        queueExecutorChange={async () => undefined}
        runAction={async (_id, action) => action()}
      />,
    );

    expect(ready).toContain('<form aria-label="Executor rotation proposal"');
    expect(ready).toContain('name="executor"');
    expect(ready).toContain("aria-describedby");
    expect(ready).toContain('type="submit"');
    expect(executorProposalError("not-an-address", executor)).toBe("Enter a valid executor address.");
    expect(pending).toContain("Queueing proposal");
    expect(pending).toContain("Queueing executor proposal");
  });
});

describe("alert rule form and mobile controls", () => {
  test("renders semantic forms, stable labels, pressed modes, and 44px stacked controls", () => {
    const html = renderToString(
      <SubscriptionSettings
        client={sentinelClient}
        onChanged={async () => undefined}
        suggestedBoardroom={{ address: boardroom, chainId: 31337 }}
        subscription={{ boardrooms: [], minSeverity: "medium", mode: "explicit" }}
      />,
    );

    expect(html).toContain('aria-label="Alert rule settings"');
    expect(html).toContain('aria-label="Add a Boardroom to alert rules"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("min-h-11 w-full");
    expect(html).toContain("flex-col");
    expect(html).toContain("Add Boardroom");
    expect(html).toMatch(/<label[^>]+for="[^"]+"[^>]*>Chain ID<\/label>/);
    expect(html).toMatch(/<label[^>]+for="[^"]+"[^>]*>Boardroom<\/label>/);
  });

  test("keeps Save and suggested Watch pending presentation independent", () => {
    expect(alertRulePendingPresentation("save")).toEqual({ any: true, save: true, watch: false });
    expect(alertRulePendingPresentation("watch")).toEqual({ any: true, save: false, watch: true });
    expect(alertRulePendingPresentation(undefined)).toEqual({ any: false, save: false, watch: false });
  });

  test("returns concise address errors for described draft fields", () => {
    expect(boardroomDraftError("", "", [])).toBe("Enter a valid chain ID.");
    expect(boardroomDraftError("31337", "bad", [])).toBe("Enter a valid Boardroom address.");
    expect(boardroomDraftError("31337", boardroom, [{ address: boardroom, chainId: 31337 }])).toBe("That Boardroom is already listed.");
  });

  test("announces delivery transitions without making the receipt list live", () => {
    const html = renderToString(<DeliveryActivity client={sentinelClient} />);

    expect(html).toContain('role="status"');
    expect(html).toContain("Loading delivery receipts.");
    expect(html).toContain('<div aria-busy="true">');
    expect(html).not.toContain('<div aria-busy="true" aria-live=');
    expect(html).not.toMatch(/<ol[^>]+aria-live=/);
  });
});
