// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";

contract X402RouterTestToken is ERC20 {
    string private tokenName;
    string private tokenSymbol;
    uint8 private immutable tokenDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        tokenName = name_;
        tokenSymbol = symbol_;
        tokenDecimals = decimals_;
    }

    function name() public view override returns (string memory) {
        return tokenName;
    }

    function symbol() public view override returns (string memory) {
        return tokenSymbol;
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract X402RouterTestBoardroom {
    address public immutable shareToken;
    address public immutable paymentToken;
    bytes32 public immutable facetSetHash;
    uint8 public status;
    uint256 public contributionCount;

    constructor(address shareToken_, address paymentToken_, bytes32 facetSetHash_) {
        shareToken = shareToken_;
        paymentToken = paymentToken_;
        facetSetHash = facetSetHash_;
    }

    function migrationRequired() external pure returns (bool) {
        return false;
    }

    function isRedeemableAsset(address asset) external view returns (bool) {
        return asset == paymentToken;
    }

    function contributeTreasuryAsset(bytes32 expectedFacetSetHash, address asset, uint256 amount, uint256 deadline)
        external
    {
        require(expectedFacetSetHash == facetSetHash, "facet set mismatch");
        require(asset == paymentToken, "unsupported asset");
        require(deadline >= block.timestamp, "expired");
        require(ERC20(asset).transferFrom(msg.sender, address(this), amount), "contribution transfer");
        contributionCount += 1;
    }
}

contract X402RouterTestBoardroomFactory {
    address public immutable facetRegistry;
    address public immutable boardroomKernelLogic;
    address public controllerFactory;
    address public governanceLogic;
    address public marketLogic;
    address public redemptionPayoutLogic;
    mapping(address => bool) public isBoardroom;

    constructor(address facetRegistry_, address boardroomKernelLogic_) {
        facetRegistry = facetRegistry_;
        boardroomKernelLogic = boardroomKernelLogic_;
    }

    function configureDependencies(
        address controllerFactory_,
        address governanceLogic_,
        address marketLogic_,
        address redemptionPayoutLogic_
    ) external {
        require(controllerFactory == address(0), "already configured");
        controllerFactory = controllerFactory_;
        governanceLogic = governanceLogic_;
        marketLogic = marketLogic_;
        redemptionPayoutLogic = redemptionPayoutLogic_;
    }

    function register(address boardroom_) external {
        isBoardroom[boardroom_] = true;
    }
}

contract X402RouterTestFacetRegistry {
    struct Facet {
        address facetAddress;
        bytes4[] functionSelectors;
    }

    bytes4 internal constant TEST_SELECTOR = bytes4(keccak256("releaseView()"));
    bytes32 internal constant KERNEL_SELECTOR_SET_HASH = keccak256("x402-router-integration-kernel-selectors");
    bytes32 internal constant STORAGE_LAYOUT_HASH = keccak256("x402-router-integration-storage-layout");
    bytes32 internal constant MANIFEST_HASH = keccak256("x402-router-integration-manifest");

    bytes32 public immutable activeFacetSetHash;
    address public immutable owner;
    address public immutable testFacet;

    constructor(bytes32 activeFacetSetHash_, address testFacet_) {
        activeFacetSetHash = activeFacetSetHash_;
        owner = msg.sender;
        testFacet = testFacet_;
    }

    function activeRelease() external pure returns (uint64) {
        return 1;
    }

    function activeStorageVersion() external pure returns (uint64) {
        return 1;
    }

    function activeStorageLayoutHash() external pure returns (bytes32) {
        return STORAGE_LAYOUT_HASH;
    }

    function kernelSelectorSetHash() external pure returns (bytes32) {
        return KERNEL_SELECTOR_SET_HASH;
    }

    function facetSetMetadata(bytes32 facetSetHash)
        external
        view
        returns (
            bool published,
            uint64 release,
            uint64 requiredStorageVersion,
            bytes32 predecessorFacetSetHash,
            bytes32 storageLayoutHash,
            bytes32 manifestHash,
            address migrationFacet,
            bytes4 migrationSelector,
            uint256 selectorCount
        )
    {
        published = facetSetHash == activeFacetSetHash;
        release = 1;
        requiredStorageVersion = 1;
        predecessorFacetSetHash = bytes32(0);
        storageLayoutHash = STORAGE_LAYOUT_HASH;
        manifestHash = MANIFEST_HASH;
        migrationFacet = address(0);
        migrationSelector = bytes4(0);
        selectorCount = 1;
    }

    function facetSetSelectors(bytes32 facetSetHash) external view returns (bytes4[] memory selectors) {
        require(facetSetHash == activeFacetSetHash, "unknown release");
        selectors = new bytes4[](1);
        selectors[0] = TEST_SELECTOR;
    }

    function facetSetRoute(bytes32 facetSetHash, bytes4 selector)
        external
        view
        returns (address facet, bytes32 codeHash, uint8 kind)
    {
        require(facetSetHash == activeFacetSetHash && selector == TEST_SELECTOR, "unknown route");
        facet = testFacet;
        codeHash = testFacet.codehash;
        kind = 0;
    }

    function route(bytes4 selector)
        external
        view
        returns (address facet, bytes32 codeHash, uint8 kind, uint64 requiredStorageVersion)
    {
        require(selector == TEST_SELECTOR, "unknown route");
        facet = testFacet;
        codeHash = testFacet.codehash;
        kind = 0;
        requiredStorageVersion = 1;
    }

    function facets() external view returns (Facet[] memory facetList) {
        facetList = new Facet[](1);
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = TEST_SELECTOR;
        facetList[0] = Facet({facetAddress: testFacet, functionSelectors: selectors});
    }
}

contract X402RouterTestBoardroomKernel {
    bytes32 internal constant KERNEL_SELECTOR_SET_HASH = keccak256("x402-router-integration-kernel-selectors");

    address public immutable facetRegistry;

    constructor(address facetRegistry_) {
        facetRegistry = facetRegistry_;
    }

    function kernelSelectorSetHash() external pure returns (bytes32) {
        return KERNEL_SELECTOR_SET_HASH;
    }
}

contract X402RouterTestFacet {
    function releaseView() external pure returns (bool) {
        return true;
    }
}

contract X402RouterTestDependency {}

contract X402RouterTestControllerFactory {
    address public immutable boardroomFactory;
    address public immutable controllerImplementation;

    constructor(address boardroomFactory_, address controllerImplementation_) {
        boardroomFactory = boardroomFactory_;
        controllerImplementation = controllerImplementation_;
    }
}

contract X402RouterTestPool {}

contract X402RouterTestAmmRouter {
    address public immutable inputToken;
    address public immutable outputToken;
    address public immutable pool;
    bool public swapsEnabled = true;
    uint256 public swapCount;

    constructor(address inputToken_, address outputToken_, address pool_) {
        inputToken = inputToken_;
        outputToken = outputToken_;
        pool = pool_;
    }

    function setSwapsEnabled(bool enabled) external {
        swapsEnabled = enabled;
    }

    function getAmountsOut(uint256 amountIn, address[] memory path) public view returns (uint256[] memory amounts) {
        require(path.length == 2 && path[0] == inputToken && path[1] == outputToken, "invalid path");
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn * 1e12;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(swapsEnabled, "swaps disabled");
        require(deadline >= block.timestamp, "expired");
        amounts = getAmountsOut(amountIn, path);
        require(amounts[1] >= amountOutMin, "minimum output");
        require(ERC20(inputToken).transferFrom(msg.sender, address(this), amountIn), "input transfer");
        require(ERC20(outputToken).transfer(to, amounts[1]), "output transfer");
        swapCount += 1;
    }
}

contract X402RouterTestAmmFactory {
    address public immutable owner;
    address public immutable liquidityRouter;
    address public immutable pool;
    address public immutable tokenA;
    address public immutable tokenB;

    constructor(address liquidityRouter_, address pool_, address tokenA_, address tokenB_) {
        owner = msg.sender;
        liquidityRouter = liquidityRouter_;
        pool = pool_;
        tokenA = tokenA_;
        tokenB = tokenB_;
    }

    function isPool(address candidate) external view returns (bool) {
        return candidate == pool;
    }

    function getPool(address left, address right) external view returns (address) {
        if ((left == tokenA && right == tokenB) || (left == tokenB && right == tokenA)) return pool;
        return address(0);
    }
}

contract X402RouterTestFixedPriceSale {
    address public immutable factory;
    address public immutable boardroom;
    address public immutable shareToken;
    address public immutable paymentToken;
    address public immutable controller;
    uint256 public remainingShares;
    uint256 public maxPerBuyer;
    uint64 public immutable startTime;
    uint64 public endTime;
    uint8 public saleStatus;
    uint256 public purchaseCount;

    constructor(address factory_, address boardroom_, address shareToken_, address paymentToken_, address controller_) {
        factory = factory_;
        boardroom = boardroom_;
        shareToken = shareToken_;
        paymentToken = paymentToken_;
        controller = controller_;
        remainingShares = 1_000_000e18;
        startTime = uint64(block.timestamp);
    }

    function getPaymentAmount(uint256 shareAmount) public pure returns (uint256) {
        return (shareAmount + 1e12 - 1) / 1e12;
    }

    function setSaleStatus(uint8 status_) external {
        require(msg.sender == controller, "only controller");
        saleStatus = status_;
    }

    function buy(uint256 shareAmount, address recipient, uint256 maxPayment, uint256 deadline)
        external
        returns (uint256 payment)
    {
        require(saleStatus == 0 && deadline >= block.timestamp, "sale closed");
        require(shareAmount != 0 && shareAmount <= remainingShares, "shares unavailable");
        payment = getPaymentAmount(shareAmount);
        require(payment <= maxPayment, "maximum payment");
        remainingShares -= shareAmount;
        require(ERC20(paymentToken).transferFrom(msg.sender, boardroom, payment), "payment transfer");
        require(ERC20(shareToken).transfer(recipient, shareAmount), "share transfer");
        purchaseCount += 1;
    }
}

contract X402RouterTestDistributionFactory {
    address public immutable sale;
    address public immutable boardroom;

    constructor(address boardroom_, address shareToken_, address paymentToken_, address controller_) {
        boardroom = boardroom_;
        sale = address(
            new X402RouterTestFixedPriceSale(address(this), boardroom_, shareToken_, paymentToken_, controller_)
        );
    }

    function isDistribution(address candidate) external view returns (bool) {
        return candidate == sale;
    }

    function distributionKind(address candidate) external view returns (uint8) {
        require(candidate == sale, "unknown distribution");
        return 0;
    }

    function distributionBoardroom(address candidate) external view returns (address) {
        require(candidate == sale, "unknown distribution");
        return boardroom;
    }
}

contract X402RouterIntegrationHarness {
    bytes32 public constant FACET_SET_HASH = keccak256("x402-router-integration-release");
    X402RouterTestFacetRegistry public immutable protocolFacetRegistry;
    X402RouterTestBoardroomKernel public immutable boardroomKernel;
    X402RouterTestBoardroomFactory public immutable boardroomFactory;
    X402RouterTestControllerFactory public immutable boardroomControllerFactory;
    X402RouterTestDependency public immutable boardroomControllerLogic;
    X402RouterTestDependency public immutable boardroomGovernanceLogic;
    X402RouterTestDependency public immutable boardroomMarketLogic;
    X402RouterTestDependency public immutable boardroomRedemptionPayout;
    X402RouterTestToken public immutable paymentToken;
    X402RouterTestToken public immutable shareToken;
    X402RouterTestBoardroom public immutable boardroom;
    X402RouterTestPool public immutable pool;
    X402RouterTestAmmRouter public immutable ammRouter;
    X402RouterTestAmmFactory public immutable ammFactory;
    X402RouterTestDistributionFactory public immutable distributionFactory;
    X402RouterTestFixedPriceSale public immutable fixedPriceSale;

    constructor() {
        X402RouterTestFacet testFacet = new X402RouterTestFacet();
        protocolFacetRegistry = new X402RouterTestFacetRegistry(FACET_SET_HASH, address(testFacet));
        boardroomKernel = new X402RouterTestBoardroomKernel(address(protocolFacetRegistry));
        boardroomFactory = new X402RouterTestBoardroomFactory(address(protocolFacetRegistry), address(boardroomKernel));
        boardroomControllerLogic = new X402RouterTestDependency();
        boardroomGovernanceLogic = new X402RouterTestDependency();
        boardroomMarketLogic = new X402RouterTestDependency();
        boardroomRedemptionPayout = new X402RouterTestDependency();
        boardroomControllerFactory =
            new X402RouterTestControllerFactory(address(boardroomFactory), address(boardroomControllerLogic));
        boardroomFactory.configureDependencies(
            address(boardroomControllerFactory),
            address(boardroomGovernanceLogic),
            address(boardroomMarketLogic),
            address(boardroomRedemptionPayout)
        );
        paymentToken = new X402RouterTestToken("Test USDC", "USDC", 6);
        shareToken = new X402RouterTestToken("Test Project Share", "SHARE", 18);
        boardroom = new X402RouterTestBoardroom(address(shareToken), address(paymentToken), FACET_SET_HASH);
        boardroomFactory.register(address(boardroom));
        pool = new X402RouterTestPool();
        ammRouter = new X402RouterTestAmmRouter(address(paymentToken), address(shareToken), address(pool));
        ammFactory =
            new X402RouterTestAmmFactory(address(ammRouter), address(pool), address(paymentToken), address(shareToken));
        distributionFactory = new X402RouterTestDistributionFactory(
            address(boardroom), address(shareToken), address(paymentToken), address(this)
        );
        fixedPriceSale = X402RouterTestFixedPriceSale(distributionFactory.sale());

        paymentToken.mint(msg.sender, 10_000_000e6);
        shareToken.mint(address(ammRouter), 1_000_000e18);
        shareToken.mint(address(fixedPriceSale), 1_000_000e18);
    }

    function setSwapsEnabled(bool enabled) external {
        ammRouter.setSwapsEnabled(enabled);
    }

    function setSaleStatus(uint8 status_) external {
        fixedPriceSale.setSaleStatus(status_);
    }
}
