import { network } from "hardhat";
import { describe, it } from "mocha";
import assert from "node:assert/strict";

describe("LitVerse Collection Factory Integration Tests", function () {

  async function deployNFTImplementation(ethers: any) {
    const factory = await ethers.getContractFactory("LitVerseNFT");
    const implementation = await factory.deploy();
    await implementation.waitForDeployment();
    return implementation;
  }

  async function deployCollectionFactory(
    ethers: any,
    owner: any,
    implementation: any
  ) {
    const factory = await ethers.getContractFactory("LitVerseCollectionFactory");
    const factoryImplementation = await factory.deploy();
    await factoryImplementation.waitForDeployment();

    const proxyFactory = await ethers.getContractFactory("TestERC1967Proxy");

    const initData = factory.interface.encodeFunctionData("initialize", [
      await owner.getAddress(),
      await implementation.getAddress(),
    ]);

    const proxy = await proxyFactory.deploy(
      await factoryImplementation.getAddress(),
      initData
    );

    await proxy.waitForDeployment();

    return factory.attach(await proxy.getAddress());
  }

  function config(ethers: any, name = "Test Collection") {
    return {
      name,
      symbol: "TST",
      maxSupply: 100n,
      mintPrice: ethers.parseEther("0.01"),
      walletLimit: 5n,
      saleStartTime: 0n,
      hiddenMetadataURI: "ipfs://hidden.json",
    };
  }

  it("creates a collection and registers it correctly", async function () {
    const { ethers } = await network.connect();
    const [owner, creator] = await ethers.getSigners();

    const implementation = await deployNFTImplementation(ethers);
    const factory = await deployCollectionFactory(ethers, owner, implementation);

    const tx = await factory.connect(creator).createCollection(config(ethers));
    await tx.wait();

    const collection = await factory.getCollection(1n);

    assert.equal(await factory.collectionCount(), 1n);
    assert.equal(collection.creator, await creator.getAddress());
    assert.equal(collection.name, "Test Collection");
    assert.equal(collection.symbol, "TST");
    assert.equal(await factory.isRegisteredCollection(collection.collectionAddress), true);

    const nftFactory = await ethers.getContractFactory("LitVerseNFT");
    const nft = nftFactory.attach(collection.collectionAddress);

    assert.equal(await nft.owner(), await creator.getAddress());
    assert.equal(await nft.name(), "Test Collection");
    assert.equal(await nft.symbol(), "TST");
  });

  it("allows the collection creator to mint an NFT", async function () {
    const { ethers } = await network.connect();
    const [owner, creator] = await ethers.getSigners();

    const implementation = await deployNFTImplementation(ethers);
    const factory = await deployCollectionFactory(ethers, owner, implementation);

    await factory.connect(creator).createCollection(config(ethers));

    const collection = await factory.getCollection(1n);
    const nftFactory = await ethers.getContractFactory("LitVerseNFT");
    const nft = nftFactory.attach(collection.collectionAddress);

    await nft.connect(creator).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    assert.equal(await nft.totalMinted(), 1n);
    assert.equal(await nft.ownerOf(1n), await creator.getAddress());
  });

  it("creates a collection with an enforced mint end date", async function () {
    const { ethers } = await network.connect();
    const [owner, creator] = await ethers.getSigners();

    const implementation = await deployNFTImplementation(ethers);
    const factory = await deployCollectionFactory(ethers, owner, implementation);
    const latest = await ethers.provider.getBlock("latest");
    assert.ok(latest);

    const saleStartTime = BigInt(latest.timestamp + 60);
    const saleEndTime = saleStartTime + 3600n;
    const saleConfig = {
      ...config(ethers, "Timed Drop"),
      saleStartTime,
      saleEndTime,
      metadataURI: "https://media.example.test/timed-drop.json",
    };

    await factory.connect(creator).createCollectionWithSaleEnd(saleConfig);
    const collection = await factory.getCollection(1n);
    const nftFactory = await ethers.getContractFactory("LitVerseNFT");
    const nft = nftFactory.attach(collection.collectionAddress);

    assert.equal(await nft.saleEndTime(), saleEndTime);
    assert.equal(await nft.collectionMetadataURI(), "https://media.example.test/timed-drop.json");
    assert.equal(await nft.owner(), await creator.getAddress());

    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(saleStartTime)]);
    await ethers.provider.send("evm_mine", []);
    await nft.connect(creator).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });
    assert.equal(await nft.totalMinted(), 1n);
    await nft.connect(creator).setReveal(true);
    assert.equal(await nft.tokenURI(1n), "https://media.example.test/timed-drop.json");
    await nft.connect(creator).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });
    assert.equal(await nft.tokenURI(2n), "https://media.example.test/timed-drop.json");

    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(saleEndTime + 1n)]);
    await ethers.provider.send("evm_mine", []);
    await assert.rejects(
      nft.connect(creator).publicMint(1n, {
        value: ethers.parseEther("0.01"),
      })
    );
    assert.equal(await nft.totalMinted(), 2n);
  });

  it("rejects a sale end time that is not after the sale start", async function () {
    const { ethers } = await network.connect();
    const [owner, creator] = await ethers.getSigners();
    const implementation = await deployNFTImplementation(ethers);
    const factory = await deployCollectionFactory(ethers, owner, implementation);
    const latest = await ethers.provider.getBlock("latest");
    assert.ok(latest);
    const saleStartTime = BigInt(latest.timestamp + 60);

    await assert.rejects(
      factory.connect(creator).createCollectionWithSaleEnd({
        ...config(ethers, "Invalid Timed Drop"),
        saleStartTime,
        saleEndTime: saleStartTime,
        metadataURI: "https://media.example.test/invalid.json",
      })
    );
    assert.equal(await factory.collectionCount(), 0n);
  });

  it("rejects invalid collection configurations", async function () {
    const { ethers } = await network.connect();
    const [owner, creator] = await ethers.getSigners();

    const implementation = await deployNFTImplementation(ethers);
    const factory = await deployCollectionFactory(ethers, owner, implementation);

    const emptyName = {
      ...config(ethers),
      name: "",
    };

    await assert.rejects(
      factory.connect(creator).createCollection(emptyName)
    );

    const emptySymbol = {
      ...config(ethers),
      symbol: "",
    };

    await assert.rejects(
      factory.connect(creator).createCollection(emptySymbol)
    );

    const zeroSupply = {
      ...config(ethers),
      maxSupply: 0n,
    };

    await assert.rejects(
      factory.connect(creator).createCollection(zeroSupply)
    );

    const zeroWalletLimit = {
      ...config(ethers),
      walletLimit: 0n,
    };

    await assert.rejects(
      factory.connect(creator).createCollection(zeroWalletLimit)
    );

    assert.equal(await factory.collectionCount(), 0n);
  });

  it("rejects unauthorized implementation updates", async function () {
    const { ethers } = await network.connect();
    const [owner, attacker] = await ethers.getSigners();

    const implementation = await deployNFTImplementation(ethers);
    const anotherImplementation = await deployNFTImplementation(ethers);
    const factory = await deployCollectionFactory(ethers, owner, implementation);

    await assert.rejects(
      factory.connect(attacker).setNFTImplementation(
        await anotherImplementation.getAddress()
      )
    );

    assert.equal(
      await factory.nftImplementation(),
      await implementation.getAddress()
    );
  });

  it("allows owner to update NFT implementation", async function () {
    const { ethers } = await network.connect();
    const [owner] = await ethers.getSigners();

    const implementation = await deployNFTImplementation(ethers);
    const anotherImplementation = await deployNFTImplementation(ethers);
    const factory = await deployCollectionFactory(ethers, owner, implementation);

    await factory.setNFTImplementation(await anotherImplementation.getAddress());

    assert.equal(
      await factory.nftImplementation(),
      await anotherImplementation.getAddress()
    );
  });

  it("blocks collection creation while paused", async function () {
    const { ethers } = await network.connect();
    const [owner, creator] = await ethers.getSigners();

    const implementation = await deployNFTImplementation(ethers);
    const factory = await deployCollectionFactory(ethers, owner, implementation);

    await factory.pause();

    await assert.rejects(
      factory.connect(creator).createCollection(config(ethers))
    );

    await factory.unpause();

    await factory.connect(creator).createCollection(config(ethers));

    assert.equal(await factory.collectionCount(), 1n);
  });

  it("rejects requests for nonexistent collections", async function () {
    const { ethers } = await network.connect();
    const [owner] = await ethers.getSigners();

    const implementation = await deployNFTImplementation(ethers);
    const factory = await deployCollectionFactory(ethers, owner, implementation);

    await assert.rejects(factory.getCollection(0n));
    await assert.rejects(factory.getCollection(1n));
  });

});