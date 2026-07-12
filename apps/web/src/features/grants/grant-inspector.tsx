import { isZeroAddress, type Address } from "@pledge.cash/sdk";
import { ArchiveRestore, CheckCircle2, RefreshCw, Send } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { ActionButton, ActionRow, AddressLink, Facts, Field, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { dateString } from "../../lib/forms";
import { formatTokenAmount } from "../../lib/token-amounts";
import type { GrantSnapshot } from "../../lib/types";
import type { Capability } from "../capabilities/project-capabilities";
import { GrantVestingChart } from "./grant-vesting-chart";

type GrantInspectorProps = {
  account: Address | undefined;
  actionCapability: Capability;
  addressLocked?: boolean | undefined;
  grantAddress: string;
  grantSnapshot: GrantSnapshot | undefined;
  issuerActionsAvailable: boolean;
  paymentApproval: string;
  pendingAction: string | undefined;
  settleAmount: string;
  setGrantAddress: (address: string) => void;
  setPaymentApproval: Dispatch<SetStateAction<string>>;
  setSettleAmount: Dispatch<SetStateAction<string>>;
  approvePayment: () => Promise<void>;
  haltGrant: () => Promise<void>;
  loadGrant: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
  settleGrant: () => Promise<void>;
  settleAvailableGrant: () => Promise<void>;
  withdrawExpired: () => Promise<void>;
};

type GrantWalletRole = {
  label: string;
  tone: "default" | "muted" | "warning";
};

type GrantActionEligibility = {
  holderActionsAvailable: boolean;
  issuerActionsAvailable: boolean;
  paymentApprovalAvailable: boolean;
  showSettlementRestriction: boolean;
};

export function GrantInspector({
  account,
  actionCapability,
  addressLocked = false,
  grantAddress,
  grantSnapshot,
  issuerActionsAvailable,
  paymentApproval,
  pendingAction,
  settleAmount,
  setGrantAddress,
  setPaymentApproval,
  setSettleAmount,
  approvePayment,
  haltGrant,
  loadGrant,
  runAction,
  settleGrant,
  settleAvailableGrant,
  withdrawExpired,
}: GrantInspectorProps): React.JSX.Element {
  const walletRole = grantWalletRole(account, grantSnapshot, issuerActionsAvailable);
  const eligibility = grantActionEligibility(account, grantSnapshot, issuerActionsAvailable, actionCapability);
  const facts = grantFacts(grantSnapshot, walletRole);

  return (
    <div className="grid gap-4">
      <Panel
        title="Grant Detail"
        description="Read the grant schedule, payment terms, holder state, and the exact amount that can be settled now."
        action={
          <ActionButton actionId="load-grant" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("load-grant", loadGrant)}>
            <RefreshCw className="h-4 w-4" />
            {addressLocked ? "Refresh" : "Load"}
          </ActionButton>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 p-4">
          <Badge variant={walletRole.tone}>{walletRole.label}</Badge>
          {grantSnapshot?.closed ? <Badge variant="warning">Closed</Badge> : null}
          {grantSnapshot?.halted ? <Badge variant="warning">Halted</Badge> : null}
          {!grantSnapshot ? <Badge variant="muted">Load a grant</Badge> : null}
        </div>
        <div className="border-t border-zinc-800">
          <Field label="Grant address">
            <Input
              aria-readonly={addressLocked}
              readOnly={addressLocked}
              value={grantAddress}
              onChange={(event) => {
                if (!addressLocked) setGrantAddress(event.target.value);
              }}
              spellCheck={false}
            />
          </Field>
        </div>
        <Facts columns="three" items={facts} />
        <GrantVestingChart state={grantSnapshot} tokenMetadata={grantSnapshot?.tokenMetadata} />
      </Panel>

      <Panel
        title="Settlement"
        description="Approve payment when the grant is paid, then settle the vested amount into the holder wallet."
      >
        {grantSnapshot && eligibility.holderActionsAvailable && grantSnapshot.settleable > 0n ? (
          <div className="grid gap-4 border-t border-zinc-800 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div>
              <p className="m-0 text-sm font-semibold text-zinc-100">
                {formatTokenAmount(grantSnapshot.settleable, grantSnapshot.tokenMetadata)} available now
              </p>
              <p className="m-0 mt-1 text-xs leading-5 text-zinc-500">
                {isZeroAddress(grantSnapshot.paymentToken)
                  ? "This grant is free. Review one transaction to settle the currently vested amount."
                  : `${formatTokenAmount(grantSnapshot.settlementCost, grantSnapshot.paymentTokenMetadata)} payment required. The first transaction may approve that exact cost; the next settles the same prepared amount even if more tokens vest.`}
              </p>
            </div>
            <ActionButton
              actionId="settle-available-grant"
              pendingAction={pendingAction}
              title={capabilityReason(actionCapability)}
              onClick={() => void runAction("settle-available-grant", settleAvailableGrant)}
            >
              <Send className="h-4 w-4" />
              Prepare settlement
            </ActionButton>
          </div>
        ) : null}
        <details className="border-t border-zinc-800">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-300 hover:text-zinc-100">
            Advanced settlement controls
          </summary>
          <p className="m-0 border-t border-zinc-800 px-4 pt-4 text-xs leading-5 text-zinc-500">
            Enter exact token units only when you need to override the prepared settlement flow.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2">
            <Field label="Settle amount">
              <Input value={settleAmount} inputMode="decimal" onChange={(event) => setSettleAmount(event.target.value)} />
            </Field>
            <Field label="Payment approval">
              <Input value={paymentApproval} inputMode="decimal" onChange={(event) => setPaymentApproval(event.target.value)} />
            </Field>
          </div>
          <ActionRow>
            <ActionButton
              actionId="approve-payment"
              disabled={!eligibility.paymentApprovalAvailable}
              pendingAction={pendingAction}
              title={capabilityReason(actionCapability)}
              variant="secondary"
              onClick={() => void runAction("approve-payment", approvePayment)}
            >
              <CheckCircle2 className="h-4 w-4" />
              Approve Payment
            </ActionButton>
            <ActionButton
              actionId="settle-grant"
              disabled={!eligibility.holderActionsAvailable}
              pendingAction={pendingAction}
              title={capabilityReason(actionCapability)}
              onClick={() => void runAction("settle-grant", settleGrant)}
            >
              <Send className="h-4 w-4" />
              Settle
            </ActionButton>
          </ActionRow>
        </details>
        <CapabilityNotice capability={actionCapability} />
        {eligibility.showSettlementRestriction ? (
          <p className="m-0 border-t border-zinc-800 p-4 text-sm text-zinc-500">
            Settlement is only available to the current grant holder wallet.
          </p>
        ) : null}
      </Panel>

      {eligibility.issuerActionsAvailable ? (
        <Panel
          title="Issuer Controls"
          description="Issuer actions affect future vesting or expired balances. Review the grant state before signing."
        >
          <ActionRow>
            <ActionButton actionId="halt-grant" disabled={actionCapability.status !== "enabled"} pendingAction={pendingAction} title={capabilityReason(actionCapability)} variant="secondary" onClick={() => void runAction("halt-grant", haltGrant)}>
              <ArchiveRestore className="h-4 w-4" />
              Halt Vesting
            </ActionButton>
            <ActionButton actionId="withdraw-expired" disabled={actionCapability.status !== "enabled"} pendingAction={pendingAction} title={capabilityReason(actionCapability)} variant="secondary" onClick={() => void runAction("withdraw-expired", withdrawExpired)}>
              <ArchiveRestore className="h-4 w-4" />
              Withdraw Expired
            </ActionButton>
          </ActionRow>
          <CapabilityNotice capability={actionCapability} />
        </Panel>
      ) : null}
    </div>
  );
}

function grantFacts(
  grantSnapshot: GrantSnapshot | undefined,
  walletRole: GrantWalletRole,
): { label: string; value: ReactNode }[] {
  if (!grantSnapshot) return [];

  const freeGrant = isZeroAddress(grantSnapshot.paymentToken);
  const paymentToken = freeGrant ? "None" : <AddressLink address={grantSnapshot.paymentToken} />;
  const price = freeGrant ? "Free" : formatTokenAmount(grantSnapshot.price, grantSnapshot.paymentTokenMetadata);

  return [
    { label: "Wallet role", value: walletRole.label },
    { label: "Issuer", value: <AddressLink address={grantSnapshot.issuer} /> },
    { label: "Holder", value: <AddressLink address={grantSnapshot.holder} /> },
    { label: "Grant token", value: <AddressLink address={grantSnapshot.token} /> },
    { label: "Payment token", value: paymentToken },
    { label: "Grant size", value: formatTokenAmount(grantSnapshot.grantSize, grantSnapshot.tokenMetadata) },
    { label: "Claimable", value: formatTokenAmount(grantSnapshot.claimable, grantSnapshot.tokenMetadata) },
    { label: "Settled", value: formatTokenAmount(grantSnapshot.settledAmount, grantSnapshot.tokenMetadata) },
    { label: "Settleable now", value: formatTokenAmount(grantSnapshot.settleable, grantSnapshot.tokenMetadata) },
    { label: "Price", value: price },
    { label: "Vesting cliff", value: dateString(grantSnapshot.vestingCliff) },
    { label: "Vesting end", value: dateString(grantSnapshot.vestingEnd) },
    { label: "Expiry", value: dateString(grantSnapshot.expiry) },
    { label: "Halted", value: grantSnapshot.halted ? "Yes" : "No" },
    { label: "Closed", value: grantSnapshot.closed ? "Yes" : "No" },
  ];
}

function grantWalletRole(
  account: Address | undefined,
  grantSnapshot: GrantSnapshot | undefined,
  issuerActionsAvailable: boolean,
): GrantWalletRole {
  if (!account) return { label: "Read-only", tone: "muted" };
  if (!grantSnapshot) return { label: "Wallet connected", tone: "muted" };
  if (sameAddress(account, grantSnapshot.holder)) return { label: "Grant holder", tone: "default" };
  if (issuerActionsAvailable || sameAddress(account, grantSnapshot.issuer)) return { label: "Issuer controls", tone: "warning" };
  return { label: "Observer", tone: "muted" };
}

function grantActionEligibility(
  account: Address | undefined,
  grantSnapshot: GrantSnapshot | undefined,
  issuerActionsAvailable: boolean,
  actionCapability: Capability,
): GrantActionEligibility {
  const holderActionsAvailable = canSettleGrant(account, grantSnapshot) && actionCapability.status === "enabled";
  const paidGrant = Boolean(grantSnapshot && !isZeroAddress(grantSnapshot.paymentToken));

  return {
    holderActionsAvailable,
    issuerActionsAvailable,
    paymentApprovalAvailable: holderActionsAvailable && paidGrant,
    showSettlementRestriction: Boolean(grantSnapshot && !sameAddress(account, grantSnapshot.holder)),
  };
}

function capabilityReason(capability: Capability): string | undefined {
  return capability.status === "enabled" ? undefined : capability.reason ?? "This action is not available right now.";
}

function CapabilityNotice({ capability }: { capability: Capability }): React.JSX.Element | null {
  const reason = capabilityReason(capability);
  if (!reason) return null;
  return <p aria-live="polite" className="m-0 border-t border-zinc-800 p-4 text-sm text-amber-200">{reason}</p>;
}

function canSettleGrant(account: Address | undefined, grantSnapshot: GrantSnapshot | undefined): boolean {
  if (!account || !grantSnapshot) return false;
  return sameAddress(account, grantSnapshot.holder);
}

function sameAddress(first: Address | undefined, second: Address | undefined): boolean {
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase());
}
