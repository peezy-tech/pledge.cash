# Lean protocol readiness checklist

pledge.cash is unreleased. No canonical testnet or mainnet deployment exists. A checked
network profile or pending artifact is configuration evidence, not proof of a live
protocol.

## Required before a testnet broadcast

- The exact release commit is clean, reviewed, and pinned.
- Contract, SDK, web, Sentinel, docs, format, network-profile, simulation, fork, and
  local end-to-end gates pass from that exact commit.
- Ethereum Sepolia and Base Sepolia profile addresses are re-read from authoritative
  Uniswap deployment sources.
- The deterministic addresses and runtime code hashes in the candidate artifact match
  local simulation and both fork rehearsals.
- Deployer, protocol owner, fee recipient, and project-owner addresses are explicit and
  independently checked.
- The funded broadcaster is a dedicated testnet account and the broadcast command is
  authorized separately from repository acceptance.

## Required before any mainnet authorization

- A testnet release has operated long enough to exercise Boardroom creation, grants,
  locker registration, fee collection, wind-down, and redemption.
- Independent contract and deployment review has no unresolved high-impact finding.
- The external owner strategy is explicit for every protocol and project authority.
- Emergency response, disclosure, monitoring, artifact publication, and source
  verification procedures have named owners.
- Canonical Uniswap periphery addresses and chain assumptions are revalidated for the
  target network.

Passing this checklist does not itself authorize a broadcast.
