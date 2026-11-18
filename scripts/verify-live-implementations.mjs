import { readFileSync, readdirSync } from "node:fs";
import { JsonRpcProvider, getAddress } from "ethers";

const RPC = process.env.LITEFORGE_RPC_URL || "https://rpc.testnet.liteforge.zeeve.net/";
const API = "https://explorer.testnet.liteforge.zeeve.net/api";
const SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const targets = [
  { address: "0x9914F5f46dd37Bf5F5a54b2B1eB7618c4897D3c4", name: "LitVerseMarketplace", file: "contracts/LitVerseMarketplace.sol" },
  { address: "0x074CD851A0C05A4B8bbfBAC790bA5ca3E77725C2", name: "LitVerseAuction", file: "contracts/LitVerseAuction.sol" },
];

const provider = new JsonRpcProvider(RPC);
const network = await provider.getNetwork();
if (network.chainId !== 4441n) throw new Error("Wrong chain ID: " + network.chainId);

function getBuildInfo(file, name) {
  const dir = "artifacts/build-info";
  for (const entry of readdirSync(dir)) {
    const info = JSON.parse(readFileSync(dir + "/" + entry, "utf8"));
    const artifact = info.output?.contracts?.[file]?.[name];
    if (artifact) return { info, artifact };
  }
  throw new Error("No build-info found for " + name);
}

async function explorerGet(address) {
  const response = await fetch("https://explorer.testnet.liteforge.zeeve.net/api/v2/smart-contracts/" + address);
  if (!response.ok) throw new Error("Explorer lookup failed for " + address + ": HTTP " + response.status);
  return response.json();
}

for (const target of targets) {
  const raw = await provider.getStorage(target.address, SLOT);
  const implementation = getAddress("0x" + raw.slice(-40));
  if (implementation === getAddress("0x0000000000000000000000000000000000000000")) {
    throw new Error(target.name + " proxy has empty implementation slot");
  }

  const { info, artifact } = getBuildInfo(target.file, target.name);
  const deployed = (await provider.getCode(implementation)).toLowerCase();
  const expected = ("0x" + artifact.evm.deployedBytecode.object).toLowerCase();
  if (deployed !== expected) {
    throw new Error(
      target.name + " implementation " + implementation +
      " bytecode does not exactly match the current repository build. Refusing to publish incorrect source."
    );
  }

  let current = await explorerGet(implementation);
  if (current.is_verified !== true || typeof current.source_code !== "string") {
    const form = new URLSearchParams({
      codeformat: "solidity-standard-json-input",
      contractaddress: implementation,
      contractname: target.file + ":" + target.name,
      compilerversion: "v" + info.solcVersion,
      sourceCode: JSON.stringify(info.input),
    });
    const response = await fetch(API + "?module=contract&action=verifysourcecode", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const submitted = await response.json();
    if (submitted.status !== "1") {
      throw new Error("Explorer rejected verification for " + target.name + ": " + JSON.stringify(submitted));
    }
    const guid = submitted.result;
    let verified = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const statusResponse = await fetch(API + "?module=contract&action=checkverifystatus&guid=" + encodeURIComponent(guid));
      const status = await statusResponse.json();
      if (status.status === "1" && /pass|verified/i.test(String(status.result))) {
        verified = true;
        break;
      }
      if (status.status === "0" && /fail|error/i.test(String(status.result))) {
        throw new Error("Explorer verification failed for " + target.name + ": " + JSON.stringify(status));
      }
    }
    if (!verified) throw new Error("Verification pending or timed out for " + target.name + " (" + guid + ")");
    current = await explorerGet(implementation);
  }

  if (current.is_verified !== true || typeof current.source_code !== "string") {
    throw new Error("Explorer still does not report verified source for " + target.name + " implementation " + implementation);
  }
  console.log("VERIFIED", target.name, "proxy", target.address, "implementation", implementation);
}
