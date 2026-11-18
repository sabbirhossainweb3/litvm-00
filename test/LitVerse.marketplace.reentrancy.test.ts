import { network } from "hardhat";
import { describe, it } from "mocha";
import assert from "node:assert/strict";

async function deployProxy(ethers: any, name: string, args: any[]) {
  const factory = await ethers.getContractFactory(name);
  const implementation = await factory.deploy();
  await implementation.waitForDeployment();
  const initData = factory.interface.encodeFunctionData("initialize", args);
  const proxyFactory = await ethers.getContractFactory("TestERC1967Proxy");
  const proxy = await proxyFactory.deploy(await implementation.getAddress(), initData);
  await proxy.waitForDeployment();
  return factory.attach(await proxy.getAddress());
}

describe("LitVerse Marketplace - Reentrancy Security", function () {
  it("blocks a fee-recipient reentrant purchase of a second listing", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, buyer] = await ethers.getSigners();

    const receiverFactory = await ethers.getContractFactory("ReentrantMarketplaceReceiver");
    const receiver = await receiverFactory.deploy();
    await receiver.waitForDeployment();
    const receiverAddress = await receiver.getAddress();

    const nft = await deployProxy(ethers, "LitVerseNFT", [
      owner.address, "LitVerse Test NFT", "LVT", 1000n,
      ethers.parseEther("0.01"), 5n, 0n, owner.address, "ipfs://hidden.json"
    ]);

    const marketplace = await deployProxy(ethers, "LitVerseMarketplace", [
      owner.address, receiverAddress, 250n
    ]);

    const nftAddress = await nft.getAddress();
    const marketAddress = await marketplace.getAddress();
    const secondPrice = ethers.parseEther("0.01");

    await nft.ownerMint(seller.address, 2n);
    await nft.connect(seller).approve(marketAddress, 1n);
    await nft.connect(seller).approve(marketAddress, 2n);

    await marketplace.connect(seller).listNFT(nftAddress, 1n, ethers.parseEther("1"));
    await marketplace.connect(seller).listNFT(nftAddress, 2n, secondPrice);

    const attackData = marketplace.interface.encodeFunctionData("buyNFT", [2n]);
    await receiver.configure(marketAddress, attackData, secondPrice);

    await marketplace.connect(buyer).buyNFT(1n, { value: ethers.parseEther("1") });

    assert.equal(await receiver.reentryBlocked(), true);
    assert.equal(await receiver.receiveCount(), 1n);
    assert.equal(await nft.ownerOf(1n), buyer.address);
    assert.equal(await marketplace.listings(2n).then((listing: any) => listing.active), true);
    assert.equal(await nft.ownerOf(2n), marketAddress);
    assert.equal(await marketplace.listings(1n).then((listing: any) => listing.active), false);
  });
});
