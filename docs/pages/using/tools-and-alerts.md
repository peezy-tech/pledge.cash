---
title: Tools and Alerts
description: Know when to use protocol-level diagnostics and how optional governance notifications work.
---

# Tools and Alerts

Most work belongs in `Explore`, `Portfolio`, a project workspace, or `Studio`. `Tools and Diagnostics` and `Governance alerts` are supporting surfaces for advanced inspection and optional notifications.

## Tools and Diagnostics

[Open Tools and Diagnostics](../../tools)

The Tools page contains:

- `Deployment`: active chain ID, factory state, creation fee, and configured deployment addresses.
- `Wallet`: the connected address and wallet chain.
- `Artifact`: the raw deployment artifact used by the app.
- `Create Direct Grant`: a protocol-level direct grant workflow that is not attached to a Boardroom project.
- `Discovery Diagnostics`: explicit scan ranges, cached results, and contract read errors.

Use these tools to diagnose a deployment, verify an address, or resume bounded discovery. They do not override canonical provenance, wallet authority, network matching, simulation, or transaction review.

If an artifact says `pending`, missing contract addresses are intentional. Do not substitute addresses from an older deployment.

## Governance alerts

[Open Governance alerts](../../settings/alerts)

Alerts are available only when the app build has the optional Sentinel API configured. Without it, alert URLs return to `Explore`. Sentinel is an offchain notification service; it does not queue, veto, execute, or change onchain authority.

Sentinel currently verifies EOA wallet signatures only. ERC-1271 smart-account signatures are not supported for SIWE
sign-in or wallet linking. That limitation applies to Sentinel identity—not to ordinary read-only use of project pages.

To configure alerts:

1. To create a Sentinel account, connect an EOA browser wallet and choose `Sign in with wallet`. The first account is always created by a SIWE wallet signature.
2. If you previously linked a social sign-in to that account, you can use the offered social method to reopen it. A social provider cannot create a walletless account.
3. Under `Wallets`, link the connected wallet and choose `Watch alerts`.
4. Under `Delivery`, choose `Link Telegram` and complete the expiring link flow.
5. Under `Alert rules`, choose `Wallet holdings` or `Specific Boardrooms`, set `Minimum severity`, and `Save`.

Every linked EOA wallet can sign in, but only wallets marked `Watching alerts` contribute wallet-based coverage. `Specific Boardrooms` accepts an explicit chain ID and Boardroom address.

## Recent deliveries

After signing in, `Recent deliveries` shows account-scoped receipts for alerts Sentinel prepared for your enabled channels. The list does not expose provider credentials or raw provider errors.

- `Queued` means the alert is waiting for a delivery attempt.
- `Delivered` means the channel provider accepted the send. It does not prove that a person read or acted on it.
- `Retry scheduled` means a delivery attempt failed and Sentinel plans another bounded attempt.
- `Delivery stopped` means automatic retries are exhausted. Review or replace the affected delivery channel.

Choose `Review action` to reopen the exact chain, Boardroom, and action context. Recheck current contract state before acting: a delivery receipt records Sentinel processing, not the action's current onchain status.

## Public governance activity

When Sentinel is configured, a project’s `Governance` section can show observed `Decision history` without giving the viewer transaction authority. Treat an alert as a prompt to inspect the canonical project, decoded action, and current onchain status—not as proof that an action remains pending or safe.

## Recovery and privacy

- `Alert service` with `Retry` means the Sentinel request failed; onchain project pages remain usable.
- A failed or stopped delivery affects only that offchain channel. It does not change the underlying governance action or any wallet authority.
- Use `Refresh`, `Refresh wallets`, or `Refresh channels` after completing an external sign-in or Telegram flow.
- A linked wallet and notification destination are offchain account data. `Stop watching` disables that wallet's alert coverage, removing a delivery channel stops delivery there, and `Sign out` ends only the current browser session. The current product does not expose wallet-credential unlinking or account deletion; none of those three controls removes the Sentinel account or its sign-in credential.
- Never sign a message whose domain, URI, wallet, chain ID, or purpose does not match the pledge.cash alert flow shown in the browser.

[Read the project Governance guide](project-workspace) · [Review safety boundaries](../start/use-safely)
