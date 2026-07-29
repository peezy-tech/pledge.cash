// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Boardroom} from "../Boardroom.sol";
import {BoardroomAssetStorage} from "../storage/BoardroomAssetStorage.sol";
import {BoardroomCoreStorage} from "../storage/BoardroomCoreStorage.sol";
import {BestEffortTokenLib} from "../../lib/BestEffortTokenLib.sol";
import {BoardroomDiamondStorage} from "./BoardroomDiamondStorage.sol";
import {BoardroomTokenVNext} from "./BoardroomTokenVNext.sol";
import {LegacyBoardroomFacet} from "./LegacyBoardroomFacet.sol";

contract BoardroomAuthorityFacet is LegacyBoardroomFacet {
    uint256 internal constant POLICY_REGISTRY_SLOT = 0;
    uint256 internal constant SHARE_TOKEN_SLOT = 1;
    uint256 internal constant WRAPPED_NATIVE_SLOT = 2;
    uint256 internal constant REDEMPTION_EXCESS_RECIPIENT_SLOT = 3;
    bytes32 internal constant OWNER_SLOT = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff74873927;
    uint64 internal constant INITIAL_WIND_DOWN_DELAY = 1 days;

    error InvalidInitializationContext();
    error InvalidAddress();
    error InvalidRedeemableAsset(address asset);

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    constructor(address legacyBoardroomLogic_) LegacyBoardroomFacet(legacyBoardroomLogic_) {}

    function initializeBoardroom(bytes32, bytes calldata initializationData) external {
        if (!BoardroomDiamondStorage.layout().initializing) revert InvalidInitializationContext();
        (address owner_, address policyRegistry_, address wrappedNative_, string memory name_, string memory symbol_) =
            abi.decode(initializationData, (address, address, address, string, string));
        if (
            owner_ == address(0) || policyRegistry_ == address(0) || policyRegistry_.code.length == 0
                || wrappedNative_ == address(0) || wrappedNative_.code.length == 0
        ) revert InvalidAddress();

        assembly ("memory-safe") {
            sstore(OWNER_SLOT, owner_)
        }
        emit OwnershipTransferred(address(0), owner_);
        BoardroomTokenVNext token = new BoardroomTokenVNext(address(this), name_, symbol_);
        address tokenAddress = address(token);
        assembly ("memory-safe") {
            sstore(POLICY_REGISTRY_SLOT, policyRegistry_)
            sstore(SHARE_TOKEN_SLOT, tokenAddress)
            sstore(WRAPPED_NATIVE_SLOT, wrappedNative_)
            sstore(REDEMPTION_EXCESS_RECIPIENT_SLOT, owner_)
        }

        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        core.governanceEpoch = 1;
        core.windDownDelay = INITIAL_WIND_DOWN_DELAY;
        (bool readable,) = BestEffortTokenLib.tryBalanceOf(wrappedNative_, address(this));
        if (!readable) revert InvalidRedeemableAsset(wrappedNative_);
        BoardroomAssetStorage.Layout storage assets = BoardroomAssetStorage.layout();
        assets.everRegistered[wrappedNative_] = true;
        assets.isRegistered[wrappedNative_] = true;
        assets.registry.push(wrappedNative_);

        emit Boardroom.BoardroomInitialized(owner_, policyRegistry_, tokenAddress, wrappedNative_, name_, symbol_);
        emit Boardroom.RedemptionExcessRecipientSet(owner_);
        emit Boardroom.RedeemableAssetRegistered(wrappedNative_);
    }

    function transferOwnership(bytes32, address) external payable {
        _delegateLegacy(Boardroom.transferOwnership.selector);
    }

    function completeOwnershipHandover(bytes32, address) external payable {
        _delegateLegacy(Boardroom.completeOwnershipHandover.selector);
    }

    function requestOwnershipHandover(bytes32) external payable {
        _delegateLegacy(Boardroom.requestOwnershipHandover.selector);
    }

    function cancelOwnershipHandover(bytes32) external payable {
        _delegateLegacy(Boardroom.cancelOwnershipHandover.selector);
    }

    function renounceOwnership(bytes32) external payable {
        _delegateLegacy(Boardroom.renounceOwnership.selector);
    }

    function launch(bytes32, Boardroom.LaunchConfig calldata) external {
        _delegateLegacy(Boardroom.launch.selector);
    }

    function replaceController(bytes32, address, address, address, uint64, uint64, uint64) external {
        _delegateLegacy(Boardroom.replaceController.selector);
    }

    function veto(bytes32, bytes32) external {
        _delegateLegacy(Boardroom.veto.selector);
    }

    function mint(bytes32, address, uint256) external {
        _delegateLegacy(Boardroom.mint.selector);
    }

    function setRedemptionExcessRecipient(bytes32, address) external {
        _delegateLegacy(Boardroom.setRedemptionExcessRecipient.selector);
    }

    function startWindDown(bytes32) external {
        _delegateLegacy(Boardroom.startWindDown.selector);
    }
}
