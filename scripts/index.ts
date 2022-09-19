import {task} from 'hardhat/config';

task('deployCollectionSwapAndStaker', 'deploy Collectionswap and Collectionstaker contracts').setAction(async (taskArgs, hre) => {
  // only load this file when task is run because it depends on typechain built artifacts
  // which will create a circular dependency when required by hardhat.config.ts for first compilation
  const {deployCollectionSwapAndStaker} = await import('./deployCollectionSwapAndStaker');
  await deployCollectionSwapAndStaker(hre);
});

task('verifyRewardPool', 'verify RewardPool contract')
  .addParam('i', 'JSON file containing exported addresses')
  .setAction(async (taskArgs, hre) => {
    // only load this file when task is run because it depends on typechain built artifacts
    // which will create a circular dependency when required by hardhat.config.ts for first compilation
    const {verifyRewardPool} = await import('./verifyRewardPool');
    await verifyRewardPool(taskArgs, hre);
});
