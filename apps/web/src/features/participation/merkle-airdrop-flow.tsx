import {
  ZERO_ADDRESS,
  buildMerkleAirdropClaimTransaction,
  buildMerkleAirdropGrantClaimTransaction,
  merkleAirdropAbi,
  readMerkleAirdropClaimState,
  type MerkleAirdropGrantClaimTerms,
  type MerkleAirdropState,
} from "@pledge.cash/sdk";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { formatUnits, getAddress, isAddress, type Hex } from "viem";
import { ActionButton } from "../../components/shell";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { errorMessage } from "../../lib/forms";
import { formatTokenAmount, parseTokenAmountInput } from "../../lib/token-amounts";
import type { BoardroomDistributionSnapshot } from "../../lib/types";
import { cn } from "../../lib/utils";
import {
  AdvancedFields,
  ContractFact,
  FlowError,
  FlowHeading,
  InlineField,
  QuoteGrid,
  ReadError,
} from "./flow-primitives";
import { parseBytes32, parseMerkleProof, parseUnsignedInteger, unixWindowStatus } from "./participation-math";
import type { ParticipationFlowContext } from "./types";
import { ParticipationActionGuard, type ParticipationActionTicket } from "./action-integrity";
import {
  claimTicketFromSearch,
  parseAirdropClaimTicket,
  verifyAirdropClaimTicket,
} from "./airdrop-claim-ticket";
import {
  ClaimTicketVerificationGuard,
  claimTicketVerificationSourceIdentity,
} from "./claim-ticket-integrity";

type MerkleAirdropFlowProps = ParticipationFlowContext & {
  distribution: BoardroomDistributionSnapshot;
};

type ClaimMode = "direct" | "grant";
type ParsedValue<T> = { error?: string; value?: T };
type GrantClaimForm = {
  expiry: string;
  paymentToken: string;
  price: string;
  salt: string;
  transferable: boolean;
  transferUnlockTime: string;
  vestingCliff: string;
  vestingEnd: string;
};

export function claimTicketVerificationControlState(
  rawTicket: string,
  verificationPending: boolean,
): { disabled: boolean; pendingLabel: string | undefined } {
  return {
    disabled: !rawTicket.trim() || verificationPending,
    pendingLabel: verificationPending ? "Verifying claim ticket against the onchain Merkle root" : undefined,
  };
}

const DEFAULT_GRANT_FORM: GrantClaimForm = {
  expiry: "",
  paymentToken: ZERO_ADDRESS,
  price: "0",
  salt: "",
  transferable: false,
  transferUnlockTime: "0",
  vestingCliff: "",
  vestingEnd: "",
};

export function MerkleAirdropFlow({
  account,
  chainId,
  dashboard,
  distribution,
  pendingAction,
  publicClient,
  runAction,
  submitTransaction,
}: MerkleAirdropFlowProps): React.JSX.Element {
  const state = merkleAirdropState(distribution);
  const shareMetadata = distribution.shareTokenMetadata;
  const [mode, setMode] = useState<ClaimMode>("direct");
  const [indexInput, setIndexInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [proofInput, setProofInput] = useState("");
  const [grantForm, setGrantForm] = useState<GrantClaimForm>(DEFAULT_GRANT_FORM);
  const [claimed, setClaimed] = useState<boolean>();
  const [claimReadError, setClaimReadError] = useState<string>();
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimTicketLoading, setClaimTicketLoading] = useState(false);
  const [claimTicketInput, setClaimTicketInput] = useState(() =>
    typeof window === "undefined" ? "" : claimTicketFromSearch(window.location.search) ?? "");
  const [claimTicketStatus, setClaimTicketStatus] = useState<{ error?: string; loaded?: string }>({});
  const requestVersion = useRef(0);

  const index = useMemo<ParsedValue<bigint>>(() => {
    if (!indexInput.trim()) return {};
    try {
      return { value: parseUnsignedInteger(indexInput, "Claim index") };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [indexInput]);
  const amount = useMemo<ParsedValue<bigint>>(() => {
    if (!amountInput.trim()) return {};
    if (!shareMetadata) return { error: "Project token decimals are unavailable." };
    try {
      return { value: parseTokenAmountInput(amountInput, shareMetadata, "Claim amount") };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [amountInput, shareMetadata]);
  const proof = useMemo<ParsedValue<readonly `0x${string}`[]>>(() => {
    try {
      return { value: parseMerkleProof(proofInput) };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [proofInput]);
  const grantTerms = useMemo(() => parseGrantTerms(grantForm, state), [grantForm, state]);
  const actionIdentity = merkleAirdropActionIdentity({
    account,
    airdrop: state?.address,
    amount: amount.value,
    grantTerms: mode === "grant" ? grantTerms.value : undefined,
    index: index.value,
    mode,
    proof: proof.value,
  });
  const actionGuardRef = useRef<ParticipationActionGuard | undefined>(undefined);
  actionGuardRef.current ??= new ParticipationActionGuard(actionIdentity);
  const actionGuard = actionGuardRef.current;
  actionGuard.sync(actionIdentity);
  const claimTicketSourceIdentity = claimTicketVerificationSourceIdentity({
    account,
    airdrop: state?.address,
    chainId,
    merkleRoot: state?.merkleRoot,
    rawTicket: claimTicketInput,
  });
  const claimTicketGuardRef = useRef<ClaimTicketVerificationGuard | undefined>(undefined);
  claimTicketGuardRef.current ??= new ClaimTicketVerificationGuard(claimTicketSourceIdentity);
  const claimTicketGuard = claimTicketGuardRef.current;
  claimTicketGuard.syncSource(claimTicketSourceIdentity);
  const verifiedClaimTicketLoaded = claimTicketStatus.loaded
    && claimTicketGuard.isVerified(claimTicketSourceIdentity, actionIdentity)
    ? claimTicketStatus.loaded
    : undefined;

  const invalidateClaimTicket = (): void => {
    claimTicketGuard.invalidate();
    setClaimTicketLoading(false);
    setClaimTicketStatus({});
  };

  useEffect(() => {
    actionGuard.activate();
    return () => actionGuard.deactivate();
  }, [actionGuard]);

  useEffect(() => {
    claimTicketGuard.syncSource(claimTicketSourceIdentity);
    setClaimTicketLoading(false);
    setClaimTicketStatus({});
  }, [claimTicketGuard, claimTicketSourceIdentity]);

  const loadClaimTicket = async (): Promise<void> => {
    const request = claimTicketGuard.begin();
    setClaimTicketLoading(true);
    setClaimTicketStatus({});
    try {
      if (!account) throw new Error("Connect the allocation wallet before loading its claim ticket.");
      if (!state || shareMetadata?.decimals === undefined) throw new Error("Airdrop state and token decimals must be available first.");
      const ticket = parseAirdropClaimTicket(claimTicketInput);
      if (ticket.chainId !== chainId) throw new Error(`This ticket is for chain ${ticket.chainId.toString()}, not chain ${chainId.toString()}.`);
      if (ticket.airdrop.toLowerCase() !== state.address.toLowerCase()) throw new Error("This ticket belongs to a different airdrop contract.");
      if (ticket.account.toLowerCase() !== account.toLowerCase()) throw new Error("This ticket belongs to a different wallet.");
      const loadedIdentity = merkleAirdropActionIdentity({
        account: ticket.account,
        airdrop: ticket.airdrop,
        amount: ticket.amount,
        grantTerms: ticket.grantTerms,
        index: ticket.index,
        mode: ticket.mode,
        proof: ticket.proof,
      });
      const boundRequest = claimTicketGuard.bind(request, loadedIdentity);
      if (!boundRequest) return;
      const leaf = await publicClient.readContract({
        address: state.address,
        abi: merkleAirdropAbi,
        functionName: ticket.mode === "direct" ? "getDirectClaimLeaf" : "getGrantClaimLeaf",
        args: ticket.mode === "direct"
          ? [ticket.index, ticket.account, ticket.amount]
          : [ticket.index, ticket.account, ticket.amount, ticket.grantTerms!],
      }) as Hex;
      if (!claimTicketGuard.isCurrent(boundRequest)) return;
      if (!verifyAirdropClaimTicket(ticket, leaf, state.merkleRoot)) {
        throw new Error("This ticket does not verify against the airdrop's onchain Merkle root.");
      }
      if (!claimTicketGuard.complete(boundRequest)) return;
      setMode(ticket.mode);
      setIndexInput(ticket.index.toString());
      setAmountInput(formatUnits(ticket.amount, shareMetadata.decimals));
      setProofInput(JSON.stringify(ticket.proof));
      if (ticket.grantTerms) {
        setGrantForm({
          expiry: ticket.grantTerms.expiry.toString(),
          paymentToken: ticket.grantTerms.paymentToken,
          price: ticket.grantTerms.price.toString(),
          salt: ticket.grantTerms.salt,
          transferable: ticket.grantTerms.transferable,
          transferUnlockTime: ticket.grantTerms.transferUnlockTime.toString(),
          vestingCliff: ticket.grantTerms.vestingCliff.toString(),
          vestingEnd: ticket.grantTerms.vestingEnd.toString(),
        });
      }
      setClaimTicketStatus({ loaded: "Claim ticket verified against the onchain Merkle root and loaded." });
    } catch (error) {
      if (!claimTicketGuard.isCurrent(request)) return;
      setClaimTicketStatus({ error: errorMessage(error) });
    } finally {
      if (claimTicketGuard.isCurrent(request)) setClaimTicketLoading(false);
    }
  };

  const refreshClaimState = useCallback(async (expected?: {
    airdrop: `0x${string}`;
    index: bigint;
    ticket: ParticipationActionTicket;
  }): Promise<void> => {
    const airdrop = expected?.airdrop ?? state?.address;
    const claimIndex = expected?.index ?? index.value;
    if (!airdrop || claimIndex === undefined || (expected && !actionGuard.isCurrent(expected.ticket))) return;
    const version = ++requestVersion.current;
    setClaimLoading(true);
    setClaimReadError(undefined);
    try {
      const next = await readMerkleAirdropClaimState(publicClient, { airdrop, index: claimIndex });
      if (requestVersion.current === version && (!expected || actionGuard.isCurrent(expected.ticket))) {
        setClaimed(next.claimed);
      }
    } catch (error) {
      if (requestVersion.current !== version || (expected && !actionGuard.isCurrent(expected.ticket))) return;
      setClaimed(undefined);
      setClaimReadError(errorMessage(error));
    } finally {
      if (requestVersion.current === version) setClaimLoading(false);
    }
  }, [actionGuard, index.value, publicClient, state]);

  useEffect(() => {
    requestVersion.current += 1;
    setClaimed(undefined);
    setClaimReadError(undefined);
    if (!state || index.value === undefined) {
      setClaimLoading(false);
      return;
    }
    const timer = window.setTimeout(() => void refreshClaimState(), 200);
    return () => {
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [index.value, refreshClaimState, state]);

  if (!state) {
    return (
      <ReadError>
        {distribution.error ?? "This airdrop did not return a readable onchain state."}
      </ReadError>
    );
  }

  const blocker = airdropBlocker({
    account,
    amount: amount.value,
    amountError: amount.error,
    boardroomStatus: dashboard.snapshot.status,
    claimLoading,
    claimReadError,
    claimed,
    grantTermsError: mode === "grant" ? grantTerms.error : undefined,
    index: index.value,
    indexError: index.error,
    mode,
    proofError: proof.error,
    state,
  });
  const actionId = mode === "direct" ? "Claim airdrop tokens" : "Claim airdrop grant";
  const actionLabel = mode === "direct" ? "Claim project tokens" : "Create vested grant";
  const claimIndexErrorId = index.error ? "airdrop-claim-index-error" : undefined;
  const claimAmountErrorId = amount.error ? "airdrop-claim-amount-error" : undefined;
  const claimProofErrorId = proof.error ? "airdrop-claim-proof-error" : undefined;
  const claimBlockerId = blocker || claimReadError ? "airdrop-claim-disabled-reason" : undefined;

  const submitClaim = async (): Promise<void> => {
    if (!account || index.value === undefined || amount.value === undefined || proof.value === undefined) {
      throw new Error("Complete the allocation details before claiming.");
    }
    const actionTicket = actionGuard.capture();
    const claimedAllocation = { airdrop: state.address, index: index.value, ticket: actionTicket };
    if (mode === "direct") {
      await submitTransaction("Direct airdrop claim", buildMerkleAirdropClaimTransaction({
        airdrop: state.address,
        index: index.value,
        account,
        amount: amount.value,
        proof: proof.value,
      }), { isCurrent: () => actionGuard.isCurrent(actionTicket) });
    } else {
      if (!grantTerms.value) throw new Error(grantTerms.error ?? "Grant terms are incomplete.");
      await submitTransaction("Vested airdrop claim", buildMerkleAirdropGrantClaimTransaction({
        airdrop: state.address,
        index: index.value,
        account,
        amount: amount.value,
        terms: grantTerms.value,
        proof: proof.value,
      }), { isCurrent: () => actionGuard.isCurrent(actionTicket) });
    }
    if (actionGuard.isCurrent(actionTicket)) await refreshClaimState(claimedAllocation);
  };

  const submitAirdropClaimForm = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (blocker || claimReadError || !account) return;
    void runAction(actionId, submitClaim);
  };

  return (
    <div className="min-w-0">
      <FlowHeading
        eyebrow="Published allocation"
        title="Claim an airdrop allocation"
        description="Use the index, amount, proof, and optional grant terms supplied by the project. The app checks whether the index is already claimed before opening your wallet."
      />
      <ClaimTicketLoadForm
        error={claimTicketStatus.error}
        loaded={verifiedClaimTicketLoaded}
        pending={claimTicketLoading}
        value={claimTicketInput}
        onChange={(value) => { invalidateClaimTicket(); setClaimTicketInput(value); }}
        onSubmit={loadClaimTicket}
      />
      <form onSubmit={submitAirdropClaimForm}>
      <div aria-label="Airdrop claim type" className="mt-5 inline-flex border-b border-zinc-800" role="group">
        {(["direct", "grant"] as const).map((nextMode) => (
          <button
            aria-pressed={mode === nextMode}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300/70",
              mode === nextMode ? "border-lime-300 text-zinc-50" : "border-transparent text-zinc-500 hover:text-zinc-200",
            )}
            key={nextMode}
            type="button"
            onClick={() => { invalidateClaimTicket(); setMode(nextMode); }}
          >
            {nextMode === "direct" ? "Receive now" : "Vested grant"}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <InlineField label="Claim index">
          <Input
            aria-describedby={claimIndexErrorId}
            aria-errormessage={claimIndexErrorId}
            aria-invalid={Boolean(index.error) || undefined}
            aria-label="Airdrop claim index"
            id="airdrop-claim-index"
            inputMode="numeric"
            placeholder="0"
            value={indexInput}
            onChange={(event) => { invalidateClaimTicket(); setIndexInput(event.target.value); }}
          />
          {index.error ? <span className="mt-1 block text-xs leading-5 text-red-300" id={claimIndexErrorId} role="alert">{index.error}</span> : null}
        </InlineField>
        <InlineField label="Allocated project tokens">
          <div className="relative">
            <Input
              aria-describedby={claimAmountErrorId}
              aria-errormessage={claimAmountErrorId}
              aria-invalid={Boolean(amount.error) || undefined}
              aria-label="Allocated project tokens"
              autoComplete="off"
              id="airdrop-claim-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amountInput}
              onChange={(event) => { invalidateClaimTicket(); setAmountInput(event.target.value); }}
            />
            {shareMetadata?.symbol ? <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-xs font-semibold text-zinc-500">{shareMetadata.symbol}</span> : null}
          </div>
          {amount.error ? <span className="mt-1 block text-xs leading-5 text-red-300" id={claimAmountErrorId} role="alert">{amount.error}</span> : null}
        </InlineField>
      </div>

      <QuoteGrid
        items={[
          {
            label: "Expected allocation",
            value: amount.value === undefined ? "Enter an amount" : formatTokenAmount(amount.value, shareMetadata),
          },
          {
            label: "Claim type",
            value: mode === "direct" ? "Tokens received now" : "Vested grant created",
          },
          {
            label: "Index status",
            value: index.value === undefined
              ? "Enter an index"
              : claimLoading ? "Checking onchain…" : claimed === true ? "Already claimed" : claimed === false ? "Unused" : "Not checked",
          },
          {
            label: "Airdrop remaining",
            value: formatTokenAmount(state.remainingShares, shareMetadata),
          },
          {
            label: "Grant claim slots",
            value: `${state.claimedGrantCount.toString()} of ${state.maxGrantClaims.toString()} used`,
            detail: mode === "grant" ? "Grant claims use a separate capped slot" : "Direct claims do not use a slot",
          },
          {
            label: "Proof nodes",
            value: proof.value ? proof.value.length.toString() : "Invalid",
            detail: proof.value?.length === 0 ? "An empty proof is valid only for a single-leaf root" : undefined,
          },
        ]}
      />

      {distribution.error ? <ReadError>{distribution.error}</ReadError> : null}
      {claimReadError ? <div id={claimBlockerId}><ReadError>{claimReadError}</ReadError></div> : null}
      {blocker && !claimReadError ? <div id={claimBlockerId}><FlowError>{blocker}</FlowError></div> : null}

      <AdvancedFields summary="Proof and claim details">
        <div className="grid gap-4">
          <Label className="text-zinc-400">
            <span>Merkle proof</span>
            <textarea
              aria-describedby={claimProofErrorId}
              aria-errormessage={claimProofErrorId}
              aria-invalid={Boolean(proof.error) || undefined}
              aria-label="Airdrop Merkle proof"
              className="min-h-28 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs leading-5 text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-lime-300/70 focus:ring-2 focus:ring-lime-300/10"
              id="airdrop-claim-proof"
              placeholder={'["0x…", "0x…"] or one proof node per line'}
              value={proofInput}
              onChange={(event) => { invalidateClaimTicket(); setProofInput(event.target.value); }}
            />
          </Label>
          <p className="m-0 text-xs leading-5 text-zinc-500">
            Proofs are allocation-specific. Paste the exact proof published for this wallet, index, amount, contract, and chain.
          </p>
          {proof.error ? <p className="m-0 text-xs leading-5 text-red-300" id={claimProofErrorId} role="alert">{proof.error}</p> : null}
          {mode === "grant" ? (
            <GrantClaimFields form={grantForm} onChange={(value) => { invalidateClaimTicket(); setGrantForm(value); }} />
          ) : null}
          <div>
            <p className="m-0 text-xs font-semibold text-zinc-400">Airdrop contract</p>
            <div className="mt-2 text-sm"><ContractFact address={state.address} /></div>
          </div>
        </div>
      </AdvancedFields>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <ActionButton
          actionId={actionId}
          aria-describedby={claimBlockerId}
          disabled={Boolean(blocker || claimReadError || !account)}
          pendingAction={pendingAction}
          pendingLabel={mode === "direct" ? "Submitting the exact airdrop token claim" : "Submitting the exact vested-grant claim"}
          type="submit"
        >
          {actionLabel}
        </ActionButton>
        {index.value === undefined ? null : (
          <ActionButton
            actionId="Refresh claim status"
            pendingAction={pendingAction}
            pendingLabel="Refreshing the onchain claim-index status"
            type="button"
            variant="secondary"
            onClick={() => void runAction("Refresh claim status", async () => await refreshClaimState())}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh claim status
          </ActionButton>
        )}
      </div>
      </form>
    </div>
  );
}

export function ClaimTicketLoadForm({
  error,
  loaded,
  onChange,
  onSubmit,
  pending,
  value,
}: {
  error?: string | undefined;
  loaded?: string | undefined;
  onChange: (value: string) => void;
  onSubmit: () => Promise<void> | void;
  pending: boolean;
  value: string;
}): React.JSX.Element {
  const control = claimTicketVerificationControlState(value, pending);
  const errorId = error ? "airdrop-claim-ticket-error" : undefined;
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (control.disabled) return;
    void onSubmit();
  };

  return (
    <form className="mt-5 border-y border-zinc-800 py-4" onSubmit={submit}>
      <p className="m-0 text-sm font-semibold text-zinc-100">Load a claim ticket</p>
      <p className="m-0 mt-1 text-xs leading-5 text-zinc-500">
        A project can share one chain-bound ticket instead of four separate claim fields. The app verifies its wallet, airdrop, leaf, proof, and onchain root before loading anything.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <InlineField label="Claim ticket JSON or link payload">
          <Input
            aria-describedby={errorId}
            aria-errormessage={errorId}
            aria-invalid={Boolean(error) || undefined}
            aria-label="Airdrop claim ticket"
            id="airdrop-claim-ticket"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </InlineField>
        <Button aria-busy={pending || undefined} disabled={control.disabled} type="submit" variant="secondary">
          Verify and load
        </Button>
      </div>
      {control.pendingLabel ? <p aria-live="polite" className="sr-only" role="status">{control.pendingLabel}</p> : null}
      {error ? <p className="m-0 mt-2 text-xs leading-5 text-red-300" id={errorId} role="alert">{error}</p> : null}
      {loaded ? <p className="m-0 mt-2 text-xs leading-5 text-lime-200" role="status">{loaded}</p> : null}
    </form>
  );
}

export function merkleAirdropActionIdentity(input: {
  account: `0x${string}` | undefined;
  airdrop: `0x${string}` | undefined;
  amount: bigint | undefined;
  grantTerms: MerkleAirdropGrantClaimTerms | undefined;
  index: bigint | undefined;
  mode: ClaimMode;
  proof: readonly `0x${string}`[] | undefined;
}): string {
  const terms = input.grantTerms;
  return [
    input.account?.toLowerCase() ?? "",
    input.airdrop?.toLowerCase() ?? "",
    input.amount?.toString() ?? "",
    input.index?.toString() ?? "",
    input.mode,
    input.proof?.join(",").toLowerCase() ?? "",
    terms?.paymentToken.toLowerCase() ?? "",
    terms?.price.toString() ?? "",
    terms?.expiry.toString() ?? "",
    terms?.vestingCliff.toString() ?? "",
    terms?.vestingEnd.toString() ?? "",
    terms?.transferable ? "transferable" : "non-transferable",
    terms?.transferUnlockTime.toString() ?? "",
    terms?.salt.toLowerCase() ?? "",
  ].join(":");
}

function GrantClaimFields({
  form,
  onChange,
}: {
  form: GrantClaimForm;
  onChange: (value: GrantClaimForm) => void;
}): React.JSX.Element {
  const update = (field: keyof Omit<GrantClaimForm, "transferable">, value: string): void => onChange({ ...form, [field]: value });
  return (
    <div className="border-t border-zinc-800 pt-4">
      <p className="m-0 text-sm font-semibold text-zinc-100">Exact vested-grant terms</p>
      <p className="m-0 mt-1 text-xs leading-5 text-zinc-500">These values are part of the Merkle leaf. Copy them exactly from the project’s allocation manifest.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <InlineField label="Payment token">
          <Input aria-label="Grant payment token" value={form.paymentToken} onChange={(event) => update("paymentToken", event.target.value)} />
        </InlineField>
        <InlineField label="Price (raw onchain units)">
          <Input aria-label="Grant price" inputMode="numeric" value={form.price} onChange={(event) => update("price", event.target.value)} />
        </InlineField>
        <InlineField label="Vesting cliff (Unix time)">
          <Input aria-label="Grant vesting cliff" inputMode="numeric" value={form.vestingCliff} onChange={(event) => update("vestingCliff", event.target.value)} />
        </InlineField>
        <InlineField label="Vesting end (Unix time)">
          <Input aria-label="Grant vesting end" inputMode="numeric" value={form.vestingEnd} onChange={(event) => update("vestingEnd", event.target.value)} />
        </InlineField>
        <InlineField label="Settlement expiry (Unix time)">
          <Input aria-label="Grant expiry" inputMode="numeric" value={form.expiry} onChange={(event) => update("expiry", event.target.value)} />
        </InlineField>
        <InlineField label="Transfer unlock (Unix time)">
          <Input aria-label="Grant transfer unlock" inputMode="numeric" value={form.transferUnlockTime} onChange={(event) => update("transferUnlockTime", event.target.value)} />
        </InlineField>
        <InlineField label="Grant salt (bytes32)">
          <Input aria-label="Grant salt" className="font-mono text-xs" value={form.salt} onChange={(event) => update("salt", event.target.value)} />
        </InlineField>
        <Label className="flex min-h-10 items-center gap-3 self-end text-zinc-400">
          <input
            checked={form.transferable}
            className="h-4 w-4 accent-lime-300"
            type="checkbox"
            onChange={(event) => onChange({ ...form, transferable: event.target.checked })}
          />
          Transferable grant right
        </Label>
      </div>
    </div>
  );
}

function merkleAirdropState(distribution: BoardroomDistributionSnapshot): MerkleAirdropState | undefined {
  const state = distribution.state;
  return distribution.kind === "merkle-airdrop" && state && "airdropStatus" in state ? state : undefined;
}

function parseGrantTerms(
  form: GrantClaimForm,
  state: MerkleAirdropState | undefined,
): ParsedValue<MerkleAirdropGrantClaimTerms> {
  try {
    if (!isAddress(form.paymentToken)) throw new Error("Grant payment token must be a valid address.");
    const paymentToken = getAddress(form.paymentToken);
    const price = parseUnsignedInteger(form.price, "Grant price");
    const expiry = parseUnsignedInteger(form.expiry, "Settlement expiry");
    const vestingCliff = parseUnsignedInteger(form.vestingCliff, "Vesting cliff");
    const vestingEnd = parseUnsignedInteger(form.vestingEnd, "Vesting end");
    const transferUnlockTime = parseUnsignedInteger(form.transferUnlockTime, "Transfer unlock time");
    const salt = parseBytes32(form.salt, "Grant salt");
    if (price === 0n && paymentToken !== ZERO_ADDRESS) throw new Error("A free grant must use the zero payment-token address.");
    if (price > 0n && paymentToken === ZERO_ADDRESS) throw new Error("A priced grant must name its payment token.");
    if (state && paymentToken.toLowerCase() === state.shareToken.toLowerCase()) throw new Error("The grant payment token cannot be the project token.");
    if (vestingCliff > vestingEnd) throw new Error("Vesting cliff cannot be after vesting end.");
    if (expiry < vestingEnd + 86_400n) throw new Error("Settlement expiry must be at least one day after vesting ends.");
    return {
      value: {
        paymentToken,
        price,
        expiry,
        vestingCliff,
        vestingEnd,
        transferable: form.transferable,
        transferUnlockTime,
        salt,
      },
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function airdropBlocker(input: {
  account: `0x${string}` | undefined;
  amount: bigint | undefined;
  amountError: string | undefined;
  boardroomStatus: number;
  claimLoading: boolean;
  claimReadError: string | undefined;
  claimed: boolean | undefined;
  grantTermsError: string | undefined;
  index: bigint | undefined;
  indexError: string | undefined;
  mode: ClaimMode;
  proofError: string | undefined;
  state: MerkleAirdropState;
}): string | undefined {
  if (input.boardroomStatus !== 0) return "This project is no longer active, so its airdrop cannot accept claims.";
  if (input.state.airdropStatus !== 0 || input.state.closed) return "This airdrop is closed.";
  const window = unixWindowStatus(input.state.startTime, input.state.endTime);
  if (window === "not-started") return "The claim window has not started yet.";
  if (window === "ended") return "The claim window has ended.";
  if (!input.account) return undefined;
  if (input.indexError) return input.indexError;
  if (input.index === undefined) return "Enter the allocation index published by the project.";
  if (input.amountError) return input.amountError;
  if (input.amount === undefined || input.amount === 0n) return "Enter the allocation amount published by the project.";
  if (input.amount > input.state.remainingShares) return "This allocation is larger than the airdrop’s remaining inventory.";
  if (input.proofError) return input.proofError;
  if (input.mode === "grant" && input.state.claimedGrantCount >= input.state.maxGrantClaims) return "All vested-grant claim slots have been used.";
  if (input.mode === "grant" && input.grantTermsError) return input.grantTermsError;
  if (input.claimLoading) return "Checking whether this allocation index was already claimed…";
  if (input.claimReadError) return input.claimReadError;
  if (input.claimed === undefined) return "The claim index must be checked onchain before submission.";
  if (input.claimed) return "This allocation index has already been claimed.";
  return undefined;
}
