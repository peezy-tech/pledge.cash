import { describe, expect, test } from "bun:test";
import { concatHex, keccak256, type Address, type Hex } from "viem";
import {
  AIRDROP_CLAIM_TICKET_SCHEMA,
  claimTicketFromSearch,
  parseAirdropClaimTicket,
  verifyAirdropClaimTicket,
} from "../src/features/participation/airdrop-claim-ticket";

const airdrop = "0x0000000000000000000000000000000000000010" as Address;
const account = "0x0000000000000000000000000000000000000020" as Address;
const leaf = keccak256("0x01");
const sibling = keccak256("0x02");
const root = keccak256(BigInt(leaf) <= BigInt(sibling) ? concatHex([leaf, sibling]) : concatHex([sibling, leaf]));
const expectedFacetSetHash = `0x${"44".repeat(32)}` as Hex;

describe("airdrop claim tickets", () => {
  test("parses JSON and verifies the sorted Merkle proof", () => {
    const ticket = parseAirdropClaimTicket(JSON.stringify({
      schema: AIRDROP_CLAIM_TICKET_SCHEMA,
      chainId: 31337,
      airdrop,
      account,
      expectedFacetSetHash,
      mode: "direct",
      index: "7",
      amount: "1000000000000000000",
      proof: [sibling],
    }));
    expect(ticket.index).toBe(7n);
    expect(ticket.amount).toBe(1_000_000_000_000_000_000n);
    expect(verifyAirdropClaimTicket(ticket, leaf, root)).toBe(true);
    expect(verifyAirdropClaimTicket(ticket, leaf, keccak256("0x03"))).toBe(false);
  });

  test("accepts base64url link payloads and extracts them from search", () => {
    const raw = JSON.stringify({
      schema: AIRDROP_CLAIM_TICKET_SCHEMA,
      chainId: 31337,
      airdrop,
      account,
      expectedFacetSetHash,
      mode: "direct",
      index: "0",
      amount: "1",
      proof: [],
    });
    const encoded = btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(claimTicketFromSearch(`?route=airdrop&claim=${encoded}`)).toBe(encoded);
    expect(parseAirdropClaimTicket(encoded).account).toBe(account);
  });

  test("rejects malformed, unbound, and incomplete tickets", () => {
    expect(() => parseAirdropClaimTicket("{}"))
      .toThrow("not a supported pledge.cash claim ticket");
    expect(() => parseAirdropClaimTicket(JSON.stringify({
      schema: AIRDROP_CLAIM_TICKET_SCHEMA,
      chainId: 31337,
      airdrop,
      account,
      expectedFacetSetHash,
      mode: "grant",
      index: "1",
      amount: "1",
      proof: ["0x12" as Hex],
    }))).toThrow("proof must contain only bytes32 nodes");
  });
});
