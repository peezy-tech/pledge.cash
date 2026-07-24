import {
  boardroomAbi,
  boardroomControllerAbi,
  boardroomFactoryAbi,
} from "@pledge.cash/sdk";
import {
  getAddress,
  hashMessage,
  recoverMessageAddress,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  SUPPORT_CHAIN_ID,
  SupportError,
  type SupportAuthorityIdentity,
  type SupportAuthorityReader,
} from "./domain";

const ERC1271_MAGIC_VALUE = "0x1626ba7e" as const;
const erc1271Abi = [
  {
    type: "function",
    name: "isValidSignature",
    stateMutability: "view",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "magicValue", type: "bytes4" }],
  },
] as const;

export class CanonicalSupportAuthorityReader implements SupportAuthorityReader {
  constructor(
    private readonly client: PublicClient,
    private readonly deployment: {
      boardroomFactory: Address;
      destinationUsdc: Address;
    },
  ) {}

  async resolve(boardroomInput: Address): Promise<SupportAuthorityIdentity> {
    return this.failClosed(async () => {
      const actualChainId = await this.client.getChainId();
      if (actualChainId !== SUPPORT_CHAIN_ID) {
        throw new SupportError(
          `HyperEVM RPC returned chain ${actualChainId}; expected ${SUPPORT_CHAIN_ID}.`,
          "wrong_destination_chain",
          503,
        );
      }
      const block = await this.client.getBlock({ blockTag: "latest" });
      if (block.number === null || block.hash === null) {
        throw new SupportError(
          "HyperEVM did not return a stable block identity.",
          "support_chain_unavailable",
          503,
        );
      }
      const boardroom = getAddress(boardroomInput);
      const [
        isBoardroom,
        status,
        isRedeemableAsset,
        launched,
        owner,
        controller,
        controllerGeneration,
      ] = await Promise.all([
        this.client.readContract({
          address: this.deployment.boardroomFactory,
          abi: boardroomFactoryAbi,
          functionName: "isBoardroom",
          args: [boardroom],
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: boardroom,
          abi: boardroomAbi,
          functionName: "status",
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: boardroom,
          abi: boardroomAbi,
          functionName: "isRedeemableAsset",
          args: [this.deployment.destinationUsdc],
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: boardroom,
          abi: boardroomAbi,
          functionName: "launched",
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: boardroom,
          abi: boardroomAbi,
          functionName: "owner",
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: boardroom,
          abi: boardroomAbi,
          functionName: "controller",
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: boardroom,
          abi: boardroomAbi,
          functionName: "controllerGeneration",
          blockNumber: block.number,
        }),
      ]);
      if (!isBoardroom) {
        throw new SupportError(
          "The requested project is not a canonical Boardroom.",
          "noncanonical_boardroom",
        );
      }
      if (Number(status) !== 0) {
        throw new SupportError(
          "Recurring support is available only while the Boardroom is Active.",
          "boardroom_not_active",
          409,
        );
      }
      if (!isRedeemableAsset) {
        throw new SupportError(
          "Configured HyperEVM USDC is not registered as a Boardroom treasury asset.",
          "support_asset_not_registered",
          409,
        );
      }

      const mode = launched
        ? "launched_controller" as const
        : "prelaunch_owner" as const;
      const authority = getAddress(launched ? controller : owner);
      if (authority.toLowerCase() === zeroAddress) {
        throw new SupportError(
          "The Boardroom has no valid recurring-support authority.",
          "support_authority_unavailable",
          409,
        );
      }
      if (
        launched
        && (
          getAddress(owner).toLowerCase() !== authority.toLowerCase()
          || BigInt(controllerGeneration) <= 0n
        )
      ) {
        throw new SupportError(
          "The launched Boardroom controller relationship is inconsistent.",
          "support_authority_stale",
          409,
        );
      }
      const [configurationEpoch, signer] = launched
        ? await Promise.all([
            this.client.readContract({
              address: authority,
              abi: boardroomControllerAbi,
              functionName: "configurationEpoch",
              blockNumber: block.number,
            }).then(BigInt),
            this.client.readContract({
              address: authority,
              abi: boardroomControllerAbi,
              functionName: "proposer",
              blockNumber: block.number,
            }).then(getAddress),
          ])
        : [0n, authority] as const;
      if (launched && configurationEpoch <= 0n) {
        throw new SupportError(
          "The launched Boardroom controller epoch is invalid.",
          "support_authority_stale",
          409,
        );
      }
      if (signer.toLowerCase() === zeroAddress) {
        throw new SupportError(
          "The Boardroom recurring-support signer is unavailable.",
          "support_authority_unavailable",
          409,
        );
      }
      await this.requireBlock(block.number, block.hash);
      return {
        authority,
        blockHash: block.hash,
        blockNumber: block.number,
        boardroom,
        chainId: SUPPORT_CHAIN_ID,
        configurationEpoch,
        controllerGeneration: BigInt(controllerGeneration),
        mode,
        signer,
      };
    });
  }

  async assertCurrent(expected: SupportAuthorityIdentity): Promise<void> {
    const actual = await this.resolve(expected.boardroom);
    if (!sameAuthority(actual, expected)) {
      throw new SupportError(
        "The Boardroom authority changed after this support plan was published.",
        "support_authority_stale",
        409,
      );
    }
  }

  async verifyAuthoritySignature(input: {
    expected: SupportAuthorityIdentity;
    message: string;
    signature: Hex;
  }): Promise<SupportAuthorityIdentity> {
    const actual = await this.resolve(input.expected.boardroom);
    if (!sameAuthority(actual, input.expected)) {
      throw new SupportError(
        "The Boardroom authority changed before the challenge was signed.",
        "support_authority_stale",
        409,
      );
    }
    await this.verifyAtBlock({
      address: actual.authority,
      blockNumber: actual.blockNumber,
      message: input.message,
      signature: input.signature,
    });
    await this.requireBlock(actual.blockNumber, actual.blockHash);
    return actual;
  }

  async verifyAddressSignature(input: {
    address: Address;
    message: string;
    signature: Hex;
  }): Promise<{ blockHash: Hex; blockNumber: bigint }> {
    return this.failClosed(async () => {
      const block = await this.client.getBlock({ blockTag: "latest" });
      if (block.number === null || block.hash === null) {
        throw new SupportError(
          "HyperEVM did not return a stable block identity.",
          "support_chain_unavailable",
          503,
        );
      }
      await this.verifyAtBlock({
        address: getAddress(input.address),
        blockNumber: block.number,
        message: input.message,
        signature: input.signature,
      });
      await this.requireBlock(block.number, block.hash);
      return { blockHash: block.hash, blockNumber: block.number };
    });
  }

  private async verifyAtBlock(input: {
    address: Address;
    blockNumber: bigint;
    message: string;
    signature: Hex;
  }): Promise<void> {
    const code = await this.client.getCode({
      address: input.address,
      blockNumber: input.blockNumber,
    });
    if (code && code !== "0x") {
      const result = await this.client.readContract({
        address: input.address,
        abi: erc1271Abi,
        functionName: "isValidSignature",
        args: [hashMessage(input.message), input.signature],
        blockNumber: input.blockNumber,
      });
      if (result.toLowerCase() !== ERC1271_MAGIC_VALUE) {
        throw new SupportError(
          "The wallet signature is invalid.",
          "invalid_support_signature",
          403,
        );
      }
      return;
    }

    const recovered = await recoverMessageAddress({
      message: input.message,
      signature: input.signature,
    });
    if (recovered.toLowerCase() !== input.address.toLowerCase()) {
      throw new SupportError(
        "The wallet signature is invalid.",
        "invalid_support_signature",
        403,
      );
    }
  }

  private async requireBlock(blockNumber: bigint, blockHash: Hex): Promise<void> {
    const current = await this.client.getBlock({ blockNumber });
    if (
      current.number !== blockNumber
      || current.hash === null
      || current.hash.toLowerCase() !== blockHash.toLowerCase()
    ) {
      throw new SupportError(
        "The HyperEVM block changed during signature verification.",
        "support_reorg_uncertainty",
        503,
      );
    }
  }

  private async failClosed<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof SupportError) throw error;
      throw new SupportError(
        "Recurring-support chain verification failed closed.",
        "support_chain_unavailable",
        503,
      );
    }
  }
}

function sameAuthority(
  left: SupportAuthorityIdentity,
  right: SupportAuthorityIdentity,
): boolean {
  return (
    left.chainId === right.chainId
    && left.boardroom.toLowerCase() === right.boardroom.toLowerCase()
    && left.mode === right.mode
    && left.authority.toLowerCase() === right.authority.toLowerCase()
    && left.controllerGeneration === right.controllerGeneration
    && left.configurationEpoch === right.configurationEpoch
  );
}
