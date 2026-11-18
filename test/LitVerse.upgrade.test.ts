import { network } from "hardhat";
import { describe, it } from "mocha";
import assert from "node:assert/strict";

describe("LitVerse NFT UUPS Upgrade", function () {
  it("upgrades V1 to V2 and preserves NFT data", async function () {
    const { ethers } = await network.connect();
    const [owner, attacker] = await ethers.getSigners();
    const ownerAddress = await owner.getAddress();

    const factory = await ethers.getContractFactory("LitVerseNFT");
    const implementation = await factory.deploy();
    await implementation.waitForDeployment();

    const proxyFactory = await ethers.getContractFactory("TestERC1967Proxy");
    const initData = factory.interface.encodeFunctionData("initialize", [ownerAddress, "LitVerse Test NFT", "LVT", 1000n, ethers.parseEther("0.01"), 5n, 0n, ownerAddress, "ipfs://hidden.json"]);
    const proxy = await proxyFactory.deploy(await implementation.getAddress(), initData);
    await proxy.waitForDeployment();

    const nft = factory.attach(await proxy.getAddress());
    await nft.connect(owner).publicMint(1, { value: ethers.parseEther("0.01") });

    const v2Factory = await ethers.getContractFactory("LitVerseNFTV2");
    const v2Implementation = await v2Factory.deploy();
    await v2Implementation.waitForDeployment();

    await assert.rejects(nft.connect(attacker).upgradeToAndCall(await v2Implementation.getAddress(), "0x"));

    await nft.connect(owner).upgradeToAndCall(await v2Implementation.getAddress(), "0x");

    const upgraded = v2Factory.attach(await proxy.getAddress());
    assert.equal(await upgraded.version(), 2n);
    assert.equal(await upgraded.owner(), ownerAddress);
    assert.equal(await upgraded.totalMinted(), 1n);
    assert.equal(await upgraded.ownerOf(1), ownerAddress);
  });
});
