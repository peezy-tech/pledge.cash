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
import { identityErrorMessage } from "../../hooks/use-identity-session";
import { SentinelApiError, type SentinelClient, type SentinelSocialProvider } from "../../lib/sentinel";
import type { WalletState } from "../../lib/types";

type IdentityAccessProps = {
  client: SentinelClient;
  onChanged: () => Promise<void>;
  session: AuthMeResponse | undefined;
  socialProviders: SentinelSocialProvider[];
  wallet: WalletState;
  walletlessSocialSignIn: boolean;
};

type BuildIdentitySiweMessageOptions = {
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

export function IdentityAccess({
  client,
  onChanged,
  session,
  socialProviders,
  wallet,
  walletlessSocialSignIn,
}: IdentityAccessProps): React.JSX.Element {
  const { signMessageAsync } = useSignMessage();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<string>();
  const linkedProviders = session?.providers ?? [];
  const visibleSocialProviders = session || walletlessSocialSignIn ? socialProviders : [];
  const canSignWithWallet = Boolean(wallet.account && wallet.chainId);

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
      const message = challenge.message ?? buildIdentitySiweMessage({
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

  const startSocialAuth = async (provider: SentinelSocialProvider): Promise<void> => {
    setPending(provider);
    setError(undefined);
    try {
      const callbackURL = browserCallbackUrl();
      const response = session
        ? await client.linkSocial({ callbackURL, errorCallbackURL: callbackURL, provider })
        : await client.signInSocial({ callbackURL, errorCallbackURL: callbackURL, provider });
      if (!response.url) throw new Error(`Could not continue with ${SOCIAL_PROVIDER_LABELS[provider]}.`);
      window.location.assign(response.url);
    } catch (error) {
      setError(identityErrorMessage(error));
      setPending(undefined);
    }
  };

  return (
    <Panel
      title={session ? "Identity active" : canSignWithWallet ? "Verify wallet control" : "Choose how to sign in"}
      description={session
        ? "This identity groups sign-in methods and linked wallets. It never grants onchain authority."
        : canSignWithWallet
          ? "One signature verifies wallet control. It costs no gas."
          : "Connect a wallet or use an enabled social provider to open a peezy.tech identity."}
      action={session ? (
        <Badge><CheckCircle2 className="h-3.5 w-3.5" /> Active</Badge>
      ) : canSignWithWallet ? (
        <Button disabled={pending !== undefined} onClick={() => void signInWithWallet()}>
          {pending === "siwe" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
          {pending === "siwe" ? "Check your wallet" : "Sign in with wallet"}
        </Button>
      ) : (
        <ConnectWalletButton disabled={pending !== undefined} />
      )}
    >
      {session ? (
        <Facts columns="three" items={[
          { label: "Linked wallets", value: session.wallets.length.toString() },
          { label: "Sign-in methods", value: linkedProviders.length.toString() },
          { label: "Authority", value: "Identity only; never onchain" },
        ]} />
      ) : wallet.account ? (
        <Facts columns="two" items={[
          { label: "Connected wallet", value: <AddressLink address={wallet.account} /> },
          { label: "Signature network", value: wallet.chainId ? `Chain ${wallet.chainId.toString()}` : "Unavailable" },
        ]} />
      ) : null}
      {error ? <p aria-live="polite" className="m-0 border-t border-red-950 bg-red-950/35 p-4 text-sm text-red-200">{error}</p> : null}
      {visibleSocialProviders.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="m-0 text-sm font-medium text-zinc-300">{session ? "Link another sign-in" : "Social sign-in"}</p>
            <p className="m-0 mt-1 text-xs leading-5 text-zinc-500">Social accounts affect sign-in only, never Boardroom ownership.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {visibleSocialProviders.map((provider) => linkedProviders.includes(provider) ? (
              <Badge key={provider} variant="muted"><ShieldCheck className="h-3.5 w-3.5" />{SOCIAL_PROVIDER_LABELS[provider]}</Badge>
            ) : (
              <Button disabled={pending !== undefined} key={provider} size="sm" variant="ghost" onClick={() => void startSocialAuth(provider)}>
                {pending === provider ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                {session ? "Link" : "Use"} {SOCIAL_PROVIDER_LABELS[provider]}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

export function buildIdentitySiweMessage({
  address,
  chainId,
  domain,
  issuedAt = new Date(),
  nonce,
  uri,
}: BuildIdentitySiweMessageOptions): string {
  return createSiweMessage({
    address,
    chainId,
    domain,
    expirationTime: new Date(issuedAt.getTime() + 10 * 60 * 1_000),
    issuedAt,
    nonce,
    statement: "Sign in to pledge.cash.",
    uri,
    version: "1",
  });
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
  const message = identityErrorMessage(error);
  if (/cancel|denied|reject/i.test(message)) return "Signature request was cancelled.";
  if (error instanceof SentinelApiError && error.status === 401) {
    return "Signature could not be verified. Check the connected account.";
  }
  return message;
}
