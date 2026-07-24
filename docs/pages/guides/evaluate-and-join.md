---
title: Evaluate and join a project
description: Verify a project, compare its participation paths, and complete a purchase, claim, curve trade, or swap safely.
---

# Evaluate and join a project

Start with evidence, not the project name. A pledge.cash project is a Boardroom contract plus the share token, distributions, grants, and liquidity contracts that can be proven to belong to it.

> **Current availability:** the checked-in HyperEVM testnet (`998`) and Monad testnet (`10143`) deployments are pending, not live protocol stacks. Do not approve or submit transactions on either network until the app resolves a current deployment. See [Networks and deployments](../reference/networks-and-deployments).

## Prerequisites

- A current, supported deployment on the selected network.
- The project address or a project discovered in Explore.
- For a write: an installed, unlocked browser-injected wallet on the same network.
- Enough native token for gas and enough payment or quote token for the chosen path.
- Your own limits: maximum payment, minimum output, and deadline.

WalletConnect and Coinbase Wallet QR or mobile handoff are not currently wired. Reading does not require a wallet.

## 1. Verify the project

1. [Open Explore](../../explore) and select the intended network.
2. Search by name only to narrow the list; treat the Boardroom address as the identity.
3. Open the project and check **Overview** for lifecycle, governance mode, share token, and available participation paths.
   If a wallet is connected, also verify that **Your position** names the expected direct project-token balance,
   settleable project-token grants, and holder-power status. Other grant assets are not added to that token amount.
4. Open **Transparency** and compare the Boardroom, share token, factories, distributions, pools, and treasury assets with the addresses published by the project.
5. Stop if provenance verification fails, the deployment is pending, or a required value says **Unknown**.

**Unknown is not zero.** It means the app could not establish the value from the selected RPC. A missing balance, obligation, price, or supply can change the economic decision completely.

Read [Canonical identity](../reference/canonical-identity) for the checks behind a project route.

## 2. Choose the participation path

| Path | What you receive | What you pay | Important limit |
| --- | --- | --- | --- |
| Fixed-price sale | Project shares from sale escrow | The configured payment token, sent to the Boardroom | Maximum payment and per-wallet cap |
| Dutch auction | Project shares from auction escrow | Payment token at the descending execution price | Fresh quote, maximum payment, deadline, and per-wallet cap |
| Migrating curve | Project shares from curve inventory | Quote token held in the curve reserve | Maximum buy cost or minimum sell refund |
| Merkle airdrop | Shares now or a vesting grant | Usually gas; a paid grant may require payment later | Exact published index, amount, proof, and claim mode |
| AMM | Output token from a pool | Exact input token | Minimum output and quote deadline |

A curve buy increases one global outstanding-share liability. Any current holder can sell up to the lesser of its
transferable share balance and that global liability, so sell rights follow shares through ERC20 transfers. Graduation
currently freezes trading; do not rely on migration, cancellation, or expiry until the gated terminal policies are
implemented and verified.

An AMM price is different from a sale or curve price. Check reserves, fee, slippage, route, and minimum output immediately before signing.

## 3. Review and submit

1. Select the exact distribution or pool in **Participate**.
2. Enter the amount and explicit protection fields. Refresh any stale quote.
3. Connect the wallet that owns the input tokens or allocation.
4. If approval is required, review and submit that approval as a separate transaction. Prefer the amount needed for this action.
5. Review the contract, function, token movement, value, and network in the transaction review.
6. Continue. The app runs simulation next and opens the wallet only if it succeeds; compare the wallet request with the review before signing.

The app simulates before opening the wallet, but simulation is not a promise that market state will remain unchanged before mining. Your onchain maximum, minimum, and deadline are the actual protections.

## Wallet and transaction expectations

The Transaction Center distinguishes:

- **Submitted — waiting for confirmation:** the hash exists, but there is no confirmed receipt yet.
- **Confirmed — refreshing workspace data:** the receipt succeeded; the visible project data is still catching up.
- **Confirmed — refresh waiting for the matching deployment:** the transaction succeeded in an earlier network or deployment context. Return to that context to refresh it.
- **Cancelled:** you cancelled the app review before the wallet opened, or a submitted transaction was replaced by a
  wallet cancellation.
- **Replaced in wallet:** a different transaction replaced it; the reviewed action was not executed.
- **Needs attention:** simulation, signature, submission, or the receipt failed.

A wallet can reprice the same action under a replacement hash. The app follows that hash and shows the ordinary confirmed or refresh status rather than a separate **Repriced** label. Do not submit the action again merely because refresh is slow. Open the receipt link and inspect the canonical hash first. See [Troubleshooting](../reference/troubleshooting).

## Success proof

A successful join has all of these:

- the canonical receipt succeeded on the intended chain;
- the project or pool address in the receipt matches the reviewed address;
- the expected token balance, claim index, sale inventory, curve position, or pool reserves changed onchain;
- the refreshed project workspace shows the result without an incomplete-read warning.

For an airdrop, also verify the claim index is marked used. For a curve buy, verify the global liability increased by
the purchased amount and the recipient received transferable shares.

## Recovery

- **Approval confirmed, action failed:** the approval may remain. Inspect and revoke or reuse it deliberately.
- **Quote expired:** refresh and review a new quote; do not widen limits blindly.
- **RPC read failed:** retry or use another trustworthy RPC. Do not reinterpret **Unknown** as `0`.
- **Wallet or network changed:** return to the original chain, account, and deployment to finish receipt tracking and refresh.
- **Project entered wind-down:** sales, airdrop claims, curve trades, and curve migration stop. Follow [Wind down and redeem](wind-down-and-redeem).

## Next steps

- Track wallet-specific work in [Portfolio](../../portfolio).
- Understand the instruments in [Distributions and liquidity](../understand/distributions-and-liquidity).
- Learn how Sentinel context differs from contract proof in [Provenance and Sentinel context](../understand/provenance-and-hosted-context).
