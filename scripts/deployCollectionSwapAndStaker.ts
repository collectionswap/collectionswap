/* eslint-disable camelcase */
import fs from "fs";

import { LedgerSigner } from "@anders-t/ethers-ledger";

import { configs } from "./config";

import type {
  Collectionstaker__factory,
  Collectionswap__factory,
  RNGChainlinkV2__factory,
  Collectionstaker,
  Collectionswap,
  RNGChainlinkV2
} from "../typechain-types";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

let collectionSwap: Collectionswap;
let collectionStaker: Collectionstaker;
let rng: RNGChainlinkV2;

export async function deployCollectionSwapAndStaker(
  hre: HardhatRuntimeEnvironment
) {
  const networkId = hre.network.config.chainId as number;
  console.log(`NetworkId: ${networkId}`);
  const config = configs[networkId];

  const [deployer] = config.USE_LEDGER
    ? [new LedgerSigner(hre.ethers.provider)]
    : await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  console.log(`Deployer: ${deployerAddress}`);

  const factoryAddress = config.FACTORY;
  console.log(`Deploying Collectionswap...`);
  const collectionSwapFactory = (await hre.ethers.getContractFactory(
    "Collectionswap",
    deployer
  )) as Collectionswap__factory;
  collectionSwap = await collectionSwapFactory.deploy(factoryAddress);
  await collectionSwap.deployed();
  console.log(`Collectionswap address: ${collectionSwap.address}`);

  console.log(`Deploying Collectionstaker...`);
  const collectionStakerFactory = (await hre.ethers.getContractFactory(
    "Collectionstaker",
    deployer
  )) as Collectionstaker__factory;
  collectionStaker = await collectionStakerFactory.deploy(
    collectionSwap.address
  );
  await collectionStaker.deployed();
  console.log(`Collectionstaker address: ${collectionStaker.address}`);

  console.log(`Deploying ChainlinkRNGv2...`);
  const rngFactory = (await hre.ethers.getContractFactory(
    "RNGChainlinkV2",
    deployer
  )) as RNGChainlinkV2__factory;
  rng = await rngFactory.deploy(
    deployerAddress,
    config.VRF_COORDINATOR,
    config.SUBSCRIPTION_ID,
    config.KEY_HASH
  );
  await rng.deployed();
  console.log(`Chainlink RNG address: ${collectionStaker.address}`);

  console.log(`Setting RNG in staker...`);
  // set RNG in staker
  await collectionStaker.setRNG(rng.address);

  console.log("exporting addresses...");
  const addressesToExport = {
    deployer: deployerAddress,
    collectionSwap: collectionSwap.address,
    collectionStaker: collectionStaker.address,
    rng: rng.address
  };
  const exportJson = JSON.stringify(addressesToExport, null, 2);
  fs.writeFileSync(config.EXPORT_FILENAME, exportJson);

  console.log(
    "waiting for etherscan backend propagation... sleeping for 1 minute"
  );
  for (let i = 1; i <= 4; i++) {
    await new Promise((resolve) => {
      setTimeout(resolve, 15_000);
    });
    console.log(`${60 - 15 * i}s left...`);
  }

  console.log("verifying Collectionswap...");
  await hre.run("verify:verify", {
    address: collectionSwap.address,
    constructorArguments: [factoryAddress],
  });

  console.log("verifying Collectionstaker...");
  await hre.run("verify:verify", {
    address: collectionStaker.address,
    constructorArguments: [collectionSwap.address],
  });

  console.log("verifying RNG...");
  await hre.run("verify:verify", {
    address: rng.address,
    constructorArguments: [deployerAddress, config.VRF_COORDINATOR, config.SUBSCRIPTION_ID, config.KEY_HASH],
  });
}
