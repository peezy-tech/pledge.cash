import type { Address, PledgeCashDeployment } from "@pledge.cash/sdk";
import { CheckCircle2, Plus, RefreshCw, Search, Send, Wand2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { ActionButton, ActionRow, AddressLink, Facts, Field, Panel } from "../../components/shell";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { randomSalt } from "../../lib/forms";
import type { BoardroomForm, BoardroomGrantForm, BoardroomSnapshot } from "../../lib/types";

type BoardroomPanelProps = {
  boardroomAddress: string;
  boardroomForm: BoardroomForm;
  boardroomGrantForm: BoardroomGrantForm;
  boardroomMintAmount: string;
  boardroomMintTo: string;
  boardroomSnapshot: BoardroomSnapshot | undefined;
  deployment: PledgeCashDeployment | undefined;
  pendingAction: string | undefined;
  predictedBoardroom: Address | undefined;
  predictedBoardroomGrant: Address | undefined;
  setBoardroomAddress: (address: string) => void;
  setBoardroomForm: Dispatch<SetStateAction<BoardroomForm>>;
  setBoardroomGrantForm: Dispatch<SetStateAction<BoardroomGrantForm>>;
  setBoardroomMintAmount: Dispatch<SetStateAction<string>>;
  setBoardroomMintTo: Dispatch<SetStateAction<string>>;
  setPredictedBoardroom: Dispatch<SetStateAction<Address | undefined>>;
  setPredictedBoardroomGrant: Dispatch<SetStateAction<Address | undefined>>;
  boardroomApproveFactory: () => Promise<void>;
  boardroomCreateGrant: () => Promise<void>;
  createBoardroom: () => Promise<void>;
  loadBoardroom: () => Promise<void>;
  mintBoardroomShares: () => Promise<void>;
  predictBoardroom: () => Promise<void>;
  predictBoardroomGrantAddress: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
};

export function BoardroomPanel({
  boardroomAddress,
  boardroomForm,
  boardroomGrantForm,
  boardroomMintAmount,
  boardroomMintTo,
  boardroomSnapshot,
  deployment,
  pendingAction,
  predictedBoardroom,
  predictedBoardroomGrant,
  setBoardroomAddress,
  setBoardroomForm,
  setBoardroomGrantForm,
  setBoardroomMintAmount,
  setBoardroomMintTo,
  setPredictedBoardroom,
  setPredictedBoardroomGrant,
  boardroomApproveFactory,
  boardroomCreateGrant,
  createBoardroom,
  loadBoardroom,
  mintBoardroomShares,
  predictBoardroom,
  predictBoardroomGrantAddress,
  runAction,
}: BoardroomPanelProps): React.JSX.Element {
  return (
    <div className="grid gap-4">
      <Panel
        title="Create Boardroom"
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setBoardroomForm((current) => ({ ...current, salt: randomSalt() }));
              setPredictedBoardroom(undefined);
            }}
          >
            <Wand2 className="h-4 w-4" />
            Salt
          </Button>
        }
      >
        <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
          <Field label="Owner">
            <Input value={boardroomForm.owner} onChange={(event) => setBoardroomField("owner", event.target.value, setBoardroomForm)} spellCheck={false} />
          </Field>
          <Field label="Name">
            <Input value={boardroomForm.name} onChange={(event) => setBoardroomField("name", event.target.value, setBoardroomForm)} />
          </Field>
          <Field label="Symbol">
            <Input value={boardroomForm.symbol} onChange={(event) => setBoardroomField("symbol", event.target.value, setBoardroomForm)} />
          </Field>
          <Field label="Salt">
            <Input value={boardroomForm.salt} onChange={(event) => setBoardroomField("salt", event.target.value, setBoardroomForm)} spellCheck={false} />
          </Field>
        </div>
        <ActionRow>
          <ActionButton
            actionId="predict-boardroom"
            disabled={!deployment?.boardroomFactory}
            pendingAction={pendingAction}
            variant="secondary"
            onClick={() => void runAction("predict-boardroom", predictBoardroom)}
          >
            <Search className="h-4 w-4" />
            Predict
          </ActionButton>
          <ActionButton
            actionId="create-boardroom"
            disabled={!deployment?.boardroomFactory}
            pendingAction={pendingAction}
            onClick={() => void runAction("create-boardroom", createBoardroom)}
          >
            <Plus className="h-4 w-4" />
            Create
          </ActionButton>
        </ActionRow>
        <Facts
          columns="one"
          items={[
            { label: "Predicted Boardroom", value: predictedBoardroom ? <AddressLink address={predictedBoardroom} /> : "None" },
            { label: "Factory", value: deployment?.boardroomFactory ? <AddressLink address={deployment.boardroomFactory} /> : "Not in artifact" },
          ]}
        />
      </Panel>

      <Panel
        title="Boardroom Account"
        action={
          <ActionButton actionId="load-boardroom" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("load-boardroom", loadBoardroom)}>
            <RefreshCw className="h-4 w-4" />
            Load
          </ActionButton>
        }
      >
        <div className="border-t border-zinc-800">
          <Field label="Boardroom address">
            <Input value={boardroomAddress} onChange={(event) => setBoardroomAddress(event.target.value)} spellCheck={false} />
          </Field>
        </div>
        <Facts
          columns="three"
          items={[
            {
              label: "Owner",
              value: boardroomSnapshot?.owner ? <AddressLink address={boardroomSnapshot.owner} /> : "Unknown",
            },
            {
              label: "Policy registry",
              value: boardroomSnapshot?.policyRegistry ? <AddressLink address={boardroomSnapshot.policyRegistry} /> : "Unknown",
            },
            {
              label: "Share token",
              value: boardroomSnapshot?.shareToken ? <AddressLink address={boardroomSnapshot.shareToken} /> : "Unknown",
            },
          ]}
        />
      </Panel>

      <Panel title="Boardroom Shares">
        <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
          <Field label="Mint recipient">
            <Input value={boardroomMintTo} onChange={(event) => setBoardroomMintTo(event.target.value)} spellCheck={false} />
          </Field>
          <Field label="Mint amount raw units">
            <Input value={boardroomMintAmount} inputMode="numeric" onChange={(event) => setBoardroomMintAmount(event.target.value)} />
          </Field>
        </div>
        <ActionRow>
          <ActionButton actionId="mint-boardroom-shares" pendingAction={pendingAction} onClick={() => void runAction("mint-boardroom-shares", mintBoardroomShares)}>
            <Plus className="h-4 w-4" />
            Mint Shares
          </ActionButton>
        </ActionRow>
      </Panel>

      <Panel
        title="Boardroom Share Grant"
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setBoardroomGrantForm((current) => ({ ...current, salt: randomSalt() }));
              setPredictedBoardroomGrant(undefined);
            }}
          >
            <Wand2 className="h-4 w-4" />
            Salt
          </Button>
        }
      >
        <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
          <Field label="Holder">
            <Input
              value={boardroomGrantForm.holder}
              onChange={(event) => setBoardroomGrantField("holder", event.target.value, setBoardroomGrantForm)}
              spellCheck={false}
            />
          </Field>
          <Field label="Payment token">
            <Input
              value={boardroomGrantForm.paymentToken}
              onChange={(event) => setBoardroomGrantField("paymentToken", event.target.value, setBoardroomGrantForm)}
              spellCheck={false}
            />
          </Field>
          <Field label="Amount raw units">
            <Input
              value={boardroomGrantForm.amount}
              inputMode="numeric"
              onChange={(event) => setBoardroomGrantField("amount", event.target.value, setBoardroomGrantForm)}
            />
          </Field>
          <Field label="Price raw units">
            <Input value={boardroomGrantForm.price} inputMode="numeric" onChange={(event) => setBoardroomGrantField("price", event.target.value, setBoardroomGrantForm)} />
          </Field>
          <Field label="Vesting cliff timestamp">
            <Input
              value={boardroomGrantForm.vestingCliff}
              inputMode="numeric"
              onChange={(event) => setBoardroomGrantField("vestingCliff", event.target.value, setBoardroomGrantForm)}
            />
          </Field>
          <Field label="Vesting end timestamp">
            <Input
              value={boardroomGrantForm.vestingEnd}
              inputMode="numeric"
              onChange={(event) => setBoardroomGrantField("vestingEnd", event.target.value, setBoardroomGrantForm)}
            />
          </Field>
          <Field label="Expiry timestamp">
            <Input
              value={boardroomGrantForm.expiry}
              inputMode="numeric"
              onChange={(event) => setBoardroomGrantField("expiry", event.target.value, setBoardroomGrantForm)}
            />
          </Field>
          <Field label="Transferable">
            <label className="flex h-10 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200">
              <input
                checked={boardroomGrantForm.transferable}
                className="h-4 w-4 accent-lime-300"
                type="checkbox"
                onChange={(event) => setBoardroomGrantField("transferable", event.target.checked, setBoardroomGrantForm)}
              />
              Enabled
            </label>
          </Field>
          <Field label="Transfer unlock timestamp">
            <Input
              disabled={!boardroomGrantForm.transferable}
              value={boardroomGrantForm.transferUnlockTime}
              inputMode="numeric"
              onChange={(event) => setBoardroomGrantField("transferUnlockTime", event.target.value, setBoardroomGrantForm)}
            />
          </Field>
          <Field className="md:col-span-2" label="Salt">
            <Input value={boardroomGrantForm.salt} onChange={(event) => setBoardroomGrantField("salt", event.target.value, setBoardroomGrantForm)} spellCheck={false} />
          </Field>
        </div>
        <ActionRow>
          <ActionButton
            actionId="predict-boardroom-grant"
            pendingAction={pendingAction}
            variant="secondary"
            onClick={() => void runAction("predict-boardroom-grant", predictBoardroomGrantAddress)}
          >
            <Search className="h-4 w-4" />
            Predict
          </ActionButton>
          <ActionButton
            actionId="boardroom-approve-factory"
            pendingAction={pendingAction}
            variant="secondary"
            onClick={() => void runAction("boardroom-approve-factory", boardroomApproveFactory)}
          >
            <CheckCircle2 className="h-4 w-4" />
            Approve Factory
          </ActionButton>
          <ActionButton actionId="boardroom-create-grant" pendingAction={pendingAction} onClick={() => void runAction("boardroom-create-grant", boardroomCreateGrant)}>
            <Send className="h-4 w-4" />
            Create Grant
          </ActionButton>
        </ActionRow>
        <Facts
          columns="one"
          items={[
            { label: "Predicted grant", value: predictedBoardroomGrant ? <AddressLink address={predictedBoardroomGrant} /> : "None" },
            {
              label: "Share token",
              value: boardroomSnapshot?.shareToken ? <AddressLink address={boardroomSnapshot.shareToken} /> : "Load Boardroom",
            },
          ]}
        />
      </Panel>
    </div>
  );
}

function setBoardroomField<K extends keyof BoardroomForm>(
  key: K,
  value: BoardroomForm[K],
  setter: Dispatch<SetStateAction<BoardroomForm>>,
): void {
  setter((current) => ({ ...current, [key]: value }));
}

function setBoardroomGrantField<K extends keyof BoardroomGrantForm>(
  key: K,
  value: BoardroomGrantForm[K],
  setter: Dispatch<SetStateAction<BoardroomGrantForm>>,
): void {
  setter((current) => ({ ...current, [key]: value }));
}
