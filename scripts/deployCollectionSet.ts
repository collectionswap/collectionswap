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
  RNGChainlinkV2,
  LSSVMPairFactory,
  LSSVMPairFactory__factory
} from "../typechain-types";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

let deployFactory: any;
// Templates
let templateNames = ["LSSVMPairEnumerableETH", "LSSVMPairMissingEnumerableETH", "LSSVMPairEnumerableERC20", "LSSVMPairMissingEnumerableERC20"];
let templateAddresses: string[] = [];

// Curves
let curveNames = ["LinearCurve", "ExponentialCurve", "XykCurve"] // "SigmoidCurve"]
let curveAddresses: string[] = [];

let factory: LSSVMPairFactory;
let collectionSwap: Collectionswap;
let collectionStaker: Collectionstaker;
let rng: RNGChainlinkV2;

export async function deployCollectionSet(
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

  console.log(`---------------------------------`);
  console.log(`------ Deploying Templates ------`);
  console.log(`---------------------------------`);

  for (let templateName of templateNames) {
    console.log(`Deploying ${templateName}`);
    deployFactory = await hre.ethers.getContractFactory(
      templateName,
      deployer
    );
    let deployedTemplate = await deployFactory.deploy();
    await deployedTemplate.deployed();
    console.log(`${templateName} address: ${deployedTemplate.address}`);
    templateAddresses.push(deployedTemplate.address);
  }
  
  console.log(`------------------------------`);

  console.log(`Deploying factory...`);
  const lssvmFactory = (await hre.ethers.getContractFactory(
    "LSSVMPairFactory",
    deployer
  )) as LSSVMPairFactory__factory;
  factory = await lssvmFactory.deploy(
    templateAddresses[0],
    templateAddresses[1],
    templateAddresses[2],
    templateAddresses[3],
    hre.ethers.constants.AddressZero, // payout address
    hre.ethers.utils.parseEther(config.PROTOCOL_FEE_MULTIPLIER),
    hre.ethers.utils.parseEther(config.CARRY_FEE_MULTIPLIER)
  )
  await factory.deployed();
  console.log(`Factory address: ${factory.address}`);

  console.log(`--------------------------------`);
  console.log(`------- Deploying Curves -------`);
  console.log(`--------------------------------`);

  for (let curveName of curveNames) {
    console.log(`Deploying ${curveName}`);
    deployFactory = await hre.ethers.getContractFactory(
      curveName,
      deployer
    );
    let deployedCurve = await deployFactory.deploy();
    await deployedCurve.deployed();
    console.log(`${curveName} address: ${deployedCurve.address}`);
    curveAddresses.push(deployedCurve.address);

    console.log(`Whitelisting ${curveName} in factory...`);
    await factory.setBondingCurveAllowed(deployedCurve.address, true);
  }

  console.log(`------------------------------`);

  console.log(`Deploying Collectionswap...`);
  const collectionSwapFactory = (await hre.ethers.getContractFactory(
    "Collectionswap",
    deployer
  )) as Collectionswap__factory;
  collectionSwap = await collectionSwapFactory.deploy(factory.address);
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
    lssvmPairEnumerableETH: templateAddresses[0],
    lssvmPairMissingEnumerableETH: templateAddresses[1],
    lssvmPairEnumerableERC20: templateAddresses[2],
    lssvmPairMissingEnumerableERC20: templateAddresses[3],
    linearCurve: curveAddresses[0],
    exponentialCurve: curveAddresses[1],
    xykCurve: curveAddresses[2],
    // sigmoidCurve: curveAddresses[3],
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

  console.log(`----- VERIFICATION ------`);
  for (let i = 0; i < templateAddresses.length; i++) {
    console.log(`verifying ${templateNames[i]}`);
    await hre.run("verify:verify", {
      address: templateAddresses[i],
      constructorArguments: [],
    });
  }
  
  console.log("verifying factory...");
  await hre.run("verify:verify", {
    address: factory.address,
    constructorArguments: [
      templateAddresses[0],
      templateAddresses[1],
      templateAddresses[2],
      templateAddresses[3],
      hre.ethers.constants.AddressZero, // payout address
      hre.ethers.utils.parseEther(config.PROTOCOL_FEE_MULTIPLIER)
    ],
  });

  for (let i = 0; i < curveAddresses.length; i++) {
    console.log(`verifying ${curveNames[i]}`);
    await hre.run("verify:verify", {
      address: curveAddresses[i],
      constructorArguments: [],
    });
  }

  console.log("verifying Collectionswap...");
  await hre.run("verify:verify", {
    address: collectionSwap.address,
    constructorArguments: [factory.address],
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
