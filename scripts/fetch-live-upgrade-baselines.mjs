import { mkdirSync, writeFileSync } from "node:fs";

const EXPLORER = "https://explorer.testnet.liteforge.zeeve.net/api/v2/smart-contracts/";
const targets = [
  { address: "0x52859fF5CdA81C672f336b99EEd3AD49dD5bD5FE", contract: "LitVerseMarketplace", baseline: "LitVerseMarketplaceLiveV1" },
  { address: "0x9F15878EeD9E721F8313Bb8E6d44b24bA8CCba5C", contract: "LitVerseAuction", baseline: "LitVerseAuctionLiveV1" },
];

mkdirSync("contracts/upgrade-baselines/live", { recursive: true });
for (const target of targets) {
  const response = await fetch(EXPLORER + target.address);
  if (!response.ok) throw new Error("Explorer source request failed for " + target.contract + ": HTTP " + response.status);
  const data = await response.json();
  if (data.is_verified !== true || typeof data.source_code !== "string") {
    throw new Error("Verified source unavailable for " + target.contract);
  }
  const declaration = new RegExp("\\bcontract\\s+" + target.contract + "\\b");
  if (!declaration.test(data.source_code)) throw new Error("Could not locate contract declaration for " + target.contract);
  const baseline = data.source_code.replace(declaration, "contract " + target.baseline);
  const output = "contracts/upgrade-baselines/live/" + target.baseline + ".sol";
  writeFileSync(output, baseline, "utf8");
  console.log("Fetched verified live source: " + target.contract + " -> " + output);
}
