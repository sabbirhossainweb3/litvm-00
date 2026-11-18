import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";

const EXPECTED = {
  chainId: 4441n,
  owner: "0x271Aa03A0dfa6D6ABe925089c419Fa209A3F3156",
  nft: "0xbf076fe848CE7Bf9864Ccf33Ae1A7EBb7ef697b6",
  marketplace: {
    proxy: "0x9914F5f46dd37Bf5F5a54b2B1eB7618c4897D3c4",
    implementation: "0x52859fF5CdA81C672f336b99EEd3AD49dD5bD5FE",
    contract: "LitVerseMarketplace",
    baseline: "LitVerseMarketplaceLiveV1",
    initializer: "initializeV2"
  },
  auction: {
    proxy: "0x074CD851A0C05A4B8bbfBAC790bA5ca3E77725C2",
    implementation: "0x9F15878EeD9E721F8313Bb8E6d44b24bA8CCba5C",
    contract: "LitVerseAuction",
    baseline: "LitVerseAuctionLiveV1",
    initializer: "initializeV2"
  }
} as const;

async function main() {
  const target = process.env.UPGRADE_TARGET;
  if (target !== "marketplace" && target !== "auction") {
    throw new Error("UPGRADE_TARGET must be marketplace or auction");
  }
  const config = EXPECTED[target];
  const connection = await hre.network.create();
  const { ethers } = connection;
  const upgradesApi = await upgrades(hre, connection);
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== EXPECTED.chainId) throw new Error(`Wrong chain ID: ${network.chainId}`);

  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("Missing signer");
  const signerAddress = await signer.getAddress();
  if (signerAddress.toLowerCase() !== EXPECTED.owner.toLowerCase()) {
    throw new Error(`Wrong signer: ${signerAddress}; expected proxy owner ${EXPECTED.owner}`);
  }

  const balance = await ethers.provider.getBalance(signerAddress);
  if (balance === 0n) throw new Error("Owner wallet has no zkLTC for gas");

  const proxy = await ethers.getContractAt(config.contract, config.proxy, signer);
  const owner = await proxy.owner();
  if (owner.toLowerCase() !== EXPECTED.owner.toLowerCase()) throw new Error("On-chain proxy owner mismatch");
  const currentImpl = await upgradesApi.erc1967.getImplementationAddress(config.proxy);
  if (currentImpl.toLowerCase() !== config.implementation.toLowerCase()) {
    throw new Error(`Unexpected live implementation: ${currentImpl}; refusing upgrade`);
  }

  const nft = await ethers.getContractAt("LitVerseNFT", EXPECTED.nft, signer);
  const nftOwner = await nft.owner();
  if (nftOwner.toLowerCase() !== EXPECTED.owner.toLowerCase()) throw new Error("Genesis NFT owner mismatch");
  const totalMintedBefore = await nft.totalMinted();
  const tokenSnapshots = await Promise.all(
    Array.from({ length: Number(totalMintedBefore) }, async (_, index) => {
      const tokenId = BigInt(index + 1);
      return {
        tokenId,
        owner: await nft.ownerOf(tokenId),
        tokenURI: await nft.tokenURI(tokenId)
      };
    })
  );
  const nextIdBefore = target === "marketplace"
    ? await proxy.nextListingId()
    : await proxy.nextAuctionId();
  const feeBefore = await proxy.platformFeeBps();
  const feeRecipientBefore = await proxy.feeRecipient();
  const factoryBefore = await proxy.collectionFactory();
  const pausedBefore = await proxy.paused();

  console.log(JSON.stringify({
    phase: "preflight",
    target,
    chainId: network.chainId.toString(),
    signer: signerAddress,
    proxy: config.proxy,
    currentImplementation: currentImpl,
    nftProxy: EXPECTED.nft,
    nftTotalMinted: totalMintedBefore.toString(),
    tokenSnapshots: tokenSnapshots.map((token) => ({ tokenId: token.tokenId.toString(), owner: token.owner, tokenURI: token.tokenURI })),
    nextRecordId: nextIdBefore.toString(),
    platformFeeBps: feeBefore.toString(),
    feeRecipient: feeRecipientBefore,
    collectionFactory: factoryBefore,
    paused: pausedBefore
  }, null, 2));

  const Current = await ethers.getContractFactory(config.contract);
  const Baseline = await ethers.getContractFactory(config.baseline);
  await upgradesApi.validateUpgrade(Baseline, Current, { kind: "uups" });

  console.log("Storage compatibility validation: PASS");
  console.log("Deploying new implementation...");
  const newImplementation = await upgradesApi.deployImplementation(Current, { kind: "uups" });
  console.log("New implementation:", newImplementation);

  const initData = Current.interface.encodeFunctionData(config.initializer, [EXPECTED.nft]);
  console.log("Submitting atomic UUPS upgrade + Genesis collection approval...");
  const tx = await proxy.upgradeToAndCall(newImplementation, initData);
  console.log("Upgrade transaction:", tx.hash);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Upgrade transaction failed");

  const newImpl = await upgradesApi.erc1967.getImplementationAddress(config.proxy);
  if (newImpl.toLowerCase() !== newImplementation.toLowerCase()) throw new Error("Implementation slot did not update");
  const upgraded = await ethers.getContractAt(config.contract, config.proxy, signer);
  const approved = await upgraded.approvedCollections(EXPECTED.nft);
  if (!approved) throw new Error("Genesis NFT collection was not approved by initializer");
  const totalMintedAfter = await nft.totalMinted();
  const nextIdAfter = target === "marketplace"
    ? await upgraded.nextListingId()
    : await upgraded.nextAuctionId();

  if (totalMintedAfter !== totalMintedBefore) throw new Error("NFT total minted changed during upgrade");
  for (const token of tokenSnapshots) {
    if ((await nft.ownerOf(token.tokenId)).toLowerCase() !== token.owner.toLowerCase()) {
      throw new Error(`NFT owner changed for token ${token.tokenId}`);
    }
    if ((await nft.tokenURI(token.tokenId)) !== token.tokenURI) {
      throw new Error(`NFT metadata URI changed for token ${token.tokenId}`);
    }
  }
  const featureMethod = target === "marketplace" ? "supportsOneTransactionListing" : "supportsOneTransactionAuction";
  const oneTransactionFeature = await upgraded.getFunction(featureMethod)();
  if (oneTransactionFeature !== true) throw new Error("One-transaction feature check failed");
  if (nextIdAfter !== nextIdBefore) throw new Error("Existing listing/auction counter changed");
  if ((await upgraded.platformFeeBps()) !== feeBefore) throw new Error("Platform fee changed");
  if ((await upgraded.feeRecipient()).toLowerCase() !== feeRecipientBefore.toLowerCase()) throw new Error("Fee recipient changed");
  if ((await upgraded.collectionFactory()).toLowerCase() !== factoryBefore.toLowerCase()) throw new Error("Collection factory changed");
  if ((await upgraded.paused()) !== pausedBefore) throw new Error("Pause state changed");

  console.log(JSON.stringify({
    phase: "success",
    target,
    proxy: config.proxy,
    previousImplementation: currentImpl,
    newImplementation: newImpl,
    transactionHash: tx.hash,
    blockNumber: receipt.blockNumber,
    genesisCollectionApproved: approved,
    nftTotalMintedPreserved: totalMintedAfter.toString(),
    nftOwnersAndMetadataPreserved: true,
    oneTransactionFeature: true,
    nextRecordIdPreserved: nextIdAfter.toString(),
    storageChecks: "PASS"
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
