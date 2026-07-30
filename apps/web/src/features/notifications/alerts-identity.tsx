import type { Address } from "@pledge.cash/sdk";
import type { AuthMeResponse } from "@pledge.cash/sentinel/dto";
import { CheckCircle2, Fingerprint, Link2, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { createSiweMessage } from "viem/siwe";
import { useSignMessage } from "wagmi";
import { AddressLink, Facts, Panel } from "../../components/shell";
import { ConnectWalletButton } from "../../components/simplekit";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { SentinelApiError, type SentinelClient, type SentinelSocialProvider } from "../../lib/sentinel";
import type { WalletState } from "../../lib/types";
import { errorMessage } from "./hooks";
import type { AlertsViewState } from "./alerts-view-state";

type AlertsIdentityProps = {
  client: SentinelClient;
  onChanged: () => Promise<void>;
  session: AuthMeResponse | undefined;
  socialProviders: SentinelSocialProvider[];
  state: AlertsViewState;
  wallet: WalletState;
  walletlessSocialSignIn: boolean;
};

type BuildAlertsSiweMessageOptions = {
  address: Address;
  chainId: number;
  domain: string;
  issuedAt?: Date | undefined;
  nonce: string;
  uri: string;
};

const SOCIAL_PROVIDER_LABELS: Record<SentinelSocialProvider, string> = {
  apple: "Apple",
  discord: "Discord",
  github: "GitHub",
  telegram: "Telegram",
  twitter: "X",
};

export function AlertsIdentity({
  client,
  onChanged,
  session,
  socialProviders,
  state,
  wallet,
  walletlessSocialSignIn,
}: AlertsIdentityProps): React.JSX.Element {
  const { signMessageAsync } = useSignMessage();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<string>();
  const linkedProviders = authProviders(session);
  const enabledWalletCount = session?.wallets.filter((linkedWallet) => linkedWallet.alertsEnabled).length ?? 0;
  const status = identityStatus(state, walletlessSocialSignIn);
  const visibleSocialProviders = alertsSocialProviders(
    socialProviders,
    session !== undefined,
    walletlessSocialSignIn,
  );

  const signInWithWallet = async (): Promise<void> => {
    const account = wallet.account;
    const chainId = wallet.chainId;
    if (!account || !chainId) {
      setError("Connect a wallet first.");
      return;
    }

    setPending("siwe");
    setError(undefined);
    try {
      const challenge = await client.createAuthSiweNonce({ walletAddress: account, chainId });
      const message =
        challenge.message ??
        buildAlertsSiweMessage({
          address: account,
          chainId,
          domain: browserAuthDomain(),
          nonce: challenge.nonce,
          uri: browserCallbackUrl(),
        });
      const signature = await signMessageAsync({ account, message });
      await client.verifyAuthSiwe({ chainId, message, signature, walletAddress: account });
      await onChanged();
    } catch (error) {
      setError(walletAuthError(error));
    } finally {
      setPending(undefined);
    }
  };

  const startSocialAuth = async (provider: SentinelSocialProvider, link: boolean): Promise<void> => {
    setPending(provider);
    setError(undefined);
    try {
      const callbackURL = browserCallbackUrl();
      const response = link
        ? await client.linkSocial({ callbackURL, errorCallbackURL: callbackURL, provider })
        : await client.signInSocial({ callbackURL, errorCallbackURL: callbackURL, provider });
      if (!response.url) throw new Error(`Could not continue with ${SOCIAL_PROVIDER_LABELS[provider]}.`);
      window.location.assign(response.url);
    } catch (error) {
      setError(errorMessage(error));
      setPending(undefined);
    }
  };

  return (
    <Panel
      title={status.title}
      description={status.description}
      action={
        state === "connect-wallet" ? (
          <ConnectWalletButton disabled={pending !== undefined} />
        ) : state === "sign-wallet" ? (
          <Button aria-live="polite" disabled={pending !== undefined} onClick={() => void signInWithWallet()}>
            {pending === "siwe" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
            {pending === "siwe" ? "Check your wallet" : "Sign in with wallet"}
          </Button>
        ) : state === "active" ? (
          <Badge>
            <CheckCircle2 className="h-3.5 w-3.5" />
            Active
          </Badge>
        ) : undefined
      }
    >
      {session ? (
        <Facts
          columns="three"
          items={[
            { label: "Alert wallets", value: session.wallets.length.toString() },
            { label: "Watching alerts", value: enabledWalletCount.toString() },
            {
              label: "Social sign-ins",
              value: linkedProviders.filter((provider) => provider !== "siwe").map(providerLabel).join(", ") || "None",
            },
          ]}
        />
      ) : wallet.account ? (
        <Facts
          columns="two"
          items={[
            { label: "Connected wallet", value: <AddressLink address={wallet.account} /> },
            { label: "Network used for signature", value: wallet.chainId ? `Chain ${wallet.chainId.toString()}` : "Unavailable" },
          ]}
        />
      ) : null}
      {error ? <p aria-live="polite" className="m-0 border-t border-red-950 bg-red-950/35 p-4 text-sm text-red-200">{error}</p> : null}
      {visibleSocialProviders.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="m-0 text-sm font-medium text-zinc-300">
              {session ? "Social sign-ins" : "Social sign-in"}
            </p>
            <p className="m-0 mt-1 text-xs leading-5 text-zinc-500">
              {session
                ? "Link another way to sign in to this account. It never affects on-chain authority."
                : "Social sign-in can create a walletless peezy.tech account or open an existing one."}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {visibleSocialProviders.map((provider) => {
              const linked = linkedProviders.includes(provider);
              return linked ? (
                <Badge key={provider} variant="muted">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {SOCIAL_PROVIDER_LABELS[provider]}
                </Badge>
              ) : (
                <Button
                  disabled={pending !== undefined}
                  key={provider}
                  size="sm"
                  variant="ghost"
                  onClick={() => void startSocialAuth(provider, Boolean(session))}
                >
                  {pending === provider ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                  {session ? "Link" : "Use"} {SOCIAL_PROVIDER_LABELS[provider]}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

export function buildAlertsSiweMessage({
  address,
  chainId,
  domain,
  issuedAt = new Date(),
  nonce,
  uri,
}: BuildAlertsSiweMessageOptions): string {
  const expirationTime = new Date(issuedAt.getTime() + 10 * 60 * 1_000);
  return createSiweMessage({
    address,
    chainId,
    domain,
    expirationTime,
    issuedAt,
    nonce,
    statement: "Sign in to pledge.cash alerts.",
    uri,
    version: "1",
  });
}

export function alertsSocialProviders(
  socialProviders: SentinelSocialProvider[],
  authenticated: boolean,
  walletlessSocialSignIn: boolean,
): SentinelSocialProvider[] {
  return authenticated || walletlessSocialSignIn ? socialProviders : [];
}

export function identityStatus(
  state: AlertsViewState,
  walletlessSocialSignIn: boolean,
): { description: string; title: string } {
  switch (state) {
    case "connect-wallet":
      return {
        description: walletlessSocialSignIn
          ? "Use social sign-in below, or connect a wallet for wallet-based alerts."
          : "Connect a wallet first, then sign a message to create or open your alert account.",
        title: walletlessSocialSignIn
          ? "Choose how to sign in"
          : "Connect a wallet to sign in",
      };
    case "sign-wallet":
      return {
        description: "One signature verifies wallet control. It costs no gas and stays on this page.",
        title: "Verify wallet control",
      };
    case "link-delivery":
      return {
        description: "Account ready. Link Telegram below to start receiving governance alerts.",
        title: "Choose alert delivery",
      };
    case "active":
      return {
        description: "Your sign-in methods and delivery channel are ready.",
        title: "Alerts active",
      };
  }
}

function authProviders(session: AuthMeResponse | undefined): Array<"siwe" | SentinelSocialProvider> {
  return session?.providers ?? [];
}

function providerLabel(provider: "siwe" | SentinelSocialProvider): string {
  return provider === "siwe" ? "Wallet" : SOCIAL_PROVIDER_LABELS[provider];
}

function browserAuthDomain(): string {
  if (typeof window === "undefined") throw new Error("Wallet authentication requires a browser window.");
  return window.location.host;
}

function browserCallbackUrl(): string {
  if (typeof window === "undefined") throw new Error("Authentication requires a browser window.");
  return window.location.href;
}

function walletAuthError(error: unknown): string {
  const message = errorMessage(error);
  if (/cancel|denied|reject/i.test(message)) return "Signature request was cancelled.";
  if (error instanceof SentinelApiError && error.status === 401) {
    return "Signature could not be verified. Check the connected account; smart-account wallets are not supported yet.";
  }
  return message;
}
