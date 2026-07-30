import {
  encodeAbiParameters,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { merkleAirdropAbi } from "../generated";
import type { MerkleAirdropGrantClaimTerms } from "./types";

const DIRECT_CLAIM_TYPEHASH = keccak256(stringToHex(
  "MerkleAirdropDirectClaim(uint256 chainId,uint256 index,address airdrop,address boardroom,address shareToken,address account,uint256 amount)",
));
const GRANT_CLAIM_TYPEHASH = keccak256(stringToHex(
  "MerkleAirdropGrantClaim(uint256 chainId,uint256 index,address airdrop,address boardroom,address shareToken,address tokenGrantFactory,address account,uint256 amount,bytes32 termsHash)",
));
const GRANT_TERMS_TYPEHASH = keccak256(stringToHex(
  "MerkleAirdropGrantTerms(address paymentToken,uint256 price,uint256 expiry,uint256 vestingCliff,uint256 vestingEnd,bool transferable,uint256 transferUnlockTime,bytes32 salt)",
));

function requireBytes32(name: string, value: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte hex value.`);
  }
  return value;
}

export function buildMerkleAirdropClaimTransaction(input: {
  airdrop: Address;
  expectedFacetSetHash: Hex;
  index: bigint;
  account: Address;
  amount: bigint;
  proof: readonly Hex[];
}) {
  return {
    address: input.airdrop,
    abi: merkleAirdropAbi,
    functionName: "claim",
    args: [
      requireBytes32("expectedFacetSetHash", input.expectedFacetSetHash),
      input.index,
      input.account,
      input.amount,
      input.proof,
    ] as const,
  } as const;
}

export function buildMerkleAirdropGrantClaimTransaction(input: {
  airdrop: Address;
  expectedFacetSetHash: Hex;
  index: bigint;
  account: Address;
  amount: bigint;
  terms: MerkleAirdropGrantClaimTerms;
  proof: readonly Hex[];
}) {
  return {
    address: input.airdrop,
    abi: merkleAirdropAbi,
    functionName: "claimGrant",
    args: [
      requireBytes32("expectedFacetSetHash", input.expectedFacetSetHash),
      input.index,
      input.account,
      input.amount,
      input.terms,
      input.proof,
    ] as const,
  } as const;
}

export function hashMerkleAirdropGrantTerms(terms: MerkleAirdropGrantClaimTerms): Hex {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bool" },
      { type: "uint256" },
      { type: "bytes32" },
    ],
    [
      GRANT_TERMS_TYPEHASH,
      terms.paymentToken,
      terms.price,
      terms.expiry,
      terms.vestingCliff,
      terms.vestingEnd,
      terms.transferable,
      terms.transferUnlockTime,
      requireBytes32("terms.salt", terms.salt),
    ],
  ));
}

/**
 * Leaves are not release-bound: the immutable root would otherwise be voided protocol-wide by any
 * facet-set activation. The release is bound per transaction, by the `expectedFacetSetHash`
 * argument of `claim`/`claimGrant`.
 */
export function buildMerkleAirdropDirectClaimLeaf(input: {
  chainId: bigint;
  index: bigint;
  airdrop: Address;
  boardroom: Address;
  shareToken: Address;
  account: Address;
  amount: bigint;
}): Hex {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
    ],
    [
      DIRECT_CLAIM_TYPEHASH,
      input.chainId,
      input.index,
      input.airdrop,
      input.boardroom,
      input.shareToken,
      input.account,
      input.amount,
    ],
  ));
}

/** See {@link buildMerkleAirdropDirectClaimLeaf} for why the leaf is not release-bound. */
export function buildMerkleAirdropGrantClaimLeaf(input: {
  chainId: bigint;
  index: bigint;
  airdrop: Address;
  boardroom: Address;
  shareToken: Address;
  tokenGrantFactory: Address;
  account: Address;
  amount: bigint;
  terms: MerkleAirdropGrantClaimTerms;
}): Hex {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "bytes32" },
    ],
    [
      GRANT_CLAIM_TYPEHASH,
      input.chainId,
      input.index,
      input.airdrop,
      input.boardroom,
      input.shareToken,
      input.tokenGrantFactory,
      input.account,
      input.amount,
      hashMerkleAirdropGrantTerms(input.terms),
    ],
  ));
}

export function hashSortedMerklePair(left: Hex, right: Hex): Hex {
  const a = requireBytes32("left", left);
  const b = requireBytes32("right", right);
  return keccak256(BigInt(a) < BigInt(b) ? `${a}${b.slice(2)}` as Hex : `${b}${a.slice(2)}` as Hex);
}
