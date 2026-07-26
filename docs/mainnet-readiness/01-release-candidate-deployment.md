# Hard release blocker 1: no release candidate deployment

Status: **Blocked**

Scope: every public-chain broadcast, mainnet artifact promotion, and real-value product launch.

## Release decision

pledge.cash does not currently have a mainnet release candidate. Do not broadcast the current contract stack to a
mainnet or publish any artifact as supported until every exit criterion in this document is satisfied.

This blocker is not cleared by proving that the contracts compile or by pointing the generic deployment script at a
mainnet RPC. A supported release must bind an exact source revision, chain, contract version, authority set, wrapped
native asset, runtime bytecode, immutable wiring, deployment transaction set, and product configuration.

## Current evidence

- The [security policy](../../SECURITY.md) says the contracts are not mainnet production software and that the
  repository does not support a mainnet deployment.
- The checked-in [HyperEVM testnet artifact](../../packages/contracts/deployments/998.json) is a verified deterministic
  v5 deployment with an adjacent 29-transaction source-bound receipt manifest.
- The checked-in [Monad testnet artifact](../../packages/contracts/deployments/10143.json) is marked `pending`.
- [Network documentation](../pages/reference/networks-and-deployments.md) tells users that no mainnet is supported and
  that pending artifacts do not certify usable addresses.
- [Deployment documentation](../deployment.md) covers local Anvil plus HyperEVM and Monad testnet procedures, not a
  mainnet release procedure.
- Chain-specific deployment and artifact-verification wrappers exist only for HyperEVM testnet and Monad testnet.
- The SDK and web application expose the verified HyperEVM testnet, pending Monad testnet, and local/custom development
  paths; they do not contain an authorized mainnet release profile.
- There is no tagged release or published GitHub release identifying an auditable contract release candidate.

## Why this is a hard blocker

Without a testnet deployment of the exact intended release, the project has not proved:

- that every root and child contract can be deployed under the target chain's transaction and block gas limits;
- that deterministic addresses, constructor inputs, salts, runtime hashes, and immutable relationships match the
  generated artifact;
- that the final authority addresses can execute the deployment and post-deployment handoffs;
- that supported wallets can create, simulate, submit, replace, and recover the required transactions;
- that indexers can discover the deployment through the target RPC's log-range and historical-data constraints;
- that governance launch, module creation, rewards, bonds, hostile-token recovery, wind-down, and redemption work as a
  complete lifecycle on the target chain;
- that the deployed source can be independently verified and reproduced from the release revision;
- that the web application fails closed before promotion and selects only the promoted deployment afterward.

A mainnet broadcast made before those proofs would create an immutable public surface without a validated release
identity or recovery path.

## Decisions required before implementation

Record these decisions in accepted architecture or release-decision documents:

1. **First mainnet:** choose one chain for the first release. Do not launch HyperEVM and Monad simultaneously.
2. **Release version:** choose the post-Boardroom-redesign contract version and deterministic release identity.
3. **Initial scope:** decide which modules are enabled at launch and whether a deliberately smaller contract surface is
   required for the first release.
4. **Supported assets:** define the wrapped-native address and the initial token compatibility standard.
5. **Authority manifest:** identify protocol governance, treasury, fee manager, deterministic deployer owner, and the
   transaction broadcaster. This depends on
   [hard release blocker 3](03-production-authority-ceremony.md).
6. **Promotion authority:** define who may convert a pending artifact into a supported artifact and which independent
   evidence that action requires.
7. **Canary model:** decide whether a meaningful limited mainnet canary is possible for a permissionless deployment. If
   limits or allowlists are desired, they must be designed into the release rather than implied by a hidden UI.

## Required remediation

### 1. Freeze an exact release candidate

- Resolve the governance-launch interface in
  [hard release blocker 2](02-secure-governance-launch.md).
- Resolve the obligation, discovery, and singleton-liquidity model in
  [hard release blocker 5](05-boardroom-lifecycle-data-model.md).
- Resolve the authority model in
  [hard release blocker 3](03-production-authority-ceremony.md).
- Complete the independent assurance gate in
  [hard release blocker 4](04-independent-security-assurance.md).
- Record the exact 40-character Git commit and require a clean worktree for every rehearsal and broadcast.
- Stop feature changes to the audited contract surface except for accepted audit remediation.

### 2. Implement target-chain release support

For the selected first chain, add and test:

- an explicit mainnet chain profile rather than a custom-chain fallback;
- the canonical wrapped-native token and explorer configuration;
- chain-ID refusal checks in every deployment and verification command;
- target-chain gas pricing, transaction type, finality, RPC, log-range, and historical-data behavior;
- deterministic deployment and Safe-compatible execution steps;
- artifact generation and independent artifact verification;
- SDK and web configuration that cannot become writable from a partial artifact;
- Sentinel configuration only if Sentinel is part of the supported launch.

### 3. Deploy the exact candidate to testnet

The testnet deployment must use the same:

- source revision and compiler configuration;
- deterministic salts and release version;
- authority architecture, substituting only explicitly identified test signers where unavoidable;
- module-policy configuration;
- artifact schema and verification process;
- SDK, web, and Sentinel release paths intended for mainnet.

Exercise the complete lifecycle with real RPCs and real wallet software. Local Anvil remains useful but is not a
substitute for this step.

The limited funded fixed-price x402 canary in
`packages/contracts/deployments/998-lifecycle.json` is evidence toward this requirement, but does not clear the complete
lifecycle, maximum-gas, authority-rehearsal, or mainnet promotion gates.

### 4. Create a protected artifact-promotion gate

The promotion process must reject any artifact that lacks required data. At minimum it must verify:

- schema and release version;
- chain ID and deployment transaction receipts;
- every required address and authority role;
- runtime code at every address;
- runtime code hashes against locally reproduced bytecode;
- immutable factory, policy, router, fee, rewards, bond, liquidity, and Boardroom wiring;
- deterministic address predictions and salt ownership;
- ownership handoffs and fee recipients;
- wrapped-native identity;
- deployment block or timestamp needed for complete discovery.

The verifier must fail on a pending artifact in release CI. A successful skip is acceptable for ordinary development
CI, but it is not a release-promotion result.

### 5. Publish an auditable release

The release must include:

- a signed or otherwise protected Git tag;
- exact source and dependency lockfiles;
- compiler and Foundry versions;
- deployment and verification commands;
- verified artifact JSON;
- transaction hashes and block numbers;
- contract source-verification links;
- authority manifest;
- audit report and remediation mapping;
- known limitations and supported-chain statement;
- rollback boundaries, including an explicit statement that immutable contracts cannot be rolled back.

## Exit criteria

This blocker is cleared only when all of the following are true:

- [ ] One first mainnet and one exact release version are approved.
- [ ] The exact release has been deployed to the corresponding public testnet.
- [x] The HyperEVM testnet artifact is complete, non-pending, checked in, and independently verified.
- [ ] Full lifecycle tests have passed against the deployed testnet contracts through the supported SDK and web paths.
- [ ] Maximum-gas deployment and user transactions fit the target chain's intended execution lane.
- [ ] The production authority ceremony has been rehearsed with the same transaction shape.
- [ ] Mainnet deployment and verification wrappers refuse the wrong chain and incomplete role configuration.
- [ ] The mainnet artifact schema fails closed on missing, malformed, or unexpected fields.
- [ ] Release CI requires live code-hash and immutable-wiring verification.
- [ ] A protected promotion step controls when the product becomes writable.
- [ ] A release tag and release evidence packet identify the exact audited revision.
- [ ] The public security and network documentation is updated only after the release is verifiably live.

## Evidence packet

The completed release issue or release record should link:

1. the approved decisions;
2. the exact source revision;
3. passing local and CI commands;
4. testnet deployment and lifecycle receipts;
5. independent verification output;
6. audit and remediation evidence;
7. authority rehearsal evidence;
8. operational and incident-readiness evidence;
9. the final go/no-go approval.

Documentation or screenshots without onchain and source-reproducible evidence do not clear this blocker.
