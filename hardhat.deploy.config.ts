import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const privateKey = process.env.PRIVATE_KEY?.trim();
const rpcUrl = process.env.QUICKNODE_RPC_URL || process.env.MONAD_RPC_URL;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
  networks: {
    monad_testnet: {
      url: rpcUrl || "https://rpc.testnet.monad.xyz",
      chainId: 10143,
      accounts: privateKey ? [privateKey] : [],
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test-hardhat",
    cache: "./cache-hardhat-deploy",
    artifacts: "./artifacts-deploy",
  },
};

export default config;
