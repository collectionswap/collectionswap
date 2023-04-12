import path from "path";

import * as tdly from "@tenderly/hardhat-tenderly";
import * as dotenv from "dotenv";
import { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } from "hardhat/builtin-tasks/task-names";
import { subtask } from "hardhat/config";

import type { HardhatUserConfig } from "hardhat/config";

import "@nomiclabs/hardhat-truffle5";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-contract-sizer";

import "./scripts/index";

dotenv.config();
tdly.setup();

const UNUSED_CONTRACTS = [
  "CollectionRouter2",
  "CollectionRouterWithRoyalties",
].map((contractName: string) => {
  return path.resolve(`./contracts/routers/${contractName}.sol`).toString();
});

const TESTING_DIRS = ["./contracts/test"].map((relPath: string) => {
  return path.resolve(relPath).toString();
});

subtask(
  TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS,
  async (_, { config: _config }, runSuper) => {
    const shouldCompileTestFiles =
      process.env.TESTING?.toLowerCase() === "true";
    const paths: any = await runSuper();

    const excludedFiles = UNUSED_CONTRACTS;
    const excludedDirs = shouldCompileTestFiles ? [] : TESTING_DIRS;

    const filteredPaths = paths.filter((solidityFilePath: string) => {
      // First check if it's in an excluded directory
      for (const excludedDir of excludedDirs) {
        if (solidityFilePath.startsWith(excludedDir)) {
          return false;
        }
      }

      // Then check if it's an excluded file
      for (const excludedFile of excludedFiles) {
        if (excludedFile === solidityFilePath) {
          return false;
        }
      }

      return true;
    });
    return filteredPaths;
  }
);

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 150,
          },
          viaIR: true,
        },
      },
    ],
  },
  gasReporter: {
    enabled: true,
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  },
  contractSizer: { runOnCompile: true },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
    ...Object.fromEntries(
      Object.entries({
        mainnet: 1,
        goerli: 5,
        mumbai: 80001,
        "base-goerli": 84531,
      }).map(([networkName, chainId]) => {
        return [
          networkName,
          {
            chainId,
            url: process.env[`${networkName.replace(/-/, '_').toUpperCase()}_URL`] || "",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
          },
        ];
      })
    ),
  },
  etherscan: {
    // hardhat verify --list-networks
    apiKey: {
      ...Object.fromEntries(
        ["mainnet", "goerli", "base-goerli"].map((networkName) => [
          networkName,
          process.env.ETHERSCAN_API_KEY,
        ])
      ),
      ...Object.fromEntries(
        ["polygonMumbai"].map((networkName) => [
          networkName,
          process.env.POLYGONSCAN_API_KEY,
        ])
      ),
    } as Record<string, string> | undefined,
    customChains: [
      {
        network: "base-goerli",
        chainId: 84531,
        urls: {
         apiURL: "https://api-goerli.basescan.org/api",
         browserURL: "https://goerli.basescan.org"
        }
      }
    ]
  },
  paths: {
    tests: "./test/hh",
  },
  mocha: {
    grep: "Gas",
    invert: process.env.RUN_GAS?.toLowerCase() !== "true",
  },
};

export default config;
