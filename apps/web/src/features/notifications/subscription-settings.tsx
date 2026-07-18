import type { Address } from "@pledge.cash/sdk";
import type { BoardroomRef, SeverityDto, SubscriptionDto, SubscriptionModeDto } from "@pledge.cash/sentinel/dto";
import { BellRing, Loader2, Plus, Save, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useId, useMemo, useState } from "react";
import { getAddress, isAddress } from "viem";
import { ActionRow, AddressLink, Facts, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button, ButtonLink } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import type { SentinelClient } from "../../lib/sentinel";
import { cn } from "../../lib/utils";
import { errorMessage } from "./hooks";

type SubscriptionSettingsProps = {
  client: SentinelClient;
  onChanged: () => Promise<void>;
  returnHref?: string | undefined;
  suggestedBoardroom?: BoardroomRef | undefined;
  subscription: SubscriptionDto;
};

const severities: SeverityDto[] = ["low", "medium", "high"];

export function SubscriptionSettings({
  client,
  onChanged,
  returnHref,
  suggestedBoardroom,
  subscription,
}: SubscriptionSettingsProps): React.JSX.Element {
  const [mode, setMode] = useState<SubscriptionModeDto>(subscription.mode);
  const [minSeverity, setMinSeverity] = useState<SeverityDto>(subscription.minSeverity);
  const [boardrooms, setBoardrooms] = useState<BoardroomRef[]>(subscription.boardrooms);
  const [draftAddress, setDraftAddress] = useState("");
  const [draftChainId, setDraftChainId] = useState("");
  const [draftError, setDraftError] = useState<string>();
  const [error, setError] = useState<string>();
  const [pendingOperation, setPendingOperation] = useState<SubscriptionPendingOperation>();
  const [status, setStatus] = useState("");
  const formId = useId();
  const addFormId = useId();
  const modeDescriptionId = useId();
  const severityId = useId();
  const chainIdId = useId();
  const boardroomId = useId();
  const draftErrorId = useId();
  const pending = alertRulePendingPresentation(pendingOperation);
  const suggestedWatchState = suggestedBoardroom
    ? governanceWatchSuggestionState(
        subscription,
        { boardrooms, minSeverity, mode },
        suggestedBoardroom,
      )
    : undefined;
  const dirty = useMemo(
    () =>
      mode !== subscription.mode
      || minSeverity !== subscription.minSeverity
      || serializeBoardrooms(boardrooms) !== serializeBoardrooms(subscription.boardrooms),
    [boardrooms, minSeverity, mode, subscription.boardrooms, subscription.minSeverity, subscription.mode],
  );

  useEffect(() => {
    setMode(subscription.mode);
    setMinSeverity(subscription.minSeverity);
    setBoardrooms(subscription.boardrooms);
    setDraftError(undefined);
    setError(undefined);
  }, [subscription]);

  const addBoardroom = (): void => {
    const validationError = boardroomDraftError(draftChainId, draftAddress, boardrooms);
    if (validationError) {
      setDraftError(validationError);
      return;
    }

    const chainId = Number(draftChainId.trim());
    const address = getAddress(draftAddress) as BoardroomRef["address"];
    setBoardrooms((current) => [...current, { address, chainId }]);
    setDraftAddress("");
    setDraftChainId("");
    setDraftError(undefined);
    setStatus("Boardroom added to the unsaved alert rules.");
  };

  const save = async (): Promise<void> => {
    setPendingOperation("save");
    setError(undefined);
    setStatus("Saving alert rules.");
    try {
      await client.putSubscription({ boardrooms, minSeverity, mode });
      await onChanged();
      setStatus("Alert rules saved.");
    } catch (error) {
      setError(errorMessage(error));
      setStatus("");
    } finally {
      setPendingOperation(undefined);
    }
  };

  const watchSuggestedBoardroom = async (): Promise<void> => {
    if (!suggestedBoardroom || suggestedWatchState === "active") return;
    setPendingOperation("watch");
    setError(undefined);
    setStatus("Saving governance watch.");
    try {
      await client.putSubscription(watchGovernanceSubscriptionDraft({ boardrooms, minSeverity }, suggestedBoardroom));
      await onChanged();
      setStatus("Governance watch saved.");
    } catch (error) {
      setError(errorMessage(error));
      setStatus("");
    } finally {
      setPendingOperation(undefined);
    }
  };

  const reset = (): void => {
    setMode(subscription.mode);
    setMinSeverity(subscription.minSeverity);
    setBoardrooms(subscription.boardrooms);
    setDraftError(undefined);
    setError(undefined);
    setStatus("Unsaved alert-rule changes reset.");
  };

  return (
    <Panel
      title="Alert rules"
      description="Choose which governance actions should fan out to enabled delivery channels."
      action={
        <Button
          aria-busy={pending.save || undefined}
          disabled={!dirty || pending.any}
          form={formId}
          type="submit"
        >
          {pending.save ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {pending.save ? "Saving rules" : "Save rules"}
        </Button>
      }
    >
      {suggestedBoardroom ? (
        <div className="grid gap-3 border-t border-zinc-800 bg-zinc-900/35 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 text-sm font-semibold text-zinc-100">
                {suggestedWatchState === "active"
                  ? "Watching this project"
                  : suggestedWatchState === "pending"
                    ? "Governance watch pending save"
                    : "Watch this project"}
              </p>
              <Badge variant={suggestedWatchState === "active" ? "default" : "muted"}>
                Chain {suggestedBoardroom.chainId.toString()}
              </Badge>
            </div>
            <div className="mt-1 text-xs"><AddressLink address={suggestedBoardroom.address as Address} /></div>
            {suggestedWatchState === "pending" ? (
              <p className="m-0 mt-2 text-xs leading-5 text-amber-200">
                This project is only in the unsaved draft. Save the rules or use Watch governance before leaving.
              </p>
            ) : null}
            {suggestedWatchState !== "active" && mode === "holdings" ? (
              <p className="m-0 mt-2 text-xs leading-5 text-amber-200">
                Watching switches alert rules from wallet holdings to the explicit project list shown below.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {suggestedWatchState !== "active" ? (
              <Button
                aria-busy={pending.watch || undefined}
                disabled={pending.any}
                type="button"
                onClick={() => void watchSuggestedBoardroom()}
              >
                {pending.watch ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                {pending.watch
                  ? "Saving watch"
                  : suggestedWatchState === "pending" ? "Save governance watch" : "Watch governance"}
              </Button>
            ) : null}
            {returnHref ? <ButtonLink href={returnHref} variant="secondary">Return to project</ButtonLink> : null}
          </div>
        </div>
      ) : null}
      <p aria-live="polite" className="sr-only" role="status">{status}</p>
      {error ? <p className="m-0 border-t border-red-950 bg-red-950/35 p-4 text-sm text-red-200" role="alert">{error}</p> : null}
      <form
        aria-label="Alert rule settings"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (!dirty || pending.any) return;
          void save();
        }}
      >
      <Facts
        columns="three"
        items={[
          { label: "Mode", value: subscription.mode === "holdings" ? "Wallet holdings" : "Specific Boardrooms" },
          { label: "Minimum severity", value: subscription.minSeverity },
          { label: "Specific Boardrooms", value: subscription.boardrooms.length.toString() },
        ]}
      />
      <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 md:grid-cols-2">
        <fieldset className="min-w-0 border-0 bg-zinc-950 p-4">
          <legend className="mb-2 text-xs font-semibold text-zinc-400">Mode</legend>
          <p className="m-0 mb-2 text-xs leading-5 text-zinc-500" id={modeDescriptionId}>
            Watch controlled wallets automatically or maintain an explicit Boardroom list.
          </p>
          <div
            aria-describedby={modeDescriptionId}
            aria-label="Alert subscription mode"
            className="flex w-full flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-1 sm:inline-flex sm:w-auto sm:flex-row"
            role="group"
          >
            <ModeButton active={mode === "holdings"} onClick={() => setMode("holdings")}>
              Wallet holdings
            </ModeButton>
            <ModeButton active={mode === "explicit"} onClick={() => setMode("explicit")}>
              Specific Boardrooms
            </ModeButton>
          </div>
        </fieldset>
        <div className="grid gap-2 bg-zinc-950 p-4">
          <Label htmlFor={severityId}>Minimum severity</Label>
          <select
            className="min-h-11 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm font-medium capitalize text-zinc-100 outline-none transition-colors hover:bg-zinc-900 focus:border-lime-300/70 focus:ring-2 focus:ring-lime-300/10"
            id={severityId}
            name="minimumSeverity"
            value={minSeverity}
            onChange={(event) => setMinSeverity(event.target.value as SeverityDto)}
          >
            {severities.map((severity) => (
              <option key={severity} value={severity}>
                {severity}
              </option>
            ))}
          </select>
        </div>
      </div>
      </form>
      {mode === "explicit" ? (
        <form
          aria-label="Add a Boardroom to alert rules"
          className="border-t border-zinc-800 p-4"
          id={addFormId}
          onSubmit={(event) => {
            event.preventDefault();
            addBoardroom();
          }}
        >
          <div className="grid gap-3 md:grid-cols-[120px_minmax(0,1fr)_auto] md:items-end">
            <div className="grid gap-2">
              <Label htmlFor={chainIdId}>Chain ID</Label>
              <Input
                aria-describedby={draftError ? draftErrorId : undefined}
                aria-invalid={draftError ? true : undefined}
                id={chainIdId}
                inputMode="numeric"
                name="chainId"
                placeholder="31337"
                value={draftChainId}
                onChange={(event) => {
                  setDraftChainId(event.target.value);
                  setDraftError(undefined);
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={boardroomId}>Boardroom</Label>
              <Input
                aria-describedby={draftError ? draftErrorId : undefined}
                aria-invalid={draftError ? true : undefined}
                autoComplete="off"
                id={boardroomId}
                name="boardroom"
                placeholder="0x..."
                value={draftAddress}
                onChange={(event) => {
                  setDraftAddress(event.target.value);
                  setDraftError(undefined);
                }}
              />
            </div>
            <Button disabled={pending.any} type="submit" variant="secondary">
              <Plus className="h-4 w-4" />
              Add Boardroom
            </Button>
          </div>
          {draftError ? <p className="m-0 mt-3 text-sm text-red-200" id={draftErrorId} role="alert">{draftError}</p> : null}
        </form>
      ) : null}
      <ol className="m-0 grid list-none gap-px border-t border-zinc-800 bg-zinc-800 p-0">
        {boardrooms.length === 0 ? (
          <li className="bg-zinc-950 p-4 text-sm text-zinc-500">No specific Boardrooms</li>
        ) : (
          boardrooms.map((boardroom) => {
            const persistedActive = subscription.mode === "explicit"
              && subscription.boardrooms.some((saved) => sameBoardroom(saved, boardroom));
            const status = persistedActive
              ? mode === "explicit" ? "Active" : "Active until save"
              : mode === "explicit" ? "Pending" : "Saved";
            return (
              <li
                className="grid min-w-0 gap-3 bg-zinc-950 p-4 md:grid-cols-[minmax(0,1fr)_minmax(96px,0.2fr)_auto] md:items-center"
                key={`${boardroom.chainId.toString()}-${boardroom.address}`}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <BellRing className="h-4 w-4 text-zinc-500" />
                    <AddressLink address={boardroom.address as Address} />
                    <Badge variant={persistedActive && mode === "explicit" ? "default" : "muted"}>
                      {status}
                    </Badge>
                  </div>
                </div>
                <div className="text-sm text-zinc-400">Chain {boardroom.chainId.toString()}</div>
                <div className="flex md:justify-end">
                  <Button
                    disabled={pending.any}
                    size="sm"
                    type="button"
                    variant="danger"
                    onClick={() =>
                      setBoardrooms((current) =>
                        current.filter(
                          (item) =>
                            item.chainId !== boardroom.chainId || item.address.toLowerCase() !== boardroom.address.toLowerCase(),
                        ),
                      )
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>
              </li>
            );
          })
        )}
      </ol>
      <ActionRow>
        <Button disabled={pending.any || !dirty} type="button" variant="ghost" onClick={reset}>
          Reset
        </Button>
      </ActionRow>
    </Panel>
  );
}

export type SubscriptionPendingOperation = "save" | "watch";

export function alertRulePendingPresentation(operation: SubscriptionPendingOperation | undefined): {
  any: boolean;
  save: boolean;
  watch: boolean;
} {
  return {
    any: operation !== undefined,
    save: operation === "save",
    watch: operation === "watch",
  };
}

export function boardroomDraftError(
  chainIdValue: string,
  addressValue: string,
  boardrooms: readonly BoardroomRef[],
): string | undefined {
  const chainId = Number(chainIdValue.trim());
  if (!Number.isInteger(chainId) || chainId <= 0) return "Enter a valid chain ID.";
  if (!isAddress(addressValue)) return "Enter a valid Boardroom address.";
  const address = getAddress(addressValue);
  if (boardrooms.some((boardroom) => boardroom.chainId === chainId && boardroom.address.toLowerCase() === address.toLowerCase())) {
    return "That Boardroom is already listed.";
  }
  return undefined;
}

export function watchGovernanceSubscriptionDraft(
  draft: Pick<SubscriptionDto, "boardrooms" | "minSeverity">,
  suggestedBoardroom: BoardroomRef,
): Pick<SubscriptionDto, "boardrooms" | "minSeverity" | "mode"> {
  return {
    boardrooms: draft.boardrooms.some((boardroom) => sameBoardroom(boardroom, suggestedBoardroom))
      ? draft.boardrooms
      : [...draft.boardrooms, suggestedBoardroom],
    minSeverity: draft.minSeverity,
    mode: "explicit",
  };
}

export function governanceWatchSuggestionState(
  subscription: SubscriptionDto,
  draft: Pick<SubscriptionDto, "boardrooms" | "minSeverity" | "mode">,
  suggestedBoardroom: BoardroomRef,
): "active" | "available" | "pending" {
  const persisted = subscription.mode === "explicit"
    && subscription.boardrooms.some((boardroom) => sameBoardroom(boardroom, suggestedBoardroom));
  if (persisted) return "active";
  const drafted = draft.mode === "explicit"
    && draft.boardrooms.some((boardroom) => sameBoardroom(boardroom, suggestedBoardroom));
  return drafted ? "pending" : "available";
}

function sameBoardroom(first: BoardroomRef, second: BoardroomRef): boolean {
  return first.chainId === second.chainId && first.address.toLowerCase() === second.address.toLowerCase();
}

function ModeButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "min-h-11 w-full rounded px-3 text-sm font-semibold transition-colors sm:w-auto",
        active ? "bg-lime-300 text-zinc-950" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
      )}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function serializeBoardrooms(boardrooms: BoardroomRef[]): string {
  return boardrooms
    .map((boardroom) => `${boardroom.chainId.toString()}:${boardroom.address.toLowerCase()}`)
    .sort()
    .join("|");
}
