import { task } from "hardhat/config";

task(
  "deployCollectionSet",
  "deploy templates, curves, factory, CollectionSwap and Collectionstaker contracts"
).setAction(async (taskArgs, hre) => {
  // Only load this file when task is run because it depends on typechain built artifacts
  // which will create a circular dependency when required by hardhat.config.ts for first compilation
  const { deployCollectionSet } = await import("./deployCollectionSet");
  await deployCollectionSet(hre);
});

task("verifyRewardPool", "verify RewardPool contract")
  .addParam("i", "JSON file containing exported addresses")
  .setAction(async (taskArgs, hre) => {
    // Only load this file when task is run because it depends on typechain built artifacts
    // which will create a circular dependency when required by hardhat.config.ts for first compilation
    const { verifyRewardPool } = await import("./verifyRewardPool");
    await verifyRewardPool(taskArgs, hre);
  });
