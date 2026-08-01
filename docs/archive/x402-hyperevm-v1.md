# Archived HyperEVM x402 rail

The HyperEVM x402 marketplace router and recurring-support product surface were
retired before any canonical pledge.cash protocol deployment became available.
The implementation was specific to HyperCore testnet settlement and HyperEVM
testnet chain 998, and it is not part of the Uniswap v4 protocol line.

The last complete source tree is Git commit
`fc0b501fb24fa19653e5af428e305d126f678552`. Git history preserves the
service, database migrations, web flows, tests, deployment gates, and operating
documentation at that commit.

This archive does not retire the generic onchain
`Boardroom.contributeTreasuryAsset` function, fixed-price sales, or ordinary
wallet-funded participation. A future HTTP 402 payment rail should be designed
as a new chain-native integration against the then-active canonical market
release.
