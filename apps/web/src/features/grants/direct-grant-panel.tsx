import type { Address } from "@pledge.cash/sdk";
import { CheckCircle2, Search, Send, Wand2 } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
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

type GrantTextFieldName = {
  [K in keyof GrantForm]: GrantForm[K] extends string ? K : never;
}[keyof GrantForm];

type DirectGrantTextField = {
  kind: "text";
  field: GrantTextFieldName;
  label: string;
  className?: string;
  disabledWhenNonTransferable?: boolean;
  inputMode?: "decimal" | "numeric";
  resetPrediction?: boolean;
  spellCheck?: boolean;
};

type DirectGrantToggleField = {
  kind: "transferable";
  label: string;
};

type DirectGrantFieldDefinition = DirectGrantTextField | DirectGrantToggleField;

const DIRECT_GRANT_FIELDS: readonly DirectGrantFieldDefinition[] = [
  { kind: "text", field: "holder", label: "Holder", spellCheck: false },
  { kind: "text", field: "token", label: "Grant token", spellCheck: false },
  { kind: "text", field: "paymentToken", label: "Payment token", spellCheck: false },
  { kind: "text", field: "amount", label: "Amount", inputMode: "decimal" },
  { kind: "text", field: "price", label: "Price", inputMode: "decimal" },
  { kind: "text", field: "vestingCliff", label: "Vesting cliff timestamp", inputMode: "numeric" },
  { kind: "text", field: "vestingEnd", label: "Vesting end timestamp", inputMode: "numeric" },
  { kind: "text", field: "expiry", label: "Expiry timestamp", inputMode: "numeric" },
  { kind: "transferable", label: "Transferable" },
  {
    kind: "text",
    field: "transferUnlockTime",
    label: "Transfer unlock timestamp",
    disabledWhenNonTransferable: true,
    inputMode: "numeric",
  },
  { kind: "text", field: "salt", label: "Salt", className: "md:col-span-2", resetPrediction: true, spellCheck: false },
];

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
  const setGrantField = <K extends keyof GrantForm,>(key: K, value: GrantForm[K]): void => {
    setGrantForm((current) => ({ ...current, [key]: value }));
  };

  const setGrantSalt = (salt: string): void => {
    setGrantField("salt", salt);
    clearDirectGrantPrediction();
  };

  const grantFacts = directGrantFacts(predictedGrant, issuer, creationFee);

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
          {DIRECT_GRANT_FIELDS.map((field) => (
            <DirectGrantFormField
              definition={field}
              form={grantForm}
              key={field.kind === "text" ? field.field : field.kind}
              setGrantField={setGrantField}
              setGrantSalt={setGrantSalt}
            />
          ))}
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
          items={grantFacts}
        />
      </Panel>
    </div>
  );
}

function DirectGrantFormField({
  definition,
  form,
  setGrantField,
  setGrantSalt,
}: {
  definition: DirectGrantFieldDefinition;
  form: GrantForm;
  setGrantField: <K extends keyof GrantForm>(key: K, value: GrantForm[K]) => void;
  setGrantSalt: (salt: string) => void;
}): React.JSX.Element {
  if (definition.kind === "transferable") {
    return (
      <Field label={definition.label}>
        <label className="flex h-10 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200">
          <input
            checked={form.transferable}
            className="h-4 w-4 accent-lime-300"
            type="checkbox"
            onChange={(event) => setGrantField("transferable", event.target.checked)}
          />
          Enabled
        </label>
      </Field>
    );
  }

  const disabled = definition.disabledWhenNonTransferable === true && !form.transferable;
  const fieldProps = definition.className ? { className: definition.className } : {};
  const setValue = definition.resetPrediction === true ? setGrantSalt : (value: string): void => setGrantField(definition.field, value);

  return (
    <Field {...fieldProps} label={definition.label}>
      <Input
        disabled={disabled}
        value={form[definition.field]}
        inputMode={definition.inputMode}
        spellCheck={definition.spellCheck}
        onChange={(event) => setValue(event.target.value)}
      />
    </Field>
  );
}

function directGrantFacts(
  predictedGrant: Address | undefined,
  issuer: Address | undefined,
  creationFee: bigint,
): { label: string; value: ReactNode }[] {
  return [
    { label: "Predicted grant", value: predictedGrant ? <AddressLink address={predictedGrant} /> : "None" },
    { label: "Issuer", value: issuer ? <AddressLink address={issuer} /> : "Connect wallet" },
    { label: "Creation fee", value: formatNativeTokenAmount(creationFee) },
  ];
}
