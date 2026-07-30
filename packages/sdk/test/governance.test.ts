import { describe, expect, test } from "bun:test";
import {
  concatHex,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  hashTypedData,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import {
  BOARDROOM_ERC1271_ENVELOPE_SCHEME,
  boardroomControllerAbi,
  boardroomAbi,
  buildBoardroomERC1271TypedData,
  decodeBoardroomERC1271Signature,
  decodeControllerScheduleCalldata,
  encodeBoardroomERC1271Signature,
  hashBoardroomCalls,
  hashBoardroomERC1271Digest,
  hydrateScheduledBoardroomOperationCandidates,
  queryGovernanceEvents,
  queryScheduledBoardroomOperations,
  type BoardroomCall,
  type PledgeCashGovernanceClient,
  type PledgeCashLogClient,
} from "../src";

const boardroom = "0x0000000000000000000000000000000000000b0a" as Address;
const controller = "0x000000000000000000000000000000000000c011" as Address;
const proposer = "0x000000000000000000000000000000000000a11c" as Address;
const executor = "0x000000000000000000000000000000000000e111" as Address;
const policy = "0x0000000000000000000000000000000000000a55" as Address;
const target = "0x0000000000000000000000000000000000000aaa" as Address;
const facetSetHash = `0x${"44".repeat(32)}` as Hex;
const successorFacetSetHash = `0x${"55".repeat(32)}` as Hex;
const salt = `0x${"11".repeat(32)}` as Hex;
const operationId = `0x${"22".repeat(32)}` as Hex;
const transactionHash = `0x${"33".repeat(32)}` as Hex;
const secondOperationId = `0x${"77".repeat(32)}` as Hex;
const secondTransactionHash = `0x${"88".repeat(32)}` as Hex;
const configurationHash = `0x${"66".repeat(32)}` as Hex;

const call = {
  policy,
  target,
  value: 7n,
  data: "0x12345678" as Hex,
} satisfies BoardroomCall;

const scheduleData = encodeFunctionData({
  abi: boardroomControllerAbi,
  functionName: "scheduleBoardroomOperation",
  args: [facetSetHash, [call], salt, 3n, 1n],
});
const updateConfigurationData = encodeFunctionData({
  abi: boardroomControllerAbi,
  functionName: "updateConfiguration",
  args: [executor, 172_800n, 604_800n],
});
const controllerScheduleData = encodeFunctionData({
  abi: boardroomControllerAbi,
  functionName: "scheduleControllerOperation",
  args: [facetSetHash, updateConfigurationData, salt, 3n, 1n],
});

type ContractRead = {
  abi: unknown;
  functionName: string;
  args?: readonly unknown[];
  blockNumber?: bigint;
};

describe("Boardroom governance discovery and hydration", () => {
  test("builds and hashes the exact release-bound EIP-712 control proof", () => {
    const messageHash = keccak256(stringToHex("release-bound-message"));
    const digestInput = {
      messageHash,
      controller,
      boardroom,
      chainId: 31_337n,
      facetSetHash,
      boardroomEpoch: 3n,
      controllerGeneration: 1n,
      configurationEpoch: 2n,
      configurationHash,
    };
    const typedData = buildBoardroomERC1271TypedData(digestInput);
    expect(typedData).toEqual({
      domain: {
        name: "PledgeCash Boardroom Controller",
        version: "1",
        chainId: 31_337n,
        verifyingContract: controller,
      },
      types: {
        BoardroomControlProof: [
          { name: "messageHash", type: "bytes32" },
          { name: "boardroom", type: "address" },
          { name: "facetSetHash", type: "bytes32" },
          { name: "boardroomEpoch", type: "uint256" },
          { name: "controllerGeneration", type: "uint256" },
          { name: "configurationEpoch", type: "uint256" },
          { name: "configurationHash", type: "bytes32" },
        ],
      },
      primaryType: "BoardroomControlProof",
      message: {
        messageHash,
        boardroom,
        facetSetHash,
        boardroomEpoch: 3n,
        controllerGeneration: 1n,
        configurationEpoch: 2n,
        configurationHash,
      },
    });
    const digest = hashBoardroomERC1271Digest(digestInput);
    expect(digest).toBe(hashTypedData(typedData));

    const domainSeparator = keccak256(encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        keccak256(stringToHex(
          "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
        )),
        keccak256(stringToHex("PledgeCash Boardroom Controller")),
        keccak256(stringToHex("1")),
        31_337n,
        controller,
      ],
    ));
    const structHash = keccak256(encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        keccak256(stringToHex(
          "BoardroomControlProof(bytes32 messageHash,address boardroom,bytes32 facetSetHash,uint256 boardroomEpoch,uint256 controllerGeneration,uint256 configurationEpoch,bytes32 configurationHash)",
        )),
        messageHash,
        boardroom,
        facetSetHash,
        3n,
        1n,
        2n,
        configurationHash,
      ],
    ));
    expect(digest).toBe(keccak256(concatHex(["0x1901", domainSeparator, structHash])));

    const changedContexts = [
      { messageHash: successorFacetSetHash },
      { controller: target },
      { boardroom: target },
      { chainId: 31_338n },
      { facetSetHash: successorFacetSetHash },
      { boardroomEpoch: 4n },
      { controllerGeneration: 2n },
      { configurationEpoch: 3n },
      { configurationHash: successorFacetSetHash },
    ];
    for (const changedContext of changedContexts) {
      expect(hashBoardroomERC1271Digest({
        ...digestInput,
        ...changedContext,
      })).not.toBe(digest);
    }
  });

  test("strictly encodes and decodes only the canonical v1 ERC-1271 envelope", () => {
    const proposerSignature = "0x123456" as Hex;
    const envelope = encodeBoardroomERC1271Signature({
      facetSetHash,
      boardroomEpoch: 3n,
      controllerGeneration: 1n,
      configurationEpoch: 2n,
      configurationHash,
      proposerSignature,
    });
    expect(decodeBoardroomERC1271Signature(envelope)).toEqual({
      scheme: BOARDROOM_ERC1271_ENVELOPE_SCHEME,
      facetSetHash,
      boardroomEpoch: 3n,
      controllerGeneration: 1n,
      configurationEpoch: 2n,
      configurationHash,
      proposerSignature,
    });
    expect(BOARDROOM_ERC1271_ENVELOPE_SCHEME).toBe(
      keccak256(stringToHex(
        "PledgeCash.BoardroomController.ERC1271Envelope.v1",
      )).slice(0, 10),
    );

    const wrongSchemeEnvelope = encodeAbiParameters(
      [
        { type: "bytes4" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes" },
      ],
      ["0x00000000", facetSetHash, 3n, 1n, 2n, configurationHash, proposerSignature],
    );
    expect(() => decodeBoardroomERC1271Signature(wrongSchemeEnvelope))
      .toThrow("ERC-1271 envelope uses an unsupported scheme.");
    expect(() => decodeBoardroomERC1271Signature(`${envelope}00` as Hex))
      .toThrow("ERC-1271 envelope is not canonically encoded.");
    expect(() => decodeBoardroomERC1271Signature("0x123" as Hex))
      .toThrow("ERC-1271 envelope must be hex-encoded bytes.");

    expect(() => hashBoardroomERC1271Digest({
      messageHash: "0x12",
      controller,
      boardroom,
      chainId: 31_337n,
      facetSetHash,
      boardroomEpoch: 3n,
      controllerGeneration: 1n,
      configurationEpoch: 2n,
      configurationHash,
    })).toThrow("messageHash must be a 32-byte hex value.");
    expect(() => encodeBoardroomERC1271Signature({
      facetSetHash: "0x12",
      boardroomEpoch: 3n,
      controllerGeneration: 1n,
      configurationEpoch: 2n,
      configurationHash,
      proposerSignature,
    })).toThrow("facetSetHash must be a 32-byte hex value.");
    expect(() => encodeBoardroomERC1271Signature({
      facetSetHash,
      boardroomEpoch: -1n,
      controllerGeneration: 1n,
      configurationEpoch: 2n,
      configurationHash,
      proposerSignature,
    })).toThrow("boardroomEpoch must be an unsigned 256-bit integer.");
    expect(() => hashBoardroomERC1271Digest({
      messageHash: facetSetHash,
      controller,
      boardroom,
      chainId: -1n,
      facetSetHash,
      boardroomEpoch: 3n,
      controllerGeneration: 1n,
      configurationEpoch: 2n,
      configurationHash,
    })).toThrow("chainId must be an unsigned 256-bit integer.");
  });

  test("uses the canonical schedule event topic and its indexed facet-set hash", () => {
    const topics = encodeEventTopics({
      abi: boardroomControllerAbi,
      eventName: "BoardroomOperationScheduled",
      args: { operationId, proposer, facetSetHash },
    });

    expect(topics).toHaveLength(4);
    expect(topics[3]?.toLowerCase()).toBe(facetSetHash.toLowerCase());
  });

  test("decodes both Boardroom schedule variants with the expected facet-set hash", () => {
    expect(decodeControllerScheduleCalldata(scheduleData)).toEqual({
      kind: "boardroomOperation",
      expectedFacetSetHash: facetSetHash,
      calls: [call],
      salt,
      expectedBoardroomEpoch: 3n,
      expectedConfigurationEpoch: 1n,
    });

    expect(decodeControllerScheduleCalldata(controllerScheduleData)).toEqual({
      kind: "controllerOperation",
      expectedFacetSetHash: facetSetHash,
      data: updateConfigurationData,
      salt,
      expectedBoardroomEpoch: 3n,
      expectedConfigurationEpoch: 1n,
    });
    expect(decodeControllerScheduleCalldata("0x12345678")).toBeUndefined();
  });

  test("queries Boardroom controller events and carries their facet-set hash", async () => {
    const requests: Array<{ address: Address | Address[]; names: string[] }> = [];
    const client = {
      async getLogs(input: { address: Address | Address[]; events: readonly { name: string }[] }) {
        requests.push({ address: input.address, names: input.events.map((event) => event.name) });
        if (input.events.some((event) => event.name === "BoardroomLaunched")) {
          return [{
            address: boardroom,
            eventName: "BoardroomLaunched",
            args: launchArgs(),
            blockNumber: 10n,
            logIndex: 0,
            transactionHash,
          }];
        }
        return [{
          address: controller,
          eventName: "BoardroomOperationScheduled",
          args: scheduleArgs(),
          blockNumber: 11n,
          logIndex: 1,
          transactionHash,
        }];
      },
    } as unknown as PledgeCashLogClient;

    const events = await queryGovernanceEvents(client, {
      boardrooms: [boardroom],
      fromBlock: 1n,
      toBlock: 20n,
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.names).toContain("BoardroomOperationScheduled");
    expect(events.map((event) => event.kind)).toEqual(["launched", "boardroomOperationScheduled"]);
    expect(events[1]).toMatchObject({
      boardroom,
      controller,
      operationId,
      proposer,
      facetSetHash,
      boardroomEpoch: 3n,
      controllerGeneration: 1n,
      configurationEpoch: 1n,
    });
  });

  test("rejects oversized Boardroom discovery before any controller RPC reads", async () => {
    let rpcReads = 0;
    const client = {
      async getBlockNumber() {
        rpcReads += 1;
        return 20n;
      },
      async readContract() {
        rpcReads += 1;
        throw new Error("Unexpected controller read.");
      },
    } as unknown as PledgeCashGovernanceClient;
    const boardrooms = Array.from(
      { length: 65 },
      (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}` as Address,
    );

    await expect(queryScheduledBoardroomOperations(client, { boardrooms }))
      .rejects.toThrow("Governance discovery supports at most 64 Boardrooms per query.");
    expect(rpcReads).toBe(0);
  });

  test("hydrates with Boardroom ABIs and validates emitted payload hashes without live hash reads", async () => {
    const reads: ContractRead[] = [];
    const operations = await queryScheduledBoardroomOperations(governanceClient({ reads }), {
      boardrooms: [boardroom],
      fromBlock: 1n,
      toBlock: 20n,
      currentTime: 150n,
    });

    expect(operations).toEqual([{
      boardroom,
      controller,
      operationId,
      proposer,
      facetSetHash,
      currentFacetSetHash: facetSetHash,
      eta: 100n,
      expiresAt: 200n,
      boardroomEpoch: 3n,
      controllerGeneration: 1n,
      configurationEpoch: 1n,
      currentBoardroomEpoch: 3n,
      currentConfigurationEpoch: 1n,
      operationStatus: 1,
      salt,
      scheduleBlockNumber: 11n,
      scheduleTransactionHash: transactionHash,
      status: "ready",
      kind: "boardroomOperation",
      calls: [call],
    }]);

    const facetHashRead = reads.find((read) => read.functionName === "facetSetHash");
    expect(facetHashRead?.abi).toBe(boardroomAbi);
    expect(reads.some((read) => read.functionName === "hashBoardroomOperation")).toBe(false);
    expect(reads.every((read) => read.blockNumber === 20n)).toBe(true);
  });

  test("hydrates operations after a later same-block controller configuration update", async () => {
    const reads: ContractRead[] = [];
    const [executed] = await queryScheduledBoardroomOperations(
      governanceClient({
        controllerOperation: true,
        reads,
        currentConfigurationEpoch: 2n,
        operationStatus: 2,
        unpinnedOperationStatus: 1,
      }),
      {
        boardrooms: [boardroom],
        fromBlock: 1n,
        toBlock: "latest",
        currentTime: 150n,
      },
    );

    expect(executed).toMatchObject({
      operationId,
      configurationEpoch: 1n,
      currentConfigurationEpoch: 2n,
      operationStatus: 2,
      status: "executed",
      kind: "controllerOperation",
      controllerData: updateConfigurationData,
    });
    expect(reads.some((read) => read.functionName === "hashControllerOperation")).toBe(false);
    expect(reads.every((read) => read.blockNumber === 20n)).toBe(true);
  });

  test("invalidates a pending operation after facet activation and rejects schedule/event hash substitution", async () => {
    const [stale] = await queryScheduledBoardroomOperations(
      governanceClient({ currentFacetSetHash: successorFacetSetHash }),
      {
        boardrooms: [boardroom],
        fromBlock: 1n,
        toBlock: 20n,
        currentTime: 150n,
      },
    );
    expect(stale).toMatchObject({
      facetSetHash,
      currentFacetSetHash: successorFacetSetHash,
      status: "invalidated",
    });

    const [substituted] = await queryScheduledBoardroomOperations(
      governanceClient({ eventFacetSetHash: successorFacetSetHash }),
      {
        boardrooms: [boardroom],
        fromBlock: 1n,
        toBlock: 20n,
        currentTime: 150n,
      },
    );
    expect(substituted).toMatchObject({
      facetSetHash: successorFacetSetHash,
      status: "unknown",
      payloadError: "Schedule calldata context does not match the emitted operation.",
    });
  });

  test("decodes a successful Boardroom receipt when hydrating an explicit candidate", async () => {
    const reads: ContractRead[] = [];
    const result = await hydrateScheduledBoardroomOperationCandidates(governanceClient({ reads }), {
      candidates: [{
        boardroom,
        controller,
        operationId,
        scheduleTransactionHash: transactionHash,
        scheduleBlockNumber: 11n,
      }],
      currentTime: 150n,
    });

    expect(result.errors).toEqual([]);
    expect(result.operations[0]).toMatchObject({
      operationId,
      controller,
      facetSetHash,
      currentFacetSetHash: facetSetHash,
      status: "ready",
      calls: [call],
    });
    expect(reads.some((read) => read.functionName === "hashBoardroomOperation")).toBe(false);
    expect(reads.every((read) => read.blockNumber === 20n)).toBe(true);
  });

  test("rejects a candidate whose Boardroom is not registered by the controller", async () => {
    const result = await hydrateScheduledBoardroomOperationCandidates(
      governanceClient({ controllerBoardroom: target }),
      {
        candidates: [{
          boardroom,
          controller,
          operationId,
          scheduleTransactionHash: transactionHash,
          scheduleBlockNumber: 11n,
        }],
        currentTime: 150n,
      },
    );

    expect(result.operations).toEqual([]);
    expect(result.errors).toEqual([{
      boardroom,
      controller,
      operationId,
      message: "Candidate Boardroom does not match the controller association.",
    }]);
  });

  test("takes the hydration snapshot after the candidate receipt is verified", async () => {
    let receiptFetched = false;
    const result = await hydrateScheduledBoardroomOperationCandidates(
      governanceClient({
        onReceiptRead: () => {
          receiptFetched = true;
        },
        onBlockNumberRead: () => {
          expect(receiptFetched).toBe(true);
        },
      }),
      {
        candidates: [{
          boardroom,
          controller,
          operationId,
          scheduleTransactionHash: transactionHash,
          scheduleBlockNumber: 11n,
        }],
        currentTime: 150n,
      },
    );

    expect(result.errors).toEqual([]);
    expect(result.operations[0]?.status).toBe("ready");
  });

  test("hydrates every explicit candidate at one snapshot after all receipts are verified", async () => {
    const reads: ContractRead[] = [];
    const receipts = new Set<Hex>();
    let snapshotReads = 0;
    const baseClient = governanceClient({ reads });
    const client = {
      ...baseClient,
      async getBlockNumber() {
        snapshotReads += 1;
        expect(receipts).toEqual(new Set([transactionHash, secondTransactionHash]));
        return 20n;
      },
      async getTransaction(input: { hash: Hex }) {
        return {
          blockNumber: input.hash === secondTransactionHash ? 21n : 11n,
          from: proposer,
          hash: input.hash,
          input: scheduleData,
          to: controller,
        };
      },
      async getTransactionReceipt(input: { hash: Hex }) {
        receipts.add(input.hash);
        return scheduleReceipt(facetSetHash, {
          blockNumber: input.hash === secondTransactionHash ? 21n : 11n,
          operationId: input.hash === secondTransactionHash
            ? secondOperationId
            : operationId,
          transactionHash: input.hash,
        });
      },
    } as unknown as PledgeCashGovernanceClient;

    const result = await hydrateScheduledBoardroomOperationCandidates(client, {
      candidates: [
        {
          boardroom,
          controller,
          operationId,
          scheduleTransactionHash: transactionHash,
          scheduleBlockNumber: 11n,
        },
        {
          boardroom,
          controller,
          operationId: secondOperationId,
          scheduleTransactionHash: secondTransactionHash,
          scheduleBlockNumber: 21n,
        },
      ],
      currentTime: 150n,
    });

    expect(result.errors).toEqual([]);
    expect(result.operations.map((operation) => operation.operationId)).toEqual([
      secondOperationId,
      operationId,
    ]);
    expect(snapshotReads).toBe(1);
    expect(reads.every((read) => read.blockNumber === 21n)).toBe(true);
  });
});

function governanceClient(overrides: {
  controllerOperation?: boolean;
  controllerBoardroom?: Address;
  currentConfigurationEpoch?: bigint;
  currentFacetSetHash?: Hex;
  eventFacetSetHash?: Hex;
  onBlockNumberRead?: () => void;
  onReceiptRead?: () => void;
  operationStatus?: number;
  reads?: ContractRead[];
  unpinnedOperationStatus?: number;
} = {}): PledgeCashGovernanceClient {
  return {
    async getBlockNumber() {
      overrides.onBlockNumberRead?.();
      return 20n;
    },
    async getLogs(input: { events: readonly { name: string }[] }) {
      if (input.events.some((event) => event.name === "BoardroomLaunched")) {
        return [{
          address: boardroom,
          eventName: "BoardroomLaunched",
          args: launchArgs(),
          blockNumber: 10n,
          logIndex: 0,
          transactionHash,
        }] as never;
      }
      return [{
        address: controller,
        eventName: overrides.controllerOperation
          ? "ControllerOperationScheduled"
          : "BoardroomOperationScheduled",
        args: overrides.controllerOperation
          ? controllerScheduleArgs(overrides.eventFacetSetHash)
          : scheduleArgs(overrides.eventFacetSetHash),
        blockNumber: 11n,
        logIndex: 1,
        transactionHash,
      }] as never;
    },
    async getTransaction() {
      return {
        blockNumber: 11n,
        from: proposer,
        hash: transactionHash,
        input: overrides.controllerOperation ? controllerScheduleData : scheduleData,
        to: controller,
      } as never;
    },
    async getTransactionReceipt() {
      overrides.onReceiptRead?.();
      return scheduleReceipt(overrides.eventFacetSetHash) as never;
    },
    async readContract(parameters: {
      abi: unknown;
      address: Address;
      functionName: string;
      args?: readonly unknown[];
      blockNumber?: bigint;
    }) {
      overrides.reads?.push({
        abi: parameters.abi,
        functionName: parameters.functionName,
        ...(parameters.args ? { args: parameters.args } : {}),
        ...(parameters.blockNumber !== undefined ? { blockNumber: parameters.blockNumber } : {}),
      });
      switch (parameters.functionName) {
        case "launched": return true;
        case "controller": return controller;
        case "boardroom": return overrides.controllerBoardroom ?? boardroom;
        case "hashBoardroomOperation":
        case "hashControllerOperation":
          throw new Error("Operation hashes must not be read from mutable controller state.");
        case "operationState":
          return [
            100n,
            200n,
            parameters.blockNumber === 20n
              ? (overrides.operationStatus ?? 1)
              : (overrides.unpinnedOperationStatus ?? overrides.operationStatus ?? 1),
          ];
        case "governanceEpoch": return 3n;
        case "controllerGeneration": return 1n;
        case "status": return 0;
        case "facetSetHash": return overrides.currentFacetSetHash ?? facetSetHash;
        case "configurationEpoch": return overrides.currentConfigurationEpoch ?? 1n;
        case "proposer": return proposer;
        default: throw new Error(`Unexpected read: ${parameters.functionName}`);
      }
    },
  } as unknown as PledgeCashGovernanceClient;
}

function launchArgs() {
  return {
    controller,
    proposer,
    protectionStaker: proposer,
    controllerGeneration: 1n,
    controllerDelay: 86_400n,
    windDownDelay: 172_800n,
    gracePeriod: 604_800n,
  };
}

function scheduleArgs(eventFacetSetHash: Hex = facetSetHash) {
  return {
    operationId,
    proposer,
    facetSetHash: eventFacetSetHash,
    eta: 100n,
    expiresAt: 200n,
    boardroomEpoch: 3n,
    controllerGeneration: 1n,
    configurationEpoch: 1n,
    salt,
    callsHash: hashBoardroomCalls([call]),
  };
}

function controllerScheduleArgs(eventFacetSetHash: Hex = facetSetHash) {
  return {
    operationId,
    proposer,
    facetSetHash: eventFacetSetHash,
    eta: 100n,
    expiresAt: 200n,
    boardroomEpoch: 3n,
    controllerGeneration: 1n,
    configurationEpoch: 1n,
    salt,
    dataHash: keccak256(updateConfigurationData),
  };
}

function scheduleReceipt(
  eventFacetSetHash: Hex = facetSetHash,
  overrides: {
    blockNumber?: bigint;
    operationId?: Hex;
    transactionHash?: Hex;
  } = {},
) {
  const topics = encodeEventTopics({
    abi: boardroomControllerAbi,
    eventName: "BoardroomOperationScheduled",
    args: {
      operationId: overrides.operationId ?? operationId,
      proposer,
      facetSetHash: eventFacetSetHash,
    },
  });
  const data = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "bytes32" },
    ],
    [100n, 200n, 3n, 1n, 1n, salt, hashBoardroomCalls([call])],
  );
  return {
    blockNumber: overrides.blockNumber ?? 11n,
    logs: [{ address: controller, data, topics }],
    status: "success" as const,
    transactionHash: overrides.transactionHash ?? transactionHash,
  };
}
