import type { Address } from "@pledge.cash/sdk";
import { LogIn, LogOut, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ActionRow, Facts, Panel, WorkspaceHeader } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ChannelSettings } from "../../features/notifications/channel-settings";
import { useSentinelSession } from "../../features/notifications/hooks";
import { SubscriptionSettings } from "../../features/notifications/subscription-settings";
import { WalletLink } from "../../features/notifications/wallet-link";
import { getSentinelBaseUrl, redirectToSentinelLogin } from "../../lib/sentinel";

type SentinelSettingsViewProps = {
  account: Address | undefined;
  chainId: number;
};

export function SentinelSettingsView({ account, chainId }: SentinelSettingsViewProps): React.JSX.Element | null {
  const baseUrl = getSentinelBaseUrl();
  const session = useSentinelSession();
  const [logoutPending, setLogoutPending] = useState(false);

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
        eyebrow="Notifications"
        title="Sentinel Alerts"
        description="Governance alerts for linked wallets, delivery channels, and Boardroom subscriptions."
        action={
          session.authenticated ? (
            <Button disabled={session.loading} variant="secondary" onClick={() => void session.refresh()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          ) : undefined
        }
      />
      {session.loading && !session.me ? <LoadingPanel /> : null}
      {session.error ? (
        <Panel title="Sentinel Status">
          <p className="m-0 border-t border-red-950 bg-red-950/35 p-4 text-sm text-red-200">{session.error}</p>
          <ActionRow>
            <Button variant="secondary" onClick={() => void session.refresh()}>
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </ActionRow>
        </Panel>
      ) : null}
      {!session.loading && !session.authenticated ? <SignedOutPanel /> : null}
      {session.client && session.me ? (
        <div className="grid gap-4">
          <Panel
            title="Account"
            action={
              <Button disabled={logoutPending} variant="secondary" onClick={() => void logout()}>
                {logoutPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                Sign out
              </Button>
            }
          >
            <Facts
              columns="three"
              items={[
                { label: "Email", value: session.me.user.email },
                { label: "Wallets", value: session.me.wallets.length.toString() },
                { label: "Channels", value: session.me.channels.length.toString() },
                { label: "Subscription", value: session.me.subscription.mode === "holdings" ? "Holdings" : "Explicit Boardrooms" },
                { label: "Minimum severity", value: session.me.subscription.minSeverity },
                { label: "Status", value: <Badge>Signed in</Badge> },
              ]}
            />
          </Panel>
          <WalletLink
            account={account}
            chainId={chainId}
            client={session.client}
            session={session.me}
            onChanged={session.refresh}
          />
          <ChannelSettings channels={session.me.channels} client={session.client} onChanged={session.refresh} />
          <SubscriptionSettings
            client={session.client}
            subscription={session.me.subscription}
            onChanged={session.refresh}
          />
        </div>
      ) : null}
    </>
  );
}

function LoadingPanel(): React.JSX.Element {
  return (
    <Panel title="Sentinel Status">
      <p className="m-0 border-t border-zinc-800 p-4 text-sm text-zinc-500">Loading account</p>
    </Panel>
  );
}

function SignedOutPanel(): React.JSX.Element {
  return (
    <Panel title="Account" description="Sign in to connect wallets, Telegram, and alert preferences.">
      <ActionRow>
        <Button onClick={() => redirectToSentinelLogin()}>
          <LogIn className="h-4 w-4" />
          Sign in
        </Button>
      </ActionRow>
    </Panel>
  );
}
