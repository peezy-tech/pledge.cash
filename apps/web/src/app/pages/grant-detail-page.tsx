import type { Address } from "@pledge.cash/sdk";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { AddressLink } from "../../components/shell";
import { Button } from "../../components/ui/button";
import { PageHeading, PageNotice, RuledSection, SectionHeading } from "./page-primitives";

export function GrantDetailPage({
  account,
  children,
  grant,
  onBack,
}: {
  account: Address | undefined;
  children: ReactNode;
  grant: Address;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <div>
      <PageHeading
        actions={<Button variant="secondary" onClick={onBack}><ArrowLeft className="h-4 w-4" />Portfolio</Button>}
        eyebrow="Portfolio / Grant"
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
