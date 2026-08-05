# Token Grant Protocol

This document describes the escrow-backed token grant primitive in `packages/contracts/src/grants/TokenGrant.sol` and `packages/contracts/src/grants/TokenGrantFactory.sol`.

`TokenGrant` generalizes two settlement flows:

- free claim: `price == 0`, `paymentToken == address(0)`.
- paid settlement: `price > 0`, `paymentToken` is a nonzero ERC20 distinct from the grant token.

The primitive is escrow-backed only. It does not mint tokens. Issuers must mint or hold tokens first, approve
`TokenGrantFactory` for the grant amount, and then create the grant. The factory deploys the grant and pulls the escrow
tokens into it.

## Actors

- Issuer: creates the grant, escrows tokens, receives paid-settlement proceeds, may halt unvested vesting, and may withdraw remaining tokens after expiry.
- Holder: address recorded on the grant, mirrored by factory ERC721 ownership, and allowed to settle vested tokens.
- Factory: deploys deterministic token grant clones, mints and transfers grant-right ERC721 tokens, mirrors ERC721 transfers
  into the grant holder field, optionally collects a native creation fee, and stores an immutable canonical
  `BoardroomFactory` for distribution-grant provenance.
- Factory owner: authority that can update the native creation fee, rotate its independent fee recipient, and transfer
  factory ownership. The canonical deployment script assigns this role to protocol governance.
- Fee recipient: receives paid native creation fees. Factory ownership transfers do not change this address. The
  canonical deployment script points it at `ProtocolFeeRouter`, whose treasury destination is independently rotatable.

## Assets

- Grant token: ERC20 token escrowed by the issuer and delivered to the holder on settlement.
- Payment token: ERC20 token paid by the holder only when `price > 0`.
- Creation fee: optional native token fee paid by the grant issuer to the configured fee recipient when creating a
  grant.
- Grant-right NFT: ERC721 token minted by the factory. Its `tokenId` is `uint256(uint160(grantAddress))`.

The chain's native gas token is not escrowed by grants. Native value is used only for the optional creation fee, which
the factory forwards to the current `feeRecipient` during grant creation.

## Parameters

- `holder`: address initially allowed to settle and initially minted the grant-right ERC721 token.
- `token`: ERC20 escrowed by the issuer.
- `paymentToken`: ERC20 paid by the holder when `price > 0`, or zero when `price == 0`.
- `grantSize`: total token amount initially escrowed.
- `price`: payment-token smallest units per one whole grant token, or zero for a free claim.
- `expiry`: last timestamp at which settlement is allowed; it must provide at least `MIN_SETTLEMENT_GRACE` (one day)
  after `vestingEnd`.
- `vestingCliff`: timestamp before which vested amount is zero.
- `vestingEnd`: timestamp at which the full grant has vested, unless vesting was halted.
- `creationFee`: optional factory-level native fee amount.
- `transferable`: whether the factory ERC721 holder right may be transferred before expiry and close.
- `transferUnlockTime`: timestamp before which a transferable grant-right token cannot be transferred.

The local project-token scenario labels Anvil's native gas token as HYPE and explicitly directs a `0.1 HYPE` creation
fee to its project Boardroom. That is a scenario-specific revenue choice, not an effect of factory ownership and not
the canonical root deployment route.

## Testnet Deployment Status

The creation fee is chain-native and does not hard-code a gas-token symbol.
The wider root stack supplies a chain-specific wrapped-native address for
Boardroom and v4-liquidity accounting. The repository has canonical deployment
profiles for Ethereum Sepolia (`11155111`) and Base Sepolia (`84532`), but
both checked-in protocol-v1 artifacts are **pending**. The files are not
contract addresses or evidence of a live `TokenGrantFactory`. The planned
Ethereum, Base, Arbitrum, and Robinhood Chain mainnet artifacts are pending
and unauthorized as well.

The wrappers retain a candidate artifact only after verifying its live code,
wiring, policy state, authorities, release identity, and receipts. Promoting a
verified candidate is a separate release decision. See `docs/deployment.md`
for the network's dry-run, broadcast, and verification procedures.

## Lifecycle

### Create

Preconditions:

- issuer is nonzero,
- holder is nonzero,
- token is nonzero,
- grant size is greater than zero,
- vesting cliff is not after vesting end,
- expiry is at least `MIN_SETTLEMENT_GRACE` (one day) after vesting end,
- expiry is after the creation timestamp,
- for a canonical Boardroom issuer, expiry is no more than five years after creation; standalone issuers retain the
  general timing rules without this Boardroom wind-down bound,
- grant token exposes supported `decimals()`,
- issuer has approved `TokenGrantFactory` to transfer the full grant,
- if a creation fee is configured, the issuer pays exact native value equal to the fee.

`createGrantFromDistribution` is a separate nonpayable path for issued distributions. Before granting the fee exemption,
the token-grant factory requires its immutable canonical `BoardroomFactory` to recognize the issuer as a deployed
Boardroom and requires that Boardroom to recognize the caller as one of its recorded issued distributions. A contract
cannot obtain the exemption merely by implementing `isIssuedDistribution` itself. The path always uses zero creation fee
so a later factory fee update cannot censor a grant entitlement already committed in a Merkle root. Direct `createGrant`
calls continue to require the current configured fee exactly.

For `price == 0`:

- payment token must be zero.

For `price > 0`:

- payment token must be nonzero,
- payment token must differ from the grant token,
- payment token must expose supported `decimals()`.

Effects:

- factory validates exact native value equal to the configured creation fee,
- for a Boardroom-issued grant, every non-share grant token and every nonzero payment token is registered immediately
  as a redeemable Boardroom asset,
- factory deploys the grant clone at an address derived from `issuer` and `salt`,
- grant state is initialized once,
- full grant is transferred from issuer into escrow by the factory,
- when configured, the factory forwards the creation fee to `feeRecipient`,
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

When a transferable grant-right token moves, the factory calls `TokenGrant.onGrantRightTransferred()` to update
`TokenGrant.holder()` to the new ERC721 owner.

When a grant closes, `TokenGrant.holder()` is cleared to `address(0)` because no address retains settlement authority.
The factory captures the final holder, burns the grant-right ERC721, and then records that captured address in the
`GrantClosed` event.

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

### Quarantine An Expired Boardroom Grant

If a grant token mutates so that even expiry withdrawal can no longer transfer safely, the Boardroom issuer may call
`quarantineAndClose()` only after expiry. The path first attempts bounded-gas, exact-delta recovery of all remaining
escrow to the Boardroom. A healthy token therefore follows normal expiry withdrawal semantics. Only a failed or
non-exact recovery records the remaining promise in `quarantinedAmount`, closes the obligation, and burns the
grant-right NFT. It cannot be used by standalone issuers or before expiry, so it cannot forfeit live vested settlement
rights. Partially settled grants preserve their settled accounting and record only the remaining stranded promise.

## Invariants

- `settledAmount <= claimable`.
- `claimable <= grantSize`.
- vested amount never exceeds `claimable`.
- settleable amount never exceeds `claimable - settledAmount`.
- settleable amount is zero after expiry or closure.
- once halted, vested amount does not increase.
- live grant-right ERC721 owner equals the grant-local holder authority.
- soulbound grant-right ERC721 tokens cannot be transferred or approved per-token.
- transferable grant-right ERC721 tokens cannot move before their transfer unlock time.
- grant lifecycle transitions lock transferable grant-right ERC721 movement during external token calls.
- grant-right ERC721 ownership does not silently disappear at expiry.
- settlement accepts only the current holder address; unrelated callers cannot settle.
- issuer-only transitions accept only the configured issuer address; unrelated callers cannot invoke them.
- issuer and holder are address-based roles, not mutually exclusive identities; one address can satisfy both gates.
- only a canonical Boardroom issuer can quarantine a grant, and only after settlement rights have expired.
- a non-share grant asset that returns on halt or expiry remains inside the Boardroom redemption basket.
- `price == 0` grants never call a payment token.
- `price > 0` payment cost is rounded up to the nearest payment-token smallest unit.
- configured native creation fees must be paid exactly.
- distribution-created grants are always fee-exempt and nonpayable.
- the immutable canonical Boardroom factory and issuer-side distribution tracking gate every fee-exempt grant creation.
- creation fee configuration can only be updated by the factory owner.
- creation-fee destination can only be updated by the factory owner, and ownership transfer does not implicitly change
  it.
- after expiry withdrawal, no further settlement succeeds.

## External Call Failure Model

Grant funding, payment, delivery, halt-return, and expiry-return paths verify both the exact sender decrease and exact
recipient increase. Native creation fee forwarding reverts if the configured recipient cannot receive native value.
Grant lifecycle
transitions temporarily lock the factory ERC721 token before ERC20 external calls, preventing malicious token callbacks
from transferring the holder right mid-settlement or mid-withdrawal.

Current token behavior policy:

- missing return values are supported when exact balance deltas match the requested transfer amount,
- false-return tokens are rejected by safe transfer handling,
- fee-on-transfer and sender-surcharge tokens are rejected by exact two-sided balance-delta checks,
- rebasing tokens are unsupported; asynchronous rebases remain a higher-level token-policy risk,
- tokens with unsupported decimals are rejected at initialization,
- `price == 0` has no payment token external call,
- native creation fee forwarding reverts if the configured recipient cannot receive native value.
