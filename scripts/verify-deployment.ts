
import hre from "hardhat";

async function main() {
  const connection = await hre.network.create();
  const { ethers } = connection;

  const contracts = {
    NFT: "0xbf076fe848CE7Bf9864Ccf33Ae1A7EBb7ef697b6",
    NFTImplementation: "0x1561d0116948947fe6F6B09e5b59f9f65175De52",
    Marketplace: "0x9914F5f46dd37Bf5F5a54b2B1eB7618c4897D3c4",
    Auction: "0x074CD851A0C05A4B8bbfBAC790bA5ca3E77725C2",
    CollectionFactory: "0x8c0CDdFF0154042a3A9E16f68Ac71C46cD2DA1ea"
  };

  console.log("Checking LitVerse deployment...");
  console.log("Network:", (await ethers.provider.getNetwork()).chainId.toString());

  for (const [name, address] of Object.entries(contracts)) {
    const code = await ethers.provider.getCode(address);
    const deployed = code !== "0x";

    console.log(
      `${name}:`,
      address,
      deployed ? "CONTRACT FOUND" : "NO CONTRACT CODE"
    );

    if (!deployed) {
      throw new Error(`${name} deployment verification failed`);
    }
  }

  const marketplace = await ethers.getContractAt(
    "LitVerseMarketplace",
    contracts.Marketplace
  );

  const auction = await ethers.getContractAt(
    "LitVerseAuction",
    contracts.Auction
  );

  const nft = await ethers.getContractAt(
    "LitVerseNFT",
    contracts.NFT
  );

  const factory = await ethers.getContractAt(
    "LitVerseCollectionFactory",
    contracts.CollectionFactory
  );

  const marketplaceFactory = await marketplace.collectionFactory();
  const auctionFactory = await auction.collectionFactory();
  const owner = await nft.owner();
  const maxSupply = await nft.maxSupply();
  const mintPrice = await nft.mintPrice();

  console.log("\nFactory connection checks:");
  console.log("Marketplace Factory:", marketplaceFactory);
  console.log("Auction Factory:", auctionFactory);
  console.log("Expected Factory:", contracts.CollectionFactory);

  if (
    marketplaceFactory.toLowerCase() !== contracts.CollectionFactory.toLowerCase() ||
    auctionFactory.toLowerCase() !== contracts.CollectionFactory.toLowerCase()
  ) {
    throw new Error("Factory connection mismatch!");
  }

  console.log("\nNFT checks:");
  console.log("NFT Owner:", owner);
  console.log("Max Supply:", maxSupply.toString());
  console.log("Mint Price:", ethers.formatEther(mintPrice), "zkLTC");

  console.log("\nALL DEPLOYMENT CHECKS PASSED!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
