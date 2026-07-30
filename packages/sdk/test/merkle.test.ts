import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "viem";
import {
  buildMerkleAirdropClaimTransaction,
  buildMerkleAirdropDirectClaimLeaf,
  buildMerkleAirdropGrantClaimLeaf,
  buildMerkleAirdropGrantClaimTransaction,
  hashMerkleAirdropGrantTerms,
  hashSortedMerklePair,
  merkleAirdropAbi,
  type MerkleAirdropGrantClaimTerms,
} from "../src";

const airdrop = "0x1111111111111111111111111111111111111111" as Address;
const boardroom = "0x2222222222222222222222222222222222222222" as Address;
const shareToken = "0x3333333333333333333333333333333333333333" as Address;
const tokenGrantFactory = "0x4444444444444444444444444444444444444444" as Address;
const account = "0x5555555555555555555555555555555555555555" as Address;
const paymentToken = "0x6666666666666666666666666666666666666666" as Address;
const releaseA = `0x${"aa".repeat(32)}` as Hex;
const releaseB = `0x${"bb".repeat(32)}` as Hex;
const proof = [`0x${"cc".repeat(32)}` as Hex] as const;
const terms = {
  paymentToken,
  price: 2n,
  expiry: 100n,
  vestingCliff: 10n,
  vestingEnd: 90n,
  transferable: false,
  transferUnlockTime: 0n,
  salt: `0x${"dd".repeat(32)}` as Hex,
} satisfies MerkleAirdropGrantClaimTerms;

describe("Merkle release binding", () => {
  test("builds explicit-hash direct and grant claim transactions", () => {
    expect(buildMerkleAirdropClaimTransaction({
      airdrop,
      expectedFacetSetHash: releaseA,
      index: 1n,
      account,
      amount: 25n,
      proof,
    })).toMatchObject({
      address: airdrop,
      abi: merkleAirdropAbi,
      functionName: "claim",
      args: [releaseA, 1n, account, 25n, proof],
    });

    expect(buildMerkleAirdropGrantClaimTransaction({
      airdrop,
      expectedFacetSetHash: releaseB,
      index: 2n,
      account,
      amount: 40n,
      terms,
      proof,
    })).toMatchObject({
      address: airdrop,
      abi: merkleAirdropAbi,
      functionName: "claimGrant",
      args: [releaseB, 2n, account, 40n, terms, proof],
    });
  });

  test("binds leaves to allocation identity only, so releases cannot void a published root", () => {
    const directInput = {
      chainId: 31337n,
      index: 1n,
      airdrop,
      boardroom,
      shareToken,
      account,
      amount: 25n,
    };
    const direct = buildMerkleAirdropDirectClaimLeaf(directInput);
    expect(direct).toBe(buildMerkleAirdropDirectClaimLeaf({ ...directInput }));
    expect(direct).not.toBe(buildMerkleAirdropDirectClaimLeaf({ ...directInput, amount: 26n }));
    expect(direct).not.toBe(buildMerkleAirdropDirectClaimLeaf({ ...directInput, chainId: 31338n }));

    const grantInput = {
      chainId: 31337n,
      index: 2n,
      airdrop,
      boardroom,
      shareToken,
      tokenGrantFactory,
      account,
      amount: 40n,
      terms,
    };
    const grant = buildMerkleAirdropGrantClaimLeaf(grantInput);
    expect(grant).toBe(buildMerkleAirdropGrantClaimLeaf({ ...grantInput }));
    expect(grant).not.toBe(buildMerkleAirdropGrantClaimLeaf({ ...grantInput, index: 3n }));
    expect(grant).not.toBe(direct);
    expect(hashMerkleAirdropGrantTerms(terms)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashSortedMerklePair(direct, grant)).toBe(hashSortedMerklePair(grant, direct));
  });

  test("rejects implicit or malformed release hashes", () => {
    expect(() => buildMerkleAirdropClaimTransaction({
      airdrop,
      expectedFacetSetHash: "0x1234",
      index: 0n,
      account,
      amount: 1n,
      proof: [],
    })).toThrow("expectedFacetSetHash must be a 32-byte hex value.");
  });
});
