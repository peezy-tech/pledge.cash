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
  const requiresRiskAcceptance = review?.risk === "irreversible";

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

        <SimpleKitModalBody className="h-auto min-h-0 px-0 md:min-h-0">
          {review ? <ReviewDetails review={review} riskAccepted={riskAccepted} setRiskAccepted={setRiskAccepted} /> : null}
        </SimpleKitModalBody>

        <SimpleKitModalFooter className="pt-2">
          <Button variant="secondary" onClick={cancel}>Go back</Button>
          <Button disabled={requiresRiskAcceptance && !riskAccepted} onClick={approve}>
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
  return (
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
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}
