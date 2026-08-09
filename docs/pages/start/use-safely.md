---
title: Use pledge.cash Safely
description: Verify chain, deployment, contract identity, authority, assets, and transaction intent before signing.
---

# Use pledge.cash Safely

pledge.cash is non-custodial. Connecting a wallet permits reads and signature requests;
it does not transfer assets by itself. A submitted transaction can move assets or make
an irreversible lifecycle change.

Before signing:

1. Confirm the wallet and app show the intended chain.
2. Confirm the network artifact is live. Pending means contract actions are unavailable.
3. Verify the Boardroom or grant through its canonical factory.
4. Read the exact target, function, value, token approvals, amount, deadline, and minimum
   output shown in the transaction preview.
5. Wait for a receipt before retrying. A rejected signature, replaced transaction, and
   reverted receipt need different recovery steps.

Treat project metadata, hosted identity, and search results as untrusted context. Never
paste a seed phrase or private key. Revoke approvals you no longer need through a
trusted chain explorer or wallet tool.

Wind-down, grant settlement, locker exit, share redemption, and ownership transfer have
lasting consequences. Read the relevant guide and contract state first.
