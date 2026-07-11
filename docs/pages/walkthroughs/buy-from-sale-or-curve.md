---
title: Buy From A Sale Or Curve
description: App-specific steps for comparing and using a project's live participation routes safely.
---

# Buy From A Sale Or Curve

Use this walkthrough when a project distributes Boardroom tokens through a fixed-price sale, bonding curve, airdrop, or AMM.

## 1. Open The Exact Project

Find the project in `Explore` or use its canonical project URL. The URL includes both the chain ID and Boardroom address, so a shared link cannot silently load a different catalog entry.

You can inspect every project section without connecting a wallet.

## 2. Review The Project First

Start on `Overview`, then inspect `Transparency` for treasury balances, token supply, grants, distributions, liquidity, and contract addresses. `Governance` shows whether the owner still acts directly or an executor must queue delayed changes.

Token ownership does not automatically create equity, dividends, employment rights, or other off-chain entitlements. Read any separate project terms independently.

## 3. Compare Participation Routes

Open `Participate`. The app lists the routes discovered for this exact Boardroom and prioritizes active ones:

- a fixed-price sale shows the expected tokens, payment, buyer capacity, balance, and allowance;
- a bonding curve supports live buy and sell quotes, protected bounds, and sellable-share checks;
- an airdrop checks a supplied allocation index and proof before claiming;
- an AMM route shows the current pool quote after migration.

Only connect the wallet when you are ready to quote or act.

## 4. Review Approval Separately

An ERC-20 purchase may need approval first. The primary action explains whether the next transaction is an approval or the purchase itself. Approve only the amount required for the protected quote.

## 5. Confirm The Transaction

Before the wallet opens, the review surface shows the action, contract function, destination, native value, risk level, and raw calldata. The app simulates the exact call. A failed simulation never opens the wallet.

After signing, the transaction tray remains visible across navigation until the receipt confirms or fails.

## 6. Recheck State

After confirmation, recheck your wallet balance and the project's `Overview` or `Transparency` state. Quotes can change between reads, and operators may close, cancel, migrate, or queue changes according to the current lifecycle.

If the project enters wind-down, `Governance` explains the transition and `Transparency` shows the declared redemption assets once redemptions open.
