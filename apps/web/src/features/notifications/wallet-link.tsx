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
import type { WalletState } from "../../lib/types";
import { errorMessage, formatSentinelDate } from "./hooks";

type WalletLinkProps = {
  client: SentinelClient;
  session: AuthMeResponse;
  wallet: WalletState;
  onChanged: () => Promise<void>;
};

export function WalletLink({
  client,
  session,
  wallet,
  onChanged,
}: WalletLinkProps): React.JSX.Element {
  const { signMessageAsync } = useSignMessage();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<string>();
  const linkedWallet = wallet.account
    ? session.wallets.find((linkedWallet) => linkedWallet.address.toLowerCase() === wallet.account?.toLowerCase())
    : undefined;
  const alertWallet = linkedWallet?.alertsEnabled === true ? linkedWallet : undefined;
  const enabledWalletCount = session.wallets.filter((linkedWallet) => linkedWallet.alertsEnabled).length;
  const connectedWalletPending = linkedWallet !== undefined && pending === linkedWallet.address;

  const linkWallet = async (): Promise<void> => {
    const account = wallet.account;
    const chainId = wallet.chainId;
    if (!account || !chainId) {
      setError("Connect wallet first.");
      return;
    }

    setPending("link");
    setError(undefined);
    try {
      const nonce = await client.createWalletNonce({ address: account, chainId });
      const message = buildSentinelSiweMessage(nonce, account, chainId);
      const signature = await signMessageAsync({ account, message });
      await client.linkWallet({ message, signature });
      await onChanged();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(undefined);
    }
  };

  const setAlertCoverage = async (address: Address, alertsEnabled: boolean): Promise<void> => {
    setPending(address);
    setError(undefined);
    try {
      await client.setWalletAlerts(address, { alertsEnabled });
      await onChanged();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(undefined);
    }
  };

  return (
    <Panel
      title="Wallets"
      description="Every linked wallet can sign in. Choose which wallets we watch for alerts."
      action={
        <Button
          disabled={!wallet.account || !wallet.chainId || pending !== undefined || Boolean(alertWallet)}
          variant="secondary"
          onClick={() =>
            linkedWallet
              ? void setAlertCoverage(linkedWallet.address as Address, true)
              : void linkWallet()
          }
        >
          {pending === "link" || connectedWalletPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Link2 className="h-4 w-4" />
          )}
          {linkedWallet ? "Watch alerts" : "Link connected wallet"}
        </Button>
      }
    >
      <Facts
        columns="three"
        items={[
          { label: "Connected wallet", value: wallet.account ? <AddressLink address={wallet.account} /> : "No wallet connected" },
          {
            label: "Status",
            value: !wallet.account ? (
              <Badge variant="muted">No wallet connected</Badge>
            ) : alertWallet ? (
              <Badge>Watching alerts</Badge>
            ) : linkedWallet ? (
              <Badge variant="muted">Linked, not watching</Badge>
            ) : (
              <Badge variant="muted">Not linked to this account</Badge>
            ),
          },
          { label: "Watching alerts", value: `${enabledWalletCount.toString()} wallet${enabledWalletCount === 1 ? "" : "s"}` },
        ]}
      />
      {error ? <p className="m-0 border-t border-red-950 bg-red-950/35 p-4 text-sm text-red-200">{error}</p> : null}
      <ol className="m-0 grid list-none gap-px border-t border-zinc-800 bg-zinc-800 p-0">
        {session.wallets.length === 0 ? (
          <li className="bg-zinc-950 p-4 text-sm text-zinc-500">No linked wallets</li>
        ) : (
          session.wallets.map((linkedWalletRow) => (
            <li
              className="grid min-w-0 gap-3 bg-zinc-950 p-4 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.35fr)_auto] md:items-center"
              key={linkedWalletRow.address}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <WalletCards className="h-4 w-4 text-zinc-500" />
                  <AddressLink address={linkedWalletRow.address as Address} />
                  <Badge>Sign-in enabled</Badge>
                  {walletAlertsEnabled(linkedWalletRow) ? (
                    <Badge variant="muted">Watching alerts</Badge>
                  ) : (
                    <Badge variant="muted">Not watching</Badge>
                  )}
                  {wallet.account && linkedWalletRow.address.toLowerCase() === wallet.account.toLowerCase() ? (
                    <Badge variant="default">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Connected
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-zinc-500">{shortAddress(linkedWalletRow.address)}</div>
              </div>
              <div className="text-sm text-zinc-400">Linked {formatSentinelDate(linkedWalletRow.verifiedAt)}</div>
              <div className="flex md:justify-end">
                {!walletAlertsEnabled(linkedWalletRow) ? (
                  <span className="text-xs font-medium text-zinc-500">Connect this wallet to watch alerts</span>
                ) : (
                  <Button
                    disabled={pending !== undefined}
                    size="sm"
                    variant="danger"
                    onClick={() => void setAlertCoverage(linkedWalletRow.address as Address, false)}
                  >
                    {pending === linkedWalletRow.address ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Stop watching
                  </Button>
                )}
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

function walletAlertsEnabled(wallet: AuthMeResponse["wallets"][number]): boolean {
  return wallet.alertsEnabled;
}

export function buildSentinelSiweMessage(
  nonce: WalletNonceResponse,
  fallbackAddress: Address,
  fallbackChainId: number,
): string {
  if (nonce.message !== undefined) return nonce.message;
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
