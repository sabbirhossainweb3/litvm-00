
import { network } from "hardhat";

const { ethers } = await network.connect();

const proxy = "0x9914F5f46dd37Bf5F5a54b2B1eB7618c4897D3c4";

const slot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const value = await ethers.provider.getStorage(proxy, slot);

const implementation = "0x" + value.slice(-40);

console.log("Marketplace Proxy:", proxy);
console.log("Marketplace Implementation:", implementation);
