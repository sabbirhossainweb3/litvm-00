import { network } from "hardhat";
import { describe, it } from "mocha";
import assert from "node:assert/strict";

async function deployProxy(ethers: any, name: string, args: any[]) {
  const factory = await ethers.getContractFactory(name);
  const implementation = await factory.deploy();
  await implementation.waitForDeployment();

  const proxyFactory = await ethers.getContractFactory("TestERC1967Proxy");
  const initData = factory.interface.encodeFunctionData("initialize", args);
  const proxy = await proxyFactory.deploy(await implementation.getAddress(), initData);
  await proxy.waitForDeployment();
  return factory.attach(await proxy.getAddress());
}

describe("LitVerse Security Hardening", function () {
  it("blocks all NFT transfers while paused and locks revealed metadata", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, buyer, royalty] = await ethers.getSigners();
    const nft = await deployProxy(ethers, "LitVerseNFT", [
      await owner.getAddress(), "LitVerse", "LTV", 100n, 0n, 5n, 0n,
      await royalty.getAddress(), "ipfs://hidden.json",
    ]);

    await nft.connect(owner).ownerMint(await seller.getAddress(), 1n);
    await nft.connect(owner).setTokenURI(1n, "ipfs://one.json");
    await nft.connect(owner).setReveal(true);

    await assert.rejects(nft.connect(owner).setReveal(false));
    await assert.rejects(nft.connect(owner).setTokenURI(1n, "ipfs://changed.json"));
    await assert.rejects(nft.connect(owner).setHiddenMetadataURI("ipfs://changed-hidden.json"));

    await nft.connect(owner).pause();
    await assert.rejects(nft.connect(seller).transferFrom(
      await seller.getAddress(), await buyer.getAddress(), 1n
    ));
    await nft.connect(owner).unpause();
    await nft.connect(seller).transferFrom(
      await seller.getAddress(), await buyer.getAddress(), 1n
    );
    assert.equal(await nft.ownerOf(1n), await buyer.getAddress());

    // Tokens minted after reveal can receive a URI once, but it cannot be changed.
    await nft.connect(owner).ownerMint(await seller.getAddress(), 1n);
    await nft.connect(owner).setTokenURI(2n, "ipfs://two.json");
    await assert.rejects(nft.connect(owner).setTokenURI(2n, "ipfs://two-changed.json"));
  });

  it("auto-approves factory collections and requires explicit approval for external collections in Marketplace", async function () {
    const { ethers } = await network.connect();
    const [owner, creator, seller, fee, royalty] = await ethers.getSigners();

    const nftImplFactory = await ethers.getContractFactory("LitVerseNFT");
    const nftImpl = await nftImplFactory.deploy();
    await nftImpl.waitForDeployment();

    const factory = await deployProxy(ethers, "LitVerseCollectionFactory", [
      await owner.getAddress(), await nftImpl.getAddress(),
    ]);
    const market = await deployProxy(ethers, "LitVerseMarketplace", [
      await owner.getAddress(), await fee.getAddress(), 250n,
    ]);
    await market.setCollectionFactory(await factory.getAddress());

    await factory.connect(creator).createCollection({
      name: "Factory Collection", symbol: "FC", maxSupply: 10n,
      mintPrice: 0n, walletLimit: 5n, saleStartTime: 0n,
      hiddenMetadataURI: "ipfs://hidden.json",
    });
    const factoryCollection = await factory.getCollection(1n);
    const nftFactory = await ethers.getContractFactory("LitVerseNFT");
    const factoryNFT = nftFactory.attach(factoryCollection.collectionAddress);

    await factoryNFT.connect(creator).publicMint(1n, { value: 0n });
    await factoryNFT.connect(creator).approve(await market.getAddress(), 1n);
    await market.connect(creator).listNFT(
      factoryCollection.collectionAddress, 1n, ethers.parseEther("1")
    );

    const externalNFT = await deployProxy(ethers, "LitVerseNFT", [
      await owner.getAddress(), "External", "EXT", 10n, 0n, 5n, 0n,
      await royalty.getAddress(), "ipfs://hidden.json",
    ]);
    await externalNFT.connect(owner).ownerMint(await seller.getAddress(), 1n);
    await externalNFT.connect(seller).approve(await market.getAddress(), 1n);
    await assert.rejects(market.connect(seller).listNFT(
      await externalNFT.getAddress(), 1n, ethers.parseEther("1")
    ));

    await market.setCollectionApproval(await externalNFT.getAddress(), true);
    await market.connect(seller).listNFT(
      await externalNFT.getAddress(), 1n, ethers.parseEther("1")
    );
    await market.pause();
    await assert.rejects(market.connect(seller).cancelListing(2n));
  });

  it("auto-approves factory collections and requires explicit approval for external collections in Auction", async function () {
    const { ethers } = await network.connect();
    const [owner, creator, seller, fee, royalty] = await ethers.getSigners();

    const nftImplFactory = await ethers.getContractFactory("LitVerseNFT");
    const nftImpl = await nftImplFactory.deploy();
    await nftImpl.waitForDeployment();

    const factory = await deployProxy(ethers, "LitVerseCollectionFactory", [
      await owner.getAddress(), await nftImpl.getAddress(),
    ]);
    const auction = await deployProxy(ethers, "LitVerseAuction", [
      await owner.getAddress(), await fee.getAddress(), 250n,
    ]);
    await auction.setCollectionFactory(await factory.getAddress());

    await factory.connect(creator).createCollection({
      name: "Auction Collection", symbol: "AC", maxSupply: 10n,
      mintPrice: 0n, walletLimit: 5n, saleStartTime: 0n,
      hiddenMetadataURI: "ipfs://hidden.json",
    });
    const factoryCollection = await factory.getCollection(1n);
    const nftFactory = await ethers.getContractFactory("LitVerseNFT");
    const factoryNFT = nftFactory.attach(factoryCollection.collectionAddress);

    await factoryNFT.connect(creator).publicMint(1n, { value: 0n });
    await factoryNFT.connect(creator).approve(await auction.getAddress(), 1n);
    await auction.connect(creator).createAuction(
      factoryCollection.collectionAddress, 1n, ethers.parseEther("1"), 3600n
    );

    const externalNFT = await deployProxy(ethers, "LitVerseNFT", [
      await owner.getAddress(), "External Auction", "EAX", 10n, 0n, 5n, 0n,
      await royalty.getAddress(), "ipfs://hidden.json",
    ]);
    await externalNFT.connect(owner).ownerMint(await seller.getAddress(), 1n);
    await externalNFT.connect(seller).approve(await auction.getAddress(), 1n);
    await assert.rejects(auction.connect(seller).createAuction(
      await externalNFT.getAddress(), 1n, ethers.parseEther("1"), 3600n
    ));

    await auction.setCollectionApproval(await externalNFT.getAddress(), true);
    await auction.connect(seller).createAuction(
      await externalNFT.getAddress(), 1n, ethers.parseEther("1"), 3600n
    );
  });
});
