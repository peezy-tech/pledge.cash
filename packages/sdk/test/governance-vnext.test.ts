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
  BOARDROOM_VNEXT_ERC1271_ENVELOPE_SCHEME,
  boardroomControllerAbi,
  boardroomDiamondAbi,
  boardroomVNextControllerAbi,
  buildBoardroomVNextERC1271TypedData,
  decodeBoardroomVNextERC1271Signature,
  decodeBoardroomVNextControllerScheduleCalldata,
  encodeBoardroomVNextERC1271Signature,
  hashBoardroomCalls,
  hashBoardroomVNextERC1271Digest,
  hydrateScheduledBoardroomVNextOperationCandidates,
  queryBoardroomVNextGovernanceEvents,
  queryScheduledBoardroomVNextOperations,
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
const configurationHash = `0x${"66".repeat(32)}` as Hex;

const call = {
  policy,
  target,
  value: 7n,
  data: "0x12345678" as Hex,
} satisfies BoardroomCall;

const scheduleData = encodeFunctionData({
  abi: boardroomVNextControllerAbi,
  functionName: "scheduleBoardroomOperation",
  args: [facetSetHash, [call], salt, 3n, 1n],
});

describe("Boardroom vNext governance discovery and hydration", () => {
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
    const typedData = buildBoardroomVNextERC1271TypedData(digestInput);
    expect(typedData).toEqual({
      domain: {
        name: "PledgeCash Boardroom vNext Controller",
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
    const digest = hashBoardroomVNextERC1271Digest(digestInput);
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
        keccak256(stringToHex("PledgeCash Boardroom vNext Controller")),
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
      expect(hashBoardroomVNextERC1271Digest({
        ...digestInput,
        ...changedContext,
      })).not.toBe(digest);
    }
  });

  test("strictly encodes and decodes only the canonical v1 ERC-1271 envelope", () => {
    const proposerSignature = "0x123456" as Hex;
    const envelope = encodeBoardroomVNextERC1271Signature({
      facetSetHash,
      boardroomEpoch: 3n,
      controllerGeneration: 1n,
      configurationEpoch: 2n,
      configurationHash,
      proposerSignature,
    });
    expect(decodeBoardroomVNextERC1271Signature(envelope)).toEqual({
      scheme: BOARDROOM_VNEXT_ERC1271_ENVELOPE_SCHEME,
      facetSetHash,
      boardroomEpoch: 3n,
      controllerGeneration: 1n,
      configurationEpoch: 2n,
      configurationHash,
      proposerSignature,
    });
    expect(BOARDROOM_VNEXT_ERC1271_ENVELOPE_SCHEME).toBe(
      keccak256(stringToHex(
        "PledgeCash.BoardroomVNextController.ERC1271Envelope.v1",
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
    expect(() => decodeBoardroomVNextERC1271Signature(wrongSchemeEnvelope))
      .toThrow("ERC-1271 envelope uses an unsupported scheme.");
    expect(() => decodeBoardroomVNextERC1271Signature(`${envelope}00` as Hex))
      .toThrow("ERC-1271 envelope is not canonically encoded.");
    expect(() => decodeBoardroomVNextERC1271Signature("0x123" as Hex))
      .toThrow("ERC-1271 envelope must be hex-encoded bytes.");

    expect(() => hashBoardroomVNextERC1271Digest({
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
    expect(() => encodeBoardroomVNextERC1271Signature({
      facetSetHash: "0x12",
      boardroomEpoch: 3n,
      controllerGeneration: 1n,
      configurationEpoch: 2n,
      configurationHash,
      proposerSignature,
    })).toThrow("facetSetHash must be a 32-byte hex value.");
    expect(() => encodeBoardroomVNextERC1271Signature({
      facetSetHash,
      boardroomEpoch: -1n,
      controllerGeneration: 1n,
      configurationEpoch: 2n,
      configurationHash,
      proposerSignature,
    })).toThrow("boardroomEpoch must be an unsigned 256-bit integer.");
    expect(() => hashBoardroomVNextERC1271Digest({
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

  test("uses the vNext schedule event topic and its indexed facet-set hash", () => {
    const legacyTopics = encodeEventTopics({
      abi: boardroomControllerAbi,
      eventName: "BoardroomOperationScheduled",
      args: { operationId, proposer },
    });
    const vNextTopics = encodeEventTopics({
      abi: boardroomVNextControllerAbi,
      eventName: "BoardroomOperationScheduled",
      args: { operationId, proposer, facetSetHash },
    });

    expect(vNextTopics[0]).not.toBe(legacyTopics[0]);
    expect(vNextTopics).toHaveLength(4);
    expect(vNextTopics[3]?.toLowerCase()).toBe(facetSetHash.toLowerCase());
  });

  test("decodes both vNext schedule variants with the expected facet-set hash", () => {
    expect(decodeBoardroomVNextControllerScheduleCalldata(scheduleData)).toEqual({
      kind: "boardroomOperation",
      expectedFacetSetHash: facetSetHash,
      calls: [call],
      salt,
      expectedBoardroomEpoch: 3n,
      expectedConfigurationEpoch: 1n,
    });

    const updateData = encodeFunctionData({
      abi: boardroomVNextControllerAbi,
      functionName: "updateConfiguration",
      args: [executor, 172_800n, 604_800n],
    });
    const controllerSchedule = encodeFunctionData({
      abi: boardroomVNextControllerAbi,
      functionName: "scheduleControllerOperation",
      args: [facetSetHash, updateData, salt, 3n, 1n],
    });
    expect(decodeBoardroomVNextControllerScheduleCalldata(controllerSchedule)).toEqual({
      kind: "controllerOperation",
      expectedFacetSetHash: facetSetHash,
      data: updateData,
      salt,
      expectedBoardroomEpoch: 3n,
      expectedConfigurationEpoch: 1n,
    });
    expect(decodeBoardroomVNextControllerScheduleCalldata("0x12345678")).toBeUndefined();
  });

  test("queries vNext controller events and carries their facet-set hash", async () => {
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

    const events = await queryBoardroomVNextGovernanceEvents(client, {
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

  test("hydrates with vNext ABIs and propagates the facet hash into operation hashing and results", async () => {
    const reads: Array<{ abi: unknown; functionName: string; args?: readonly unknown[] }> = [];
    const operations = await queryScheduledBoardroomVNextOperations(governanceClient({ reads }), {
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

    const hashRead = reads.find((read) => read.functionName === "hashBoardroomOperation");
    expect(hashRead?.abi).toBe(boardroomVNextControllerAbi);
    expect(hashRead?.args?.[0]).toBe(facetSetHash);
    const facetHashRead = reads.find((read) => read.functionName === "facetSetHash");
    expect(facetHashRead?.abi).toBe(boardroomDiamondAbi);
  });

  test("invalidates a pending operation after facet activation and rejects schedule/event hash substitution", async () => {
    const [stale] = await queryScheduledBoardroomVNextOperations(
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

    const [substituted] = await queryScheduledBoardroomVNextOperations(
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

  test("decodes a successful vNext receipt when hydrating an explicit candidate", async () => {
    const result = await hydrateScheduledBoardroomVNextOperationCandidates(governanceClient(), {
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
  });
});

function governanceClient(overrides: {
  currentFacetSetHash?: Hex;
  eventFacetSetHash?: Hex;
  reads?: Array<{ abi: unknown; functionName: string; args?: readonly unknown[] }>;
} = {}): PledgeCashGovernanceClient {
  return {
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
        eventName: "BoardroomOperationScheduled",
        args: scheduleArgs(overrides.eventFacetSetHash),
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
        input: scheduleData,
        to: controller,
      } as never;
    },
    async getTransactionReceipt() {
      return scheduleReceipt(overrides.eventFacetSetHash) as never;
    },
    async readContract(parameters: {
      abi: unknown;
      address: Address;
      functionName: string;
      args?: readonly unknown[];
    }) {
      overrides.reads?.push({
        abi: parameters.abi,
        functionName: parameters.functionName,
        ...(parameters.args ? { args: parameters.args } : {}),
      });
      switch (parameters.functionName) {
        case "launched": return true;
        case "controller": return controller;
        case "hashBoardroomOperation": return operationId;
        case "operationState": return [100n, 200n, 1];
        case "governanceEpoch": return 3n;
        case "controllerGeneration": return 1n;
        case "status": return 0;
        case "facetSetHash": return overrides.currentFacetSetHash ?? facetSetHash;
        case "configurationEpoch": return 1n;
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

function scheduleReceipt(eventFacetSetHash: Hex = facetSetHash) {
  const topics = encodeEventTopics({
    abi: boardroomVNextControllerAbi,
    eventName: "BoardroomOperationScheduled",
    args: { operationId, proposer, facetSetHash: eventFacetSetHash },
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
    blockNumber: 11n,
    logs: [{ address: controller, data, topics }],
    status: "success" as const,
    transactionHash,
  };
}
