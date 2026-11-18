// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";

interface ILitVerseAuctionCollectionRegistry {
    function isRegisteredCollection(address collection) external view returns (bool);
}

contract LitVerseAuction is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    IERC721Receiver
{
    uint256 public platformFeeBps;
    address payable public feeRecipient;
    uint256 public nextAuctionId;

    struct Auction {
        address nftContract;
        uint256 tokenId;
        address seller;
        uint256 reservePrice;
        uint256 highestBid;
        address highestBidder;
        uint256 endTime;
        bool finalized;
        bool claimed;
    }

    mapping(uint256 => Auction) public auctions;
    mapping(address => uint256) public pendingWithdrawals;

    // Appended storage: preserves the existing proxy storage layout.
    address public collectionFactory;
    mapping(address => bool) public approvedCollections;

    event CollectionFactoryUpdated(address indexed factory);
    event CollectionApprovalUpdated(address indexed collection, bool approved);
    event AuctionCreated(uint256 indexed auctionId, address indexed nftContract, uint256 indexed tokenId, address seller, uint256 reservePrice, uint256 endTime);
    event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event AuctionFinalized(uint256 indexed auctionId, address winner, uint256 winningBid);
    event NFTClaimed(uint256 indexed auctionId, address winner);
    event AuctionCancelled(uint256 indexed auctionId);
    event Withdrawal(address indexed account, uint256 amount);

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
        nextAuctionId = 1;
    }

    function createAuction(address nftContract, uint256 tokenId, uint256 reservePrice, uint256 duration)
        external
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        require(nftContract != address(0), "Invalid NFT contract");
        require(isCollectionApproved(nftContract), "Collection not approved");
        require(reservePrice > 0, "Invalid reserve price");
        require(duration >= 1 hours, "Duration too short");
        require(duration <= 30 days, "Duration too long");

        IERC721 nft = IERC721(nftContract);
        require(nft.ownerOf(tokenId) == msg.sender, "Not NFT owner");
        require(
            nft.getApproved(tokenId) == address(this) ||
            nft.isApprovedForAll(msg.sender, address(this)),
            "Auction not approved"
        );

        uint256 auctionId = nextAuctionId++;
        uint256 endTime = block.timestamp + duration;

        auctions[auctionId] = Auction(
            nftContract, tokenId, msg.sender, reservePrice, 0, address(0), endTime, false, false
        );

        nft.safeTransferFrom(msg.sender, address(this), tokenId);
        emit AuctionCreated(auctionId, nftContract, tokenId, msg.sender, reservePrice, endTime);
        return auctionId;
    }

    function placeBid(uint256 auctionId) external payable whenNotPaused nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(auction.seller != address(0), "Auction not found");
        require(!auction.finalized, "Auction finalized");
        require(block.timestamp < auction.endTime, "Auction ended");
        require(msg.sender != auction.seller, "Seller cannot bid");
        require(msg.value >= auction.reservePrice, "Below reserve price");
        require(msg.value > auction.highestBid, "Bid too low");

        if (auction.highestBidder != address(0)) {
            pendingWithdrawals[auction.highestBidder] += auction.highestBid;
        }

        auction.highestBid = msg.value;
        auction.highestBidder = msg.sender;
        emit BidPlaced(auctionId, msg.sender, msg.value);
    }

    function finalizeAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(auction.seller != address(0), "Auction not found");
        require(!auction.finalized, "Already finalized");
        require(block.timestamp >= auction.endTime, "Auction still active");

        auction.finalized = true;

        if (auction.highestBidder == address(0)) {
            IERC721(auction.nftContract).safeTransferFrom(address(this), auction.seller, auction.tokenId);
        } else {
            uint256 winningBid = auction.highestBid;
            uint256 platformFee = (winningBid * platformFeeBps) / 10000;
            uint256 royaltyAmount;
            address royaltyReceiver;

            try IERC2981(auction.nftContract).royaltyInfo(auction.tokenId, winningBid)
                returns (address receiver, uint256 amount)
            {
                royaltyReceiver = receiver;
                royaltyAmount = amount;
            } catch {
                royaltyAmount = 0;
            }

            require(platformFee + royaltyAmount <= winningBid, "Fees exceed bid");
            uint256 sellerAmount = winningBid - platformFee - royaltyAmount;

            pendingWithdrawals[auction.seller] += sellerAmount;
            pendingWithdrawals[feeRecipient] += platformFee;

            if (royaltyAmount > 0 && royaltyReceiver != address(0)) {
                pendingWithdrawals[royaltyReceiver] += royaltyAmount;
            } else {
                pendingWithdrawals[auction.seller] += royaltyAmount;
            }
        }

        emit AuctionFinalized(auctionId, auction.highestBidder, auction.highestBid);
    }

    function claimNFT(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(auction.finalized, "Auction not finalized");
        require(auction.highestBidder != address(0), "No winner");
        require(msg.sender == auction.highestBidder, "Not winner");
        require(!auction.claimed, "Already claimed");

        auction.claimed = true;
        IERC721(auction.nftContract).safeTransferFrom(address(this), msg.sender, auction.tokenId);
        emit NFTClaimed(auctionId, msg.sender);
    }

    function cancelAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(auction.seller == msg.sender, "Not seller");
        require(!auction.finalized, "Already finalized");
        require(auction.highestBidder == address(0), "Bids already placed");

        auction.finalized = true;
        auction.claimed = true;
        IERC721(auction.nftContract).safeTransferFrom(address(this), msg.sender, auction.tokenId);
        emit AuctionCancelled(auctionId);
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Withdrawal failed");
        emit Withdrawal(msg.sender, amount);
    }

    /// @notice Configure the trusted LitVerse collection factory.
    /// @dev Once configured, unregistered external collections require explicit approval.
    function setCollectionFactory(address factory) external onlyOwner {
        require(factory != address(0) && factory.code.length > 0, "Invalid factory");
        collectionFactory = factory;
        emit CollectionFactoryUpdated(factory);
    }

    function setCollectionApproval(address collection, bool approved) external onlyOwner {
        require(collection != address(0) && collection.code.length > 0, "Invalid collection");
        approvedCollections[collection] = approved;
        emit CollectionApprovalUpdated(collection, approved);
    }

    function isCollectionApproved(address collection) public view returns (bool) {
        if (collectionFactory == address(0)) return true;
        if (approvedCollections[collection]) return true;
        try ILitVerseAuctionCollectionRegistry(collectionFactory).isRegisteredCollection(collection)
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
    }

    function setFeeRecipient(address payable newRecipient) external onlyOwner {
        require(newRecipient != address(0), "Invalid recipient");
        feeRecipient = newRecipient;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
