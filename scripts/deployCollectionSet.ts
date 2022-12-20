/* eslint-disable camelcase */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

import { LedgerSigner } from "@anders-t/ethers-ledger";

import { configs } from "./config";

import type {
  Collectionstaker__factory,
  CollectionPoolFactory__factory,
  RNGChainlinkV2__factory,
  RNGChainlinkV2,
} from "../typechain-types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

export async function deployCollectionSet(hre: HardhatRuntimeEnvironment) {
  const networkId = hre.network.config.chainId as number;
  console.log(`NetworkId: ${networkId}`);
  const config = configs[networkId];

  const [deployer] = config.USE_LEDGER
    ? [new LedgerSigner(hre.ethers.provider)]
    : await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  console.log(`Deployer: ${deployerAddress}`);

  const { templateNames, templateAddresses } = await deployTemplates(
    hre,
    deployer
  );

  console.log(`Deploying factory...`);
  const collectionFactory = (await hre.ethers.getContractFactory(
    "CollectionPoolFactory",
    deployer
  )) as CollectionPoolFactory__factory;
  const factory = await collectionFactory.deploy(
    templateAddresses[0],
    templateAddresses[1],
    templateAddresses[2],
    templateAddresses[3],
    hre.ethers.constants.AddressZero, // Payout address
    hre.ethers.utils.parseEther(config.PROTOCOL_FEE_MULTIPLIER),
    hre.ethers.utils.parseEther(config.CARRY_FEE_MULTIPLIER)
  );
  await factory.deployed();
  console.log(`Factory address: ${factory.address}`);

  const { curveNames, curveAddresses } = await deployCurves(hre, deployer);

  for (let i = 0; i < curveNames.length; i++) {
    console.log(`Whitelisting ${curveNames[i]} in factory...`);
    await factory.setBondingCurveAllowed(curveAddresses[i], true);
  }

  console.log(`Deploying Collectionstaker...`);
  const collectionStakerFactory = (await hre.ethers.getContractFactory(
    "Collectionstaker",
    {
      signer: deployer,
    }
  )) as Collectionstaker__factory;
  const collectionStaker = await collectionStakerFactory.deploy(
    factory.address
  );
  await collectionStaker.deployed();
  console.log(`Collectionstaker address: ${collectionStaker.address}`);

  const { validatorAddresses } = await deployValidators(hre, deployer);

  const rng = await deployChainlink(hre, deployer);

  console.log(`Setting RNG in staker...`);
  // Set RNG in staker
  await collectionStaker.setRNG(rng.address);

  console.log(`Allow staker to call RNG...`);
  await rng.setAllowedCaller(collectionStaker.address);

  console.log("exporting addresses...");
  const [
    sortitionTreeManagerAddress,
    rewardVaultETHAddress,
    rewardVaultETHDrawAddress,
  ] = await Promise.all([
    collectionStaker.treeManager(),
    collectionStaker.rewardVaultETHLogic(),
    collectionStaker.rewardVaultETHDrawLogic(),
  ]);
  const addressesToExport = {
    deployer: deployerAddress,
    collectionPoolEnumerableETH: templateAddresses[0],
    collectionPoolMissingEnumerableETH: templateAddresses[1],
    collectionPoolEnumerableERC20: templateAddresses[2],
    collectionPoolMissingEnumerableERC20: templateAddresses[3],
    linearCurve: curveAddresses[0],
    exponentialCurve: curveAddresses[1],
    xykCurve: curveAddresses[2],
    sigmoidCurve: curveAddresses[3],
    factory: factory.address,
    collectionStaker: collectionStaker.address,
    sortitionTreeManager: sortitionTreeManagerAddress,
    rewardVaultETH: rewardVaultETHAddress,
    rewardVaultETHDraw: rewardVaultETHDrawAddress,
    rng: rng.address,
    monotonicIncreasingValidator: validatorAddresses[0],
  };
  const exportJson = JSON.stringify(
    {
      ...addressesToExport,
      commit: execSync("git rev-parse HEAD").toString().trim(),
    },
    null,
    2
  );
  fs.writeFileSync(
    path.resolve("deploys", `${hre.network.name}.json`),
    exportJson
  );

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
      hre.ethers.constants.AddressZero, // Payout address
      hre.ethers.utils.parseEther(config.PROTOCOL_FEE_MULTIPLIER),
      hre.ethers.utils.parseEther(config.CARRY_FEE_MULTIPLIER),
    ],
  });

  for (let i = 0; i < curveAddresses.length; i++) {
    console.log(`verifying ${curveNames[i]}`);
    await hre.run("verify:verify", {
      address: curveAddresses[i],
      constructorArguments: [],
    });
  }

  console.log("verifying Collectionstaker...");
  await hre.run("verify:verify", {
    address: collectionStaker.address,
    constructorArguments: [factory.address],
  });

  console.log("verifying SortitionTreeManager...");
  await hre.run("verify:verify", {
    address: sortitionTreeManagerAddress,
    constructorArguments: [],
  });

  console.log("verifying RewardETHLogic...");
  await hre.run("verify:verify", {
    address: rewardVaultETHAddress,
    constructorArguments: [],
  });

  console.log("verifying RewardETHDrawLogic...");
  await hre.run("verify:verify", {
    address: rewardVaultETHDrawAddress,
    constructorArguments: [],
  });

  console.log("verifying Monotonic Increasing Validator...");
  await hre.run("verify:verify", {
    address: validatorAddresses[0],
    constructorArguments: [],
  });

  console.log("verifying RNG...");
  await hre.run("verify:verify", {
    address: rng.address,
    constructorArguments: [
      deployerAddress,
      config.VRF_COORDINATOR,
      config.SUBSCRIPTION_ID,
      config.KEY_HASH,
    ],
  });
}

export async function deployTemplates(
  hre: HardhatRuntimeEnvironment,
  deployer: LedgerSigner | SignerWithAddress
): Promise<{ templateNames: string[]; templateAddresses: string[] }> {
  // Templates
  const templateNames = [
    "CollectionPoolEnumerableETH",
    "CollectionPoolMissingEnumerableETH",
    "CollectionPoolEnumerableERC20",
    "CollectionPoolMissingEnumerableERC20",
  ];
  const templateAddresses: string[] = [];

  console.log(`---------------------------------`);
  console.log(`------ Deploying Templates ------`);
  console.log(`---------------------------------`);

  for (const templateName of templateNames) {
    console.log(`Deploying ${templateName}`);
    const deployFactory = await hre.ethers.getContractFactory(
      templateName,
      deployer
    );
    const deployedTemplate = await deployFactory.deploy();
    await deployedTemplate.deployed();
    console.log(`${templateName} address: ${deployedTemplate.address}`);
    templateAddresses.push(deployedTemplate.address);
  }

  console.log(`------------------------------`);

  return { templateNames, templateAddresses };
}

export async function deployCurves(
  hre: HardhatRuntimeEnvironment,
  deployer: LedgerSigner | SignerWithAddress
): Promise<{ curveNames: string[]; curveAddresses: string[] }> {
  // Curves
  const curveNames = [
    "LinearCurve",
    "ExponentialCurve",
    "XykCurve",
    "SigmoidCurve",
  ];
  const curveAddresses: string[] = [];

  console.log(`--------------------------------`);
  console.log(`------- Deploying Curves -------`);
  console.log(`--------------------------------`);

  for (const curveName of curveNames) {
    console.log(`Deploying ${curveName}`);
    const deployFactory = await hre.ethers.getContractFactory(
      curveName,
      deployer
    );
    const deployedCurve = await deployFactory.deploy();
    await deployedCurve.deployed();
    console.log(`${curveName} address: ${deployedCurve.address}`);
    curveAddresses.push(deployedCurve.address);
  }

  console.log(`------------------------------`);

  return { curveNames, curveAddresses };
}

export async function deployValidators(
  hre: HardhatRuntimeEnvironment,
  deployer: LedgerSigner | SignerWithAddress
): Promise<{ validatorNames: string[]; validatorAddresses: string[] }> {
  // Validators
  const validatorNames = ["MonotonicIncreasingValidator"];
  const validatorAddresses: string[] = [];

  console.log(`--------------------------------`);
  console.log(`------- Deploying Validators -------`);
  console.log(`--------------------------------`);

  for (const validatorName of validatorNames) {
    console.log(`Deploying ${validatorName}`);
    const deployFactory = await hre.ethers.getContractFactory(
      validatorName,
      deployer
    );
    const deployedCurve = await deployFactory.deploy();
    await deployedCurve.deployed();
    console.log(`${validatorName} address: ${deployedCurve.address}`);
    validatorAddresses.push(deployedCurve.address);
  }

  console.log(`------------------------------`);

  return { validatorNames, validatorAddresses };
}

export async function deployChainlink(
  hre: HardhatRuntimeEnvironment,
  deployer: LedgerSigner | SignerWithAddress
): Promise<RNGChainlinkV2> {
  const config = configs[hre.network.config.chainId!];

  console.log(`Deploying ChainlinkRNGv2...`);
  const rngFactory = (await hre.ethers.getContractFactory(
    "RNGChainlinkV2",
    deployer
  )) as RNGChainlinkV2__factory;
  const rng = await rngFactory.deploy(
    await deployer.getAddress(),
    config.VRF_COORDINATOR,
    config.SUBSCRIPTION_ID,
    config.KEY_HASH
  );
  await rng.deployed();
  console.log(`Chainlink RNG address: ${rng.address}`);

  return rng;
}
