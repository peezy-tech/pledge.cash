import type { Address, PledgeCashDeployment } from "@pledge.cash/sdk";
import { AddressLink, Facts, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { deploymentText } from "../../lib/deployment";
import { formatNativeTokenAmount } from "../../lib/token-amounts";
import type { FactorySnapshot } from "../../lib/types";

type DeploymentPanelProps = {
  chainId: number;
  creationFee: bigint;
  deployment: PledgeCashDeployment | undefined;
  factorySnapshot: FactorySnapshot;
  localProtocolFeeRecipient?: Address | undefined;
};

type DeploymentSummary = {
  protocolFeeRecipient: Address | undefined;
  liquidityState: string;
  boardroomState: string;
  factoryOwner: Address | undefined;
  hasTokenGrantFactory: boolean;
  tokenGrantLogic: Address | undefined;
};

type FactItem = React.ComponentProps<typeof Facts>["items"][number];

export function DeploymentPanel({
  chainId,
  creationFee,
  deployment,
  factorySnapshot,
  localProtocolFeeRecipient,
}: DeploymentPanelProps): React.JSX.Element {
  const summary = summarizeDeployment({
    deployment,
    factorySnapshot,
    localProtocolFeeRecipient,
  });

  return (
    <Panel
      title="Deployment"
      action={
        <Badge variant={summary.hasTokenGrantFactory ? "default" : "warning"}>
          {summary.hasTokenGrantFactory ? "Ready" : "Pending"}
        </Badge>
      }
    >
      <Facts
        columns="one"
        items={deploymentFacts({
          chainId,
          creationFee,
          deployment,
          summary,
        })}
      />
    </Panel>
  );
}

export function ArtifactPanel({ deployment }: { deployment: PledgeCashDeployment | undefined }): React.JSX.Element {
  return (
    <Panel title="Artifact">
      <pre className="m-0 max-h-[260px] overflow-auto border-t border-zinc-800 p-4 text-xs leading-5 text-zinc-400">
        {deploymentText(deployment)}
      </pre>
    </Panel>
  );
}

function summarizeDeployment({
  deployment,
  factorySnapshot,
  localProtocolFeeRecipient,
}: {
  deployment: PledgeCashDeployment | undefined;
  factorySnapshot: FactorySnapshot;
  localProtocolFeeRecipient: Address | undefined;
}): DeploymentSummary {
  return {
    protocolFeeRecipient: deployment?.protocolTreasury ?? localProtocolFeeRecipient,
    liquidityState: describeLiquidityState(deployment),
    boardroomState: describeBoardroomState(deployment),
    factoryOwner: factorySnapshot.owner ?? deployment?.protocolOwner,
    hasTokenGrantFactory: Boolean(deployment?.tokenGrantFactory),
    tokenGrantLogic: factorySnapshot.tokenGrantLogic ?? deployment?.tokenGrantLogic,
  };
}

function deploymentFacts({
  chainId,
  creationFee,
  deployment,
  summary,
}: {
  chainId: number;
  creationFee: bigint;
  deployment: PledgeCashDeployment | undefined;
  summary: DeploymentSummary;
}): FactItem[] {
  return [
    { label: "Chain", value: `${chainId}` },
    {
      label: "TokenGrantFactory",
      value: addressValue(deployment?.tokenGrantFactory, "Missing"),
    },
    {
      label: "TokenGrantLogic",
      value: addressValue(summary.tokenGrantLogic, "Unknown"),
    },
    { label: "Boardroom", value: summary.boardroomState },
    {
      label: "BoardroomFactory",
      value: addressValue(deployment?.boardroomFactory, deployment?.reason ?? "Not in artifact"),
    },
    { label: "Uniswap v4", value: summary.liquidityState },
    {
      label: "PoolManager",
      value: addressValue(deployment?.uniswapV4PoolManager, "Not in artifact"),
    },
    {
      label: "Protocol fee recipient",
      value: addressValue(summary.protocolFeeRecipient, "Not configured"),
    },
    {
      label: "LiquidityLockerFactory",
      value: addressValue(deployment?.liquidityLockerFactory, "Not in artifact"),
    },
    { label: "Creation fee", value: formatNativeTokenAmount(creationFee) },
    {
      label: "Factory owner",
      value: addressValue(summary.factoryOwner, "Unknown"),
    },
  ];
}

function describeBoardroomState(deployment: PledgeCashDeployment | undefined): string {
  if (deployment?.boardroomFactory) {
    return "Ready";
  }

  if (deployment?.status === "pending") {
    return "Pending";
  }

  return "Not in artifact";
}

function describeLiquidityState(deployment: PledgeCashDeployment | undefined): string {
  if (deployment?.uniswapUniversalRouter && deployment.liquidityLockerFactory) {
    return "Position locker and router ready";
  }

  if (deployment?.uniswapV4PoolManager) {
    return "PoolManager only";
  }

  return "Not in artifact";
}

function addressValue(address: Address | undefined, fallback: string): React.ReactNode {
  return address ? <AddressLink address={address} /> : fallback;
}
