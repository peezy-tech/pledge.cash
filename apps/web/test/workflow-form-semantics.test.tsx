import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import type { PublicClient } from "viem";
import { GrantVerificationLoadingState, StudioPage, studioGuidance } from "../src/app/pages";
import { WIND_DOWN_IRREVERSIBLE_WARNING, WindDownPanel } from "../src/features/boardrooms/boardroom-panel";
import { windDownCoverage } from "../src/features/boardrooms/boardroom-panel-shared";
import { GrantInspector } from "../src/features/grants/grant-inspector";
import {
  ClaimTicketLoadForm,
  MerkleAirdropFlow,
  claimTicketVerificationControlState,
} from "../src/features/participation/merkle-airdrop-flow";
import type { ProductBoardroomDashboardState } from "../src/lib/product-boardroom";
import type { BoardroomDistributionSnapshot, BoardroomSnapshot, GrantSnapshot } from "../src/lib/types";

const grant = "0x1000000000000000000000000000000000000000" as Address;
const issuer = "0x2000000000000000000000000000000000000000" as Address;
const holder = "0x3000000000000000000000000000000000000000" as Address;
const token = "0x4000000000000000000000000000000000000000" as Address;
const paymentToken = "0x5000000000000000000000000000000000000000" as Address;
const boardroom = "0x6000000000000000000000000000000000000000" as Address;
const airdrop = "0x7000000000000000000000000000000000000000" as Address;
const zeroHash = `0x${"00".repeat(32)}` as const;

const grantSnapshot: GrantSnapshot = {
  address: grant,
  issuer,
  holder,
  token,
  paymentToken,
  grantSize: 100n,
  claimable: 50n,
  price: 1n,
  vestingCliff: 0n,
  vestingEnd: 0n,
  expiry: 9_999_999_999n,
  settledAmount: 0n,
  settleable: 25n,
  settlementCost: 5n,
  halted: false,
  closed: false,
  tokenMetadata: { address: token, decimals: 18, symbol: "SHARE" },
  paymentTokenMetadata: { address: paymentToken, decimals: 6, symbol: "USDC" },
};

const airdropDistribution: BoardroomDistributionSnapshot = {
  address: airdrop,
  kind: "merkle-airdrop",
  state: {
    address: airdrop,
    factory: issuer,
    boardroom,
    shareToken: token,
    tokenGrantFactory: issuer,
    airdropSupply: 100n,
    claimedShares: 0n,
    remainingShares: 100n,
    merkleRoot: zeroHash,
    startTime: 0n,
    endTime: 0n,
    maxGrantClaims: 10,
    claimedGrantCount: 0,
    airdropStatus: 0,
    closed: false,
  },
  shareTokenMetadata: { address: token, decimals: 18, symbol: "SHARE" },
};

const dashboard = {
  address: boardroom,
  catalog: [],
  nativeBalance: 0n,
  snapshot: {
    address: boardroom,
    owner: issuer,
    policyRegistry: issuer,
    wrappedNative: issuer,
    shareToken: token,
    status: 0,
    launched: true,
    executor: issuer,
    governanceDelay: 86_400n,
    governanceEpoch: 1n,
    governanceEligibleSupply: 100n,
    governanceConfig: { minimumDelay: 86_400n, actionGracePeriod: 604_800n, vetoBps: 2_000n, windDownBps: 3_000n },
    redeemableAssets: [],
    issuedGrants: [],
    issuedDistributions: [airdrop],
    lockedLiquidityPositions: [],
    grantSummaries: [],
    distributionSummaries: [airdropDistribution],
    lockedLiquiditySummaries: [],
  },
  treasuryAssets: [],
} as ProductBoardroomDashboardState;

const noop = async (): Promise<void> => undefined;
const noopSetter = (): void => undefined;

describe("workflow form semantics", () => {
  test("marks grant verification as busy status and supports an optional return action", () => {
    const html = renderToString(
      <GrantVerificationLoadingState
        backHref="/portfolio?chain=31337"
        grant={grant}
        returnLabel="Return to Portfolio"
        onBack={() => undefined}
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("factory provenance");
    expect(html).toContain('href="/portfolio?chain=31337"');
    expect(html).toContain("Return to Portfolio");
  });

  test("routes Enter in approval and settlement fields to separate submit actions", () => {
    const html = renderGrantInspector({
      account: holder,
      capability: { status: "switch", reason: "Switch your wallet to chain 31337 to continue." },
      paymentApproval: "not-an-amount",
      settleAmount: "1..2",
    });
    const forms = html.match(/<form[\s\S]*?<\/form>/g) ?? [];
    const approvalForm = forms.find((form) => form.includes('id="grant-payment-approval"'));
    const settlementForm = forms.find((form) => form.includes('id="grant-settle-amount"'));
    const preparedForm = forms.find((form) => form.includes("Prepare settlement"));

    expect(forms).toHaveLength(3);
    expect(preparedForm).toContain('type="submit"');
    expect(preparedForm).not.toContain("Approve payment");
    expect(approvalForm).toContain('type="submit"');
    expect(approvalForm).toContain("Approve payment");
    expect(approvalForm).not.toContain("Settle exact amount");
    expect(settlementForm).toContain('type="submit"');
    expect(settlementForm).toContain("Settle exact amount");
    expect(settlementForm).not.toContain("Approve payment");
    expect(html).toContain('type="button"');
    expect(html).toContain('for="grant-settle-amount"');
    expect(html).toContain('aria-errormessage="grant-settle-amount-error"');
    expect(html).toContain('for="grant-payment-approval"');
    expect(html).toContain('aria-errormessage="grant-payment-approval-error"');
    expect(html).toContain('aria-describedby="grant-settlement-disabled-reason"');
    expect(html).toContain('id="grant-settlement-disabled-reason"');
    expect(html).toContain("Switch your wallet to chain 31337 to continue.");
  });

  test.each([
    ["0", "zero"],
    ["0.0", "decimal zero"],
    ["0.0000000000000000001", "a sub-base-unit amount"],
  ])("rejects %s as %s for exact grant settlement", (settleAmount) => {
    const html = renderGrantInspector({
      account: holder,
      paymentApproval: "0",
      settleAmount,
    });
    const settlementForm = (html.match(/<form[\s\S]*?<\/form>/g) ?? [])
      .find((form) => form.includes('id="grant-settle-amount"'));

    expect(settlementForm).toContain('aria-invalid="true"');
    expect(settlementForm).toContain('aria-errormessage="grant-settle-amount-error"');
    expect(settlementForm).toContain('id="grant-settle-amount-error"');
    expect(settlementForm).toContain("Settle amount must be greater than zero.");
    expect(settlementForm).toContain('disabled=""');
  });

  test("accepts one base unit for exact grant settlement", () => {
    const html = renderGrantInspector({
      account: holder,
      paymentApproval: "0",
      settleAmount: "0.000000000000000001",
    });
    const settlementForm = (html.match(/<form[\s\S]*?<\/form>/g) ?? [])
      .find((form) => form.includes('id="grant-settle-amount"'));

    expect(settlementForm).not.toContain('aria-invalid="true"');
    expect(settlementForm).not.toContain('aria-errormessage="grant-settle-amount-error"');
    expect(settlementForm).not.toContain("Settle amount must be greater than zero.");
    expect(settlementForm).not.toContain('disabled=""');
  });

  test("keeps zero payment approval available for allowance revocation", () => {
    const html = renderGrantInspector({
      account: holder,
      paymentApproval: "0",
      settleAmount: "1",
    });
    const approvalForm = (html.match(/<form[\s\S]*?<\/form>/g) ?? [])
      .find((form) => form.includes('id="grant-payment-approval"'));

    expect(approvalForm).not.toContain('aria-invalid="true"');
    expect(approvalForm).not.toContain('aria-errormessage="grant-payment-approval-error"');
    expect(approvalForm).not.toContain('disabled=""');
  });

  test("keeps grant pending labels stable and hides holder controls from observers", () => {
    const pending = renderGrantInspector({
      account: holder,
      pendingAction: "settle-grant",
      paymentApproval: "5",
      settleAmount: "25",
    });
    const observer = renderGrantInspector({
      account: issuer,
      paymentApproval: "5",
      settleAmount: "25",
    });

    expect(pending).toContain("Settle exact amount");
    expect(pending).toContain("Submitting the exact grant settlement");
    expect(pending).toContain('aria-busy="true"');
    expect(observer).toContain("Settlement is only available to the current grant holder wallet.");
    expect(observer).not.toContain("Prepare settlement");
    expect(observer).not.toContain("Advanced settlement controls");
  });

  test("gives claim-ticket verification an independent pending API and semantic form", () => {
    expect(claimTicketVerificationControlState("ticket", false)).toEqual({
      disabled: false,
      pendingLabel: undefined,
    });
    expect(claimTicketVerificationControlState("ticket", true)).toEqual({
      disabled: true,
      pendingLabel: "Verifying claim ticket against the onchain Merkle root",
    });

    const html = renderToString(
      <ClaimTicketLoadForm
        error="This ticket belongs to a different wallet."
        pending
        value="ticket"
        onChange={() => undefined}
        onSubmit={noop}
      />,
    );

    expect(html).toContain("<form");
    expect(html).toContain('type="submit"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(">Verify and load</button>");
    expect(html).toContain("Verifying claim ticket against the onchain Merkle root");
    expect(html).toContain('aria-errormessage="airdrop-claim-ticket-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="airdrop-claim-ticket-error"');
    expect(html).toContain('role="alert"');
  });

  test("uses a submit form for the exact airdrop claim and button types for secondary controls", () => {
    const html = renderToString(
      <MerkleAirdropFlow
        account={holder}
        chainId={31337}
        dashboard={dashboard}
        distribution={airdropDistribution}
        pendingAction={undefined}
        publicClient={{ readContract: async () => zeroHash } as unknown as PublicClient}
        runAction={async (_label, action) => action()}
        submitTransaction={noop}
      />,
    );

    expect(html.match(/<form/g)?.length).toBe(2);
    expect(html).toContain("Claim project tokens");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*><span[^>]*><\/span><span[^>]*>Claim project tokens<\/span><\/button>/);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('type="button"');
    expect(html).toContain("Proofs are allocation-specific");
    expect(html).toContain("wallet, index, amount, contract, and chain");
  });

  test("keeps Open Redemptions disabled when bounded obligation coverage is incomplete", () => {
    const issuedGrants = Array.from({ length: 65 }, (_, index) =>
      `0x${(8_000 + index).toString(16).padStart(40, "0")}` as Address);
    const redeemableAssets = Array.from({ length: 65 }, (_, index) =>
      `0x${(9_000 + index).toString(16).padStart(40, "0")}` as Address);
    const loadedOpenGrant = issuedGrants.at(-1)!;
    const snapshot: BoardroomSnapshot = {
      ...dashboard.snapshot,
      status: 1,
      issuedGrants,
      redeemableAssets,
      grantSummaries: issuedGrants.slice(1).map((address) => ({
        address,
        state: {
          ...grantSnapshot,
          address,
          closed: address !== loadedOpenGrant,
        } as never,
      })),
    };
    const html = renderToString(
      <WindDownPanel
        boardroomSnapshot={snapshot}
        claimCapability={{ status: "enabled" }}
        pendingAction={undefined}
        permissionlessCapability={{ status: "enabled" }}
        redeemCapability={{ status: "enabled" }}
        registerCapability={{ status: "enabled" }}
        setWindDownForm={noopSetter}
        startCapability={{ status: "enabled" }}
        windDownForm={{
          redeemableAsset: "",
          redeemShares: "",
          redeemRecipient: "",
          minAmountsOut: "",
          claimAsset: "",
          claimRecipient: "",
          claimMinAmount: "",
        }}
        burnTreasuryShares={noop}
        claimRedemptionAsset={noop}
        openRedemptions={noop}
        redeemBoardroomShares={noop}
        registerRedeemableAsset={noop}
        runAction={async (_label, action) => action()}
        startWindDown={noop}
      />,
    );
    const openButton = (html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [])
      .find((button) => button.includes("Open Redemptions"));

    expect(openButton).toContain('disabled=""');
    expect(html).toContain("Obligation coverage is incomplete.");
    expect(html).toContain("Grant coverage is incomplete: 64 of 65 records were loaded.");
    expect(html).toContain("Redeemable-asset coverage is incomplete: 64 of 65 records were loaded.");
    expect(html).toContain("older obligations may be omitted");
    expect(html).toContain("Refresh the Boardroom state and retry");
    expect(html).toContain(`Copy address ${loadedOpenGrant}`);
    expect(html).toContain("2 loaded + unknown");
    expect(html).not.toContain("No loaded blockers.");
    expect(html).not.toContain("All tracked obligation reads are complete, and no blockers remain.");
  });

  test("treats every bounded wind-down child collection as unknown when coverage is incomplete", () => {
    const redeemableAssets = Array.from({ length: 65 }, (_, index) =>
      `0x${(10_000 + index).toString(16).padStart(40, "0")}` as Address);
    const coverage = windDownCoverage({
      ...dashboard.snapshot,
      issuedGrants: [grant],
      issuedDistributions: [airdrop],
      lockedLiquidityPositions: [token],
      redeemableAssets,
      grantSummaries: [],
      distributionSummaries: [],
      lockedLiquiditySummaries: [],
    });

    expect(coverage.complete).toBe(false);
    expect(coverage.issues).toEqual([
      "Grant coverage is incomplete: 0 of 1 records were loaded.",
      "Distribution coverage is incomplete: 0 of 1 records were loaded.",
      "Locked-liquidity coverage is incomplete: 0 of 1 records were loaded.",
      "Redeemable-asset coverage is incomplete: 64 of 65 records were loaded.",
    ]);
  });

  test("preserves lifecycle, irreversible, and provenance safety copy", () => {
    const studio = renderToString(
      <StudioPage lifecycle="pre-launch" loading={false} operatorTools={<div>Operator workflow</div>} />,
    );

    expect(studio).toContain("Next safe action");
    expect(studio).toContain("Launch is a one-way authority transition");
    expect(studio).toContain("Then act here");
    expect(studioGuidance("pre-launch", undefined).nextStepDetail).toContain("one-way authority transition");
    expect(WIND_DOWN_IRREVERSIBLE_WARNING).toContain("Starting wind-down is irreversible");
    expect(WIND_DOWN_IRREVERSIBLE_WARNING).toContain("cleanup plan required before redemptions can open");
  });
});

function renderGrantInspector(input: {
  account: Address;
  capability?: { status: "enabled" | "switch"; reason?: string };
  paymentApproval: string;
  pendingAction?: string;
  settleAmount: string;
}): string {
  return renderToString(
    <GrantInspector
      account={input.account}
      actionCapability={input.capability ?? { status: "enabled" }}
      approvePayment={noop}
      grantAddress={grant}
      grantSnapshot={grantSnapshot}
      haltGrant={noop}
      issuerActionsAvailable={false}
      loadGrant={noop}
      paymentApproval={input.paymentApproval}
      pendingAction={input.pendingAction}
      runAction={async (_label, action) => action()}
      setGrantAddress={noopSetter}
      setPaymentApproval={noopSetter}
      setSettleAmount={noopSetter}
      settleAmount={input.settleAmount}
      settleAvailableGrant={noop}
      settleGrant={noop}
      withdrawExpired={noop}
    />,
  );
}
