# pledge.cash

pledge.cash is a smart contract workspace for token-backed pledges and grants. The product direction is a protocol where issuers escrow assets, holders earn or settle rights over time, and every asset movement is explainable from contract state.

## Repository Layout

- `packages/contracts`: Foundry contracts, tests, and contract-specific configuration.
- `docs`: protocol and engineering guidance.

## Start Here

- [Token Grant Protocol](docs/token-grant-protocol.md): escrow-backed free-claim and paid-settlement token grants.
- [Contributing](CONTRIBUTING.md): local setup, PR expectations, and contract-change checklist.
- [Security](SECURITY.md): supported scope and vulnerability reporting process.
- [Agent Guide](AGENTS.md): operating rules for coding agents and humans making repo changes.

## Local Development

Install dependencies:

```sh
bun install
```

Run the full workspace checks:

```sh
bun run test
```

Run only the contracts package:

```sh
bun --cwd packages/contracts test
```

Simulate the HyperEVM testnet deployment:

```sh
bun run simulate:hyperevm-testnet
```

Broadcast the testnet factory deployment after loading the deployment key:

```sh
BROADCAST=1 bun --cwd packages/contracts deploy:hyperevm-testnet
```

Build the static contract interface for GitHub Pages:

```sh
bun --cwd apps/web build
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
