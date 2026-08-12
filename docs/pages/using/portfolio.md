---
title: Use Portfolio
description: Find wallet-specific Boardrooms, grant rights, and liquidity lockers while preserving chain and provenance.
---

# Use Portfolio

[Portfolio](../../portfolio) discovers canonical objects tied to the connected wallet
from Boardroom, grant, and liquidity-locker factory logs.

Use it to find:

- Boardrooms the wallet owns;
- Boardroom share balances;
- ERC721 grant rights held by the wallet;
- canonical lockers associated with relevant projects.

Select the network to inspect, connect the wallet, and choose **Refresh access**. Every
result retains its contract address. Opening a grant re-reads factory provenance and
live terms. Opening a project re-reads the Boardroom factory, owner, status, assets,
and escrows.

Disconnecting a wallet hides wallet-specific discovery but does not make public project
state private or change any onchain right.
