import { network } from "hardhat";
import { describe, it } from "mocha";
import assert from "node:assert/strict";

async function deployProxy(ethers: any, name: string, args: any[]) {
  const factory = await ethers.getContractFactory(name);
  const implementation = await factory.deploy();
  await implementation.waitForDeployment();

  const proxyFactory = await ethers.getContractFactory("TestERC1967Proxy");
  const initData = factory.interface.encodeFunctionData("initialize", args);

  const proxy = await proxyFactory.deploy(
    await implementation.getAddress(),
    initData
  );
  await proxy.waitForDeployment();

  return factory.attach(await proxy.getAddress());
}

describe("LitVerse Marketplace Security", function () {
  it("rejects incorrect payment", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, buyer, feeRecipient, royaltyReceiver] =
      await ethers.getSigners();

    const nft = await deployProxy(ethers, "LitVerseNFT", [
      await seller.getAddress(),
      "LitVerse Security NFT",
      "LSN",
      100n,
      ethers.parseEther("0.01"),
      5n,
      0n,
      await royaltyReceiver.getAddress(),
      "ipfs://hidden.json",
    ]);

    const marketplace = await deployProxy(ethers, "LitVerseMarketplace", [
      await owner.getAddress(),
      await feeRecipient.getAddress(),
      250n,
    ]);

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await nft.connect(seller).approve(
      await marketplace.getAddress(),
      1n
    );

    await marketplace.connect(seller).listNFT(
      await nft.getAddress(),
      1n,
      ethers.parseEther("1")
    );

    await assert.rejects(
      marketplace.connect(buyer).buyNFT(1n, {
        value: ethers.parseEther("0.5"),
      })
    );

    assert.equal(
      await nft.ownerOf(1n),
      await marketplace.getAddress()
    );

    const listing = await marketplace.listings(1n);
    assert.equal(listing.active, true);
  });

  it("rejects seller buying their own NFT", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, buyer, feeRecipient, royaltyReceiver] =
      await ethers.getSigners();

    const nft = await deployProxy(ethers, "LitVerseNFT", [
      await seller.getAddress(),
      "LitVerse Security NFT",
      "LSN",
      100n,
      ethers.parseEther("0.01"),
      5n,
      0n,
      await royaltyReceiver.getAddress(),
      "ipfs://hidden.json",
    ]);

    const marketplace = await deployProxy(ethers, "LitVerseMarketplace", [
      await owner.getAddress(),
      await feeRecipient.getAddress(),
      250n,
    ]);

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await nft.connect(seller).approve(
      await marketplace.getAddress(),
      1n
    );

    await marketplace.connect(seller).listNFT(
      await nft.getAddress(),
      1n,
      ethers.parseEther("1")
    );

    await assert.rejects(
      marketplace.connect(seller).buyNFT(1n, {
        value: ethers.parseEther("1"),
      })
    );

    assert.equal(
      await nft.ownerOf(1n),
      await marketplace.getAddress()
    );

    const listing = await marketplace.listings(1n);
    assert.equal(listing.active, true);
  });
});