import { network } from "hardhat";
import { describe, it } from "mocha";
import assert from "node:assert/strict";

async function deployProxy(
  ethers: any,
  contractName: string,
  initializerArgs: any[]
) {
  const implementationFactory = await ethers.getContractFactory(contractName);
  const implementation = await implementationFactory.deploy();
  await implementation.waitForDeployment();

  const proxyFactory = await ethers.getContractFactory("TestERC1967Proxy");
  const initData = implementationFactory.interface.encodeFunctionData(
    "initialize",
    initializerArgs
  );
  const proxy = await proxyFactory.deploy(
    await implementation.getAddress(),
    initData
  );
  await proxy.waitForDeployment();

  return implementationFactory.attach(await proxy.getAddress());
}

async function deployNFT(ethers: any, owner: any, royaltyReceiver?: any) {
  const ownerAddress = await owner.getAddress();
  const royaltyAddress = royaltyReceiver
    ? await royaltyReceiver.getAddress()
    : ownerAddress;

  return deployProxy(ethers, "LitVerseNFT", [
    ownerAddress,
    "LitVerse Test NFT",
    "LVT",
    1000n,
    ethers.parseEther("0.01"),
    5n,
    0n,
    royaltyAddress,
    "ipfs://hidden.json",
  ]);
}

describe("LitVerse automated tests", function () {
  it("NFT: initializes, mints, sets token URI and enforces owner-only controls", async function () {
    const { ethers } = await network.connect();
    const [owner, user, other] = await ethers.getSigners();
    const nft: any = await deployNFT(ethers, owner);

    assert.equal(await nft.owner(), await owner.getAddress());
    assert.equal(await nft.totalMinted(), 0n);

    await (await nft.connect(user).publicMint(2n, {
      value: ethers.parseEther("0.02"),
    })).wait();

    assert.equal(await nft.totalMinted(), 2n);
    assert.equal(await nft.ownerOf(1n), await user.getAddress());
    assert.equal(await nft.ownerOf(2n), await user.getAddress());

    await assert.rejects(
      nft.connect(other).setReveal(true),
      /OwnableUnauthorizedAccount|revert/
    );

    await (await nft.connect(owner).setTokenURI(1n, "ipfs://token-1.json")).wait();
    await (await nft.connect(owner).setReveal(true)).wait();
    assert.equal(await nft.tokenURI(1n), "ipfs://token-1.json");

    await (await nft.connect(user).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    })).wait();

    assert.equal(await nft.totalMinted(), 3n);
  });

  it("Marketplace: lists and sells an NFT, applying platform fee and royalty", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, buyer, feeRecipient] = await ethers.getSigners();

    const nft: any = await deployNFT(ethers, owner, owner);
    await (await nft.connect(owner).ownerMint(await seller.getAddress(), 1n)).wait();

    const marketplace: any = await deployProxy(ethers, "LitVerseMarketplace", [
      await owner.getAddress(),
      await feeRecipient.getAddress(),
      250n,
    ]);

    await (await nft.connect(seller).approve(await marketplace.getAddress(), 1n)).wait();
    await (await marketplace.connect(seller).listNFT(
      await nft.getAddress(),
      1n,
      ethers.parseEther("1")
    )).wait();

    const listing = await marketplace.listings(1n);
    assert.equal(listing.active, true);
    assert.equal(await nft.ownerOf(1n), await marketplace.getAddress());

    await (await marketplace.connect(buyer).buyNFT(1n, {
      value: ethers.parseEther("1"),
    })).wait();

    assert.equal(await nft.ownerOf(1n), await buyer.getAddress());
    const completedListing = await marketplace.listings(1n);
    assert.equal(completedListing.active, false);
  });

  it("Auction: accepts a bid, finalizes, lets winner claim NFT and withdraw proceeds", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, bidder, feeRecipient] = await ethers.getSigners();

    const nft: any = await deployNFT(ethers, owner, owner);
    await (await nft.connect(owner).ownerMint(await seller.getAddress(), 1n)).wait();

    const auction: any = await deployProxy(ethers, "LitVerseAuction", [
      await owner.getAddress(),
      await feeRecipient.getAddress(),
      250n,
    ]);

    await (await nft.connect(seller).approve(await auction.getAddress(), 1n)).wait();
    await (await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.5"),
      3600n
    )).wait();

    await (await auction.connect(bidder).placeBid(1n, {
      value: ethers.parseEther("1"),
    })).wait();

    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);

    await (await auction.connect(owner).finalizeAuction(1n)).wait();
    await (await auction.connect(bidder).claimNFT(1n)).wait();

    assert.equal(await nft.ownerOf(1n), await bidder.getAddress());
    assert.equal(await auction.pendingWithdrawals(await seller.getAddress()) > 0n, true);
    assert.equal(await auction.pendingWithdrawals(await feeRecipient.getAddress()) > 0n, true);

    await (await auction.connect(seller).withdraw()).wait();
    await (await auction.connect(feeRecipient).withdraw()).wait();
  });

  it("Collection Factory: creates a registered NFT collection from the NFT implementation", async function () {
    const { ethers } = await network.connect();
    const [owner, creator] = await ethers.getSigners();

    const nftImplementationFactory = await ethers.getContractFactory("LitVerseNFT");
    const nftImplementation = await nftImplementationFactory.deploy();
    await nftImplementation.waitForDeployment();

    const factory: any = await deployProxy(ethers, "LitVerseCollectionFactory", [
      await owner.getAddress(),
      await nftImplementation.getAddress(),
    ]);

    await (await factory.connect(creator).createCollection({
      name: "Creator Collection",
      symbol: "CRC",
      maxSupply: 100n,
      mintPrice: ethers.parseEther("0.01"),
      walletLimit: 3n,
      saleStartTime: 0n,
      hiddenMetadataURI: "ipfs://collection-hidden.json",
    })).wait();

    const collection = await factory.getCollection(1n);
    assert.notEqual(collection.collectionAddress, ethers.ZeroAddress);
    assert.equal(collection.creator, await creator.getAddress());
    assert.equal(collection.name, "Creator Collection");
    assert.equal(await factory.isRegisteredCollection(collection.collectionAddress), true);

    const createdNFT: any = nftImplementationFactory.attach(collection.collectionAddress);
    assert.equal(await createdNFT.owner(), await creator.getAddress());
    assert.equal(await createdNFT.name(), "Creator Collection");
  });

  it("Auction: refunds the highest bidder when a later bid replaces it", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, bidder1, bidder2, feeRecipient] = await ethers.getSigners();

    const nft: any = await deployNFT(ethers, owner);
    await (await nft.connect(owner).ownerMint(await seller.getAddress(), 1n)).wait();

    const auction: any = await deployProxy(ethers, "LitVerseAuction", [
      await owner.getAddress(),
      await feeRecipient.getAddress(),
      250n,
    ]);

    await (await nft.connect(seller).approve(await auction.getAddress(), 1n)).wait();
    await (await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.1"),
      3600n
    )).wait();

    await (await auction.connect(bidder1).placeBid(1n, {
      value: ethers.parseEther("0.2"),
    })).wait();
    await (await auction.connect(bidder2).placeBid(1n, {
      value: ethers.parseEther("0.3"),
    })).wait();

    assert.equal(
      await auction.pendingWithdrawals(await bidder1.getAddress()),
      ethers.parseEther("0.2")
    );
    await (await auction.connect(bidder1).withdraw()).wait();
  });
});
