import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { verifyMessage, type Address, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";

import type { Config } from "../config";
import type { SentinelDb } from "../db/client";
import * as schema from "../db/schema";
import type { SiweSignatureVerifier } from "./auth";

export const PRODUCT_SIWE_STATEMENT = "Sign in to pledge.cash.";
export const WALLET_LINK_SIWE_STATEMENT = "Link this wallet to pledge.cash.";
const INTERNAL_AUTH_HEADER_ALLOWLIST = ["cookie", "origin", "user-agent"] as const;
const SIWE_MAX_AGE_MS = 15 * 60 * 1_000;
const SIWE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export function internalAuthHeaders(source: Headers, clientIp?: string): Headers {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const name of INTERNAL_AUTH_HEADER_ALLOWLIST) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  const resolvedClientIp = clientIp?.trim();
  if (resolvedClientIp) {
    headers.set("X-Forwarded-For", resolvedClientIp);
  }
  return headers;
}

export function createSentinelAuthDatabaseAdapter(db: SentinelDb) {
  const createAdapter = drizzleAdapter(db, {
    provider: "pg",
    schema
  });

  return (...args: Parameters<typeof createAdapter>) => {
    const adapter = createAdapter(...args);

    return {
      ...adapter,
      findOne: async (...findOneArgs: Parameters<typeof adapter.findOne>) => {
        const [input] = findOneArgs;
        // Better Auth checksum-normalizes SIWE input, while a pre-existing credential
        // may have been stored in another valid casing. Ownership is case-insensitive.
        return adapter.findOne({
          ...input,
          ...(input.model === "walletAddress" && input.where !== undefined
            ? {
                where: input.where.map((condition) =>
                  condition.field === "address"
                    ? { ...condition, mode: "insensitive" }
                    : condition
                )
              }
            : {})
        });
      }
    };
  };
}

export function createPledgeCashSiweVerifier(
  config: Pick<Config, "webOrigin">,
  allowedStatements: readonly string[] = [
    PRODUCT_SIWE_STATEMENT,
    WALLET_LINK_SIWE_STATEMENT
  ]
): SiweSignatureVerifier {
  const expectedOrigin = new URL(config.webOrigin).origin;
  const expectedDomain = new URL(config.webOrigin).host;

  return async ({ address, chainId, message, signature }) => {
    let parsed: ReturnType<typeof parseSiweMessage>;
    try {
      parsed = parseSiweMessage(message);
    } catch {
      return false;
    }

    if (
      parsed.address === undefined ||
      parsed.address.toLowerCase() !== address.toLowerCase() ||
      parsed.chainId !== chainId ||
      parsed.domain !== expectedDomain ||
      !allowedStatements.includes(parsed.statement ?? "") ||
      parsed.uri === undefined ||
      parsed.version !== "1" ||
      parsed.issuedAt === undefined ||
      parsed.expirationTime === undefined
    ) {
      return false;
    }

    let uriOrigin: string;
    try {
      uriOrigin = new URL(parsed.uri).origin;
    } catch {
      return false;
    }

    if (uriOrigin !== expectedOrigin) {
      return false;
    }

    const now = Date.now();
    const issuedAt = parsed.issuedAt.getTime();
    const expiresAt = parsed.expirationTime.getTime();
    if (
      issuedAt > now + SIWE_CLOCK_SKEW_MS ||
      now - issuedAt > SIWE_MAX_AGE_MS ||
      expiresAt <= now ||
      expiresAt - issuedAt > SIWE_MAX_AGE_MS
    ) {
      return false;
    }

    // Identity v0.1 and this rolling compatibility route accept standard EOA
    // signatures. Wallet ownership is reconciled separately against product state.
    return verifyMessage({
      address: address as Address,
      message,
      signature: signature as Hex
    });
  };
}
