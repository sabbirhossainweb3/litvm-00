import { network } from "hardhat";
import { describe, it } from "mocha";
import assert from "node:assert/strict";

describe("LitVerse Marketplace Integration", function () {
  it("mints, lists, sells NFT and distributes fees correctly", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, buyer, feeRecipient, royaltyReceiver] =
      await ethers.getSigners();

    // Deploy NFT implementation
    const nftFactory = await ethers.getContractFactory("LitVerseNFT");
    const nftImplementation = await nftFactory.deploy();
    await nftImplementation.waitForDeployment();

    // Deploy NFT proxy
    const proxyFactory = await ethers.getContractFactory("TestERC1967Proxy");

    const nftInitData = nftFactory.interface.encodeFunctionData("initialize", [
      await seller.getAddress(),
      "LitVerse Integration NFT",
      "LINT",
      1000n,
      ethers.parseEther("0.01"),
      5n,
      0n,
      await royaltyReceiver.getAddress(),
      "ipfs://hidden.json",
    ]);

    const nftProxy = await proxyFactory.deploy(
      await nftImplementation.getAddress(),
      nftInitData
    );
    await nftProxy.waitForDeployment();

    const nft = nftFactory.attach(await nftProxy.getAddress());

    // Seller mints NFT
    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    assert.equal(await nft.ownerOf(1n), await seller.getAddress());

    // Deploy Marketplace implementation
    const marketFactory = await ethers.getContractFactory("LitVerseMarketplace");
    const marketImplementation = await marketFactory.deploy();
    await marketImplementation.waitForDeployment();

    // Deploy Marketplace proxy
    const marketInitData = marketFactory.interface.encodeFunctionData(
      "initialize",
      [
        await owner.getAddress(),
        await feeRecipient.getAddress(),
        250n,
      ]
    );

    const marketProxy = await proxyFactory.deploy(
      await marketImplementation.getAddress(),
      marketInitData
    );
    await marketProxy.waitForDeployment();

    const marketplace = marketFactory.attach(
      await marketProxy.getAddress()
    );

    // List in one transaction with no prior approve/setApprovalForAll call.
    const salePrice = ethers.parseEther("1");
    const listingData = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [salePrice]);
    await nft.connect(seller)["safeTransferFrom(address,address,uint256,bytes)"](
      await seller.getAddress(), await marketplace.getAddress(), 1n, listingData
    );

    assert.equal(
      await nft.ownerOf(1n),
      await marketplace.getAddress()
    );

    // Record balances
    const sellerBefore = await ethers.provider.getBalance(
      await seller.getAddress()
    );

    const feeBefore = await ethers.provider.getBalance(
      await feeRecipient.getAddress()
    );

    const royaltyBefore = await ethers.provider.getBalance(
      await royaltyReceiver.getAddress()
    );

    // Buyer purchases NFT
    await marketplace.connect(buyer).buyNFT(1n, {
      value: salePrice,
    });

    // Expected distribution
    const expectedPlatformFee = ethers.parseEther("0.025");
    const expectedRoyalty = ethers.parseEther("0.05");
    const expectedSellerAmount = ethers.parseEther("0.925");

    const sellerAfter = await ethers.provider.getBalance(
      await seller.getAddress()
    );

    const feeAfter = await ethers.provider.getBalance(
      await feeRecipient.getAddress()
    );

    const royaltyAfter = await ethers.provider.getBalance(
      await royaltyReceiver.getAddress()
    );

    assert.equal(
      sellerAfter - sellerBefore,
      expectedSellerAmount
    );

    assert.equal(
      feeAfter - feeBefore,
      expectedPlatformFee
    );

    assert.equal(
      royaltyAfter - royaltyBefore,
      expectedRoyalty
    );

    // Ownership transferred to buyer
    assert.equal(
      await nft.ownerOf(1n),
      await buyer.getAddress()
    );

    // Listing is inactive
    const listing = await marketplace.listings(1n);
    assert.equal(listing.active, false);
  });
});