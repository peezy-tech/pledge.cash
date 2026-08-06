---
title: Review and Settle a Grant
description: Verify grant provenance, vesting, price, holder authority, approvals, and terminal state.
---

# Review and Settle a Grant

Open a grant from Portfolio or a project's Overview. Its canonical route contains the
chain ID and grant address. The app verifies code and the TokenGrantFactory link before
showing transaction controls.

Review the issuer, current grant-right holder, granted token, escrowed amount, settled
amount, vesting cliff and end, expiry, transfer policy, payment token, and unit price. A
unit price is not the total cost; the preview computes cost for the exact settlement
amount.

Only the current holder can settle. A paid grant may first require an ERC20 approval for
the grant contract. Then settlement transfers payment directly to the issuer and the
granted token from escrow to the holder. Wait for the approval receipt before sending
settlement.

If settlement is unavailable, identify whether the amount is unvested, the grant is
expired or closed, the connected wallet is not the holder, the wallet is on the wrong
chain, or the deployment is pending. Do not retry by increasing approvals or amount
without resolving the specific condition.
