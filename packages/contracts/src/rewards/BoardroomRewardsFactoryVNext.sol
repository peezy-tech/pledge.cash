// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {IBoardroomObligationPolicy} from "../policy/IBoardroomObligationPolicy.sol";
import {BoardroomVNextCallbackLib} from "../policy/BoardroomVNextCallbackLib.sol";
import {BoardroomRewards} from "./BoardroomRewards.sol";

interface IBoardroomRewardsFactoryVNextBoardroom {
    function shareToken() external view returns (address);
    function status() external view returns (uint8);
}

interface IBoardroomRewardsFactoryVNextBoardroomFactory {
    function isBoardroom(address boardroom) external view returns (bool);
}

contract BoardroomRewardsFactoryVNext is IBoardroomObligationPolicy {
    uint8 internal constant BOARDROOM_STATUS_ACTIVE = 0;
    uint256 internal constant CREATE_DATA_LENGTH = 4 + 32 * 2;
    uint256 internal constant FUND_DATA_LENGTH = 4 + 32 * 4;

    address public immutable boardroomFactory;
    address public immutable rewardsLogic;

    mapping(address => address) public rewardsForBoardroom;
    mapping(address => bool) public isRewards;
    mapping(address => address) public rewardsBoardroom;

    error InvalidAddress();
    error InvalidBoardroom(address boardroom);
    error RewardsAlreadyCreated(address boardroom, address rewards);
    error InvalidRewards(address rewards);
    error InvalidRewardAsset(address asset);
    error InvalidAmount();
    error UnexpectedTokenBalanceChange(address token, uint256 expected, uint256 actual);

    event BoardroomRewardsCreated(
        address indexed rewards, address indexed boardroom, address indexed shareToken, uint256 cooldown, bytes32 salt
    );
    event BoardroomRewardFunded(
        address indexed rewards, address indexed boardroom, address indexed asset, uint256 amount, uint256 duration
    );

    constructor(address boardroomFactory_) {
        if (boardroomFactory_ == address(0) || boardroomFactory_.code.length == 0) revert InvalidAddress();
        boardroomFactory = boardroomFactory_;
        rewardsLogic = address(new BoardroomRewards());
    }

    function createRewards(uint64 cooldown, bytes32 salt) external returns (address rewards) {
        address boardroom = msg.sender;
        _requireBoardroom(boardroom);
        address existing = rewardsForBoardroom[boardroom];
        if (existing != address(0)) revert RewardsAlreadyCreated(boardroom, existing);

        address shareToken = IBoardroomRewardsFactoryVNextBoardroom(boardroom).shareToken();
        rewards = LibClone.cloneDeterministic(rewardsLogic, _cloneSalt(boardroom, salt));
        BoardroomRewards(rewards).initialize(boardroom, shareToken, cooldown);
        rewardsForBoardroom[boardroom] = rewards;
        rewardsBoardroom[rewards] = boardroom;
        isRewards[rewards] = true;

        emit BoardroomRewardsCreated(rewards, boardroom, shareToken, cooldown, salt);
    }

    function fundReward(address rewards, address asset, uint256 amount, uint256 duration) external {
        address boardroom = msg.sender;
        _requireBoardroom(boardroom);
        if (rewardsBoardroom[rewards] != boardroom) revert InvalidRewards(rewards);
        if (asset == address(0) || asset == IBoardroomRewardsFactoryVNextBoardroom(boardroom).shareToken()) {
            revert InvalidRewardAsset(asset);
        }
        if (amount == 0) revert InvalidAmount();

        BoardroomVNextCallbackLib.reserveRedeemableAsset(boardroom, asset);
        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.pullBetween(asset, boardroom, rewards, amount);
        if (delta.senderBalanceIncreased || delta.senderSpent != amount) {
            revert UnexpectedTokenBalanceChange(asset, amount, delta.senderSpent);
        }
        if (delta.recipientBalanceDecreased || delta.recipientReceived != amount) {
            revert UnexpectedTokenBalanceChange(asset, amount, delta.recipientReceived);
        }

        BoardroomRewards(rewards).notifyRewardAmount(asset, amount, duration);
        emit BoardroomRewardFunded(rewards, boardroom, asset, amount, duration);
    }

    function canCall(address boardroom, address, address target, uint256 value, bytes calldata data)
        external
        view
        returns (bool)
    {
        if (value != 0) return false;
        bytes4 selector = _selector(data);
        if (target == address(this)) {
            if (selector == BoardroomRewardsFactoryVNext.createRewards.selector) {
                return data.length == CREATE_DATA_LENGTH && rewardsForBoardroom[boardroom] == address(0)
                    && _isActiveBoardroom(boardroom);
            }
            if (selector == BoardroomRewardsFactoryVNext.fundReward.selector && data.length == FUND_DATA_LENGTH) {
                (address rewards, address asset, uint256 amount, uint256 duration) =
                    abi.decode(data[4:], (address, address, uint256, uint256));
                return rewardsBoardroom[rewards] == boardroom && asset != address(0)
                    && asset != IBoardroomRewardsFactoryVNextBoardroom(boardroom).shareToken() && amount != 0
                    && duration >= BoardroomRewards(rewards).MIN_REWARD_DURATION()
                    && duration <= BoardroomRewards(rewards).MAX_REWARD_DURATION() && _isActiveBoardroom(boardroom);
            }
            return false;
        }

        return rewardsBoardroom[target] == boardroom && selector == BoardroomRewards.terminalize.selector;
    }

    function obligationForCall(address, address target, uint256, bytes calldata data, bytes calldata result)
        external
        view
        returns (Obligation memory obligation)
    {
        if (
            target != address(this) || data.length != CREATE_DATA_LENGTH || result.length != 32
                || _selector(data) != BoardroomRewardsFactoryVNext.createRewards.selector
        ) return obligation;

        address rewards = abi.decode(result, (address));
        obligation.kind = ObligationKind.Reward;
        obligation.account = rewards;
    }

    function isLifecycleCallAllowed(address boardroom, address target, bytes4 selector) external view returns (bool) {
        return rewardsBoardroom[target] == boardroom && selector == BoardroomRewards.terminalize.selector;
    }

    function predictRewardsAddress(address boardroom, bytes32 salt) external view returns (address) {
        return LibClone.predictDeterministicAddress(rewardsLogic, _cloneSalt(boardroom, salt), address(this));
    }

    function _requireBoardroom(address boardroom) internal view {
        if (!IBoardroomRewardsFactoryVNextBoardroomFactory(boardroomFactory).isBoardroom(boardroom)) {
            revert InvalidBoardroom(boardroom);
        }
        if (!_isActiveBoardroom(boardroom)) revert InvalidBoardroom(boardroom);
    }

    function _isActiveBoardroom(address boardroom) internal view returns (bool) {
        if (!IBoardroomRewardsFactoryVNextBoardroomFactory(boardroomFactory).isBoardroom(boardroom)) return false;
        try IBoardroomRewardsFactoryVNextBoardroom(boardroom).status() returns (uint8 status) {
            return status == BOARDROOM_STATUS_ACTIVE;
        } catch {
            return false;
        }
    }

    function _cloneSalt(address boardroom, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(boardroom, salt));
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }
}
