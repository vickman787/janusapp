import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", await deployer.getAddress());

  // Use env var or a mock address for local dev
  const ausdAddress = process.env.AUSD_ADDRESS ?? (
    // Deploy a mock AUSD for local testing
    await (await (await ethers.getContractFactory("MockAUSD")).deploy()).getAddress()
  );

  console.log("AUSD address:", ausdAddress);

  const JanusSplit = await ethers.getContractFactory("JanusSplit");
  const settler    = await JanusSplit.deploy(ausdAddress);
  await settler.waitForDeployment();

  const address = await settler.getAddress();
  console.log("JanusSplit deployed to:", address);
  console.log("Chain ID:", (await ethers.provider.getNetwork()).chainId);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
