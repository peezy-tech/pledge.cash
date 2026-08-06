import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getAddress } from "viem";

import type { SentinelDb } from "../db/client";
import {
  authAccounts,
  authWallets,
  walletLinkNonces,
  walletOwners,
  wallets
} from "../db/schema";
import type { SentinelApiStore, WalletNonceRecord } from "./auth";
import {
  AuthProviderSchema,
  type AddressDto,
  type AuthProviderDto,
  type WalletDto
} from "./dto";
import { takeIdentityQuota } from "./identity-quota";

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
    async createWalletNonce(input) {
      const [row] = await db.insert(walletLinkNonces).values(input).returning();
      return row ?? { ...input, usedAt: null };
    },
    async getAuthSnapshot(userId) {
      const [providers, linkedWallets] = await Promise.all([
        listAuthProviders(db, userId),
        listWallets(db, userId)
      ]);
      return { providers, wallets: linkedWallets };
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
      return db.transaction(async (transaction) => {
        const checksumAddress = getAddress(input.address);
        await transaction.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(lower(${checksumAddress})))`
        );

        await transaction
          .insert(walletOwners)
          .values({ address: checksumAddress.toLowerCase(), userId: input.userId })
          .onConflictDoNothing();

        const [owner] = await transaction
          .select({ userId: walletOwners.userId })
          .from(walletOwners)
          .where(eq(walletOwners.address, checksumAddress.toLowerCase()))
          .for("update")
          .limit(1);
        if (owner !== undefined && owner.userId !== input.userId) {
          return null;
        }

        await transaction
          .insert(authWallets)
          .values({
            address: checksumAddress,
            chainId: input.chainId,
            isPrimary: false,
            userId: input.userId
          })
          .onConflictDoNothing();

        const [credential] = await transaction
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

        const [row] = await transaction
          .update(wallets)
          .set({
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

        return row === undefined ? null : toWalletDto(row);
      });
    },
    async ping() {
      await db.execute(sql`SELECT 1`);
    },
    async takeIdentityQuota(input) {
      return takeIdentityQuota(db, input);
    }
  };
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
      address: wallets.address,
      verifiedAt: wallets.verifiedAt
    })
    .from(wallets)
    .where(eq(wallets.userId, userId));

  const byAddress = new Map<string, WalletDto>();
  for (const row of rows) {
    const wallet = toWalletDto(row);
    const existing = byAddress.get(wallet.address);
    if (existing === undefined) {
      byAddress.set(wallet.address, wallet);
      continue;
    }
    byAddress.set(wallet.address, {
      address: existing.address,
      canSignIn: existing.canSignIn || wallet.canSignIn,
      verifiedAt:
        Date.parse(existing.verifiedAt) >= Date.parse(wallet.verifiedAt)
          ? existing.verifiedAt
          : wallet.verifiedAt
    });
  }

  return [...byAddress.values()].sort((left, right) => left.address.localeCompare(right.address));
}

function toWalletDto(row: {
  readonly address: string;
  readonly verifiedAt: Date;
}): WalletDto {
  return {
    address: getAddress(row.address).toLowerCase() as AddressDto,
    canSignIn: true,
    verifiedAt: row.verifiedAt.toISOString()
  };
}

export type { WalletNonceRecord };
