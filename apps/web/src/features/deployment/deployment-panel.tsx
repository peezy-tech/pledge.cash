import type { PledgeCashDeployment } from "@pledge.cash/sdk";
import { AddressLink, Facts, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { deploymentText } from "../../lib/deployment";
import { bigintString } from "../../lib/forms";
import type { FactorySnapshot } from "../../lib/types";

type DeploymentPanelProps = {
  chainId: number;
  creationFee: bigint;
  deployment: PledgeCashDeployment | undefined;
  factorySnapshot: FactorySnapshot;
};

export function DeploymentPanel({ chainId, creationFee, deployment, factorySnapshot }: DeploymentPanelProps): React.JSX.Element {
  const boardroomState = deployment?.boardroomFactory ? "Ready" : deployment?.boardroomStatus === "pending" ? "Pending" : "Not in artifact";
  const tokenGrantLogic = factorySnapshot.tokenGrantLogic ?? deployment?.tokenGrantLogic;
  const factoryOwner = factorySnapshot.owner ?? deployment?.factoryOwner;

  return (
    <Panel
      title="Deployment"
      action={<Badge variant={deployment?.tokenGrantFactory ? "default" : "warning"}>{deployment?.tokenGrantFactory ? "Ready" : "Pending"}</Badge>}
    >
      <Facts
        columns="one"
        items={[
          { label: "Chain", value: `${chainId}` },
          {
            label: "TokenGrantFactory",
            value: deployment?.tokenGrantFactory ? <AddressLink address={deployment.tokenGrantFactory} /> : "Missing",
          },
          {
            label: "TokenGrantLogic",
            value: tokenGrantLogic ? <AddressLink address={tokenGrantLogic} /> : "Unknown",
          },
          { label: "Boardroom", value: boardroomState },
          {
            label: "BoardroomFactory",
            value: deployment?.boardroomFactory ? <AddressLink address={deployment.boardroomFactory} /> : deployment?.boardroomReason ?? "Not in artifact",
          },
          { label: "Creation fee", value: `${bigintString(creationFee)} wei` },
          {
            label: "Factory owner",
            value: factoryOwner ? <AddressLink address={factoryOwner} /> : "Unknown",
          },
        ]}
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
