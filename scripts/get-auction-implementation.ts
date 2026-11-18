import { network } from "hardhat";

const { ethers } = await network.connect();

const proxy = "0x074CD851A0C05A4B8bbfBAC790bA5ca3E77725C2";

const slot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const value = await ethers.provider.getStorage(proxy, slot);

const implementation = "0x" + value.slice(-40);

console.log("Auction Proxy:", proxy);
console.log("Auction Implementation:", implementation);