import {
  getAddress,
  isAddress,
  isHex,
  keccak256,
  concatHex,
  type Address,
  type Hex,
} from "viem";
import type { MerkleAirdropGrantClaimTerms } from "@pledge.cash/sdk";

/**
 * Tickets are not release-bound. Airdrop leaves commit to allocation identity only, so a
 * facet-set activation no longer voids a published manifest; the claim transaction binds the
 * live release hash read at claim time.
 */
export const AIRDROP_CLAIM_TICKET_SCHEMA = "pledge.cash/airdrop-claim@3" as const;

export type AirdropClaimTicket = {
  schema: typeof AIRDROP_CLAIM_TICKET_SCHEMA;
  chainId: number;
  airdrop: Address;
  account: Address;
  mode: "direct" | "grant";
  index: bigint;
  amount: bigint;
  proof: Hex[];
  grantTerms?: MerkleAirdropGrantClaimTerms | undefined;
};

export function claimTicketFromSearch(search: string): string | undefined {
  try {
    return new URLSearchParams(search).get("claim") ?? undefined;
  } catch {
    return undefined;
  }
}

export function parseAirdropClaimTicket(value: string): AirdropClaimTicket {
  const raw = decodeTicket(value.trim());
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed.schema !== AIRDROP_CLAIM_TICKET_SCHEMA) throw new Error("This is not a supported pledge.cash claim ticket.");
  const chainId = parseSafeNumber(parsed.chainId, "Claim ticket chain ID");
  const airdrop = parseAddress(parsed.airdrop, "Claim ticket airdrop");
  const account = parseAddress(parsed.account, "Claim ticket account");
  const mode = parsed.mode;
  if (mode !== "direct" && mode !== "grant") throw new Error("Claim ticket mode must be direct or grant.");
  const index = parseBigint(parsed.index, "Claim ticket index");
  const amount = parseBigint(parsed.amount, "Claim ticket amount");
  if (amount <= 0n) throw new Error("Claim ticket amount must be greater than zero.");
  if (!Array.isArray(parsed.proof) || !parsed.proof.every(isBytes32)) {
    throw new Error("Claim ticket proof must contain only bytes32 nodes.");
  }
  const grantTerms = mode === "grant" ? parseGrantTerms(parsed.grantTerms) : undefined;
  return {
    schema: AIRDROP_CLAIM_TICKET_SCHEMA,
    chainId,
    airdrop,
    account,
    mode,
    index,
    amount,
    proof: [...parsed.proof] as Hex[],
    ...(grantTerms ? { grantTerms } : {}),
  };
}

export function verifyAirdropClaimTicket(ticket: AirdropClaimTicket, leaf: Hex, merkleRoot: Hex): boolean {
  if (!isBytes32(leaf) || !isBytes32(merkleRoot)) return false;
  const result = ticket.proof.reduce((hash, node) => {
    const pair = BigInt(hash) <= BigInt(node) ? [hash, node] as const : [node, hash] as const;
    return keccak256(concatHex(pair));
  }, leaf);
  return result.toLowerCase() === merkleRoot.toLowerCase();
}

function decodeTicket(value: string): string {
  if (!value) throw new Error("Paste a claim ticket first.");
  if (value.startsWith("{")) return value;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - normalized.length % 4) % 4);
    return atob(`${normalized}${padding}`);
  } catch {
    throw new Error("Claim ticket must be JSON or base64url-encoded JSON.");
  }
}

function parseSafeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} is invalid.`);
  return value;
}

function parseBigint(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`${label} must be an unsigned integer string.`);
  return BigInt(value);
}

function parseAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`${label} is invalid.`);
  return getAddress(value);
}

function parseGrantTerms(value: unknown): MerkleAirdropGrantClaimTerms {
  if (!value || typeof value !== "object") throw new Error("A grant claim ticket must include exact grant terms.");
  const terms = value as Record<string, unknown>;
  const salt = terms.salt;
  if (!isBytes32(salt)) throw new Error("Claim ticket grant salt is invalid.");
  if (typeof terms.transferable !== "boolean") throw new Error("Claim ticket grant transferability is invalid.");
  return {
    paymentToken: parseAddress(terms.paymentToken, "Claim ticket payment token"),
    price: parseBigint(terms.price, "Claim ticket grant price"),
    expiry: parseBigint(terms.expiry, "Claim ticket grant expiry"),
    vestingCliff: parseBigint(terms.vestingCliff, "Claim ticket vesting cliff"),
    vestingEnd: parseBigint(terms.vestingEnd, "Claim ticket vesting end"),
    transferable: terms.transferable,
    transferUnlockTime: parseBigint(terms.transferUnlockTime, "Claim ticket transfer unlock time"),
    salt,
  };
}

function isBytes32(value: unknown): value is Hex {
  return typeof value === "string" && value.length === 66 && isHex(value);
}
