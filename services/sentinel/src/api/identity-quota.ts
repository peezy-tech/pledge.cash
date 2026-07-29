import { and, count, eq, lte, sql } from "drizzle-orm";

import type { SentinelDb } from "../db/client";
import { identityQuotaEvents } from "../db/schema";

export type IdentityQuotaKind =
  | "presentation-read"
  | "wallet-proof-public"
  | "wallet-grant-link"
  | "wallet-grant-public";

export type IdentityQuotaInput = {
  readonly capacity: number;
  readonly now: Date;
  readonly scope: string;
  readonly windowMs: number;
};

export function identityQuotaScope(
  clientId: string,
  kind: IdentityQuotaKind
): string {
  return `${clientId}:${kind}`;
}

export async function takeIdentityQuota(
  db: SentinelDb,
  input: IdentityQuotaInput
): Promise<boolean> {
  if (!Number.isSafeInteger(input.capacity) || input.capacity <= 0) {
    throw new Error("Identity quota capacity must be a positive safe integer");
  }
  if (!Number.isSafeInteger(input.windowMs) || input.windowMs <= 0) {
    throw new Error("Identity quota window must be a positive safe integer");
  }

  const windowStart = new Date(input.now.getTime() - input.windowMs);
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`identity-quota:${input.scope}`}))`
    );
    await transaction
      .delete(identityQuotaEvents)
      .where(
        and(
          eq(identityQuotaEvents.scope, input.scope),
          lte(identityQuotaEvents.consumedAt, windowStart)
        )
      );
    const [usage] = await transaction
      .select({ value: count() })
      .from(identityQuotaEvents)
      .where(eq(identityQuotaEvents.scope, input.scope));
    if ((usage?.value ?? 0) >= input.capacity) return false;

    await transaction.insert(identityQuotaEvents).values({
      consumedAt: input.now,
      scope: input.scope
    });
    return true;
  });
}
