# Deployment

This document describes deployment of the sole canonical pledge.cash contract
line, `pledge.cash.protocol.v1`. The canonical Boardroom is the
registry-routed kernel/facet architecture described in
[`design/boardroom-diamondization-spike.md`](design/boardroom-diamondization-spike.md).
There is no parallel Boardroom deployment path in this unreleased repository.

## Current network status

| Network | Chain id | Default RPC | Wrapped native | Checked-in artifact |
| --- | ---: | --- | --- | --- |
| Monad testnet | `10143` | `https://testnet-rpc.monad.xyz` | `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541` | `10143.json`: **pending** |
| Local Anvil | `31337` | `http://127.0.0.1:8547` | locally deployed | ignored local artifacts |

The target testnet does not have a canonical protocol-v1 broadcast. Testnet
deployment is the next operational step after the final local acceptance and
review gates, but this repository state does not authorize or evidence that
broadcast. Mainnet remains unsupported.

An RPC responding with the expected chain id proves only network access. A
target becomes usable only after a clean-source broadcast produces a verified
candidate, an explicit release decision promotes it, and the checked-in
artifact and receipt evidence agree with live code.

## Canonical deployment graph

`Deploy.s.sol` deploys the complete protocol, publishes and activates
Boardroom release A, configures module policies and fee routes, transfers the
governed roots, and then attests the resulting graph. It deploys 19 protocol
roots through `PledgeCashDeterministicDeployer`, plus the deterministic deployer itself and a permission-bit-compatible
CREATE2 hook:

- `ProtocolFacetRegistry`, `BoardroomKernel`, `BoardroomFactory`, the policy
  registry, three immutable Boardroom helper roots, and the five release-A
  facets;
- asset policy and protocol fee router;
- token-grant, Pledge v4 liquidity, distribution, rewards, and bond-market roots;
- a `beforeInitialize`-only `PledgeV4Hook` mined and deployed after the liquidity factory address is known.

PoolManager, Universal Router, v4 Quoter, StateView, PositionManager, Permit2, and wrapped native are external inputs.
The script requires code at every address and records each address and runtime code hash in the artifact.

The factory creates its bound controller factory and controller
implementation. Child implementations created by module factories are also
recorded and code-hash checked.

`PledgeCashDeploymentSalts` uses the
`pledge.cash.protocol.v1` namespace. Each salt includes the root creation-code
hash, and the deterministic deployer permanently commits the first accepted
init-code hash for each salt. A bytecode or constructor-input change therefore
cannot silently reuse a root address.

## Release and authority boundary

The broadcaster is a bootstrap operator. Before completing, the script
transfers these owners to `PLEDGE_CASH_PROTOCOL_GOVERNANCE`:

- `ProtocolFacetRegistry`;
- `BoardroomPolicyRegistry`;
- `AssetPolicy`;
- `ProtocolFeeRouter`;
- `TokenGrantFactory`.

This is the genesis ceremony configuration, not a permanent owner pin.
`protocolGovernance` records the configured genesis role, while
`protocolFacetRegistryOwner` records the registry's owner observed during that
deployment. A later valid Ownable handoff can make those addresses differ.
Post-genesis release operations must approve and verify the registry's current
live owner explicitly.

`ProtocolFacetRegistry.owner()` can publish and atomically activate a complete
Boardroom release. Activation immediately changes routing for every Boardroom,
including Boardrooms in wind-down, snapshotting, or open redemption. A release
that raises the required storage version blocks ordinary writes on each
Boardroom until anyone successfully runs that release's pinned migration.
Expected facet-set hashes prevent a transaction or authorization from silently
executing under different logic; they do not reduce the registry owner's
authority over Boardroom assets.

The other configured roles are:

- `PLEDGE_CASH_PROTOCOL_TREASURY`, the recipient behind
  `ProtocolFeeRouter`;
- `PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER`, which must be the broadcaster
  for the current deployment flow.

These roles may share an address in a disposable local proof. A testnet
ceremony should choose and record them deliberately before broadcasting.

## Post-genesis Boardroom releases

`Deploy.s.sol` owns genesis only: it deploys the protocol and publishes and
activates release 1. Every later `ProtocolFacetRegistry` release uses the
generic operator under
`packages/contracts/script/registry-release/`. It does not modify the
deterministic deployment graph or any root deployment artifact.

The operator accepts one complete canonical JSON manifest:

```json
{
  "schemaVersion": 1,
  "release": 2,
  "requiredStorageVersion": 2,
  "predecessorFacetSetHash": "0x...",
  "storageLayoutHash": "0x...",
  "manifestHash": "0x...",
  "routes": [
    {
      "selector": "0x12345678",
      "facet": "0x...",
      "codeHash": "0x...",
      "kind": "View"
    }
  ],
  "migrationFacet": "0x...",
  "migrationSelector": "0x..."
}
```

`manifestHash` commits the reviewed human release specification; it is not a
hash invented by the operator. Routes must be the complete selector table,
strictly ascending by selector, with exact `View`, `Mutating`, or `Migration`
kinds. A no-migration release uses a zero migration facet and selector. A
storage-version increase must name exactly one matching migration route. Every
migration-bearing release uses the permanent
`migrateBoardroom(bytes32)` selector (`0x6f774fc9`); only its facet
implementation changes between releases.
`routes: []` is a valid complete emergency release only while the active
release lineage has never introduced a migration route. Activating it removes
every routed selector, so Boardroom facet calls—including views—become
unavailable while kernel introspection and native receipt remain. Once a
migration route exists, every successor must retain one so Boardrooms that
have not yet migrated cannot be stranded; the equivalent emergency release
therefore keeps only a migration route. Recovery always requires publishing
and activating a higher-numbered release; an older release cannot be
reactivated.

Before simulating any registry call, the operator independently parses the
manifest and checks:

- exact JSON fields, integer bounds, selector order and uniqueness, route
  kinds, and migration shape;
- RPC chain id, registry address and runtime code hash, owner, and active
  predecessor hash;
- monotonic release/storage versions and storage-layout continuity;
- every facet's live code and runtime code hash, and every kernel-reserved
  selector;
- the registry-computed facet-set hash against an independently supplied
  expected new hash.

The generic lane requires these explicit values:

```sh
RPC_URL=https://...
EXPECTED_CHAIN_ID=...
PROTOCOL_FACET_REGISTRY=0x...
EXPECTED_REGISTRY_CODE_HASH=0x...
EXPECTED_REGISTRY_OWNER=0x...
EXPECTED_CURRENT_FACET_SET_HASH=0x...
EXPECTED_NEW_FACET_SET_HASH=0x...
```

Do not derive the two expected facet-set hashes during an authorization
ceremony. They are independent operator inputs approved with the release
manifest. Simulations require no private key. A broadcast additionally
requires `REGISTRY_RELEASE_PRIVATE_KEY`, and the operator verifies immediately
before sending that it derives `EXPECTED_REGISTRY_OWNER`. That live
`protocolFacetRegistryOwner` is intentionally distinct from the deployment's
historical `protocolGovernance` field.

Publication and activation are deliberately separate. Both commands simulate
and send no transaction by default:

```sh
cd packages/contracts
script/registry-release/operator.sh preflight /absolute/path/release.json
script/registry-release/operator.sh publish /absolute/path/release.json
script/registry-release/operator.sh activate /absolute/path/release.json
```

Broadcast requires both `BROADCAST=1` and an action-and-hash confirmation:

```sh
BROADCAST=1 \
CONFIRM_RELEASE_BROADCAST="publish:$EXPECTED_NEW_FACET_SET_HASH" \
script/registry-release/operator.sh publish /absolute/path/release.json

# Re-review the live published inventory before this separate decision.
BROADCAST=1 \
CONFIRM_RELEASE_BROADCAST="activate:$EXPECTED_NEW_FACET_SET_HASH" \
script/registry-release/operator.sh activate /absolute/path/release.json
```

`verify-published` checks the immutable stored metadata, ordered selector
array, and every stored route before activation. `verify-active` checks those
same commitments plus the active table after activation. Activation changes
all Boardroom routing immediately. When the storage version increases, normal
writes remain unavailable on each Boardroom until its permissionless migration
succeeds.

The target wrappers load their chain-specific environment, pin chain id, and
refuse any dirty source worktree:

```sh
script/monad-testnet/registry-release.sh preflight /absolute/path/release.json
```

Its target-specific variables use the
`MONAD_TESTNET_{PROTOCOL_FACET_REGISTRY,REGISTRY_CODE_HASH,REGISTRY_OWNER,CURRENT_FACET_SET_HASH,NEW_FACET_SET_HASH,REGISTRY_RELEASE_PRIVATE_KEY}`
names. Common generic names remain available as explicit fallbacks.

The active live inventory can be verified without a manifest or mutation:

```sh
EXPECTED_ACTIVE_FACET_SET_HASH=0x... \
script/registry-release/export-active.sh verify
```

The `export` action additionally requires
`RELEASE_INVENTORY_OUTPUT=deployments/releases/<chain>-<release>-<hash>.json`.
It records the verification block, registry/owner/release metadata, complete
ordered routes, committed code hashes, and independently read live runtime
hashes. Every state and bytecode read is pinned to the exported block number
and hash, and a block-hash change before completion invalidates the export.
The exporter reconstructs `facetSetHash` from that pinned inventory and
requires `facets`, `facetAddresses`, every `facetFunctionSelectors`, and every
`facetAddress` result to match the grouped routes exactly, including empty
arrays for a zero-selector release.
The exported `protocolFacetRegistryOwner` is live state at that pinned block,
not an assertion that the genesis owner remains unchanged.
Output is restricted to `deployments/releases/`; the script cannot
rewrite `deployments/<chain>.json`, candidate artifacts, or receipt ledgers.
Existing inventory files also require an explicit hash-bound overwrite
confirmation.

The disposable end-to-end proof starts its own Anvil instance, deploys a
no-migration release 1, proves that default publication and activation
simulations make no state change, performs confirmed local broadcasts, and
verifies the exported live inventory. It then activates an authentic empty
complete release on that no-migration lineage and verifies the zero-selector
active inventory:

```sh
cd packages/contracts
test/registry-release/operator-local-anvil.sh
```

This lane supplies operational safeguards and local evidence. It does not
remove the independent review, governance ceremony, audit, target-chain
simulation, and production-acceptance gates.

## Environment

Start from `.env.example` and provide:

```sh
PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER=0x...
PLEDGE_CASH_PROTOCOL_GOVERNANCE=0x...
PLEDGE_CASH_PROTOCOL_TREASURY=0x...
UNISWAP_V4_POOL_MANAGER=0x...
UNISWAP_UNIVERSAL_ROUTER=0x...
UNISWAP_V4_QUOTER=0x...
UNISWAP_V4_STATE_VIEW=0x...
UNISWAP_V4_POSITION_MANAGER=0x...
PERMIT2_ADDRESS=0x...
```

Monad dry runs and broadcasts require:

```sh
MONAD_TESTNET_PRIVATE_KEY=...
```

Optional overrides include:

```sh
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
MONAD_TESTNET_WRAPPED_NATIVE_ADDRESS=0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541
TOKEN_GRANT_CREATION_FEE_WEI=0
CREATE2_FACTORY_ADDRESS=0x4e59b44847b379578588920cA78FbF26c0B4956C
PLEDGE_CASH_DETERMINISTIC_DEPLOYER=0x...
```

Each wrapper checks its RPC chain id, derives the broadcaster from the private
key, requires that address to equal the deterministic-deployer owner, and
refuses a dirty source worktree.

## Dry-run simulation

Dry runs send no target-chain transaction and do not rewrite deployment
artifacts:

```sh
bun run simulate:monad-testnet
bun run simulate:testnets
```

A successful simulation is useful deployment evidence, but it is not proof
that a target chain contains the protocol.

## Testnet broadcast and candidate handling

The following commands are state-changing and require deliberate operator
authorization:

```sh
bun run deploy:monad-testnet
```

After a broadcast, the wrapper:

1. writes `<chain-id>.candidate.json`;
2. derives the inclusive discovery block and minimized successful-receipt
   ledger from Foundry's broadcast record;
3. attaches the exact 40-character source commit;
4. verifies deterministic provenance, code hashes, registry release metadata,
   all 97 release-A routes, ownership, immutable wiring, policy state, and fee
   routing against the live RPC;
5. retains the verified candidate and
   `<chain-id>.receipts.candidate.json`.

Verification does **not** overwrite `<chain-id>.json`. Promotion is a separate
release decision so a successful deployment command cannot silently replace
the repository's supported identity.

Candidate verification runs with `REQUIRE_DEPLOYMENT=1`. In that mode the
registry owner and active release must still equal the artifact's genesis
ceremony state, so a candidate cannot pass after an intervening ownership
handoff or release activation.

Monad uses its network-specific Foundry toolchain. Those operational
preconditions must be rehearsed again before the first testnet transaction;
the current pending artifacts do not prove them.

## Artifact acceptance

A promoted protocol-v1 artifact must bind at least:

- `chainId`, `protocolVersion`, exact `sourceCommit`, `deploymentBlock`, and
  `deploymentTimestamp`;
- CREATE2 factory, deterministic deployer, its owner, deterministic release
  code hash, and all deterministic root addresses;
- `protocolFacetRegistry`, `boardroomKernel`, `boardroomFactory`, controller
  factory/implementation, helper roots, five facet addresses, and their runtime
  code hashes;
- `activeFacetSetHash`, release number, required storage version/layout,
  manifest hash, kernel-selector-set hash, and selector count;
- every module factory/implementation, wrapped-native token, fee route, Pledge v4 hook, external Uniswap/Permit2
  dependency, and runtime code hash;
- explicit governed-root owners, protocol governance, and treasury.

The verifier independently reconstructs release A from locally compiled
facets, checks the canonical kernel-reserved selector set, and proves that the
artifact's complete genesis release remains published immutably. Routine
verification does not require release A to remain active or the recorded
genesis registry owner to remain current. Instead, it reads a nonzero current
owner and authenticates the live active release at one pinned block: complete
metadata and ordered routes, runtime facet code hashes, migration shape,
independent facet-set-hash reconstruction, the registry's own hash
reconstruction, and the exact `facetAddress`, `facetAddresses`,
`facetFunctionSelectors`, and `facets` loupe inventory. It accepts a valid
empty active release and rejects a block-hash change before verification
finishes. Reciprocal factory and module bindings remain checked against the
immutable deployment artifact.

The adjacent receipt ledger must identify the same chain and source commit,
contain only successful transactions, and use the earliest receipt block as
the inclusive discovery boundary. A partial or failed candidate remains
unsupported.

## Local protocol deployment

Use a fresh chain-id-31337 Anvil instance for the final deterministic
deployment rehearsal:

```sh
anvil --port 8547 --chain-id 31337
```

With a deployed local wrapped-native contract, local v4 infrastructure, and the three deployment roles configured, run
`Deploy.s.sol`:

```sh
cd packages/contracts
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
PLEDGE_CASH_PROTOCOL_GOVERNANCE=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
PLEDGE_CASH_PROTOCOL_TREASURY=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
WRAPPED_NATIVE_ADDRESS=0x... \
UNISWAP_V4_POOL_MANAGER=0x... \
UNISWAP_UNIVERSAL_ROUTER=0x... \
UNISWAP_V4_QUOTER=0x... \
UNISWAP_V4_STATE_VIEW=0x... \
UNISWAP_V4_POSITION_MANAGER=0x... \
PERMIT2_ADDRESS=0x... \
WRITE_DEPLOYMENT_STATE=true \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8547 \
  --chain 31337 \
  --always-use-create-2-factory \
  --create2-deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C \
  --broadcast \
  --slow
```

Re-running the same command is the idempotence check: existing roots must be
accepted only when their init-code commitments and live configuration match.
The ignored `deployments/31337.json` is local evidence, not a public identity.

### Sepolia fork deployment proof

The isolated Sepolia-fork gate deploys the complete protocol against the live
canonical Sepolia PoolManager, Universal Router, Quoter, StateView,
PositionManager, Permit2, wrapped-native token, and CREATE2 factory. It verifies
that every external dependency has code, records and checks the first broadcast
receipt-by-receipt, reconstructs every deterministic address and release hash,
reruns the deployment, and verifies that the canonical identity and live wiring
remain unchanged.

```sh
bun run test:sepolia-fork:deployment
```

The command requires Foundry v1.7.1 and a clean committed worktree. It defaults
to a public Sepolia RPC; set `SEPOLIA_RPC_URL` when a private or higher-capacity
endpoint is preferable. Set `SEPOLIA_FORK_BLOCK` to repeat an exact historical
fork. The child Anvil chain uses id `31337`, never broadcasts to Sepolia, keeps
all logs, candidate artifacts, and receipt evidence in a printed temporary
directory, and does not overwrite the normal local deployment artifact.

The canonical Boardroom lifecycle proof uses a separate fresh Anvil state:

```sh
LOCAL_RPC_URL=http://127.0.0.1:8547 \
bun run scenario:boardroom:local
```

It broadcasts the integrated lifecycle in phases, activates release B, proves
the pre-migration write gate, permissionlessly migrates three independent
Boardrooms, resumes cleanup and redemption, and accepts the run only after
migration is cleared and all three obligation counts are zero. Its ignored
checkpoint is `deployments/31337.boardroom.local.json`.

`SeedLocal.s.sol` can then populate the application scenario matrix against a
canonical local deployment:

```sh
LOCAL_SEED_NONCE=1 \
LOCAL_RPC_URL=http://127.0.0.1:8547 \
bun run scenario:local-seed:local
```

Local artifacts and state must be reset together. Reusing chain id `31337`
after an Anvil reset does not preserve deployment identity.

## Pre-broadcast gates

Before the first testnet broadcast, record a clean result for:

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
forge build --sizes
bun --cwd packages/sdk generate
bun --cwd packages/sdk test
bun run docs:check
bun run format:check
git diff --check
```

Also rerun the fresh-Anvil deployment, idempotence pass, standalone artifact
verifier, canonical Boardroom lifecycle, application seed, and service
integration tests. The current design report records focused local evidence;
the final full-suite acceptance ledger is still pending.
