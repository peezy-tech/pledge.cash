import { isAddress, keccak256, type Address, type Hex, type PublicClient } from "viem";

import {
  boardroomAbi,
  boardroomControllerAbi,
  boardroomControllerFactoryAbi,
  boardroomFactoryAbi,
  type PledgeCashDeployment,
} from "../generated";

export const SECURE_BOARDROOM_RELEASE_VERSION = "pledge.cash.deterministic.v5";

export type BoardroomControlReleaseSupport = {
  supported: boolean;
  reason?: string | undefined;
};

export type BoardroomControlProofClient = Pick<PublicClient, "getBlockNumber" | "getCode" | "readContract">;

export type BoardroomControlReleaseProof = {
  blockNumber: bigint;
  controller: Address;
  controllerGeneration: bigint;
  launched: boolean;
};

export class BoardroomControlReleaseProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardroomControlReleaseProofError";
  }
}

const REQUIRED_ADDRESS_FIELDS = [
  "boardroomFactory",
  "boardroomControllerFactory",
  "boardroomControllerLogic",
  "boardroomGovernanceLogic",
  "boardroomMarketLogic",
  "boardroomRedemptionPayout",
  "boardroomLogic",
] as const satisfies readonly (keyof PledgeCashDeployment)[];

const REQUIRED_CODE_HASH_FIELDS = [
  "deterministicReleaseCodeHash",
  "boardroomFactoryCodeHash",
  "boardroomControllerFactoryCodeHash",
  "boardroomControllerCodeHash",
  "boardroomGovernanceLogicCodeHash",
  "boardroomMarketLogicCodeHash",
  "boardroomRedemptionPayoutCodeHash",
  "boardroomLogicCodeHash",
] as const satisfies readonly (keyof PledgeCashDeployment)[];

/** Fail-closed metadata gate shared before any v5 launch/control write or indexing pass. */
export function boardroomControlReleaseSupport(
  deployment: PledgeCashDeployment | undefined,
): BoardroomControlReleaseSupport {
  if (!deployment) return { supported: false, reason: "The runtime deployment artifact is unavailable." };
  if (deployment.deterministicDeploymentVersion !== SECURE_BOARDROOM_RELEASE_VERSION) {
    return {
      supported: false,
      reason: `This deployment is not the accepted ${SECURE_BOARDROOM_RELEASE_VERSION} Boardroom release. Legacy and unknown releases remain read-only.`,
    };
  }
  if (deployment.deterministicDeployment !== true) {
    return { supported: false, reason: "The Boardroom release is not attested as deterministic." };
  }

  for (const field of REQUIRED_ADDRESS_FIELDS) {
    const value = deployment[field];
    if (typeof value !== "string" || !isAddress(value) || isZeroAddress(value as Address)) {
      return { supported: false, reason: `The accepted Boardroom release address ${field} is missing or invalid.` };
    }
  }
  for (const field of REQUIRED_CODE_HASH_FIELDS) {
    const value = deployment[field];
    if (!isCodeHash(value)) {
      return {
        supported: false,
        reason: `The accepted Boardroom release code-hash attestation ${field} is missing or invalid.`,
      };
    }
  }
  return { supported: true };
}

/**
 * Pins one chain head and proves the complete v5 release roots plus the selected Boardroom's
 * reciprocal controller relationship before a launch or governance write is prepared.
 */
export async function assertLiveBoardroomControlRelease(
  client: BoardroomControlProofClient,
  deployment: PledgeCashDeployment | undefined,
  boardroom: Address,
): Promise<BoardroomControlReleaseProof> {
  const support = boardroomControlReleaseSupport(deployment);
  if (!support.supported || !deployment) {
    throw new BoardroomControlReleaseProofError(
      support.reason ?? "The accepted secure Boardroom release cannot be proven.",
    );
  }

  const blockNumber = await client.getBlockNumber();
  const boardroomFactory = requiredAddress(deployment, "boardroomFactory");
  const controllerFactory = requiredAddress(deployment, "boardroomControllerFactory");
  const controllerLogic = requiredAddress(deployment, "boardroomControllerLogic");
  const governanceLogic = requiredAddress(deployment, "boardroomGovernanceLogic");
  const marketLogic = requiredAddress(deployment, "boardroomMarketLogic");
  const redemptionPayoutLogic = requiredAddress(deployment, "boardroomRedemptionPayout");
  const boardroomLogic = requiredAddress(deployment, "boardroomLogic");

  await Promise.all([
    assertCodeHash(client, blockNumber, boardroomFactory, requiredCodeHash(deployment, "boardroomFactoryCodeHash")),
    assertCodeHash(
      client,
      blockNumber,
      controllerFactory,
      requiredCodeHash(deployment, "boardroomControllerFactoryCodeHash"),
    ),
    assertCodeHash(client, blockNumber, controllerLogic, requiredCodeHash(deployment, "boardroomControllerCodeHash")),
    assertCodeHash(
      client,
      blockNumber,
      governanceLogic,
      requiredCodeHash(deployment, "boardroomGovernanceLogicCodeHash"),
    ),
    assertCodeHash(client, blockNumber, marketLogic, requiredCodeHash(deployment, "boardroomMarketLogicCodeHash")),
    assertCodeHash(
      client,
      blockNumber,
      redemptionPayoutLogic,
      requiredCodeHash(deployment, "boardroomRedemptionPayoutCodeHash"),
    ),
    assertCodeHash(client, blockNumber, boardroomLogic, requiredCodeHash(deployment, "boardroomLogicCodeHash")),
  ]);

  const [
    registered,
    factoryControllerFactory,
    factoryBoardroomLogic,
    factoryGovernanceLogic,
    factoryMarketLogic,
    factoryRedemptionPayoutLogic,
    controllerFactoryBoardroomFactory,
    controllerImplementation,
    boardroomControllerFactory,
    boardroomGovernanceLogic,
    boardroomMarketLogic,
    boardroomRedemptionPayoutLogic,
    shareToken,
    launched,
    owner,
    controller,
    controllerGeneration,
  ] = await Promise.all([
    client.readContract({ address: boardroomFactory, abi: boardroomFactoryAbi, functionName: "isBoardroom", args: [boardroom], blockNumber }),
    client.readContract({ address: boardroomFactory, abi: boardroomFactoryAbi, functionName: "controllerFactory", blockNumber }),
    client.readContract({ address: boardroomFactory, abi: boardroomFactoryAbi, functionName: "boardroomLogic", blockNumber }),
    client.readContract({ address: boardroomFactory, abi: boardroomFactoryAbi, functionName: "governanceLogic", blockNumber }),
    client.readContract({ address: boardroomFactory, abi: boardroomFactoryAbi, functionName: "marketLogic", blockNumber }),
    client.readContract({ address: boardroomFactory, abi: boardroomFactoryAbi, functionName: "redemptionPayoutLogic", blockNumber }),
    client.readContract({ address: controllerFactory, abi: boardroomControllerFactoryAbi, functionName: "boardroomFactory", blockNumber }),
    client.readContract({ address: controllerFactory, abi: boardroomControllerFactoryAbi, functionName: "controllerImplementation", blockNumber }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "controllerFactory", blockNumber }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "governanceLogic", blockNumber }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "marketLogic", blockNumber }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "redemptionPayoutLogic", blockNumber }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "shareToken", blockNumber }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "launched", blockNumber }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "owner", blockNumber }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "controller", blockNumber }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "controllerGeneration", blockNumber }),
  ]);

  if (!isAddress(shareToken as string) || isZeroAddress(shareToken as Address)) fail("The Boardroom share token is invalid.");
  const registeredShareToken = await client.readContract({
    address: boardroomFactory,
    abi: boardroomFactoryAbi,
    functionName: "isShareToken",
    args: [shareToken as Address],
    blockNumber,
  });
  if (!registered || !registeredShareToken) fail("The selected Boardroom or its share token is not canonical.");
  assertAddressEqual(factoryControllerFactory as Address, controllerFactory, "BoardroomFactory controller factory");
  assertAddressEqual(factoryBoardroomLogic as Address, boardroomLogic, "Boardroom implementation");
  assertAddressEqual(factoryGovernanceLogic as Address, governanceLogic, "Boardroom governance logic");
  assertAddressEqual(factoryMarketLogic as Address, marketLogic, "Boardroom market logic");
  assertAddressEqual(factoryRedemptionPayoutLogic as Address, redemptionPayoutLogic, "Boardroom redemption logic");
  assertAddressEqual(controllerFactoryBoardroomFactory as Address, boardroomFactory, "controller-factory BoardroomFactory");
  assertAddressEqual(controllerImplementation as Address, controllerLogic, "controller implementation");
  assertAddressEqual(boardroomControllerFactory as Address, controllerFactory, "Boardroom controller factory");
  assertAddressEqual(boardroomGovernanceLogic as Address, governanceLogic, "Boardroom governance logic binding");
  assertAddressEqual(boardroomMarketLogic as Address, marketLogic, "Boardroom market logic binding");
  assertAddressEqual(
    boardroomRedemptionPayoutLogic as Address,
    redemptionPayoutLogic,
    "Boardroom redemption logic binding",
  );
  const isLaunched = launched as boolean;
  const currentController = controller as Address;
  const generation = controllerGeneration as bigint;
  if (!isLaunched) {
    if (!isZeroAddress(currentController) || generation !== 0n) {
      fail("The prelaunch Boardroom already reports controller state.");
    }
    if (isZeroAddress(owner as Address)) fail("The prelaunch Boardroom owner is invalid.");
    return { blockNumber, controller: currentController, controllerGeneration: generation, launched: false };
  }

  if (isZeroAddress(currentController) || generation === 0n) fail("The launched Boardroom controller state is incomplete.");
  assertAddressEqual(owner as Address, currentController, "launched Boardroom owner");
  const [canonical, mappedBoardroom, mappedGeneration, predicted, selfFactory, selfBoardroom, selfGeneration] =
    await Promise.all([
      client.readContract({ address: controllerFactory, abi: boardroomControllerFactoryAbi, functionName: "isController", args: [currentController], blockNumber }),
      client.readContract({ address: controllerFactory, abi: boardroomControllerFactoryAbi, functionName: "boardroomOfController", args: [currentController], blockNumber }),
      client.readContract({ address: controllerFactory, abi: boardroomControllerFactoryAbi, functionName: "generationOfController", args: [currentController], blockNumber }),
      client.readContract({ address: controllerFactory, abi: boardroomControllerFactoryAbi, functionName: "predictControllerAddress", args: [boardroom, generation], blockNumber }),
      client.readContract({ address: currentController, abi: boardroomControllerAbi, functionName: "factory", blockNumber }),
      client.readContract({ address: currentController, abi: boardroomControllerAbi, functionName: "boardroom", blockNumber }),
      client.readContract({ address: currentController, abi: boardroomControllerAbi, functionName: "generation", blockNumber }),
    ]);
  if (!canonical) fail("The launched controller is not canonical.");
  assertAddressEqual(mappedBoardroom as Address, boardroom, "controller-factory Boardroom binding");
  if ((mappedGeneration as bigint) !== generation) fail("The controller-factory generation is stale.");
  assertAddressEqual(predicted as Address, currentController, "deterministic controller address");
  assertAddressEqual(selfFactory as Address, controllerFactory, "controller factory");
  assertAddressEqual(selfBoardroom as Address, boardroom, "controller Boardroom");
  if ((selfGeneration as bigint) !== generation) fail("The controller generation is stale.");
  const controllerCode = await client.getCode({ address: currentController, blockNumber });
  if (!controllerCode || controllerCode === "0x") fail("The launched controller has no code.");

  return { blockNumber, controller: currentController, controllerGeneration: generation, launched: true };
}

function isCodeHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) && !/^0x0{64}$/.test(value);
}

function requiredAddress(
  deployment: PledgeCashDeployment,
  field: (typeof REQUIRED_ADDRESS_FIELDS)[number],
): Address {
  const value = deployment[field];
  if (typeof value !== "string" || !isAddress(value) || isZeroAddress(value as Address)) {
    fail(`The accepted Boardroom release address ${field} is missing or invalid.`);
  }
  return value as Address;
}

function requiredCodeHash(
  deployment: PledgeCashDeployment,
  field: (typeof REQUIRED_CODE_HASH_FIELDS)[number],
): Hex {
  const value = deployment[field];
  if (!isCodeHash(value)) fail(`The accepted Boardroom release code hash ${field} is missing or invalid.`);
  return value as Hex;
}

async function assertCodeHash(
  client: BoardroomControlProofClient,
  blockNumber: bigint,
  address: Address,
  expected: Hex,
): Promise<void> {
  const code = await client.getCode({ address, blockNumber });
  if (!code || code === "0x" || keccak256(code).toLowerCase() !== expected.toLowerCase()) {
    fail(`The live code hash for ${address} does not match the accepted Boardroom release.`);
  }
}

function assertAddressEqual(actual: Address, expected: Address, label: string): void {
  if (!isAddress(actual) || actual.toLowerCase() !== expected.toLowerCase()) {
    fail(`The live ${label} does not match the accepted Boardroom release.`);
  }
}

function fail(message: string): never {
  throw new BoardroomControlReleaseProofError(message);
}

function isZeroAddress(value: Address): boolean {
  return value.toLowerCase() === "0x0000000000000000000000000000000000000000";
}
