---
title: Use pledge.cash Safely
description: A short safety checklist for reading projects, connecting a wallet, and signing onchain actions.
---

# Use pledge.cash Safely

pledge.cash is non-custodial software. Connecting a wallet lets the app read that address and request signatures; it does not transfer custody or grant the app project authority. A signed transaction can still move assets or permanently change contract state.

## Before you connect

1. Confirm the selected `Network` in the header.
2. Open the project from `Explore` or a canonical URL containing both chain ID and Boardroom address.
3. Read `Overview`, `Governance`, and `Transparency` before using `Participate` or `Studio`.
4. Treat `Current contract-state detail is incomplete`, `Historical activity is incomplete`, and other read warnings as unresolved uncertainty. Retry before acting.
5. Verify any project promises outside the app separately.

## Before you sign

The `Review transaction` surface shows the action, contract function, parameters, contract, native value, and risk level. Expand `Advanced transaction details` to inspect the full address and encoded call. Boardroom actions must have a `Verified decode`; the app blocks an unverified inner call.

Choose `Continue to wallet` only when the review matches your intent. The app simulates the call before submission. Your wallet is the final authority: check its network, destination, value, and fees too.

For an `Irreversible lifecycle change`, the app requires the acknowledgement “I understand this lifecycle change cannot be undone.” Treat that as a stop point, not a routine checkbox.

## Asset and approval safety

- Holder participation and grant-settlement approvals are separate transactions from the action that spends them.
  Studio can instead batch a Boardroom approval call with module creation in one `executeBatch` or scheduled controller operation. Inspect
  every nested call in the review to determine atomicity, and approve only the amount the workflow needs.
- Quotes and limits can change between reading, simulation, and mining.
- A grant can require payment; verify `Payment token`, `Price`, `Settleable now`, and `Expiry`.
- An airdrop proof and grant terms come from the project. The app verifies the submitted values against the contract, but it does not author the allocation.
- A project token creates only the rights encoded by its contracts. It does not automatically create equity, dividends, employment, corporate governance, or another offchain right. After governance launch, active stakers can have limited onchain veto or wind-down power when the contract thresholds are met; a liquid balance alone has none.

## After submission

Keep the app open until `Transaction activity` reports the outcome. `Submitted — waiting for confirmation` is not success. A receipt can become `Confirmed onchain`, `Needs attention`, `Cancelled`, or `Replaced in wallet`.

If the receipt confirms but the page says `Confirmed — refreshing workspace data`, wait for the fresh read. If it says `Confirmed — refresh waiting for the matching deployment`, return to the original network and deployment before trusting displayed post-transaction state.

[Read the full transaction and recovery guide](../using/transactions-and-wallet)

## Current hard boundary

Pending or unverified protocol identities are intentionally blocked. Do not
work around that gate: launch or controller writes require a promoted
protocol-v1 artifact, matching registry and facet code hashes, the expected
facet-set hash, matching controller factory/generation/epochs, and
`migrationRequired() == false`. Both target testnets are pending, and no
mainnet deployment is certified.

[Review networks and current limitations](networks-and-limitations) · [Open the app](../../explore)
