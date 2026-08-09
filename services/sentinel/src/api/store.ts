import { eq, sql } from "drizzle-orm";
import { getAddress } from "viem";

import type { SentinelDb } from "../db/client";
import {
  authAccounts,
  wallets
} from "../db/schema";
import type { SentinelApiStore } from "./auth";
import {
  AuthProviderSchema,
  type AddressDto,
  type AuthProviderDto,
  type WalletDto
} from "./dto";
import { takeIdentityQuota } from "./identity-quota";

export function createDrizzleApiStore(db: SentinelDb): SentinelApiStore {
  return {
    async getAuthSnapshot(userId) {
      const [providers, linkedWallets] = await Promise.all([
        listAuthProviders(db, userId),
        listWallets(db, userId)
      ]);
      return { providers, wallets: linkedWallets };
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
