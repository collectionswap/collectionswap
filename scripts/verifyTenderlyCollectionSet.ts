import fs from "fs";
import path from "path";

import {
  getCompilerDataFromContracts,
  getContracts,
} from "@tenderly/hardhat-tenderly/dist/utils/util";
import { tenderly } from "hardhat";

import type { HardhatRuntimeEnvironment } from "hardhat/types";

export async function verifyTenderlyCollectionSet(
  taskArgs: any,
  hre: HardhatRuntimeEnvironment
) {
  // Read file from input
  const filePath = path.resolve("deploys", `${hre.network.name}.json`);
  const { contracts: contractNameToAddress } = JSON.parse(
    fs.readFileSync(filePath, "utf8")
  );
  const networkId = hre.network.config.chainId as number;
  console.log(`NetworkId: ${networkId}`);

  const flatContracts = Object.entries(contractNameToAddress).map(
    ([name, address]) => ({
      name,
      address: address as string,
    })
  );

  const contracts = await getContracts(hre, flatContracts);
  for (const contract of flatContracts) {
    contracts.find(
      (tenderlyContract) => tenderlyContract.contractName === contract.name
    )!.networks![networkId] = contract;
  }

  const config = getCompilerDataFromContracts(
    contracts,
    flatContracts,
    hre.config
  );

  const request = {
    config: {
      ...config,
      // eslint-disable-next-line camelcase
      via_ir: hre.config.solidity.compilers[0].settings.viaIR,
    },
    contracts,
  };

  console.log("Verifying...");
  await tenderly.verifyAPI(request);
}
