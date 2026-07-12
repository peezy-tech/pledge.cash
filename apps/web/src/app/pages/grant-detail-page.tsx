import type { Address } from "@pledge.cash/sdk";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { AddressLink } from "../../components/shell";
import { Button, ButtonLink } from "../../components/ui/button";
import { PageHeading, PageNotice, RuledSection, SectionHeading } from "./page-primitives";

export function GrantDetailPage({
  account,
  backHref,
  backLabel = "Return to Portfolio",
  children,
  grant,
  onBack,
}: {
  account: Address | undefined;
  backHref: string;
  backLabel?: string | undefined;
  children: ReactNode;
  grant: Address;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <div>
      <PageHeading
        actions={(
          <ButtonLink
            href={backHref}
            variant="secondary"
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onBack();
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </ButtonLink>
        )}
        eyebrow={`${backLabel.replace(/^Return to /, "")} / Grant`}
        title="Review grant settlement"
        description="Confirm the holder, vesting progress, settleable tokens, payment cost, and expiry before asking the wallet to act."
      />
      <RuledSection>
        <SectionHeading title="Grant identity" description="This contract is the source of truth for the rights shown below." />
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-zinc-800 py-4 text-sm">
          <span className="text-zinc-500">Grant <AddressLink address={grant} /></span>
          <span className="text-zinc-500">Wallet {account ? <AddressLink address={account} /> : "not connected"}</span>
        </div>
        {!account ? (
          <div className="mt-4"><PageNotice title="Read first, connect when ready">Grant terms remain public. Connect the holder wallet only when you are ready to settle or approve payment.</PageNotice></div>
        ) : null}
      </RuledSection>
      <RuledSection>
        <SectionHeading title="Settlement" description="The transaction review will run a simulation before your wallet opens." />
        <div className="mt-4">{children}</div>
      </RuledSection>
    </div>
  );
}

export function GrantVerificationFailureState({
  backHref,
  grant,
  kind,
  message,
  onBack,
  onRetry,
  returnLabel = "Return to Portfolio",
}: {
  backHref: string;
  grant: Address;
  kind: "invalid" | "transient";
  message: string;
  onBack: () => void;
  onRetry?: (() => void) | undefined;
  returnLabel?: string | undefined;
}): React.JSX.Element {
  const title = kind === "transient" ? "Grant temporarily unavailable" : "Grant not found";
  return (
    <div className="grid min-h-[58vh] place-items-center py-12">
      <div className="max-w-xl text-center">
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-lime-200/80">Grant verification</p>
        <h1 className="m-0 mt-2 text-3xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-4xl">{title}</h1>
        <p className="m-0 mt-3 text-sm leading-6 text-zinc-400">{message}</p>
        <p className="m-0 mt-3 text-xs text-zinc-500">Requested grant <AddressLink address={grant} /></p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <ButtonLink
            href={backHref}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onBack();
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            {returnLabel}
          </ButtonLink>
          {kind === "transient" && onRetry ? (
            <Button variant="secondary" onClick={onRetry}>Retry verification</Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function GrantVerificationLoadingState({ grant }: { grant: Address }): React.JSX.Element {
  return (
    <div aria-live="polite" className="grid min-h-[58vh] place-items-center py-12">
      <div className="max-w-xl text-center">
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-lime-200/80">Grant verification</p>
        <h1 className="m-0 mt-2 text-3xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-4xl">Verifying grant</h1>
        <p className="m-0 mt-3 text-sm leading-6 text-zinc-400">
          Checking contract code, factory provenance, and current grant terms before showing any settlement guidance.
        </p>
        <p className="m-0 mt-3 text-xs text-zinc-500">Requested grant <AddressLink address={grant} /></p>
      </div>
    </div>
  );
}
