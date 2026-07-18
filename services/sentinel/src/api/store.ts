import { Buffer } from "node:buffer";

import { and, eq, gt, isNull, sql, type SQL } from "drizzle-orm";
import { getAddress } from "viem";

import type { SentinelDb } from "../db/client";
import {
  authAccounts,
  authWallets,
  channels,
  subscriptionBoardrooms,
  subscriptions,
  telegramLinkCodes,
  walletLinkNonces,
  walletOwners,
  wallets
} from "../db/schema";
import {
  AuthProviderSchema,
  type AddressDto,
  type AnalysisDto,
  type AuthProviderDto,
  type BoardroomRef,
  type ChannelDto,
  type HealthResponse,
  type NotificationDeliveriesQuery,
  type NotificationDeliveriesResponse,
  type NotificationDeliveryDto,
  type PublicActionDto,
  type PublicActionsQuery,
  type PublicActionsResponse,
  type RiskAssessmentDto,
  type SubscriptionDto,
  type WalletDto
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
  readonly epoch: bigint | string | null;
  readonly eta: Date | string;
  readonly expiresAt: Date | string | null;
  readonly id: string;
  readonly invalidatedByEpoch: bigint | string | null;
  readonly queueBlock: bigint | string;
  readonly queueTxHash: string;
  readonly riskEvaluatedAt: Date | string | null;
  readonly riskFindings: unknown;
  readonly riskRulesetVersion: number | null;
  readonly riskSeverity: "low" | "medium" | "high" | null;
  readonly status: "queued" | "cancelled" | "executed" | "invalidated" | "expired";
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

type NotificationDeliveryRow = {
  readonly actionHash: string;
  readonly actionId: string;
  readonly actionStatus: "queued" | "cancelled" | "executed" | "invalidated";
  readonly attempts: number;
  readonly boardroom: string;
  readonly chainId: number;
  readonly channelType: "telegram" | "twitter";
  readonly createdAt: Date | string;
  readonly eta: Date | string;
  readonly event: "queued" | "cancelled" | "executed" | "invalidated" | "reminder" | "policy-admin";
  readonly expiresAt: Date | string | null;
  readonly id: string;
  readonly nextAttemptAt: Date | string;
  readonly sentAt: Date | string | null;
  readonly severity: "low" | "medium" | "high" | null;
  readonly status: "pending" | "sent" | "failed" | "dead";
  readonly summary: string | null;
  readonly updatedAt: Date | string;
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
            isNull(walletLinkNonces.usedAt),
            gt(walletLinkNonces.expiresAt, input.now)
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
      const [channels_, providers, subscription, wallets_] = await Promise.all([
        listChannels(db, userId),
        listAuthProviders(db, userId),
        readSubscription(db, userId),
        listWallets(db, userId)
      ]);
      return { channels: channels_, providers, subscription, wallets: wallets_ };
    },
    async getChannels(userId) {
      return listChannels(db, userId);
    },
    async getCursorLags(chainIds) {
      return getCursorLags(db, chainIds);
    },
    async getNotificationDeliveries(userId, query) {
      return getNotificationDeliveries(db, userId, query);
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
      return db.transaction(async (tx) => {
        const checksumAddress = getAddress(input.address);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(lower(${checksumAddress})))`);

        await tx
          .insert(walletOwners)
          .values({ address: checksumAddress.toLowerCase(), userId: input.userId })
          .onConflictDoNothing();

        const [owner] = await tx
          .select({ userId: walletOwners.userId })
          .from(walletOwners)
          .where(eq(walletOwners.address, checksumAddress.toLowerCase()))
          .for("update")
          .limit(1);
        if (owner !== undefined && owner.userId !== input.userId) {
          return null;
        }

        await tx
          .insert(authWallets)
          .values({
            address: checksumAddress,
            chainId: input.chainId,
            isPrimary: false,
            userId: input.userId
          })
          .onConflictDoNothing();

        const [credential] = await tx
          .select({ userId: authWallets.userId })
          .from(authWallets)
          .where(
            and(
              eq(authWallets.chainId, input.chainId),
              sql`lower(${authWallets.address}) = lower(${checksumAddress})`
            )
          )
          .limit(1);
        if (credential === undefined || credential.userId !== input.userId) {
          return null;
        }

        const [row] = await tx
          .update(wallets)
          .set({
            alertsEnabled: true,
            siweMessage: input.siweMessage,
            verifiedAt: input.verifiedAt
          })
          .where(
            and(
              eq(wallets.userId, input.userId),
              eq(wallets.chainId, input.chainId),
              sql`lower(${wallets.address}) = lower(${checksumAddress})`
            )
          )
          .returning();

        if (row === undefined) {
          return null;
        }

        return toWalletDto(row);
      });
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
    async setWalletAlerts(input) {
      return db.transaction(async (tx) => {
        const checksumAddress = getAddress(input.address);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(lower(${checksumAddress})))`);

        const rows = await tx
          .update(wallets)
          .set({ alertsEnabled: input.alertsEnabled })
          .where(
            and(
              eq(wallets.userId, input.userId),
              sql`lower(${wallets.address}) = lower(${checksumAddress})`
            )
          )
          .returning({
            address: wallets.address,
            alertsEnabled: wallets.alertsEnabled,
            verifiedAt: wallets.verifiedAt
          });

        const [wallet] = rows;
        if (wallet === undefined) {
          return null;
        }

        return toWalletDto(wallet);
      });
    }
  };
}

export async function getNotificationDeliveries(
  db: SentinelDb,
  userId: string,
  query: NotificationDeliveriesQuery
): Promise<NotificationDeliveriesResponse> {
  const limit = query.limit;
  const cursor = decodeNotificationDeliveriesCursor(query.cursor);
  if (query.cursor !== undefined && cursor === undefined) {
    throw new Error("Invalid notification deliveries cursor");
  }
  const cursorFilter = cursor === undefined
    ? sql``
    : sql`
        AND (
          n.created_at < ${cursor.createdAt}::timestamptz
          OR (n.created_at = ${cursor.createdAt}::timestamptz AND n.id < ${cursor.id}::uuid)
        )
      `;
  const rows = rowsFromResult(
    await db.execute<NotificationDeliveryRow>(
      sql`
        SELECT
          n.id,
          n.channel_type AS "channelType",
          n.event,
          n.status,
          n.attempts,
          n.created_at AS "createdAt",
          n.updated_at AS "updatedAt",
          n.next_attempt_at AS "nextAttemptAt",
          n.sent_at AS "sentAt",
          n.payload->'action'->>'id' AS "actionId",
          n.payload->'action'->>'actionHash' AS "actionHash",
          n.payload->'action'->>'boardroom' AS boardroom,
          (n.payload->'action'->>'chainId')::integer AS "chainId",
          n.payload->'action'->>'eta' AS eta,
          NULLIF(n.payload->'action'->>'expiresAt', '') AS "expiresAt",
          n.payload->'action'->>'status' AS "actionStatus",
          NULLIF(n.payload->'risk'->>'severity', '') AS severity,
          NULLIF(n.payload->'analysis'->>'summary', '') AS summary
        FROM notifications n
        WHERE n.user_id = ${userId}::uuid
        ${cursorFilter}
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT ${limit + 1}
      `
    )
  );
  const pageRows = rows.slice(0, limit);

  return {
    items: pageRows.map(toNotificationDeliveryDto),
    page: {
      limit,
      nextCursor:
        rows.length > limit && pageRows.length > 0
          ? encodeNotificationDeliveriesCursor(pageRows[pageRows.length - 1]!)
          : null
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

export async function getPublicActions(
  db: SentinelDb,
  query: PublicActionsQuery
): Promise<PublicActionsResponse> {
  const limit = query.limit;
  const cursor = decodePublicActionsCursor(query.cursor);
  if (query.cursor !== undefined && cursor === undefined) {
    throw new Error("Invalid public actions cursor");
  }
  const filters: SQL[] = [];

  if (cursor !== undefined) {
    filters.push(
      sql`(
        qa.queue_block < ${cursor.queueBlock}
        OR (qa.queue_block = ${cursor.queueBlock} AND qa.id < ${cursor.id}::uuid)
      )`
    );
  }

  if (query.chainId !== undefined) {
    filters.push(sql`qa.chain_id = ${query.chainId}`);
  }

  if (query.boardroom !== undefined) {
    filters.push(sql`lower(qa.boardroom) = lower(${query.boardroom})`);
  }

  if (query.status !== undefined) {
    if (query.status === "expired") {
      filters.push(sql`qa.status = 'queued' AND qa.expires_at IS NOT NULL AND qa.expires_at <= NOW()`);
    } else if (query.status === "queued") {
      filters.push(sql`qa.status = 'queued' AND (qa.expires_at IS NULL OR qa.expires_at > NOW())`);
    } else {
      filters.push(sql`qa.status = ${query.status}::sentinel_queued_action_status`);
    }
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
          CASE
            WHEN qa.status = 'queued' AND qa.expires_at IS NOT NULL AND qa.expires_at <= NOW()
              THEN 'expired'
            ELSE qa.status::text
          END AS status,
          qa.decode_status AS "decodeStatus",
          qa.epoch,
          qa.eta,
          qa.expires_at AS "expiresAt",
          qa.invalidated_by_epoch AS "invalidatedByEpoch",
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
        ORDER BY qa.queue_block DESC, qa.id DESC
        LIMIT ${limit + 1}
      `
    )
  );
  const pageRows = rows.slice(0, limit);
  const callsByAction = await loadCalls(db, pageRows.map((row) => row.id));

  return {
    items: pageRows.map((row) => toPublicActionDto(row, callsByAction.get(row.id) ?? [])),
    page: {
      limit,
      nextCursor:
        rows.length > limit && pageRows.length > 0
          ? encodePublicActionsCursor(pageRows[pageRows.length - 1]!)
          : null
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

async function listAuthProviders(db: SentinelDb, userId: string): Promise<AuthProviderDto[]> {
  const rows = await db
    .selectDistinct({ providerId: authAccounts.providerId })
    .from(authAccounts)
    .where(eq(authAccounts.userId, userId));
  const providers = rows
    .map((row) => row.providerId)
    .filter((provider): provider is AuthProviderDto => AuthProviderSchema.safeParse(provider).success);
  return [...new Set(providers)].sort((left, right) => {
    if (left === "siwe") return -1;
    if (right === "siwe") return 1;
    return left.localeCompare(right);
  });
}

async function listWallets(db: SentinelDb, userId: string): Promise<WalletDto[]> {
  const rows = await db
    .select({
      alertsEnabled: wallets.alertsEnabled,
      address: wallets.address,
      verifiedAt: wallets.verifiedAt
    })
    .from(wallets)
    .where(eq(wallets.userId, userId));

  const byAddress = new Map<string, WalletDto>();
  for (const row of rows) {
    const wallet = toWalletDto(row);
    const key = wallet.address.toLowerCase();
    const existing = byAddress.get(key);
    if (existing === undefined) {
      byAddress.set(key, wallet);
      continue;
    }

    byAddress.set(key, {
      address: existing.address,
      alertsEnabled: existing.alertsEnabled || wallet.alertsEnabled,
      canSignIn: true,
      verifiedAt:
        Date.parse(existing.verifiedAt) >= Date.parse(wallet.verifiedAt)
          ? existing.verifiedAt
          : wallet.verifiedAt
    });
  }

  return [...byAddress.values()].sort((left, right) => left.address.localeCompare(right.address));
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
    epoch: row.epoch === null ? null : row.epoch.toString(),
    eta: toIso(row.eta),
    ...(row.status === "expired" ? {} : { event: row.status }),
    expiresAt: row.expiresAt === null ? null : toIso(row.expiresAt),
    id: row.id,
    invalidatedByEpoch: row.invalidatedByEpoch === null ? null : row.invalidatedByEpoch.toString(),
    queueBlock: row.queueBlock.toString(),
    queueTxHash: row.queueTxHash as PublicActionDto["queueTxHash"],
    risk: toRiskDto(row),
    status: row.status
  };
}

function toNotificationDeliveryDto(row: NotificationDeliveryRow): NotificationDeliveryDto {
  return {
    action: {
      actionHash: row.actionHash as NotificationDeliveryDto["action"]["actionHash"],
      boardroom: row.boardroom as AddressDto,
      chainId: row.chainId,
      eta: toIso(row.eta),
      expiresAt: row.expiresAt === null ? null : toIso(row.expiresAt),
      id: row.actionId,
      status: row.actionStatus
    },
    attempts: row.attempts,
    channelType: row.channelType,
    createdAt: toIso(row.createdAt),
    event: row.event,
    id: row.id,
    nextAttemptAt: toIso(row.nextAttemptAt),
    sentAt: row.sentAt === null ? null : toIso(row.sentAt),
    severity: row.severity,
    status: row.status,
    summary: row.summary,
    updatedAt: toIso(row.updatedAt)
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

function toWalletDto(row: {
  readonly address: string;
  readonly alertsEnabled: boolean;
  readonly verifiedAt: Date;
}): WalletDto {
  return {
    address: getAddress(row.address).toLowerCase() as AddressDto,
    alertsEnabled: row.alertsEnabled,
    canSignIn: true,
    verifiedAt: row.verifiedAt.toISOString()
  };
}

type PublicActionsCursor = {
  readonly id: string;
  readonly queueBlock: bigint;
};

export function encodePublicActionsCursor(input: {
  readonly id: string;
  readonly queueBlock: bigint | string;
}): string {
  return Buffer.from(
    JSON.stringify({ id: input.id, queueBlock: input.queueBlock.toString() }),
    "utf8"
  ).toString("base64url");
}

export function decodePublicActionsCursor(
  cursor: string | undefined
): PublicActionsCursor | undefined {
  if (cursor === undefined) return undefined;

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      id?: unknown;
      queueBlock?: unknown;
    };
    if (
      typeof parsed.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        parsed.id
      ) ||
      typeof parsed.queueBlock !== "string" ||
      !/^\d+$/.test(parsed.queueBlock)
    ) {
      return undefined;
    }
    return { id: parsed.id, queueBlock: BigInt(parsed.queueBlock) };
  } catch {
    return undefined;
  }
}

export function isPublicActionsCursor(cursor: string): boolean {
  return decodePublicActionsCursor(cursor) !== undefined;
}

type NotificationDeliveriesCursor = {
  readonly createdAt: string;
  readonly id: string;
};

export function encodeNotificationDeliveriesCursor(input: {
  readonly createdAt: Date | string;
  readonly id: string;
}): string {
  return Buffer.from(
    JSON.stringify({ createdAt: toIso(input.createdAt), id: input.id }),
    "utf8"
  ).toString("base64url");
}

export function decodeNotificationDeliveriesCursor(
  cursor: string | undefined
): NotificationDeliveriesCursor | undefined {
  if (cursor === undefined) return undefined;

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    const createdAt = typeof parsed.createdAt === "string" ? new Date(parsed.createdAt) : undefined;
    if (
      typeof parsed.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        parsed.id
      ) ||
      createdAt === undefined ||
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== parsed.createdAt
    ) {
      return undefined;
    }
    return { createdAt: createdAt.toISOString(), id: parsed.id };
  } catch {
    return undefined;
  }
}

export function isNotificationDeliveriesCursor(cursor: string): boolean {
  return decodeNotificationDeliveriesCursor(cursor) !== undefined;
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
