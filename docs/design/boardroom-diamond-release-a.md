# Boardroom diamond release A

Status: canonical genesis release manifest; target-chain deployment pending

- Release number: `1`
- Required storage version: `1`
- Predecessor facet-set hash: zero
- Storage layout commitment: `keccak256("pledge.cash.boardroom.diamond.storage.release-a.v1")`
- Migration: none

Release A creates a new Boardroom clone, initializes the canonical scalar and ERC-7201 storage layout, and deploys
its share token. The token binds primary-market callbacks to the registry's current facet-set hash.

Selector ownership:

- `BoardroomAuthorityFacet`: initialization; ownership; launch; controller replacement; veto; minting; redemption
  recipient; wind-down transition.
- `BoardroomExecutionFacet`: policy-checked execution; treasury and redeemable-asset operations; obligations; distribution
  and locked-liquidity callbacks.
- `BoardroomMarketFacet`: bonding-curve and protocol-liquidity reservation, activation, settlement, exit, and closure.
- `BoardroomRedemptionFacet`: snapshot, redemption, claims, excess sweep, and treasury-share burn.
- `BoardroomViewFacet`: the complete aggregate read surface declared by `IBoardroom`.

The exact selector order, facet addresses, route kinds, and runtime code hashes are encoded in the onchain release and
its `facetSetHash`. Each facet executes its Boardroom wrapper behavior directly in the kernel's storage context. The
facets bind immutable governance, market, and redemption helper modules, but neither deploy nor delegate into the
monolithic Boardroom implementation.
