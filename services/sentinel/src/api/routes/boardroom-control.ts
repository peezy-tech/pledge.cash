import { Hono } from "hono";
import { getAddress, hashMessage, keccak256, type Address, type Hex } from "viem";
import { createSiweMessage } from "viem/siwe";

import {
  BoardroomControlChainError,
  type BoardroomControlExpectedIdentity
} from "../../chain/boardroom-control";
import {
  createRateLimitMiddleware,
  createSessionMiddleware,
  getNow,
  jsonError,
  parseJson,
  type ApiEnv,
  type SentinelApiDeps
} from "../auth";
import {
  BoardroomControlChallengeRequestSchema,
  BoardroomControlChallengeResponseSchema,
  BoardroomControlClaimRequestSchema,
  BoardroomControlClaimResponseSchema,
  type AddressDto,
  type BoardroomControlDestination
} from "../dto";

export const BOARDROOM_CONTROL_CHALLENGE_TTL_MS = 5 * 60 * 1_000;
export const BOARDROOM_CONTROL_SIWE_STATEMENT =
  "Authorize one fresh Sentinel Boardroom-control proof for the exact resources listed below.";

export function createBoardroomControlRoutes(deps: SentinelApiDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const requireSession = createSessionMiddleware(deps);
  const rateLimit = createRateLimitMiddleware(deps, "boardroom-control");

  app.use("*", requireSession);

  app.post("/challenges", rateLimit, async (c) => {
    const body = await parseJson(c, BoardroomControlChallengeRequestSchema);
    if (!body.ok) return body.response;
    if (deps.boardroomControl === undefined) {
      return jsonError(c, 503, "Boardroom control proof is unavailable");
    }

    const user = c.get("user");
    const destinationAllowed = await deps.boardroomControl.store.canUseDestination({
      destination: body.value.destination,
      userId: user.id
    });
    if (!destinationAllowed) {
      return jsonError(c, 403, "Boardroom-control destination is not available to this session");
    }

    let snapshot;
    try {
      snapshot = await deps.boardroomControl.chain.resolveCanonicalBoardroom({
        boardroom: getAddress(body.value.boardroom),
        chainId: body.value.chainId
      });
    } catch (error) {
      return chainFailureResponse(c, error);
    }

    const issuedAt = getNow(deps);
    const expiresAt = new Date(issuedAt.getTime() + BOARDROOM_CONTROL_CHALLENGE_TTL_MS);
    const nonce = deps.generateNonce?.() ?? crypto.randomUUID().replaceAll("-", "");
    if (!/^[a-zA-Z0-9]{16,64}$/.test(nonce)) {
      throw new Error("Boardroom-control nonce generator returned an invalid nonce");
    }

    const audience = new URL(deps.config.webOrigin).origin;
    const domain = new URL(deps.config.webOrigin).host;
    const message = buildBoardroomControlSiweMessage({
      audience,
      destination: body.value.destination,
      domain,
      expiresAt,
      identity: snapshot,
      issuedAt,
      nonce,
      scope: body.value.scope
    });
    const messageHash = hashMessage(message);
    const created = await deps.boardroomControl.store.createChallenge({
      audience,
      boardroom: snapshot.boardroom,
      chainId: snapshot.chainId,
      configurationEpoch: snapshot.configurationEpoch,
      controller: snapshot.controller,
      controllerGeneration: snapshot.controllerGeneration,
      destination: body.value.destination,
      domain,
      expiresAt,
      issuedAt,
      issuedBlock: snapshot.blockNumber,
      issuedBlockHash: snapshot.blockHash,
      message,
      messageHash,
      nonce,
      requestedByUserId: user.id,
      scope: body.value.scope
    });
    if (!created) {
      return jsonError(c, 403, "Boardroom-control destination is no longer available");
    }

    return c.json(
      BoardroomControlChallengeResponseSchema.parse({
        audience,
        destination: body.value.destination,
        domain,
        expirationTime: expiresAt.toISOString(),
        identity: toIdentityDto(snapshot),
        issuedAt: issuedAt.toISOString(),
        message,
        messageHash,
        nonce,
        scope: body.value.scope
      })
    );
  });

  // This endpoint creates an audit claim, not a reusable authorization token.
  // A privileged Boardroom mutation must execute this fresh proof flow again.
  app.post("/claims", rateLimit, async (c) => {
    const body = await parseJson(c, BoardroomControlClaimRequestSchema);
    if (!body.ok) return body.response;
    if (deps.boardroomControl === undefined) {
      return jsonError(c, 503, "Boardroom control proof is unavailable");
    }

    const user = c.get("user");
    const challenge = await deps.boardroomControl.store.getChallenge({
      nonce: body.value.nonce,
      requestedByUserId: user.id
    });
    const observedAt = getNow(deps);
    if (challenge === null) return jsonError(c, 400, "Unknown Boardroom-control nonce");
    if (challenge.consumedAt !== null) {
      return jsonError(c, 409, "Boardroom-control nonce has already been consumed");
    }
    if (challenge.expiresAt.getTime() <= observedAt.getTime()) {
      return jsonError(c, 400, "Boardroom-control challenge has expired");
    }
    const currentAudience = new URL(deps.config.webOrigin).origin;
    const currentDomain = new URL(deps.config.webOrigin).host;
    const expectedMessage = buildBoardroomControlSiweMessage({
      audience: challenge.audience,
      destination: challenge.destination,
      domain: challenge.domain,
      expiresAt: challenge.expiresAt,
      identity: challengeIdentity(challenge),
      issuedAt: challenge.issuedAt,
      nonce: challenge.nonce,
      scope: challenge.scope
    });
    if (
      challenge.audience !== currentAudience ||
      challenge.domain !== currentDomain ||
      challenge.message !== expectedMessage ||
      hashMessage(expectedMessage).toLowerCase() !== challenge.messageHash.toLowerCase()
    ) {
      return jsonError(c, 503, "Stored Boardroom-control challenge is invalid");
    }

    let verified;
    try {
      verified = await deps.boardroomControl.chain.verifyControlSignature({
        expected: challengeIdentity(challenge),
        message: challenge.message,
        signature: body.value.signature as Hex
      });
    } catch (error) {
      return chainFailureResponse(c, error);
    }

    // Verification can cross the expiry boundary. Re-read time immediately before the
    // atomic consume so a slow finalized-block/RPC proof cannot use the earlier precheck.
    const consumedAt = getNow(deps);
    const signatureHash = keccak256(body.value.signature as Hex);
    const claim = await deps.boardroomControl.store.consumeChallengeAndCreateClaim({
      messageHash: challenge.messageHash,
      nonce: challenge.nonce,
      now: consumedAt,
      requestedByUserId: user.id,
      signatureHash,
      verified
    });
    if (claim === null) {
      return jsonError(c, 409, "Boardroom-control challenge could not be consumed");
    }

    return c.json(
      BoardroomControlClaimResponseSchema.parse({
        claim: {
          destination: claim.destination,
          id: claim.id,
          identity: toIdentityDto(claim),
          scope: claim.scope,
          verifiedAt: claim.createdAt.toISOString(),
          verifiedBlock: claim.verifiedBlock.toString(),
          verifiedBlockHash: claim.verifiedBlockHash
        }
      })
    );
  });

  return app;
}

export function buildBoardroomControlSiweMessage(input: {
  readonly audience: string;
  readonly destination: BoardroomControlDestination;
  readonly domain: string;
  readonly expiresAt: Date;
  readonly identity: BoardroomControlExpectedIdentity;
  readonly issuedAt: Date;
  readonly nonce: string;
  readonly scope: string;
}): string {
  const resources = [
    resource("audience", input.audience),
    resource("domain", input.domain),
    resource("destination-type", input.destination.type),
    resource("destination-id", input.destination.id),
    resource("scope", input.scope),
    resource("chain-id", input.identity.chainId.toString()),
    resource("boardroom", getAddress(input.identity.boardroom)),
    resource("controller", getAddress(input.identity.controller)),
    resource("controller-generation", input.identity.controllerGeneration.toString()),
    resource("controller-configuration-epoch", input.identity.configurationEpoch.toString()),
    resource("nonce", input.nonce),
    resource("issued-at", input.issuedAt.toISOString()),
    resource("expiration-time", input.expiresAt.toISOString())
  ];

  return createSiweMessage({
    address: getAddress(input.identity.controller),
    chainId: input.identity.chainId,
    domain: input.domain,
    expirationTime: input.expiresAt,
    issuedAt: input.issuedAt,
    nonce: input.nonce,
    resources,
    statement: BOARDROOM_CONTROL_SIWE_STATEMENT,
    uri: input.audience,
    version: "1"
  });
}

function resource(name: string, value: string): string {
  return `urn:pledge.cash:sentinel:${name}:${encodeURIComponent(value)}`;
}

function challengeIdentity(input: {
  readonly boardroom: Address;
  readonly chainId: number;
  readonly configurationEpoch: bigint;
  readonly controller: Address;
  readonly controllerGeneration: bigint;
}): BoardroomControlExpectedIdentity {
  return {
    boardroom: input.boardroom,
    chainId: input.chainId,
    configurationEpoch: input.configurationEpoch,
    controller: input.controller,
    controllerGeneration: input.controllerGeneration
  };
}

function toIdentityDto(input: {
  readonly boardroom: Address;
  readonly chainId: number;
  readonly configurationEpoch: bigint;
  readonly controller: Address;
  readonly controllerGeneration: bigint;
}) {
  return {
    boardroom: input.boardroom.toLowerCase() as AddressDto,
    chainId: input.chainId,
    configurationEpoch: input.configurationEpoch.toString(),
    controller: input.controller.toLowerCase() as AddressDto,
    controllerGeneration: input.controllerGeneration.toString()
  };
}

function chainFailureResponse(c: Parameters<typeof jsonError>[0], error: unknown): Response {
  if (!(error instanceof BoardroomControlChainError)) {
    return jsonError(c, 503, "Boardroom-control chain verification failed closed");
  }

  switch (error.failure) {
    case "unknown-chain":
      return jsonError(c, 400, "Unknown Boardroom-control chain");
    case "unsupported-release":
      return jsonError(c, 422, "Boardroom release does not support control proof");
    case "non-canonical-boardroom":
      return jsonError(c, 422, "Boardroom is not canonical for this release");
    case "stale-relationship":
      return jsonError(c, 409, "Boardroom controller relationship is stale");
    case "invalid-signature":
      return jsonError(c, 403, "Boardroom-control signature is invalid");
    case "malformed-chain-result":
    case "reorg-uncertainty":
    case "rpc-failure":
      return jsonError(c, 503, "Boardroom-control chain verification failed closed");
  }
}
