// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

interface ILitVerseNFTInitializer {
    function initialize(
        address initialOwner,
        string memory collectionName,
        string memory collectionSymbol,
        uint256 maxSupply,
        uint256 mintPrice,
        uint256 walletLimit,
        uint256 saleStartTime,
        address royaltyReceiver,
        string memory hiddenMetadataURI
    ) external;

    struct SaleWindowConfig {
        string name;
        string symbol;
        uint256 maxSupply;
        uint256 mintPrice;
        uint256 walletLimit;
        uint256 saleStartTime;
        uint256 saleEndTime;
        string hiddenMetadataURI;
    }

    function initializeWithSaleEnd(address initialOwner, SaleWindowConfig calldata config) external;
}

contract LitVerseCollectionFactory is Initializable, OwnableUpgradeable, PausableUpgradeable, UUPSUpgradeable {
    address public nftImplementation;
    uint256 public collectionCount;

    struct CollectionConfig {
        string name;
        string symbol;
        uint256 maxSupply;
        uint256 mintPrice;
        uint256 walletLimit;
        uint256 saleStartTime;
        string hiddenMetadataURI;
    }

    struct Collection {
        address collectionAddress;
        address creator;
        string name;
        string symbol;
        uint256 createdAt;
    }

    mapping(uint256 => Collection) public collections;
    mapping(address => bool) public isRegisteredCollection;

    event CollectionCreated(uint256 indexed collectionId, address indexed collectionAddress, address indexed creator, string name, string symbol);
    event NFTImplementationUpdated(address newImplementation);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address initialOwner, address initialNFTImplementation) public initializer {
        require(initialOwner != address(0), "Invalid owner");
        require(initialNFTImplementation.code.length > 0, "Invalid implementation");

        __Ownable_init(initialOwner);
        __Pausable_init();
        __UUPSUpgradeable_init();

        nftImplementation = initialNFTImplementation;
    }

    /// @notice Atomically switches the factory to an NFT implementation that supports sale end dates.
    function initializeV2(address newNFTImplementation) external reinitializer(2) onlyOwner {
        require(newNFTImplementation.code.length > 0, "Invalid implementation");
        nftImplementation = newNFTImplementation;
        emit NFTImplementationUpdated(newNFTImplementation);
    }

    function createCollection(CollectionConfig calldata config) external whenNotPaused returns (address) {
        require(bytes(config.name).length > 0, "Name required");
        require(bytes(config.symbol).length > 0, "Symbol required");
        require(config.maxSupply > 0, "Invalid max supply");
        require(config.walletLimit > 0, "Invalid wallet limit");
        require(nftImplementation.code.length > 0, "Invalid implementation");

        bytes memory initData = abi.encodeCall(
            ILitVerseNFTInitializer.initialize,
            (
                msg.sender,
                config.name,
                config.symbol,
                config.maxSupply,
                config.mintPrice,
                config.walletLimit,
                config.saleStartTime,
                msg.sender,
                config.hiddenMetadataURI
            )
        );

        address collectionAddress = address(new ERC1967Proxy(nftImplementation, initData));
        uint256 collectionId = ++collectionCount;

        collections[collectionId] = Collection(
            collectionAddress, msg.sender, config.name, config.symbol, block.timestamp
        );
        isRegisteredCollection[collectionAddress] = true;

        emit CollectionCreated(collectionId, collectionAddress, msg.sender, config.name, config.symbol);
        return collectionAddress;
    }

    /// @notice Creates a new collection whose public mint closes at saleEndTime.
    /// @dev Existing createCollection remains unchanged for backward compatibility.
    function createCollectionWithSaleEnd(ILitVerseNFTInitializer.SaleWindowConfig calldata config)
        external
        whenNotPaused
        returns (address)
    {
        require(bytes(config.name).length > 0, "Name required");
        require(bytes(config.symbol).length > 0, "Symbol required");
        require(config.maxSupply > 0, "Invalid max supply");
        require(config.walletLimit > 0, "Invalid wallet limit");
        require(config.saleEndTime > config.saleStartTime, "Invalid sale window");
        require(nftImplementation.code.length > 0, "Invalid implementation");

        bytes memory initData = abi.encodeCall(
            ILitVerseNFTInitializer.initializeWithSaleEnd,
            (msg.sender, config)
        );

        address collectionAddress = address(new ERC1967Proxy(nftImplementation, initData));
        uint256 collectionId = ++collectionCount;

        collections[collectionId] = Collection(
            collectionAddress, msg.sender, config.name, config.symbol, block.timestamp
        );
        isRegisteredCollection[collectionAddress] = true;

        emit CollectionCreated(collectionId, collectionAddress, msg.sender, config.name, config.symbol);
        return collectionAddress;
    }

    function getCollection(uint256 collectionId) external view returns (Collection memory) {
        require(collectionId > 0 && collectionId <= collectionCount, "Collection not found");
        return collections[collectionId];
    }

    function setNFTImplementation(address newImplementation) external onlyOwner {
        require(newImplementation.code.length > 0, "Invalid implementation");
        nftImplementation = newImplementation;
        emit NFTImplementationUpdated(newImplementation);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
