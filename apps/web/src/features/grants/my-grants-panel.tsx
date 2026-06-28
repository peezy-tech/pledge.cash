import type { Address, DiscoveredGrant, PledgeCashDeployment } from "@pledge.cash/sdk";
import { RefreshCw, Search } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { ActionButton, AddressLink, Facts, Field, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { dateString } from "../../lib/forms";
import type { MyGrantsSnapshot } from "../../lib/types";

type MyGrantsPanelProps = {
  account: Address | undefined;
  deployment: PledgeCashDeployment | undefined;
  fromBlock: string;
  includeClosed: boolean;
  myGrants: MyGrantsSnapshot;
  pendingAction: string | undefined;
  setFromBlock: Dispatch<SetStateAction<string>>;
  setIncludeClosed: Dispatch<SetStateAction<boolean>>;
  inspectGrant: (grant: Address) => void;
  loadMyGrants: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
};

export function MyGrantsPanel({
  account,
  deployment,
  fromBlock,
  includeClosed,
  myGrants,
  pendingAction,
  setFromBlock,
  setIncludeClosed,
  inspectGrant,
  loadMyGrants,
  runAction,
}: MyGrantsPanelProps): React.JSX.Element {
  return (
    <div className="grid gap-4">
      <Panel
        title="My Grants"
        action={
          <ActionButton
            actionId="load-my-grants"
            disabled={!account || !deployment?.tokenGrantFactory}
            pendingAction={pendingAction}
            variant="secondary"
            onClick={() => void runAction("load-my-grants", loadMyGrants)}
          >
            <RefreshCw className="h-4 w-4" />
            Load
          </ActionButton>
        }
      >
        <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
          <Field label="From block">
            <Input value={fromBlock} inputMode="numeric" onChange={(event) => setFromBlock(event.target.value)} />
          </Field>
          <Field label="Include closed">
            <label className="flex h-10 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200">
              <input
                checked={includeClosed}
                className="h-4 w-4 accent-lime-300"
                type="checkbox"
                onChange={(event) => setIncludeClosed(event.target.checked)}
              />
              Enabled
            </label>
          </Field>
        </div>
        <Facts
          columns="two"
          items={[
            { label: "Wallet", value: account ? <AddressLink address={account} /> : "Connect wallet" },
            {
              label: "Factory",
              value: deployment?.tokenGrantFactory ? <AddressLink address={deployment.tokenGrantFactory} /> : "Not in artifact",
            },
          ]}
        />
      </Panel>

      <GrantList grants={myGrants.held} inspectGrant={inspectGrant} title="Held Grants" />
      <GrantList grants={myGrants.issued} inspectGrant={inspectGrant} title="Issued Grants" />
    </div>
  );
}

function GrantList({
  grants,
  inspectGrant,
  title,
}: {
  grants: DiscoveredGrant[];
  inspectGrant: (grant: Address) => void;
  title: string;
}): React.JSX.Element {
  return (
    <Panel title={title}>
      {grants.length === 0 ? (
        <div className="border-t border-zinc-800 p-4 text-sm text-zinc-500">No grants</div>
      ) : (
        <ol className="grid gap-px border-t border-zinc-800 bg-zinc-800">
          {grants.map((grant) => (
            <li className="min-w-0 bg-zinc-950 p-4" key={`${grant.grantAddress}-${grant.tokenId.toString()}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <AddressLink address={grant.grantAddress} />
                  <Badge variant={grant.closed ? "warning" : "default"}>{grant.closed ? "Closed" : "Open"}</Badge>
                </div>
                <Button size="sm" variant="secondary" onClick={() => inspectGrant(grant.grantAddress)}>
                  <Search className="h-3.5 w-3.5" />
                  Inspect
                </Button>
              </div>
              <Facts
                columns="three"
                items={[
                  { label: "Issuer", value: <AddressLink address={grant.issuer} /> },
                  {
                    label: grant.closed ? "Last holder" : "Current holder",
                    value: <AddressLink address={grant.closed && grant.lastHolder ? grant.lastHolder : grant.currentHolder} />,
                  },
                  { label: "Token", value: <AddressLink address={grant.token} /> },
                  { label: "Amount", value: grant.amount.toString() },
                  { label: "Price", value: grant.price.toString() },
                  { label: "Expiry", value: dateString(grant.expiry) },
                ]}
              />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
