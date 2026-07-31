import {
  boardroomFactoryAbi,
  bondMarketFactoryAbi,
  distributionFactoryAbi,
  pledgeV4LiquidityFactoryAbi,
  tokenGrantFactoryAbi,
  type Address,
  type BoardroomState,
  type BondMarketState,
  type DutchAuctionState,
  type FixedPriceSaleState,
  type GrantState,
  type ProtocolLiquidityVaultState as LockedLiquidityState,
  type MerkleAirdropState,
  type MigratingBondingCurveState,
  type PledgeCashDeployment,
  type PledgeCashReadClient,
} from "@pledge.cash/sdk";
import type { Hex } from "viem";

export class CanonicalProvenanceError extends Error {
  readonly entity: "Boardroom" | "distribution" | "grant" | "protocol liquidity";

  constructor(entity: "Boardroom" | "distribution" | "grant" | "protocol liquidity", message: string) {
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

export async function assertCanonicalDutchAuction(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  boardroom: BoardroomState,
  auction: DutchAuctionState,
): Promise<void> {
  await assertCanonicalDistributionBase(client, deployment, boardroom, auction, 3);
}

export async function assertCanonicalBondMarket(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  boardroom: BoardroomState,
  market: BondMarketState,
): Promise<void> {
  const factory = requireConfiguredAddress(
    deployment?.bondMarketFactory,
    "BondMarketFactory",
    "this bond market",
  );
  if (!sameAddress(market.factory, factory)) {
    throw new CanonicalProvenanceError("distribution", "This bond market was not created by the configured BondMarketFactory.");
  }
  if (!sameAddress(market.boardroom, boardroom.address)) {
    throw new CanonicalProvenanceError("distribution", "This bond market does not belong to the verified Boardroom.");
  }
  if (!sameAddress(market.shareToken, boardroom.shareToken)) {
    throw new CanonicalProvenanceError("distribution", "This bond market does not use the verified Boardroom share token.");
  }
  const registered = await client.readContract({
    address: factory,
    abi: bondMarketFactoryAbi,
    functionName: "isBondMarket",
    args: [market.address],
  });
  if (!registered) {
    throw new CanonicalProvenanceError("distribution", "This bond market is not registered by the configured BondMarketFactory.");
  }
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
    deployment?.pledgeV4LiquidityFactory,
    "PledgeV4LiquidityFactory",
    "this bonding curve",
  );
  if (!sameAddress(curve.liquidityFactory, liquidityFactory)) {
    throw new CanonicalProvenanceError(
      "distribution",
      "This bonding curve is not wired to the configured PledgeV4LiquidityFactory.",
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
    deployment?.pledgeV4LiquidityFactory,
    "PledgeV4LiquidityFactory",
    "this protocol-liquidity position",
  );
  const poolManager = requireConfiguredAddress(
    deployment?.uniswapV4PoolManager,
    "Uniswap v4 PoolManager",
    "this protocol-liquidity position",
  );
  const hook = requireConfiguredAddress(
    deployment?.pledgeV4Hook,
    "PledgeV4Hook",
    "this protocol-liquidity position",
  );
  const protocolFeeRecipient = requireConfiguredAddress(
    deployment?.pledgeV4ProtocolFeeRecipient,
    "PledgeV4 protocol fee recipient",
    "this protocol-liquidity position",
  );
  if (!sameAddress(position.factory, factory)) {
    throw new CanonicalProvenanceError(
      "protocol liquidity",
      "This vault was not created by the configured PledgeV4LiquidityFactory.",
    );
  }
  if (!sameAddress(position.boardroom, boardroom.address)) {
    throw new CanonicalProvenanceError(
      "protocol liquidity",
      "This vault does not belong to the verified Boardroom.",
    );
  }
  if (!sameAddress(boardroom.liquidityVault, position.address)) {
    throw new CanonicalProvenanceError(
      "protocol liquidity",
      "This vault does not match the verified Boardroom liquidity record.",
    );
  }
  if (!sameHex(boardroom.liquidityPoolId, position.poolId)) {
    throw new CanonicalProvenanceError(
      "protocol liquidity",
      "This PoolId does not match the verified Boardroom liquidity record.",
    );
  }
  const registered = await client.readContract({
    address: factory,
    abi: pledgeV4LiquidityFactoryAbi,
    functionName: "isVault",
    args: [position.address],
  });
  if (!registered) {
    throw new CanonicalProvenanceError(
      "protocol liquidity",
      "This vault is not registered by the configured PledgeV4LiquidityFactory.",
    );
  }
  const registeredBoardroom = await client.readContract({
    address: factory,
    abi: pledgeV4LiquidityFactoryAbi,
    functionName: "vaultBoardroom",
    args: [position.address],
  });
  if (!sameAddress(registeredBoardroom, boardroom.address)) {
    throw new CanonicalProvenanceError(
      "protocol liquidity",
      "This vault does not match the PledgeV4LiquidityFactory Boardroom record.",
    );
  }
  const registeredVault = await client.readContract({
    address: factory,
    abi: pledgeV4LiquidityFactoryAbi,
    functionName: "vaultForPoolId",
    args: [position.poolId],
  });
  if (!sameAddress(registeredVault, position.address)) {
    throw new CanonicalProvenanceError(
      "protocol liquidity",
      "This vault does not match the PledgeV4LiquidityFactory PoolId record.",
    );
  }
  if (!sameAddress(position.poolManager, poolManager)) {
    throw new CanonicalProvenanceError(
      "protocol liquidity",
      "This vault is not wired to the configured Uniswap v4 PoolManager.",
    );
  }
  if (!sameAddress(position.hook, hook)) {
    throw new CanonicalProvenanceError(
      "protocol liquidity",
      "This vault is not wired to the configured PledgeV4Hook.",
    );
  }
  if (!sameAddress(position.protocolFeeRecipient, protocolFeeRecipient)) {
    throw new CanonicalProvenanceError(
      "protocol liquidity",
      "This vault is not wired to the configured PledgeV4 protocol fee recipient.",
    );
  }
  if (!sameAddress(position.tokenA, boardroom.shareToken) && !sameAddress(position.tokenB, boardroom.shareToken)) {
    throw new CanonicalProvenanceError(
      "protocol liquidity",
      "This vault does not contain the verified Boardroom share token.",
    );
  }
  if (!samePair(position.tokenA, position.tokenB, position.currency0, position.currency1)) {
    throw new CanonicalProvenanceError(
      "protocol liquidity",
      "This vault's Uniswap v4 currencies do not match its declared token pair.",
    );
  }
}

async function assertCanonicalDistributionBase(
  client: PledgeCashReadClient,
  deployment: PledgeCashDeployment | undefined,
  boardroom: BoardroomState,
  distribution: DutchAuctionState | FixedPriceSaleState | MerkleAirdropState | MigratingBondingCurveState,
  expectedKind: 0 | 1 | 2 | 3,
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

function sameHex(first: Hex, second: Hex): boolean {
  return first.toLowerCase() === second.toLowerCase();
}

function samePair(tokenA: Address, tokenB: Address, currency0: Address, currency1: Address): boolean {
  return (
    (sameAddress(tokenA, currency0) && sameAddress(tokenB, currency1))
    || (sameAddress(tokenA, currency1) && sameAddress(tokenB, currency0))
  );
}
