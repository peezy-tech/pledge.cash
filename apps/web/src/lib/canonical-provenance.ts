import {
  boardroomFactoryAbi,
  tokenGrantFactoryAbi,
  type Address,
  type GrantState,
  type PledgeCashDeployment,
  type PledgeCashReadClient,
} from "@pledge.cash/sdk";

export class CanonicalProvenanceError extends Error {
  readonly entity: "Boardroom" | "grant";

  constructor(entity: "Boardroom" | "grant", message: string) {
    super(message);
    this.name = "CanonicalProvenanceError";
    this.entity = entity;
  }
}

export async function assertCanonicalBoardroom(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  boardroom: Address,
): Promise<void> {
  const factory = deployment?.boardroomFactory;
  if (!factory) {
    throw new Error("The configured BoardroomFactory is unavailable, so this project cannot be verified.");
  }

  const registered = await client.readContract({
    address: factory,
    abi: boardroomFactoryAbi,
    functionName: "isBoardroom",
    args: [boardroom],
  });
  if (!registered) {
    throw new CanonicalProvenanceError(
      "Boardroom",
      "This address is not a Boardroom created by the configured BoardroomFactory.",
    );
  }
}

export async function assertCanonicalGrant(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  grant: Address,
  state: GrantState,
): Promise<void> {
  const factory = deployment?.tokenGrantFactory;
  if (!factory) {
    throw new Error("The configured TokenGrantFactory is unavailable, so this grant cannot be verified.");
  }
  if (!sameAddress(state.factory, factory)) {
    throw new CanonicalProvenanceError(
      "grant",
      "This grant was not created by the configured TokenGrantFactory.",
    );
  }

  const registeredGrant = await client.readContract({
    address: factory,
    abi: tokenGrantFactoryAbi,
    functionName: "grantForTokenId",
    args: [state.tokenId],
  });
  if (!sameAddress(registeredGrant, grant)) {
    throw new CanonicalProvenanceError(
      "grant",
      "This grant does not match the TokenGrantFactory token record.",
    );
  }
}

function sameAddress(first: Address, second: Address): boolean {
  return first.toLowerCase() === second.toLowerCase();
}
