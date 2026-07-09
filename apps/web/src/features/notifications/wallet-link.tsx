import type { Address } from "@pledge.cash/sdk";
import type { AuthMeResponse, WalletNonceResponse } from "@pledge.cash/sentinel/dto";
import { CheckCircle2, Link2, Loader2, Trash2, WalletCards } from "lucide-react";
import { useState } from "react";
import { useSignMessage } from "wagmi";
import { ActionRow, AddressLink, Facts, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { shortAddress } from "../../lib/forms";
import type { SentinelClient } from "../../lib/sentinel";
import { errorMessage, formatSentinelDate } from "./hooks";

type WalletLinkProps = {
  account: Address | undefined;
  chainId: number;
  client: SentinelClient;
  session: AuthMeResponse;
  onChanged: () => Promise<void>;
};

export function WalletLink({
  account,
  chainId,
  client,
  session,
  onChanged,
}: WalletLinkProps): React.JSX.Element {
  const { signMessageAsync } = useSignMessage();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<string>();
  const linkedWallet = account
    ? session.wallets.find((wallet) => wallet.address.toLowerCase() === account.toLowerCase())
    : undefined;

  const linkWallet = async (): Promise<void> => {
    if (!account) {
      setError("Connect wallet first.");
      return;
    }

    setPending("link");
    setError(undefined);
    try {
      const nonce = await client.createWalletNonce({ address: account, chainId });
      const message = buildSentinelSiweMessage(nonce, account, chainId);
      const signature = await signMessageAsync({ message });
      await client.linkWallet({ message, signature });
      await onChanged();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(undefined);
    }
  };

  const unlinkWallet = async (address: Address): Promise<void> => {
    setPending(address);
    setError(undefined);
    try {
      await client.deleteWallet(address);
      await onChanged();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(undefined);
    }
  };

  return (
    <Panel
      title="Linked Wallets"
      description="Wallets determine which shareholder alerts can be delivered to this account."
      action={
        <Button disabled={!account || pending !== undefined || Boolean(linkedWallet)} variant="secondary" onClick={() => void linkWallet()}>
          {pending === "link" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          Link wallet
        </Button>
      }
    >
      <Facts
        columns="three"
        items={[
          { label: "Connected wallet", value: account ? <AddressLink address={account} /> : "No wallet connected" },
          { label: "Status", value: linkedWallet ? <Badge>Linked</Badge> : <Badge variant="muted">Not linked</Badge> },
          { label: "Linked wallets", value: session.wallets.length.toString() },
        ]}
      />
      {error ? <p className="m-0 border-t border-red-950 bg-red-950/35 p-4 text-sm text-red-200">{error}</p> : null}
      <ol className="m-0 grid list-none gap-px border-t border-zinc-800 bg-zinc-800 p-0">
        {session.wallets.length === 0 ? (
          <li className="bg-zinc-950 p-4 text-sm text-zinc-500">No linked wallets</li>
        ) : (
          session.wallets.map((wallet) => (
            <li
              className="grid min-w-0 gap-3 bg-zinc-950 p-4 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.35fr)_auto] md:items-center"
              key={wallet.address}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <WalletCards className="h-4 w-4 text-zinc-500" />
                  <AddressLink address={wallet.address as Address} />
                  {account && wallet.address.toLowerCase() === account.toLowerCase() ? (
                    <Badge variant="default">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Connected
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-zinc-500">{shortAddress(wallet.address)}</div>
              </div>
              <div className="text-sm text-zinc-400">Linked {formatSentinelDate(wallet.verifiedAt)}</div>
              <div className="flex md:justify-end">
                <Button
                  disabled={pending !== undefined}
                  size="sm"
                  variant="danger"
                  onClick={() => void unlinkWallet(wallet.address as Address)}
                >
                  {pending === wallet.address ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Remove
                </Button>
              </div>
            </li>
          ))
        )}
      </ol>
      <ActionRow>
        <Button disabled={pending !== undefined} variant="ghost" onClick={() => void onChanged()}>
          Refresh wallets
        </Button>
      </ActionRow>
    </Panel>
  );
}

export function buildSentinelSiweMessage(
  nonce: WalletNonceResponse,
  fallbackAddress: Address,
  fallbackChainId: number,
): string {
  const address = nonce.address ?? fallbackAddress;
  const chainId = nonce.chainId ?? fallbackChainId;

  return [
    `${nonce.domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    nonce.statement,
    "",
    `URI: ${nonce.uri}`,
    `Version: ${nonce.version}`,
    `Chain ID: ${chainId.toString()}`,
    `Nonce: ${nonce.nonce}`,
    `Issued At: ${nonce.issuedAt}`,
    `Expiration Time: ${nonce.expirationTime}`,
  ].join("\n");
}
