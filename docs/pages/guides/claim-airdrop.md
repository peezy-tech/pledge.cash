---
title: Claim an airdrop
description: Validate a Merkle allocation and claim project shares immediately or as an exact vesting grant.
---

# Claim an airdrop

A pledge.cash Merkle airdrop does not discover your allocation from an email or wallet address alone. You need the exact manifest data published by the project: claim mode, index, account, amount, proof, and—when applicable—every grant term.

## Prerequisites

- The canonical project and airdrop contract on the selected network.
- A trusted allocation manifest or entry containing the exact index, account, token amount, and proof.
- The declared mode: **Receive now** or **Vested grant**.
- For grant mode: payment token, price, expiry, cliff, vesting end, transferability, transfer unlock time, and salt.
- For the shipped app, the allocated browser-injected wallet connected to the correct network, plus native gas token.

The app does not host or infer the project's Merkle manifest. Obtain it from the project and authenticate that publication separately.

## 1. Verify the airdrop

1. [Open Explore](../../explore), select the canonical project, and open **Participate**.
2. Select the exact airdrop address. Do not choose by label alone.
3. In **Participate**, verify the exact airdrop address, remaining inventory, status, and grant-claim slot usage.
4. The current Participate view does not display the raw Boardroom, share-token, `merkleRoot`, `startTime`, or `endTime` fields. Read those public fields directly from the airdrop contract and compare them with the authenticated manifest.
5. Confirm the Boardroom is Active. Claims stop during wind-down even if the published end time has not arrived.
6. Confirm your manifest identifies the same chain id, airdrop address, Boardroom, and share token.

If a required read is **Unknown**, stop. Unknown remaining inventory or status is not a zero balance and not proof that a claim is unavailable.

## 2. Understand the two claim modes

### Receive now

A direct leaf transfers the proven project-share amount to its bound account. The leaf commits to:

- chain id;
- claim index;
- airdrop, Boardroom, and share-token addresses;
- account and amount.

### Vested grant

A grant leaf creates an escrow-backed Boardroom grant instead of transferring immediately. It commits to all direct identity fields, the TokenGrantFactory, and a hash of every grant term.

Grant claims consume a bounded reserved grant slot. They use the distribution-only zero-creation-fee path, so a later factory fee change cannot censor a committed claim. A paid vesting grant can still require payment when vested tokens are later settled.

The modes are not interchangeable. A direct proof cannot create a grant, and changing one grant timestamp, price, token, flag, or salt invalidates a grant proof.

## 3. Enter allocation data

1. Select **Receive now** or **Vested grant** exactly as published.
2. Enter the allocation index and human-readable project-token amount.
3. Paste the proof as a JSON array or one `bytes32` node per line.
4. For grant mode, enter every term exactly. Use Unix timestamps and the zero address only where the published free-grant terms require it.
5. Wait for the app to check whether the index is already claimed.
6. Compare the displayed parsed amount, proof-node count, remaining shares, and grant-slot usage with the manifest.

An empty proof is valid only when the allocation is the root's single leaf. Do not remove nodes to make a proof fit.

## 4. Review and claim

1. Connect the allocated wallet. The shipped app binds the leaf account to the connected account, although the contract itself permits a relayer to submit the same proof for that account.
2. Select **Claim project tokens** or **Create vested grant**.
3. Review airdrop address, function, index, account, raw amount, proof, and grant terms.
4. Confirm simulation succeeds, then compare the wallet request and sign.
5. Keep the canonical receipt hash through any wallet repricing or replacement.

## Wallet and transaction expectations

There is no token approval for an airdrop claim. The airdrop already escrows the project shares. A grant claim is nonpayable and does not charge the ordinary factory creation fee.

A confirmed receipt may appear before the project workspace refreshes. Do not retry while the Transaction Center says **refreshing workspace data**. A cancellation or different replacement means the reviewed claim did not execute.

## Success proof

For either mode:

- the canonical receipt succeeded on the intended chain;
- the exact index is marked claimed;
- `claimedShares` increased and `remainingShares` decreased by the allocation;
- the claim event binds the expected account and amount.

For direct mode, verify the account received the exact shares. For grant mode, verify the emitted grant address, factory provenance, holder, escrow amount, schedule, payment terms, and Boardroom obligation record.

## Recovery

- **Invalid proof:** compare chain, predicted airdrop address, index, account, raw amount, leaf type, and all grant terms. Formatting is not the only possible mismatch.
- **Already claimed:** inspect the earlier claim event and recipient or grant; an index is one-time even if the manifest duplicated it.
- **Outside the claim window:** ask the project whether it will publish a new distribution. Existing proof terms cannot extend the contract.
- **Grant cap reached:** a valid grant leaf cannot fall back to direct mode. The modes have different leaf hashes.
- **Insufficient remaining inventory:** the published root or allocation set may be malformed; stop and ask the project to reconcile it.
- **Project is winding down:** claims are closed. Unclaimed inventory returns through airdrop close or cancellation.
- **Receipt confirmed but UI still says unused:** refresh only after confirming the app is on the matching chain and deployment; inspect `isClaimed(index)` directly.

## Next steps

- For a grant claim, follow [Receive and settle a grant](receive-and-settle-grant).
- Track the new holding or grant in [Portfolio](../../portfolio).
- Project operators should publish a reproducible manifest alongside the root; see [Distribution and airdrop integration](../developers/distributions-and-airdrops).
