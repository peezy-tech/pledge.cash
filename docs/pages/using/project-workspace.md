---
title: Project Workspace
description: Read a canonical project through its Overview, Swap, and Transparency sections.
---

# Project Workspace

A project route contains an exact chain ID and Boardroom address. The app verifies that
identity against the selected deployment before presenting project state.

## Overview

Read the owner, lifecycle status, share token and supply, treasury assets, active grants,
and locked-liquidity escrow. Treat owner type as an external choice; pledge.cash
does not infer governance protections from an address label.

## Swap

Inspect the canonical locker's PoolKey and request a Uniswap quote. A swap uses Permit2
and Universal Router. Review input, expected output, minimum output, approvals, deadline,
and native-token handling before signing.

## Transparency

Review canonical factory relationships, contract addresses, escrow state,
snapshot progress, and raw explorer links. Hosted descriptions and linked identities are
supplemental context only.

Lifecycle and balances can change after a page load. Refresh immediately before a
transaction and wait for its receipt before trusting the new state.
