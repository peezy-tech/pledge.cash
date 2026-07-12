import type { Address } from "@pledge.cash/sdk";
import { LogOut, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Panel, WorkspaceHeader } from "../../components/shell";
import { Button } from "../../components/ui/button";
import { AlertsIdentity } from "../../features/notifications/alerts-identity";
import { alertsViewState } from "../../features/notifications/alerts-view-state";
import { ChannelSettings } from "../../features/notifications/channel-settings";
import { GovernanceActivity } from "../../features/notifications/governance-activity";
import { useSentinelSession } from "../../features/notifications/hooks";
import { SubscriptionSettings } from "../../features/notifications/subscription-settings";
import { WalletLink } from "../../features/notifications/wallet-link";
import { getSentinelBaseUrl, type SentinelSocialProvider } from "../../lib/sentinel";
import type { WalletState } from "../../lib/types";

type SentinelSettingsViewProps = {
  governanceChainId: number;
  wallet: WalletState;
};

export function SentinelSettingsView({ governanceChainId, wallet }: SentinelSettingsViewProps): React.JSX.Element | null {
  const baseUrl = getSentinelBaseUrl();
  const session = useSentinelSession();
  const [socialProviders, setSocialProviders] = useState<SentinelSocialProvider[]>([]);
  const [logoutPending, setLogoutPending] = useState(false);
  const focus = notificationFocusFromLocation();
  const viewState = alertsViewState(wallet, session.me);

  useEffect(() => {
    if (!session.client) {
      setSocialProviders([]);
      return;
    }

    const controller = new AbortController();
    void session.client
      .authCapabilities(controller.signal)
      .then((capabilities) => setSocialProviders(capabilities.socialProviders))
      .catch(() => setSocialProviders([]));
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
        eyebrow="Notifications"
        title="Governance alerts"
        description="Get notified when queued governance actions affect wallets you control."
        action={
          session.authenticated ? (
            <div className="flex flex-wrap gap-2">
              <Button disabled={session.loading} variant="ghost" onClick={() => void session.refresh()}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              <Button disabled={logoutPending} variant="secondary" onClick={() => void logout()}>
                {logoutPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                Sign out
              </Button>
            </div>
          ) : undefined
        }
      />
      {focus.boardroom ? (
        <GovernanceActivity
          boardroom={focus.boardroom}
          chainId={focus.chainId ?? governanceChainId}
          highlightActionHash={focus.actionHash}
        />
      ) : null}
      {session.loading && !session.me ? <LoadingPanel /> : null}
      {session.error ? (
        <Panel title="Alert service">
          <p className="m-0 border-t border-red-950 bg-red-950/35 p-4 text-sm text-red-200">{session.error}</p>
          <div className="border-t border-zinc-800 p-4">
            <Button variant="secondary" onClick={() => void session.refresh()}>
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        </Panel>
      ) : null}
      {!session.loading && !session.error && session.client ? (
        <AlertsIdentity
          client={session.client}
          onChanged={session.refresh}
          session={session.me}
          socialProviders={socialProviders}
          state={viewState}
          wallet={wallet}
        />
      ) : null}
      {session.client && session.me ? (
        <div className="mt-4 grid gap-4">
          <WalletLink
            client={session.client}
            session={session.me}
            wallet={wallet}
            onChanged={session.refresh}
          />
          <ChannelSettings channels={session.me.channels} client={session.client} onChanged={session.refresh} />
          <SubscriptionSettings
            client={session.client}
            subscription={session.me.subscription}
            returnHref={focus.returnHref}
            suggestedBoardroom={focus.boardroom ? {
              address: focus.boardroom,
              chainId: focus.chainId ?? governanceChainId,
            } : undefined}
            onChanged={session.refresh}
          />
        </div>
      ) : null}
    </>
  );
}

export function notificationFocusFromLocation(search?: string): {
  readonly actionHash?: string;
  readonly boardroom?: Address;
  readonly chainId?: number;
  readonly returnHref?: string;
} {
  const locationSearch = search ?? (typeof window === "undefined" ? undefined : window.location.search);
  if (locationSearch === undefined) {
    return {};
  }

  const params = new URLSearchParams(locationSearch);
  const boardroom = normalizedHexParam(params.get("boardroom"), 20);
  const actionHash = normalizedHexParam(params.get("action"), 32);
  const requestedChainId = Number(params.get("chain"));
  const chainId = Number.isInteger(requestedChainId) && requestedChainId > 0 ? requestedChainId : undefined;
  const returnHref = safeReturnHref(params.get("return"));
  return {
    ...(actionHash === undefined ? {} : { actionHash }),
    ...(boardroom === undefined ? {} : { boardroom: boardroom as Address }),
    ...(chainId === undefined ? {} : { chainId }),
    ...(returnHref === undefined ? {} : { returnHref }),
  };
}

function safeReturnHref(value: string | null): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  return value;
}

function normalizedHexParam(value: string | null, bytes: number): string | undefined {
  if (value === null) return undefined;
  const normalized = value.trim().toLowerCase();
  return new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`).test(normalized) ? normalized : undefined;
}

function LoadingPanel(): React.JSX.Element {
  return (
    <Panel title="Wallet identity">
      <p className="m-0 border-t border-zinc-800 p-4 text-sm text-zinc-500">Checking alert access</p>
    </Panel>
  );
}
