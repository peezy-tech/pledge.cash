# Security policy

pledge.cash is an unreleased local-review candidate. No canonical pledge.cash contract
has been broadcast to Ethereum Sepolia, Base Sepolia, or a mainnet.

## Supported scope

Security reports are in scope for:

- `Boardroom`, `BoardroomFactory`, and `BoardroomToken`, including execution,
  obligation, wind-down, snapshot, and redemption behavior;
- `TokenGrant` and `TokenGrantFactory`, including escrow, vesting, paid settlement,
  grant-right transfer, Boardroom callbacks, recovery, and quarantine;
- `LiquidityLocker`, `LiquidityLockerFactory`, the minimal PositionManager interface,
  and `ProtocolFeeRouter`, including position validation, fee collection, exit, and
  exact token movements;
- deterministic deployment primitives, salts, network profiles, simulations, fork
  wrappers, artifact generation, and verification;
- SDK, app, or documentation behavior that can select, conceal, or misrepresent chain,
  contract identity, authority, asset custody, or runtime code.

Out of scope:

- mainnet or public pledge.cash deployments, because none exists;
- denial-of-service testing against public RPC, DNS, hosting, or third-party services;
- social engineering, phishing, spam, or physical attacks;
- issues that require compromised keys, wallets, developer machines, or third-party
  accounts.

## Reporting

Use a private GitHub Security Advisory when available. Do not publish exploit details,
private keys, or sensitive infrastructure in an issue.

Include the affected file and function, impact, minimal reproduction, assets and
required authority, violated invariant, external-call or token assumption, and whether
the result affects local proof or a future testnet candidate. If private advisories are
unavailable, open a minimal public issue asking for a private contact.

## Expectations

Prove findings with local Foundry tests, disposable forks, or self-owned test accounts.
Do not interact with funds, contracts, accounts, or infrastructure you do not own. A
pending artifact, configured profile, or local simulation is not a supported public
deployment.

## GitHub Actions

Pull request CI runs untrusted code on hosted runners. Keep tokens read-only, do not
persist checkout credentials, do not use `pull_request_target` for build or test jobs,
and do not attach secrets to PR checks. Deployment and publishing jobs belong behind
protected branches or environments.
