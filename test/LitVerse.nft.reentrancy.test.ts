import { network } from "hardhat";
import { describe, it } from "mocha";
import assert from "node:assert/strict";

describe("LitVerse NFT Withdrawal Reentrancy", function () {
  it("blocks reentrant NFT withdrawal", async function () {
    const { ethers } = await network.connect();
    const [owner, buyer] = await ethers.getSigners();

    const factory = await ethers.getContractFactory("LitVerseNFT");
    const implementation = await factory.deploy();
    await implementation.waitForDeployment();

    const proxyFactory = await ethers.getContractFactory("TestERC1967Proxy");

    const initData = factory.interface.encodeFunctionData("initialize", [
      await owner.getAddress(),
      "LitVerse Reentrancy NFT",
      "LVR",
      1000n,
      ethers.parseEther("0.01"),
      5n,
      0n,
      await owner.getAddress(),
      "ipfs://hidden.json",
    ]);

    const proxy = await proxyFactory.deploy(
      await implementation.getAddress(),
      initData
    );
    await proxy.waitForDeployment();

    const nft = factory.attach(await proxy.getAddress());

    await nft.connect(buyer).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    const receiverFactory = await ethers.getContractFactory(
      "ReentrantNFTWithdrawReceiver"
    );
    const receiver = await receiverFactory.deploy();
    await receiver.waitForDeployment();

    await nft.transferOwnership(await receiver.getAddress());

    await receiver.attack(await nft.getAddress());

    assert.equal(await receiver.reentryBlocked(), true);
    assert.equal(await receiver.receiveCount(), 1n);
    assert.equal(
      await ethers.provider.getBalance(await nft.getAddress()),
      0n
    );
    assert.equal(
      await ethers.provider.getBalance(await receiver.getAddress()),
      ethers.parseEther("0.01")
    );
  });
});