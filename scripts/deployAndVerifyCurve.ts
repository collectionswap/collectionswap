import { LedgerSigner } from "@anders-t/ethers-ledger";

import { configs } from "./config";

import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

export async function deployAndVerifyCurve(hre: HardhatRuntimeEnvironment) {
  const networkId = hre.network.config.chainId as number;
  console.log(`NetworkId: ${networkId}`);
  const config = configs[networkId];

  const [deployer] = config.USE_LEDGER
    ? [new LedgerSigner(hre.ethers.provider)]
    : await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  console.log(`Deployer: ${deployerAddress}`);

  const { curveNames, curveAddresses } = await deployCurves(hre, deployer);

  console.log(`----- VERIFICATION ------`);

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

  // iterate through the curveNames and curveAddresses and verify
  const curves = Object.fromEntries(
    curveNames.map((name, i) => [name, curveAddresses[i]])
  );

  for (const [name, address] of Object.entries(curves)) {
    await verify(name, {
      address,
      constructorArguments: [],
    });
  }
}

export async function deployCurves(
  hre: HardhatRuntimeEnvironment,
  deployer: LedgerSigner | SignerWithAddress
): Promise<{ curveNames: string[]; curveAddresses: string[] }> {
  // Curves
  const curveNames = [
    "LinearCurveWithSpreadInflator",
    "ExponentialCurveWithSpreadInflator",
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
