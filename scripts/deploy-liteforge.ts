
import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";

async function main() {
  const connection = await hre.network.create();
  const { ethers } = connection;
  const upgradesApi = await upgrades(hre, connection);

  const networkInfo = await ethers.provider.getNetwork();
  if (networkInfo.chainId !== 4441n) {
    throw new Error(`Wrong chain ID: expected 4441, received ${networkInfo.chainId}`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer account configured");

  const owner = await deployer.getAddress();
  const feeRecipient = owner;
  const royaltyReceiver = owner;

  const hiddenMetadataURI = process.env.LITVERSE_HIDDEN_METADATA_URI;
  if (!hiddenMetadataURI || !hiddenMetadataURI.startsWith("ipfs://")) {
    throw new Error("Set LITVERSE_HIDDEN_METADATA_URI before deployment.");
  }

  const balance = await ethers.provider.getBalance(owner);
  if (balance === 0n) {
    throw new Error("Deployer wallet has no zkLTC testnet balance.");
  }

  const latestBlock = await ethers.provider.getBlock("latest");
  if (!latestBlock) throw new Error("Could not read latest block");

  const saleStartTime = BigInt(latestBlock.timestamp + 3600);

  console.log("Network:", networkInfo.name);
  console.log("Chain ID:", networkInfo.chainId.toString());
  console.log("Deployer:", owner);
  console.log("Balance:", ethers.formatEther(balance), "zkLTC");

  // 1. Deploy NFT
  const nftFactory = await ethers.getContractFactory("LitVerseNFT");
  const nft = await upgradesApi.deployProxy(
    nftFactory,
    [
      owner,
      "LitVerse Genesis",
      "LTVG",
      10000n,
      ethers.parseEther("0.01"),
      5n,
      saleStartTime,
      royaltyReceiver,
      hiddenMetadataURI
    ],
    { kind: "uups" }
  );

  await nft.waitForDeployment();

  const nftProxyAddress = await nft.getAddress();
  const nftImplementationAddress =
    await upgradesApi.erc1967.getImplementationAddress(nftProxyAddress);

  console.log("NFT Proxy:", nftProxyAddress);
  console.log("NFT Implementation:", nftImplementationAddress);

  // 2. Deploy Collection Factory
  const collectionFactoryFactory =
    await ethers.getContractFactory("LitVerseCollectionFactory");

  const collectionFactory = await upgradesApi.deployProxy(
    collectionFactoryFactory,
    [owner, nftImplementationAddress],
    { kind: "uups" }
  );

  await collectionFactory.waitForDeployment();

  const collectionFactoryAddress = await collectionFactory.getAddress();

  console.log("Collection Factory:", collectionFactoryAddress);

  // 3. Deploy Marketplace
  const marketplaceFactory =
    await ethers.getContractFactory("LitVerseMarketplace");

  const marketplace = await upgradesApi.deployProxy(
    marketplaceFactory,
    [owner, feeRecipient, 250n],
    { kind: "uups" }
  );

  await marketplace.waitForDeployment();

  const marketplaceAddress = await marketplace.getAddress();

  // 4. Deploy Auction
  const auctionFactory =
    await ethers.getContractFactory("LitVerseAuction");

  const auction = await upgradesApi.deployProxy(
    auctionFactory,
    [owner, feeRecipient, 250n],
    { kind: "uups" }
  );

  await auction.waitForDeployment();

  const auctionAddress = await auction.getAddress();

  // 5. Enable strict collection allowlisting
  await (
    await marketplace.setCollectionFactory(collectionFactoryAddress)
  ).wait();

  await (
    await auction.setCollectionFactory(collectionFactoryAddress)
  ).wait();

  console.log("\nDeployment complete!");

  const result = {
    chainId: networkInfo.chainId.toString(),
    owner,
    nftProxy: nftProxyAddress,
    nftImplementation: nftImplementationAddress,
    marketplaceProxy: marketplaceAddress,
    auctionProxy: auctionAddress,
    collectionFactoryProxy: collectionFactoryAddress,
    collectionAllowlistEnabled: true
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
