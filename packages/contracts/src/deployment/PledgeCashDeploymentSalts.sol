// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Boardroom} from "../boardroom/Boardroom.sol";
import {BoardroomFactory} from "../boardroom/BoardroomFactory.sol";
import {BoardroomToken} from "../boardroom/BoardroomToken.sol";
import {ProtocolFeeRouter} from "../fees/ProtocolFeeRouter.sol";
import {TokenGrantFactory} from "../grants/TokenGrantFactory.sol";
import {PledgeV4LiquidityFactory} from "../uniswap/PledgeV4LiquidityFactory.sol";
import {PledgeCashDeterministicDeployer} from "./PledgeCashDeterministicDeployer.sol";

/// @notice Bytecode-bound salts for the sole canonical pledge.cash protocol release.
/// @dev A changed creation bytecode hash necessarily yields a different CREATE3 salt.
/// Constructor arguments remain protected by `PledgeCashDeterministicDeployer`'s
/// first-use init-code commitment for that salt.
library PledgeCashDeploymentSalts {
    string internal constant VERSION = "pledge.cash.protocol.v1";

    function version() internal pure returns (string memory) {
        return VERSION;
    }

    function deterministicDeployer() internal pure returns (bytes32) {
        return
            _releaseSalt(
                "PledgeCashDeterministicDeployer", keccak256(type(PledgeCashDeterministicDeployer).creationCode)
            );
    }

    function boardroomFactory() internal pure returns (bytes32) {
        return _releaseSalt("BoardroomFactory", keccak256(type(BoardroomFactory).creationCode));
    }

    function protocolFeeRouter() internal pure returns (bytes32) {
        return _releaseSalt("ProtocolFeeRouter", keccak256(type(ProtocolFeeRouter).creationCode));
    }

    function tokenGrantFactory() internal pure returns (bytes32) {
        return _releaseSalt("TokenGrantFactory", keccak256(type(TokenGrantFactory).creationCode));
    }

    function pledgeV4LiquidityFactory() internal pure returns (bytes32) {
        return _releaseSalt("PledgeV4LiquidityFactory", keccak256(type(PledgeV4LiquidityFactory).creationCode));
    }

    function boardroomArchitectureCodeHash() internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(Boardroom).creationCode),
                keccak256(type(BoardroomFactory).creationCode),
                keccak256(type(BoardroomToken).creationCode)
            )
        );
    }

    function moduleArchitectureCodeHash() internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(ProtocolFeeRouter).creationCode),
                keccak256(type(TokenGrantFactory).creationCode),
                keccak256(type(PledgeV4LiquidityFactory).creationCode)
            )
        );
    }

    function releaseCodeHash() internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(PledgeCashDeterministicDeployer).creationCode),
                boardroomArchitectureCodeHash(),
                moduleArchitectureCodeHash()
            )
        );
    }

    function _releaseSalt(string memory contractName, bytes32 creationCodeHash) private pure returns (bytes32) {
        return keccak256(abi.encode(VERSION, contractName, creationCodeHash));
    }
}
