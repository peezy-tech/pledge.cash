import { and, eq, sql, type SQL } from "drizzle-orm";

import type { SentinelDb } from "../db/client";
import {
  channels,
  subscriptionBoardrooms,
  subscriptions,
  telegramLinkCodes,
  users,
  walletLinkNonces,
  wallets
} from "../db/schema";
import type {
  AddressDto,
  AnalysisDto,
  BoardroomRef,
  ChannelDto,
  HealthResponse,
  PublicActionDto,
  PublicActionsQuery,
  PublicActionsResponse,
  RiskAssessmentDto,
  SubscriptionDto,
  UserDto,
  WalletDto
} from "./dto";
import type { SentinelApiStore, TelegramLinkCodeRecord, WalletNonceRecord } from "./auth";

type QueryResult<T> = readonly T[] | { readonly rows: readonly T[] };

type CursorRow = {
  readonly blockNumber: bigint | string;
  readonly chainId: number;
  readonly scope: string;
};

type PublicActionRow = {
  readonly actionHash: string;
  readonly analysisAffectedParties: unknown;
  readonly analysisEffects: unknown;
  readonly analysisHarness: string | null;
  readonly analysisModel: string | null;
  readonly analysisSeverityRationale: string | null;
  readonly analysisSource: "harness" | "template" | null;
  readonly analysisSummary: string | null;
  readonly boardroom: string;
  readonly boardroomName: string | null;
  readonly boardroomShareToken: string;
  readonly boardroomStatus: "prelaunch" | "active" | "winddown";
  readonly chainId: number;
  readonly decodeStatus: "decoded" | "undecoded";
  readonly eta: Date | string;
  readonly id: string;
  readonly queueBlock: bigint | string;
  readonly queueTxHash: string;
  readonly riskEvaluatedAt: Date | string | null;
  readonly riskFindings: unknown;
  readonly riskRulesetVersion: number | null;
  readonly riskSeverity: "low" | "medium" | "high" | null;
  readonly status: "queued" | "cancelled" | "executed";
};

type PublicActionCallRow = {
  readonly actionId: string;
  readonly callIndex: number;
  readonly data: string;
  readonly decodedArgs: unknown;
  readonly decodedFunction: string | null;
  readonly policy: string;
  readonly selector: string;
  readonly target: string;
  readonly value: string;
};

const severityRank = {
  low: 1,
  medium: 2,
  high: 3
} as const;

export function createDrizzleApiStore(db: SentinelDb): SentinelApiStore {
  return {
    async consumeWalletNonce(input) {
      const [row] = await db
        .update(walletLinkNonces)
        .set({ usedAt: input.now })
        .where(
          and(
            eq(walletLinkNonces.nonce, input.nonce),
            eq(walletLinkNonces.userId, input.userId),
            sql`${walletLinkNonces.usedAt} IS NULL`,
            sql`${walletLinkNonces.expiresAt} > ${input.now}`
          )
        )
        .returning({ nonce: walletLinkNonces.nonce });
      return row !== undefined;
    },
    async createTelegramLinkCode(input) {
      const [row] = await db
        .insert(telegramLinkCodes)
        .values(input)
        .returning({
          code: telegramLinkCodes.code,
          expiresAt: telegramLinkCodes.expiresAt
        });
      return row ?? { code: input.code, expiresAt: input.expiresAt };
    },
    async createWalletNonce(input) {
      const [row] = await db.insert(walletLinkNonces).values(input).returning();
      return row ?? { ...input, usedAt: null };
    },
    async deleteChannel(input) {
      const [row] = await db
        .delete(channels)
        .where(and(eq(channels.id, input.id), eq(channels.userId, input.userId)))
        .returning({ id: channels.id });
      return row !== undefined;
    },
    async getAuthSnapshot(userId) {
      const [channels_, subscription, wallets_] = await Promise.all([
        listChannels(db, userId),
        readSubscription(db, userId),
        listWallets(db, userId)
      ]);
      return { channels: channels_, subscription, wallets: wallets_ };
    },
    async getChannels(userId) {
      return listChannels(db, userId);
    },
    async getCursorLags(chainIds) {
      return getCursorLags(db, chainIds);
    },
    async getPublicActions(query) {
      return getPublicActions(db, query);
    },
    async getSubscription(userId) {
      return readSubscription(db, userId);
    },
    async getWalletNonce(nonce) {
      const [row] = await db
        .select()
        .from(walletLinkNonces)
        .where(eq(walletLinkNonces.nonce, nonce))
        .limit(1);
      return row ?? null;
    },
    async linkWallet(input) {
      const [row] = await db
        .insert(wallets)
        .values(input)
        .onConflictDoUpdate({
          target: [wallets.userId, wallets.address],
          set: {
            siweMessage: input.siweMessage,
            verifiedAt: input.verifiedAt
          }
        })
        .returning({
          address: wallets.address,
          verifiedAt: wallets.verifiedAt
        });
      return toWalletDto(row ?? { address: input.address, verifiedAt: input.verifiedAt });
    },
    async ping() {
      await db.execute(sql`SELECT 1`);
    },
    async putSubscription(input) {
      return db.transaction(async (tx) => {
        const now = new Date();
        await tx
          .insert(subscriptions)
          .values({
            minSeverity: input.minSeverity,
            mode: input.mode,
            updatedAt: now,
            userId: input.userId
          })
          .onConflictDoUpdate({
            target: subscriptions.userId,
            set: {
              minSeverity: input.minSeverity,
              mode: input.mode,
              updatedAt: now
            }
          });

        await tx
          .delete(subscriptionBoardrooms)
          .where(eq(subscriptionBoardrooms.userId, input.userId));

        if (input.boardrooms.length > 0) {
          await tx.insert(subscriptionBoardrooms).values(
            input.boardrooms.map((boardroom) => ({
              boardroom: boardroom.address,
              chainId: boardroom.chainId,
              userId: input.userId
            }))
          );
        }

        return readSubscription(tx as SentinelDb, input.userId);
      });
    },
    async unlinkWallet(input) {
      const [row] = await db
        .delete(wallets)
        .where(and(eq(wallets.userId, input.userId), eq(wallets.address, input.address)))
        .returning({ address: wallets.address });
      return row !== undefined;
    },
    async upsertUser(user) {
      const now = new Date();
      const [row] = await db
        .insert(users)
        .values({
          email: user.email,
          updatedAt: now,
          workosUserId: user.workosUserId
        })
        .onConflictDoUpdate({
          target: users.workosUserId,
          set: {
            email: user.email,
            updatedAt: now
          }
        })
        .returning();

      if (row !== undefined) {
        return toUserDto(row);
      }

      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.workosUserId, user.workosUserId))
        .limit(1);
      if (existing === undefined) {
        throw new Error("Failed to upsert Sentinel user");
      }

      return toUserDto(existing);
    }
  };
}

async function getCursorLags(
  db: SentinelDb,
  chainIds: readonly number[]
): Promise<HealthResponse["chains"]> {
  if (chainIds.length === 0) {
    return [];
  }

  const ids = sql.join(
    chainIds.map((chainId) => sql`${chainId}`),
    sql`, `
  );
  const rows = rowsFromResult(
    await db.execute<CursorRow>(
      sql`
        SELECT chain_id AS "chainId", scope, block_number AS "blockNumber"
        FROM cursors
        WHERE chain_id IN (${ids})
      `
    )
  );
  const byChain = new Map<number, CursorRow[]>();
  for (const row of rows) {
    byChain.set(row.chainId, [...(byChain.get(row.chainId) ?? []), row]);
  }

  return chainIds.map((chainId) => {
    const chainRows = byChain.get(chainId) ?? [];
    const blockByScope = new Map(chainRows.map((row) => [row.scope, BigInt(row.blockNumber)]));
    const blocks = [...blockByScope.values()];
    const max = blocks.length === 0 ? undefined : blocks.reduce((left, right) => (left > right ? left : right));
    const min = blocks.length === 0 ? undefined : blocks.reduce((left, right) => (left < right ? left : right));
    return withoutUndefined({
      chainId,
      factoryDiscoveryBlock: stringValue(blockByScope.get("factory-discovery")),
      governanceBlock: stringValue(blockByScope.get("governance")),
      lagBlocks: max === undefined || min === undefined ? undefined : (max - min).toString(),
      shareTransfersBlock: stringValue(blockByScope.get("share-transfers"))
    });
  });
}

async function getPublicActions(
  db: SentinelDb,
  query: PublicActionsQuery
): Promise<PublicActionsResponse> {
  const limit = query.limit;
  const offset = cursorToOffset(query.cursor);
  const filters: SQL[] = [];

  if (query.chainId !== undefined) {
    filters.push(sql`qa.chain_id = ${query.chainId}`);
  }

  if (query.boardroom !== undefined) {
    filters.push(sql`lower(qa.boardroom) = lower(${query.boardroom})`);
  }

  if (query.status !== undefined) {
    filters.push(sql`qa.status = ${query.status}::sentinel_queued_action_status`);
  }

  if (query.minSeverity !== undefined) {
    filters.push(
      sql`
        r.severity IS NOT NULL
        AND CASE r.severity
          WHEN 'low' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'high' THEN 3
        END >= ${severityRank[query.minSeverity]}
      `
    );
  }

  const where = filters.length === 0 ? sql`` : sql`WHERE ${sql.join(filters, sql` AND `)}`;
  const rows = rowsFromResult(
    await db.execute<PublicActionRow>(
      sql`
        SELECT
          qa.id,
          qa.chain_id AS "chainId",
          qa.boardroom,
          qa.action_hash AS "actionHash",
          qa.queue_tx_hash AS "queueTxHash",
          qa.queue_block AS "queueBlock",
          qa.status,
          qa.decode_status AS "decodeStatus",
          qa.eta,
          b.name AS "boardroomName",
          b.share_token AS "boardroomShareToken",
          b.status AS "boardroomStatus",
          r.ruleset_version AS "riskRulesetVersion",
          r.severity AS "riskSeverity",
          r.findings AS "riskFindings",
          r.evaluated_at AS "riskEvaluatedAt",
          a.harness AS "analysisHarness",
          a.model AS "analysisModel",
          a.summary AS "analysisSummary",
          a.effects AS "analysisEffects",
          a.affected_parties AS "analysisAffectedParties",
          a.severity_rationale AS "analysisSeverityRationale",
          a.source AS "analysisSource"
        FROM queued_actions qa
        JOIN boardrooms b
          ON b.chain_id = qa.chain_id
         AND lower(b.address) = lower(qa.boardroom)
        LEFT JOIN risk_assessments r
          ON r.action_id = qa.id
        LEFT JOIN analyses a
          ON a.action_id = qa.id
        ${where}
        ORDER BY qa.queue_block DESC, qa.created_at DESC, qa.id ASC
        LIMIT ${limit + 1}
        OFFSET ${offset}
      `
    )
  );
  const pageRows = rows.slice(0, limit);
  const callsByAction = await loadCalls(db, pageRows.map((row) => row.id));

  return {
    items: pageRows.map((row) => toPublicActionDto(row, callsByAction.get(row.id) ?? [])),
    page: {
      limit,
      nextCursor: rows.length > limit ? String(offset + limit) : null
    }
  };
}

async function loadCalls(
  db: SentinelDb,
  actionIds: readonly string[]
): Promise<Map<string, PublicActionCallRow[]>> {
  if (actionIds.length === 0) {
    return new Map();
  }

  const ids = sql.join(
    actionIds.map((id) => sql`${id}`),
    sql`, `
  );
  const rows = rowsFromResult(
    await db.execute<PublicActionCallRow>(
      sql`
        SELECT
          action_id AS "actionId",
          call_index AS "callIndex",
          policy,
          target,
          value::text AS value,
          data,
          selector,
          decoded_function AS "decodedFunction",
          decoded_args AS "decodedArgs"
        FROM action_calls
        WHERE action_id IN (${ids})
        ORDER BY action_id ASC, call_index ASC
      `
    )
  );
  const byAction = new Map<string, PublicActionCallRow[]>();
  for (const row of rows) {
    byAction.set(row.actionId, [...(byAction.get(row.actionId) ?? []), row]);
  }

  return byAction;
}

async function listChannels(db: SentinelDb, userId: string): Promise<ChannelDto[]> {
  const rows = await db
    .select({
      enabled: channels.enabled,
      id: channels.id,
      telegramChatId: channels.telegramChatId,
      type: channels.type
    })
    .from(channels)
    .where(eq(channels.userId, userId));
  return rows.map((row) => ({
    enabled: row.enabled,
    id: row.id,
    telegramChatId: row.telegramChatId,
    type: row.type
  }));
}

async function listWallets(db: SentinelDb, userId: string): Promise<WalletDto[]> {
  const rows = await db
    .select({
      address: wallets.address,
      verifiedAt: wallets.verifiedAt
    })
    .from(wallets)
    .where(eq(wallets.userId, userId));
  return rows.map(toWalletDto);
}

async function readSubscription(db: SentinelDb, userId: string): Promise<SubscriptionDto> {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  const boardroomRows = await db
    .select({
      address: subscriptionBoardrooms.boardroom,
      chainId: subscriptionBoardrooms.chainId
    })
    .from(subscriptionBoardrooms)
    .where(eq(subscriptionBoardrooms.userId, userId));
  const boardrooms = boardroomRows.map(
    (boardroom): BoardroomRef => ({
      address: boardroom.address as AddressDto,
      chainId: boardroom.chainId
    })
  );

  return {
    boardrooms,
    minSeverity: row?.minSeverity ?? "medium",
    mode: row?.mode ?? "holdings"
  };
}

function toPublicActionDto(
  row: PublicActionRow,
  calls: readonly PublicActionCallRow[]
): PublicActionDto {
  return {
    actionHash: row.actionHash as PublicActionDto["actionHash"],
    analysis: toAnalysisDto(row),
    boardroom: {
      address: row.boardroom as AddressDto,
      name: row.boardroomName,
      shareToken: row.boardroomShareToken as AddressDto,
      status: row.boardroomStatus
    },
    calls: calls.map((call) => ({
      callIndex: call.callIndex,
      data: call.data as PublicActionDto["calls"][number]["data"],
      decodedArgs: call.decodedArgs ?? null,
      decodedFunction: call.decodedFunction,
      policy: call.policy as AddressDto,
      selector: call.selector as PublicActionDto["calls"][number]["selector"],
      target: call.target as AddressDto,
      value: call.value
    })),
    chainId: row.chainId,
    decodeStatus: row.decodeStatus,
    eta: toIso(row.eta),
    event: row.status,
    id: row.id,
    queueBlock: row.queueBlock.toString(),
    queueTxHash: row.queueTxHash as PublicActionDto["queueTxHash"],
    risk: toRiskDto(row),
    status: row.status
  };
}

function toRiskDto(row: PublicActionRow): RiskAssessmentDto | null {
  if (
    row.riskRulesetVersion === null ||
    row.riskSeverity === null ||
    row.riskEvaluatedAt === null
  ) {
    return null;
  }

  return {
    evaluatedAt: toIso(row.riskEvaluatedAt),
    findings: jsonArray(row.riskFindings) as RiskAssessmentDto["findings"],
    rulesetVersion: row.riskRulesetVersion,
    severity: row.riskSeverity
  };
}

function toAnalysisDto(row: PublicActionRow): AnalysisDto | null {
  if (
    row.analysisHarness === null ||
    row.analysisSummary === null ||
    row.analysisSeverityRationale === null ||
    row.analysisSource === null
  ) {
    return null;
  }

  return {
    affectedParties: stringArray(row.analysisAffectedParties),
    effects: stringArray(row.analysisEffects),
    harness: row.analysisHarness,
    model: row.analysisModel,
    severityRationale: row.analysisSeverityRationale,
    source: row.analysisSource,
    summary: row.analysisSummary
  };
}

function toUserDto(row: typeof users.$inferSelect): UserDto {
  return {
    email: row.email,
    id: row.id,
    workosUserId: row.workosUserId
  };
}

function toWalletDto(row: { readonly address: string; readonly verifiedAt: Date }): WalletDto {
  return {
    address: row.address as AddressDto,
    verifiedAt: row.verifiedAt.toISOString()
  };
}

function cursorToOffset(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }

  const parsed = Number.parseInt(cursor, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function stringArray(value: unknown): string[] {
  return jsonArray(value).filter((item): item is string => typeof item === "string");
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function rowsFromResult<T>(result: QueryResult<T>): readonly T[] {
  if (Array.isArray(result)) {
    return result;
  }

  return (result as { readonly rows: readonly T[] }).rows;
}

function stringValue(value: bigint | undefined): string | undefined {
  return value === undefined ? undefined : value.toString();
}

function withoutUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export type { TelegramLinkCodeRecord, WalletNonceRecord };
