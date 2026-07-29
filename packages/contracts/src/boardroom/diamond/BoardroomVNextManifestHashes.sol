// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Keccak-256 commitments to the human-readable release specifications
/// in `docs/design/boardroom-diamond-release-{a,b}.md`.
library BoardroomVNextManifestHashes {
    bytes32 internal constant RELEASE_A = 0x42f9307e89ac60cc7fd7c2d98ec0064876f13c0ebfa64aee8fb272f03d600deb;
    bytes32 internal constant RELEASE_B = 0x480533d1aec981866c51057fe59217f34407bc3b3a2cd963921fcda33f43a5ff;
}
