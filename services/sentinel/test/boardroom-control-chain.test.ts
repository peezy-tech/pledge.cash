import { describe, expect, test } from "bun:test";
import type { PledgeCashDeployment } from "@pledge.cash/sdk";
import { hashMessage, keccak256, padHex, type Address, type Hex } from "viem";

import {
  BoardroomControlChainError,
  ERC1271_MAGIC_VALUE,
  SUPPORTED_BOARDROOM_CONTROL_RELEASE,
  createBoardroomControlChainReader,
  type BoardroomControlPublicClient
} from "../src/chain/boardroom-control";
import type { SentinelChainConfig } from "../src/config";

const FACTORY = "0x1000000000000000000000000000000000000001" as Address;
const BOARDROOM_LOGIC = "0x2000000000000000000000000000000000000002" as Address;
const CONTROLLER_FACTORY = "0x3000000000000000000000000000000000000003" as Address;
const CONTROLLER_LOGIC = "0x4000000000000000000000000000000000000004" as Address;
const BOARDROOM = "0x5000000000000000000000000000000000000005" as Address;
const CONTROLLER = "0x6000000000000000000000000000000000000006" as Address;
const FINALIZED_HASH = `0x${"ab".repeat(32)}` as Hex;
const REORG_HASH = `0x${"cd".repeat(32)}` as Hex;
const FACTORY_CODE = "0x60006000" as Hex;
const BOARDROOM_LOGIC_CODE = "0x60016001" as Hex;
const CONTROLLER_FACTORY_CODE = "0x60026002" as Hex;
const CONTROLLER_LOGIC_CODE = "0x60036003" as Hex;

class FakeClient implements BoardroomControlPublicClient {
  blockHash = FINALIZED_HASH;
  blockNumber = 100n;
  callResult = padHex(ERC1271_MAGIC_VALUE, { dir: "right", size: 32 });
  readonly pinnedCalls: bigint[] = [];
  lastCallData: Hex | undefined;
  reorg = false;
  rpcFailure = false;
  rpcChainId = 31337;
  readonly values = new Map<string, unknown>();

  constructor() {
    this.values.set(key(FACTORY, "isBoardroom"), true);
    this.values.set(key(FACTORY, "boardroomLogic"), BOARDROOM_LOGIC);
    this.values.set(key(FACTORY, "controllerFactory"), CONTROLLER_FACTORY);
    this.values.set(key(BOARDROOM, "launched"), true);
    this.values.set(key(BOARDROOM, "owner"), CONTROLLER);
    this.values.set(key(BOARDROOM, "controller"), CONTROLLER);
    this.values.set(key(BOARDROOM, "controllerGeneration"), 3n);
    this.values.set(key(BOARDROOM, "controllerFactory"), CONTROLLER_FACTORY);
    this.values.set(key(CONTROLLER_FACTORY, "boardroomFactory"), FACTORY);
    this.values.set(key(CONTROLLER_FACTORY, "controllerImplementation"), CONTROLLER_LOGIC);
    this.values.set(key(CONTROLLER_FACTORY, "isController"), true);
    this.values.set(key(CONTROLLER_FACTORY, "boardroomOfController"), BOARDROOM);
    this.values.set(key(CONTROLLER_FACTORY, "generationOfController"), 3n);
    this.values.set(key(CONTROLLER, "factory"), CONTROLLER_FACTORY);
    this.values.set(key(CONTROLLER, "boardroom"), BOARDROOM);
    this.values.set(key(CONTROLLER, "generation"), 3n);
    this.values.set(key(CONTROLLER, "configurationEpoch"), 7n);
  }

  async call(input: { readonly blockNumber: bigint; readonly data: Hex; readonly to: Address }) {
    this.maybeFail();
    this.pinnedCalls.push(input.blockNumber);
    this.lastCallData = input.data;
    expect(input.to.toLowerCase()).toBe(CONTROLLER.toLowerCase());
    return { data: this.callResult };
  }

  async getBlock(input: { readonly blockNumber: bigint } | { readonly blockTag: "finalized" }) {
    this.maybeFail();
    if ("blockTag" in input) return { hash: this.blockHash, number: this.blockNumber };
    this.pinnedCalls.push(input.blockNumber);
    return { hash: this.reorg ? REORG_HASH : this.blockHash, number: input.blockNumber };
  }

  async getChainId() {
    this.maybeFail();
    return this.rpcChainId;
  }

  async getBytecode(input: { readonly address: Address; readonly blockNumber: bigint }) {
    this.maybeFail();
    this.pinnedCalls.push(input.blockNumber);
    const codes = new Map<string, Hex>([
      [FACTORY.toLowerCase(), FACTORY_CODE],
      [BOARDROOM_LOGIC.toLowerCase(), BOARDROOM_LOGIC_CODE],
      [CONTROLLER_FACTORY.toLowerCase(), CONTROLLER_FACTORY_CODE],
      [CONTROLLER_LOGIC.toLowerCase(), CONTROLLER_LOGIC_CODE],
      [BOARDROOM.toLowerCase(), cloneCode(BOARDROOM_LOGIC)],
      [CONTROLLER.toLowerCase(), cloneCode(CONTROLLER_LOGIC)]
    ]);
    return codes.get(input.address.toLowerCase());
  }

  async readContract(input: {
    readonly address: Address;
    readonly blockNumber: bigint;
    readonly functionName: string;
  }) {
    this.maybeFail();
    this.pinnedCalls.push(input.blockNumber);
    return this.values.get(key(input.address, input.functionName));
  }

  private maybeFail() {
    if (this.rpcFailure) throw new Error("rpc unavailable");
  }
}

describe("pinned finalized Boardroom-control reads", () => {
  test("proves canonical runtime topology and performs ERC-1271 at one block", async () => {
    const client = new FakeClient();
    const reader = makeReader(client);
    const snapshot = await reader.resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 });

    expect(snapshot).toEqual({
      blockHash: FINALIZED_HASH,
      blockNumber: 100n,
      boardroom: BOARDROOM,
      chainId: 31337,
      configurationEpoch: 7n,
      controller: CONTROLLER,
      controllerGeneration: 3n
    });
    expect(client.pinnedCalls.length).toBeGreaterThan(20);
    expect(client.pinnedCalls.every((block) => block === 100n)).toBe(true);

    client.pinnedCalls.length = 0;
    const message = "exact serialized SIWE message";
    await reader.verifyControlSignature({
      expected: snapshot,
      message,
      signature: `0x${"11".repeat(65)}`
    });
    expect(client.pinnedCalls.every((block) => block === 100n)).toBe(true);
    expect(`0x${client.lastCallData?.slice(10, 74).toLowerCase()}`).toBe(
      hashMessage(message).toLowerCase()
    );
  });

  test("fails closed on malformed and invalid ERC-1271 return data", async () => {
    const malformed = new FakeClient();
    malformed.callResult = ERC1271_MAGIC_VALUE;
    await expectVerificationFailure(malformed, "malformed-chain-result");

    const invalid = new FakeClient();
    invalid.callResult = padHex("0xffffffff", { dir: "right", size: 32 });
    await expectVerificationFailure(invalid, "invalid-signature");
  });

  test("detects a finalized-block hash change before accepting proof", async () => {
    const client = new FakeClient();
    client.reorg = true;
    await expect(
      makeReader(client).resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 })
    ).rejects.toMatchObject({ failure: "reorg-uncertainty" });
  });

  test("rejects spoofed factories, stale reciprocal bindings, and malformed generations", async () => {
    const mutations: ReadonlyArray<readonly [string, string, unknown]> = [
      [key(FACTORY, "isBoardroom"), "non-canonical-boardroom", false],
      [key(BOARDROOM, "launched"), "stale-relationship", false],
      [key(BOARDROOM, "owner"), "stale-relationship", BOARDROOM],
      [key(BOARDROOM, "controllerFactory"), "stale-relationship", FACTORY],
      [key(CONTROLLER_FACTORY, "boardroomFactory"), "stale-relationship", BOARDROOM],
      [key(CONTROLLER_FACTORY, "isController"), "stale-relationship", false],
      [key(CONTROLLER_FACTORY, "boardroomOfController"), "stale-relationship", CONTROLLER],
      [key(CONTROLLER_FACTORY, "generationOfController"), "stale-relationship", 4n],
      [key(CONTROLLER, "factory"), "stale-relationship", FACTORY],
      [key(CONTROLLER, "boardroom"), "stale-relationship", CONTROLLER],
      [key(CONTROLLER, "generation"), "stale-relationship", 4n],
      [key(CONTROLLER, "configurationEpoch"), "malformed-chain-result", 0n]
    ];

    for (const [path, failure, value] of mutations) {
      const client = new FakeClient();
      client.values.set(path, value);
      await expect(
        makeReader(client).resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 })
      ).rejects.toMatchObject({ failure });
    }
  });

  test("rejects unknown chains and all pre-v5 deployment identities", async () => {
    const client = new FakeClient();
    const unknown = makeReader(client);
    await expect(
      unknown.resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 1 })
    ).rejects.toMatchObject({ failure: "unknown-chain" });

    const legacy = createBoardroomControlChainReader({
      chains: [chain(31337)],
      createClient: () => client,
      getDeployment: () => ({
        ...deployment(31337),
        deterministicDeploymentVersion: "pledge.cash.deterministic.v4"
      })
    });
    await expect(
      legacy.resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 })
    ).rejects.toMatchObject({ failure: "unsupported-release" });
  });

  test("rejects an RPC endpoint serving a different chain", async () => {
    const client = new FakeClient();
    client.rpcChainId = 1;
    await expect(
      makeReader(client).resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 })
    ).rejects.toMatchObject({ failure: "unknown-chain" });
  });

  test("keeps the same controller address chain-scoped", async () => {
    const first = new FakeClient();
    const second = new FakeClient();
    first.rpcChainId = 1;
    second.rpcChainId = 10;
    second.blockNumber = 200n;
    second.blockHash = REORG_HASH;
    const clients = new Map<number, FakeClient>([
      [1, first],
      [10, second]
    ]);
    const reader = createBoardroomControlChainReader({
      chains: [chain(1), chain(10)],
      createClient: (config) => clients.get(config.chainId) as FakeClient,
      getDeployment: (chainId) => deployment(chainId)
    });

    const one = await reader.resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 1 });
    const ten = await reader.resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 10 });
    expect(one.controller).toBe(ten.controller);
    expect(one.chainId).toBe(1);
    expect(ten.chainId).toBe(10);
    expect(one.blockHash).not.toBe(ten.blockHash);
  });

  test("turns transport failures into a closed RPC result", async () => {
    const client = new FakeClient();
    client.rpcFailure = true;
    await expect(
      makeReader(client).resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 })
    ).rejects.toMatchObject({ failure: "rpc-failure" });
  });
});

function makeReader(client: FakeClient) {
  return createBoardroomControlChainReader({
    chains: [chain(31337)],
    createClient: () => client,
    getDeployment: () => deployment(31337)
  });
}

async function expectVerificationFailure(client: FakeClient, failure: string) {
  const reader = makeReader(client);
  const snapshot = await reader.resolveCanonicalBoardroom({ boardroom: BOARDROOM, chainId: 31337 });
  await expect(
    reader.verifyControlSignature({ expected: snapshot, message: "message", signature: "0x11" })
  ).rejects.toMatchObject({ failure });
}

function chain(chainId: number): SentinelChainConfig {
  return { chainId, confirmations: 0, rpcUrl: `https://rpc-${chainId}.invalid` };
}

function deployment(chainId: number): PledgeCashDeployment {
  return {
    boardroomControllerCodeHash: keccak256(CONTROLLER_LOGIC_CODE),
    boardroomControllerFactoryCodeHash: keccak256(CONTROLLER_FACTORY_CODE),
    boardroomFactory: FACTORY,
    boardroomFactoryCodeHash: keccak256(FACTORY_CODE),
    boardroomLogic: BOARDROOM_LOGIC,
    boardroomLogicCodeHash: keccak256(BOARDROOM_LOGIC_CODE),
    chainId,
    deterministicDeployment: true,
    deterministicDeploymentVersion: SUPPORTED_BOARDROOM_CONTROL_RELEASE
  } as PledgeCashDeployment;
}

function cloneCode(implementation: Address): Hex {
  return `0x3d3d3d3d363d3d37363d73${implementation.slice(2).toLowerCase()}5af43d3d93803e602a57fd5bf3`;
}

function key(address: Address, functionName: string): string {
  return `${address.toLowerCase()}:${functionName}`;
}
