import type { FixedPriceSaleState, MigratingBondingCurveState } from "@pledge.cash/sdk";
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
import { curveStatusLabel, saleStatusLabel, StatusBadge } from "./boardroom-panel-shared";

export function ObligationLists({
  boardroomSnapshot,
  setFixedPriceSaleAddress,
  setLockedLiquidityAddress,
  setMigratingCurveAddress,
}: {
  boardroomSnapshot: BoardroomSnapshot | undefined;
  setFixedPriceSaleAddress: (address: string) => void;
  setLockedLiquidityAddress: (address: string) => void;
  setMigratingCurveAddress: (address: string) => void;
}): React.JSX.Element {
  if (!boardroomSnapshot) {
    return <p className="m-0 border-t border-zinc-800 p-4 text-sm text-zinc-500">Load a Boardroom to view obligations.</p>;
  }

  return (
    <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 xl:grid-cols-3">
      <ObligationColumn title="Issued Grants" emptyLabel="No grants">
        {boardroomSnapshot.grantSummaries.map((grant) => (
          <GrantRow grant={grant} key={grant.address} />
        ))}
      </ObligationColumn>
      <ObligationColumn title="Distributions" emptyLabel="No distributions">
        {boardroomSnapshot.distributionSummaries.map((distribution) => (
          <DistributionRow
            distribution={distribution}
            key={distribution.address}
            setFixedPriceSaleAddress={setFixedPriceSaleAddress}
            setMigratingCurveAddress={setMigratingCurveAddress}
          />
        ))}
      </ObligationColumn>
      <ObligationColumn title="Locked Liquidity" emptyLabel="No lockers">
        {boardroomSnapshot.lockedLiquiditySummaries.map((locker) => (
          <LockerRow locker={locker} key={locker.address} setLockedLiquidityAddress={setLockedLiquidityAddress} />
        ))}
      </ObligationColumn>
    </div>
  );
}

function ObligationColumn({ children, emptyLabel, title }: { children: React.ReactNode; emptyLabel: string; title: string }): React.JSX.Element {
  const childArray = Array.isArray(children) ? children : [children];
  const visibleChildren = childArray.filter(Boolean);

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
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AddressLink address={grant.address} />
        <StatusBadge label={grant.state?.closed ? "Closed" : grant.error ? "Read failed" : "Open"} tone={grant.state?.closed ? "warning" : grant.error ? "danger" : "default"} />
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
  setFixedPriceSaleAddress,
  setMigratingCurveAddress,
}: {
  distribution: BoardroomDistributionSnapshot;
  setFixedPriceSaleAddress: (address: string) => void;
  setMigratingCurveAddress: (address: string) => void;
}): React.JSX.Element {
  const isFixedSale = distribution.kind === "fixed-price-sale";
  const status = isFixedSale
    ? saleStatusLabel((distribution.state as FixedPriceSaleState | undefined)?.saleStatus)
    : curveStatusLabel((distribution.state as MigratingBondingCurveState | undefined)?.curveStatus);
  const closed = Boolean(distribution.state?.closed);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AddressLink address={distribution.address} />
        <StatusBadge label={distribution.error ? "Read failed" : status} tone={closed ? "warning" : distribution.error ? "danger" : "default"} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="muted">{distribution.kind}</Badge>
        {distribution.kind === "fixed-price-sale" ? (
          <Button size="sm" variant="secondary" onClick={() => setFixedPriceSaleAddress(distribution.address)}>
            Use Sale
          </Button>
        ) : distribution.kind === "migrating-bonding-curve" ? (
          <Button size="sm" variant="secondary" onClick={() => setMigratingCurveAddress(distribution.address)}>
            Use Curve
          </Button>
        ) : null}
      </div>
      {distribution.error ? <p className="m-0 text-sm text-red-200">{distribution.error}</p> : null}
      <Facts columns="one" items={distributionFacts(distribution)} />
    </div>
  );
}

function LockerRow({ locker, setLockedLiquidityAddress }: { locker: BoardroomLockedLiquiditySnapshot; setLockedLiquidityAddress: (address: string) => void }): React.JSX.Element {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AddressLink address={locker.address} />
        <StatusBadge label={locker.error ? "Read failed" : locker.state?.lockedLiquidity === 0n ? "Exited" : "Locked"} tone={locker.error ? "danger" : locker.state?.lockedLiquidity === 0n ? "warning" : "default"} />
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
  if (distribution.kind === "fixed-price-sale") {
    const state = distribution.state as FixedPriceSaleState | undefined;
    return [
      { label: "Remaining shares", value: formatTokenAmount(state?.remainingShares, distribution.shareTokenMetadata) },
      { label: "Payment token", value: state ? <AddressLink address={state.paymentToken} /> : "Unknown" },
      { label: "Price", value: formatTokenAmount(state?.price, distribution.paymentTokenMetadata) },
    ];
  }
  if (distribution.kind === "migrating-bonding-curve") {
    const state = distribution.state as MigratingBondingCurveState | undefined;
    return [
      { label: "Remaining shares", value: formatTokenAmount(state?.remainingSaleShares, distribution.shareTokenMetadata) },
      { label: "Quote reserve", value: formatTokenAmount(state?.quoteReserve, distribution.quoteTokenMetadata) },
      { label: "Can migrate", value: state ? String(state.canMigrate) : "Unknown" },
    ];
  }
  return [];
}
