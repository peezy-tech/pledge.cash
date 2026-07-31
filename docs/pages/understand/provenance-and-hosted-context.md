---
title: Provenance and Sentinel context
description: Separate canonical contract identity from Sentinel authentication, wallet links, subscriptions, delivery channels, and indexed public actions.
---

# Provenance and Sentinel context

pledge.cash combines permissionless contracts with optional Sentinel services. The two layers answer different questions.

## Contract provenance answers

- Was this Boardroom created by the configured BoardroomFactory?
- Does its share token point back to it?
- Was this grant created by the configured TokenGrantFactory?
- Does this distribution belong to this Boardroom?
- Do this P4LP vault, PoolKey, and PoolId match the canonical liquidity factory and Boardroom?
- What do current storage, events, balances, and receipts prove?

The selected network and deployment artifact are part of every answer. The same address text on another chain is a different identity.

## Sentinel context answers

- Which public governance actions has Sentinel indexed?
- Which wallets are linked to the signed-in Sentinel account?
- Which linked wallets are enabled for alert coverage?
- Which Boardrooms and minimum severity does a subscription watch?
- Which linked delivery channels should receive notifications?

Sentinel data can be stale, unavailable, incomplete, disputed, or wrong. It cannot mint shares, transfer treasury assets, settle grants, execute governance, mark a Merkle index claimed, or change a receipt.

Sentinel delivery receipts are account-scoped operational records. `Delivered` means a configured channel provider accepted the send; it does not prove that a person received, read, approved, vetoed, or executed the referenced action.

## Sentinel's boundary

Sentinel is an optional service for indexing public actions, linking wallets to notification preferences, and delivering alerts. It is **not settlement authority**. A Sentinel alert is a prompt to inspect canonical state; it is not proof that an action exists, is safe, succeeded, or still needs attention.

The app remains usable for core contract reads and writes without Sentinel where the selected deployment and RPC are available. If Sentinel data and contract state disagree, contract state and canonical receipts govern protocol outcomes.

## Failure states are evidence

- **Invalid provenance:** the address did not satisfy the selected factory relationship. Do not downgrade this to a generic project page.
- **Transient read failure:** identity may be valid, but the app could not establish current state. Retry; do not display a fabricated zero.
- **Incomplete history:** current state may be readable while lifetime event coverage is not. Treat totals and absence claims as incomplete.
- **Pending deployment:** no current public protocol stack is certified for that chain.

Read [Canonical identity](../reference/canonical-identity) and [Troubleshooting](../reference/troubleshooting) for verification and recovery.
