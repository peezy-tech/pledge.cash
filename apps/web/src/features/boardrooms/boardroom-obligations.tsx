import type { BondMarketState, DutchAuctionState, FixedPriceSaleState, MerkleAirdropState, MigratingBondingCurveState } from "@pledge.cash/sdk";
import { Children } from "react";
import type React from "react";
import { AddressLink, Facts } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { formatTokenAmount } from "../../lib/token-amounts";
import type {
  BoardroomDistributionSnapshot,
  BoardroomGrantSnapshot,
  BoardroomLockedLiquiditySnapshot,
  BoardroomSnapshot,
} from "../../lib/types";
import { GrantVestingChart } from "../grants/grant-vesting-chart";
import {
  distributionPaymentTokenAddress,
  distributionStatusLabel,
  distributionStatusTone,
  lockerStatusLabel,
  lockerStatusTone,
  remainingDistributionShares,
  StatusBadge,
} from "./boardroom-panel-shared";

export function ObligationLists({
  boardroomSnapshot,
  scope = "all",
  setDutchAuctionAddress,
  setFixedPriceSaleAddress,
  setBondMarketAddress,
  setMerkleAirdropAddress,
  setLockedLiquidityAddress,
  setMigratingCurveAddress,
}: {
  boardroomSnapshot: BoardroomSnapshot | undefined;
  scope?: "all" | "distributions" | "grants" | "liquidity";
  setDutchAuctionAddress: (address: string) => void;
  setFixedPriceSaleAddress: (address: string) => void;
  setBondMarketAddress: (address: string) => void;
  setMerkleAirdropAddress: (address: string) => void;
  setLockedLiquidityAddress: (address: string) => void;
  setMigratingCurveAddress: (address: string) => void;
}): React.JSX.Element {
  if (!boardroomSnapshot) {
    return <p className="m-0 border-t border-zinc-800 p-4 text-sm text-zinc-500">Load a Boardroom to view obligations.</p>;
  }

  return (
    <div className={`grid gap-px border-t border-zinc-800 bg-zinc-800 ${scope === "all" ? "xl:grid-cols-3" : "grid-cols-1"}`}>
      {scope === "all" || scope === "grants" ? <ObligationColumn title="Issued Grants" emptyLabel="No grants">
        {boardroomSnapshot.grantSummaries.map((grant) => (
          <GrantRow grant={grant} key={grant.address} />
        ))}
      </ObligationColumn> : null}
      {scope === "all" || scope === "distributions" ? <ObligationColumn title="Distributions" emptyLabel="No distributions">
        {boardroomSnapshot.distributionSummaries.map((distribution) => (
          <DistributionRow
            distribution={distribution}
            key={distribution.address}
            setBondMarketAddress={setBondMarketAddress}
            setDutchAuctionAddress={setDutchAuctionAddress}
            setFixedPriceSaleAddress={setFixedPriceSaleAddress}
            setMerkleAirdropAddress={setMerkleAirdropAddress}
            setMigratingCurveAddress={setMigratingCurveAddress}
          />
        ))}
      </ObligationColumn> : null}
      {scope === "all" || scope === "liquidity" ? <ObligationColumn title="Locked Liquidity" emptyLabel="No lockers">
        {boardroomSnapshot.lockedLiquiditySummaries.map((locker) => (
          <LockerRow locker={locker} key={locker.address} setLockedLiquidityAddress={setLockedLiquidityAddress} />
        ))}
      </ObligationColumn> : null}
    </div>
  );
}

function ObligationColumn({ children, emptyLabel, title }: { children: React.ReactNode; emptyLabel: string; title: string }): React.JSX.Element {
  const visibleChildren = Children.toArray(children).filter(Boolean);

  return (
    <section className="min-w-0 bg-zinc-950">
      <h3 className="m-0 border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">{title}</h3>
      {visibleChildren.length === 0 ? (
        <p className="m-0 p-4 text-sm text-zinc-500">{emptyLabel}</p>
      ) : (
        <ol className="grid gap-px bg-zinc-800">
          {visibleChildren.map((child, index) => (
            <li className="bg-zinc-950 p-4" key={index}>
              {child}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function GrantRow({ grant }: { grant: BoardroomGrantSnapshot }): React.JSX.Element {
  const statusLabel = grant.state?.closed ? "Closed" : grant.error ? "Read failed" : "Open";
  const statusTone = grant.state?.closed ? "warning" : grant.error ? "danger" : "default";

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AddressLink address={grant.address} />
        <StatusBadge label={statusLabel} tone={statusTone} />
      </div>
      {grant.error ? <p className="m-0 text-sm text-red-200">{grant.error}</p> : null}
      <Facts
        columns="one"
        items={[
          { label: "Holder", value: grant.state ? <AddressLink address={grant.state.holder} /> : "Unknown" },
          { label: "Grant size", value: formatTokenAmount(grant.state?.grantSize, grant.tokenMetadata) },
          { label: "Claimable", value: formatTokenAmount(grant.state?.claimable, grant.tokenMetadata) },
          { label: "Settleable now", value: formatTokenAmount(grant.state?.settleable, grant.tokenMetadata) },
        ]}
      />
      <GrantVestingChart state={grant.state} tokenMetadata={grant.tokenMetadata} />
    </div>
  );
}

function DistributionRow({
  distribution,
  setBondMarketAddress,
  setDutchAuctionAddress,
  setFixedPriceSaleAddress,
  setMerkleAirdropAddress,
  setMigratingCurveAddress,
}: {
  distribution: BoardroomDistributionSnapshot;
  setBondMarketAddress: (address: string) => void;
  setDutchAuctionAddress: (address: string) => void;
  setFixedPriceSaleAddress: (address: string) => void;
  setMerkleAirdropAddress: (address: string) => void;
  setMigratingCurveAddress: (address: string) => void;
}): React.JSX.Element {
  const addressAction = distributionAddressAction(distribution.kind, {
    setBondMarketAddress,
    setDutchAuctionAddress,
    setFixedPriceSaleAddress,
    setMerkleAirdropAddress,
    setMigratingCurveAddress,
  });
  const statusLabel = distributionStatusLabel(distribution);
  const statusTone = distributionStatusTone(distribution);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AddressLink address={distribution.address} />
        <StatusBadge label={statusLabel} tone={statusTone} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="muted">{distribution.kind}</Badge>
        {addressAction ? (
          <Button size="sm" variant="secondary" onClick={() => addressAction.setAddress(distribution.address)}>
            {addressAction.label}
          </Button>
        ) : null}
      </div>
      {distribution.error ? <p className="m-0 text-sm text-red-200">{distribution.error}</p> : null}
      <Facts columns="one" items={distributionFacts(distribution)} />
    </div>
  );
}

function distributionAddressAction(
  kind: BoardroomDistributionSnapshot["kind"],
  setters: {
    setBondMarketAddress: (address: string) => void;
    setDutchAuctionAddress: (address: string) => void;
    setFixedPriceSaleAddress: (address: string) => void;
    setMerkleAirdropAddress: (address: string) => void;
    setMigratingCurveAddress: (address: string) => void;
  },
): { label: string; setAddress: (address: string) => void } | undefined {
  if (kind === "bond-market") return { label: "Use Bond", setAddress: setters.setBondMarketAddress };
  if (kind === "dutch-auction") return { label: "Use Auction", setAddress: setters.setDutchAuctionAddress };
  if (kind === "fixed-price-sale") return { label: "Use Sale", setAddress: setters.setFixedPriceSaleAddress };
  if (kind === "migrating-bonding-curve") return { label: "Use Curve", setAddress: setters.setMigratingCurveAddress };
  if (kind === "merkle-airdrop") return { label: "Use Airdrop", setAddress: setters.setMerkleAirdropAddress };
  return undefined;
}

function LockerRow({ locker, setLockedLiquidityAddress }: { locker: BoardroomLockedLiquiditySnapshot; setLockedLiquidityAddress: (address: string) => void }): React.JSX.Element {
  const statusLabel = lockerStatusLabel(locker);
  const statusTone = lockerStatusTone(locker);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AddressLink address={locker.address} />
        <StatusBadge label={statusLabel} tone={statusTone} />
      </div>
      <Button size="sm" variant="secondary" onClick={() => setLockedLiquidityAddress(locker.address)}>
        Use Locker
      </Button>
      {locker.error ? <p className="m-0 text-sm text-red-200">{locker.error}</p> : null}
      <Facts
        columns="one"
        items={[
          { label: "Pool", value: locker.state?.pool ? <AddressLink address={locker.state.pool} /> : "Unknown" },
          { label: "Locked LP", value: formatTokenAmount(locker.state?.lockedLiquidity, locker.liquidityMetadata) },
          { label: "Token pair", value: locker.state ? `${locker.state.tokenA} / ${locker.state.tokenB}` : "Unknown" },
        ]}
      />
    </div>
  );
}

function distributionFacts(distribution: BoardroomDistributionSnapshot): { label: string; value: React.ReactNode }[] {
  if (distribution.kind === "dutch-auction") {
    const state = distribution.state as DutchAuctionState | undefined;
    const paymentToken = distributionPaymentTokenAddress(distribution);
    return [
      { label: "Remaining shares", value: formatTokenAmount(remainingDistributionShares(distribution), distribution.shareTokenMetadata) },
      { label: "Payment token", value: paymentToken ? <AddressLink address={paymentToken} /> : "Unknown" },
      { label: "Current price", value: formatTokenAmount(state?.currentPrice, distribution.paymentTokenMetadata) },
      { label: "Settlement price", value: formatTokenAmount(state?.settlementPrice, distribution.paymentTokenMetadata) },
    ];
  }
  if (distribution.kind === "fixed-price-sale") {
    const state = distribution.state as FixedPriceSaleState | undefined;
    const paymentToken = distributionPaymentTokenAddress(distribution);
    return [
      { label: "Remaining shares", value: formatTokenAmount(remainingDistributionShares(distribution), distribution.shareTokenMetadata) },
      { label: "Payment token", value: paymentToken ? <AddressLink address={paymentToken} /> : "Unknown" },
      { label: "Price", value: formatTokenAmount(state?.price, distribution.paymentTokenMetadata) },
    ];
  }
  if (distribution.kind === "migrating-bonding-curve") {
    const state = distribution.state as MigratingBondingCurveState | undefined;
    return [
      { label: "Remaining shares", value: formatTokenAmount(remainingDistributionShares(distribution), distribution.shareTokenMetadata) },
      { label: "Quote reserve", value: formatTokenAmount(state?.quoteReserve, distribution.quoteTokenMetadata) },
      { label: "Can migrate", value: state ? String(state.canMigrate) : "Unknown" },
    ];
  }
  if (distribution.kind === "merkle-airdrop") {
    const state = distribution.state as MerkleAirdropState | undefined;
    return [
      { label: "Remaining shares", value: formatTokenAmount(remainingDistributionShares(distribution), distribution.shareTokenMetadata) },
      { label: "Grant factory", value: state ? <AddressLink address={state.tokenGrantFactory} /> : "Unknown" },
      { label: "Merkle root", value: state?.merkleRoot ?? "Unknown" },
    ];
  }
  if (distribution.kind === "bond-market") {
    const state = distribution.state as BondMarketState | undefined;
    return [
      { label: "Remaining capacity", value: formatTokenAmount(state?.capacity, distribution.shareTokenMetadata) },
      { label: "Current price", value: formatTokenAmount(state?.currentPrice, distribution.quoteTokenMetadata) },
      { label: "Outstanding", value: formatTokenAmount(state?.outstandingPayout, distribution.shareTokenMetadata) },
      { label: "Receipt", value: "Non-transferable" },
    ];
  }
  return [];
}
