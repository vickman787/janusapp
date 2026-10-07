import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const token = process.env.AUSD_ADDRESS || process.env.NEXT_PUBLIC_AUSD_ADDRESS;
  if (!token) throw new Error("AUSD_ADDRESS is required");

  console.log("Deploying JanusSplitV2 with:", await deployer.getAddress());
  console.log("AUSD token:", token);

  const factory = await ethers.getContractFactory("JanusSplitV2");
  const contract = await factory.deploy(token);
  await contract.waitForDeployment();

  console.log("JanusSplitV2 address:", await contract.getAddress());
  console.log("Deployment transaction:", contract.deploymentTransaction()?.hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
