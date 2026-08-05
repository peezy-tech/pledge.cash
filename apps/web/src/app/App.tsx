import { ArrowRight, BadgeDollarSign, Landmark, LockKeyhole } from "lucide-react";
import { ConnectWalletButton } from "../components/simplekit";
import { ButtonLink } from "../components/ui/button";
import { PLEDGE_CASH_NETWORKS } from "../lib/contracts";

const coreSurfaces = [
  {
    description: "Create and inspect escrow-backed token grants with explicit vesting and settlement terms.",
    href: "/portfolio",
    icon: BadgeDollarSign,
    label: "Token grants",
  },
  {
    description: "Hold project assets, issue shares, wind down, and redeem through a single custody boundary.",
    href: "/studio",
    icon: Landmark,
    label: "Boardrooms",
  },
  {
    description: "Keep one canonical Uniswap v4 position locked while fees remain collectable.",
    href: "/explore",
    icon: LockKeyhole,
    label: "Locked liquidity",
  },
] as const;

export function App(): React.JSX.Element {
  return (
    <div className="min-h-svh bg-[var(--pc-canvas)] text-[var(--pc-text)]">
      <header className="border-b border-[var(--pc-border)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <a className="text-sm font-semibold tracking-[-0.02em]" href="/">pledge.cash</a>
          <ConnectWalletButton compactOnMobile />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--pc-accent)]">
          Lean protocol core
        </p>
        <h1 className="m-0 mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
          Grants, custody, and locked liquidity.
        </h1>
        <p className="m-0 mt-5 max-w-2xl text-base leading-7 text-[var(--pc-text-muted)]">
          Project launches use Uniswap’s native launchpad. pledge.cash keeps the smaller set of contracts that
          coordinate grants, treasury custody, fee collection, wind-down, and redemption.
        </p>

        <div className="mt-10 grid border-y border-[var(--pc-border)] md:grid-cols-3">
          {coreSurfaces.map(({ description, href, icon: Icon, label }) => (
            <a
              className="group border-b border-[var(--pc-border)] px-0 py-6 last:border-b-0 md:border-b-0 md:border-r md:px-6 md:first:pl-0 md:last:border-r-0"
              href={href}
              key={label}
            >
              <Icon className="h-5 w-5 text-[var(--pc-accent)]" />
              <div className="mt-5 flex items-center justify-between gap-4">
                <h2 className="m-0 text-lg font-semibold">{label}</h2>
                <ArrowRight className="h-4 w-4 text-[var(--pc-text-subtle)] transition-transform group-hover:translate-x-1" />
              </div>
              <p className="m-0 mt-2 text-sm leading-6 text-[var(--pc-text-muted)]">{description}</p>
            </a>
          ))}
        </div>

        <section className="mt-12 flex flex-col items-start justify-between gap-5 border-l-2 border-[var(--pc-accent)] pl-5 sm:flex-row sm:items-center">
          <div>
            <h2 className="m-0 text-base font-semibold">Configured test networks</h2>
            <p className="m-0 mt-1 text-sm text-[var(--pc-text-muted)]">
              {PLEDGE_CASH_NETWORKS.filter(({ environment }) => environment === "testnet").map(({ name }) => name).join(" · ")}
            </p>
          </div>
          <ButtonLink href="/studio" variant="secondary">Open Studio</ButtonLink>
        </section>
      </main>
    </div>
  );
}
