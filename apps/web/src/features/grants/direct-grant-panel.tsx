import type { Address } from "@pledge.cash/sdk";
import { CheckCircle2, Search, Send, Wand2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { ActionButton, ActionRow, AddressLink, Facts, Field, Panel } from "../../components/shell";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { randomSalt } from "../../lib/forms";
import { formatNativeTokenAmount } from "../../lib/token-amounts";
import type { GrantForm } from "../../lib/types";

type DirectGrantPanelProps = {
  creationFee: bigint;
  grantForm: GrantForm;
  issuer: Address | undefined;
  pendingAction: string | undefined;
  predictedGrant: Address | undefined;
  clearDirectGrantPrediction: () => void;
  setGrantForm: Dispatch<SetStateAction<GrantForm>>;
  approveEscrow: () => Promise<void>;
  createGrant: () => Promise<void>;
  predictGrant: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
};

export function DirectGrantPanel({
  creationFee,
  grantForm,
  issuer,
  pendingAction,
  predictedGrant,
  clearDirectGrantPrediction,
  setGrantForm,
  approveEscrow,
  createGrant,
  predictGrant,
  runAction,
}: DirectGrantPanelProps): React.JSX.Element {
  const setGrantSalt = (salt: string): void => {
    setGrantForm((current) => ({ ...current, salt }));
    clearDirectGrantPrediction();
  };

  return (
    <div className="grid gap-4">
      <Panel
        title="Create Direct Grant"
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setGrantSalt(randomSalt());
            }}
          >
            <Wand2 className="h-4 w-4" />
            Salt
          </Button>
        }
      >
        <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
          <Field label="Holder">
            <Input value={grantForm.holder} onChange={(event) => setGrantFormField("holder", event.target.value, setGrantForm)} spellCheck={false} />
          </Field>
          <Field label="Grant token">
            <Input value={grantForm.token} onChange={(event) => setGrantFormField("token", event.target.value, setGrantForm)} spellCheck={false} />
          </Field>
          <Field label="Payment token">
            <Input
              value={grantForm.paymentToken}
              onChange={(event) => setGrantFormField("paymentToken", event.target.value, setGrantForm)}
              spellCheck={false}
            />
          </Field>
          <Field label="Amount">
            <Input value={grantForm.amount} inputMode="decimal" onChange={(event) => setGrantFormField("amount", event.target.value, setGrantForm)} />
          </Field>
          <Field label="Price">
            <Input value={grantForm.price} inputMode="decimal" onChange={(event) => setGrantFormField("price", event.target.value, setGrantForm)} />
          </Field>
          <Field label="Vesting cliff timestamp">
            <Input
              value={grantForm.vestingCliff}
              inputMode="numeric"
              onChange={(event) => setGrantFormField("vestingCliff", event.target.value, setGrantForm)}
            />
          </Field>
          <Field label="Vesting end timestamp">
            <Input value={grantForm.vestingEnd} inputMode="numeric" onChange={(event) => setGrantFormField("vestingEnd", event.target.value, setGrantForm)} />
          </Field>
          <Field label="Expiry timestamp">
            <Input value={grantForm.expiry} inputMode="numeric" onChange={(event) => setGrantFormField("expiry", event.target.value, setGrantForm)} />
          </Field>
          <Field label="Transferable">
            <label className="flex h-10 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200">
              <input
                checked={grantForm.transferable}
                className="h-4 w-4 accent-lime-300"
                type="checkbox"
                onChange={(event) => setGrantFormField("transferable", event.target.checked, setGrantForm)}
              />
              Enabled
            </label>
          </Field>
          <Field label="Transfer unlock timestamp">
            <Input
              disabled={!grantForm.transferable}
              value={grantForm.transferUnlockTime}
              inputMode="numeric"
              onChange={(event) => setGrantFormField("transferUnlockTime", event.target.value, setGrantForm)}
            />
          </Field>
          <Field className="md:col-span-2" label="Salt">
            <Input value={grantForm.salt} onChange={(event) => setGrantSalt(event.target.value)} spellCheck={false} />
          </Field>
        </div>
        <ActionRow>
          <ActionButton actionId="predict-grant" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("predict-grant", predictGrant)}>
            <Search className="h-4 w-4" />
            Predict
          </ActionButton>
          <ActionButton actionId="approve-escrow" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("approve-escrow", approveEscrow)}>
            <CheckCircle2 className="h-4 w-4" />
            Approve Escrow
          </ActionButton>
          <ActionButton actionId="create-grant" pendingAction={pendingAction} onClick={() => void runAction("create-grant", createGrant)}>
            <Send className="h-4 w-4" />
            Create Grant
          </ActionButton>
        </ActionRow>
        <Facts
          columns="one"
          items={[
            { label: "Predicted grant", value: predictedGrant ? <AddressLink address={predictedGrant} /> : "None" },
            { label: "Issuer", value: issuer ? <AddressLink address={issuer} /> : "Connect wallet" },
            { label: "Creation fee", value: formatNativeTokenAmount(creationFee) },
          ]}
        />
      </Panel>
    </div>
  );
}

function setGrantFormField<K extends keyof GrantForm>(
  key: K,
  value: GrantForm[K],
  setter: Dispatch<SetStateAction<GrantForm>>,
): void {
  setter((current) => ({ ...current, [key]: value }));
}
