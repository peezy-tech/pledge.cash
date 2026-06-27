# Boardroom Protocol

This document describes the first Boardroom primitive in `packages/contracts/src/Boardroom.sol`,
`BoardroomFactory.sol`, and `BoardroomToken.sol`.

A Boardroom is an owned on-chain treasury and issuer account with its own ERC20 share token. It can mint shares and
execute calls through centrally approved policy contracts. `TokenGrantFactory` is the first Boardroom call policy.

## Actors

- Boardroom owner: controls share minting and policy-authorized treasury execution.
- Boardroom: owns assets, creates its share token, and acts as grant issuer.
- Policy registry: protocol-controlled allowlist of policy contracts that Boardrooms may use.
- Policy contract: validates whether a Boardroom may call a target contract with specific calldata.
- Share holder: receives Boardroom share tokens directly or through grants.
- Grant holder: receives settlement authority over a Boardroom-issued grant.

## Assets

- Boardroom share token: ERC20 minted only by its Boardroom.
- Grant token escrow: ERC20 tokens held by the Boardroom and transferred into a `TokenGrant`.
- Payment token: optional ERC20 paid to the Boardroom when settling a paid grant.
- Native creation fee: optional fee forwarded through the Boardroom to `TokenGrantFactory`.

## State Machines

### BoardroomFactory

`BoardroomFactory` creates deterministic Boardroom clones and records them. The clone salt is bound to the Boardroom
owner, share token name, share token symbol, and caller-provided salt.

State:

- `policyRegistry`: policy registry used by every Boardroom clone.
- `boardroomLogic`: implementation cloned by the factory.
- `allBoardrooms`: created Boardroom list.
- `isBoardroom`: created Boardroom membership check.

### Boardroom

`Boardroom` has one owner, one policy registry, and one share token.

State:

- `policyRegistry`: protocol-controlled registry of allowed call policies.
- `shareToken`: ERC20 minted only by this Boardroom.

The owner can mint shares through `Boardroom.mint`. The owner can also call `Boardroom.execute` or
`Boardroom.executeBatch`. Each call names a policy, target, native value, and calldata. The Boardroom first checks that
the registry allows the policy, then asks the policy whether the target call is allowed. If both checks pass, the
Boardroom performs the external call and emits a generic execution event.

### BoardroomToken

`BoardroomToken` is a standard ERC20 with immutable `boardroom` authority. Only the Boardroom can mint it.

## Grant Issuance Flow

1. Owner ensures the Boardroom holds the ERC20 token to be granted.
2. Owner builds a `Boardroom.executeBatch` with two policy-checked calls.
3. The first call targets the grant token and approves `TokenGrantFactory` for the grant amount.
4. The second call targets `TokenGrantFactory.createGrant(...)`, optionally forwarding the exact native creation fee.
5. `TokenGrantFactory` creates a grant where `issuer == boardroom`.
6. `TokenGrantFactory` transfers the grant tokens from the Boardroom into the grant escrow.
7. The factory mints the grant-right ERC721 token to the grant holder.

For paid grants, settlement payment tokens are transferred to the Boardroom. The Boardroom owner can then use other
registry-approved policies to deploy or spend those proceeds. For example, the Boardroom can sell share grants for USDC
and later create free USDC payroll grants through the same policy-gated batch execution surface.

## Invariants

- Only the Boardroom can mint its share token.
- Only the Boardroom owner can mint shares through the Boardroom.
- Boardroom execution requires a policy allowed by the central registry.
- Boardroom execution requires the selected policy to allow the target, value, and calldata.
- Boardroom-created grants approve `TokenGrantFactory` as spender for the requested grant amount.
- A Boardroom-issued grant must have `issuer == boardroom`.
- Boardroom-issued grants escrow tokens from the Boardroom before holders can settle.
- Native grant creation fees can be forwarded, but the Boardroom should not retain them.

## Deterministic Proof

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
cd packages/contracts && forge fmt --check
```
