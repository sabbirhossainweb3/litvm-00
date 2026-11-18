// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/common/ERC2981Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/Address.sol";

contract LitVerseNFT is
    Initializable,
    ERC721URIStorageUpgradeable,
    ERC2981Upgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    uint256 public maxSupply;
    uint256 public mintPrice;
    uint256 public walletLimit;
    uint256 public saleStartTime;
    uint256 public totalMinted;

    bool public revealed;
    string public hiddenMetadataURI;

    mapping(address => uint256) public walletMinted;

    // Appended for storage-safe compatibility with existing NFT proxies.
    uint256 public saleEndTime;
    string public collectionMetadataURI;

    struct SaleWindowConfig {
        string name;
        string symbol;
        uint256 maxSupply;
        uint256 mintPrice;
        uint256 walletLimit;
        uint256 saleStartTime;
        uint256 saleEndTime;
        string metadataURI;
        string hiddenMetadataURI;
    }

    event NFTMinted(address indexed to, uint256 indexed tokenId);
    event SaleConfigured(uint256 price, uint256 startTime, uint256 walletLimit);
    event RevealUpdated(bool revealed);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address initialOwner,
        string memory collectionName,
        string memory collectionSymbol,
        uint256 _maxSupply,
        uint256 _mintPrice,
        uint256 _walletLimit,
        uint256 _saleStartTime,
        address royaltyReceiver,
        string memory _hiddenMetadataURI
    ) public initializer {
        _initializeNFT(
            initialOwner, collectionName, collectionSymbol, _maxSupply,
            _mintPrice, _walletLimit, _saleStartTime, royaltyReceiver, _hiddenMetadataURI
        );
    }

    /// @notice Initializer for factory-created collections with an enforced mint end time.
    function initializeWithSaleEnd(address initialOwner, SaleWindowConfig calldata config) public initializer {
        require(config.saleEndTime > config.saleStartTime, "Invalid sale window");
        require(initialOwner != address(0), "Invalid owner");
        require(bytes(config.name).length > 0, "Name required");
        require(bytes(config.symbol).length > 0, "Symbol required");
        require(config.maxSupply > 0, "Invalid supply");
        require(config.walletLimit > 0, "Invalid wallet limit");
        require(bytes(config.metadataURI).length > 0, "Metadata URI required");

        __ERC721_init(config.name, config.symbol);
        __ERC721URIStorage_init();
        __ERC2981_init();
        __Ownable_init(initialOwner);
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        maxSupply = config.maxSupply;
        mintPrice = config.mintPrice;
        walletLimit = config.walletLimit;
        saleStartTime = config.saleStartTime;
        saleEndTime = config.saleEndTime;
        collectionMetadataURI = config.metadataURI;
        hiddenMetadataURI = config.hiddenMetadataURI;

        _setDefaultRoyalty(initialOwner, 500);
    }

    function _initializeNFT(
        address initialOwner,
        string memory collectionName,
        string memory collectionSymbol,
        uint256 _maxSupply,
        uint256 _mintPrice,
        uint256 _walletLimit,
        uint256 _saleStartTime,
        address royaltyReceiver,
        string memory _hiddenMetadataURI
    ) internal {
        require(initialOwner != address(0), "Invalid owner");
        require(royaltyReceiver != address(0), "Invalid royalty receiver");
        require(bytes(collectionName).length > 0, "Name required");
        require(bytes(collectionSymbol).length > 0, "Symbol required");
        require(_maxSupply > 0, "Invalid supply");
        require(_walletLimit > 0, "Invalid wallet limit");

        __ERC721_init(collectionName, collectionSymbol);
        __ERC721URIStorage_init();
        __ERC2981_init();
        __Ownable_init(initialOwner);
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        maxSupply = _maxSupply;
        mintPrice = _mintPrice;
        walletLimit = _walletLimit;
        saleStartTime = _saleStartTime;
        hiddenMetadataURI = _hiddenMetadataURI;

        _setDefaultRoyalty(royaltyReceiver, 500);
    }

    function publicMint(uint256 quantity)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        require(block.timestamp >= saleStartTime, "Sale not started");
        require(saleEndTime == 0 || block.timestamp <= saleEndTime, "Sale ended");
        require(quantity > 0, "Invalid quantity");
        require(totalMinted + quantity <= maxSupply, "Max supply reached");
        require(walletMinted[msg.sender] + quantity <= walletLimit, "Wallet limit reached");
        require(msg.value == mintPrice * quantity, "Incorrect payment");

        walletMinted[msg.sender] += quantity;
        uint256 startTokenId = totalMinted + 1;
        totalMinted += quantity;

        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = startTokenId + i;
            _safeMint(msg.sender, tokenId);
            emit NFTMinted(msg.sender, tokenId);
        }
    }

    function ownerMint(address to, uint256 quantity)
        external
        onlyOwner
        nonReentrant
        whenNotPaused
    {
        require(to != address(0), "Invalid recipient");
        require(quantity > 0, "Invalid quantity");
        require(totalMinted + quantity <= maxSupply, "Max supply reached");

        uint256 startTokenId = totalMinted + 1;
        totalMinted += quantity;

        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = startTokenId + i;
            _safeMint(to, tokenId);
            emit NFTMinted(to, tokenId);
        }
    }

    function configureSale(uint256 newPrice, uint256 newStartTime, uint256 newWalletLimit)
        external
        onlyOwner
    {
        require(newWalletLimit > 0, "Invalid wallet limit");
        mintPrice = newPrice;
        saleStartTime = newStartTime;
        walletLimit = newWalletLimit;
        emit SaleConfigured(newPrice, newStartTime, newWalletLimit);
    }

    function setReveal(bool _revealed) external onlyOwner {
        require(!revealed || _revealed, "Reveal is permanent");
        revealed = _revealed;
        emit RevealUpdated(_revealed);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721URIStorageUpgradeable)
        returns (string memory)
    {
        _requireOwned(tokenId);
        if (!revealed) return hiddenMetadataURI;
        string memory tokenMetadataURI = super.tokenURI(tokenId);
        if (bytes(tokenMetadataURI).length > 0) return tokenMetadataURI;
        return collectionMetadataURI;
    }

    function setTokenURI(uint256 tokenId, string calldata uri) external onlyOwner {
        _requireOwned(tokenId);
        // After reveal, an existing token URI is immutable. A token minted
        // after reveal may receive its URI once, but cannot later be changed.
        require(bytes(uri).length > 0, "Empty token URI");
        require(
            !revealed || bytes(super.tokenURI(tokenId)).length == 0,
            "Metadata locked"
        );
        _setTokenURI(tokenId, uri);
    }

    function setHiddenMetadataURI(string calldata uri) external onlyOwner {
        require(!revealed, "Metadata locked");
        hiddenMetadataURI = uri;
    }

    function withdraw(address payable recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds");
        Address.sendValue(recipient, balance);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @dev Enforce the emergency pause on every ERC721 mint, transfer and burn.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        require(!paused(), "EnforcedPause");
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorageUpgradeable, ERC2981Upgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
