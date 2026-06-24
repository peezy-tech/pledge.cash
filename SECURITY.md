# Security Policy

pledge.cash is currently a HyperEVM testnet review candidate. The contracts are
not mainnet production software, and this repository does not support a mainnet
deployment yet.

## Supported Scope

Security reports are in scope for:

- `packages/contracts/src/TokenGrant.sol`
- `packages/contracts/src/TokenGrantFactory.sol`
- documentation that materially misstates custody, authority, or protocol risk

Out of scope:

- mainnet deployments, because none are supported by this repo yet,
- denial-of-service testing against public RPCs, DNS, hosting, or third-party
  infrastructure,
- social engineering, phishing, spam, or physical attacks,
- issues that require compromised private keys, wallets, developer machines, or
  third-party accounts.

## Reporting

Use a private GitHub Security Advisory for this repository when available. Do
not open a public issue with exploit details, live exploit steps, private keys,
or sensitive infrastructure data.

Include:

- affected files, contracts, functions, or UI flows,
- a short impact statement,
- reproduction steps or a failing test,
- affected assets and required authority,
- whether the issue affects the testnet candidate only or could affect a
  future mainnet deployment.

If private advisories are not available, open a minimal public issue asking for
a private security contact without including technical details.

## Expectations

Please avoid interacting with funds or infrastructure you do not own. Testnet
proofs should use self-funded test accounts and should not degrade public RPC,
hosting, or wallet-provider services.

This repository has no supported mainnet deployment. Treat reports against the
current contracts as testnet-candidate findings unless a future release states
otherwise.
