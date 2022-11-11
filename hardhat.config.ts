import { HardhatUserConfig } from "hardhat/config";
import '@nomiclabs/hardhat-truffle5';
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-contract-sizer";
import * as dotenv from 'dotenv';

import './scripts/index';

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.17",
    settings: {
      optimizer: {
        enabled: true,
        runs: 150
        // runs: 999999
      },
      viaIR: true //TODO: uncomment on when ready for production. More info at https://docs.soliditylang.org/en/latest/ir-breaking-changes.html
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
