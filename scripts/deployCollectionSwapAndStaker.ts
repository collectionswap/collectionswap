import fs from 'fs';

import {
    Collectionstaker__factory,
    Collectionstaker,
    Collectionswap__factory,
    Collectionswap
} from '../typechain-types';

import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {configs} from './config';
let deployerAddress: string;
let collectionSwap: Collectionswap;
let collectionStaker: Collectionstaker;

export async function deployCollectionSwapAndStaker(hre: HardhatRuntimeEnvironment) {
    const networkId = hre.network.config.chainId as number;
    const [deployer] = await hre.ethers.getSigners();
    deployerAddress = await deployer.getAddress();
    console.log(`Deployer: ${deployerAddress}`);

    let factoryAddress = configs[networkId].FACTORY;
    console.log(`Deploying Collectionswap...`);
    const collectionSwapFactory = (await hre.ethers.getContractFactory('Collectionswap')) as Collectionswap__factory;
    collectionSwap = await collectionSwapFactory.deploy(factoryAddress);
    await collectionSwap.deployed();
    console.log(`Collectionswap address: ${collectionSwap.address}`);

    console.log(`Deploying Collectionstaker...`);
    const collectionStakerFactory = (await hre.ethers.getContractFactory('Collectionstaker')) as Collectionstaker__factory;
    collectionStaker = await collectionStakerFactory.deploy(collectionSwap.address);
    await collectionStaker.deployed();
    console.log(`Collectionstaker address: ${collectionStaker.address}`);

    console.log('exporting addresses...');
    let addressesToExport = {
        deployer: deployerAddress,
        collectionSwap: collectionSwap.address,
        collectionStaker: collectionStaker.address
    };
    let exportJson = JSON.stringify(addressesToExport, null, 2);
    fs.writeFileSync(configs[networkId].EXPORT_FILENAME, exportJson);

    console.log('waiting for etherscan backend propagation... sleeping for 1 minute');
    for (let i = 1; i <= 4; i++) {
        await new Promise(r => setTimeout(r, 15_000));
        console.log(`${(60 - 15 * i)}s left...`)
    }

    console.log('verifying Collectionswap...');
    await hre.run("verify:verify", {
        address: collectionSwap.address,
        constructorArguments: [factoryAddress]
    });

    console.log('verifying Collectionstaker...');
    await hre.run("verify:verify", {
        address: collectionStaker.address,
        constructorArguments: [collectionSwap.address]
    });
}
