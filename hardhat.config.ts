import { HardhatUserConfig } from "hardhat/config";
import '@nomiclabs/hardhat-truffle5';
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-contract-sizer";
import * as dotenv from 'dotenv';
import path from 'path';

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
            runs: 4999
          },
          viaIR: true
        }
      }
    ],
    overrides: {
      "contracts/RewardPoolETHDraw.sol": {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 150
          },
          viaIR: true
        }
      }
    }
  },
  gasReporter: {
    enabled: true,
    coinmarketcap: process.env.COINMARKETCAP_API_KEY
  },
  contractSizer: { runOnCompile: true },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true
    },
    rinkeby: {
      chainId: 4,
      url: process.env.RINKEBY_URL || '',
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    goerli: {
      chainId: 5,
      url: process.env.GOERLI_URL || '',
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    mainnet: {
      chainId: 1,
      url: process.env.MAINNET_URL || '',
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : []
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  },
  paths: {
    tests: "./test/hh",
  }
};

export default config;
