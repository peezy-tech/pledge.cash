// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Keccak-256 commitments to the human-readable release specifications
/// in `docs/design/boardroom-diamond-release-{a,b}.md`.
library BoardroomManifestHashes {
    bytes32 internal constant RELEASE_A = 0x49203191b8b3958946efa6e4da2562dc1a9af4c7a75855751c8abd05505025ab;
    bytes32 internal constant RELEASE_B = 0xe50a0e6d677c939d5767190157bb3955f3da8fe3ebb86400077e3a99ff659934;
}
