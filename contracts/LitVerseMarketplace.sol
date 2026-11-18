// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface ILitVerseCollectionRegistry {
    function isRegisteredCollection(address collection) external view returns (bool);
}

contract LitVerseMarketplace is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    IERC721Receiver
{
    uint256 public platformFeeBps;
    address payable public feeRecipient;
    uint256 public nextListingId;

    struct Listing {
        address nftContract;
        uint256 tokenId;
        address seller;
        uint256 price;
        bool active;
    }

    mapping(uint256 => Listing) public listings;

    // Appended storage: preserves the existing proxy storage layout.
    address public collectionFactory;
    mapping(address => bool) public approvedCollections;

    event CollectionFactoryUpdated(address indexed factory);
    event CollectionApprovalUpdated(address indexed collection, bool approved);
    event NFTListed(uint256 indexed listingId, address indexed nftContract, uint256 indexed tokenId, address seller, uint256 price);
    event NFTSold(uint256 indexed listingId, address buyer, address seller, uint256 price);
    event ListingCancelled(uint256 indexed listingId);
    event PlatformFeeUpdated(uint256 newFee);
    event FeeRecipientUpdated(address newRecipient);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address initialOwner, address payable initialFeeRecipient, uint256 initialPlatformFeeBps)
        public
        initializer
    {
        require(initialOwner != address(0), "Invalid owner");
        require(initialFeeRecipient != address(0), "Invalid recipient");
        require(initialPlatformFeeBps <= 500, "Fee too high");

        __Ownable_init(initialOwner);
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        feeRecipient = initialFeeRecipient;
        platformFeeBps = initialPlatformFeeBps;
        nextListingId = 1;
    }

    function listNFT(address nftContract, uint256 tokenId, uint256 price)
        external
        whenNotPaused
        nonReentrant
    {
        require(nftContract != address(0), "Invalid NFT contract");
        require(isCollectionApproved(nftContract), "Collection not approved");
        require(price > 0, "Price must be greater than zero");

        IERC721 nft = IERC721(nftContract);
        require(nft.ownerOf(tokenId) == msg.sender, "Not NFT owner");
        require(
            nft.getApproved(tokenId) == address(this) ||
            nft.isApprovedForAll(msg.sender, address(this)),
            "Marketplace not approved"
        );

        uint256 listingId = nextListingId++;
        listings[listingId] = Listing(nftContract, tokenId, msg.sender, price, true);
        // Legacy approval-based entry point; the one-transaction receiver flow is separate.
        nft.transferFrom(msg.sender, address(this), tokenId);

        emit NFTListed(listingId, nftContract, tokenId, msg.sender, price);
    }

    function buyNFT(uint256 listingId) external payable whenNotPaused nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(msg.sender != listing.seller, "Cannot buy own NFT");
        require(msg.value == listing.price, "Incorrect payment");

        listing.active = false;
        uint256 price = listing.price;
        uint256 platformFee = (price * platformFeeBps) / 10000;

        uint256 royaltyAmount;
        address royaltyReceiver;
        try IERC2981(listing.nftContract).royaltyInfo(listing.tokenId, price)
            returns (address receiver, uint256 amount)
        {
            royaltyReceiver = receiver;
            royaltyAmount = amount;
        } catch {
            royaltyAmount = 0;
        }

        require(platformFee + royaltyAmount <= price, "Fees exceed price");
        uint256 sellerAmount = price - platformFee - royaltyAmount;

        IERC721(listing.nftContract).safeTransferFrom(address(this), msg.sender, listing.tokenId);

        if (platformFee > 0) _sendPayment(feeRecipient, platformFee);
        if (royaltyAmount > 0 && royaltyReceiver != address(0)) {
            _sendPayment(payable(royaltyReceiver), royaltyAmount);
        } else {
            sellerAmount += royaltyAmount;
        }
        _sendPayment(payable(listing.seller), sellerAmount);

        emit NFTSold(listingId, msg.sender, listing.seller, price);
    }

    function cancelListing(uint256 listingId) external whenNotPaused nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(listing.seller == msg.sender, "Not seller");

        listing.active = false;
        IERC721(listing.nftContract).safeTransferFrom(address(this), msg.sender, listing.tokenId);
        emit ListingCancelled(listingId);
    }

    /// @notice Signals frontend support for approval-free, one-transaction listings.
    function supportsOneTransactionListing() external pure returns (bool) { return true; }

    /// @notice Configure the trusted LitVerse collection factory.
    /// @dev Once configured, unregistered external collections require explicit approval.
    function setCollectionFactory(address factory) external onlyOwner {
        require(factory != address(0) && factory.code.length > 0, "Invalid factory");
        collectionFactory = factory;
        emit CollectionFactoryUpdated(factory);
    }

    /// @notice One-time upgrade initializer: trust the existing LitVerse Genesis collection.
    /// @dev Call atomically with upgradeToAndCall; no per-NFT approval is required from holders.
    function initializeV2(address primaryCollection) external reinitializer(2) onlyOwner {
        require(primaryCollection != address(0) && primaryCollection.code.length > 0, "Invalid primary collection");
        approvedCollections[primaryCollection] = true;
        emit CollectionApprovalUpdated(primaryCollection, true);
    }

    function setCollectionApproval(address collection, bool approved) external onlyOwner {
        require(collection != address(0) && collection.code.length > 0, "Invalid collection");
        approvedCollections[collection] = approved;
        emit CollectionApprovalUpdated(collection, approved);
    }

    function isCollectionApproved(address collection) public view returns (bool) {
        // Preserve standalone test/development deployments until a factory is configured.
        if (collectionFactory == address(0)) return true;
        if (approvedCollections[collection]) return true;
        try ILitVerseCollectionRegistry(collectionFactory).isRegisteredCollection(collection)
            returns (bool registered)
        {
            return registered;
        } catch {
            return false;
        }
    }

    function setPlatformFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 500, "Fee exceeds 5%");
        platformFeeBps = newFeeBps;
        emit PlatformFeeUpdated(newFeeBps);
    }

    function setFeeRecipient(address payable newRecipient) external onlyOwner {
        require(newRecipient != address(0), "Invalid recipient");
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(newRecipient);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function withdrawAccidentalFunds(address payable recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds");
        _sendPayment(recipient, balance);
    }

    function _sendPayment(address payable recipient, uint256 amount) internal {
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Payment failed");
    }

    /// @notice Accept an NFT and create its listing in the same wallet transaction.
    /// @dev Send safeTransferFrom(owner, marketplace, tokenId, abi.encode(price)).
    /// Empty-data transfers remain accepted for compatibility but do not create listings.
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        override
        whenNotPaused
        returns (bytes4)
    {
        if (data.length != 0) {
            require(data.length == 32, "Invalid listing data");
            require(operator == from, "Owner must initiate listing");
            require(isCollectionApproved(msg.sender), "Collection not approved");
            uint256 price = abi.decode(data, (uint256));
            require(price > 0, "Price must be greater than zero");
            require(IERC721(msg.sender).ownerOf(tokenId) == address(this), "NFT not escrowed");
            uint256 listingId = nextListingId++;
            listings[listingId] = Listing(msg.sender, tokenId, from, price, true);
            emit NFTListed(listingId, msg.sender, tokenId, from, price);
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
