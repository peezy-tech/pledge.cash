// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {DN404} from "dn404/DN404.sol";
import "forge-std/Test.sol";
import {DN404Mirror} from "dn404/DN404Mirror.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {LibString} from "solady/utils/LibString.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

interface IERC20 {
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract WrappedDN404 is DN404, Ownable, Test {
    string private _name;
    string private _symbol;
    string private _baseURI;

    IERC20 public immutable underlying;
    uint8 private immutable _decimals;

    // TODO: enforce. we can enforce by overriding onNftTransfer i think
    uint256 public maxNftBalance; // this is not working ON TRANSFER. 

    event Deposit(address indexed from, uint256 amount);
    event Withdraw(address indexed to, uint256 amount);

    function owned(address owner) public view returns (uint256[] memory) {
        uint256 nftBal = _balanceOfNFT(owner);
        return _ownedIds(owner, 0, nftBal);
    }

    function price() public view returns (uint256) {
        return _unit();
    }

    function _unit() internal view override returns (uint256) {
        return 5 * (10 ** _decimals);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address underlyingToken
    ) {
        require(underlyingToken != address(0), "Invalid underlying token");
        _initializeOwner(msg.sender);

        _name = name_;
        _symbol = symbol_;
        underlying = IERC20(underlyingToken);
        maxNftBalance = 5;

        address mirror = address(new DN404Mirror(msg.sender));

        _decimals = underlying.decimals();
        _initializeDN404(0, msg.sender, mirror);
    }

    function setSkipNFT(bool skipNFT) public override returns (bool) {
        revert();
    }

    function _skipNFTDefault() internal pure override returns (SkipNFTDefault) {
        return SkipNFTDefault.On;
    }

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }

    function _tokenURI(
        uint256 tokenId
    ) internal view override returns (string memory result) {
        if (bytes(_baseURI).length != 0) {
            result = string(
                abi.encodePacked(_baseURI, LibString.toString(tokenId))
            );
        }
    }

    // function afterNFtTokenTRansfe() {check if nft balance of receiver is bigger than max. other invariants? debt?}

    function mint(uint256 amount) public {
        require(
            underlying.transferFrom(msg.sender, address(this), amount), // transfer to owner, which is supposed to be 'treasury'.
            "Transfer failed"
        );
        _mint(msg.sender, amount);
        emit Deposit(msg.sender, amount);
    }

    // todo: treasury handle burning
    function burn(address from, uint256 amount) public onlyOwner {
        _burn(from, amount);
        require(underlying.transfer(owner(), amount), "Transfer failed");
        emit Withdraw(owner(), amount);
    }

    // todo: or maybe owner shoudl be dao? becoz of nft minting
    function mintNft(address recipient, uint256 amount) public onlyOwner {
        uint256 currentNftBalance = _balanceOfNFT(recipient);
        require(
            currentNftBalance + amount <= maxNftBalance,
            "Exceeds max NFT balance"
        );

        _setSkipNFT(recipient, false);
        // _mintNext(recipient, amount);
        // _transfer(recipient, recipient, 0);
        _mintNft(recipient, amount);
        _setSkipNFT(recipient, true);
        // _mint(recipient, amount * 1e18); // wrong. should setNft to true and make an empty transfer? or maybe call mintNext?
    }

    function setBaseURI(string calldata baseURI_) public onlyOwner {
        _baseURI = baseURI_;
    }

    function setMaxNftBalance(uint256 _maxNftBalance) public onlyOwner {
        maxNftBalance = _maxNftBalance;
    }

    // function withdrawUnderlying() public onlyOwner {
    //     uint256 balance = underlying.balanceOf(address(this));
    //     require(underlying.transfer(owner(), balance), "Transfer failed");
    //     emit Withdraw(owner(), balance);
    // }

    function withdraw() public onlyOwner {
        SafeTransferLib.safeTransferAllETH(msg.sender);
    }
}
