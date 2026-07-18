---
title: Glossary
description: Plain-language definitions for pledge.cash contracts, roles, lifecycle states, transactions, and hosted context.
---

# Glossary

| Term | Meaning |
| --- | --- |
| Active | Boardroom state in which allowed issuance and participation can continue. It can be pre-launch or launched. |
| Airdrop manifest | Offchain data that maps a claim index and account to amount, proof, claim mode, and optional grant terms. The root commits to it, but the contract does not publish it. |
| AMM | Automated market maker that swaps supported ERC20 pairs through a constant-product pool. |
| Boardroom | Canonical onchain project account, share-token issuer, treasury, policy executor, and obligation coordinator. |
| BoardroomFactory | Deployment root that creates and recognizes canonical Boardrooms. |
| Boardroom owner | Address with direct pre-launch authority and certain lifecycle powers. Ownership does not survive as direct treasury execution after launch. |
| Canonical | Proven through the selected chain, deployment, factory, and contract relationships—not merely a matching name. |
| Claimable | Maximum cumulative grant-token amount permitted to settle under current terms; a vesting halt can lower it. It includes tokens already settled and is not necessarily vested now. |
| Cliff | Timestamp before which a grant vests zero tokens. |
| Curve sell right | Account-bound limit created by a curve buy. It does not follow project-token transfers. |
| Deployment artifact | Chain-specific record of current protocol addresses, authority, wiring, and code identity, or an explicit pending status. |
| Distribution | Boardroom-created fixed sale, Merkle airdrop, or migrating curve that escrows project shares. |
| Executor | Address allowed to queue delayed Boardroom actions after governance launch. It is not the only address allowed to execute a ready action. |
| Grant | Contract that escrows existing tokens and releases vested amounts under fixed terms. |
| Grant-right NFT | ERC721 whose current owner is synchronized as the grant holder while the grant remains live. |
| Governance-eligible supply | Current or checkpointed circulating shares outside the Boardroom treasury and authenticated protocol custody, used as the denominator for active-staker thresholds. |
| Governance epoch | Version that invalidates older queued actions when executor or lifecycle context changes. |
| Holder | Current grant-right owner for a grant, or a project-share owner in governance/redemption context. Read the surrounding context. |
| Issuer | Account or Boardroom that escrows tokens into a grant and receives paid-settlement proceeds. |
| Locked liquidity | Boardroom-owned LP principal held in a canonical locker until wind-down exit rules apply. |
| Merkle proof | Sibling hashes proving one exact leaf belongs to a published Merkle root. |
| Obligation | Recorded grant, distribution, or locker that must close before Boardroom redemptions open. |
| Payment token | ERC20 paid in a sale or paid grant. It is distinct from the delivered grant token in a paid grant. |
| Pending deployment | Artifact state that deliberately withholds protocol addresses until a current stack is broadcast and verified. |
| Policy | Contract that authorizes a bounded Boardroom call or module lifecycle operation. |
| Price | Stored rate per whole delivered token. For paid grants, total settlement cost depends on chosen amount and rounds up. |
| Provenance | Factory and contract relationships that establish canonical identity. |
| Redemption credit | Per-holder, per-asset right created when project shares burn; failed asset payouts remain retryable against it. |
| Redemptions open | Terminal Boardroom state with fixed asset and supply snapshots. |
| Repriced transaction | Wallet replacement that preserves the action while changing transaction fees. The replacement hash is authoritative. |
| Sentinel | Optional hosted indexing and alert service. It is not protocol settlement or governance authority. |
| Settleable now | Vested, unsettled grant amount available before expiry and close. |
| Settlement | Holder transaction that pays any exact cost and receives vested grant tokens from escrow. |
| Share token | ERC20 created and controlled by one Boardroom; used for project economics, governance thresholds, and final redemption. |
| Snapshot | Fixed supply and asset balances captured when Boardroom redemptions open. |
| Unknown | A value the app failed to establish. It never means zero. |
| Veto | Qualified-holder cancellation of a queued governance action before execution. |
| Winding down | One-way Boardroom state that stops new commitments and prepares obligations and assets for redemption. |
