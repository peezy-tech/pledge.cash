# pledge.cash

pledge.cash is an unreleased protocol and product workspace for token-backed project
accounts. Its lean core has four responsibilities:

- a non-upgradeable **Boardroom** that owns treasury assets, issues one project token,
  records obligations, and ends in pro-rata redemption;
- deterministic, fully escrowed **Token Grants** with optional paid settlement;
- one canonical **Uniswap v4 liquidity locker** per Boardroom, with permissionless fee
  collection and a fixed protocol split;
- optional **peezy.tech identity** for sign-in and linked-wallet context, with no
  onchain authority.

Token launches, swaps, pool execution, and project-owner governance are external. The
app uses canonical Uniswap v4 periphery for swaps, points launch operators at Uniswap's
CCA Liquidity Launchpad, and accepts an EOA, Safe, or separately deployed timelock as a
Boardroom owner. There is no diamond, bespoke governance, distribution, bond, staking,
rewards, hook, or custom AMM subsystem.

No pledge.cash contract is live on a public network. Ethereum Sepolia and Base Sepolia
are deployment candidates with pending artifacts; a public testnet broadcast is the
next separately authorized step after local acceptance.

## Repository layout

- `packages/contracts`: Foundry contracts, tests, network profiles, and deployment proof.
- `packages/sdk`: lean ABIs, chain-aware reads, calls, swaps, and deployment parsing.
- `apps/web`: routed project, grant, liquidity, identity, and transaction workspace.
- `services/sentinel`: optional identity, authentication, and wallet-link service.
- `docs/pages`: public product and developer documentation.
- `docs/*.md`: deep protocol and deployment specifications.

## Start here

- [Public docs](docs/pages/index.md)
- [Boardroom protocol](docs/boardroom-protocol.md)
- [Token grant protocol](docs/token-grant-protocol.md)
- [Liquidity protocol](docs/liquidity-protocol.md)
- [Project token launch](docs/project-token-launch.md)
- [Deployment](docs/deployment.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## Local acceptance

Install dependencies and use Foundry v1.7.1:

```sh
bun install
foundryup -i v1.7.1
forge --version
```

Run the normal repository gate:

```sh
bun run test
bun run sentinel:test
bun run docs:check
bun run format:check
```

Run the deployment and retained-lifecycle proof:

```sh
bun run validate:networks
bun run simulate:sepolia
bun run simulate:base-sepolia
bun run test:testnet-forks:deployment
bun run scenario:project-token:local
```

These commands do not broadcast to a public network. Fork tests deploy only into
disposable local Anvil processes. See [Deployment](docs/deployment.md) for the authority
boundary.

Build the app and public docs:

```sh
bun --cwd apps/web build
bun run docs:build
```

## Product standard

Contract changes must state the affected state machine, asset authority, invariants,
external-call assumptions, input bounds, and deterministic proof command. Small public
APIs and explicit irreversible lifecycle transitions are preferred over configurable
frameworks.

## License

pledge.cash is licensed under GPL-3.0-only. See [LICENSE](LICENSE).
