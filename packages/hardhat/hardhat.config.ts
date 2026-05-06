import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import * as dotenv from "dotenv";

dotenv.config();

const INFURA_API_KEY = process.env.INFURA_API_KEY || "";
const RAW_KEY = (process.env.MNEMONIC || "").trim();

// Accept either a raw private key (0x-prefixed hex, 66 chars) or a BIP-39 mnemonic phrase
const isPrivateKey = /^0x[0-9a-fA-F]{64}$/.test(RAW_KEY);
const sepoliaAccounts = isPrivateKey
  ? [RAW_KEY]
  : {
      mnemonic: RAW_KEY || "test test test test test test test test test test test junk",
      path: "m/44'/60'/0'/0",
      initialIndex: 0,
      count: 10,
    };

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    sepolia: {
      url: `https://sepolia.infura.io/v3/${INFURA_API_KEY}`,
      chainId: 11155111,
      accounts: sepoliaAccounts,
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
    alice: {
      default: 1,
    },
    bob: {
      default: 2,
    },
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
    deploy: "./deploy",
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
