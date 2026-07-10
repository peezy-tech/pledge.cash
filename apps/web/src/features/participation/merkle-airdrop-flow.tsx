import {
  ZERO_ADDRESS,
  buildMerkleAirdropClaimTransaction,
  buildMerkleAirdropGrantClaimTransaction,
  readMerkleAirdropClaimState,
  type MerkleAirdropGrantClaimTerms,
  type MerkleAirdropState,
} from "@pledge.cash/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress } from "viem";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { errorMessage } from "../../lib/forms";
import { formatTokenAmount, parseTokenAmountInput } from "../../lib/token-amounts";
import type { BoardroomDistributionSnapshot } from "../../lib/types";
import { cn } from "../../lib/utils";
import {
  AdvancedFields,
  AmountField,
  ContractFact,
  FlowActions,
  FlowError,
  FlowHeading,
  InlineField,
  QuoteGrid,
  ReadError,
} from "./flow-primitives";
import { parseBytes32, parseMerkleProof, parseUnsignedInteger, unixWindowStatus } from "./participation-math";
import type { ParticipationFlowContext } from "./types";

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

  const refreshClaimState = useCallback(async (): Promise<void> => {
    if (!state || index.value === undefined) return;
    const version = ++requestVersion.current;
    setClaimLoading(true);
    setClaimReadError(undefined);
    try {
      const next = await readMerkleAirdropClaimState(publicClient, { airdrop: state.address, index: index.value });
      if (requestVersion.current === version) setClaimed(next.claimed);
    } catch (error) {
      if (requestVersion.current !== version) return;
      setClaimed(undefined);
      setClaimReadError(errorMessage(error));
    } finally {
      if (requestVersion.current === version) setClaimLoading(false);
    }
  }, [index.value, publicClient, state]);

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

  const submitClaim = async (): Promise<void> => {
    if (!account || index.value === undefined || amount.value === undefined || proof.value === undefined) {
      throw new Error("Complete the allocation details before claiming.");
    }
    if (mode === "direct") {
      await submitTransaction("Direct airdrop claim", buildMerkleAirdropClaimTransaction({
        airdrop: state.address,
        index: index.value,
        account,
        amount: amount.value,
        proof: proof.value,
      }));
    } else {
      if (!grantTerms.value) throw new Error(grantTerms.error ?? "Grant terms are incomplete.");
      await submitTransaction("Vested airdrop claim", buildMerkleAirdropGrantClaimTransaction({
        airdrop: state.address,
        index: index.value,
        account,
        amount: amount.value,
        terms: grantTerms.value,
        proof: proof.value,
      }));
    }
    await refreshClaimState();
  };

  return (
    <div className="min-w-0">
      <FlowHeading
        eyebrow="Published allocation"
        title="Claim an airdrop allocation"
        description="Use the index, amount, proof, and optional grant terms supplied by the project. The app checks whether the index is already claimed before opening your wallet."
      />
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
            onClick={() => setMode(nextMode)}
          >
            {nextMode === "direct" ? "Receive now" : "Vested grant"}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <InlineField label="Claim index">
          <Input
            aria-label="Airdrop claim index"
            inputMode="numeric"
            placeholder="0"
            value={indexInput}
            onChange={(event) => setIndexInput(event.target.value)}
          />
        </InlineField>
        <AmountField
          label="Allocated project tokens"
          onChange={setAmountInput}
          symbol={shareMetadata?.symbol}
          value={amountInput}
        />
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
      {claimReadError ? <ReadError>{claimReadError}</ReadError> : null}
      {blocker && !claimReadError ? <FlowError>{blocker}</FlowError> : null}

      <AdvancedFields summary="Proof and claim details">
        <div className="grid gap-4">
          <Label className="text-zinc-400">
            <span>Merkle proof</span>
            <textarea
              aria-label="Airdrop Merkle proof"
              className="min-h-28 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs leading-5 text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-lime-300/70 focus:ring-2 focus:ring-lime-300/10"
              placeholder={'["0x…", "0x…"] or one proof node per line'}
              value={proofInput}
              onChange={(event) => setProofInput(event.target.value)}
            />
          </Label>
          <p className="m-0 text-xs leading-5 text-zinc-500">
            Proofs are allocation-specific. Paste the exact proof published for this wallet, index, amount, contract, and chain.
          </p>
          {mode === "grant" ? (
            <GrantClaimFields form={grantForm} onChange={setGrantForm} />
          ) : null}
          <div>
            <p className="m-0 text-xs font-semibold text-zinc-400">Airdrop contract</p>
            <div className="mt-2 text-sm"><ContractFact address={state.address} /></div>
          </div>
        </div>
      </AdvancedFields>

      <FlowActions
        actionId={actionId}
        actionLabel={actionLabel}
        disabled={Boolean(blocker || claimReadError || !account)}
        onAction={submitClaim}
        onRefresh={index.value === undefined ? undefined : refreshClaimState}
        pendingAction={pendingAction}
        refreshLabel="Refresh claim status"
        runAction={runAction}
      />
    </div>
  );
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
