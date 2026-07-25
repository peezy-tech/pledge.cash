import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CanonicalSupportAuthorityReader } from "../src/support/authority";

const boardroom =
  "0x1000000000000000000000000000000000000000" as Address;
const controller =
  "0x2000000000000000000000000000000000000000" as Address;
const proposer =
  "0x2500000000000000000000000000000000000000" as Address;
const factory =
  "0x3000000000000000000000000000000000000000" as Address;
const usdc =
  "0x4000000000000000000000000000000000000000" as Address;
const hash = `0x${"11".repeat(32)}` as Hex;

function reader(values: {
  launched?: boolean;
  owner?: Address;
  configurationEpoch?: bigint;
  signatureResult?: Hex;
}) {
  const owner = values.owner ?? controller;
  const client = {
    async getChainId() {
      return 998;
    },
    async getBlock() {
      return { hash, number: 100n };
    },
    async getCode(input: { address: Address }) {
      return input.address.toLowerCase() === owner.toLowerCase()
        && values.launched === false
        ? "0x"
        : "0x01";
    },
    async readContract(input: {
      address: Address;
      functionName: string;
    }) {
      if (input.functionName === "isBoardroom") return true;
      if (input.functionName === "status") return 0;
      if (input.functionName === "isRedeemableAsset") return true;
      if (input.functionName === "launched") return values.launched ?? true;
      if (input.functionName === "owner") {
        return values.launched === false ? owner : controller;
      }
      if (input.functionName === "controller") return controller;
      if (input.functionName === "controllerGeneration") {
        return values.launched === false ? 0n : 1n;
      }
      if (input.functionName === "configurationEpoch") {
        return values.configurationEpoch ?? 1n;
      }
      if (input.functionName === "proposer") return proposer;
      if (input.functionName === "isValidSignature") {
        return values.signatureResult ?? "0x1626ba7e";
      }
      throw new Error(`unexpected ${input.functionName}`);
    },
  };
  return new CanonicalSupportAuthorityReader(client as never, {
    boardroomFactory: factory,
    destinationUsdc: usdc,
  });
}

describe("canonical support authority", () => {
  test("pins a launched controller identity and verifies its ERC-1271 result", async () => {
    const subject = reader({});
    const identity = await subject.resolve(boardroom);
    expect(identity).toMatchObject({
      authority: controller,
      boardroom,
      chainId: 998,
      configurationEpoch: 1n,
      controllerGeneration: 1n,
      mode: "launched_controller",
      signer: proposer,
    });
    await expect(subject.verifyAuthoritySignature({
      expected: identity,
      message: "publish support plan",
      signature: "0x1234",
    })).resolves.toMatchObject(identity);
  });

  test("fails closed when the controller epoch changes", async () => {
    const original = await reader({ configurationEpoch: 1n }).resolve(boardroom);
    await expect(
      reader({ configurationEpoch: 2n }).verifyAuthoritySignature({
        expected: original,
        message: "publish support plan",
        signature: "0x1234",
      }),
    ).rejects.toMatchObject({
      code: "support_authority_stale",
      status: 409,
    });
  });

  test("supports a prelaunch EOA owner without a controller", async () => {
    const account = privateKeyToAccount(
      `0x${"12".repeat(32)}`,
    );
    const subject = reader({
      launched: false,
      owner: account.address,
    });
    const identity = await subject.resolve(boardroom);
    expect(identity).toMatchObject({
      authority: account.address,
      configurationEpoch: 0n,
      controllerGeneration: 0n,
      mode: "prelaunch_owner",
      signer: account.address,
    });
    const message = "publish prelaunch support plan";
    const signature = await account.signMessage({ message });
    await expect(subject.verifyAuthoritySignature({
      expected: identity,
      message,
      signature,
    })).resolves.toMatchObject(identity);
  });
});
