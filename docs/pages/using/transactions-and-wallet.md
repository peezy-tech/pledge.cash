---
title: Transactions and Wallet
description: Connect an injected wallet, inspect transaction intent, and recover safely from signature, receipt, or refresh failures.
---

# Transactions and Wallet

The app uses an injected browser wallet. Unlock it, allow the site, and connect the
intended account. Wallet connection and optional peezy.tech identity are independent.

Each transaction preview should identify the chain, target contract, function, native
value, token amounts, approvals, deadline, and important state transition. Simulation
can reveal a likely revert but cannot guarantee execution against later chain state.

After submission, keep the transaction record until it is mined, replaced, dropped, or
reverted. Do not send a duplicate because a UI refresh was slow. Check the wallet and
chain explorer for the exact hash first.

A successful receipt can still be followed by an RPC refresh failure. In that case the
transaction result is authoritative; reload the same chain and contract instead of
assuming the action failed. Local transaction history is browser data and can be lost
without affecting onchain state.
