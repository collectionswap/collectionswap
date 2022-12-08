import type { HardhatUserConfig } from "hardhat/config";

import "@nomiclabs/hardhat-truffle5";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-contract-sizer";
import path from "path";

import * as dotenv from "dotenv";

import './scripts/index';

dotenv.config();

import { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } from "hardhat/builtin-tasks/task-names";

 subtask(
   TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS,
   async (_, { config }, runSuper) => {
     const paths = await runSuper();

     return paths
       .filter(solidityFilePath => {
         const relativePath = path.relative(config.paths.sources, solidityFilePath)

         return !relativePath.endsWith(".t.sol");
       })
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
            runs: 150
          },
          viaIR: true
        }
      }
    ],
  },
  gasReporter: {
    enabled: true,
    coinmarketcap: process.env.COINMARKETCAP_API_KEY
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
      }).map(([networkName, chainId]) => {
        return [
          networkName,
          {
            chainId,
            url: process.env[`${networkName.toUpperCase()}_URL`] || "",
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
        ["mainnet", "goerli"].map((networkName) => [
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
    },
  },
  paths: {
    tests: "./test/hh",
  }
};

export default config;
