# Boardroom diamond release A

Status: non-production design-spike release

- Release number: `1`
- Required storage version: `1`
- Predecessor facet-set hash: zero
- Storage layout commitment: `keccak256("pledge.cash.boardroom.diamond.storage.release-a.v1")`
- Migration: none

Release A creates a new Boardroom clone, initializes the v5-compatible scalar and ERC-7201 storage layout, and deploys
its vNext share token. The token binds primary-market callbacks to the registry's current facet-set hash.

Selector ownership:

- `BoardroomAuthorityFacet`: initialization; ownership; launch; controller replacement; veto; minting; redemption
  recipient; wind-down transition.
- `BoardroomExecutionFacet`: policy-checked execution; treasury and redeemable-asset operations; obligations; distribution
  and locked-liquidity callbacks.
- `BoardroomMarketFacet`: bonding-curve and protocol-liquidity reservation, activation, settlement, exit, and closure.
- `BoardroomRedemptionFacet`: snapshot, redemption, claims, excess sweep, and treasury-share burn.
- `BoardroomViewFacet`: the complete aggregate read surface declared by `IBoardroomDiamond`.

The exact selector order, facet addresses, route kinds, and runtime code hashes are encoded in the onchain release and
its `facetSetHash`. Release A uses the isolated v5-compatibility logic bridge for business behavior; that bridge is a
prototype mechanism and not a claim that every existing v5 child module is vNext callback-compatible.
