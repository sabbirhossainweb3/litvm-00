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

async function deployNFT(ethers: any, owner: any, royalty: any) {
  return deployProxy(ethers, "LitVerseNFT", [
    await owner.getAddress(),
    "LitVerse Test NFT",
    "LVT",
    10n,
    ethers.parseEther("0.01"),
    2n,
    0n,
    await royalty.getAddress(),
    "ipfs://hidden.json",
  ]);
}

async function deployMarket(ethers: any, owner: any, fee: any) {
  return deployProxy(ethers, "LitVerseMarketplace", [
    await owner.getAddress(),
    await fee.getAddress(),
    250n,
  ]);
}

async function deployAuction(ethers: any, owner: any, fee: any) {
  return deployProxy(ethers, "LitVerseAuction", [
    await owner.getAddress(),
    await fee.getAddress(),
    250n,
  ]);
}

async function advanceTime(ethers: any, seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

// =====================================================
// NFT REMAINING SECURITY TESTS
// =====================================================

describe("LitVerse NFT Remaining Security", function () {

  it("rejects incorrect payment and zero quantity", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);

    await assert.rejects(
      nft.connect(seller).publicMint(1n, {
        value: ethers.parseEther("0.02"),
      })
    );

    await assert.rejects(
      nft.connect(seller).publicMint(0n)
    );
  });

  it("enforces wallet limit and maximum supply", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, second, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);

    await nft.connect(seller).publicMint(2n, {
      value: ethers.parseEther("0.02"),
    });

    await assert.rejects(
      nft.connect(seller).publicMint(1n, {
        value: ethers.parseEther("0.01"),
      })
    );

    await nft.connect(second).publicMint(2n, {
      value: ethers.parseEther("0.02"),
    });

    await nft.connect(owner).ownerMint(
      await owner.getAddress(),
      6n
    );

    await assert.rejects(
      nft.connect(owner).ownerMint(
        await owner.getAddress(),
        1n
      )
    );

    assert.equal(await nft.totalMinted(), 10n);
  });

  it("rejects minting before sale start", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, royalty] = await ethers.getSigners();

    const futureTime = BigInt(Math.floor(Date.now() / 1000) + 86400);

    const nft = await deployProxy(ethers, "LitVerseNFT", [
      await owner.getAddress(),
      "Future NFT",
      "FUT",
      100n,
      ethers.parseEther("0.01"),
      5n,
      futureTime,
      await royalty.getAddress(),
      "ipfs://hidden.json",
    ]);

    await assert.rejects(
      nft.connect(seller).publicMint(1n, {
        value: ethers.parseEther("0.01"),
      })
    );
  });

  it("checks ownerMint access and invalid recipient", async function () {
    const { ethers } = await network.connect();
    const [owner, attacker, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);

    await assert.rejects(
      nft.connect(attacker).ownerMint(
        await attacker.getAddress(),
        1n
      )
    );

    await assert.rejects(
      nft.connect(owner).ownerMint(ethers.ZeroAddress, 1n)
    );

    await assert.rejects(
      nft.connect(owner).ownerMint(
        await owner.getAddress(),
        0n
      )
    );
  });

  it("checks royalty, hidden metadata and reveal", async function () {
    const { ethers } = await network.connect();
    const [owner, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);

    await nft.connect(owner).ownerMint(
      await owner.getAddress(),
      1n
    );

    assert.equal(
      await nft.tokenURI(1n),
      "ipfs://hidden.json"
    );

    const salePrice = ethers.parseEther("1");
    const royaltyInfo = await nft.royaltyInfo(1n, salePrice);

    assert.equal(
      royaltyInfo[0],
      await royalty.getAddress()
    );

    assert.equal(
      royaltyInfo[1],
      ethers.parseEther("0.05")
    );

    await nft.connect(owner).setTokenURI(
      1n,
      "ipfs://revealed-metadata.json"
    );

    await nft.connect(owner).setReveal(true);

    assert.equal(
      await nft.tokenURI(1n),
      "ipfs://revealed-metadata.json"
    );

    await assert.rejects(
      nft.connect(royalty).setReveal(false)
    );
  });

  it("protects sale configuration and hidden metadata", async function () {
    const { ethers } = await network.connect();
    const [owner, attacker, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);

    await assert.rejects(
      nft.connect(attacker).configureSale(
        0n,
        0n,
        5n
      )
    );

    await assert.rejects(
      nft.connect(owner).configureSale(
        0n,
        0n,
        0n
      )
    );

    await assert.rejects(
      nft.connect(attacker).setHiddenMetadataURI("ipfs://attacker")
    );

    await nft.connect(owner).setHiddenMetadataURI(
      "ipfs://new-hidden.json"
    );

    assert.equal(
      await nft.hiddenMetadataURI(),
      "ipfs://new-hidden.json"
    );
  });

  it("blocks minting while paused and allows it after unpause", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);

    await nft.connect(owner).pause();

    await assert.rejects(
      nft.connect(seller).publicMint(1n, {
        value: ethers.parseEther("0.01"),
      })
    );

    await assert.rejects(
      nft.connect(seller).ownerMint(
        await seller.getAddress(),
        1n
      )
    );

    await assert.rejects(
      nft.connect(seller).pause()
    );

    await nft.connect(owner).unpause();

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    assert.equal(await nft.ownerOf(1n), await seller.getAddress());
  });

  it("allows owner withdrawal and rejects unauthorized withdrawal", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, recipient, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    const before = await ethers.provider.getBalance(
      await recipient.getAddress()
    );

    await assert.rejects(
      nft.connect(seller).withdraw(await recipient.getAddress())
    );

    await assert.rejects(
      nft.connect(owner).withdraw(ethers.ZeroAddress)
    );

    await nft.connect(owner).withdraw(
      await recipient.getAddress()
    );

    const after = await ethers.provider.getBalance(
      await recipient.getAddress()
    );

    assert.equal(
      after - before,
      ethers.parseEther("0.01")
    );

    await assert.rejects(
      nft.connect(owner).withdraw(await recipient.getAddress())
    );
  });

});

// =====================================================
// MARKETPLACE REMAINING SECURITY TESTS
// =====================================================

describe("LitVerse Marketplace Remaining Security", function () {

  it("allows seller to cancel listing and recover NFT", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, fee, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);
    const market = await deployMarket(ethers, owner, fee);

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await nft.connect(seller).approve(
      await market.getAddress(),
      1n
    );

    await market.connect(seller).listNFT(
      await nft.getAddress(),
      1n,
      ethers.parseEther("1")
    );

    await assert.rejects(
      market.connect(owner).cancelListing(1n)
    );

    await market.connect(seller).cancelListing(1n);

    assert.equal(
      await nft.ownerOf(1n),
      await seller.getAddress()
    );

    const listing = await market.listings(1n);
    assert.equal(listing.active, false);
  });

  it("enforces platform fee limit and owner permissions", async function () {
    const { ethers } = await network.connect();
    const [owner, attacker, fee] = await ethers.getSigners();

    const market = await deployMarket(ethers, owner, fee);

    await assert.rejects(
      market.connect(owner).setPlatformFee(501n)
    );

    await assert.rejects(
      market.connect(attacker).setPlatformFee(100n)
    );

    await market.connect(owner).setPlatformFee(500n);

    assert.equal(await market.platformFeeBps(), 500n);
  });

  it("protects fee recipient configuration", async function () {
    const { ethers } = await network.connect();
    const [owner, attacker, fee, newFee] = await ethers.getSigners();

    const market = await deployMarket(ethers, owner, fee);

    await assert.rejects(
      market.connect(owner).setFeeRecipient(ethers.ZeroAddress)
    );

    await assert.rejects(
      market.connect(attacker).setFeeRecipient(
        await newFee.getAddress()
      )
    );

    await market.connect(owner).setFeeRecipient(
      await newFee.getAddress()
    );

    assert.equal(
      await market.feeRecipient(),
      await newFee.getAddress()
    );
  });

  it("blocks listing while paused and allows listing after unpause", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, fee, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);
    const market = await deployMarket(ethers, owner, fee);

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await nft.connect(seller).approve(
      await market.getAddress(),
      1n
    );

    await market.connect(owner).pause();

    await assert.rejects(
      market.connect(seller).listNFT(
        await nft.getAddress(),
        1n,
        ethers.parseEther("1")
      )
    );

    await assert.rejects(
      market.connect(seller).pause()
    );

    await market.connect(owner).unpause();

    await market.connect(seller).listNFT(
      await nft.getAddress(),
      1n,
      ethers.parseEther("1")
    );

    assert.equal(
      await nft.ownerOf(1n),
      await market.getAddress()
    );
  });

  it("blocks purchase while paused", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, buyer, fee, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);
    const market = await deployMarket(ethers, owner, fee);

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await nft.connect(seller).approve(
      await market.getAddress(),
      1n
    );

    await market.connect(seller).listNFT(
      await nft.getAddress(),
      1n,
      ethers.parseEther("1")
    );

    await market.connect(owner).pause();

    await assert.rejects(
      market.connect(buyer).buyNFT(1n, {
        value: ethers.parseEther("1"),
      })
    );

    assert.equal(
      await nft.ownerOf(1n),
      await market.getAddress()
    );
  });

  it("rejects nonexistent and already sold listings", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, buyer, fee, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);
    const market = await deployMarket(ethers, owner, fee);

    await assert.rejects(
      market.connect(buyer).buyNFT(999n, {
        value: ethers.parseEther("1"),
      })
    );

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await nft.connect(seller).approve(
      await market.getAddress(),
      1n
    );

    await market.connect(seller).listNFT(
      await nft.getAddress(),
      1n,
      ethers.parseEther("1")
    );

    await market.connect(buyer).buyNFT(1n, {
      value: ethers.parseEther("1"),
    });

    await assert.rejects(
      market.connect(buyer).buyNFT(1n, {
        value: ethers.parseEther("1"),
      })
    );

    assert.equal(
      await nft.ownerOf(1n),
      await buyer.getAddress()
    );
  });

});

// =====================================================
// AUCTION REMAINING SECURITY & INTEGRATION TESTS
// =====================================================

describe("LitVerse Auction Approval-Free Flow", function () {
  it("creates an auction in one safeTransferFrom without any NFT approval", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, fee, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);
    const auction = await deployAuction(ethers, owner, fee);
    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    assert.equal(
      await nft.isApprovedForAll(await seller.getAddress(), await auction.getAddress()),
      false
    );

    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256"],
      [ethers.parseEther("0.5"), 3600n]
    );
    await nft.connect(seller)["safeTransferFrom(address,address,uint256,bytes)"](
      await seller.getAddress(),
      await auction.getAddress(),
      1n,
      data
    );

    assert.equal(await nft.ownerOf(1n), await auction.getAddress());
    const auctionData = await auction.auctions(1n);
    assert.equal(auctionData.seller, await seller.getAddress());
    assert.equal(auctionData.reservePrice, ethers.parseEther("0.5"));
    assert.equal(auctionData.endTime > 0n, true);
    assert.equal(await auction.supportsOneTransactionAuction(), true);
  });

  it("rejects safe NFT transfers without auction parameters instead of trapping the NFT", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, fee, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);
    const auction = await deployAuction(ethers, owner, fee);
    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await assert.rejects(
      nft.connect(seller)["safeTransferFrom(address,address,uint256)"](
        await seller.getAddress(),
        await auction.getAddress(),
        1n
      )
    );
    assert.equal(await nft.ownerOf(1n), await seller.getAddress());
  });
});

describe("LitVerse Auction Remaining Security", function () {

  it("rejects invalid auction configuration and unauthorized creation", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, attacker, fee, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);
    const auction = await deployAuction(ethers, owner, fee);

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await assert.rejects(
      auction.connect(seller).createAuction(
        await nft.getAddress(),
        1n,
        0n,
        3600n
      )
    );

    await assert.rejects(
      auction.connect(seller).createAuction(
        await nft.getAddress(),
        1n,
        ethers.parseEther("0.1"),
        3599n
      )
    );

    await assert.rejects(
      auction.connect(seller).createAuction(
        await nft.getAddress(),
        1n,
        ethers.parseEther("0.1"),
        2592001n
      )
    );

    await assert.rejects(
      auction.connect(attacker).createAuction(
        await nft.getAddress(),
        1n,
        ethers.parseEther("0.1"),
        3600n
      )
    );
  });

  it("requires NFT approval before auction creation", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, fee, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);
    const auction = await deployAuction(ethers, owner, fee);

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await assert.rejects(
      auction.connect(seller).createAuction(
        await nft.getAddress(),
        1n,
        ethers.parseEther("0.1"),
        3600n
      )
    );

    await nft.connect(seller).approve(
      await auction.getAddress(),
      1n
    );

    await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.1"),
      3600n
    );

    assert.equal(
      await nft.ownerOf(1n),
      await auction.getAddress()
    );
  });

  it("rejects seller bids, low bids and bids below reserve", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, bidder, fee, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);
    const auction = await deployAuction(ethers, owner, fee);

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await nft.connect(seller).approve(
      await auction.getAddress(),
      1n
    );

    await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("1"),
      3600n
    );

    await assert.rejects(
      auction.connect(seller).placeBid(1n, {
        value: ethers.parseEther("1"),
      })
    );

    await assert.rejects(
      auction.connect(bidder).placeBid(1n, {
        value: ethers.parseEther("0.5"),
      })
    );

    await auction.connect(bidder).placeBid(1n, {
      value: ethers.parseEther("1"),
    });

    await assert.rejects(
      auction.connect(owner).placeBid(1n, {
        value: ethers.parseEther("1"),
      })
    );

    await assert.rejects(
      auction.connect(owner).finalizeAuction(1n)
    );
  });

  it("credits outbid bidder and distributes winning bid correctly", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, bidder1, bidder2, fee, royalty] =
      await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);
    const auction = await deployAuction(ethers, owner, fee);

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await nft.connect(seller).approve(
      await auction.getAddress(),
      1n
    );

    await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("1"),
      3600n
    );

    await auction.connect(bidder1).placeBid(1n, {
      value: ethers.parseEther("1"),
    });

    await auction.connect(bidder2).placeBid(1n, {
      value: ethers.parseEther("2"),
    });

    assert.equal(
      await auction.pendingWithdrawals(await bidder1.getAddress()),
      ethers.parseEther("1")
    );

    await advanceTime(ethers, 3601);

    await auction.connect(owner).finalizeAuction(1n);

    assert.equal(
      await auction.pendingWithdrawals(await seller.getAddress()),
      ethers.parseEther("1.85")
    );

    assert.equal(
      await auction.pendingWithdrawals(await fee.getAddress()),
      ethers.parseEther("0.05")
    );

    assert.equal(
      await auction.pendingWithdrawals(await royalty.getAddress()),
      ethers.parseEther("0.1")
    );

    await auction.connect(bidder2).claimNFT(1n);

    assert.equal(
      await nft.ownerOf(1n),
      await bidder2.getAddress()
    );

    await assert.rejects(
      auction.connect(bidder2).claimNFT(1n)
    );
  });

  it("allows outbid bidder to withdraw refunded bid", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, bidder1, bidder2, fee, royalty] =
      await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);
    const auction = await deployAuction(ethers, owner, fee);

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await nft.connect(seller).approve(
      await auction.getAddress(),
      1n
    );

    await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("1"),
      3600n
    );

    await auction.connect(bidder1).placeBid(1n, {
      value: ethers.parseEther("1"),
    });

    await auction.connect(bidder2).placeBid(1n, {
      value: ethers.parseEther("1.5"),
    });

    const pendingBefore = await auction.pendingWithdrawals(await bidder1.getAddress());
    assert.equal(pendingBefore, ethers.parseEther("1"));
    await auction.connect(bidder1).withdraw();
    assert.equal(await auction.pendingWithdrawals(await bidder1.getAddress()), 0n);

    assert.equal(
      await auction.pendingWithdrawals(await bidder1.getAddress()),
      0n
    );

    await assert.rejects(
      auction.connect(bidder1).withdraw()
    );
  });

  it("returns NFT when auction ends without bids", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, fee, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);
    const auction = await deployAuction(ethers, owner, fee);

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await nft.connect(seller).approve(
      await auction.getAddress(),
      1n
    );

    await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("1"),
      3600n
    );

    await advanceTime(ethers, 3601);

    await auction.connect(owner).finalizeAuction(1n);

    assert.equal(
      await nft.ownerOf(1n),
      await seller.getAddress()
    );

    await assert.rejects(
      auction.connect(seller).claimNFT(1n)
    );

    await assert.rejects(
      auction.connect(owner).finalizeAuction(1n)
    );
  });

  it("allows seller to cancel auction without bids", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, attacker, fee, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);
    const auction = await deployAuction(ethers, owner, fee);

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await nft.connect(seller).approve(
      await auction.getAddress(),
      1n
    );

    await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("1"),
      3600n
    );

    await assert.rejects(
      auction.connect(attacker).cancelAuction(1n)
    );

    await auction.connect(seller).cancelAuction(1n);

    assert.equal(
      await nft.ownerOf(1n),
      await seller.getAddress()
    );

    await assert.rejects(
      auction.connect(seller).cancelAuction(1n)
    );
  });

  it("prevents cancellation after a bid", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, bidder, fee, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);
    const auction = await deployAuction(ethers, owner, fee);

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await nft.connect(seller).approve(
      await auction.getAddress(),
      1n
    );

    await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("1"),
      3600n
    );

    await auction.connect(bidder).placeBid(1n, {
      value: ethers.parseEther("1"),
    });

    await assert.rejects(
      auction.connect(seller).cancelAuction(1n)
    );
  });

  it("protects auction fee settings and pause controls", async function () {
    const { ethers } = await network.connect();
    const [owner, attacker, fee, newFee] = await ethers.getSigners();

    const auction = await deployAuction(ethers, owner, fee);

    await assert.rejects(
      auction.connect(owner).setPlatformFee(501n)
    );

    await assert.rejects(
      auction.connect(attacker).setPlatformFee(100n)
    );

    await assert.rejects(
      auction.connect(owner).setFeeRecipient(ethers.ZeroAddress)
    );

    await assert.rejects(
      auction.connect(attacker).setFeeRecipient(
        await newFee.getAddress()
      )
    );

    await auction.connect(owner).setPlatformFee(500n);

    assert.equal(await auction.platformFeeBps(), 500n);

    await auction.connect(owner).setFeeRecipient(
      await newFee.getAddress()
    );

    assert.equal(
      await auction.feeRecipient(),
      await newFee.getAddress()
    );

    await auction.connect(owner).pause();

    await assert.rejects(
      auction.connect(attacker).pause()
    );

    await auction.connect(owner).unpause();
  });

  it("rejects auction creation and bids while paused", async function () {
    const { ethers } = await network.connect();
    const [owner, seller, bidder, fee, royalty] = await ethers.getSigners();

    const nft = await deployNFT(ethers, owner, royalty);
    const auction = await deployAuction(ethers, owner, fee);

    await nft.connect(seller).publicMint(1n, {
      value: ethers.parseEther("0.01"),
    });

    await nft.connect(seller).approve(
      await auction.getAddress(),
      1n
    );

    await auction.connect(owner).pause();

    await assert.rejects(
      auction.connect(seller).createAuction(
        await nft.getAddress(),
        1n,
        ethers.parseEther("1"),
        3600n
      )
    );

    await auction.connect(owner).unpause();

    await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("1"),
      3600n
    );

    await auction.connect(owner).pause();

    await assert.rejects(
      auction.connect(bidder).placeBid(1n, {
        value: ethers.parseEther("1"),
      })
    );
  });

});

