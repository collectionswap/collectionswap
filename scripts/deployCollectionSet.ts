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

  const { validatorNames, validatorAddresses } = await deployValidators(
    hre,
    deployer
  );

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

  const zip = (a: string[], b: string[]) => a.map((k, i) => [k, b[i]]);

  const addressesToExport = {
    contracts: {
      ...Object.fromEntries(zip(templateNames, templateAddresses)),
      ...Object.fromEntries(zip(curveNames, curveAddresses)),
      CollectionPoolFactory: factory.address,
      Collectionstaker: collectionStaker.address,
      SortitionTreeManager: sortitionTreeManagerAddress,
      RewardVaultETH: rewardVaultETHAddress,
      RewardVaultETHDraw: rewardVaultETHDrawAddress,
      RNGChainlinkV2: rng.address,
      ...Object.fromEntries(zip(validatorNames, validatorAddresses)),
    },
    deployer: deployerAddress,
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
