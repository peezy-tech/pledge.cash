import { HYPEREVM_TESTNET_CHAIN_ID, type PledgeCashDeployment } from "@pledge.cash/sdk";
import { AddressLink, Facts, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { deploymentText } from "../../lib/deployment";
import { bigintString } from "../../lib/forms";
import type { FactorySnapshot } from "../../lib/types";

type DeploymentPanelProps = {
  creationFee: bigint;
  deployment: PledgeCashDeployment | undefined;
  factorySnapshot: FactorySnapshot;
};

export function DeploymentPanel({ creationFee, deployment, factorySnapshot }: DeploymentPanelProps): React.JSX.Element {
  return (
    <Panel
      title="Deployment"
      action={<Badge variant={deployment?.tokenGrantFactory ? "default" : "warning"}>{deployment?.tokenGrantFactory ? "Ready" : "Pending"}</Badge>}
    >
      <Facts
        columns="one"
        items={[
          { label: "Chain", value: `${HYPEREVM_TESTNET_CHAIN_ID}` },
          {
            label: "TokenGrantFactory",
            value: deployment?.tokenGrantFactory ? <AddressLink address={deployment.tokenGrantFactory} /> : "Missing",
          },
          {
            label: "TokenGrantLogic",
            value: factorySnapshot.tokenGrantLogic ? <AddressLink address={factorySnapshot.tokenGrantLogic} /> : "Unknown",
          },
          {
            label: "BoardroomFactory",
            value: deployment?.boardroomFactory ? <AddressLink address={deployment.boardroomFactory} /> : "Not in artifact",
          },
          { label: "Creation fee", value: `${bigintString(creationFee)} wei` },
          {
            label: "Factory owner",
            value: factorySnapshot.owner ? <AddressLink address={factorySnapshot.owner} /> : "Unknown",
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
