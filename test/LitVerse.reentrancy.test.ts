
import { network } from "hardhat";
import { describe, it } from "mocha";
import assert from "node:assert/strict";

async function deployProxy(
  ethers: any,
  contractName: string,
  initializerArgs: any[]
) {
  const factory = await ethers.getContractFactory(contractName);
  const implementation = await factory.deploy();
  await implementation.waitForDeployment();

  const initData = factory.interface.encodeFunctionData(
    "initialize",
    initializerArgs
  );

  const proxyFactory = await ethers.getContractFactory("TestERC1967Proxy");
  const proxy = await proxyFactory.deploy(
    await implementation.getAddress(),
    initData
  );
  await proxy.waitForDeployment();

  return factory.attach(await proxy.getAddress());
}

describe("LitVerse Auction - Reentrancy Security", function () {
  it("should block reentrant withdrawal attack", async function () {
    const { ethers } = await network.connect();

    const [owner, seller, bidder] = await ethers.getSigners();

    // Deploy malicious receiver
    const receiverFactory = await ethers.getContractFactory(
      "ReentrantWithdrawReceiver"
    );
    const receiver = await receiverFactory.deploy();
    await receiver.waitForDeployment();

    const receiverAddress = await receiver.getAddress();

    // Deploy NFT
    const nft = await deployProxy(ethers, "LitVerseNFT", [
      owner.address,
      "LitVerse Test NFT",
      "LVT",
      1000n,
      ethers.parseEther("0.01"),
      5n,
      0n,
      owner.address,
      "ipfs://hidden.json"
    ]);

    // Deploy Auction with malicious fee recipient
    const auction = await deployProxy(ethers, "LitVerseAuction", [
      owner.address,
      receiverAddress,
      250n
    ]);

    const nftAddress = await nft.getAddress();
    const auctionAddress = await auction.getAddress();

    await receiver.setTarget(auctionAddress);

    // Mint NFT to seller
    await nft.ownerMint(seller.address, 1n);

    // Approve Auction
    await nft.connect(seller).approve(auctionAddress, 1n);

    // Create auction
    await auction.connect(seller).createAuction(
      nftAddress,
      1n,
      ethers.parseEther("0.5"),
      3600n
    );

    // Place bid
    await auction.connect(bidder).placeBid(1n, {
      value: ethers.parseEther("1")
    });

    // Move time forward
    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);

    // Finalize auction
    await auction.finalizeAuction(1n);

    const expectedFee = ethers.parseEther("0.025");

    assert.equal(
      await auction.pendingWithdrawals(receiverAddress),
      expectedFee
    );

    // Trigger malicious withdrawal
    await receiver.attack();

    // Verify reentrancy was blocked
    assert.equal(await receiver.reentryBlocked(), true);
    assert.equal(await receiver.receiveCount(), 1n);

    // Verify withdrawal completed only once
    assert.equal(
      await auction.pendingWithdrawals(receiverAddress),
      0n
    );

    assert.equal(
      await ethers.provider.getBalance(receiverAddress),
      expectedFee
    );
  });
});
