import fs from "fs";
import path from "path";

import { LedgerSigner } from "@anders-t/ethers-ledger";

import { configs } from "./config";

import type { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

export async function verifyCollectionSet(
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
  const addresses = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const networkId = hre.network.config.chainId as number;
  console.log(`NetworkId: ${networkId}`);
  const config = configs[networkId];

  const [deployer] = config.USE_LEDGER
    ? [new LedgerSigner(hre.ethers.provider)]
    : await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  console.log(`Deployer: ${deployerAddress}`);

  const templateAddresses = [
    addresses.collectionPoolEnumerableETH,
    addresses.collectionPoolMissingEnumerableETH,
    addresses.collectionPoolEnumerableERC20,
    addresses.collectionPoolMissingEnumerableERC20,
  ];
  const curveAddresses = [
    addresses.linearCurve,
    addresses.exponentialCurve,
    addresses.xykCurve,
    addresses.sigmoidCurve,
  ];
  const { factory } = addresses;

  console.log(`----- VERIFICATION ------`);

  for (let i = 0; i < templateAddresses.length; i++) {
    await verify(`template ${i}`, {
      address: templateAddresses[i],
      constructorArguments: [],
    });
  }

  await verify("factory", {
    address: factory,
    constructorArguments: [
      templateAddresses[0],
      templateAddresses[1],
      templateAddresses[2],
      templateAddresses[3],
      hre.ethers.constants.AddressZero, // Payout address
      hre.ethers.utils.parseEther(config.PROTOCOL_FEE_MULTIPLIER),
      hre.ethers.utils.parseEther(config.CARRY_FEE_MULTIPLIER),
    ],
  });

  for (let i = 0; i < curveAddresses.length; i++) {
    await verify(`curve ${i}`, {
      address: curveAddresses[i],
      constructorArguments: [],
    });
  }

  await verify("SortitionTree", {
    address: addresses.tree,
    constructorArguments: [],
  });

  await verify("Collectionstaker", {
    address: addresses.collectionStaker,
    constructorArguments: [factory],
  });

  await verify("RewardETHLogic", {
    address: addresses.rewardVaultETH,
    constructorArguments: [],
  });

  await verify("RewardETHDrawLogic", {
    address: addresses.rewardVaultETHDraw,
    constructorArguments: [],
  });

  await verify("Monotonic Increasing Validator", {
    address: addresses.monotonicIncreasingValidator,
    constructorArguments: [],
  });

  await verify("RNG", {
    address: addresses.rng,
    constructorArguments: [
      deployerAddress,
      config.VRF_COORDINATOR,
      config.SUBSCRIPTION_ID,
      config.KEY_HASH,
    ],
  });
}
