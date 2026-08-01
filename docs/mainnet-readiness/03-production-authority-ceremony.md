# Hard release blocker 3: production authority and deployment ceremony are undefined

Status: **Blocked**

Scope: deterministic deployment, protocol policy administration, treasury custody, fee administration, artifact
promotion, and emergency operations on every supported chain.

## Release decision

Do not fund or broadcast a mainnet deployment from the current raw-key workflow. The release must first define durable
authorities, separate transient broadcasting from long-lived control, and rehearse the complete ceremony with the exact
release transaction shape.

No private keys, seed phrases, recovery shares, unredacted signer identities, or secret-provider credentials belong in
this repository or in the public evidence packet.

## Current behavior

The current deployment path has several useful safety checks, but its authority model is appropriate only for
development and testnet operation:

- [`Deploy.s.sol`](../../packages/contracts/script/Deploy.s.sol) requires
  `PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER` to equal the `PRIVATE_KEY` broadcaster.
- [`PledgeCashDeterministicDeployer`](../../packages/contracts/src/deployment/PledgeCashDeterministicDeployer.sol) allows
  only its owner to consume deterministic release salts.
- The deployment script transfers selected root contracts to `PLEDGE_CASH_PROTOCOL_GOVERNANCE`, but does not transfer
  the deterministic deployer.
- Those governed roots include `ProtocolFacetRegistry`. Its owner can publish
  and atomically activate complete Boardroom releases for every lifecycle
  state.
- The environment template recommends using the same deterministic deployment owner on every chain that should share
  root contract addresses.
- Policy registration, asset and spender admission, and fee-recipient rotation are immediate owner operations. The
  contracts do not themselves impose a governance timelock. PoolManager, Universal Router, Quoter, StateView,
  PositionManager, and Permit2 are immutable deployment dependencies with their own external authority boundaries.

The result is a long-lived cross-chain release capability attached to the raw broadcaster key unless an external
ceremony changes the architecture.

## Assets and authorities at risk

The ceremony must account for at least these authority classes:

| Authority | Capability | Failure impact |
| --- | --- | --- |
| Deterministic deployer owner | Deploy the init code assigned to unused release salts | Future release capture, salt occupation, cross-chain drift |
| Transaction broadcaster | Pay gas and submit deployment/configuration transactions | Failed or reordered ceremony, exposed hot key |
| Facet-registry owner | Publish and activate Boardroom logic and storage migrations globally | Loss or redirection of every Boardroom asset and redemption path |
| Protocol governance | Register/disable policies and administer root-owned components | Module censorship or unsafe module admission |
| Asset-policy owner | Admit approval assets and spenders | Unsafe approvals or denial of supported assets |
| Protocol treasury | Receive protocol fees and other designated value | Fee loss or custody compromise |
| External Uniswap infrastructure authorities | Exercise powers present in the selected PoolManager, router, periphery, or Permit2 deployments | Market disruption, routing failure, approval loss, or externally governed fee changes |
| Artifact promotion authority | Make the product recognize a deployment as supported | Users routed to wrong or incomplete contracts |
| Hosting and DNS authority | Publish or withdraw product access | Phishing, stale UI, unavailable emergency communication |
| Sentinel operator | Operate hosted accounts, indexing, and notifications | Missed alerts, privacy breach, misleading context |

The Boardroom kernel is deliberately release-routed. Protocol governance can
change Boardroom behavior globally, including during wind-down and redemption,
but cannot reactivate an old release: rollback requires a higher-numbered
compatible release. Other immutable roots retain their own limits. The
ceremony and incident plan must describe those exact powers without implying a
pause, pin, rollback, or recovery path that does not exist onchain.

## Threat model

Design and rehearse responses for:

- compromise of the broadcaster before, during, or after deployment;
- one compromised Safe signer;
- threshold signer loss or unavailability;
- malicious or mistaken transaction ordering;
- wrong-chain RPC or chain-ID substitution;
- stale nonce, replacement, partial execution, or gas exhaustion;
- deterministic deployer deployed with the wrong owner;
- reused or unexpectedly occupied salt;
- wrong wrapped-native, treasury, governance, or fee-manager address;
- incomplete root-ownership handoff;
- malicious, mistaken, or incompletely reviewed facet publication/activation;
- a storage migration that is too expensive or impossible for a terminal
  Boardroom;
- emergency rollback calldata whose predecessor, storage layout, or selector
  table is incompatible;
- mainnet artifact published before final verification;
- one chain succeeding while a second chain's ceremony fails;
- emergency pressure to bypass review or lower a signing threshold;
- loss of access to the release workstation, hardware wallets, RPC, hosting, or source repository.

## Decisions required before implementation

### Deterministic release authority

Choose how a threshold-controlled authority will own and operate the deterministic deployer. Plausible designs include:

- deploying the deterministic deployer with a Safe as its constructor owner, then submitting a reviewed Safe batch for
  release deployment;
- using a purpose-built, audited release controller with explicit signed release authorization;
- another threshold-controlled design that never leaves durable release authority on the broadcaster EOA.

The current script cannot simply use a Safe owner because it expects the broadcaster to call the `onlyOwner` deployer.
The implementation must therefore separate deployer creation, release-call preparation, threshold authorization, and
broadcasting while preserving deterministic address proofs.

### Protocol governance

Decide:

- Safe members, threshold, signer diversity, and hardware-wallet requirements;
- what staking governor, proposal threshold, quorum, timelock, veto, and
  emergency process controls facet publication and activation;
- whether release activation is delayed or restricted during active
  redemptions;
- which independent attestations of selectors, facet code hashes, manifests,
  storage layouts, and migration gas are mandatory before activation;
- whether policy and asset changes pass through a timelock;
- which changes, if any, an emergency guardian may make immediately;
- whether disabling new module calls differs from permitting lifecycle cleanup;
- how decisions are announced and monitored;
- how signers rotate without losing authority;
- whether governance is shared or independent across chains.

### Treasury and fee administration

Define separate custody and operational boundaries for:

- protocol fee custody;
- acceptance and monitoring of external Uniswap v4 and Permit2 authorities;
- deployment gas funding;
- emergency gas reserves;
- routine forwarding or accounting;
- signer access, reconciliation, and incident response.

The same address may fill multiple roles only after the concentration risk is explicitly accepted.

### Release and artifact promotion

Define who may approve:

- the exact source revision;
- audit remediation closure;
- Safe transaction batches;
- final broadcast;
- artifact publication;
- product write enablement;
- emergency read-only mode or release withdrawal.

No one operator should be able to silently change source, deploy, publish an artifact, and enable the product without an
independent verification boundary.

## Required implementation changes

1. Refactor deployment tooling so the broadcaster is not required to be the deterministic deployer owner.
2. Generate deterministic, human-reviewable call batches for the selected threshold authority.
3. Bind every batch to chain ID, release version, salt set, expected addresses, init-code hashes, role addresses, and
   value transfers.
4. Refuse any unexpected existing code, ownership state, nonce state, or root configuration.
5. Verify every ownership transfer and role assignment from live chain state before continuing.
6. Split deployment, root configuration, ownership handoff, verification, and artifact promotion into explicit
   checkpoints.
7. Make every checkpoint safely resumable only after reconciling previous onchain effects.
8. Produce a compact, redacted evidence record without emitting secrets or sensitive signer metadata.
9. Add chain-specific cost limits and require explicit approval when the simulated maximum is exceeded.
10. Prevent a second-chain release from automatically inheriting unreviewed assumptions from the first.

## Ceremony phases

### Phase 1: preparation

- Freeze the exact audited source revision and dependency locks.
- Reproduce all bytecode and deterministic predictions on two independent machines or environments.
- Verify authority contracts, signer threshold, chain ID, wrapped native, RPC providers, and gas funding.
- Generate the complete transaction set and a plain-language manifest.
- Review the transaction set independently against source and artifact expectations.

### Phase 2: rehearsal

- Execute the exact transaction shape on the corresponding public testnet.
- Include partial execution, failed transaction, replacement, signer loss, and resumption exercises.
- Prove ownership handoffs, release authority, verification, artifact generation, and product promotion.
- Record timing, gas, operator steps, and every manual decision.
- Run the incident exercise for a suspected compromised broadcaster and unavailable signer.

### Phase 3: mainnet execution

- Reconfirm clean source and exact reviewed commit.
- Reconfirm live chain ID, authority code hashes, signer threshold, balances, nonces, and expected empty addresses.
- Submit only the pre-reviewed threshold-authorized transactions.
- Pause at every checkpoint and compare live state with the signed manifest.
- Stop on any unexplained difference. Do not improvise or blindly resume.

### Phase 4: verification and promotion

- Independently reproduce runtime hashes and immutable wiring.
- Verify every root owner, recipient, manager, and deployer owner.
- Publish source verification and the redacted evidence packet.
- Promote the artifact only after independent approval.
- Confirm the product reads the correct deployment while write actions remain disabled until the final go decision.

## Exit criteria

This blocker is cleared only when all of the following are true:

- [ ] Every production role has a documented address, owner, purpose, and recovery process.
- [ ] Durable deterministic release authority is not held by the broadcaster EOA.
- [ ] Protocol governance and treasury use approved threshold controls.
- [ ] Facet publication and activation use an approved governor/timelock,
      independent release attestation, and rehearsed higher-numbered rollback.
- [ ] Timelock and emergency-power decisions are explicit and reflected in live configuration.
- [ ] Deployment tooling supports the selected threshold authority without bypassing ownership checks.
- [ ] The complete ceremony has been rehearsed on the target testnet with the exact release transaction shape.
- [ ] Partial execution and safe-resumption behavior have been exercised.
- [ ] Compromised-broadcaster and unavailable-signer incident exercises have passed.
- [ ] Two independent reproductions agree on bytecode, salts, predicted addresses, and transaction batches.
- [ ] Root ownership, fee recipients, asset policy, and deterministic deployer ownership are automatically attested.
- [ ] Artifact promotion requires an independent approval after live verification.
- [ ] The evidence packet contains no secrets and is sufficient for a third party to verify the release.

The ceremony is part of the security boundary. A correct contract deployment performed under an unsafe authority model
does not clear this blocker.
