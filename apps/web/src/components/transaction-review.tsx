import { ArrowRight, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import type { ContractCallReview } from "../lib/transaction-preview";
import { shortAddress } from "../lib/forms";
import {
  SimpleKitModal,
  SimpleKitModalBody,
  SimpleKitModalContent,
  SimpleKitModalDescription,
  SimpleKitModalFooter,
  SimpleKitModalHeader,
  SimpleKitModalTitle,
} from "./simplekit-modal";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

export function TransactionReview({
  review,
  approve,
  cancel,
}: {
  review: ContractCallReview | undefined;
  approve: () => void;
  cancel: () => void;
}): React.JSX.Element {
  const [riskAccepted, setRiskAccepted] = useState(false);
  useEffect(() => setRiskAccepted(false), [review?.data]);
  const canContinue = review ? transactionReviewCanContinue(review, riskAccepted) : false;

  return (
    <SimpleKitModal open={review !== undefined} onOpenChange={(open) => {
      if (!open) cancel();
    }}>
      <SimpleKitModalContent className="md:max-w-[520px]">
        <SimpleKitModalHeader className="text-left">
          <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-lime-300/12 text-lime-200">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <SimpleKitModalTitle className="text-left">Review transaction</SimpleKitModalTitle>
          <SimpleKitModalDescription className="text-left">
            Confirm what the app will ask your wallet to sign. A simulation runs before submission.
          </SimpleKitModalDescription>
        </SimpleKitModalHeader>

        <SimpleKitModalBody className="max-h-[60svh] min-h-0 px-0 md:min-h-0">
          {review ? <ReviewDetails review={review} riskAccepted={riskAccepted} setRiskAccepted={setRiskAccepted} /> : null}
        </SimpleKitModalBody>

        <SimpleKitModalFooter className="pt-2">
          <Button variant="secondary" onClick={cancel}>Go back</Button>
          <Button disabled={!canContinue} onClick={approve}>
            Continue to wallet
            <ArrowRight className="h-4 w-4" />
          </Button>
        </SimpleKitModalFooter>
      </SimpleKitModalContent>
    </SimpleKitModal>
  );
}

function ReviewDetails({
  review,
  riskAccepted,
  setRiskAccepted,
}: {
  review: ContractCallReview;
  riskAccepted: boolean;
  setRiskAccepted: (accepted: boolean) => void;
}): React.JSX.Element {
  const verificationIssue = transactionReviewBlockReason(review);
  return (
    <div className="grid gap-3">
      {verificationIssue ? (
        <p className="m-0 rounded-lg border border-amber-400/30 bg-amber-400/8 px-4 py-3 text-xs leading-5 text-amber-100">
          {verificationIssue} This app will not continue to the wallet until the transaction can be verified.
        </p>
      ) : null}
      <dl className="grid overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/45 text-sm">
        <ReviewRow label="Action" value={review.label} />
        <ReviewRow label="Contract function" value={humanizeFunctionName(review.functionName)} />
        {review.parameters.map((parameter, index) => (
          <ReviewRow
            key={`${parameter.name}-${index.toString()}`}
            label={humanizeFunctionName(parameter.name)}
            title={`${parameter.type}: ${parameter.value}`}
            value={parameter.value}
          />
        ))}
        <ReviewRow label="Contract" value={review.target === "unknown" ? "Unknown" : shortAddress(review.target)} title={review.target} />
        <ReviewRow label="Native value" value={review.value === 0n ? "None" : `${formatUnits(review.value, 18)} native (${review.value.toString()} wei)`} />
        <ReviewRow label="Risk" value={riskLabel(review.risk)} />
        {review.risk === "irreversible" ? (
          <label className="flex cursor-pointer items-start gap-3 border-t border-amber-400/25 bg-amber-400/8 px-4 py-3 text-xs leading-5 text-amber-100">
            <input
              checked={riskAccepted}
              className="mt-1 accent-lime-300"
              type="checkbox"
              onChange={(event) => setRiskAccepted(event.target.checked)}
            />
            I understand this lifecycle change cannot be undone.
          </label>
        ) : null}
        <details className="border-t border-zinc-800 px-4 py-3 text-xs text-zinc-400">
          <summary className="cursor-pointer font-medium text-zinc-300">Advanced transaction details</summary>
          <dl className="mt-3 grid gap-2">
            <div><dt className="text-zinc-500">Full contract</dt><dd className="m-0 mt-1 break-all font-mono text-zinc-300">{review.target}</dd></div>
            <div><dt className="text-zinc-500">Encoded call</dt><dd className="m-0 mt-1 max-h-24 overflow-auto break-all font-mono text-zinc-300">{review.data}</dd></div>
          </dl>
        </details>
      </dl>
      {review.boardroomCalls?.map((call, index) => (
        <section className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 text-xs" key={`${call.target}:${index.toString()}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
            <p className="m-0 text-sm font-semibold text-zinc-100">
              {review.boardroomCalls && review.boardroomCalls.length > 1 ? `${(index + 1).toString()}. ` : ""}{call.label}
            </p>
            <Badge variant={call.verification === "verified" ? "muted" : "warning"}>
              {call.verification === "verified" ? "Verified decode" : "Unverified call"}
            </Badge>
          </div>
          <dl className="grid gap-px bg-zinc-800 sm:grid-cols-2">
            <CallFact label="Target" value={call.target} />
            <CallFact label="Decoded function" value={call.signature ?? "Not verified"} />
            <CallFact label="Native value" value={call.value === 0n ? "None" : `${formatUnits(call.value, 18)} native (${call.value.toString()} wei)`} />
            {call.parameters.map((parameter, parameterIndex) => (
              <CallFact
                key={`${parameter.name}:${parameterIndex.toString()}`}
                label={`${parameter.name} (${parameter.type})`}
                value={parameter.value}
              />
            ))}
          </dl>
          {call.verificationReason ? (
            <p className="m-0 border-t border-amber-400/25 bg-amber-400/8 px-4 py-3 leading-5 text-amber-100">
              {call.verificationReason} The app cannot safely submit this transaction until every inner call has a verified decode.
            </p>
          ) : null}
          <details className="border-t border-zinc-800 px-4 py-3 text-zinc-400">
            <summary className="cursor-pointer font-medium text-zinc-300">Advanced call details</summary>
            <dl className="mt-3 grid gap-2">
              <div><dt className="text-zinc-500">Full target</dt><dd className="m-0 mt-1 break-all font-mono text-zinc-300">{call.target}</dd></div>
              <div><dt className="text-zinc-500">Raw calldata</dt><dd className="m-0 mt-1 max-h-24 overflow-auto break-all font-mono text-zinc-300">{call.data}</dd></div>
            </dl>
          </details>
        </section>
      ))}
    </div>
  );
}

export function transactionReviewCanContinue(review: ContractCallReview, riskAccepted: boolean): boolean {
  if (transactionReviewBlockReason(review)) return false;
  return review.risk !== "irreversible" || riskAccepted;
}

export function transactionReviewBlockReason(review: ContractCallReview): string | undefined {
  if (review.target === "unknown") return "The destination contract address is invalid or missing.";
  if (review.functionName === "unknown") return "The contract function is missing.";
  if (review.data === "unavailable") return "The exact contract call could not be encoded.";
  if (review.boardroomCalls?.some((call) => call.verification !== "verified")) {
    return "At least one inner Boardroom call could not be uniquely decoded.";
  }
  return undefined;
}

function CallFact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0 bg-zinc-950 px-4 py-3">
      <dt className="break-words text-zinc-500">{label}</dt>
      <dd className="m-0 mt-1 break-all font-mono leading-5 text-zinc-200">{value}</dd>
    </div>
  );
}

function riskLabel(risk: ContractCallReview["risk"]): string {
  if (risk === "irreversible") return "Irreversible lifecycle change";
  if (risk === "important") return "Important permission or asset action";
  return "Routine onchain action";
}

function ReviewRow({ label, title, value }: { label: string; title?: string; value: string }): React.JSX.Element {
  return (
    <div className="grid gap-1 border-b border-zinc-800 px-4 py-3 last:border-b-0 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-center">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className="m-0 break-words font-semibold text-zinc-100" title={title}>{value}</dd>
    </div>
  );
}

function humanizeFunctionName(value: string): string {
  if (value === "unknown") return "Unknown function";
  return value
    .replace(/_+$/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}
