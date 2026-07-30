# pledge.cash

pledge.cash is a permissionless protocol and product workspace for token-backed project accounts. Projects can issue tokens, create grants and distributions, govern delayed actions, own liquidity, and wind down into redemptions while keeping the resulting authority and asset movement explainable from contract state.

The repository is unreleased. Its sole contract line is canonical protocol v1:
Boardrooms are asset-holding kernels routed through a protocol-owned facet
registry. HyperEVM and Monad testnet artifacts are both pending; testnet
deployment is the next operational stage after final local acceptance and
review, and no mainnet deployment is supported.

## Repository Layout

- `packages/contracts`: Foundry contracts, tests, and contract-specific configuration.
- `docs/pages`: public product and developer documentation published under `/docs`.
- `docs/*.md`: deep protocol and engineering source notes linked from the public developer reference.

## Start Here

- [Public Docs](docs/pages/index.md): task-oriented product documentation for exploring, participating, operating, governing, and closing projects.
- [Developer Docs](docs/pages/developers/index.md): public integration map and links into the deep protocol references.
- [Token Grant Protocol](docs/token-grant-protocol.md): escrow-backed free-claim and paid-settlement token grants.
- [Boardroom Protocol](docs/boardroom-protocol.md): owned issuer accounts with native share tokens.
- [Staking And Rewards Protocol](docs/rewards-protocol.md): non-custodial token locks, active-staker governance, cooldowns, and project-funded reward periods.
- [Distribution Protocol](docs/distribution-protocol.md): fixed-price sales, Merkle airdrops, and migrating bonding curves for Boardroom shares.
- [Bond Market Protocol](docs/bond-market-protocol.md): oracleless reserve and first-party LP auctions with non-transferable vested positions.
- [AMM Protocol](docs/amm-protocol.md): Boardroom-owned liquidity, trading, and fee accounting.
- [Project Token Launch](docs/project-token-launch.md): local dogfood scenario for a Boardroom-backed project token.
- [Deployment](docs/deployment.md): deterministic full-stack deployment, simulation, verification, and HyperEVM/Monad testnet operator flows.
- [Contributing](CONTRIBUTING.md): local setup, PR expectations, and contract-change checklist.
- [Security](SECURITY.md): supported scope and vulnerability reporting process.
- [Agent Guide](AGENTS.md): operating rules for coding agents and humans making repo changes.
- [Docs Authoring Standard](docs/AUTHORING.md): truth, structure, linking, and verification rules for public documentation.

## Local Development

Install dependencies:

```sh
bun install
```

Run the core contract, SDK, and web tests:

```sh
bun run test
```

Run the remaining service, docs, and formatting checks:

```sh
bun run sentinel:test
bun run docs:check
bun run format:check
```

Run only the contracts package:

```sh
bun --cwd packages/contracts test
```

Simulate the HyperEVM testnet deployment:

```sh
bun run simulate:hyperevm-testnet
```

The state-changing HyperEVM broadcast command is reserved for the explicit
testnet deployment ceremony after all gates in
[`docs/deployment.md`](docs/deployment.md) pass:

```sh
BROADCAST=1 bun --cwd packages/contracts deploy:hyperevm-testnet
```

Build the product workspace and its public docs for GitHub Pages:

```sh
bun --cwd apps/web build
```

Check and build the public docs:

```sh
bun run docs:check
bun run docs:build
```

## Product Standard

This repo treats smart contracts as settlement software, not ordinary application code. A contract change is not ready just because it compiles. It needs:

- a written state-machine model for the behavior being changed,
- explicit invariants for asset custody and authority,
- tests for both valid and invalid behavior,
- deterministic local reproduction commands,
- a clear failure model for external calls, token quirks, time, replay, and upgrades.

Prototype code may be messy while ideas are forming. Product code should be small, explicit, tested against adversarial conditions, and easy to audit from first principles.

## License

pledge.cash is licensed under GPL-3.0-only. See [LICENSE](LICENSE).
