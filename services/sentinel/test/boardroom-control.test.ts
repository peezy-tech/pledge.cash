import { beforeEach, describe, expect, test } from "bun:test";
import { hashMessage, type Address, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";

import type { AuthAdapter, SentinelApiStore } from "../src/api/auth";
import type {
  BoardroomControlChallengeRecord,
  BoardroomControlClaimRecord,
  BoardroomControlStore
} from "../src/api/boardroom-control-store";
import { createApp } from "../src/api/server";
import {
  BoardroomControlChainError,
  type BoardroomControlChainReader,
  type BoardroomControlExpectedIdentity,
  type BoardroomControlSnapshot
} from "../src/chain/boardroom-control";

const NOW = new Date("2026-07-21T12:00:00.000Z");
const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000003";
const SESSION_COOKIE = "better-auth.session_token=boardroom-control";
const BOARDROOM = "0x1111111111111111111111111111111111111111" as Address;
const CONTROLLER = "0x2222222222222222222222222222222222222222" as Address;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as Hex;

class StubAuth implements AuthAdapter {
  readonly socialProviders = [];

  async getSession(input: { readonly headers: Headers }) {
    return input.headers.get("cookie")?.includes(SESSION_COOKIE) === true
      ? { user: { id: USER_ID } }
      : null;
  }

  async handler(): Promise<Response> {
    return new Response(null, { status: 404 });
  }
}

class MemoryControlStore implements BoardroomControlStore {
  readonly challenges = new Map<string, BoardroomControlChallengeRecord>();
  readonly claims = new Map<string, BoardroomControlClaimRecord>();
  readonly organizations = new Map<string, Set<string>>([[ORGANIZATION_ID, new Set([USER_ID])]]);
  sequence = 1;

  async canUseDestination(input: {
    readonly destination: { readonly id: string; readonly type: "user" | "organization" };
    readonly userId: string;
  }): Promise<boolean> {
    return input.destination.type === "user"
      ? input.destination.id === input.userId
      : this.organizations.get(input.destination.id)?.has(input.userId) === true;
  }

  async createChallenge(
    input: Omit<BoardroomControlChallengeRecord, "consumedAt">
  ): Promise<boolean> {
    if (!(await this.canUseDestination({ destination: input.destination, userId: input.requestedByUserId }))) {
      return false;
    }
    this.challenges.set(input.nonce, { ...input, consumedAt: null });
    return true;
  }

  async getChallenge(input: { readonly nonce: string; readonly requestedByUserId: string }) {
    const challenge = this.challenges.get(input.nonce);
    return challenge?.requestedByUserId === input.requestedByUserId ? challenge : null;
  }

  async consumeChallengeAndCreateClaim(input: {
    readonly messageHash: Hex;
    readonly nonce: string;
    readonly now: Date;
    readonly requestedByUserId: string;
    readonly signatureHash: Hex;
    readonly verified: BoardroomControlSnapshot;
  }) {
    const challenge = this.challenges.get(input.nonce);
    if (
      challenge === undefined ||
      challenge.requestedByUserId !== input.requestedByUserId ||
      challenge.consumedAt !== null ||
      challenge.expiresAt.getTime() <= input.now.getTime() ||
      challenge.messageHash !== input.messageHash ||
      !(await this.canUseDestination({
        destination: challenge.destination,
        userId: input.requestedByUserId
      })) ||
      !sameIdentity(challenge, input.verified)
    ) {
      return null;
    }

    this.challenges.set(input.nonce, { ...challenge, consumedAt: input.now });
    const id = `00000000-0000-4000-8000-${this.sequence.toString().padStart(12, "0")}`;
    this.sequence += 1;
    const claim: BoardroomControlClaimRecord = {
      boardroom: challenge.boardroom,
      chainId: challenge.chainId,
      configurationEpoch: challenge.configurationEpoch,
      controller: challenge.controller,
      controllerGeneration: challenge.controllerGeneration,
      createdAt: input.now,
      destination: challenge.destination,
      id,
      scope: challenge.scope,
      verifiedBlock: input.verified.blockNumber,
      verifiedBlockHash: input.verified.blockHash
    };
    this.claims.set(id, claim);
    return claim;
  }
}

class StubControlChain implements BoardroomControlChainReader {
  readonly snapshots = new Map<number, BoardroomControlSnapshot>();
  failure: BoardroomControlChainError | undefined;
  signatureEnabled = true;
  verifyCount = 0;
  onVerify: (() => void) | undefined;

  constructor() {
    this.snapshots.set(31337, snapshot(31337));
  }

  async resolveCanonicalBoardroom(input: { readonly boardroom: Address; readonly chainId: number }) {
    if (this.failure !== undefined) throw this.failure;
    const value = this.snapshots.get(input.chainId);
    if (value === undefined) throw new BoardroomControlChainError("unknown-chain");
    if (value.boardroom.toLowerCase() !== input.boardroom.toLowerCase()) {
      throw new BoardroomControlChainError("non-canonical-boardroom");
    }
    return value;
  }

  async verifyControlSignature(input: {
    readonly expected: BoardroomControlExpectedIdentity;
    readonly message: string;
    readonly signature: Hex;
  }) {
    this.verifyCount += 1;
    this.onVerify?.();
    if (this.failure !== undefined) throw this.failure;
    const value = this.snapshots.get(input.expected.chainId);
    if (value === undefined) throw new BoardroomControlChainError("unknown-chain");
    if (!sameIdentity(value, input.expected)) {
      throw new BoardroomControlChainError("stale-relationship");
    }
    if (!this.signatureEnabled || input.signature.toLowerCase() !== hashMessage(input.message).toLowerCase()) {
      throw new BoardroomControlChainError("invalid-signature");
    }
    return value;
  }
}

let now: Date;
let store: MemoryControlStore;
let chain: StubControlChain;
let nonceSequence: number;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  now = new Date(NOW);
  store = new MemoryControlStore();
  chain = new StubControlChain();
  nonceSequence = 1;
  app = createApp({
    auth: new StubAuth(),
    boardroomControl: { chain, store },
    config: {
      chains: [{ chainId: 31337 }],
      telegram: {},
      webOrigin: "https://pledge.cash"
    },
    generateNonce: () => `controlnonce${nonceSequence++.toString().padStart(20, "0")}`,
    now: () => new Date(now),
    store: {} as SentinelApiStore
  });
});

describe("Boardroom-control challenge and claim flow", () => {
  test("serializes and stores every authority dimension in one exact SIWE message", async () => {
    const response = await createChallenge();

    expect(response.audience).toBe("https://pledge.cash");
    expect(response.domain).toBe("pledge.cash");
    expect(response.identity).toEqual({
      boardroom: BOARDROOM,
      chainId: 31337,
      configurationEpoch: "7",
      controller: CONTROLLER,
      controllerGeneration: "3"
    });
    expect(response.messageHash).toBe(hashMessage(response.message));

    const parsed = parseSiweMessage(response.message);
    expect(parsed.address?.toLowerCase()).toBe(CONTROLLER);
    expect(parsed.chainId).toBe(31337);
    expect(parsed.domain).toBe("pledge.cash");
    expect(parsed.nonce).toBe(response.nonce);
    expect(parsed.issuedAt?.toISOString()).toBe(NOW.toISOString());
    expect(parsed.expirationTime?.toISOString()).toBe("2026-07-21T12:05:00.000Z");
    expect(parsed.resources).toEqual([
      "urn:pledge.cash:sentinel:audience:https%3A%2F%2Fpledge.cash",
      "urn:pledge.cash:sentinel:domain:pledge.cash",
      "urn:pledge.cash:sentinel:destination-type:user",
      `urn:pledge.cash:sentinel:destination-id:${USER_ID}`,
      "urn:pledge.cash:sentinel:scope:governance%3Awrite",
      "urn:pledge.cash:sentinel:chain-id:31337",
      `urn:pledge.cash:sentinel:boardroom:${BOARDROOM}`,
      `urn:pledge.cash:sentinel:controller:${CONTROLLER}`,
      "urn:pledge.cash:sentinel:controller-generation:3",
      "urn:pledge.cash:sentinel:controller-configuration-epoch:7",
      `urn:pledge.cash:sentinel:nonce:${response.nonce}`,
      "urn:pledge.cash:sentinel:issued-at:2026-07-21T12%3A00%3A00.000Z",
      "urn:pledge.cash:sentinel:expiration-time:2026-07-21T12%3A05%3A00.000Z"
    ]);

    const stored = store.challenges.get(response.nonce);
    expect(stored?.message).toBe(response.message);
    expect(stored?.messageHash).toBe(response.messageHash);
    expect(stored?.issuedBlock).toBe(500n);
    expect(stored?.issuedBlockHash).toBe(BLOCK_HASH);
  });

  test("rejects signatures over altered audience, destination, scope, chain, identities, nonce, or time", async () => {
    const challenge = await createChallenge();
    const alterations = [
      ["https%3A%2F%2Fpledge.cash", "https%3A%2F%2Fattacker.invalid"],
      [USER_ID, OTHER_USER_ID],
      ["governance%3Awrite", "governance%3Aadmin"],
      ["chain-id:31337", "chain-id:1"],
      [BOARDROOM, "0x3333333333333333333333333333333333333333"],
      [CONTROLLER, "0x4444444444444444444444444444444444444444"],
      ["controller-generation:3", "controller-generation:4"],
      ["controller-configuration-epoch:7", "controller-configuration-epoch:8"],
      [challenge.nonce, "controlnonce99999999999999999999"],
      ["2026-07-21T12%3A00%3A00.000Z", "2026-07-21T12%3A00%3A01.000Z"],
      ["2026-07-21T12%3A05%3A00.000Z", "2026-07-21T12%3A06%3A00.000Z"]
    ] as const;

    for (const [from, to] of alterations) {
      const altered = challenge.message.replace(from, to);
      expect(altered).not.toBe(challenge.message);
      const response = await claim(challenge.nonce, hashMessage(altered));
      expect(response.status).toBe(403);
    }
    expect(store.challenges.get(challenge.nonce)?.consumedAt).toBeNull();
  });

  test("consumes a nonce and creates its claim atomically, while replay remains forbidden", async () => {
    const challenge = await createChallenge();
    const first = await claim(challenge.nonce, challenge.messageHash);
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body).toEqual({
      claim: {
        destination: { id: USER_ID, type: "user" },
        id: "00000000-0000-4000-8000-000000000001",
        identity: challenge.identity,
        scope: "governance:write",
        verifiedAt: NOW.toISOString(),
        verifiedBlock: "500",
        verifiedBlockHash: BLOCK_HASH
      }
    });
    expect(store.challenges.get(challenge.nonce)?.consumedAt).toEqual(NOW);
    expect(store.claims.size).toBe(1);

    const replay = await claim(challenge.nonce, challenge.messageHash);
    expect(replay.status).toBe(409);
    expect(store.claims.size).toBe(1);
    expect(chain.verifyCount).toBe(1);
  });

  test("rejects stored-message or semantic-field corruption before making a chain call", async () => {
    const messageCorruption = await createChallenge();
    const first = store.challenges.get(messageCorruption.nonce);
    expect(first).toBeDefined();
    if (first !== undefined) {
      const message = first.message.replace("governance%3Awrite", "governance%3Aadmin");
      store.challenges.set(first.nonce, { ...first, message, messageHash: hashMessage(message) });
    }
    expect((await claim(messageCorruption.nonce, messageCorruption.messageHash)).status).toBe(503);

    const fieldCorruption = await createChallenge();
    const second = store.challenges.get(fieldCorruption.nonce);
    expect(second).toBeDefined();
    if (second !== undefined) {
      store.challenges.set(second.nonce, { ...second, scope: "governance:admin" });
    }
    expect((await claim(fieldCorruption.nonce, fieldCorruption.messageHash)).status).toBe(503);
    expect(chain.verifyCount).toBe(0);
    expect(store.claims.size).toBe(0);
  });

  test("a prior claim or Better Auth session never substitutes for a fresh proof", async () => {
    const first = await createChallenge();
    expect((await claim(first.nonce, first.messageHash)).status).toBe(200);

    const sessionOnly = await app.request("/boardroom-control/claims", {
      body: JSON.stringify({}),
      headers: authHeaders(),
      method: "POST"
    });
    expect(sessionOnly.status).toBe(400);
    expect((await claim(first.nonce, first.messageHash)).status).toBe(409);

    const second = await createChallenge();
    expect(second.nonce).not.toBe(first.nonce);
    expect((await claim(second.nonce, second.messageHash)).status).toBe(200);
    expect(store.claims.size).toBe(2);
  });

  test("fails closed after controller replacement, epoch rotation, or Safe signer change", async () => {
    const replacementChallenge = await createChallenge();
    chain.snapshots.set(31337, {
      ...snapshot(31337),
      controller: "0x3333333333333333333333333333333333333333",
      controllerGeneration: 4n
    });
    expect((await claim(replacementChallenge.nonce, replacementChallenge.messageHash)).status).toBe(409);

    chain.snapshots.set(31337, snapshot(31337));
    const epochChallenge = await createChallenge();
    chain.snapshots.set(31337, { ...snapshot(31337), configurationEpoch: 8n });
    expect((await claim(epochChallenge.nonce, epochChallenge.messageHash)).status).toBe(409);

    chain.snapshots.set(31337, snapshot(31337));
    const signerChallenge = await createChallenge();
    chain.signatureEnabled = false;
    expect((await claim(signerChallenge.nonce, signerChallenge.messageHash)).status).toBe(403);
  });

  test("keeps identical contract addresses on different chains as distinct identities", async () => {
    chain.snapshots.set(1, { ...snapshot(31337), chainId: 1, blockNumber: 900n });
    const first = await createChallenge({ chainId: 31337 });
    const second = await createChallenge({ chainId: 1 });

    expect(first.identity.controller).toBe(second.identity.controller);
    expect(first.identity.chainId).toBe(31337);
    expect(second.identity.chainId).toBe(1);
    expect(first.message).not.toBe(second.message);
  });

  test("requires the destination user or a current organization member", async () => {
    const foreignUser = await requestChallenge({ destination: { id: OTHER_USER_ID, type: "user" } });
    expect(foreignUser.status).toBe(403);

    const organization = await requestChallenge({
      destination: { id: ORGANIZATION_ID, type: "organization" }
    });
    expect(organization.status).toBe(200);
    const challenge = await organization.json();
    store.organizations.get(ORGANIZATION_ID)?.delete(USER_ID);
    expect((await claim(challenge.nonce, challenge.messageHash)).status).toBe(409);
    expect(store.claims.size).toBe(0);
  });

  test("rejects expired, unknown, and unauthenticated challenges without chain calls", async () => {
    const unauthenticated = await app.request("/boardroom-control/challenges", {
      body: JSON.stringify(challengeRequest()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    expect(unauthenticated.status).toBe(401);

    const challenge = await createChallenge();
    now = new Date("2026-07-21T12:05:00.000Z");
    expect((await claim(challenge.nonce, challenge.messageHash)).status).toBe(400);
    expect((await claim("controlnonce99999999999999999999", challenge.messageHash)).status).toBe(400);
    expect(chain.verifyCount).toBe(0);
  });

  test("rejects a challenge that expires while finalized-block signature verification is in flight", async () => {
    const challenge = await createChallenge();
    chain.onVerify = () => {
      now = new Date(challenge.expirationTime);
    };

    expect((await claim(challenge.nonce, challenge.messageHash)).status).toBe(409);
    expect(chain.verifyCount).toBe(1);
    expect(store.claims.size).toBe(0);
  });

  test("maps unknown, unsupported, stale, reorg, malformed, and RPC failures to closed responses", async () => {
    const cases = [
      ["unknown-chain", 400],
      ["unsupported-release", 422],
      ["non-canonical-boardroom", 422],
      ["stale-relationship", 409],
      ["malformed-chain-result", 503],
      ["reorg-uncertainty", 503],
      ["rpc-failure", 503]
    ] as const;

    for (const [failure, status] of cases) {
      chain.failure = new BoardroomControlChainError(failure);
      expect((await requestChallenge()).status).toBe(status);
    }
  });
});

async function createChallenge(overrides: Record<string, unknown> = {}) {
  const response = await requestChallenge(overrides);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    audience: string;
    domain: string;
    expirationTime: string;
    identity: {
      boardroom: Address;
      chainId: number;
      configurationEpoch: string;
      controller: Address;
      controllerGeneration: string;
    };
    issuedAt: string;
    message: string;
    messageHash: Hex;
    nonce: string;
    scope: string;
  };
}

function requestChallenge(overrides: Record<string, unknown> = {}) {
  return app.request("/boardroom-control/challenges", {
    body: JSON.stringify({ ...challengeRequest(), ...overrides }),
    headers: authHeaders(),
    method: "POST"
  });
}

function challengeRequest() {
  return {
    boardroom: BOARDROOM,
    chainId: 31337,
    destination: { id: USER_ID, type: "user" },
    scope: "governance:write"
  };
}

function claim(nonce: string, signature: Hex) {
  return app.request("/boardroom-control/claims", {
    body: JSON.stringify({ nonce, signature }),
    headers: authHeaders(),
    method: "POST"
  });
}

function authHeaders() {
  return { "Content-Type": "application/json", Cookie: SESSION_COOKIE };
}

function snapshot(chainId: number): BoardroomControlSnapshot {
  return {
    blockHash: BLOCK_HASH,
    blockNumber: 500n,
    boardroom: BOARDROOM,
    chainId,
    configurationEpoch: 7n,
    controller: CONTROLLER,
    controllerGeneration: 3n
  };
}

function sameIdentity(
  left: Pick<
    BoardroomControlSnapshot,
    "boardroom" | "chainId" | "configurationEpoch" | "controller" | "controllerGeneration"
  >,
  right: BoardroomControlExpectedIdentity
): boolean {
  return (
    left.boardroom.toLowerCase() === right.boardroom.toLowerCase() &&
    left.chainId === right.chainId &&
    left.configurationEpoch === right.configurationEpoch &&
    left.controller.toLowerCase() === right.controller.toLowerCase() &&
    left.controllerGeneration === right.controllerGeneration
  );
}
