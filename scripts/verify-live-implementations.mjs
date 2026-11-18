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
  const wanted = file.replace(/^\.\//, "");
  for (const entry of readdirSync(dir).filter((value) => value.endsWith(".json"))) {
    const info = JSON.parse(readFileSync(dir + "/" + entry, "utf8"));
    // Hardhat 3 build-info source keys can be normalized differently from
    // the paths passed by the deployment scripts. Match by contract name
    // and normalized source path instead of requiring an exact object key.
    const contracts =
      info.output?.contracts ??
      info.buildInfo?.output?.contracts ??
      info.output?.output?.contracts ??
      {};
    for (const [sourceName, sourceContracts] of Object.entries(contracts)) {
      const normalized = String(sourceName).replace(/^\.\//, "");
      const pathMatches =
        normalized === wanted ||
        normalized.endsWith("/" + wanted) ||
        normalized.split("/").at(-1) === wanted.split("/").at(-1);
      if (pathMatches && sourceContracts?.[name]) {
        return { info, artifact: sourceContracts[name], sourceName };
      }
    }
  }
  throw new Error(
    "No build-info found for " + name + " at " + file +
    ". Check Hardhat build-info output/source paths."
  );
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

  // First trust the Explorer's own verification record. A verified
  // implementation has already passed the Explorer's compiler/bytecode
  // comparison; the current local build may legitimately differ from the
  // historical build used for deployment.
  let current = await explorerGet(implementation);
  if (current.is_verified === true && typeof current.source_code === "string") {
    console.log("ALREADY VERIFIED", target.name, "proxy", target.address, "implementation", implementation);
    continue;
  }

  // Only submit a source when the current local build reproduces the live
  // implementation byte-for-byte. Never publish a merely similar source.
  const { info, artifact } = getBuildInfo(target.file, target.name);
  const deployed = (await provider.getCode(implementation)).toLowerCase();
  const expected = ("0x" + artifact.evm.deployedBytecode.object).toLowerCase();
  if (deployed !== expected) {
    throw new Error(
      target.name + " implementation " + implementation +
      " is not verified on Explorer and does not exactly match the current repository build. " +
      "Refusing to publish incorrect source. Recover the exact deployment source/compiler settings first."
    );
  }

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
