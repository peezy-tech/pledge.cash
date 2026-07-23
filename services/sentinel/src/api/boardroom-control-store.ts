import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";

import type { SentinelDb } from "../db/client";
import {
  boardroomControlChallenges,
  boardroomControlClaims,
  organizationMembers
} from "../db/schema";
import type { BoardroomControlSnapshot } from "../chain/boardroom-control";
import type { BoardroomControlDestination } from "./dto";

export type BoardroomControlChallengeRecord = {
  readonly audience: string;
  readonly boardroom: Address;
  readonly chainId: number;
  readonly configurationEpoch: bigint;
  readonly consumedAt: Date | null;
  readonly controller: Address;
  readonly controllerGeneration: bigint;
  readonly destination: BoardroomControlDestination;
  readonly domain: string;
  readonly expiresAt: Date;
  readonly issuedAt: Date;
  readonly issuedBlock: bigint;
  readonly issuedBlockHash: Hex;
  readonly message: string;
  readonly messageHash: Hex;
  readonly nonce: string;
  readonly requestedByUserId: string;
  readonly scope: string;
};

export type BoardroomControlClaimRecord = {
  readonly boardroom: Address;
  readonly chainId: number;
  readonly configurationEpoch: bigint;
  readonly controller: Address;
  readonly controllerGeneration: bigint;
  readonly createdAt: Date;
  readonly destination: BoardroomControlDestination;
  readonly id: string;
  readonly scope: string;
  readonly verifiedBlock: bigint;
  readonly verifiedBlockHash: Hex;
};

export type BoardroomControlStore = {
  canUseDestination(input: {
    readonly destination: BoardroomControlDestination;
    readonly userId: string;
  }): Promise<boolean>;
  createChallenge(input: Omit<BoardroomControlChallengeRecord, "consumedAt">): Promise<boolean>;
  getChallenge(input: {
    readonly nonce: string;
    readonly requestedByUserId: string;
  }): Promise<BoardroomControlChallengeRecord | null>;
  consumeChallengeAndCreateClaim(input: {
    readonly messageHash: Hex;
    readonly nonce: string;
    readonly now: Date;
    readonly requestedByUserId: string;
    readonly signatureHash: Hex;
    readonly verified: BoardroomControlSnapshot;
  }): Promise<BoardroomControlClaimRecord | null>;
};

export function createDrizzleBoardroomControlStore(db: SentinelDb): BoardroomControlStore {
  return {
    async canUseDestination(input) {
      return destinationIsAvailable(db, input.destination, input.userId);
    },

    async createChallenge(input) {
      return db.transaction(async (tx) => {
        if (!(await destinationIsAvailable(tx as SentinelDb, input.destination, input.requestedByUserId))) {
          return false;
        }

        await tx.insert(boardroomControlChallenges).values({
          audience: input.audience,
          boardroom: input.boardroom.toLowerCase(),
          chainId: input.chainId,
          configurationEpoch: input.configurationEpoch,
          controller: input.controller.toLowerCase(),
          controllerGeneration: input.controllerGeneration,
          destinationId: input.destination.id,
          destinationType: input.destination.type,
          domain: input.domain,
          expiresAt: input.expiresAt,
          issuedAt: input.issuedAt,
          issuedBlock: input.issuedBlock,
          issuedBlockHash: input.issuedBlockHash.toLowerCase(),
          message: input.message,
          messageHash: input.messageHash.toLowerCase(),
          nonce: input.nonce,
          requestedByUserId: input.requestedByUserId,
          scope: input.scope
        });
        return true;
      });
    },

    async getChallenge(input) {
      const [row] = await db
        .select()
        .from(boardroomControlChallenges)
        .where(
          and(
            eq(boardroomControlChallenges.nonce, input.nonce),
            eq(boardroomControlChallenges.requestedByUserId, input.requestedByUserId)
          )
        )
        .limit(1);
      return row === undefined ? null : toChallengeRecord(row);
    },

    async consumeChallengeAndCreateClaim(input) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.nonce}))`);
        const [row] = await tx
          .select()
          .from(boardroomControlChallenges)
          .where(
            and(
              eq(boardroomControlChallenges.nonce, input.nonce),
              eq(boardroomControlChallenges.requestedByUserId, input.requestedByUserId),
              isNull(boardroomControlChallenges.consumedAt),
              gt(boardroomControlChallenges.expiresAt, input.now)
            )
          )
          .for("update")
          .limit(1);
        if (row === undefined) return null;

        const challenge = toChallengeRecord(row);
        if (
          challenge.messageHash.toLowerCase() !== input.messageHash.toLowerCase() ||
          !snapshotMatchesChallenge(input.verified, challenge) ||
          !(await destinationIsAvailable(
            tx as SentinelDb,
            challenge.destination,
            input.requestedByUserId,
            true
          ))
        ) {
          return null;
        }

        const [consumed] = await tx
          .update(boardroomControlChallenges)
          .set({ consumedAt: input.now })
          .where(
            and(
              eq(boardroomControlChallenges.nonce, input.nonce),
              eq(boardroomControlChallenges.requestedByUserId, input.requestedByUserId),
              isNull(boardroomControlChallenges.consumedAt),
              gt(boardroomControlChallenges.expiresAt, input.now)
            )
          )
          .returning({ nonce: boardroomControlChallenges.nonce });
        if (consumed === undefined) return null;

        const [claim] = await tx
          .insert(boardroomControlClaims)
          .values({
            boardroom: challenge.boardroom.toLowerCase(),
            chainId: challenge.chainId,
            challengeNonce: challenge.nonce,
            configurationEpoch: challenge.configurationEpoch,
            controller: challenge.controller.toLowerCase(),
            controllerGeneration: challenge.controllerGeneration,
            createdAt: input.now,
            createdByUserId: input.requestedByUserId,
            destinationId: challenge.destination.id,
            destinationType: challenge.destination.type,
            messageHash: input.messageHash.toLowerCase(),
            scope: challenge.scope,
            signatureHash: input.signatureHash.toLowerCase(),
            verifiedBlock: input.verified.blockNumber,
            verifiedBlockHash: input.verified.blockHash.toLowerCase()
          })
          .returning();
        return claim === undefined ? null : toClaimRecord(claim);
      });
    }
  };
}

async function destinationIsAvailable(
  db: SentinelDb,
  destination: BoardroomControlDestination,
  userId: string,
  lockMembership = false
): Promise<boolean> {
  if (destination.type === "user") return destination.id === userId;

  const query = db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, destination.id),
        eq(organizationMembers.userId, userId)
      )
    );
  const [member] = lockMembership
    ? await query.for("share").limit(1)
    : await query.limit(1);
  return member !== undefined;
}

function snapshotMatchesChallenge(
  snapshot: BoardroomControlSnapshot,
  challenge: BoardroomControlChallengeRecord
): boolean {
  return (
    snapshot.chainId === challenge.chainId &&
    snapshot.boardroom.toLowerCase() === challenge.boardroom.toLowerCase() &&
    snapshot.controller.toLowerCase() === challenge.controller.toLowerCase() &&
    snapshot.controllerGeneration === challenge.controllerGeneration &&
    snapshot.configurationEpoch === challenge.configurationEpoch
  );
}

function toChallengeRecord(
  row: typeof boardroomControlChallenges.$inferSelect
): BoardroomControlChallengeRecord {
  return {
    audience: row.audience,
    boardroom: row.boardroom as Address,
    chainId: row.chainId,
    configurationEpoch: row.configurationEpoch,
    consumedAt: row.consumedAt,
    controller: row.controller as Address,
    controllerGeneration: row.controllerGeneration,
    destination: { id: row.destinationId, type: row.destinationType },
    domain: row.domain,
    expiresAt: row.expiresAt,
    issuedAt: row.issuedAt,
    issuedBlock: row.issuedBlock,
    issuedBlockHash: row.issuedBlockHash as Hex,
    message: row.message,
    messageHash: row.messageHash as Hex,
    nonce: row.nonce,
    requestedByUserId: row.requestedByUserId,
    scope: row.scope
  };
}

function toClaimRecord(
  row: typeof boardroomControlClaims.$inferSelect
): BoardroomControlClaimRecord {
  return {
    boardroom: row.boardroom as Address,
    chainId: row.chainId,
    configurationEpoch: row.configurationEpoch,
    controller: row.controller as Address,
    controllerGeneration: row.controllerGeneration,
    createdAt: row.createdAt,
    destination: { id: row.destinationId, type: row.destinationType },
    id: row.id,
    scope: row.scope,
    verifiedBlock: row.verifiedBlock,
    verifiedBlockHash: row.verifiedBlockHash as Hex
  };
}
