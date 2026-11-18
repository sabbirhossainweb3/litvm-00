import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";

const EXPECTED = {
  chainId: 4441n,
  owner: "0x271Aa03A0dfa6D6ABe925089c419Fa209A3F3156",
  factoryProxy: "0x8c0CDdFF0154042a3A9E16f68Ac71C46cD2DA1ea",
};

async function main() {
  const connection = await hre.network.create();
  const { ethers } = connection;
  const upgradesApi = await upgrades(hre, connection);
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== EXPECTED.chainId) {
    throw new Error(`Wrong chain ID: expected 4441, received ${network.chainId}`);
  }

  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("Missing LiteForge signer");
  const signerAddress = await signer.getAddress();
  if (signerAddress.toLowerCase() !== EXPECTED.owner.toLowerCase()) {
    throw new Error(`Wrong signer ${signerAddress}; expected factory owner ${EXPECTED.owner}`);
  }
  const balance = await ethers.provider.getBalance(signerAddress);
  if (balance === 0n) throw new Error("Owner wallet has no zkLTC for gas");

  const factory = await ethers.getContractAt("LitVerseCollectionFactory", EXPECTED.factoryProxy, signer);
  if ((await factory.owner()).toLowerCase() !== EXPECTED.owner.toLowerCase()) {
    throw new Error("On-chain collection factory owner mismatch");
  }
  const currentFactoryImplementation = await upgradesApi.erc1967.getImplementationAddress(EXPECTED.factoryProxy);
  const oldNFTImplementation = await factory.nftImplementation();
  if ((await ethers.provider.getCode(oldNFTImplementation)) === "0x") {
    throw new Error("Current factory NFT implementation has no bytecode");
  }

  const countBefore = await factory.collectionCount();
  const snapshots = [];
  for (let id = 1n; id <= countBefore; id++) {
    const item = await factory.getCollection(id);
    snapshots.push({
      id,
      collectionAddress: item.collectionAddress,
      creator: item.creator,
      name: item.name,
      symbol: item.symbol,
      createdAt: item.createdAt,
      registered: await factory.isRegisteredCollection(item.collectionAddress),
    });
  }

  console.log(JSON.stringify({
    phase: "preflight",
    chainId: network.chainId.toString(),
    signer: signerAddress,
    factoryProxy: EXPECTED.factoryProxy,
    currentFactoryImplementation,
    oldNFTImplementation,
    collectionCount: countBefore.toString(),
    collections: snapshots.map(x => ({
      id: x.id.toString(),
      address: x.collectionAddress,
      creator: x.creator,
      name: x.name,
      symbol: x.symbol,
      registered: x.registered,
    })),
  }, null, 2));

  const FactoryCurrent = await ethers.getContractFactory("LitVerseCollectionFactory");
  const FactoryBaseline = await ethers.getContractFactory("LitVerseCollectionFactoryV1");
  await upgradesApi.validateUpgrade(FactoryBaseline, FactoryCurrent, { kind: "uups" });
  console.log("Factory storage compatibility: PASS");

  const NFTFactory = await ethers.getContractFactory("LitVerseNFT");
  const newNFTImplementation = await NFTFactory.deploy();
  await newNFTImplementation.waitForDeployment();
  const newNFTImplementationAddress = await newNFTImplementation.getAddress();
  if ((await ethers.provider.getCode(newNFTImplementationAddress)) === "0x") {
    throw new Error("New timed NFT implementation deployment has no bytecode");
  }
  console.log("New timed NFT implementation:", newNFTImplementationAddress);

  const newFactoryImplementation = await upgradesApi.deployImplementation(FactoryCurrent, { kind: "uups" });
  console.log("New factory implementation:", newFactoryImplementation);
  const initData = FactoryCurrent.interface.encodeFunctionData("initializeV2", [newNFTImplementationAddress]);
  console.log("Submitting atomic factory upgrade and NFT implementation switch...");
  const tx = await factory.upgradeToAndCall(newFactoryImplementation, initData);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Factory upgrade transaction failed");

  const upgradedImplementation = await upgradesApi.erc1967.getImplementationAddress(EXPECTED.factoryProxy);
  if (upgradedImplementation.toLowerCase() !== String(newFactoryImplementation).toLowerCase()) {
    throw new Error("Factory implementation slot did not update");
  }
  const upgradedFactory = await ethers.getContractAt("LitVerseCollectionFactory", EXPECTED.factoryProxy, signer);
  const currentNFTImplementation = await upgradedFactory.nftImplementation();
  if (currentNFTImplementation.toLowerCase() !== newNFTImplementationAddress.toLowerCase()) {
    throw new Error("Factory did not switch to the timed NFT implementation");
  }
  if ((await upgradedFactory.collectionCount()) !== countBefore) {
    throw new Error("Existing collection count changed during upgrade");
  }

  for (const old of snapshots) {
    const item = await upgradedFactory.getCollection(old.id);
    if (
      item.collectionAddress.toLowerCase() !== old.collectionAddress.toLowerCase() ||
      item.creator.toLowerCase() !== old.creator.toLowerCase() ||
      item.name !== old.name ||
      item.symbol !== old.symbol ||
      item.createdAt !== old.createdAt ||
      (await upgradedFactory.isRegisteredCollection(old.collectionAddress)) !== old.registered
    ) {
      throw new Error(`Existing collection record changed: #${old.id}`);
    }
  }

  const latest = await ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Could not read latest block");
  const testConfig = {
    name: "LitBazaar Sale Window Check",
    symbol: "LBTEST",
    maxSupply: 1n,
    mintPrice: 0n,
    walletLimit: 1n,
    saleStartTime: BigInt(latest.timestamp + 60),
    saleEndTime: BigInt(latest.timestamp + 3600),
    hiddenMetadataURI: "ipfs://hidden.json",
  };
  const simulatedAddress = await upgradedFactory.createCollectionWithSaleEnd.staticCall(testConfig);
  if ((await ethers.provider.getCode(simulatedAddress)) !== "0x") {
    throw new Error("Static sale-window preflight unexpectedly changed chain state");
  }

  console.log(JSON.stringify({
    phase: "success",
    factoryProxy: EXPECTED.factoryProxy,
    previousFactoryImplementation: currentFactoryImplementation,
    newFactoryImplementation: upgradedImplementation,
    previousNFTImplementation: oldNFTImplementation,
    newNFTImplementation: currentNFTImplementation,
    transactionHash: tx.hash,
    blockNumber: receipt.blockNumber,
    existingCollectionCountPreserved: countBefore.toString(),
    existingCollectionRecordsPreserved: true,
    timedCollectionMethod: "createCollectionWithSaleEnd",
    factoryStorageChecks: "PASS",
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
