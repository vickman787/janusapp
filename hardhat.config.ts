import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-foundry";
import "dotenv/config";

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const MONAD_RPC   = process.env.MONAD_RPC_URL ?? "https://rpc.testnet.monad.xyz";
const QUICKNODE_RPC = process.env.QUICKNODE_RPC_URL ?? MONAD_RPC;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",
    },
  },

  networks: {
    // Local Hardhat node
    hardhat: {
      chainId: 31337,
      allowUnlimitedContractSize: false,
    },

    // Monad Testnet — Chain ID 10143
    monad_testnet: {
      url: QUICKNODE_RPC,
      chainId: 10143,
      // Never fall back to a public development key on a live network.
      // Deployment fails safely when PRIVATE_KEY is not configured.
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      gasPrice: "auto",
    },
  },

  // Gas reporter for optimization insights
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    coinmarketcap: process.env.CMC_API_KEY,
  },

  // Etherscan / explorer verification
  etherscan: {
    apiKey: {
      monad_testnet: "placeholder",
    },
    customChains: [
      {
        network: "monad_testnet",
        chainId: 10143,
        urls: {
          apiURL:  "https://testnet.monadexplorer.com/api",
          browserURL: "https://testnet.monadexplorer.com",
        },
      },
    ],
  },

  paths: {
    sources:   "./contracts",
    tests:     "./test-hardhat",
    cache:     "./cache-hardhat",
    artifacts: "./artifacts",
  },
};

export default config;
