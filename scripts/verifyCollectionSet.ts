/* eslint-disable camelcase */
import fs from "fs";

import { LedgerSigner } from "@anders-t/ethers-ledger";

import {
    Collectionstaker__factory,
    Collectionstaker,
  } from "../typechain-types";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

import { configs } from "./config";

let collectionStaker: Collectionstaker;

export async function verifyCollectionSet(
    taskArgs: any,
    hre: HardhatRuntimeEnvironment
) {
  // Read file from input
  const addresses = JSON.parse(fs.readFileSync(taskArgs.i, "utf8"));
  const networkId = hre.network.config.chainId as number;
  console.log(`NetworkId: ${networkId}`);
  const config = configs[networkId];

  const [deployer] = config.USE_LEDGER
    ? [new LedgerSigner(hre.ethers.provider)]
    : await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  console.log(`Deployer: ${deployerAddress}`);

  console.log(`----- VERIFICATION ------`);
  let templateAddresses = [addresses.lssvmPairEnumerableETH, addresses.lssvmPairMissingEnumerableETH, addresses.lssvmPairEnumerableERC20, addresses.lssvmPairMissingEnumerableERC20];
  let curveAddresses = [addresses.linearCurve, addresses.exponentialCurve, addresses.xykCurve, addresses.sigmoidCurve];
  let factory = addresses.factory;

  const collectionStakerFactory = (await hre.ethers.getContractFactory(
    "Collectionstaker",
    deployer
  )) as Collectionstaker__factory;
  collectionStaker = collectionStakerFactory.attach(addresses.collectionStaker);

  for (let i = 0; i < templateAddresses.length; i++) {
    console.log(`verifying template ${i}`);
    await hre.run("verify:verify", {
      address: templateAddresses[i],
      constructorArguments: [],
    });
  }

  console.log("verifying factory...");
  await hre.run("verify:verify", {
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
    console.log(`verifying curve ${i}`);
    await hre.run("verify:verify", {
      address: curveAddresses[i],
      constructorArguments: [],
    });
  }

  console.log("verifying Collectionstaker...");
  await hre.run("verify:verify", {
    address: collectionStaker.address,
    constructorArguments: [factory],
  });

  console.log("verifying RewardETHLogic...");
  await hre.run("verify:verify", {
    address: await collectionStaker.rewardPoolETHLogic(),
    constructorArguments: [],
  });

  console.log("verifying RewardETHDrawLogic...");
  await hre.run("verify:verify", {
    address: await collectionStaker.rewardPoolETHDrawLogic(),
    constructorArguments: [],
  });

  console.log("verifying Monotonic Increasing Validator...");
  await hre.run("verify:verify", {
    address: addresses.monotonicIncreasingValidator,
    constructorArguments: [],
  });

  console.log("verifying RNG...");
  await hre.run("verify:verify", {
    address: addresses.rng,
    constructorArguments: [
      deployerAddress,
      config.VRF_COORDINATOR,
      config.SUBSCRIPTION_ID,
      config.KEY_HASH,
    ],
  });
}
