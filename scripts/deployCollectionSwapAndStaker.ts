import fs from 'fs';
import { LedgerSigner } from "@anders-t/ethers-ledger";    
// import { LedgerSigner } from "@ethersproject/hardware-wallets";    

import {
    Collectionstaker__factory,
    Collectionstaker,
    Collectionswap__factory,
    Collectionswap,
    RewardPoolETH__factory,
    RewardPoolETH
} from '../typechain-types';

import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {configs} from './config';
let deployerAddress: string;
let collectionSwap: Collectionswap;
let collectionStaker: Collectionstaker;
let rewardPool: RewardPoolETH;

export async function deployCollectionSwapAndStaker(hre: HardhatRuntimeEnvironment) {
    const ledger = await new LedgerSigner(hre.ethers.provider);                                  
    // const ledger = await new LedgerSigner(hre.ethers.provider, "hid", "m/44'/60'/0'/0");                                  
    const ledgerAddress = await ledger.getAddress();           
    console.log(`Deployer: ${ledgerAddress}`);

    const networkId = hre.network.config.chainId as number;
    console.log('networkId', networkId);
    // const [deployer] = await hre.ethers.getSigners();
    // deployerAddress = await deployer.getAddress();
    // console.log(`Deployer: ${deployerAddress}`);

    let factoryAddress = configs[networkId].FACTORY;
    // console.log(`Deploying Collectionswap...`);
    // let collectionSwapFactory = (await hre.ethers.getContractFactory('Collectionswap')) as Collectionswap__factory;
    // collectionSwapFactory = await collectionSwapFactory.connect(ledger);
    // console.log('Deploying collectionswap...')
    console.log('factoryAddress', factoryAddress);
    // collectionSwap = await collectionSwapFactory.deploy(factoryAddress,{gasLimit: 5000000});
    // console.log('Deployed collectionswap!')
    // console.log('collectionswap deployed...')
    // await collectionSwap.deployed();
    collectionSwap = (await hre.ethers.getContractAt('Collectionswap', '0x226620C03C2f2dBBBd90E2Eca4754D8a41Fd3DEB'));
    console.log(`Collectionswap address: ${collectionSwap.address}`);

    console.log(`Deploying Collectionstaker...`);
    let collectionStakerFactory = (await hre.ethers.getContractFactory('Collectionstaker')) as Collectionstaker__factory;
    collectionStakerFactory = await collectionStakerFactory.connect(ledger);
    console.log(`Deploying Collectionstaker...`);
    console.log('collectionSwap.address', collectionSwap.address);
    // collectionStaker = await collectionStakerFactory.deploy(collectionSwap.address,{gasLimit: 6000000});
    console.log('Deployed collectionstaker!')
    console.log('collectionstaker deployed...')
    // await collectionStaker.deployed();
    
    collectionStaker = (await hre.ethers.getContractAt('Collectionstaker','0x52Ef2a32F6db19cB82EFcEb63Ff6476A2645be7f'));
    console.log(`Collectionstaker address: ${collectionStaker.address}`);

    // console.log('exporting addresses...');
    // let addressesToExport = {
    //     // deployer: deployerAddress,
    //     deployer: ledgerAddress,
    //     collectionSwap: collectionSwap.address,
    //     collectionStaker: collectionStaker.address
    // };
    // let exportJson = JSON.stringify(addressesToExport, null, 2);
    // fs.writeFileSync(configs[networkId].EXPORT_FILENAME, exportJson);

    // collectionStaker = (await hre.ethers.getContractAt('Collectionstaker', '0x4aa8ae968d01a8e0335ecb819c802b94c0398690'));
    // 0x4aa8ae968d01a8e0335ecb819c802b94c0398690
    // console.log(`Collectionstaker address: ${collectionStaker.address}`);

    console.log(`Deploying RewardPoolETH...`)
    const nftAddress = collectionSwap.address //kludge
    const curveAddress = '0x432f962D8209781da23fB37b6B59ee15dE7d9841'
    const delta = hre.ethers.utils.parseEther("1.1")
    const fee = hre.ethers.utils.parseEther("0.1")
    const wethArray = ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2']
    const rewardRates = [hre.ethers.utils.parseEther("0.001")]
    const startTime = 	1664165919
    const endTime = 	1664165920

    let rewardPoolFactory = (await hre.ethers.getContractFactory('RewardPoolETH')) as RewardPoolETH__factory;
    rewardPoolFactory = await rewardPoolFactory.connect(ledger);
    rewardPool = await rewardPoolFactory.deploy(
        ledgerAddress,
        collectionSwap.address,
        nftAddress,
        curveAddress,
        delta,
        fee,
        wethArray,
        rewardRates,
        startTime,
        endTime, {gasLimit: 3000000});

    // let rewardPool = await rewardPoolFactory.deploy(collectionStaker.address, {gasLimit: 6000000});

    console.log('waiting for etherscan backend propagation... sleeping for 1 minute');
    for (let i = 1; i <= 4; i++) {
        await new Promise(r => setTimeout(r, 15_000));
        console.log(`${(60 - 15 * i)}s left...`)
    }

    // console.log('verifying Collectionswap...');
    // await hre.run("verify:verify", {
        // address: collectionSwap.address,
        // constructorArguments: [factoryAddress]
    // });

    // console.log('verifying Collectionstaker...');
    // await hre.run("verify:verify", {
    //     address: collectionStaker.address,
    //     constructorArguments: [collectionSwap.address]
    // });

    console.log('verifying RewardPoolETH...');
    await hre.run("verify:verify", {
        address: rewardPool.address,
        constructorArguments: [
            ledgerAddress,
            collectionSwap.address,
            nftAddress,
            curveAddress,
            delta,
            fee,
            wethArray,
            rewardRates,
            startTime,
            endTime
        ]
    });
}

