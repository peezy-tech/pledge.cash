import {
  assertLiveBoardroomControlRelease,
  buildBoardroomRewardFundingCalls,
  buildBoardroomRewardsClaimTransaction,
  buildBoardroomRewardsCompleteUnstakeTransaction,
  buildBoardroomRewardsCreationCall,
  buildBoardroomRewardsStakeTransaction,
  buildBoardroomRewardsTerminalizeTransaction,
  buildBoardroomRewardsUnstakeRequestTransaction,
  isZeroAddress,
  planBoardroomCallExecution,
  readBoardroomRewardsAccountState,
  readBoardroomRewardsState,
  type Address,
  type BoardroomRewardsAccountState,
  type BoardroomRewardsState,
  type BoardroomControlProofClient,
  type PledgeCashDeployment,
} from "@pledge.cash/sdk";
import { CheckCircle2, LockKeyhole, TimerReset, WalletCards } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActionButton, AddressLink } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { boardroomControlReleaseSupport } from "../../lib/deployment";
import { errorMessage, randomSalt, requireAddress, uintInput } from "../../lib/forms";
import type { ProductBoardroomDashboardState } from "../../lib/product-boardroom";
import {
  formatTokenAmount,
  parseTokenAmountInput,
  readTokenMetadata,
  readTokenMetadataMap,
  tokenMetadataFor,
  type TokenMetadata,
} from "../../lib/token-amounts";
import { KeyValueList, PageNotice, SectionHeading } from "../../app/pages/page-primitives";
import type { Capability } from "../capabilities/project-capabilities";

type RewardsSubmitTransaction = (label: string, request: Record<string, unknown>) => Promise<unknown>;
type RewardsRunAction = (actionId: string, action: () => Promise<void>) => Promise<void>;

export type BoardroomRewardsPanelProps = {
  account?: Address | undefined;
  dashboard: ProductBoardroomDashboardState;
  deployment?: PledgeCashDeployment | undefined;
  operatorMode?: boolean | undefined;
  operatorCapability?: Capability | undefined;
  pendingAction: string | undefined;
  publicClient: BoardroomControlProofClient;
  runAction: RewardsRunAction;
  submitTransaction: RewardsSubmitTransaction;
};

export function BoardroomRewardsPanel({
  account,
  dashboard,
  deployment,
  operatorMode = false,
  operatorCapability,
  pendingAction,
  publicClient,
  runAction,
  submitTransaction,
}: BoardroomRewardsPanelProps): React.JSX.Element {
  const rewardPool = dashboard.snapshot.rewardPool;
  const poolExists = !isZeroAddress(rewardPool);
  const [poolState, setPoolState] = useState<BoardroomRewardsState>();
  const [accountState, setAccountState] = useState<BoardroomRewardsAccountState>();
  const [metadataByAddress, setMetadataByAddress] = useState<Record<string, TokenMetadata>>({});
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string>();
  const [stakeAmount, setStakeAmount] = useState("");
  const [unstakeAmount, setUnstakeAmount] = useState("");
  const [cooldownDays, setCooldownDays] = useState("7");
  const [rewardAsset, setRewardAsset] = useState("");
  const [rewardAmount, setRewardAmount] = useState("");
  const [rewardDurationDays, setRewardDurationDays] = useState("30");

  const load = useCallback(async (): Promise<void> => {
    if (!poolExists) {
      setPoolState(undefined);
      setAccountState(undefined);
      setMetadataByAddress({});
      setReadError(undefined);
      return;
    }
    setLoading(true);
    setReadError(undefined);
    try {
      const nextPool = await readBoardroomRewardsState(publicClient, rewardPool);
      const [nextAccount, metadata] = await Promise.all([
        account
          ? readBoardroomRewardsAccountState(publicClient, { rewards: rewardPool, account })
          : Promise.resolve(undefined),
        readTokenMetadataMap(publicClient, [dashboard.snapshot.shareToken, ...nextPool.rewardAssets.map(({ asset }) => asset)]),
      ]);
      setPoolState(nextPool);
      setAccountState(nextAccount);
      setMetadataByAddress(metadata);
    } catch (error) {
      setReadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [account, dashboard.snapshot.shareToken, poolExists, publicClient, rewardPool]);

  useEffect(() => {
    void load();
  }, [load]);

  const shareMetadata = dashboard.snapshot.shareTokenMetadata;
  const activeShare = accountState?.activeStake ?? 0n;
  const coolingShare = (accountState?.lockedStake ?? 0n) - activeShare;
  const governanceShare = dashboard.snapshot.governanceEligibleSupply === 0n
    ? 0
    : Number(activeShare * 10_000n / dashboard.snapshot.governanceEligibleSupply) / 100;
  const releaseSupport = boardroomControlReleaseSupport(deployment);
  const canOperatePool = dashboard.snapshot.status === 0
    && !dashboard.snapshot.migrationRequired
    && releaseSupport.supported
    && operatorCapability?.status === "enabled"
    && Boolean(deployment?.boardroomRewardsFactory);

  const submitAndRefresh = async (label: string, request: Record<string, unknown>): Promise<void> => {
    await submitTransaction(label, request);
    await load();
  };

  const stake = async (): Promise<void> => {
    if (!account) throw new Error("Connect the wallet that owns the project tokens.");
    const amount = parseTokenAmountInput(stakeAmount, requireMetadata(shareMetadata, "Project token"), "Stake amount");
    if (amount === 0n) throw new Error("Stake amount must be greater than zero.");
    await submitAndRefresh("Activate Boardroom stake", buildBoardroomRewardsStakeTransaction({ rewards: rewardPool, amount }));
    setStakeAmount("");
  };

  const requestUnstake = async (): Promise<void> => {
    const amount = parseTokenAmountInput(unstakeAmount, requireMetadata(shareMetadata, "Project token"), "Unstake amount");
    if (amount === 0n) throw new Error("Unstake amount must be greater than zero.");
    await submitAndRefresh(
      "Start Boardroom unstake cooldown",
      buildBoardroomRewardsUnstakeRequestTransaction({ rewards: rewardPool, amount }),
    );
    setUnstakeAmount("");
  };

  const createPool = async (): Promise<void> => {
    if (operatorCapability?.status !== "enabled") throw new Error(operatorCapability?.reason ?? "This wallet cannot manage Boardroom rewards.");
    if (!releaseSupport.supported) throw new Error(releaseSupport.reason ?? "This Boardroom release is read-only.");
    const proof = await assertLiveBoardroomControlRelease(publicClient, deployment, dashboard.address);
    if (proof.migrationRequired || proof.facetSetHash.toLowerCase() !== dashboard.snapshot.facetSetHash.toLowerCase()) {
      throw new Error("The Boardroom protocol release changed or requires migration. Refresh before creating rewards.");
    }
    const factory = deployment?.boardroomRewardsFactory;
    if (!factory) throw new Error("Boardroom reward factory is missing from this deployment.");
    const days = uintInput(cooldownDays, "Cooldown days");
    if (days === 0n || days > 30n) throw new Error("Cooldown must be between 1 and 30 days.");
    const call = buildBoardroomRewardsCreationCall({ factory, cooldown: days * 86_400n, salt: randomSalt() });
    const plan = planBoardroomCallExecution({
      boardroom: dashboard.address,
      expectedFacetSetHash: proof.facetSetHash,
      calls: [call],
      lifecycle: {
        launched: dashboard.snapshot.launched,
        status: dashboard.snapshot.status,
        migrationRequired: false,
        controller: dashboard.snapshot.controller,
        governanceEpoch: dashboard.snapshot.governanceEpoch,
        controllerConfigurationEpoch: dashboard.snapshot.controllerConfigurationEpoch,
        proposer: dashboard.snapshot.proposer,
      },
      ...(dashboard.snapshot.launched ? { salt: randomSalt() } : {}),
    });
    await submitAndRefresh(
      plan.kind === "schedule" ? "Schedule Boardroom reward pool creation" : "Create Boardroom reward pool",
      plan.transaction,
    );
  };

  const fundReward = async (): Promise<void> => {
    if (operatorCapability?.status !== "enabled") throw new Error(operatorCapability?.reason ?? "This wallet cannot manage Boardroom rewards.");
    if (!releaseSupport.supported) throw new Error(releaseSupport.reason ?? "This Boardroom release is read-only.");
    const proof = await assertLiveBoardroomControlRelease(publicClient, deployment, dashboard.address);
    if (proof.migrationRequired || proof.facetSetHash.toLowerCase() !== dashboard.snapshot.facetSetHash.toLowerCase()) {
      throw new Error("The Boardroom protocol release changed or requires migration. Refresh before funding rewards.");
    }
    const factory = deployment?.boardroomRewardsFactory;
    const assetPolicy = deployment?.assetPolicy;
    if (!factory || !assetPolicy) throw new Error("Reward factory or asset policy is missing from this deployment.");
    const asset = requireAddress(rewardAsset, "Reward asset");
    const metadata = await readTokenMetadata(publicClient, asset);
    const amount = parseTokenAmountInput(rewardAmount, metadata, "Reward amount");
    const days = uintInput(rewardDurationDays, "Reward duration days");
    if (amount === 0n) throw new Error("Reward amount must be greater than zero.");
    if (days === 0n || days > 365n) throw new Error("Reward duration must be between 1 and 365 days.");
    const calls = buildBoardroomRewardFundingCalls({
      factory,
      assetPolicy,
      rewards: rewardPool,
      asset,
      amount,
      duration: days * 86_400n,
    });
    const plan = planBoardroomCallExecution({
      boardroom: dashboard.address,
      expectedFacetSetHash: proof.facetSetHash,
      calls,
      lifecycle: {
        launched: dashboard.snapshot.launched,
        status: dashboard.snapshot.status,
        migrationRequired: false,
        controller: dashboard.snapshot.controller,
        governanceEpoch: dashboard.snapshot.governanceEpoch,
        controllerConfigurationEpoch: dashboard.snapshot.controllerConfigurationEpoch,
        proposer: dashboard.snapshot.proposer,
      },
      ...(dashboard.snapshot.launched ? { salt: randomSalt() } : {}),
    });
    await submitAndRefresh(plan.kind === "schedule" ? "Schedule Boardroom reward funding" : "Fund Boardroom rewards", plan.transaction);
    setRewardAmount("");
  };

  return (
    <div>
      <SectionHeading
        title="Stake and rewards"
        description="Only active stake has governance power and earns funded rewards. Starting an unstake removes both immediately, then keeps tokens locked through the cooldown."
        action={poolExists ? (
          <ActionButton actionId="refresh-boardroom-rewards" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("refresh-boardroom-rewards", load)}>
            Refresh
          </ActionButton>
        ) : undefined}
      />

      {operatorMode && !releaseSupport.supported ? (
        <div className="mt-4">
          <PageNotice title="Boardroom controls are read-only" tone="warning">
            {releaseSupport.reason ?? "This deployment does not identify the accepted secure Boardroom release."}
          </PageNotice>
        </div>
      ) : null}

      {operatorMode && releaseSupport.supported && operatorCapability?.status !== "enabled" ? (
        <div className="mt-4">
          <PageNotice title="Reward controls require current authority" tone="warning">
            {operatorCapability?.reason ?? "Only the current owner before launch or controller proposer after launch may make this change."}
          </PageNotice>
        </div>
      ) : null}

      {!poolExists ? (
        <div className="mt-4">
          <PageNotice title="Staking is not enabled">
            This project has not registered its one canonical reward pool. Liquid token holders retain ownership and redemption rights, but staker veto and wind-down protections remain unavailable until a pool exists and tokens are staked.
          </PageNotice>
          {operatorMode ? (
            <div className="mt-5 max-w-xl border-l-2 border-zinc-800 pl-4">
              <Label className="text-zinc-400">
                <span>Unstake cooldown in days</span>
                <Input inputMode="numeric" value={cooldownDays} onChange={(event) => setCooldownDays(event.target.value)} />
              </Label>
              <div className="mt-3">
                <ActionButton actionId="create-boardroom-rewards" disabled={!canOperatePool} pendingAction={pendingAction} title={operatorCapability?.reason} onClick={() => void runAction("create-boardroom-rewards", createPool)}>
                  {dashboard.snapshot.launched ? "Schedule reward pool" : "Create reward pool"}
                </ActionButton>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {readError ? <div className="mt-4"><PageNotice title="Reward state could not be read" tone="danger">{readError}</PageNotice></div> : null}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Badge variant={poolState?.terminalized ? "warning" : "default"}>{poolState?.terminalized ? "Terminalized" : "Rewards active"}</Badge>
            <Badge variant={activeShare > 0n ? "default" : "muted"}>
              {!account ? "Wallet not connected" : activeShare > 0n ? "Governance active" : "No active stake"}
            </Badge>
            {loading ? <span className="text-xs text-zinc-500">Refreshing onchain state…</span> : null}
          </div>
          <KeyValueList
            columns={4}
            items={[
              { label: "Active stake", value: formatTokenAmount(activeShare, shareMetadata), detail: `${governanceShare.toFixed(2)}% of eligible supply` },
              { label: "Cooling down", value: formatTokenAmount(coolingShare, shareMetadata), detail: "Locked, with no rewards or governance power" },
              { label: "Transferable", value: formatTokenAmount(accountState?.transferableBalance, shareMetadata) },
              { label: "Pool-wide stake", value: formatTokenAmount(poolState?.totalActiveStake, shareMetadata) },
            ]}
          />

          {!account ? (
            <div className="mt-4"><PageNotice title="Connect a token holder wallet">Connect to stake, begin an unstake, complete cooldown requests, or claim rewards.</PageNotice></div>
          ) : poolState?.terminalized ? null : (
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <StakeAction
                icon={<LockKeyhole className="h-4 w-4" />}
                title="Activate stake"
                detail="Tokens remain in your wallet but cannot transfer while active. Governance power becomes usable after the prior-block check."
                amount={stakeAmount}
                onAmount={setStakeAmount}
                symbol={shareMetadata?.symbol}
                action={<ActionButton actionId="stake-boardroom-rewards" disabled={!stakeAmount.trim()} pendingAction={pendingAction} onClick={() => void runAction("stake-boardroom-rewards", stake)}>Stake tokens</ActionButton>}
              />
              <StakeAction
                icon={<TimerReset className="h-4 w-4" />}
                title="Begin cooldown"
                detail={`Active stake and governance power end immediately. Tokens unlock after ${formatDuration(poolState?.cooldown ?? 0n)}.`}
                amount={unstakeAmount}
                onAmount={setUnstakeAmount}
                symbol={shareMetadata?.symbol}
                action={<ActionButton actionId="unstake-boardroom-rewards" disabled={!unstakeAmount.trim() || activeShare === 0n} pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("unstake-boardroom-rewards", requestUnstake)}>Start cooldown</ActionButton>}
              />
            </div>
          )}

          {accountState?.pendingUnstakes.length ? (
            <div className="mt-6 border-t border-zinc-800">
              {accountState.pendingUnstakes.map((request) => {
                const ready = dashboard.snapshot.status !== 0 || request.unlockAt <= BigInt(Math.floor(Date.now() / 1000));
                const actionId = `complete-boardroom-unstake-${request.slot.toString()}`;
                return (
                  <div className="flex flex-col gap-3 border-b border-zinc-800 py-4 sm:flex-row sm:items-center sm:justify-between" key={request.slot}>
                    <div>
                      <p className="m-0 text-sm font-semibold text-zinc-100">{formatTokenAmount(request.amount, shareMetadata)} cooling down</p>
                      <p className="m-0 mt-1 text-xs text-zinc-500">{ready ? "Ready to unlock" : `Unlocks ${formatTimestamp(request.unlockAt)}`}</p>
                    </div>
                    <ActionButton actionId={actionId} disabled={!ready} pendingAction={pendingAction} variant="secondary" onClick={() => void runAction(actionId, async () => {
                      await submitAndRefresh("Complete Boardroom unstake", buildBoardroomRewardsCompleteUnstakeTransaction({ rewards: rewardPool, account: account!, slot: BigInt(request.slot) }));
                    })}>Unlock tokens</ActionButton>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="mt-6 border-t border-zinc-800 pt-5">
            <div className="flex items-center gap-2 text-zinc-300"><WalletCards className="h-4 w-4" /><h3 className="m-0 text-sm font-semibold">Funded rewards</h3></div>
            {poolState?.rewardAssets.length ? (
              <div className="mt-3 divide-y divide-zinc-800 border-y border-zinc-800">
                {poolState.rewardAssets.map((reward) => {
                  const metadata = tokenMetadataFor(metadataByAddress, reward.asset);
                  const earned = accountState?.earned.find((entry) => entry.asset.toLowerCase() === reward.asset.toLowerCase())?.amount ?? 0n;
                  const actionId = `claim-boardroom-reward-${reward.asset.toLowerCase()}`;
                  return (
                    <div className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center" key={reward.asset}>
                      <div>
                        <p className="m-0 text-base font-semibold text-zinc-50">Claimable {formatTokenAmount(earned, metadata)}</p>
                        <p className="m-0 mt-1 text-xs text-zinc-500">Rate {formatTokenAmount(reward.rewardRate, metadata, { compact: false })}/second · ends {formatTimestamp(reward.periodFinish)}</p>
                      </div>
                      <ActionButton actionId={actionId} disabled={!account || earned === 0n} pendingAction={pendingAction} onClick={() => void runAction(actionId, async () => {
                        await submitAndRefresh("Claim Boardroom reward", buildBoardroomRewardsClaimTransaction({ rewards: rewardPool, asset: reward.asset, recipient: account! }));
                      })}>Claim</ActionButton>
                    </div>
                  );
                })}
              </div>
            ) : <p className="m-0 mt-3 text-sm text-zinc-500">No reward assets are funded yet. Staking may still be used for governance.</p>}
          </div>

          {operatorMode && poolState && !poolState.terminalized ? (
            <div className="mt-6 border-t border-zinc-800 pt-5">
              <SectionHeading title="Fund a reward period" description="The reward asset must already be in the Boardroom treasury. Funding reserves it as redeemable, transfers the exact amount to the pool, and starts or extends its stream." />
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Label className="text-zinc-400"><span>Reward token</span><Input placeholder="0x…" value={rewardAsset} onChange={(event) => setRewardAsset(event.target.value)} /></Label>
                <Label className="text-zinc-400"><span>Amount</span><Input inputMode="decimal" placeholder="0.00" value={rewardAmount} onChange={(event) => setRewardAmount(event.target.value)} /></Label>
                <Label className="text-zinc-400"><span>Duration in days</span><Input inputMode="numeric" value={rewardDurationDays} onChange={(event) => setRewardDurationDays(event.target.value)} /></Label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <ActionButton actionId="fund-boardroom-rewards" disabled={!canOperatePool || !rewardAsset.trim() || !rewardAmount.trim()} pendingAction={pendingAction} title={operatorCapability?.reason} onClick={() => void runAction("fund-boardroom-rewards", fundReward)}>
                  {dashboard.snapshot.launched ? "Schedule reward funding" : "Fund rewards"}
                </ActionButton>
                <span className="text-xs text-zinc-500">Pool <AddressLink address={rewardPool} /></span>
              </div>
            </div>
          ) : null}

          {dashboard.snapshot.status !== 0 && poolState && !poolState.terminalized ? (
            <div className="mt-5 border-l-2 border-amber-300/30 pl-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-amber-200" />
                <div>
                  <p className="m-0 text-sm font-semibold text-zinc-100">Terminalize rewards before redemptions open</p>
                  <p className="m-0 mt-1 text-xs leading-5 text-zinc-500">Accrual stops at wind-down. Undistributed funding returns to the Boardroom; already-earned rewards remain claimable.</p>
                  <div className="mt-3"><ActionButton actionId="terminalize-boardroom-rewards" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("terminalize-boardroom-rewards", async () => {
                    await submitAndRefresh("Terminalize Boardroom rewards", buildBoardroomRewardsTerminalizeTransaction({ rewards: rewardPool }));
                  })}>Terminalize rewards</ActionButton></div>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function StakeAction({
  action,
  amount,
  detail,
  icon,
  onAmount,
  symbol,
  title,
}: {
  action: ReactNode;
  amount: string;
  detail: string;
  icon: ReactNode;
  onAmount: (value: string) => void;
  symbol?: string | undefined;
  title: string;
}): React.JSX.Element {
  return (
    <div className="border-l-2 border-zinc-800 pl-4">
      <div className="flex items-center gap-2 text-zinc-300">{icon}<h3 className="m-0 text-sm font-semibold">{title}</h3></div>
      <p className="m-0 mt-2 max-w-xl text-xs leading-5 text-zinc-500">{detail}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Input aria-label={`${title} amount`} inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => onAmount(event.target.value)} />
          {symbol ? <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-xs font-semibold text-zinc-500">{symbol}</span> : null}
        </div>
        {action}
      </div>
    </div>
  );
}

function requireMetadata(metadata: TokenMetadata | undefined, label: string): TokenMetadata {
  if (!metadata || metadata.decimals === undefined) throw new Error(`${label} decimals are unavailable.`);
  return metadata;
}

function formatDuration(seconds: bigint): string {
  if (seconds % 86_400n === 0n) return `${seconds / 86_400n} ${(seconds / 86_400n) === 1n ? "day" : "days"}`;
  if (seconds % 3_600n === 0n) return `${seconds / 3_600n} ${(seconds / 3_600n) === 1n ? "hour" : "hours"}`;
  return `${seconds} seconds`;
}

function formatTimestamp(timestamp: bigint): string {
  if (timestamp === 0n) return "not scheduled";
  return new Date(Number(timestamp) * 1_000).toLocaleString();
}
