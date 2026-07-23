import { getPledgeCashDeployment, type PledgeCashDeployment } from "@pledge.cash/sdk";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  hashMessage,
  http,
  isAddress,
  keccak256,
  padHex,
  zeroAddress,
  type Address,
  type Hex
} from "viem";

import type { Config, SentinelChainConfig } from "../config";

export const SUPPORTED_BOARDROOM_CONTROL_RELEASE = "pledge.cash.deterministic.v5";
export const ERC1271_MAGIC_VALUE = "0x1626ba7e" as const;

const boardroomFactoryAbi = [
  {
    type: "function",
    name: "isBoardroom",
    stateMutability: "view",
    inputs: [{ name: "boardroom", type: "address" }],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "boardroomLogic",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "controllerFactory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  }
] as const;

const boardroomAbi = [
  {
    type: "function",
    name: "launched",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "controller",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "controllerGeneration",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "controllerFactory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  }
] as const;

const controllerFactoryAbi = [
  {
    type: "function",
    name: "boardroomFactory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "controllerImplementation",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "isController",
    stateMutability: "view",
    inputs: [{ name: "controller", type: "address" }],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "boardroomOfController",
    stateMutability: "view",
    inputs: [{ name: "controller", type: "address" }],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "generationOfController",
    stateMutability: "view",
    inputs: [{ name: "controller", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

const controllerAbi = [
  {
    type: "function",
    name: "factory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "boardroom",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "generation",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }]
  },
  {
    type: "function",
    name: "configurationEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }]
  },
  {
    type: "function",
    name: "isValidSignature",
    stateMutability: "view",
    inputs: [
      { name: "digest", type: "bytes32" },
      { name: "signature", type: "bytes" }
    ],
    outputs: [{ name: "", type: "bytes4" }]
  }
] as const;

type ControlDeployment = PledgeCashDeployment & {
  readonly boardroomControllerCodeHash?: string;
  readonly boardroomControllerFactoryCodeHash?: string;
};

export type BoardroomControlSnapshot = {
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly boardroom: Address;
  readonly chainId: number;
  readonly configurationEpoch: bigint;
  readonly controller: Address;
  readonly controllerGeneration: bigint;
};

export type BoardroomControlExpectedIdentity = Pick<
  BoardroomControlSnapshot,
  "boardroom" | "chainId" | "configurationEpoch" | "controller" | "controllerGeneration"
>;

export type BoardroomControlChainReader = {
  resolveCanonicalBoardroom(input: {
    readonly boardroom: Address;
    readonly chainId: number;
  }): Promise<BoardroomControlSnapshot>;
  verifyControlSignature(input: {
    readonly expected: BoardroomControlExpectedIdentity;
    readonly message: string;
    readonly signature: Hex;
  }): Promise<BoardroomControlSnapshot>;
};

export type BoardroomControlFailure =
  | "invalid-signature"
  | "malformed-chain-result"
  | "non-canonical-boardroom"
  | "reorg-uncertainty"
  | "rpc-failure"
  | "stale-relationship"
  | "unknown-chain"
  | "unsupported-release";

export class BoardroomControlChainError extends Error {
  constructor(readonly failure: BoardroomControlFailure) {
    super(failure);
    this.name = "BoardroomControlChainError";
  }
}

export type BoardroomControlPublicClient = {
  call(input: {
    readonly blockNumber: bigint;
    readonly data: Hex;
    readonly to: Address;
  }): Promise<{ readonly data?: Hex }>;
  getBlock(input: { readonly blockNumber: bigint } | { readonly blockTag: "finalized" }): Promise<{
    readonly hash?: Hex | null;
    readonly number?: bigint | null;
  }>;
  getChainId(): Promise<number>;
  getBytecode(input: {
    readonly address: Address;
    readonly blockNumber: bigint;
  }): Promise<Hex | undefined>;
  readContract(input: {
    readonly abi: readonly unknown[];
    readonly address: Address;
    readonly args?: readonly unknown[];
    readonly blockNumber: bigint;
    readonly functionName: string;
  }): Promise<unknown>;
};

export type CreateBoardroomControlChainReaderOptions = {
  readonly chains: readonly SentinelChainConfig[];
  readonly createClient?: (chain: SentinelChainConfig) => BoardroomControlPublicClient;
  readonly getDeployment?: (chainId: number) => PledgeCashDeployment | undefined;
};

type PinnedContext = {
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly chain: SentinelChainConfig;
  readonly client: BoardroomControlPublicClient;
  readonly deployment: Required<
    Pick<
      ControlDeployment,
      | "boardroomControllerCodeHash"
      | "boardroomControllerFactoryCodeHash"
      | "boardroomFactory"
      | "boardroomFactoryCodeHash"
      | "boardroomLogic"
      | "boardroomLogicCodeHash"
    >
  >;
};

export function createBoardroomControlChainReader(
  options: CreateBoardroomControlChainReaderOptions
): BoardroomControlChainReader {
  const chains = new Map(options.chains.map((chain) => [chain.chainId, chain]));
  const createClient =
    options.createClient ??
    ((chain: SentinelChainConfig) =>
      createPublicClient({ transport: http(chain.rpcUrl) }) as unknown as BoardroomControlPublicClient);
  const resolveDeployment = options.getDeployment ?? getPledgeCashDeployment;

  return {
    async resolveCanonicalBoardroom(input) {
      return withFailClosedErrors(async () => {
        const context = await pinContext(input.chainId, chains, createClient, resolveDeployment);
        const snapshot = await resolveAtPinnedBlock(context, input.boardroom);
        await requireSameBlock(context);
        return snapshot;
      });
    },

    async verifyControlSignature(input) {
      return withFailClosedErrors(async () => {
        const context = await pinContext(
          input.expected.chainId,
          chains,
          createClient,
          resolveDeployment
        );
        const snapshot = await resolveAtPinnedBlock(context, input.expected.boardroom);
        if (!sameIdentity(snapshot, input.expected)) {
          throw new BoardroomControlChainError("stale-relationship");
        }

        const digest = hashMessage(input.message);
        const data = encodeFunctionData({
          abi: controllerAbi,
          functionName: "isValidSignature",
          args: [digest, input.signature]
        });
        const result = await context.client.call({
          blockNumber: context.blockNumber,
          data,
          to: snapshot.controller
        });
        const expectedResult = padHex(ERC1271_MAGIC_VALUE, { dir: "right", size: 32 });
        if (result.data === undefined || result.data.toLowerCase() !== expectedResult.toLowerCase()) {
          if (result.data !== undefined && result.data.length !== 66) {
            throw new BoardroomControlChainError("malformed-chain-result");
          }
          throw new BoardroomControlChainError("invalid-signature");
        }

        await requireSameBlock(context);
        return snapshot;
      });
    }
  };
}

async function pinContext(
  chainId: number,
  chains: ReadonlyMap<number, SentinelChainConfig>,
  createClient: (chain: SentinelChainConfig) => BoardroomControlPublicClient,
  getDeployment: (chainId: number) => PledgeCashDeployment | undefined
): Promise<PinnedContext> {
  const chain = chains.get(chainId);
  if (chain === undefined) throw new BoardroomControlChainError("unknown-chain");

  const deployment = getDeployment(chainId) as ControlDeployment | undefined;
  if (
    deployment?.deterministicDeployment !== true ||
    deployment.chainId !== chainId ||
    deployment.deterministicDeploymentVersion !== SUPPORTED_BOARDROOM_CONTROL_RELEASE ||
    !isAddressValue(deployment.boardroomFactory) ||
    !isHash(deployment.boardroomFactoryCodeHash) ||
    !isAddressValue(deployment.boardroomLogic) ||
    !isHash(deployment.boardroomLogicCodeHash) ||
    !isHash(deployment.boardroomControllerFactoryCodeHash) ||
    !isHash(deployment.boardroomControllerCodeHash)
  ) {
    throw new BoardroomControlChainError("unsupported-release");
  }

  const client = createClient(chain);
  const [rpcChainId, finalized] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockTag: "finalized" })
  ]);
  if (rpcChainId !== chainId) throw new BoardroomControlChainError("unknown-chain");
  if (
    finalized.number === null ||
    finalized.number === undefined ||
    finalized.number < 0n ||
    !isHash(finalized.hash)
  ) {
    throw new BoardroomControlChainError("malformed-chain-result");
  }

  return {
    blockHash: finalized.hash,
    blockNumber: finalized.number,
    chain,
    client,
    deployment: {
      boardroomControllerCodeHash: deployment.boardroomControllerCodeHash,
      boardroomControllerFactoryCodeHash: deployment.boardroomControllerFactoryCodeHash,
      boardroomFactory: getAddress(deployment.boardroomFactory),
      boardroomFactoryCodeHash: deployment.boardroomFactoryCodeHash,
      boardroomLogic: getAddress(deployment.boardroomLogic),
      boardroomLogicCodeHash: deployment.boardroomLogicCodeHash
    }
  };
}

async function resolveAtPinnedBlock(
  context: PinnedContext,
  boardroomInput: Address
): Promise<BoardroomControlSnapshot> {
  const boardroom = checkedAddress(boardroomInput);
  const factory = context.deployment.boardroomFactory;
  const at = context.blockNumber;
  const [factoryCode, canonical, boardroomLogicRaw, controllerFactoryRaw, boardroomCode] =
    await Promise.all([
      context.client.getBytecode({ address: factory, blockNumber: at }),
      context.client.readContract({
        abi: boardroomFactoryAbi,
        address: factory,
        args: [boardroom],
        blockNumber: at,
        functionName: "isBoardroom"
      }),
      context.client.readContract({
        abi: boardroomFactoryAbi,
        address: factory,
        blockNumber: at,
        functionName: "boardroomLogic"
      }),
      context.client.readContract({
        abi: boardroomFactoryAbi,
        address: factory,
        blockNumber: at,
        functionName: "controllerFactory"
      }),
      context.client.getBytecode({ address: boardroom, blockNumber: at })
    ]);

  requireCodeHash(factoryCode, context.deployment.boardroomFactoryCodeHash);
  if (canonical !== true) throw new BoardroomControlChainError("non-canonical-boardroom");
  const boardroomLogic = checkedAddress(boardroomLogicRaw);
  const controllerFactory = checkedAddress(controllerFactoryRaw);
  if (boardroomLogic.toLowerCase() !== context.deployment.boardroomLogic.toLowerCase()) {
    throw new BoardroomControlChainError("unsupported-release");
  }
  requireMinimalProxy(boardroomCode, boardroomLogic);

  const [boardroomLogicCode, launched, ownerRaw, controllerRaw, generationRaw, boundFactoryRaw] =
    await Promise.all([
      context.client.getBytecode({ address: boardroomLogic, blockNumber: at }),
      context.client.readContract({
        abi: boardroomAbi,
        address: boardroom,
        blockNumber: at,
        functionName: "launched"
      }),
      context.client.readContract({
        abi: boardroomAbi,
        address: boardroom,
        blockNumber: at,
        functionName: "owner"
      }),
      context.client.readContract({
        abi: boardroomAbi,
        address: boardroom,
        blockNumber: at,
        functionName: "controller"
      }),
      context.client.readContract({
        abi: boardroomAbi,
        address: boardroom,
        blockNumber: at,
        functionName: "controllerGeneration"
      }),
      context.client.readContract({
        abi: boardroomAbi,
        address: boardroom,
        blockNumber: at,
        functionName: "controllerFactory"
      })
    ]);

  requireCodeHash(boardroomLogicCode, context.deployment.boardroomLogicCodeHash);
  if (launched !== true) throw new BoardroomControlChainError("stale-relationship");
  const owner = checkedAddress(ownerRaw);
  const controller = checkedAddress(controllerRaw);
  const controllerGeneration = checkedPositiveBigInt(generationRaw);
  const boundFactory = checkedAddress(boundFactoryRaw);
  if (
    owner.toLowerCase() !== controller.toLowerCase() ||
    boundFactory.toLowerCase() !== controllerFactory.toLowerCase()
  ) {
    throw new BoardroomControlChainError("stale-relationship");
  }

  const [
    controllerFactoryCode,
    factoryBoardroomFactoryRaw,
    controllerImplementationRaw,
    registeredController,
    registeredBoardroomRaw,
    registeredGenerationRaw,
    controllerCode,
    controllerFactoryBindingRaw,
    controllerBoardroomRaw,
    controllerGenerationRaw,
    configurationEpochRaw
  ] = await Promise.all([
    context.client.getBytecode({ address: controllerFactory, blockNumber: at }),
    context.client.readContract({
      abi: controllerFactoryAbi,
      address: controllerFactory,
      blockNumber: at,
      functionName: "boardroomFactory"
    }),
    context.client.readContract({
      abi: controllerFactoryAbi,
      address: controllerFactory,
      blockNumber: at,
      functionName: "controllerImplementation"
    }),
    context.client.readContract({
      abi: controllerFactoryAbi,
      address: controllerFactory,
      args: [controller],
      blockNumber: at,
      functionName: "isController"
    }),
    context.client.readContract({
      abi: controllerFactoryAbi,
      address: controllerFactory,
      args: [controller],
      blockNumber: at,
      functionName: "boardroomOfController"
    }),
    context.client.readContract({
      abi: controllerFactoryAbi,
      address: controllerFactory,
      args: [controller],
      blockNumber: at,
      functionName: "generationOfController"
    }),
    context.client.getBytecode({ address: controller, blockNumber: at }),
    context.client.readContract({
      abi: controllerAbi,
      address: controller,
      blockNumber: at,
      functionName: "factory"
    }),
    context.client.readContract({
      abi: controllerAbi,
      address: controller,
      blockNumber: at,
      functionName: "boardroom"
    }),
    context.client.readContract({
      abi: controllerAbi,
      address: controller,
      blockNumber: at,
      functionName: "generation"
    }),
    context.client.readContract({
      abi: controllerAbi,
      address: controller,
      blockNumber: at,
      functionName: "configurationEpoch"
    })
  ]);

  requireCodeHash(controllerFactoryCode, context.deployment.boardroomControllerFactoryCodeHash);
  const factoryBoardroomFactory = checkedAddress(factoryBoardroomFactoryRaw);
  const controllerImplementation = checkedAddress(controllerImplementationRaw);
  const registeredBoardroom = checkedAddress(registeredBoardroomRaw);
  const registeredGeneration = checkedPositiveBigInt(registeredGenerationRaw);
  const controllerFactoryBinding = checkedAddress(controllerFactoryBindingRaw);
  const controllerBoardroom = checkedAddress(controllerBoardroomRaw);
  const controllerReportedGeneration = checkedPositiveBigInt(controllerGenerationRaw);
  const configurationEpoch = checkedPositiveBigInt(configurationEpochRaw);

  if (
    registeredController !== true ||
    factoryBoardroomFactory.toLowerCase() !== factory.toLowerCase() ||
    registeredBoardroom.toLowerCase() !== boardroom.toLowerCase() ||
    controllerFactoryBinding.toLowerCase() !== controllerFactory.toLowerCase() ||
    controllerBoardroom.toLowerCase() !== boardroom.toLowerCase() ||
    registeredGeneration !== controllerGeneration ||
    controllerReportedGeneration !== controllerGeneration
  ) {
    throw new BoardroomControlChainError("stale-relationship");
  }

  const controllerImplementationCode = await context.client.getBytecode({
    address: controllerImplementation,
    blockNumber: at
  });
  requireCodeHash(controllerImplementationCode, context.deployment.boardroomControllerCodeHash);
  requireMinimalProxy(controllerCode, controllerImplementation);

  return {
    blockHash: context.blockHash,
    blockNumber: at,
    boardroom,
    chainId: context.chain.chainId,
    configurationEpoch,
    controller,
    controllerGeneration
  };
}

async function requireSameBlock(context: PinnedContext): Promise<void> {
  const block = await context.client.getBlock({ blockNumber: context.blockNumber });
  if (
    block.number !== context.blockNumber ||
    !isHash(block.hash) ||
    block.hash.toLowerCase() !== context.blockHash.toLowerCase()
  ) {
    throw new BoardroomControlChainError("reorg-uncertainty");
  }
}

function sameIdentity(
  actual: BoardroomControlSnapshot,
  expected: BoardroomControlExpectedIdentity
): boolean {
  return (
    actual.chainId === expected.chainId &&
    actual.boardroom.toLowerCase() === expected.boardroom.toLowerCase() &&
    actual.controller.toLowerCase() === expected.controller.toLowerCase() &&
    actual.controllerGeneration === expected.controllerGeneration &&
    actual.configurationEpoch === expected.configurationEpoch
  );
}

function requireCodeHash(code: Hex | undefined, expectedHash: string): void {
  if (code === undefined || code === "0x" || keccak256(code).toLowerCase() !== expectedHash.toLowerCase()) {
    throw new BoardroomControlChainError("unsupported-release");
  }
}

function requireMinimalProxy(code: Hex | undefined, implementation: Address): void {
  const expected =
    `0x3d3d3d3d363d3d37363d73${implementation.slice(2).toLowerCase()}5af43d3d93803e602a57fd5bf3`;
  if (code?.toLowerCase() !== expected) {
    throw new BoardroomControlChainError("unsupported-release");
  }
}

function checkedAddress(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value) || value.toLowerCase() === zeroAddress) {
    throw new BoardroomControlChainError("malformed-chain-result");
  }
  return getAddress(value);
}

function checkedPositiveBigInt(value: unknown): bigint {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new BoardroomControlChainError("malformed-chain-result");
  }
  return value;
}

function isAddressValue(value: unknown): value is Address {
  return typeof value === "string" && isAddress(value) && value.toLowerCase() !== zeroAddress;
}

function isHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

async function withFailClosedErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BoardroomControlChainError) throw error;
    throw new BoardroomControlChainError("rpc-failure");
  }
}

export function createConfiguredBoardroomControlChainReader(config: Config): BoardroomControlChainReader {
  return createBoardroomControlChainReader({ chains: config.chains });
}
