import fs from 'fs';

import {
    RewardPoolETH__factory,
    RewardPoolETH
} from '../typechain-types';

import {HardhatRuntimeEnvironment} from 'hardhat/types';

export async function verifyRewardPool(taskArgs: any, hre: HardhatRuntimeEnvironment) {
    const networkId = hre.network.config.chainId as number;
    const [deployer] = await hre.ethers.getSigners();
    // read file from input
    const poolParams = JSON.parse(fs.readFileSync(taskArgs.i, 'utf8'));
    console.log('verifying RewardPool...');
    await hre.run("verify:verify", {
        address: poolParams.address,
        constructorArguments: [
            poolParams.lpToken,
            poolParams.nft,
            poolParams.bondingCurve,
            poolParams.delta,
            poolParams.fee,
            poolParams.rewardToken,
            poolParams.startTime,
            poolParams.endTime,
            poolParams.rewardRate
        ]
    });
}
