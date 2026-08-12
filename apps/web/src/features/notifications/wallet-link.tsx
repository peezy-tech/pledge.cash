import type { Address } from "@pledge.cash/sdk";
import type { AuthMeResponse, WalletNonceResponse } from "@pledge.cash/sentinel/dto";
import { CheckCircle2, Link2, Loader2, WalletCards } from "lucide-react";
import { useState } from "react";
import { useSignMessage } from "wagmi";
import { ActionRow, AddressLink, Facts, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { formatIdentityDate, identityErrorMessage } from "../../hooks/use-identity-session";
import { shortAddress } from "../../lib/forms";
import type { SentinelClient } from "../../lib/sentinel";
import type { WalletState } from "../../lib/types";

type WalletLinkProps = {
  client: SentinelClient;
  session: AuthMeResponse;
  wallet: WalletState;
  onChanged: () => Promise<void>;
};

export function WalletLink({ client, session, wallet, onChanged }: WalletLinkProps): React.JSX.Element {
  const { signMessageAsync } = useSignMessage();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const linkedWallet = wallet.account
    ? session.wallets.find((entry) => entry.address.toLowerCase() === wallet.account?.toLowerCase())
    : undefined;

  const linkWallet = async (): Promise<void> => {
    const account = wallet.account;
    const chainId = wallet.chainId;
    if (!account || !chainId) {
      setError("Connect a wallet first.");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const nonce = await client.createWalletNonce({ address: account, chainId });
      const message = buildWalletLinkSiweMessage(nonce, account, chainId);
      const signature = await signMessageAsync({ account, message });
      await client.linkWallet({ message, signature });
      await onChanged();
    } catch (error) {
      setError(identityErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel
      title="Linked wallets"
      description="Link wallets to this identity for sign-in and discovery. Boardroom authority is always read from the chain."
      action={
        <Button disabled={!wallet.account || !wallet.chainId || pending || Boolean(linkedWallet)} variant="secondary" onClick={() => void linkWallet()}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          {linkedWallet ? "Wallet linked" : "Link connected wallet"}
        </Button>
      }
    >
      <Facts columns="three" items={[
        { label: "Connected wallet", value: wallet.account ? <AddressLink address={wallet.account} /> : "No wallet connected" },
        { label: "Connection", value: linkedWallet ? <Badge>Linked</Badge> : <Badge variant="muted">Not linked</Badge> },
        { label: "Linked wallets", value: session.wallets.length.toString() },
      ]} />
      {error ? <p className="m-0 border-t border-red-950 bg-red-950/35 p-4 text-sm text-red-200">{error}</p> : null}
      <ol className="m-0 grid list-none gap-px border-t border-zinc-800 bg-zinc-800 p-0">
        {session.wallets.length === 0 ? (
          <li className="bg-zinc-950 p-4 text-sm text-zinc-500">No linked wallets</li>
        ) : session.wallets.map((entry) => (
          <li className="grid min-w-0 gap-3 bg-zinc-950 p-4 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.35fr)] md:items-center" key={entry.address}>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <WalletCards className="h-4 w-4 text-zinc-500" />
                <AddressLink address={entry.address as Address} />
                {entry.canSignIn ? <Badge>Sign-in enabled</Badge> : <Badge variant="muted">Discovery only</Badge>}
                {wallet.account?.toLowerCase() === entry.address.toLowerCase() ? (
                  <Badge><CheckCircle2 className="h-3.5 w-3.5" />Connected</Badge>
                ) : null}
              </div>
              <div className="mt-1 text-xs text-zinc-500">{shortAddress(entry.address)}</div>
            </div>
            <div className="text-sm text-zinc-400">Linked {formatIdentityDate(entry.verifiedAt)}</div>
          </li>
        ))}
      </ol>
      <ActionRow><Button disabled={pending} variant="ghost" onClick={() => void onChanged()}>Refresh wallets</Button></ActionRow>
    </Panel>
  );
}

export function buildWalletLinkSiweMessage(
  nonce: WalletNonceResponse,
  fallbackAddress: Address,
  fallbackChainId: number,
): string {
  if (nonce.message !== undefined) return nonce.message;
  return [
    `${nonce.domain} wants you to sign in with your Ethereum account:`,
    nonce.address ?? fallbackAddress,
    "",
    nonce.statement,
    "",
    `URI: ${nonce.uri}`,
    `Version: ${nonce.version}`,
    `Chain ID: ${(nonce.chainId ?? fallbackChainId).toString()}`,
    `Nonce: ${nonce.nonce}`,
    `Issued At: ${nonce.issuedAt}`,
    `Expiration Time: ${nonce.expirationTime}`,
  ].join("\n");
}
