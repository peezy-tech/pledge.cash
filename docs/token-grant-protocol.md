# Token Grant Protocol

This document describes the escrow-backed token grant primitive in `packages/contracts/src/TokenGrant.sol` and `packages/contracts/src/TokenGrantFactory.sol`.

`TokenGrant` generalizes two settlement flows:

- free claim: `price == 0`, `paymentToken == address(0)`.
- paid settlement: `price > 0`, `paymentToken` is a nonzero ERC20 distinct from the grant token.

The primitive is escrow-backed only. It does not mint tokens. Issuers must mint or hold tokens first, approve the predicted grant clone, and then create the grant.

## Actors

- Issuer: creates the grant, escrows tokens, receives paid-settlement proceeds, may halt unvested vesting, and may withdraw remaining tokens after expiry.
- Holder: address recorded on the grant, mirrored by factory ERC721 ownership, and allowed to settle vested tokens.
- Factory: deploys deterministic token grant clones, mints and transfers grant-right ERC721 tokens, mirrors ERC721 transfers
  into the grant holder field, and optionally collects a native creation fee.
- Factory owner: deployer authority that can update the native creation fee and receives paid creation fees.

## Assets

- Grant token: ERC20 token escrowed by the issuer and delivered to the holder on settlement.
- Payment token: ERC20 token paid by the holder only when `price > 0`.
- Creation fee: optional native token fee paid by the grant issuer to the factory owner when creating a grant.
- Grant-right NFT: ERC721 token minted by the factory. Its `tokenId` is `uint256(uint160(grantAddress))`.

Native HYPE is not escrowed by grants. It is only used for the optional creation fee, which the factory forwards to the owner during grant creation.

## Parameters

- `holder`: address initially allowed to settle and initially minted the grant-right ERC721 token.
- `token`: ERC20 escrowed by the issuer.
- `paymentToken`: ERC20 paid by the holder when `price > 0`, or zero when `price == 0`.
- `grantSize`: total token amount initially escrowed.
- `price`: payment-token smallest units per one whole grant token, or zero for a free claim.
- `expiry`: last timestamp at which settlement is allowed.
- `vestingCliff`: timestamp before which vested amount is zero.
- `vestingEnd`: timestamp at which the full grant has vested, unless vesting was halted.
- `creationFee`: optional factory-level native fee amount.
- `transferable`: whether the factory ERC721 holder right may be transferred before expiry and close.
- `transferUnlockTime`: timestamp before which a transferable grant-right token cannot be transferred.

The initial project-token launch scenario uses a `0.1 HYPE` creation fee,
sent to the factory owner.

## HyperEVM Testnet

The rewrite deployment target is HyperEVM testnet:

- Chain id: `998`
- Default RPC: `https://rpc.hyperliquid-testnet.xyz/evm`
- Public page: `https://pledge.cash/`
- Deployment artifact: `packages/contracts/deployments/998.json`

Dry-run deployment:

```sh
bun run simulate:hyperevm-testnet
```

Broadcast deployment:

```sh
BROADCAST=1 bun --cwd packages/contracts deploy:hyperevm-testnet
```

The wrapper refuses RPC endpoints that do not report chain id `998`. Broadcasts
require `HYPEREVM_TESTNET_PRIVATE_KEY` or `PRIVATE_KEY`. Foundry writes the
deployment artifact during the broadcast script run, so verify the artifact
against on-chain bytecode before publishing it.

## Lifecycle

### Create

Preconditions:

- issuer is nonzero,
- holder is nonzero,
- token is nonzero,
- grant size is greater than zero,
- vesting cliff is not after vesting end,
- expiry is not before vesting end,
- expiry is after the creation timestamp,
- grant token exposes supported `decimals()`,
- issuer has approved the predicted grant clone to transfer the full grant,
- if a creation fee is configured, the issuer pays exact native value equal to the fee.

For `price == 0`:

- payment token must be zero.

For `price > 0`:

- payment token must be nonzero,
- payment token must differ from the grant token,
- payment token must expose supported `decimals()`.

Effects:

- factory validates exact native value equal to the configured creation fee,
- grant state is initialized once,
- full grant is transferred into escrow,
- when configured, the factory forwards the creation fee to the owner,
- factory records the token id to grant clone mapping,
- factory mints the grant-right ERC721 token to the holder,
- creation event is emitted by the factory.

If initialization, escrow transfer, native fee forwarding, or grant-right minting fails, the whole creation transaction
reverts atomically.

### Grant Right

The factory mints a grant-right ERC721 token to the holder. The grant stores the protocol holder locally, and factory
ERC721 transfers synchronize that holder after each successful live transfer. While the grant is live, the protocol
invariant is `factory.ownerOf(tokenId) == TokenGrant(grant).holder()`.

Non-transferable grants reject ERC721 transfers and per-token approvals.

Transferable grants can move only when:

- the grant is not closed,
- the grant is not expired,
- the grant is not temporarily locked by a grant lifecycle transition,
- `block.timestamp >= transferUnlockTime`.

When a transferable grant-right token moves, the factory updates `TokenGrant.holder()` to the new ERC721 owner.

When a grant closes, `TokenGrant.holder()` is cleared to `address(0)` because no address retains settlement authority.
The final holder is recorded in the factory `GrantClosed` event emitted before the ERC721 burn.

### Settle

Preconditions:

- caller is current factory ERC721 owner for the grant token id,
- grant is not expired,
- grant is not closed,
- amount requested is greater than zero,
- requested total does not exceed `claimable`,
- requested amount does not exceed currently vested and unsettled amount.

Effects:

- `settledAmount` increases by requested amount,
- when `price > 0`, payment token transfers from holder to issuer,
- grant token transfers from escrow to holder,
- if the grant becomes fully settled, the grant marks itself closed and the factory burns the grant-right ERC721 token,
- settlement event records holder, issuer, token amount, and payment amount.

### Halt Vesting

Preconditions:

- caller is issuer,
- grant is not closed,
- vesting has not already been halted.

Effects:

- vested amount is snapshotted,
- `claimable` becomes the vested amount at halt,
- unvested grant tokens return to issuer,
- if no unsettled claim remains, the grant marks itself closed and the factory burns the grant-right ERC721 token,
- future vesting remains capped forever.

### Withdraw Expired

Preconditions:

- caller is issuer,
- grant is not closed,
- grant is past expiry.

Effects:

- remaining grant token escrow returns to issuer,
- grant marks itself closed and the factory burns the grant-right ERC721 token.

## Invariants

- `settledAmount <= claimable`.
- `claimable <= grantSize`.
- vested amount never exceeds `claimable`.
- settleable amount never exceeds `claimable - settledAmount`.
- once halted, vested amount does not increase.
- live grant-right ERC721 owner equals the grant-local holder authority.
- soulbound grant-right ERC721 tokens cannot be transferred or approved per-token.
- transferable grant-right ERC721 tokens cannot move before their transfer unlock time.
- grant lifecycle transitions lock transferable grant-right ERC721 movement during external token calls.
- grant-right ERC721 ownership does not silently disappear at expiry.
- holder-only settlement cannot be called by issuer or random callers.
- issuer-only transitions cannot be called by holder or random callers.
- `price == 0` grants never call a payment token.
- `price > 0` payment cost is rounded up to the nearest payment-token smallest unit.
- configured native creation fees must be paid exactly.
- creation fee configuration can only be updated by the factory owner.
- after expiry withdrawal, no further settlement succeeds.

## External Call Failure Model

The grant token transfer paths use exact recipient balance-delta checks. Native creation fee forwarding reverts if the
owner cannot receive native value. Grant lifecycle transitions temporarily lock the factory ERC721 token before ERC20
external calls, preventing malicious token callbacks from transferring the holder right mid-settlement or mid-withdrawal.

Current token behavior policy:

- missing return values are supported when exact balance deltas match the requested transfer amount,
- false-return tokens are rejected by safe transfer handling,
- fee-on-transfer tokens are rejected by exact recipient balance-delta checks,
- rebasing tokens are unsupported; asynchronous rebases remain a higher-level token-policy risk,
- tokens with unsupported decimals are rejected at initialization,
- `price == 0` has no payment token external call,
- native creation fee forwarding reverts if the owner cannot receive native value.
