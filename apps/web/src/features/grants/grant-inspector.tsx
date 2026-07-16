import { isZeroAddress, type Address } from "@pledge.cash/sdk";
import { ArchiveRestore, CheckCircle2, RefreshCw, Send } from "lucide-react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { parseUnits } from "viem";
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
  holderAuthorized: boolean;
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
  const settleAmountError = positiveDecimalAmountError(
    settleAmount,
    "Settle amount",
    grantSnapshot?.tokenMetadata?.decimals,
  );
  const paymentApprovalError = decimalAmountError(paymentApproval, "Payment approval");
  const settlementDisabledReason = capabilityReason(actionCapability);
  const settlementDisabledReasonId = settlementDisabledReason ? "grant-settlement-disabled-reason" : undefined;
  const submitPreparedSettlement = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!eligibility.holderActionsAvailable) return;
    void runAction("settle-available-grant", settleAvailableGrant);
  };
  const submitPaymentApproval = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!eligibility.paymentApprovalAvailable || paymentApprovalError) return;
    void runAction("approve-payment", approvePayment);
  };
  const submitAdvancedSettlement = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!eligibility.holderActionsAvailable || settleAmountError) return;
    void runAction("settle-grant", settleGrant);
  };

  return (
    <div className="grid gap-4">
      <Panel
        title="Grant Detail"
        description="Read the grant schedule, payment terms, holder state, and the exact amount that can be settled now."
        action={
          <ActionButton
            actionId="load-grant"
            pendingAction={pendingAction}
            pendingLabel={addressLocked ? "Refreshing grant state" : "Loading grant state"}
            type="button"
            variant="secondary"
            onClick={() => void runAction("load-grant", loadGrant)}
          >
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
        {grantSnapshot && eligibility.holderAuthorized && grantSnapshot.settleable > 0n ? (
          <form className="grid gap-4 border-t border-zinc-800 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center" onSubmit={submitPreparedSettlement}>
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
              aria-describedby={settlementDisabledReasonId}
              disabled={!eligibility.holderActionsAvailable}
              pendingAction={pendingAction}
              pendingLabel="Preparing the exact grant settlement"
              title={settlementDisabledReason}
              type="submit"
            >
              <Send className="h-4 w-4" />
              Prepare settlement
            </ActionButton>
          </form>
        ) : null}
        {eligibility.holderAuthorized ? (
          <details className="border-t border-zinc-800">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-300 hover:text-zinc-100">
              Advanced settlement controls
            </summary>
            <p className="m-0 border-t border-zinc-800 px-4 pt-4 text-xs leading-5 text-zinc-500">
              Override the prepared flow only when you need to submit an exact token amount or approval. These controls do not rebind a previously prepared settlement.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2">
              <form className="grid content-start" onSubmit={submitPaymentApproval}>
                <Field
                  controlId="grant-payment-approval"
                  description="Maximum payment-token allowance for this grant contract. Press Enter here to approve only."
                  error={paymentApprovalError}
                  label="Payment approval"
                >
                  <Input value={paymentApproval} inputMode="decimal" onChange={(event) => setPaymentApproval(event.target.value)} />
                </Field>
                <ActionRow>
                  <ActionButton
                    actionId="approve-payment"
                    aria-describedby={settlementDisabledReasonId}
                    disabled={!eligibility.paymentApprovalAvailable || Boolean(paymentApprovalError)}
                    pendingAction={pendingAction}
                    pendingLabel="Submitting the exact payment approval"
                    title={settlementDisabledReason}
                    type="submit"
                    variant="secondary"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Approve payment
                  </ActionButton>
                </ActionRow>
              </form>
              <form className="grid content-start" onSubmit={submitAdvancedSettlement}>
                <Field
                  controlId="grant-settle-amount"
                  description="Project-token amount to settle, using the token’s displayed decimal units. Press Enter here to settle only."
                  error={settleAmountError}
                  label="Settle amount"
                >
                  <Input value={settleAmount} inputMode="decimal" onChange={(event) => setSettleAmount(event.target.value)} />
                </Field>
                <ActionRow>
                  <ActionButton
                    actionId="settle-grant"
                    aria-describedby={settlementDisabledReasonId}
                    disabled={!eligibility.holderActionsAvailable || Boolean(settleAmountError)}
                    pendingAction={pendingAction}
                    pendingLabel="Submitting the exact grant settlement"
                    title={settlementDisabledReason}
                    type="submit"
                  >
                    <Send className="h-4 w-4" />
                    Settle exact amount
                  </ActionButton>
                </ActionRow>
              </form>
            </div>
          </details>
        ) : null}
        {eligibility.holderAuthorized ? (
          <CapabilityNotice capability={actionCapability} id={settlementDisabledReasonId} />
        ) : null}
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
            <ActionButton actionId="halt-grant" disabled={actionCapability.status !== "enabled"} pendingAction={pendingAction} pendingLabel="Submitting the grant vesting halt" title={capabilityReason(actionCapability)} type="button" variant="secondary" onClick={() => void runAction("halt-grant", haltGrant)}>
              <ArchiveRestore className="h-4 w-4" />
              Halt Vesting
            </ActionButton>
            <ActionButton actionId="withdraw-expired" disabled={actionCapability.status !== "enabled"} pendingAction={pendingAction} pendingLabel="Withdrawing the expired grant balance" title={capabilityReason(actionCapability)} type="button" variant="secondary" onClick={() => void runAction("withdraw-expired", withdrawExpired)}>
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
  const holderAuthorized = canSettleGrant(account, grantSnapshot);
  const holderActionsAvailable = holderAuthorized && actionCapability.status === "enabled";
  const paidGrant = Boolean(grantSnapshot && !isZeroAddress(grantSnapshot.paymentToken));

  return {
    holderActionsAvailable,
    holderAuthorized,
    issuerActionsAvailable,
    paymentApprovalAvailable: holderActionsAvailable && paidGrant,
    showSettlementRestriction: Boolean(grantSnapshot && !holderAuthorized),
  };
}

function capabilityReason(capability: Capability): string | undefined {
  return capability.status === "enabled" ? undefined : capability.reason ?? "This action is not available right now.";
}

function CapabilityNotice({ capability, id }: { capability: Capability; id?: string | undefined }): React.JSX.Element | null {
  const reason = capabilityReason(capability);
  if (!reason) return null;
  return <p aria-live="polite" className="m-0 border-t border-zinc-800 p-4 text-sm text-amber-200" id={id}>{reason}</p>;
}

function decimalAmountError(value: string, label: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return `${label} is required.`;
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return `${label} must be a non-negative decimal amount.`;
  return undefined;
}

function positiveDecimalAmountError(
  value: string,
  label: string,
  decimals: number | undefined,
): string | undefined {
  const formatError = decimalAmountError(value, label);
  if (formatError) return formatError;

  const normalized = value.trim();
  const parsesToZero = decimals === undefined
    ? /^0+(?:\.0+)?$/.test(normalized)
    : parseUnits(normalized, decimals) === 0n;
  return parsesToZero ? `${label} must be greater than zero.` : undefined;
}

function canSettleGrant(account: Address | undefined, grantSnapshot: GrantSnapshot | undefined): boolean {
  if (!account || !grantSnapshot) return false;
  return sameAddress(account, grantSnapshot.holder);
}

function sameAddress(first: Address | undefined, second: Address | undefined): boolean {
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase());
}
