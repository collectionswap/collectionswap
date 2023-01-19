import InternalReporterConfig from "eth-gas-reporter/lib/config";
import { gasToCost, setGasAndPriceRates } from "eth-gas-reporter/lib/utils";
import hre from "hardhat";

import type { TransactionResponse } from "@ethersproject/providers";
import type { BigNumber } from "ethers";
import type { EthGasReporterConfig } from "hardhat-gas-reporter/dist/src/types";
import type {
  HardhatRuntimeEnvironment,
  HttpNetworkConfig,
} from "hardhat/types";
import type { Context } from "mocha";

export async function getGasToCost(): Promise<(gasUsed: BigNumber) => number> {
  let options = getOptions(hre);
  options = new InternalReporterConfig(options);

  // gas price from etherscan might be rate limited.
  await setGasAndPriceRates(options);
  const { ethPrice, gasPrice } = options;
  return (gas: BigNumber) => gasToCost(gas.toNumber(), ethPrice, gasPrice);
}

export function setUpGasToCost() {
  if (process.env.RUN_GAS?.toLowerCase() === "true") {
    before(async function () {
      this.gasToCost = await getGasToCost();
    });
  }
}

export function reportGasCost(f: () => Promise<TransactionResponse>) {
  it("Should be gas efficient", async function (this: Context) {
    const tx = await f.call(this);
    const receipt = await tx.wait();
    const { gasUsed } = receipt;
    this.test!.title = `Used ${gasUsed.toString()} gas, cost $${this.gasToCost(
      gasUsed
    )}`;
  });
}

// Copied from https://github.com/cgewecke/hardhat-gas-reporter/blob/2b907acd13b6fd2ef61131ea4660a961e2ed143e/src/index.ts#L91-L126
/**
 * Merges GasReporter defaults with user's GasReporter config
 * @param  {HardhatRuntimeEnvironment} hre
 * @return {any}
 */
/**
 * Sets reporter options to pass to eth-gas-reporter:
 * > url to connect to client with
 * > artifact format (hardhat)
 * > solc compiler info
 * @param  {HardhatRuntimeEnvironment} hre
 * @return {EthGasReporterConfig}
 */
function getDefaultOptions(
  hre: HardhatRuntimeEnvironment
): EthGasReporterConfig {
  const defaultUrl = "http://localhost:8545";
  const defaultCompiler = hre.config.solidity.compilers[0];

  let url: any;
  // Resolve URL
  if ((<HttpNetworkConfig>hre.network.config).url) {
    url = (<HttpNetworkConfig>hre.network.config).url;
  } else {
    url = defaultUrl;
  }

  return {
    enabled: true,
    url: <string>url,
    metadata: {
      compiler: {
        version: defaultCompiler.version,
      },
      settings: {
        optimizer: {
          enabled: defaultCompiler.settings.optimizer.enabled,
          runs: defaultCompiler.settings.optimizer.runs,
        },
      },
    },
  };
}

// Copied from https://github.com/cgewecke/hardhat-gas-reporter/blob/2b907acd13b6fd2ef61131ea4660a961e2ed143e/src/index.ts#L128-L135
/**
 * Merges GasReporter defaults with user's GasReporter config
 * @param  {HardhatRuntimeEnvironment} hre
 * @return {any}
 */
function getOptions(hre: HardhatRuntimeEnvironment): any {
  return { ...getDefaultOptions(hre), ...(hre.config as any).gasReporter };
}
