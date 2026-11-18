import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";
import { describe, it, before } from "mocha";
import assert from "node:assert/strict";

describe("LitBazaar UUPS upgrade compatibility and state preservation", function () {
  let connection: any;
  let ethers: any;
  let upgradesApi: any;

  before(async function () {
    connection = await hre.network.create();
    ({ ethers } = connection);
    upgradesApi = await upgrades(hre, connection);
  });

  async function deployNFT(owner: any, royalty: any) {
    const Factory = await ethers.getContractFactory("LitVerseNFT");
    return upgradesApi.deployProxy(
      Factory,
      [
        await owner.getAddress(),
        "Upgrade Test NFT",
        "UTNFT",
        100n,
        ethers.parseEther("0.01"),
        5n,
        0n,
        await royalty.getAddress(),
        "ipfs://hidden.json",
      ],
      { kind: "uups" }
    );
  }

  it("validates Marketplace V1 to current implementation and preserves existing listings/config", async function () {
    const [owner, seller, fee, newFee, royalty] = await ethers.getSigners();
    const V1 = await ethers.getContractFactory("LitVerseMarketplaceV1");
    const V2 = await ethers.getContractFactory("LitVerseMarketplace");

    await upgradesApi.validateUpgrade(V1, V2, { kind: "uups" });

    const market = await upgradesApi.deployProxy(
      V1,
      [await owner.getAddress(), await fee.getAddress(), 250n],
      { kind: "uups" }
    );
    const nft = await deployNFT(owner, royalty);

    await market.setPlatformFee(325n);
    await market.setFeeRecipient(await newFee.getAddress());
    await market.setCollectionFactory(await nft.getAddress());
    await market.setCollectionApproval(await nft.getAddress(), true);

    await nft.connect(seller).publicMint(1n, { value: ethers.parseEther("0.01") });
    await nft.connect(seller).approve(await market.getAddress(), 1n);
    await market.connect(seller).listNFT(
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.75")
    );

    const upgraded = await upgradesApi.upgradeProxy(
      await market.getAddress(),
      V2,
      { kind: "uups" }
    );

    assert.equal(await upgraded.platformFeeBps(), 325n);
    assert.equal(await upgraded.feeRecipient(), await newFee.getAddress());
    assert.equal(await upgraded.collectionFactory(), await nft.getAddress());
    assert.equal(await upgraded.approvedCollections(await nft.getAddress()), true);
    assert.equal(await upgraded.nextListingId(), 2n);

    const listing = await upgraded.listings(1n);
    assert.equal(listing.nftContract, await nft.getAddress());
    assert.equal(listing.tokenId, 1n);
    assert.equal(listing.seller, await seller.getAddress());
    assert.equal(listing.price, ethers.parseEther("0.75"));
    assert.equal(listing.active, true);
    assert.equal(await nft.ownerOf(1n), await upgraded.getAddress());
  });

  it("validates Auction V1 to current implementation and preserves auctions/refunds/config", async function () {
    const [owner, seller, bidder1, bidder2, fee, newFee, royalty] = await ethers.getSigners();
    const V1 = await ethers.getContractFactory("LitVerseAuctionV1");
    const V2 = await ethers.getContractFactory("LitVerseAuction");

    await upgradesApi.validateUpgrade(V1, V2, { kind: "uups" });

    const auction = await upgradesApi.deployProxy(
      V1,
      [await owner.getAddress(), await fee.getAddress(), 250n],
      { kind: "uups" }
    );
    const nft = await deployNFT(owner, royalty);

    await auction.setPlatformFee(400n);
    await auction.setFeeRecipient(await newFee.getAddress());
    await auction.setCollectionFactory(await nft.getAddress());
    await auction.setCollectionApproval(await nft.getAddress(), true);

    await nft.connect(seller).publicMint(1n, { value: ethers.parseEther("0.01") });
    await nft.connect(seller).approve(await auction.getAddress(), 1n);
    await auction.connect(seller).createAuction(
      await nft.getAddress(),
      1n,
      ethers.parseEther("1"),
      3600n
    );

    await auction.connect(bidder1).placeBid(1n, { value: ethers.parseEther("1") });
    await auction.connect(bidder2).placeBid(1n, { value: ethers.parseEther("2") });

    const upgraded = await upgradesApi.upgradeProxy(
      await auction.getAddress(),
      V2,
      { kind: "uups" }
    );

    assert.equal(await upgraded.platformFeeBps(), 400n);
    assert.equal(await upgraded.feeRecipient(), await newFee.getAddress());
    assert.equal(await upgraded.collectionFactory(), await nft.getAddress());
    assert.equal(await upgraded.approvedCollections(await nft.getAddress()), true);
    assert.equal(await upgraded.nextAuctionId(), 2n);
    assert.equal(await upgraded.pendingWithdrawals(await bidder1.getAddress()), ethers.parseEther("1"));

    const record = await upgraded.auctions(1n);
    assert.equal(record.nftContract, await nft.getAddress());
    assert.equal(record.tokenId, 1n);
    assert.equal(record.seller, await seller.getAddress());
    assert.equal(record.reservePrice, ethers.parseEther("1"));
    assert.equal(record.highestBid, ethers.parseEther("2"));
    assert.equal(record.highestBidder, await bidder2.getAddress());
    assert.equal(record.finalized, false);
    assert.equal(record.claimed, false);
    assert.equal(await nft.ownerOf(1n), await upgraded.getAddress());
  });
});
