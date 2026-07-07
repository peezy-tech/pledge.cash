import { isZeroAddress, type Address } from "@pledge.cash/sdk";
import { ArchiveRestore, CheckCircle2, RefreshCw, Send } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { ActionButton, ActionRow, AddressLink, Facts, Field, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { dateString } from "../../lib/forms";
import { formatTokenAmount } from "../../lib/token-amounts";
import type { GrantSnapshot } from "../../lib/types";
import { GrantVestingChart } from "./grant-vesting-chart";

type GrantInspectorProps = {
  account: Address | undefined;
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
  withdrawExpired: () => Promise<void>;
};

export function GrantInspector({
  account,
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
  withdrawExpired,
}: GrantInspectorProps): React.JSX.Element {
  const holderActionsAvailable = canSettleGrant(account, grantSnapshot);
  const walletRole = grantWalletRole(account, grantSnapshot, issuerActionsAvailable);

  return (
    <div className="grid gap-4">
      <Panel
        title="Grant Detail"
        description="Read the grant schedule, payment terms, holder state, and the exact amount that can be settled now."
        action={
          <ActionButton actionId="load-grant" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("load-grant", loadGrant)}>
            <RefreshCw className="h-4 w-4" />
            Load
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
            <Input value={grantAddress} onChange={(event) => setGrantAddress(event.target.value)} spellCheck={false} />
          </Field>
        </div>
        <Facts columns="three" items={grantFacts(grantSnapshot, account, issuerActionsAvailable)} />
        <GrantVestingChart state={grantSnapshot} tokenMetadata={grantSnapshot?.tokenMetadata} />
      </Panel>

      <Panel
        title="Settlement"
        description="Approve payment when the grant is paid, then settle the vested amount into the holder wallet."
      >
        <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
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
            disabled={!holderActionsAvailable || !grantSnapshot || isZeroAddress(grantSnapshot.paymentToken)}
            pendingAction={pendingAction}
            variant="secondary"
            onClick={() => void runAction("approve-payment", approvePayment)}
          >
            <CheckCircle2 className="h-4 w-4" />
            Approve Payment
          </ActionButton>
          <ActionButton
            actionId="settle-grant"
            disabled={!holderActionsAvailable}
            pendingAction={pendingAction}
            onClick={() => void runAction("settle-grant", settleGrant)}
          >
            <Send className="h-4 w-4" />
            Settle
          </ActionButton>
        </ActionRow>
        {grantSnapshot && !holderActionsAvailable ? (
          <p className="m-0 border-t border-zinc-800 p-4 text-sm text-zinc-500">
            Settlement is only available to the current grant holder wallet.
          </p>
        ) : null}
      </Panel>

      {issuerActionsAvailable ? (
        <Panel
          title="Issuer Controls"
          description="Issuer actions affect future vesting or expired balances. Review the grant state before signing."
        >
          <ActionRow>
            <ActionButton actionId="halt-grant" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("halt-grant", haltGrant)}>
              <ArchiveRestore className="h-4 w-4" />
              Halt Vesting
            </ActionButton>
            <ActionButton actionId="withdraw-expired" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("withdraw-expired", withdrawExpired)}>
              <ArchiveRestore className="h-4 w-4" />
              Withdraw Expired
            </ActionButton>
          </ActionRow>
        </Panel>
      ) : null}
    </div>
  );
}

function grantFacts(
  grantSnapshot: GrantSnapshot | undefined,
  account: Address | undefined,
  issuerActionsAvailable: boolean,
): { label: string; value: ReactNode }[] {
  if (!grantSnapshot) return [];

  return [
    { label: "Wallet role", value: grantWalletRole(account, grantSnapshot, issuerActionsAvailable).label },
    { label: "Issuer", value: <AddressLink address={grantSnapshot.issuer} /> },
    { label: "Holder", value: <AddressLink address={grantSnapshot.holder} /> },
    { label: "Grant token", value: <AddressLink address={grantSnapshot.token} /> },
    {
      label: "Payment token",
      value: isZeroAddress(grantSnapshot.paymentToken) ? "None" : <AddressLink address={grantSnapshot.paymentToken} />,
    },
    { label: "Grant size", value: formatTokenAmount(grantSnapshot.grantSize, grantSnapshot.tokenMetadata) },
    { label: "Claimable", value: formatTokenAmount(grantSnapshot.claimable, grantSnapshot.tokenMetadata) },
    { label: "Settled", value: formatTokenAmount(grantSnapshot.settledAmount, grantSnapshot.tokenMetadata) },
    { label: "Settleable now", value: formatTokenAmount(grantSnapshot.settleable, grantSnapshot.tokenMetadata) },
    { label: "Price", value: isZeroAddress(grantSnapshot.paymentToken) ? "Free" : formatTokenAmount(grantSnapshot.price, grantSnapshot.paymentTokenMetadata) },
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
): { label: string; tone: "default" | "muted" | "warning" } {
  if (!account) return { label: "Read-only", tone: "muted" };
  if (!grantSnapshot) return { label: "Wallet connected", tone: "muted" };
  if (sameAddress(account, grantSnapshot.holder)) return { label: "Grant holder", tone: "default" };
  if (issuerActionsAvailable || sameAddress(account, grantSnapshot.issuer)) return { label: "Issuer controls", tone: "warning" };
  return { label: "Observer", tone: "muted" };
}

function canSettleGrant(account: Address | undefined, grantSnapshot: GrantSnapshot | undefined): boolean {
  if (!account || !grantSnapshot) return false;
  return sameAddress(account, grantSnapshot.holder);
}

function sameAddress(first: Address | undefined, second: Address | undefined): boolean {
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase());
}
