import { LogOut, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Panel, WorkspaceHeader } from "../../components/shell";
import { Button } from "../../components/ui/button";
import { IdentityAccess } from "../../features/notifications/alerts-identity";
import { WalletLink } from "../../features/notifications/wallet-link";
import { useIdentitySession } from "../../hooks/use-identity-session";
import { getSentinelBaseUrl, type SentinelAuthCapabilities } from "../../lib/sentinel";
import type { WalletState } from "../../lib/types";

type SentinelSettingsViewProps = {
  wallet: WalletState;
};

export function SentinelSettingsView({ wallet }: SentinelSettingsViewProps): React.JSX.Element | null {
  const baseUrl = getSentinelBaseUrl();
  const session = useIdentitySession();
  const [authCapabilities, setAuthCapabilities] = useState<SentinelAuthCapabilities>({
    socialProviders: [],
    walletlessSocialSignIn: false,
  });
  const [logoutPending, setLogoutPending] = useState(false);

  useEffect(() => {
    if (!session.client) {
      setAuthCapabilities({ socialProviders: [], walletlessSocialSignIn: false });
      return;
    }
    const controller = new AbortController();
    void session.client.authCapabilities(controller.signal).then(setAuthCapabilities).catch(() => {
      setAuthCapabilities({ socialProviders: [], walletlessSocialSignIn: false });
    });
    return () => controller.abort();
  }, [session.client]);

  if (!baseUrl) return null;

  const logout = async (): Promise<void> => {
    if (!session.client) return;
    setLogoutPending(true);
    try {
      await session.client.logout();
      await session.refresh();
    } finally {
      setLogoutPending(false);
    }
  };

  return (
    <>
      <WorkspaceHeader
        eyebrow="Identity"
        title="Wallet identity"
        description="Link wallets to a peezy.tech identity. Identity never grants onchain authority."
        action={session.authenticated ? (
          <div className="flex flex-wrap gap-2">
            <Button disabled={session.loading} type="button" variant="ghost" onClick={() => void session.refresh()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button disabled={logoutPending} type="button" variant="secondary" onClick={() => void logout()}>
              {logoutPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />} Sign out
            </Button>
          </div>
        ) : undefined}
      />
      {session.loading && !session.me ? <Panel title="Wallet identity"><p className="m-0 p-4 text-sm text-zinc-500">Checking access</p></Panel> : null}
      {session.error ? <Panel title="Identity service"><p className="m-0 p-4 text-sm text-red-200">{session.error}</p></Panel> : null}
      {!session.loading && !session.error && session.client ? (
        <IdentityAccess
          client={session.client}
          onChanged={session.refresh}
          session={session.me}
          socialProviders={authCapabilities.socialProviders}
          wallet={wallet}
          walletlessSocialSignIn={authCapabilities.walletlessSocialSignIn}
        />
      ) : null}
      {session.client && session.me ? (
        <div className="mt-4">
          <WalletLink client={session.client} session={session.me} wallet={wallet} onChanged={session.refresh} />
        </div>
      ) : null}
    </>
  );
}
