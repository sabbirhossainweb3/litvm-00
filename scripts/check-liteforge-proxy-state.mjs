// Read-only LiteForge snapshot; triggered alongside live UUPS baseline validation.
import { Contract, JsonRpcProvider, getAddress } from "ethers";

const RPC = process.env.LITEFORGE_RPC_URL || "https://rpc.testnet.liteforge.zeeve.net/";
const ADDRESSES = {
  nft: "0xbf076fe848CE7Bf9864Ccf33Ae1A7EBb7ef697b6",
  marketplace: "0x9914F5f46dd37Bf5F5a54b2B1eB7618c4897D3c4",
  auction: "0x074CD851A0C05A4B8bbfBAC790bA5ca3E77725C2",
  factory: "0x8c0CDdFF0154042a3A9E16f68Ac71C46cD2DA1ea",
};
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const provider = new JsonRpcProvider(RPC);

const NFT_ABI = [
  "function owner() view returns(address)",
  "function name() view returns(string)",
  "function symbol() view returns(string)",
  "function totalMinted() view returns(uint256)",
  "function maxSupply() view returns(uint256)",
  "function paused() view returns(bool)",
  "function revealed() view returns(bool)",
  "function ownerOf(uint256) view returns(address)",
  "function tokenURI(uint256) view returns(string)",
];
const MARKET_ABI = [
  "function owner() view returns(address)",
  "function platformFeeBps() view returns(uint256)",
  "function feeRecipient() view returns(address)",
  "function nextListingId() view returns(uint256)",
  "function collectionFactory() view returns(address)",
  "function paused() view returns(bool)",
  "function listings(uint256) view returns(address nftContract,uint256 tokenId,address seller,uint256 price,bool active)",
  "function approvedCollections(address) view returns(bool)",
];
const AUCTION_ABI = [
  "function owner() view returns(address)",
  "function platformFeeBps() view returns(uint256)",
  "function feeRecipient() view returns(address)",
  "function nextAuctionId() view returns(uint256)",
  "function collectionFactory() view returns(address)",
  "function paused() view returns(bool)",
  "function auctions(uint256) view returns(address nftContract,uint256 tokenId,address seller,uint256 reservePrice,uint256 highestBid,address highestBidder,uint256 endTime,bool finalized,bool claimed)",
  "function approvedCollections(address) view returns(bool)",
];
const FACTORY_ABI = [
  "function owner() view returns(address)",
  "function nftImplementation() view returns(address)",
  "function collectionCount() view returns(uint256)",
  "function isRegisteredCollection(address) view returns(bool)",
];

async function explorerVerification(address) {
  const url = "https://explorer.testnet.liteforge.zeeve.net/api/v2/smart-contracts/" + address;
  try {
    const response = await fetch(url);
    if (!response.ok) return { httpStatus: response.status, verified: false };
    const data = await response.json();
    const sourceText = typeof data.source_code === "string" ? data.source_code : "";
    return {
      httpStatus: response.status,
      verified: data.is_verified === true,
      featureFlags: {
        supportsOneTransactionListing: sourceText.includes("supportsOneTransactionListing"),
        supportsOneTransactionAuction: sourceText.includes("supportsOneTransactionAuction"),
        hasERC721Receiver: sourceText.includes("onERC721Received"),
      },
      name: data.name ?? null,
      compilerVersion: data.compiler_version ?? null,
      evmVersion: data.evm_version ?? null,
      optimizationEnabled: data.optimization_enabled ?? null,
      filePath: data.file_path ?? null,
      sourceLength: typeof data.source_code === "string" ? data.source_code.length : null,
      sourceShape: (() => {
        if (typeof data.source_code !== "string") return typeof data.source_code;
        try {
          const parsed = JSON.parse(data.source_code);
          const sources = parsed.sources ?? parsed;
          return { format: "json", keys: Object.keys(sources).filter(key => key.endsWith(".sol")).slice(0, 30) };
        } catch {
          return { format: "plain-text", prefix: data.source_code.slice(0, 120) };
        }
      })(),
    };
  } catch (error) {
    return { verified: false, error: String(error) };
  }
}

async function proxyInfo(label, address) {
  const code = await provider.getCode(address);
  if (code === "0x") throw new Error(label + " has no bytecode at " + address);
  const raw = await provider.getStorage(address, IMPLEMENTATION_SLOT);
  const implementation = getAddress("0x" + raw.slice(-40));
  if (implementation === getAddress("0x0000000000000000000000000000000000000000")) {
    throw new Error(label + " has an empty ERC1967 implementation slot");
  }
  const implementationCode = await provider.getCode(implementation);
  if (implementationCode === "0x") throw new Error(label + " implementation has no bytecode");
  return { proxy: getAddress(address), implementation, proxyBytecodeBytes: (code.length - 2) / 2 };
}

async function readIds(count, readOne, max = 500) {
  const n = Number(count);
  if (!Number.isSafeInteger(n) || n < 1 || n > max + 1) {
    throw new Error("Record count " + count + " is outside safe snapshot limit (max " + max + ")");
  }
  const result = [];
  for (let start = 1; start < n; start += 10) {
    const end = Math.min(n, start + 10);
    const batch = await Promise.all(Array.from({ length: end - start }, (_, i) => readOne(start + i)));
    result.push(...batch);
  }
  return result;
}

async function main() {
  const network = await provider.getNetwork();
  if (network.chainId !== 4441n) throw new Error("Wrong chain ID: " + network.chainId);

  const proxyInfoResult = {};
  for (const [key, address] of Object.entries(ADDRESSES)) {
    proxyInfoResult[key] = await proxyInfo(key, address);
  }

  const nft = new Contract(ADDRESSES.nft, NFT_ABI, provider);
  const market = new Contract(ADDRESSES.marketplace, MARKET_ABI, provider);
  const auction = new Contract(ADDRESSES.auction, AUCTION_ABI, provider);
  const factory = new Contract(ADDRESSES.factory, FACTORY_ABI, provider);

  const [nftOwner,nftName,nftSymbol,totalMinted,maxSupply,nftPaused,revealed,
    marketOwner,marketFee,marketFeeRecipient,nextListingId,marketFactory,marketPaused,marketApprovedNFT,
    auctionOwner,auctionFee,auctionFeeRecipient,nextAuctionId,auctionFactory,auctionPaused,auctionApprovedNFT,
    factoryOwner,nftImplementation,collectionCount,nftRegistered] = await Promise.all([
      nft.owner(),nft.name(),nft.symbol(),nft.totalMinted(),nft.maxSupply(),nft.paused(),nft.revealed(),
      market.owner(),market.platformFeeBps(),market.feeRecipient(),market.nextListingId(),market.collectionFactory(),market.paused(),market.approvedCollections(ADDRESSES.nft),
      auction.owner(),auction.platformFeeBps(),auction.feeRecipient(),auction.nextAuctionId(),auction.collectionFactory(),auction.paused(),auction.approvedCollections(ADDRESSES.nft),
      factory.owner(),factory.nftImplementation(),factory.collectionCount(),factory.isRegisteredCollection(ADDRESSES.nft),
    ]);

  const listings = await readIds(nextListingId, async id => {
    const x = await market.listings(id);
    if (!x.active) return null;
    let escrowOwner = null;
    try { escrowOwner = await new Contract(x.nftContract, NFT_ABI, provider).ownerOf(x.tokenId); } catch {}
    return { id, nftContract: x.nftContract, tokenId: x.tokenId.toString(), seller: x.seller,
      price: x.price.toString(), active: x.active, escrowOwner,
      escrowMatches: escrowOwner?.toLowerCase() === ADDRESSES.marketplace.toLowerCase() };
  });

  const auctions = await readIds(nextAuctionId, async id => {
    const x = await auction.auctions(id);
    if (x.seller === "0x0000000000000000000000000000000000000000") return null;
    let escrowOwner = null;
    if (!x.claimed && (!x.finalized || x.highestBidder !== "0x0000000000000000000000000000000000000000")) {
      try { escrowOwner = await new Contract(x.nftContract, NFT_ABI, provider).ownerOf(x.tokenId); } catch {}
    }
    return { id, nftContract: x.nftContract, tokenId: x.tokenId.toString(), seller: x.seller,
      reservePrice: x.reservePrice.toString(), highestBid: x.highestBid.toString(),
      highestBidder: x.highestBidder, endTime: x.endTime.toString(), finalized: x.finalized,
      claimed: x.claimed, escrowOwner,
      escrowMatches: escrowOwner === null || escrowOwner?.toLowerCase() === ADDRESSES.auction.toLowerCase() };
  });

  const activeListings = listings.filter(Boolean);
  const auctionRecords = auctions.filter(Boolean);
  const tokenRecords = [];
  for (let id = 1; id <= Number(totalMinted); id++) {
    const [tokenOwner, uri] = await Promise.all([nft.ownerOf(id), nft.tokenURI(id)]);
    tokenRecords.push({ tokenId: id, owner: tokenOwner, tokenURI: uri });
  }
  const failures = [
    ...activeListings.filter(x => !x.escrowMatches).map(x => "Listing " + x.id + " escrow owner mismatch"),
    ...auctionRecords.filter(x => !x.escrowMatches).map(x => "Auction " + x.id + " escrow owner mismatch"),
    marketFactory.toLowerCase() !== ADDRESSES.factory.toLowerCase() ? "Marketplace factory pointer differs from expected factory address" : null,
    auctionFactory.toLowerCase() !== ADDRESSES.factory.toLowerCase() ? "Auction factory pointer differs from expected factory address" : null,
  ].filter(Boolean);

  const explorerSources = {
    marketplace: await explorerVerification(proxyInfoResult.marketplace.implementation),
    auction: await explorerVerification(proxyInfoResult.auction.implementation),
  };

  const snapshot = {
    network: { chainId: network.chainId.toString(), rpc: RPC },
    addresses: ADDRESSES,
    proxies: proxyInfoResult,
    nft: { owner:nftOwner,name:nftName,symbol:nftSymbol,totalMinted:totalMinted.toString(),
      maxSupply:maxSupply.toString(),paused:nftPaused,revealed,nftRegistered,tokens:tokenRecords },
    marketplace: { owner:marketOwner,platformFeeBps:marketFee.toString(),feeRecipient:marketFeeRecipient,
      nextListingId:nextListingId.toString(),collectionFactory:marketFactory,paused:marketPaused,
      activeListingCount:activeListings.length,activeListings,primaryNFTApproved:marketApprovedNFT },
    auction: { owner:auctionOwner,platformFeeBps:auctionFee.toString(),feeRecipient:auctionFeeRecipient,
      nextAuctionId:nextAuctionId.toString(),collectionFactory:auctionFactory,paused:auctionPaused,
      auctionRecordCount:auctionRecords.length,auctions:auctionRecords,primaryNFTApproved:auctionApprovedNFT },
    factory: { owner:factoryOwner,nftImplementation,collectionCount:collectionCount.toString() },
    explorerSources,
    limitations: ["pendingWithdrawals cannot be enumerated from mapping alone; event/account history is required",
      "only the primary NFT proxy address was checked for factory registration"],
    warnings: [
      !marketApprovedNFT ? "Primary NFT collection is not explicitly approved by Marketplace; owner must approve this collection once before listing" : null,
      !auctionApprovedNFT ? "Primary NFT collection is not explicitly approved by Auction; owner must approve this collection once before auctions" : null,
    ].filter(Boolean),
    failures,
  };
  console.log(JSON.stringify(snapshot, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
