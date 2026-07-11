---
title: Troubleshooting
description: Recover from incomplete reads, wallet problems, transaction replacement, stale refresh, approvals, failed claims, and partial redemptions.
---

# Troubleshooting

Start with chain, deployment, address, wallet, and receipt. Most dangerous recovery mistakes come from retrying before identifying which of those changed.

## The app says the deployment is pending

Both HyperEVM testnet `998` and Monad testnet `10143` deployments are pending until authority-hardened v4 is broadcast and verified. Do not paste legacy addresses or override the warning. Use a maintained local scenario for development.

## No browser wallet is detected

The app currently supports injected browser wallets only.

1. Install or enable the wallet extension.
2. Unlock it and allow access to the site.
3. Reload, then connect again.

WalletConnect, QR handoff, and mobile deep links are not wired. Reading public project state does not require connection.

## A value says Unknown

Unknown means the read did not establish a value. It never means zero.

- verify the selected chain and current artifact;
- retry with a trustworthy RPC;
- inspect the contract read directly;
- check whether token metadata or historical log scanning failed;
- avoid any transaction whose limit or authority depends on the missing value.

## Project or grant verification failed

Compare the address and network with the source that published it. Then follow [Canonical identity](canonical-identity). Do not use a generic contract form to bypass a failed factory relationship.

If the error is explicitly transient, retry. If it is invalid provenance, stop.

## Transaction Center states

| Status | Meaning | Safe response |
| --- | --- | --- |
| Waiting for your review | The app has not opened the wallet | Review or cancel |
| Checking the transaction onchain | Simulation/verification is running | Wait; fix any reported failure |
| Waiting for wallet signature | Wallet approval is pending | Compare details, then sign or reject |
| Submitted — waiting for confirmation | A hash exists without a terminal receipt | Inspect that hash; do not duplicate |
| Confirmed onchain | The canonical receipt succeeded, including after a same-action fee replacement | Use the displayed receipt hash |
| Confirmed — refreshing workspace data | Receipt succeeded; scoped reads are retrying | Wait or refresh, but do not resubmit |
| Confirmed — refresh waiting for the matching deployment | Receipt belongs to another deployment context | Return to that chain and deployment |
| Cancelled | Wallet cancellation replaced the transaction | Reviewed action did not execute |
| Replaced in wallet | A different wallet transaction replaced it | Inspect replacement; reviewed action did not execute |
| Needs attention | Simulation, signature, submission, or receipt failed | Read the exact error and receipt |

Transaction records persist best-effort in browser storage. The chain receipt remains authoritative.

## Receipt confirmed but the page looks stale

1. Open the receipt and verify status, chain, target, and replacement hash.
2. Keep the matching account, chain, and deployment selected.
3. Wait for **refreshing workspace data** to finish or use the page's refresh control.
4. If reads still fail, inspect the relevant storage or event directly.

Do not submit again solely to force a refresh.

## Approval succeeded but the action failed

Approvals are independent transactions and may remain usable.

- read the exact allowance;
- decide whether to retry with corrected action parameters;
- otherwise revoke or reduce the allowance deliberately;
- never assume a reverted follow-up reverted an earlier approval.

## Paid grant settlement fails

- confirm the connected account still owns the grant-right NFT;
- re-read settleable amount and expiry;
- query `getSettlementCost(amount)`—the displayed price is a rate, not total cost;
- check payment balance and allowance;
- verify both tokens support exact transfers.

See [Receive and settle a grant](../guides/receive-and-settle-grant).

## Airdrop claim fails

Compare chain id, airdrop address, Boardroom, share token, index, raw amount, account, proof ordering, and claim mode. For a grant claim, compare every grant term. Check claim window, Boardroom Active status, remaining shares, used index, and grant-slot cap.

See [Claim an airdrop](../guides/claim-airdrop).

## Curve sell fails

The selling wallet needs both enough project shares and its own account-bound sell right. Sell rights do not follow token transfers. Trading also freezes after graduation latches or Boardroom wind-down starts.

## Redemptions opened, but one asset did not pay

The original shares may already be burned into per-asset credits. Inspect each credit and call `claimRedemptionAsset` from the credit-owner wallet for the unpaid asset. Do not repeat the full redemption blindly.

See [Wind down and redeem](../guides/wind-down-and-redeem).

## Sentinel data disagrees with the chain

Treat Sentinel's indexed public actions, wallet links, subscriptions, channels, and alerts as optional context. Reconcile them against canonical contract state and receipts. Sentinel cannot settle, execute, or reverse a protocol action.
