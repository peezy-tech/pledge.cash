import type { Address } from "@pledge.cash/sdk";
import type { BoardroomRef, SeverityDto, SubscriptionDto, SubscriptionModeDto } from "@pledge.cash/sentinel/dto";
import { BellRing, Loader2, Plus, Save, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
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
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const suggestedWatched = Boolean(suggestedBoardroom
    && subscription.mode === "explicit"
    && subscription.boardrooms.some((boardroom) => sameBoardroom(boardroom, suggestedBoardroom)));
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
    setError(undefined);
  }, [subscription]);

  const addBoardroom = (): void => {
    const chainId = Number(draftChainId.trim());
    if (!Number.isInteger(chainId) || chainId <= 0) {
      setError("Enter a chain ID.");
      return;
    }
    if (!isAddress(draftAddress)) {
      setError("Enter a Boardroom address.");
      return;
    }

    const address = getAddress(draftAddress) as BoardroomRef["address"];
    if (boardrooms.some((boardroom) => boardroom.chainId === chainId && boardroom.address.toLowerCase() === address.toLowerCase())) {
      setError("That Boardroom is already listed.");
      return;
    }

    setBoardrooms((current) => [...current, { address, chainId }]);
    setDraftAddress("");
    setDraftChainId("");
    setError(undefined);
  };

  const save = async (): Promise<void> => {
    setPending(true);
    setError(undefined);
    try {
      await client.putSubscription({ boardrooms, minSeverity, mode });
      await onChanged();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const watchSuggestedBoardroom = async (): Promise<void> => {
    if (!suggestedBoardroom || suggestedWatched) return;
    setPending(true);
    setError(undefined);
    try {
      const nextBoardrooms = subscription.boardrooms.some((boardroom) => sameBoardroom(boardroom, suggestedBoardroom))
        ? subscription.boardrooms
        : [...subscription.boardrooms, suggestedBoardroom];
      await client.putSubscription({
        boardrooms: nextBoardrooms,
        minSeverity: subscription.minSeverity,
        mode: "explicit",
      });
      await onChanged();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const reset = (): void => {
    setMode(subscription.mode);
    setMinSeverity(subscription.minSeverity);
    setBoardrooms(subscription.boardrooms);
    setError(undefined);
  };

  return (
    <Panel
      title="Alert rules"
      description="Choose which governance actions should fan out to enabled delivery channels."
      action={
        <Button disabled={!dirty || pending} onClick={() => void save()}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
      }
    >
      {suggestedBoardroom ? (
        <div className="grid gap-3 border-t border-zinc-800 bg-zinc-900/35 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 text-sm font-semibold text-zinc-100">
                {suggestedWatched ? "Watching this project" : "Watch this project"}
              </p>
              <Badge variant={suggestedWatched ? "default" : "muted"}>Chain {suggestedBoardroom.chainId.toString()}</Badge>
            </div>
            <div className="mt-1 text-xs"><AddressLink address={suggestedBoardroom.address as Address} /></div>
            {!suggestedWatched && subscription.mode === "holdings" ? (
              <p className="m-0 mt-2 text-xs leading-5 text-amber-200">
                Watching switches alert rules from wallet holdings to the explicit project list shown below.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {!suggestedWatched ? (
              <Button disabled={pending} onClick={() => void watchSuggestedBoardroom()}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                Watch governance
              </Button>
            ) : null}
            {returnHref ? <ButtonLink href={returnHref} variant="secondary">Return to project</ButtonLink> : null}
          </div>
        </div>
      ) : null}
      <Facts
        columns="three"
        items={[
          { label: "Mode", value: subscription.mode === "holdings" ? "Wallet holdings" : "Specific Boardrooms" },
          { label: "Minimum severity", value: subscription.minSeverity },
          { label: "Specific Boardrooms", value: subscription.boardrooms.length.toString() },
        ]}
      />
      <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 md:grid-cols-2">
        <div className="bg-zinc-950 p-4">
          <div className="mb-2 text-xs font-semibold text-zinc-400">Mode</div>
          <div className="inline-flex max-w-full rounded-md border border-zinc-800 bg-zinc-950 p-1">
            <ModeButton active={mode === "holdings"} onClick={() => setMode("holdings")}>
              Wallet holdings
            </ModeButton>
            <ModeButton active={mode === "explicit"} onClick={() => setMode("explicit")}>
              Specific Boardrooms
            </ModeButton>
          </div>
        </div>
        <Label className="bg-zinc-950 p-4">
          Minimum severity
          <select
            className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm font-medium capitalize text-zinc-100 outline-none transition-colors hover:bg-zinc-900 focus:border-lime-300/70 focus:ring-2 focus:ring-lime-300/10"
            value={minSeverity}
            onChange={(event) => setMinSeverity(event.target.value as SeverityDto)}
          >
            {severities.map((severity) => (
              <option key={severity} value={severity}>
                {severity}
              </option>
            ))}
          </select>
        </Label>
      </div>
      {mode === "explicit" ? (
        <div className="border-t border-zinc-800 p-4">
          <div className="grid gap-3 md:grid-cols-[120px_minmax(0,1fr)_auto] md:items-end">
            <Label>
              Chain ID
              <Input inputMode="numeric" placeholder="31337" value={draftChainId} onChange={(event) => setDraftChainId(event.target.value)} />
            </Label>
            <Label>
              Boardroom
              <Input placeholder="0x..." value={draftAddress} onChange={(event) => setDraftAddress(event.target.value)} />
            </Label>
            <Button variant="secondary" onClick={addBoardroom}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="m-0 border-t border-red-950 bg-red-950/35 p-4 text-sm text-red-200">{error}</p> : null}
      <ol className="m-0 grid list-none gap-px border-t border-zinc-800 bg-zinc-800 p-0">
        {boardrooms.length === 0 ? (
          <li className="bg-zinc-950 p-4 text-sm text-zinc-500">No specific Boardrooms</li>
        ) : (
          boardrooms.map((boardroom) => (
            <li
              className="grid min-w-0 gap-3 bg-zinc-950 p-4 md:grid-cols-[minmax(0,1fr)_minmax(96px,0.2fr)_auto] md:items-center"
              key={`${boardroom.chainId.toString()}-${boardroom.address}`}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <BellRing className="h-4 w-4 text-zinc-500" />
                  <AddressLink address={boardroom.address as Address} />
                  <Badge variant={mode === "explicit" ? "default" : "muted"}>
                    {mode === "explicit" ? "Active" : "Saved"}
                  </Badge>
                </div>
              </div>
              <div className="text-sm text-zinc-400">Chain {boardroom.chainId.toString()}</div>
              <div className="flex md:justify-end">
                <Button
                  disabled={pending}
                  size="sm"
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
          ))
        )}
      </ol>
      <ActionRow>
        <Button disabled={pending || !dirty} variant="ghost" onClick={reset}>
          Reset
        </Button>
      </ActionRow>
    </Panel>
  );
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
      className={cn(
        "h-8 rounded px-3 text-sm font-semibold transition-colors",
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
