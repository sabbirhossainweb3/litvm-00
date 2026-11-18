import hre from "hardhat";

async function main() {
  const connection = await hre.network.create();
  const { ethers } = connection;

  const [wallet] = await ethers.getSigners();
  const address = await wallet.getAddress();
  const balance = await ethers.provider.getBalance(address);

  console.log("Wallet:", address);
  console.log("Balance:", ethers.formatEther(balance), "zkLTC");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});