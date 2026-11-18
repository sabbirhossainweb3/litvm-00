
import { network } from "hardhat";
import { describe, it } from "mocha";
import assert from "node:assert/strict";

async function deployProxy(
  ethers: any,
  contractName: string,
  args: any[]
) {
  const implementationFactory = await ethers.getContractFactory(contractName);
  const implementation = await implementationFactory.deploy();
  await implementation.waitForDeployment();

  const proxyFactory = await ethers.getContractFactory("TestERC1967Proxy");
  const initData = implementationFactory.interface.encodeFunctionData(
    "initialize",
    args
  );

  const proxy = await proxyFactory.deploy(
    await implementation.getAddress(),
    initData
  );
  await proxy.waitForDeployment();

  return implementationFactory.attach(await proxy.getAddress());
}

async function deployNFT(
  ethers: any,
  owner: any,
  options: any = {}
) {
  const ownerAddress = await owner.getAddress();

  return deployProxy(ethers, "LitVerseNFT", [
    ownerAddress,
    "LitVerse Security NFT",
    "LVS",
    options.maxSupply ?? 1000n,
    ethers.parseEther("0.01"),
    options.walletLimit ?? 5n,
    0n,
    options.royaltyReceiver ?? ownerAddress,
    "ipfs://hidden.json",
  ]);
}

async function deployMarketplace(
  ethers: any,
  owner: any,
  feeRecipient: any
) {
  return deployProxy(ethers, "LitVerseMarketplace", [
    await owner.getAddress(),
    await feeRecipient.getAddress(),
    250n,
  ]);
}

async function deployAuction(
  ethers: any,
  owner: any,
  feeRecipient: any
) {
  return deployProxy(ethers, "LitVerseAuction", [
    await owner.getAddress(),
    await feeRecipient.getAddress(),
    250n,
  ]);
}

describe("LitVerse Extended Security Tests", function () {

  // ==========================================
  // 1. NFT SECURITY
  // ==========================================

  it("NFT: blocks unauthorized owner functions", async function () {
    const { ethers } = await network.connect();
    const [owner, attacker] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner);

    await assert.rejects(
      nft.connect(attacker).configureSale(100n, 0n, 5n)
    );

    await assert.rejects(
      nft.connect(attacker).ownerMint(
        await attacker.getAddress(), 1n
      )
    );

    await assert.rejects(
      nft.connect(attacker).setReveal(true)
    );

    await assert.rejects(
      nft.connect(attacker).pause()
    );
  });

  it("NFT: rejects incorrect payment", async function () {
    const { ethers } = await network.connect();
    const [owner, user] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner);

    await assert.rejects(
      nft.connect(user).publicMint(1n, {
        value: ethers.parseEther("0.005"),
      })
    );

    assert.equal(await nft.totalMinted(), 0n);
  });

  it("NFT: enforces wallet mint limit", async function () {
    const { ethers } = await network.connect();
    const [owner, user] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, {
      walletLimit: 2n,
    });

    await (await nft.connect(user).publicMint(2n, {
      value: ethers.parseEther("0.02"),
    })).wait();

    await assert.rejects(
      nft.connect(user).publicMint(1n, {
        value: ethers.parseEther("0.01"),
      })
    );

    assert.equal(await nft.walletMinted(await user.getAddress()), 2n);
  });

  it("NFT: prevents minting beyond maximum supply", async function () {
    const { ethers } = await network.connect();
    const [owner, user1, user2] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, {
      maxSupply: 2n,
      walletLimit: 5n,
    });

    await (await nft.connect(user1).publicMint(2n, {
      value: ethers.parseEther("0.02"),
    })).wait();

    await assert.rejects(
      nft.connect(user2).publicMint(1n, {
        value: ethers.parseEther("0.01"),
      })
    );

    assert.equal(await nft.totalMinted(), 2n);
  });

  it("NFT: blocks minting while paused", async function () {
    const { ethers } = await network.connect();
    const [owner, user] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner);

    await (await nft.connect(owner).pause()).wait();

    await assert.rejects(
      nft.connect(user).publicMint(1n, {
        value: ethers.parseEther("0.01"),
      })
    );

    await (await nft.connect(owner).unpause()).wait();

    await (await nft.connect(user).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    })).wait();

    assert.equal(await nft.totalMinted(), 1n);
  });

  it("NFT: protects withdrawal from unauthorized and invalid calls", async function () {
    const { ethers } = await network.connect();
    const [owner, attacker] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner);

    await assert.rejects(
      nft.connect(attacker).withdraw(await attacker.getAddress())
    );

    await assert.rejects(
      nft.connect(owner).withdraw(ethers.ZeroAddress)
    );

    await assert.rejects(
      nft.connect(owner).withdraw(await owner.getAddress())
    );
  });


  // ==========================================
  // 2. MARKETPLACE SECURITY
  // ==========================================

  it("Marketplace: blocks unauthorized listing cancellation", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, attacker, feeRecipient] =
      await ethers.getSigners();

    const nft = await deployNFT(ethers, owner);
    const marketplace = await deployMarketplace(
      ethers, owner, feeRecipient
    );

    await (await nft.connect(owner).ownerMint(
      await seller.getAddress(), 1n
    )).wait();

    await (await nft.connect(seller).approve(
      await marketplace.getAddress(), 1n
    )).wait();

    await (await marketplace.connect(seller).listNFT(
      await nft.getAddress(), 1n, ethers.parseEther("1")
    )).wait();

    await assert.rejects(
      marketplace.connect(attacker).cancelListing(1n)
    );

    assert.equal((await marketplace.listings(1n)).active, true);
  });

  it("Marketplace: rejects self-purchase and incorrect payment", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, buyer, feeRecipient] =
      await ethers.getSigners();

    const nft = await deployNFT(ethers, owner);
    const marketplace = await deployMarketplace(
      ethers, owner, feeRecipient
    );

    await (await nft.connect(owner).ownerMint(
      await seller.getAddress(), 1n
    )).wait();

    await (await nft.connect(seller).approve(
      await marketplace.getAddress(), 1n
    )).wait();

    await (await marketplace.connect(seller).listNFT(
      await nft.getAddress(), 1n, ethers.parseEther("1")
    )).wait();

    await assert.rejects(
      marketplace.connect(seller).buyNFT(1n, {
        value: ethers.parseEther("1"),
      })
    );

    await assert.rejects(
      marketplace.connect(buyer).buyNFT(1n, {
        value: ethers.parseEther("0.5"),
      })
    );

    assert.equal((await marketplace.listings(1n)).active, true);
  });

  it("Marketplace: enforces maximum platform fee", async function () {
    const { ethers } = await network.connect();
    const [owner, attacker, feeRecipient] =
      await ethers.getSigners();

    const marketplace = await deployMarketplace(
      ethers, owner, feeRecipient
    );

    await assert.rejects(
      marketplace.connect(owner).setPlatformFee(501n)
    );

    await assert.rejects(
      marketplace.connect(attacker).setPlatformFee(100n)
    );

    assert.equal(await marketplace.platformFeeBps(), 250n);
  });

  it("Marketplace: correctly distributes seller, royalty and platform fee", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, buyer, feeRecipient] =
      await ethers.getSigners();

    const nft = await deployNFT(ethers, owner);
    const marketplace = await deployMarketplace(
      ethers, owner, feeRecipient
    );

    await (await nft.connect(owner).ownerMint(
      await seller.getAddress(), 1n
    )).wait();

    await (await nft.connect(seller).approve(
      await marketplace.getAddress(), 1n
    )).wait();

    await (await marketplace.connect(seller).listNFT(
      await nft.getAddress(), 1n, ethers.parseEther("1")
    )).wait();

    const sellerBefore = await ethers.provider.getBalance(
      await seller.getAddress()
    );

    const ownerBefore = await ethers.provider.getBalance(
      await owner.getAddress()
    );

    const feeBefore = await ethers.provider.getBalance(
      await feeRecipient.getAddress()
    );

    await (await marketplace.connect(buyer).buyNFT(1n, {
      value: ethers.parseEther("1"),
    })).wait();

    const sellerAfter = await ethers.provider.getBalance(
      await seller.getAddress()
    );

    const ownerAfter = await ethers.provider.getBalance(
      await owner.getAddress()
    );

    const feeAfter = await ethers.provider.getBalance(
      await feeRecipient.getAddress()
    );

    assert.equal(
      sellerAfter - sellerBefore,
      ethers.parseEther("0.925")
    );

    assert.equal(
      ownerAfter - ownerBefore,
      ethers.parseEther("0.05")
    );

    assert.equal(
      feeAfter - feeBefore,
      ethers.parseEther("0.025")
    );

    assert.equal(await nft.ownerOf(1n), await buyer.getAddress());
  });

  it("Marketplace: blocks buying while paused", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, buyer, feeRecipient] =
      await ethers.getSigners();

    const nft = await deployNFT(ethers, owner);
    const marketplace = await deployMarketplace(
      ethers, owner, feeRecipient
    );

    await (await nft.connect(owner).ownerMint(
      await seller.getAddress(), 1n
    )).wait();

    await (await nft.connect(seller).approve(
      await marketplace.getAddress(), 1n
    )).wait();

    await (await marketplace.connect(seller).listNFT(
      await nft.getAddress(), 1n, ethers.parseEther("1")
    )).wait();

    await (await marketplace.connect(owner).pause()).wait();

    await assert.rejects(
      marketplace.connect(buyer).buyNFT(1n, {
        value: ethers.parseEther("1"),
      })
    );

    await (await marketplace.connect(owner).unpause()).wait();
  });


  // ==========================================
  // 3. AUCTION SECURITY
  // ==========================================

  it("Auction: rejects seller bids and bids below reserve price", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, bidder, feeRecipient] =
      await ethers.getSigners();

    const nft = await deployNFT(ethers, owner);
    const auction = await deployAuction(
      ethers, owner, feeRecipient
    );

    await (await nft.connect(owner).ownerMint(
      await seller.getAddress(), 1n
    )).wait();

    await (await nft.connect(seller).approve(
      await auction.getAddress(), 1n
    )).wait();

    await (await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.5"),
      3600n
    )).wait();

    await assert.rejects(
      auction.connect(seller).placeBid(1n, {
        value: ethers.parseEther("0.6"),
      })
    );

    await assert.rejects(
      auction.connect(bidder).placeBid(1n, {
        value: ethers.parseEther("0.2"),
      })
    );

    assert.equal(
      (await auction.auctions(1n)).highestBid,
      0n
    );
  });

  it("Auction: refunds previous highest bidder when outbid", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, bidder1, bidder2, feeRecipient] =
      await ethers.getSigners();

    const nft = await deployNFT(ethers, owner);
    const auction = await deployAuction(
      ethers, owner, feeRecipient
    );

    await (await nft.connect(owner).ownerMint(
      await seller.getAddress(), 1n
    )).wait();

    await (await nft.connect(seller).approve(
      await auction.getAddress(), 1n
    )).wait();

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

    assert.equal(
      await auction.pendingWithdrawals(await bidder1.getAddress()),
      0n
    );
  });

  it("Auction: allows cancellation only when no bids exist", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, bidder, feeRecipient] =
      await ethers.getSigners();

    const nft = await deployNFT(ethers, owner);
    const auction = await deployAuction(
      ethers, owner, feeRecipient
    );

    await (await nft.connect(owner).ownerMint(
      await seller.getAddress(), 1n
    )).wait();

    await (await nft.connect(seller).approve(
      await auction.getAddress(), 1n
    )).wait();

    await (await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.1"),
      3600n
    )).wait();

    await (await auction.connect(bidder).placeBid(1n, {
      value: ethers.parseEther("0.2"),
    })).wait();

    await assert.rejects(
      auction.connect(seller).cancelAuction(1n)
    );

    assert.equal(await nft.ownerOf(1n), await auction.getAddress());
  });

  it("Auction: returns NFT to seller after no-bid finalization", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, feeRecipient] =
      await ethers.getSigners();

    const nft = await deployNFT(ethers, owner);
    const auction = await deployAuction(
      ethers, owner, feeRecipient
    );

    await (await nft.connect(owner).ownerMint(
      await seller.getAddress(), 1n
    )).wait();

    await (await nft.connect(seller).approve(
      await auction.getAddress(), 1n
    )).wait();

    await (await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.5"),
      3600n
    )).wait();

    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);

    await (await auction.finalizeAuction(1n)).wait();

    assert.equal(await nft.ownerOf(1n), await seller.getAddress());
    assert.equal((await auction.auctions(1n)).finalized, true);
  });

  it("Auction: only winner can claim NFT and cannot claim twice", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, bidder, attacker, feeRecipient] =
      await ethers.getSigners();

    const nft = await deployNFT(ethers, owner);
    const auction = await deployAuction(
      ethers, owner, feeRecipient
    );

    await (await nft.connect(owner).ownerMint(
      await seller.getAddress(), 1n
    )).wait();

    await (await nft.connect(seller).approve(
      await auction.getAddress(), 1n
    )).wait();

    await (await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.1"),
      3600n
    )).wait();

    await (await auction.connect(bidder).placeBid(1n, {
      value: ethers.parseEther("0.2"),
    })).wait();

    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);

    await (await auction.finalizeAuction(1n)).wait();

    await assert.rejects(
      auction.connect(attacker).claimNFT(1n)
    );

    await (await auction.connect(bidder).claimNFT(1n)).wait();

    assert.equal(await nft.ownerOf(1n), await bidder.getAddress());

    await assert.rejects(
      auction.connect(bidder).claimNFT(1n)
    );
  });

  it("Auction: blocks creation and bidding while paused", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, bidder, feeRecipient] =
      await ethers.getSigners();

    const nft = await deployNFT(ethers, owner);
    const auction = await deployAuction(
      ethers, owner, feeRecipient
    );

    await (await nft.connect(owner).ownerMint(
      await seller.getAddress(), 1n
    )).wait();

    await (await nft.connect(seller).approve(
      await auction.getAddress(), 1n
    )).wait();

    await (await auction.connect(owner).pause()).wait();

    await assert.rejects(
      auction.connect(seller).createAuction(
        await nft.getAddress(),
        1n,
        ethers.parseEther("0.1"),
        3600n
      )
    );

    await (await auction.connect(owner).unpause()).wait();

    await (await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.1"),
      3600n
    )).wait();

    await (await auction.connect(owner).pause()).wait();

    await assert.rejects(
      auction.connect(bidder).placeBid(1n, {
        value: ethers.parseEther("0.2"),
      })
    );
  });

  it("Auction: prevents unauthorized withdrawal and empty withdrawal", async function () {
    const { ethers } = await network.connect();
    const [owner, attacker, feeRecipient] =
      await ethers.getSigners();

    const auction = await deployAuction(
      ethers, owner, feeRecipient
    );

    await assert.rejects(
      auction.connect(attacker).withdraw()
    );

    await assert.rejects(
      auction.connect(owner).withdraw()
    );
  });


  // ==========================================
  // 4. COLLECTION FACTORY SECURITY
  // ==========================================

  it("Factory: blocks unauthorized implementation updates", async function () {
    const { ethers } = await network.connect();
    const [owner, attacker] = await ethers.getSigners();

    const nftFactory = await ethers.getContractFactory("LitVerseNFT");
    const implementation = await nftFactory.deploy();
    await implementation.waitForDeployment();

    const factory = await deployProxy(
      ethers,
      "LitVerseCollectionFactory",
      [
        await owner.getAddress(),
        await implementation.getAddress(),
      ]
    );

    await assert.rejects(
      factory.connect(attacker).setNFTImplementation(
        await implementation.getAddress()
      )
    );
  });

  it("Factory: rejects invalid implementation address", async function () {
    const { ethers } = await network.connect();
    const [owner] = await ethers.getSigners();

    const nftFactory = await ethers.getContractFactory("LitVerseNFT");
    const implementation = await nftFactory.deploy();
    await implementation.waitForDeployment();

    const factory = await deployProxy(
      ethers,
      "LitVerseCollectionFactory",
      [
        await owner.getAddress(),
        await implementation.getAddress(),
      ]
    );

    await assert.rejects(
      factory.connect(owner).setNFTImplementation(
        ethers.ZeroAddress
      )
    );
  });

  it("Factory: rejects invalid collection configuration", async function () {
    const { ethers } = await network.connect();
    const [owner, creator] = await ethers.getSigners();

    const nftFactory = await ethers.getContractFactory("LitVerseNFT");
    const implementation = await nftFactory.deploy();
    await implementation.waitForDeployment();

    const factory = await deployProxy(
      ethers,
      "LitVerseCollectionFactory",
      [
        await owner.getAddress(),
        await implementation.getAddress(),
      ]
    );

    await assert.rejects(
      factory.connect(creator).createCollection({
        name: "",
        symbol: "BAD",
        maxSupply: 100n,
        mintPrice: ethers.parseEther("0.01"),
        walletLimit: 5n,
        saleStartTime: 0n,
        hiddenMetadataURI: "ipfs://hidden.json",
      })
    );

    await assert.rejects(
      factory.connect(creator).createCollection({
        name: "Bad Collection",
        symbol: "BAD",
        maxSupply: 0n,
        mintPrice: ethers.parseEther("0.01"),
        walletLimit: 5n,
        saleStartTime: 0n,
        hiddenMetadataURI: "ipfs://hidden.json",
      })
    );

    assert.equal(await factory.collectionCount(), 0n);
  });

  it("Factory: blocks collection creation while paused", async function () {
    const { ethers } = await network.connect();
    const [owner, creator] = await ethers.getSigners();

    const nftFactory = await ethers.getContractFactory("LitVerseNFT");
    const implementation = await nftFactory.deploy();
    await implementation.waitForDeployment();

    const factory = await deployProxy(
      ethers,
      "LitVerseCollectionFactory",
      [
        await owner.getAddress(),
        await implementation.getAddress(),
      ]
    );

    await (await factory.connect(owner).pause()).wait();

    await assert.rejects(
      factory.connect(creator).createCollection({
        name: "Paused Collection",
        symbol: "PAUSE",
        maxSupply: 100n,
        mintPrice: ethers.parseEther("0.01"),
        walletLimit: 5n,
        saleStartTime: 0n,
        hiddenMetadataURI: "ipfs://hidden.json",
      })
    );

    assert.equal(await factory.collectionCount(), 0n);
  });

});
