---
title: Receive A Grant
description: A contributor flow for inspecting, accepting, and settling token grants.
---

# Receive A Grant

This flow is for advisors, contractors, contributors, and anyone receiving a token grant.

## 1. Get The Grant Address

Ask the issuer for the grant address and chain. Inspect it directly in the app before assuming you have a claim.

## 2. Verify The Parties

Check:

- issuer,
- current holder,
- grant token,
- payment token,
- Boardroom if the grant was Boardroom-issued.

If the holder is not your wallet, you may not be able to settle the grant.

## 3. Read The Schedule

Inspect:

- grant size,
- claimable amount,
- already settled amount,
- vesting cliff,
- vesting end,
- expiry,
- halted state,
- closed state.

Make sure the schedule matches your agreement with the project.

## 4. Check Payment Terms

If the grant is paid, settlement requires a payment token. You may need to approve payment before settling. If the grant is free, there is no payment token and no price.

## 5. Check Transferability

If you need to move the grant right to another wallet, confirm whether the holder-right NFT is transferable and whether the transfer unlock time has passed.

## 6. Settle Vested Tokens

When tokens are vested and settleable, use the app or contract to settle. After settlement, verify the grant state and token balance.

## 7. Do Not Miss Expiry

Expiry is the last time settlement is allowed. If you wait too long, remaining grant tokens may no longer be settleable.
