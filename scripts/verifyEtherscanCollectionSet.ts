import fs from "fs";
import path from "path";

import { configs } from "./config";

import type { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

export async function verifyEtherscanCollectionSet(
  taskArgs: any,
  hre: HardhatRuntimeEnvironment
) {
  async function verify(name: string, args: TaskArguments): Promise<void> {
    try {
      console.log(`Verifying ${name}...`);
      await hre.run("verify:verify", args);
    } catch (err: any) {
      if (
        err.message.includes("Reason: Already Verified") ||
        err.message === "Contract source code already verified"
      ) {
        console.log("Contract is already verified!");
      } else {
        throw err;
      }
    }
  }

  // Read file from input
  const filePath =
    taskArgs.i || path.resolve("deploys", `${hre.network.name}.json`);
  const { contracts, deployer: deployerAddress } = JSON.parse(
    fs.readFileSync(filePath, "utf8")
  );
  const networkId = hre.network.config.chainId as number;
  console.log(`NetworkId: ${networkId}`);
  const config = configs[networkId];

  console.log(`----- VERIFICATION ------`);

  const templates = Object.entries(contracts).filter(([name]) =>
    name.match(/CollectionPool(?:Missing)?Enumerable(?:ETH|ERC20)/)
  );
  for (const [name, address] of templates) {
    await verify(name, {
      address,
      constructorArguments: [],
    });
  }

  await verify("CollectionPoolFactory", {
    address: contracts.CollectionPoolFactory,
    constructorArguments: [
      ...templates.map(([_, address]) => address),
      deployerAddress, // Payout address
      hre.ethers.utils.parseEther(config.PROTOCOL_FEE_MULTIPLIER),
      hre.ethers.utils.parseEther(config.CARRY_FEE_MULTIPLIER),
    ],
  });

  const curves = Object.entries(contracts).filter(([name]) =>
    name.endsWith("Curve")
  );
  for (const [name, address] of curves) {
    await verify(name, {
      address,
      constructorArguments: [],
    });
  }

  const routers = Object.entries(contracts).filter(([name]) =>
    name.includes("Router")
  );
  for (const [name, address] of routers) {
    await verify(name, {
      address,
      constructorArguments: [contracts.CollectionPoolFactory],
    });
  }

  await verify("Collectionstaker", {
    address: contracts.Collectionstaker,
    constructorArguments: [contracts.CollectionPoolFactory],
  });

  await verify("SortitionTreeManager", {
    address: contracts.SortitionTreeManager,
    constructorArguments: [],
  });

  await verify("RewardVaultETH", {
    address: contracts.RewardVaultETH,
    constructorArguments: [],
  });

  await verify("RewardVaultETHDraw", {
    address: contracts.RewardVaultETHDraw,
    constructorArguments: [],
  });

  await verify("MonotonicIncreasingValidator", {
    address: contracts.MonotonicIncreasingValidator,
    constructorArguments: [],
  });

  await verify("RNGChainlinkV2", {
    address: contracts.RNGChainlinkV2,
    constructorArguments: [
      deployerAddress,
      config.VRF_COORDINATOR,
      config.SUBSCRIPTION_ID,
      config.KEY_HASH,
    ],
  });
}
