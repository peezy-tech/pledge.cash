import { isZeroAddress } from "@pledge.cash/sdk";
import { ArchiveRestore, CheckCircle2, RefreshCw, Send } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { ActionButton, ActionRow, AddressLink, Facts, Field, Panel } from "../../components/shell";
import { Input } from "../../components/ui/input";
import { dateString } from "../../lib/forms";
import type { GrantSnapshot } from "../../lib/types";

type GrantInspectorProps = {
  grantAddress: string;
  grantSnapshot: GrantSnapshot | undefined;
  paymentApproval: string;
  pendingAction: string | undefined;
  settleAmount: string;
  setGrantAddress: Dispatch<SetStateAction<string>>;
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
  grantAddress,
  grantSnapshot,
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
  return (
    <div className="grid gap-4">
      <Panel
        title="Inspect Grant"
        action={
          <ActionButton actionId="load-grant" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("load-grant", loadGrant)}>
            <RefreshCw className="h-4 w-4" />
            Load
          </ActionButton>
        }
      >
        <div className="border-t border-zinc-800">
          <Field label="Grant address">
            <Input value={grantAddress} onChange={(event) => setGrantAddress(event.target.value)} spellCheck={false} />
          </Field>
        </div>
        <Facts columns="three" items={grantFacts(grantSnapshot)} />
      </Panel>

      <Panel title="Grant Actions">
        <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
          <Field label="Settle amount raw units">
            <Input value={settleAmount} inputMode="numeric" onChange={(event) => setSettleAmount(event.target.value)} />
          </Field>
          <Field label="Payment approval raw units">
            <Input value={paymentApproval} inputMode="numeric" onChange={(event) => setPaymentApproval(event.target.value)} />
          </Field>
        </div>
        <ActionRow>
          <ActionButton actionId="approve-payment" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("approve-payment", approvePayment)}>
            <CheckCircle2 className="h-4 w-4" />
            Approve Payment
          </ActionButton>
          <ActionButton actionId="settle-grant" pendingAction={pendingAction} onClick={() => void runAction("settle-grant", settleGrant)}>
            <Send className="h-4 w-4" />
            Settle
          </ActionButton>
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
    </div>
  );
}

function grantFacts(grantSnapshot: GrantSnapshot | undefined): { label: string; value: ReactNode }[] {
  if (!grantSnapshot) return [];

  return [
    { label: "Issuer", value: <AddressLink address={grantSnapshot.issuer} /> },
    { label: "Holder", value: <AddressLink address={grantSnapshot.holder} /> },
    { label: "Grant token", value: <AddressLink address={grantSnapshot.token} /> },
    {
      label: "Payment token",
      value: isZeroAddress(grantSnapshot.paymentToken) ? "None" : <AddressLink address={grantSnapshot.paymentToken} />,
    },
    { label: "Grant size", value: grantSnapshot.grantSize.toString() },
    { label: "Claimable", value: grantSnapshot.claimable.toString() },
    { label: "Settled", value: grantSnapshot.settledAmount.toString() },
    { label: "Settleable now", value: grantSnapshot.settleable.toString() },
    { label: "Price", value: grantSnapshot.price.toString() },
    { label: "Expiry", value: dateString(grantSnapshot.expiry) },
    { label: "Halted", value: grantSnapshot.halted ? "Yes" : "No" },
    { label: "Closed", value: grantSnapshot.closed ? "Yes" : "No" },
  ];
}
