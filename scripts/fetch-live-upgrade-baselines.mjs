import { mkdirSync, writeFileSync } from "node:fs";
import { JsonRpcProvider, getAddress } from "ethers";

const RPC = process.env.LITEFORGE_RPC_URL || "https://rpc.testnet.liteforge.zeeve.net/";
const EXPLORER = "https://explorer.testnet.liteforge.zeeve.net/api/v2/smart-contracts/";
const SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const provider = new JsonRpcProvider(RPC);
const targets = [
  { address: "0x9914F5f46dd37Bf5F5a54b2B1eB7618c4897D3c4", contract: "LitVerseMarketplace", baseline: "LitVerseMarketplaceLiveV1" },
  { address: "0x074CD851A0C05A4B8bbfBAC790bA5ca3E77725C2", contract: "LitVerseAuction", baseline: "LitVerseAuctionLiveV1" },
];

const network = await provider.getNetwork();
if (network.chainId !== 4441n) throw new Error("Wrong chain ID: " + network.chainId);
mkdirSync("contracts/upgrade-baselines/live", { recursive: true });

for (const target of targets) {
  const raw = await provider.getStorage(target.address, SLOT);
  const implementation = getAddress("0x" + raw.slice(-40));
  if (implementation === getAddress("0x0000000000000000000000000000000000000000")) {
    throw new Error("Empty implementation slot for " + target.contract);
  }
  const response = await fetch(EXPLORER + implementation);
  if (!response.ok) throw new Error("Explorer source request failed for " + target.contract + " implementation " + implementation + ": HTTP " + response.status);
  const data = await response.json();
  if (data.is_verified !== true || typeof data.source_code !== "string") {
    throw new Error("Verified source unavailable for " + target.contract + " implementation " + implementation);
  }
  const declaration = new RegExp("\\bcontract\\s+" + target.contract + "\\b");
  if (!declaration.test(data.source_code)) throw new Error("Could not locate contract declaration for " + target.contract);
  const baseline = data.source_code.replace(declaration, "contract " + target.baseline);
  const output = "contracts/upgrade-baselines/live/" + target.baseline + ".sol";
  writeFileSync(output, baseline, "utf8");
  console.log("Fetched verified live implementation source:", target.contract, implementation, "->", output);
}
