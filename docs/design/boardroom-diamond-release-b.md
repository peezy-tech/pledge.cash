# Boardroom diamond release B

Status: canonical local migration-rehearsal manifest; not a target-chain release proposal

- Release number: `2`
- Required storage version: `2`
- Predecessor facet-set hash: the activated release-A facet-set hash
- Storage layout commitment: `keccak256("pledge.cash.boardroom.diamond.storage.release-b.v2")`
- Migration selector: `migrateBoardroom(bytes32)`

Release B retains the complete release-A selector table, then:

- replaces `redemptionCredits(address)` with the release-B view facet;
- adds `releaseBMigrationState()`;
- adds the release-pinned migration route.

The permissionless migration accepts only the active expected facet-set hash, verifies release-A version and layout
commitments, writes the constant marker `keccak256("pledge.cash.boardroom.diamond.release-b")`, records the migration
timestamp and source version, and applies the release-B version and layout commitment. The kernel prevents migration
reentrancy and verifies the exact target version and layout before writes resume.

The exact selector order, facet addresses, route kinds, and runtime code hashes are encoded in the onchain release and
its `facetSetHash`.
