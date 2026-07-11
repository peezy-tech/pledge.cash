import {
  boardroomFactoryAbi,
  tokenGrantFactoryAbi,
  type Address,
  type GrantState,
  type PledgeCashDeployment,
  type PledgeCashReadClient,
} from "@pledge.cash/sdk";

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
    throw new Error("This address is not a Boardroom created by the configured BoardroomFactory.");
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
    throw new Error("This grant was not created by the configured TokenGrantFactory.");
  }

  const registeredGrant = await client.readContract({
    address: factory,
    abi: tokenGrantFactoryAbi,
    functionName: "grantForTokenId",
    args: [state.tokenId],
  });
  if (!sameAddress(registeredGrant, grant)) {
    throw new Error("This grant does not match the TokenGrantFactory token record.");
  }
}

function sameAddress(first: Address, second: Address): boolean {
  return first.toLowerCase() === second.toLowerCase();
}
