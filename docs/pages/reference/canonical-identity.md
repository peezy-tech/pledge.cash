---
title: Canonical identity
description: Verify Boardrooms, share tokens, grants, lockers, positions, and external periphery on one exact chain.
---

# Canonical identity

An address is not self-authenticating. Verify every object against the selected chain's
live deployment artifact and factory relationships.

| Object | Required evidence |
| --- | --- |
| Boardroom | `BoardroomFactory.isBoardroom`, matching `factory`, runtime code |
| Project token | Boardroom `shareToken`, factory `isShareToken`, token `boardroom` |
| Token Grant | Factory `grantForTokenId`, token ID derived from grant address, live grant fields |
| Grant right | Current ERC721 `ownerOf` plus grant `holder` |
| Liquidity locker | Factory `lockerOfBoardroom(locker.boardroom())`, immutable Boardroom and token fields |
| v4 position | PositionManager `ownerOf(tokenId) == locker`, exact hookless PoolKey, position info and liquidity |
| Swap path | Artifact's Universal Router, Permit2, Quoter, StateView, and exact PoolKey |

Events support discovery and history, but current mappings and contract reads decide
whether a relationship still holds. Hosted identity, names, icons, project copy, saved
addresses, and URLs are never sufficient provenance.

If a public artifact is pending, there is no canonical pledge.cash contract identity on
that network.
