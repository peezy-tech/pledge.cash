// // SPDX-License-Identifier: MIT
// pragma solidity ^0.8.10;

// import {IPool} from '@aave/core-v3/contracts/interfaces/IPool.sol';
// import {IPoolAddressesProvider} from '@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol';
// import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
// import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

// contract AavePositionTracker {
//     using SafeERC20 for IERC20;

//     IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
//     IPool public immutable POOL;

//     // Mapping to track user's supplied assets
//     mapping(address => mapping(address => uint256)) public userSupplies;
//     // Mapping to track user's borrowed assets
//     mapping(address => mapping(address => uint256)) public userBorrows;

//     // Events
//     event AssetSupplied(address indexed user, address indexed asset, uint256 amount);
//     event AssetBorrowed(address indexed user, address indexed asset, uint256 amount, uint256 interestRateMode);
//     event AssetWithdrawn(address indexed user, address indexed asset, uint256 amount);
//     event AssetRepaid(address indexed user, address indexed asset, uint256 amount, uint256 interestRateMode);

//     constructor(address addressesProvider) {
//         ADDRESSES_PROVIDER = IPoolAddressesProvider(addressesProvider);
//         POOL = IPool(ADDRESSES_PROVIDER.getPool());
//     }

//     /**
//      * @dev Supply assets to Aave
//      * @param asset The address of the asset to supply
//      * @param amount The amount to supply
//      */
//     function supplyAsset(address asset, uint256 amount) external {
//         require(amount > 0, "Amount must be greater than 0");
        
//         // Transfer asset from user to this contract
//         IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        
//         // Approve Aave pool to spend the asset
//         IERC20(asset).safeApprove(address(POOL), amount);
        
//         // Supply to Aave
//         POOL.supply(asset, amount, address(this), 0);
        
//         // Update user's supply tracking
//         userSupplies[msg.sender][asset] += amount;
        
//         emit AssetSupplied(msg.sender, asset, amount);
//     }

//     /**
//      * @dev Borrow assets from Aave
//      * @param asset The address of the asset to borrow
//      * @param amount The amount to borrow
//      * @param interestRateMode The interest rate mode (1 for stable, 2 for variable)
//      */
//     function borrowAsset(address asset, uint256 amount, uint256 interestRateMode) external {
//         require(amount > 0, "Amount must be greater than 0");
//         require(interestRateMode == 1 || interestRateMode == 2, "Invalid interest rate mode");
        
//         // Borrow from Aave
//         POOL.borrow(asset, amount, interestRateMode, 0, address(this));
        
//         // Update user's borrow tracking
//         userBorrows[msg.sender][asset] += amount;
        
//         // Transfer borrowed assets to user
//         IERC20(asset).safeTransfer(msg.sender, amount);
        
//         emit AssetBorrowed(msg.sender, asset, amount, interestRateMode);
//     }

//     /**
//      * @dev Withdraw supplied assets from Aave
//      * @param asset The address of the asset to withdraw
//      * @param amount The amount to withdraw
//      */
//     function withdrawAsset(address asset, uint256 amount) external {
//         require(amount > 0, "Amount must be greater than 0");
//         require(userSupplies[msg.sender][asset] >= amount, "Insufficient supply balance");
        
//         // Withdraw from Aave
//         POOL.withdraw(asset, amount, address(this));
        
//         // Update user's supply tracking
//         userSupplies[msg.sender][asset] -= amount;
        
//         // Transfer assets back to user
//         IERC20(asset).safeTransfer(msg.sender, amount);
        
//         emit AssetWithdrawn(msg.sender, asset, amount);
//     }

//     /**
//      * @dev Repay borrowed assets to Aave
//      * @param asset The address of the asset to repay
//      * @param amount The amount to repay
//      * @param interestRateMode The interest rate mode (1 for stable, 2 for variable)
//      */
//     function repayAsset(address asset, uint256 amount, uint256 interestRateMode) external {
//         require(amount > 0, "Amount must be greater than 0");
//         require(userBorrows[msg.sender][asset] >= amount, "Amount exceeds borrow balance");
        
//         // Transfer repayment amount from user to this contract
//         IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        
//         // Approve Aave pool to spend the asset
//         IERC20(asset).safeApprove(address(POOL), amount);
        
//         // Repay to Aave
//         POOL.repay(asset, amount, interestRateMode, address(this));
        
//         // Update user's borrow tracking
//         userBorrows[msg.sender][asset] -= amount;
        
//         emit AssetRepaid(msg.sender, asset, amount, interestRateMode);
//     }

//     /**
//      * @dev Get user's current supply balance for an asset
//      * @param user The user address
//      * @param asset The asset address
//      */
//     function getSupplyBalance(address user, address asset) external view returns (uint256) {
//         return userSupplies[user][asset];
//     }

//     /**
//      * @dev Get user's current borrow balance for an asset
//      * @param user The user address
//      * @param asset The asset address
//      */
//     function getBorrowBalance(address user, address asset) external view returns (uint256) {
//         return userBorrows[user][asset];
//     }
// }