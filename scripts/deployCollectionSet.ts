/* eslint-disable camelcase */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

import { LedgerSigner } from "@anders-t/ethers-ledger";

import { FEE_DECIMALS } from "../test/hh/shared/constants";

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
    await deployer.getAddress(), // Payout address
    hre.ethers.utils.parseUnits(config.PROTOCOL_FEE_MULTIPLIER, FEE_DECIMALS),
    hre.ethers.utils.parseUnits(config.CARRY_FEE_MULTIPLIER, FEE_DECIMALS)
  );
  await factory.deployed();
  console.log(`Factory address: ${factory.address}`);

  const { curveNames, curveAddresses } = await deployCurves(hre, deployer);
  for (let i = 0; i < curveNames.length; i++) {
    console.log(`Whitelisting ${curveNames[i]} in factory...`);
    await factory.setBondingCurveAllowed(curveAddresses[i], true);
  }

  const { routerNames, routerAddresses } = await deployRouters(
    hre,
    deployer,
    factory.address
  );
  for (let i = 0; i < routerNames.length; i++) {
    console.log(`Whitelisting ${routerNames[i]} in factory...`);
    await factory.setRouterAllowed(routerAddresses[i], true);
  }

  console.log("exporting addresses...");

  const zip = (a: string[], b: string[]) => a.map((k, i) => [k, b[i]]);

  const addressesToExport = {
    contracts: {
      ...Object.fromEntries(zip(templateNames, templateAddresses)),
      ...Object.fromEntries(zip(curveNames, curveAddresses)),
      CollectionPoolFactory: factory.address,
      ...Object.fromEntries(zip(routerNames, routerAddresses)),
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

export async function deployRouters(
  hre: HardhatRuntimeEnvironment,
  deployer: LedgerSigner | SignerWithAddress,
  factoryAddress: string
): Promise<{ routerNames: string[]; routerAddresses: string[] }> {
  const routerNames = ["CollectionRouter"];
  const routerAddresses: string[] = [];

  console.log(`--------------------------------`);
  console.log(`------- Deploying Routers -------`);
  console.log(`--------------------------------`);

  for (const routerName of routerNames) {
    console.log(`Deploying ${routerName}`);
    const deployFactory = await hre.ethers.getContractFactory(
      routerName,
      deployer
    );
    const deployedRouter = await deployFactory.deploy(factoryAddress);
    await deployedRouter.deployed();
    console.log(`${routerName} address: ${deployedRouter.address}`);
    routerAddresses.push(deployedRouter.address);
  }

  console.log(`------------------------------`);

  return { routerNames, routerAddresses };
}
