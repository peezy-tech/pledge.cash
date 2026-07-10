# Security Policy

pledge.cash is currently a HyperEVM testnet review candidate. The contracts are
not mainnet production software, and this repository does not support a mainnet
deployment yet.

## Supported Scope

Security reports are in scope for:

- all Solidity protocol code under `packages/contracts/src`, including Boardroom governance and redemption, policy
  registries, token grants, distributions, bonding-curve migration, AMM pools and routing, locked liquidity, protocol
  fee routing, token-transfer helpers, factories, and deterministic deployment primitives,
- deployment and verification surfaces that can publish or attest an unsafe contract stack, including
  `packages/contracts/script/Deploy.s.sol`, chain-specific deployment wrappers and artifact verifiers,
  `PledgeCashDeploymentSalts.sol`, and checked-in deployment artifacts,
- SDK or web deployment parsing when a defect can select, conceal, or misrepresent a contract address, authority,
  runtime code hash, or chain,
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
- the expected invariant and the state transition that violates it,
- any external-call or non-standard-token assumptions needed for impact,
- whether the issue affects the testnet candidate only or could affect a
  future mainnet deployment.

If private advisories are not available, open a minimal public issue asking for
a private security contact without including technical details.

## Expectations

Please avoid interacting with funds, contracts, accounts, or infrastructure you do not own. Do not demonstrate a
finding against a shared live deployment when a local Foundry test, fork, or self-deployed testnet instance can prove
it. Testnet proofs should use self-funded test accounts and should not degrade public RPC, hosting, or wallet-provider
services.

This repository has no supported mainnet deployment. Treat reports against the
current contracts as testnet-candidate findings unless a future release states
otherwise.

## GitHub Actions

Pull request CI runs untrusted code on GitHub-hosted runners. Keep workflow
tokens read-only, do not persist checkout credentials, do not use
`pull_request_target` for build or test jobs, and do not attach secrets to PR
checks.

Repository administrators should keep these GitHub Actions settings enabled:

- require approval for workflow runs from outside contributors,
- set default workflow permissions to read-only,
- disable GitHub Actions creating or approving pull requests,
- reserve deployment or publishing jobs for protected branches or protected
  environments.
