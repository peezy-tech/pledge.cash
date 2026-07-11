import {
  boardroomFactoryAbi,
  distributionFactoryAbi,
  lockedLiquidityFactoryAbi,
  tokenGrantFactoryAbi,
  type Address,
  type BoardroomState,
  type FixedPriceSaleState,
  type GrantState,
  type LockedLiquidityState,
  type MerkleAirdropState,
  type MigratingBondingCurveState,
  type PledgeCashDeployment,
  type PledgeCashReadClient,
} from "@pledge.cash/sdk";

export class CanonicalProvenanceError extends Error {
  readonly entity: "Boardroom" | "distribution" | "grant" | "locked liquidity";

  constructor(entity: "Boardroom" | "distribution" | "grant" | "locked liquidity", message: string) {
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

export async function assertCanonicalFixedPriceSale(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  boardroom: BoardroomState,
  sale: FixedPriceSaleState,
): Promise<void> {
  await assertCanonicalDistributionBase(client, deployment, boardroom, sale, 0);
}

export async function assertCanonicalMerkleAirdrop(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  boardroom: BoardroomState,
  airdrop: MerkleAirdropState,
): Promise<void> {
  await assertCanonicalDistributionBase(client, deployment, boardroom, airdrop, 2);
  const grantFactory = requireConfiguredAddress(
    deployment?.tokenGrantFactory,
    "TokenGrantFactory",
    "this airdrop",
  );
  if (!sameAddress(airdrop.tokenGrantFactory, grantFactory)) {
    throw new CanonicalProvenanceError(
      "distribution",
      "This airdrop is not wired to the configured TokenGrantFactory.",
    );
  }
}

export async function assertCanonicalMigratingBondingCurve(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  boardroom: BoardroomState,
  curve: MigratingBondingCurveState,
): Promise<void> {
  await assertCanonicalDistributionBase(client, deployment, boardroom, curve, 1);
  const liquidityFactory = requireConfiguredAddress(
    deployment?.lockedLiquidityFactory,
    "LockedLiquidityFactory",
    "this bonding curve",
  );
  if (!sameAddress(curve.lockedLiquidityFactory, liquidityFactory)) {
    throw new CanonicalProvenanceError(
      "distribution",
      "This bonding curve is not wired to the configured LockedLiquidityFactory.",
    );
  }
}

export async function assertCanonicalLockedLiquidity(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  boardroom: BoardroomState,
  position: LockedLiquidityState,
): Promise<void> {
  const factory = requireConfiguredAddress(
    deployment?.lockedLiquidityFactory,
    "LockedLiquidityFactory",
    "this locked-liquidity position",
  );
  const router = requireConfiguredAddress(deployment?.ammRouter, "AMM router", "this locked-liquidity position");
  if (!sameAddress(position.factory, factory)) {
    throw new CanonicalProvenanceError(
      "locked liquidity",
      "This position was not created by the configured LockedLiquidityFactory.",
    );
  }
  if (!sameAddress(position.boardroom, boardroom.address)) {
    throw new CanonicalProvenanceError(
      "locked liquidity",
      "This position does not belong to the verified Boardroom.",
    );
  }
  const registered = await client.readContract({
    address: factory,
    abi: lockedLiquidityFactoryAbi,
    functionName: "isLocker",
    args: [position.address],
  });
  if (!registered) {
    throw new CanonicalProvenanceError(
      "locked liquidity",
      "This position is not registered by the configured LockedLiquidityFactory.",
    );
  }
  const registeredBoardroom = await client.readContract({
    address: factory,
    abi: lockedLiquidityFactoryAbi,
    functionName: "lockerBoardroom",
    args: [position.address],
  });
  if (!sameAddress(registeredBoardroom, boardroom.address)) {
    throw new CanonicalProvenanceError(
      "locked liquidity",
      "This position does not match the LockedLiquidityFactory Boardroom record.",
    );
  }
  if (!sameAddress(position.router, router)) {
    throw new CanonicalProvenanceError(
      "locked liquidity",
      "This position is not wired to the configured AMM router.",
    );
  }
  if (!sameAddress(position.tokenA, boardroom.shareToken) && !sameAddress(position.tokenB, boardroom.shareToken)) {
    throw new CanonicalProvenanceError(
      "locked liquidity",
      "This position does not contain the verified Boardroom share token.",
    );
  }
}

async function assertCanonicalDistributionBase(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  boardroom: BoardroomState,
  distribution: FixedPriceSaleState | MerkleAirdropState | MigratingBondingCurveState,
  expectedKind: 0 | 1 | 2,
): Promise<void> {
  const factory = requireConfiguredAddress(
    deployment?.distributionFactory,
    "DistributionFactory",
    "this distribution",
  );
  if (!sameAddress(distribution.factory, factory)) {
    throw new CanonicalProvenanceError(
      "distribution",
      "This distribution was not created by the configured DistributionFactory.",
    );
  }
  if (!sameAddress(distribution.boardroom, boardroom.address)) {
    throw new CanonicalProvenanceError(
      "distribution",
      "This distribution does not belong to the verified Boardroom.",
    );
  }
  const registered = await client.readContract({
    address: factory,
    abi: distributionFactoryAbi,
    functionName: "isDistribution",
    args: [distribution.address],
  });
  if (!registered) {
    throw new CanonicalProvenanceError(
      "distribution",
      "This distribution is not registered by the configured DistributionFactory.",
    );
  }
  const [registeredBoardroom, registeredKind] = await Promise.all([
    client.readContract({
      address: factory,
      abi: distributionFactoryAbi,
      functionName: "distributionBoardroom",
      args: [distribution.address],
    }),
    client.readContract({
      address: factory,
      abi: distributionFactoryAbi,
      functionName: "distributionKind",
      args: [distribution.address],
    }),
  ]);
  if (!sameAddress(registeredBoardroom, boardroom.address)) {
    throw new CanonicalProvenanceError(
      "distribution",
      "This distribution does not match the DistributionFactory Boardroom record.",
    );
  }
  if (Number(registeredKind) !== expectedKind) {
    throw new CanonicalProvenanceError(
      "distribution",
      "This distribution does not match the DistributionFactory type record.",
    );
  }
  if (!sameAddress(distribution.shareToken, boardroom.shareToken)) {
    throw new CanonicalProvenanceError(
      "distribution",
      "This distribution does not use the verified Boardroom share token.",
    );
  }
}

function requireConfiguredAddress(
  address: Address | undefined,
  label: string,
  subject: string,
): Address {
  if (!address) throw new Error(`The configured ${label} is unavailable, so ${subject} cannot be verified.`);
  return address;
}

function sameAddress(first: Address, second: Address): boolean {
  return first.toLowerCase() === second.toLowerCase();
}
