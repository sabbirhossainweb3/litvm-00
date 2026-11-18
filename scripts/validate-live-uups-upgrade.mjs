import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";

async function main() {
  const connection = await hre.network.create();
  const { ethers } = connection;
  const upgradesApi = await upgrades(hre, connection);

  const pairs = [
    ["LitVerseMarketplaceLiveV1", "LitVerseMarketplace"],
    ["LitVerseAuctionLiveV1", "LitVerseAuction"],
  ];

  for (const [baselineName, nextName] of pairs) {
    const baseline = await ethers.getContractFactory(baselineName);
    const next = await ethers.getContractFactory(nextName);
    await upgradesApi.validateUpgrade(baseline, next, { kind: "uups" });
    console.log("UUPS storage compatibility PASS: " + baselineName + " -> " + nextName);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
