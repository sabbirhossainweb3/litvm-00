import { network } from "hardhat";

const { ethers } = await network.connect();

const proxy = "0x8c0CDdFF0154042a3A9E16f68Ac71C46cD2DA1ea";

const slot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const value = await ethers.provider.getStorage(proxy, slot);

const implementation = "0x" + value.slice(-40);

console.log("Collection Factory Proxy:", proxy);
console.log("Collection Factory Implementation:", implementation);