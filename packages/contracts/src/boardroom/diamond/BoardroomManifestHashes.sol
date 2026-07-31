// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Keccak-256 commitments to the human-readable release specifications
/// in `docs/design/boardroom-diamond-release-{a,b}.md`.
library BoardroomManifestHashes {
    bytes32 internal constant RELEASE_A = 0x8c199ca4a93cc6a29d722c2ce418a72bd7176687a477b13d66cb1f750fa3d224;
    bytes32 internal constant RELEASE_B = 0x505052ba0730f40bbbd440574f00a3d707a9d604ae74b6bfe0f91ac45c02dd0e;
}
