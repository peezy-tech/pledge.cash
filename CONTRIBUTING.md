# Contributing

Thanks for helping make pledge.cash easier to review. This repo treats smart
contracts as settlement software, so changes should be small, explicit, and
easy to verify.

## Development Setup

Install dependencies:

```sh
bun install
```

Install the pinned Foundry toolchain used by CI and editor formatting:

```sh
foundryup -i v1.7.1
forge --version
```

Run the default verifier:

```sh
bun run test
```

Useful focused checks:

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
bun run format:check
```

Zed project settings in `.zed/settings.json` format Solidity on save with
`forge fmt --root packages/contracts --raw -`, so editor saves, CLI formatting,
and CI all use the same Foundry formatter.

The mainnet-fork ERC20 smoke tests are opt-in because they depend on an
external RPC:

```sh
cd packages/contracts && forge test --fork-url "$MAINNET_RPC_URL" --match-contract TokenGrantForkTest -vvv
```

## Contract Changes

Before changing contract behavior, update or check the relevant protocol docs:

- `docs/token-grant-protocol.md`

Every meaningful contract change should answer:

- what state machine is changing,
- which assets can move and under whose authority,
- which invariants must hold before and after every public function,
- which external calls happen and how hostile ERC20s behave,
- the bounds on loops, arrays, timestamps, and user-controlled input,
- the deterministic command that proves the change locally.

Prefer explicit custom errors, explicit events for state transitions, small
public APIs, and simple control flow.

## Pull Requests

PRs should include:

- a short summary of behavior changed,
- tests or docs updated for the affected state machine,
- exact commands run,
- any remaining risk, skipped check, or expected warning.

Do not commit private keys, `.env` files, Foundry broadcast/cache output,
Playwright artifacts, logs, or other local runtime state.
