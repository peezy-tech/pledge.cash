---
title: Create and operate a project
description: Create a Boardroom, issue its token, and operate grants, distributions, liquidity, and lifecycle changes from Studio.
---

# Create and operate a project

Studio is the operator workspace. A Boardroom is the project account, share-token issuer, treasury, and obligation coordinator; it is not a company record or multisig substitute.

> **Availability boundary:** HyperEVM testnet (`998`) has a verified deterministic v5 deployment. Monad testnet (`10143`) remains pending. Creation requires the current artifact, matching wallet chain, and testnet assets; a local scenario remains isolated from the public testnet.

## Prerequisites

- A supported network with a current BoardroomFactory deployment.
- An installed, unlocked browser-injected wallet with native gas token.
- A durable prelaunch owner, intended controller proposer, and named protection staker.
- A project token name and symbol, deterministic salt, and supply plan.
- For grants, sales, curves, airdrops, or liquidity: supported ERC20 addresses, quantities, schedules, pricing, and risk limits.
- A plan for treasury assets, staker protections, wind-down, and recovery before taking funds.

Contract calls are public and irreversible once confirmed. The project-token name and symbol do not override the Boardroom address.

## 1. Create the Boardroom

1. [Open Studio](../../studio) and select the intended network.
2. Connect the browser wallet that will submit the creation transaction and pay gas. The submitting wallet does not have to be the initial owner.
3. Enter the exact `Owner`, token name, symbol, and salt. The Owner field—not the transaction caller—sets initial Boardroom authority and contributes to the deterministic address prediction. A salt is not a secret.
4. Predict the Boardroom address and record the selected network, factory, owner, parameters, and predicted address.
5. Review the creation call, continue, and let the app simulate it. The wallet opens only after simulation succeeds; compare its request with the selected owner and predicted deployment before signing.
6. Wait for confirmation and refresh before using the project address.

**Success proof:** the BoardroomFactory recognizes the created address; the Boardroom points to the configured policy registry and wrapped-native contract; its share token points back to that Boardroom; and the initial owner exactly matches the submitted `Owner` field.

## 2. Establish supply and treasury controls

Before governance launch, the owner can mint project shares and execute policy-checked Boardroom calls. Plan allocations first: treasury inventory, distributions, grants, liquidity, and direct holder allocations compete for the same supply.

1. Open the created project in Studio.
2. Mint only the intended amount of project shares.
3. Confirm protocol governance has allowed the project share token, other required approval assets, and module spenders in the root `AssetPolicy`; a Boardroom owner cannot administer that root allowlist. Separately register any additional redemption assets through Boardroom governance.
4. Transfer treasury assets to the Boardroom through deliberate, traceable transactions.
5. Verify **Transparency** after every change. Token total supply and Boardroom-held inventory are different values.

Do not send arbitrary assets to the Boardroom and assume they will become redeemable. The redemption basket is explicitly admitted and later processed in bounded pages; the append-only registry itself is not a protocol capacity ceiling.

## 3. Create obligations

Studio can coordinate these canonical modules while the Boardroom is active:

- **Grant:** approve grant-token escrow, then create an escrow-backed schedule. Paid grants also admit their payment token as a potential treasury asset.
- **Fixed-price sale:** approve project-share inventory, then create a sale whose buyer payments go directly to the Boardroom.
- **Dutch auction:** approve project-share inventory, then create a finite descending-price sale. Finalization is
  permissionless after expiry; any later locked-liquidity allocation is explicit and optional.
- **Merkle airdrop:** approve project-share inventory and publish a root, claim window, and distribution-specific maximum grant-claim count. There is no global Boardroom grant-slot capacity.
- **Migrating curve:** approve sale plus migration inventory, configure quote economics, and reserve the future locker and AMM initialization path.
- **Locked liquidity:** approve both assets and create the one permanent Boardroom pool/locker pair. Liquidity may be
  added repeatedly; after launch Active removals require delayed controller governance and always return assets to the
  Boardroom, while WindingDown permits a permissionless full exit.

Most creation paths are batches. Every approval, target, policy, amount, salt, time, and slippage bound must match the intended module. Record predicted child addresses before submitting.

See [Distributions and liquidity](../understand/distributions-and-liquidity), [Grants and vesting](../understand/grants-and-vesting), and [Claim an airdrop](claim-airdrop).

## 4. Operate the active project

- Monitor open inventory, claim windows, curve reserves, global curve liability, grant expiries, LP fees, scalar
  obligation counts, and bounded discovery pages.
- Close or cancel obsolete sales and airdrops so unused inventory returns to the Boardroom.
- Do not use curve terminal paths until the approved lifetime, migration-price, unwind, and quarantine policies are
  implemented and verified.
- Claim locked-liquidity fees to the Boardroom where appropriate.
- Prune closed obligations to decrement active counts while preserving permanent provenance.
- Keep Sentinel wallet coverage, Boardroom subscriptions, severity thresholds, and delivery channels current, but never treat an alert as onchain authority.

For the singleton curve, sell rights follow transferable shares through one global liability. Graduation currently
freezes trading, but cancellation/expiry unwind, permissionless migration, and quarantined-quote disposition are still
decision-gated. A stranded-quote curve remains open and recovery fails closed.

## 5. Governance launch boundary

Launch is available only for a verified v5 Boardroom. Review the proposer, predicted generation-1 controller, named
protection staker, reward pool, redemption-excess recipient, delays, grace period, and generation in calldata. The first
controller is deployed only inside launch and every mismatch reverts atomically.

Legacy and unknown versions remain readable but fail closed for launch, controller writes, and Boardroom-control
claims. No public v5 artifact is currently broadcast.

Read [Govern a project](govern-a-project) for the launched state machine.

## Wallet and transaction expectations

Every Studio write opens a transaction review and simulation before the injected wallet. Approvals and module creation may be separate calls or one Boardroom batch, depending on the flow. A successful receipt can precede a successful UI refresh.

If the Transaction Center says **refreshing workspace data**, wait or use the receipt rather than resubmitting. If it says refresh is waiting for a matching deployment, return to the chain and deployment where the transaction was submitted.

## Success proof

For each operation, preserve:

- the canonical receipt and block;
- Boardroom, module, child-contract, asset, and recipient addresses;
- the before-and-after Boardroom status and obligation list;
- token balance, allowance, inventory, or reserve changes;
- the event proving creation, close, cancellation, migration, cleanup, or authority change;
- a refreshed canonical project view with no relevant incomplete-read warning.

## Recovery

- **Simulation fails:** fix the stated invariant; do not submit from another interface without understanding it.
- **Creation approval succeeds but creation fails:** inspect and revoke the remaining allowance.
- **Predicted and emitted child differ:** stop; verify factory, salt, owner, network, and deployment identity.
- **A child read is incomplete:** do not operate from guessed state. Restore a capable RPC or inspect the child contract directly.
- **A module is disabled:** new top-level Boardroom module creations are blocked. Existing child contracts are not
  paused: fixed-sale buys, airdrop claims, and curve trades can continue while their own and the Boardroom lifecycle
  allow them. Reserved downstream grant/locker fulfillment and canonical cleanup also remain available.
- **Project must close:** stop new commitments and follow [Wind down and redeem](wind-down-and-redeem).

## Next steps

- Publish the Boardroom address and current network, not just a display name.
- Document distribution manifests, grant terms, treasury assets, and wind-down policy for participants.
- Use [Canonical identity](../reference/canonical-identity) and the [Boardroom integration bridge](../developers/boardroom) when integrating another interface.
